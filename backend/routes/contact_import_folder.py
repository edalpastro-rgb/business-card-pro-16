# V50.z424 — IMPORT CLIENTE DA CARTELLA DOCUMENTI SCANSIONATI
# Flusso: sessione → upload file (multipart, uno alla volta, con percorso relativo = sottocartelle) → analisi
# (testo pypdf/PyMuPDF → OCR Tesseract per gli scansionati → visura camerale individuata → LLM estrae anagrafica da
# visura + frammenti degli altri documenti; regex di rinforzo per IBAN/PEC/SDI/email/telefono) → anteprima con campi
# mancanti → commit: scheda cliente (stato cliente attivo + data attivazione) + tutti i documenti allegati, PDF
# scansionati compressi verso 200 KB (tolleranza ~300 KB), struttura cartelle preservata nel campo `folder` di ogni file.
# I file caricati vivono su disco in /tmp/axon_import/<session_id>/ per la durata della sessione (pulizia dopo commit / 24h).
import asyncio as _ci_asyncio
import base64 as _ci_b64
import json as _ci_json
import os as _ci_os
import re as _ci_re
import shutil as _ci_shutil
import time as _ci_time
import uuid as _ci_uuid
from typing import Any, Dict, List, Optional

from pydantic import BaseModel as _CiBase

_CI_ROOT = _ci_os.environ.get("AXON_IMPORT_TMP") or "/tmp/axon_import"
_CI_MAX_FILE = 25 * 1024 * 1024
_CI_MAX_FILES = 150
_CI_TARGET = 200 * 1024
_CI_TOLERANCE = 300 * 1024
_CI_SESSION_TTL = 24 * 3600

CI_FIELDS = ["company", "legal_form", "vat_number", "fiscal_code", "address_street", "address_zip", "address_city", "address_province",
             "email", "pec", "sdi_code", "phone", "whatsapp", "bank_name", "iban", "legal_rep", "rea", "ateco"]
CI_REQUIRED = ["whatsapp", "email"]  # cellulare + email obbligatori per confermare
CI_LABELS = {"company": "Ragione sociale", "legal_form": "Forma giuridica", "vat_number": "Partita IVA", "fiscal_code": "Codice fiscale",
             "address_street": "Indirizzo sede (via e civico)", "address_zip": "CAP", "address_city": "Città", "address_province": "Provincia",
             "email": "Email", "pec": "PEC", "sdi_code": "Codice SDI", "phone": "Telefono", "whatsapp": "Cellulare", "bank_name": "Banca",
             "iban": "IBAN", "legal_rep": "Legale rappresentante", "rea": "REA", "ateco": "ATECO"}

_CI_VISURA_RX = _ci_re.compile(r"visura\s+(camerale|ordinaria|storica)|registro\s+(delle\s+)?imprese|camera\s+di\s+commercio|c\.?c\.?i\.?a\.?a|numero\s+rea", _ci_re.I)
_CI_IBAN_RX = _ci_re.compile(r"\bIT\s?\d{2}\s?[A-Z]\s?(?:\d\s?){10}[A-Z0-9\s]{12,16}\b", _ci_re.I)
_CI_EMAIL_RX = _ci_re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_CI_SDI_RX = _ci_re.compile(r"(?:codice\s+(?:destinatario|sdi|univoco)|sdi)\s*[:\-]?\s*([A-Z0-9]{7})\b", _ci_re.I)
_CI_PIVA_RX = _ci_re.compile(r"(?:p\.?\s?iva|partita\s+iva|vat)\s*[:\-]?\s*(?:IT)?\s*(\d{11})\b", _ci_re.I)
_CI_CF_RX = _ci_re.compile(r"(?:codice\s+fiscale|c\.?f\.?)\s*[:\-]?\s*([A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]|\d{11})\b", _ci_re.I)
_CI_PHONE_RX = _ci_re.compile(r"(?:\+39\s?)?(?:3\d{2}[\s.\-]?\d{3}[\s.\-]?\d{3,4}|0\d{1,3}[\s.\-]?\d{5,8})")

_CI_SYSTEM = ("Sei un estrattore di dati anagrafici aziendali per un CRM italiano. Rispondi SOLO con un oggetto JSON valido, senza testo attorno. "
              "Non inventare mai: se un dato non è nei documenti ometti la chiave. Normalizza: P.IVA 11 cifre, IBAN senza spazi, telefoni con solo cifre e prefisso +39 opzionale.")


class CiCommitIn(_CiBase):
    fields: Dict[str, Any]
    is_active_client: bool = True
    client_since: Optional[str] = None  # YYYY-MM-DD, anche retroattiva
    area: Optional[str] = None
    status: str = "client"
    compress: bool = True


def _ci_dir(sid: str) -> str:
    return _ci_os.path.join(_CI_ROOT, _ci_re.sub(r"[^a-zA-Z0-9_\-]", "", sid))


def _ci_safe_rel(rel: str, name: str) -> str:
    """Percorso relativo così come caricato dall'utente (solo sanificazione di sicurezza: niente «..», niente assoluti)."""
    rel = (rel or name or "").replace("\\", "/").strip("/")
    parts = [p for p in rel.split("/") if p not in ("", ".", "..")]
    if not parts:
        parts = [name or "file"]
    return "/".join(parts)[:400]


async def _ci_session(sid: str, user: dict) -> dict:
    s = await db.contact_import_sessions.find_one({"session_id": sid, "tenant_id": tenant_id(user)}, {"_id": 0})  # noqa: F821
    if not s:
        raise HTTPException(status_code=404, detail="Sessione di import non trovata (scaduta?)")  # noqa: F821
    return s


def _ci_cleanup_old() -> None:
    try:
        now = _ci_time.time()
        for d in _ci_os.listdir(_CI_ROOT) if _ci_os.path.isdir(_CI_ROOT) else []:
            p = _ci_os.path.join(_CI_ROOT, d)
            if _ci_os.path.isdir(p) and now - _ci_os.path.getmtime(p) > _CI_SESSION_TTL:
                _ci_shutil.rmtree(p, ignore_errors=True)
    except Exception:  # noqa: BLE001
        pass


@api_router.post("/contacts/import-folder/session")  # noqa: F821
async def ci_session_create(user=Depends(get_current_user)):  # noqa: F821
    _ci_cleanup_old()
    sid = f"imp_{_ci_uuid.uuid4().hex[:12]}"
    _ci_os.makedirs(_ci_dir(sid), exist_ok=True)
    await db.contact_import_sessions.insert_one({"session_id": sid, "tenant_id": tenant_id(user), "user_id": user["user_id"], "files": [],  # noqa: F821
                                                 "status": "uploading", "created_at": utcnow()})  # noqa: F821
    return {"session_id": sid, "max_files": _CI_MAX_FILES, "max_file_mb": _CI_MAX_FILE // (1024 * 1024)}


@api_router.post("/contacts/import-folder/{sid}/file")  # noqa: F821
async def ci_file_upload(sid: str, file: UploadFile = File(...), rel_path: str = Form(""), user=Depends(get_current_user)):  # noqa: F821
    """Un file per richiesta (multipart). `rel_path` = percorso relativo dentro la cartella scelta (es. «Asolo Pneus/Visure/visura.pdf»)."""
    s = await _ci_session(sid, user)
    if len(s.get("files") or []) >= _CI_MAX_FILES:
        raise HTTPException(status_code=400, detail=f"Massimo {_CI_MAX_FILES} file per import")  # noqa: F821
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="File vuoto")  # noqa: F821
    if len(raw) > _CI_MAX_FILE:
        raise HTTPException(status_code=413, detail=f"«{file.filename}» supera {_CI_MAX_FILE // (1024 * 1024)} MB")  # noqa: F821
    rel = _ci_safe_rel(rel_path, file.filename or "file")
    fid = f"f_{_ci_uuid.uuid4().hex[:10]}"
    with open(_ci_os.path.join(_ci_dir(sid), fid), "wb") as fh:
        fh.write(raw)
    name = rel.rsplit("/", 1)[-1]
    mime = (file.content_type or "").split(";")[0].strip() or ("application/pdf" if name.lower().endswith(".pdf") else "application/octet-stream")
    if raw[:5] == b"%PDF-":
        mime = "application/pdf"
    meta = {"id": fid, "name": name, "rel_path": rel, "folder": rel.rsplit("/", 1)[0] + "/" if "/" in rel else "", "mime": mime, "size": len(raw)}
    await db.contact_import_sessions.update_one({"session_id": sid}, {"$push": {"files": meta}})  # noqa: F821
    return meta


async def _ci_pdf_text(raw: bytes) -> Dict[str, Any]:
    """Testo del PDF: layer testuale (PyMuPDF) → se scarso, OCR Tesseract (prime 4 pagine). {text, scanned, pages}."""
    text, pages = "", 0
    try:
        r = await heavy_call("pdf_text", data=raw, max_pages=8, max_chars=20000, timeout=60)  # noqa: F821
        text = r.get("text") or ""
        pages = int(r.get("pages") or r.get("n") or 0)
    except Exception:  # noqa: BLE001
        pass
    scanned = len(text.strip()) < 200
    if scanned:
        try:
            r = await heavy_call("pdf_ocr", data=raw, max_pages=4, dpi=150, timeout=180)  # noqa: F821
            if r.get("text"):
                text = r["text"]
        except Exception as exc:  # noqa: BLE001
            logger.warning("[import-folder] OCR fallito: %s", exc)
    return {"text": text, "scanned": scanned, "pages": pages}


def _ci_regex_hints(text: str) -> Dict[str, str]:
    h: Dict[str, str] = {}
    m = _CI_IBAN_RX.search(text)
    if m:
        ib = _ci_re.sub(r"\s+", "", m.group(0)).upper()
        if len(ib) == 27:
            h["iban"] = ib
    for e in _CI_EMAIL_RX.findall(text):
        el = e.lower()
        if "pec" in el or el.endswith((".legalmail.it", "@pec.it", "@legalmail.it", "@arubapec.it", "@pecimprese.it")) or ".pec." in el:
            h.setdefault("pec", el)
        else:
            h.setdefault("email", el)
    m = _CI_SDI_RX.search(text)
    if m:
        h["sdi_code"] = m.group(1).upper()
    m = _CI_PIVA_RX.search(text)
    if m:
        h["vat_number"] = m.group(1)
    m = _CI_CF_RX.search(text)
    if m:
        h["fiscal_code"] = m.group(1).upper()
    codes = {h.get("vat_number"), h.get("fiscal_code")}
    for ph in _CI_PHONE_RX.findall(text):
        d = _ci_re.sub(r"\D", "", ph)
        if d.startswith("39") and len(d) > 10:
            d = d[2:]
        if d in codes:
            continue  # P.IVA / CF numerico scambiati per telefono
        if d.startswith("3") and len(d) == 10:
            h.setdefault("whatsapp", d)
        elif d.startswith("0") and 6 <= len(d) <= 10:
            h.setdefault("phone", d)
    return h


@api_router.post("/contacts/import-folder/{sid}/analyze")  # noqa: F821
async def ci_analyze(sid: str, user=Depends(get_current_user)):  # noqa: F821
    """Legge tutti i PDF, trova la visura camerale, estrae l'anagrafica. Ritorna anteprima + campi mancanti + fonti."""
    s = await _ci_session(sid, user)
    files = s.get("files") or []
    if not files:
        raise HTTPException(status_code=400, detail="Nessun file caricato")  # noqa: F821
    docs: List[dict] = []
    for f in files:
        path = _ci_os.path.join(_ci_dir(sid), f["id"])
        if not _ci_os.path.exists(path):
            continue
        with open(path, "rb") as fh:
            raw = fh.read()
        if f.get("mime") == "application/pdf" or raw[:5] == b"%PDF-":
            info = await _ci_pdf_text(raw)
            docs.append({**f, **info, "is_visura": bool(_CI_VISURA_RX.search(info["text"][:6000]))})
        else:
            docs.append({**f, "text": "", "scanned": False, "pages": 0, "is_visura": False})
    visure = [d for d in docs if d["is_visura"]]
    visura = max(visure, key=lambda d: len(d["text"])) if visure else None
    # frammenti degli altri documenti (bollette, fatture, contratti, IBAN…) per completare i dati mancanti
    others = [d for d in docs if d is not visura and d.get("text", "").strip()]
    others.sort(key=lambda d: -len(d["text"]))
    hints: Dict[str, Dict[str, str]] = {}
    for d in docs:
        for k, v in _ci_regex_hints(d.get("text") or "").items():
            hints.setdefault(k, {"value": v, "source": d["rel_path"]})
    prompt = ("Estrai l'anagrafica dell'AZIENDA CLIENTE (non del fornitore di energia, non della banca, non del consulente) in JSON con chiavi: "
              + ", ".join(f"{k} ({CI_LABELS[k]})" for k in CI_FIELDS) + ". "
              "La RAGIONE SOCIALE deve essere ESATTAMENTE quella della visura camerale (denominazione ufficiale, con forma giuridica es. «ASOLO PNEUS S.R.L.» → scrivila come «Asolo Pneus SRL»). "
              "Per ogni chiave aggiungi anche <chiave>_source = nome del file da cui l'hai presa.\n\n")
    if visura:
        prompt += f"=== VISURA CAMERALE ({visura['rel_path']}) ===\n{visura['text'][:14000]}\n\n"
    budget = 12000
    for d in others[:12]:
        chunk = d["text"][:min(1800, budget)]
        if not chunk:
            break
        budget -= len(chunk)
        prompt += f"=== DOCUMENTO ({d['rel_path']}) ===\n{chunk}\n\n"
        if budget <= 0:
            break
    extracted: Dict[str, Any] = {}
    if visura or others:
        try:
            data = await _ft_llm(_CI_SYSTEM, prompt, None, session="import-folder")  # noqa: F821
            extracted = {k: v for k, v in (data or {}).items() if v not in (None, "", [], {})}
        except Exception as exc:  # noqa: BLE001
            logger.warning("[import-folder] LLM fallito: %s", exc)
    fields: Dict[str, Any] = {}
    sources: Dict[str, str] = {}
    for k in CI_FIELDS:
        v = extracted.get(k)
        if isinstance(v, (list, dict)):
            v = _ci_json.dumps(v, ensure_ascii=False)
        if v:
            fields[k] = str(v).strip()
            sources[k] = str(extracted.get(f"{k}_source") or (visura["rel_path"] if visura else ""))
        elif k in hints:
            fields[k] = hints[k]["value"]; sources[k] = hints[k]["source"]
    # normalizzazioni
    if fields.get("iban"):
        fields["iban"] = _ci_re.sub(r"\s+", "", fields["iban"]).upper()
    if fields.get("vat_number"):
        fields["vat_number"] = _ci_re.sub(r"\D", "", fields["vat_number"])[-11:]
    for k in ("phone", "whatsapp"):
        if fields.get(k):
            d = _ci_re.sub(r"[^\d+]", "", fields[k])
            if d.lstrip("+").removeprefix("39") in {fields.get("vat_number"), fields.get("fiscal_code")} or len(d.lstrip("+")) > 13:
                fields.pop(k, None); sources.pop(k, None)  # P.IVA/CF scambiati per telefono
            else:
                fields[k] = d
    if fields.get("company") and not fields.get("legal_form"):
        m = _ci_re.search(r"\b(s\.?r\.?l\.?s?|s\.?n\.?c\.?|s\.?a\.?s\.?|s\.?p\.?a\.?|s\.?s\.?|soc\.?\s*coop\.?|ditta individuale)\b\.?$", fields["company"], _ci_re.I)
        if m:
            fields["legal_form"] = m.group(1).replace(".", "").upper()
    missing = [k for k in CI_FIELDS if not fields.get(k)]
    result = {
        "fields": fields, "sources": sources, "missing": missing, "required": CI_REQUIRED, "labels": CI_LABELS,
        "visura_file": visura["rel_path"] if visura else None,
        "files": [{"id": d["id"], "name": d["name"], "rel_path": d["rel_path"], "folder": d["folder"], "size": d["size"], "mime": d["mime"],
                   "pages": d.get("pages", 0), "scanned": bool(d.get("scanned")), "is_visura": d["is_visura"], "text_chars": len(d.get("text") or "")} for d in docs],
        "warnings": ([] if visura else ["Nessuna visura camerale riconosciuta tra i PDF: la ragione sociale va verificata a mano."]),
    }
    await db.contact_import_sessions.update_one({"session_id": sid}, {"$set": {"status": "analyzed", "analysis": result, "analyzed_at": utcnow()}})  # noqa: F821
    return result


@api_router.post("/contacts/import-folder/{sid}/commit")  # noqa: F821
async def ci_commit(sid: str, body: CiCommitIn, user=Depends(get_current_user)):  # noqa: F821
    """Crea la scheda cliente con i dati confermati e allega TUTTI i documenti (PDF scansionati compressi verso 200 KB),
    preservando il percorso originale di ogni file nel campo `folder`."""
    s = await _ci_session(sid, user)
    f = {k: (str(v).strip() if v is not None else "") for k, v in (body.fields or {}).items()}
    missing_req = [k for k in CI_REQUIRED if not f.get(k)]
    if missing_req:
        raise HTTPException(status_code=400, detail="Campi obbligatori mancanti: " + ", ".join(CI_LABELS[k] for k in missing_req))  # noqa: F821
    if not f.get("company"):
        raise HTTPException(status_code=400, detail="Ragione sociale mancante")  # noqa: F821
    area = body.area or (user.get("areas") or ["energy"])[0]
    check_area_allowed(user, area)  # noqa: F821
    cid = f"c_{_ci_uuid.uuid4().hex[:12]}"
    company = f["company"]
    first_name = company
    legal_rep = f.get("legal_rep") or ""
    payload = {
        "first_name": first_name, "last_name": "", "company": company, "legal_form": f.get("legal_form") or None,
        "vat_number": f.get("vat_number") or None, "fiscal_code": f.get("fiscal_code") or None,
        "address_street": f.get("address_street") or None, "address_zip": f.get("address_zip") or None, "address_city": f.get("address_city") or None,
        "address_province": f.get("address_province") or None,
        "address": ", ".join(x for x in (f.get("address_street"), " ".join(y for y in (f.get("address_zip"), f.get("address_city")) if y), f.get("address_province")) if x) or None,
        "email": f.get("email") or None, "pec": f.get("pec") or None, "sdi_code": f.get("sdi_code") or None,
        "phone": f.get("phone") or f.get("whatsapp") or None, "whatsapp": f.get("whatsapp") or None,
        "bank_name": f.get("bank_name") or None, "iban": f.get("iban") or None,
        "role": legal_rep or None,
        "area": area, "status": body.status or "client", "is_active_client": bool(body.is_active_client),
        "client_since": (body.client_since or utcnow().strftime("%Y-%m-%d")) if body.is_active_client else None,  # noqa: F821
        "customer_type": {area: "business"},
        "custom_fields": {k: v for k, v in {"rea": f.get("rea"), "ateco": f.get("ateco"), "legale_rappresentante": legal_rep}.items() if v},
        "assigned_to_user_id": user["user_id"],
        "import_source": {"kind": "folder", "session_id": sid, "visura_file": (s.get("analysis") or {}).get("visura_file")},
    }
    payload["contact_code"] = await _next_contact_code(user, area)  # noqa: F821
    files_out: List[dict] = []
    stats = {"files": 0, "before": 0, "after": 0, "compressed": 0, "over_tolerance": 0}
    for meta in s.get("files") or []:
        path = _ci_os.path.join(_ci_dir(sid), meta["id"])
        if not _ci_os.path.exists(path):
            continue
        with open(path, "rb") as fh:
            raw = fh.read()
        before = len(raw)
        info: Dict[str, Any] = {}
        if body.compress and raw[:5] == b"%PDF-" and before > _CI_TARGET:
            try:
                r = await heavy_call("compress_pdf_target", pdf=raw, target_bytes=_CI_TARGET, tolerance_bytes=_CI_TOLERANCE, timeout=240)  # noqa: F821
                if r.get("pdf") and len(r["pdf"]) < before:
                    raw = r["pdf"]; info = r
                    stats["compressed"] += 1
                if len(raw) > _CI_TOLERANCE:
                    stats["over_tolerance"] += 1
            except Exception as exc:  # noqa: BLE001
                logger.warning("[import-folder] compressione fallita %s: %s", meta.get("name"), exc)
        entry = {"id": str(_ci_uuid.uuid4()), "name": meta["name"], "mime": meta["mime"], "data_base64": _ci_b64.b64encode(raw).decode(),
                 "size": len(raw), "created_at": utcnow(), "folder": meta.get("folder") or "", "rel_path": meta.get("rel_path"),  # noqa: F821
                 "import_session_id": sid}
        if info.get("before"):
            entry["compressed_from"] = info["before"]
        files_out.append(entry)
        stats["files"] += 1; stats["before"] += before; stats["after"] += len(raw)
    doc = {"contact_id": cid, "user_id": tenant_id(user), "created_by": user["user_id"], **payload, "notes": [], "files": files_out,  # noqa: F821
           "created_at": utcnow(), "updated_at": utcnow()}  # noqa: F821
    await db.contacts.insert_one(doc)  # noqa: F821
    await db.contact_import_sessions.update_one({"session_id": sid}, {"$set": {"status": "committed", "contact_id": cid, "committed_at": utcnow(), "stats": stats}})  # noqa: F821
    _ci_shutil.rmtree(_ci_dir(sid), ignore_errors=True)
    return {"contact_id": cid, "company": company, "stats": stats, "files": [{k: v for k, v in e.items() if k != "data_base64"} for e in files_out]}


@api_router.delete("/contacts/import-folder/{sid}")  # noqa: F821
async def ci_abort(sid: str, user=Depends(get_current_user)):  # noqa: F821
    await _ci_session(sid, user)
    _ci_shutil.rmtree(_ci_dir(sid), ignore_errors=True)
    await db.contact_import_sessions.update_one({"session_id": sid}, {"$set": {"status": "aborted"}})  # noqa: F821
    return {"ok": True}

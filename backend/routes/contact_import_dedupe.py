# ============================================================================
# V50.z491 — ANTEPRIMA DUPLICATI + UNIONE per le importazioni (cartella / Drive / CSV-Excel) + ritorno alla scheda
# ----------------------------------------------------------------------------
# • _ci_find_duplicates(user, fields): contatti già esistenti che combaciano per P.IVA, CF, email, PEC, telefono/WhatsApp,
#   ragione sociale o nome+cognome (normalizzati). Ogni match riporta `match: [campo…]`.
# • Cartella/Drive: `analyze` restituisce anche `duplicates`; `POST …/duplicates {fields}` ricalcola dopo le modifiche;
#   `commit` accetta `merge_into_contact_id` → i dati compilano SOLO i campi vuoti della scheda esistente, i documenti si
#   aggiungono, niente seconda scheda (risposta `merged: true`, `contact_id` = scheda esistente).
# • CSV/Excel: `POST /contacts/import/check-duplicates {rows, mapping}` → righe che combaciano con contatti esistenti;
#   `execute` accetta `duplicate_strategy` = create | skip | merge e restituisce anche `contact_ids` (creati/uniti),
#   `skipped_duplicates`, `merged` → il frontend apre subito la scheda quando è una sola.
# ============================================================================
import re as _cd_re
from typing import Any as _cd_Any, Dict as _cd_Dict, List as _cd_List, Optional as _cd_Optional


def _cd_norm(s: _cd_Optional[str]) -> str:
    return _cd_re.sub(r"[^a-z0-9]", "", (s or "").lower().replace("à", "a").replace("è", "e").replace("é", "e").replace("ì", "i").replace("ò", "o").replace("ù", "u"))


def _cd_norm_phone(s: _cd_Optional[str]) -> str:
    d = _cd_re.sub(r"\D", "", s or "")
    if d.startswith("0039"):
        d = d[4:]
    elif d.startswith("39") and len(d) > 10:
        d = d[2:]
    return d


_CD_LEGAL = ("srl", "srls", "spa", "snc", "sas", "ss", "sapa", "scarl", "soccoop", "coop", "societa", "ditta", "individuale")


def _cd_company_key(s: _cd_Optional[str]) -> str:
    k = _cd_norm(s)
    for lf in _CD_LEGAL:
        if k.endswith(lf) and len(k) > len(lf) + 2:
            k = k[: -len(lf)]
    return k


def _cd_name_key(first: _cd_Optional[str], last: _cd_Optional[str]) -> str:
    return "".join(sorted([_cd_norm(first), _cd_norm(last)]))


def _cd_match_fields(fields: _cd_Dict[str, _cd_Any], c: dict) -> _cd_List[str]:
    m: _cd_List[str] = []
    vat = _cd_re.sub(r"\D", "", str(fields.get("vat_number") or ""))
    if vat and vat == _cd_re.sub(r"\D", "", str(c.get("vat_number") or "")):
        m.append("vat_number")
    cf = _cd_norm(str(fields.get("fiscal_code") or fields.get("tax_id") or ""))
    if len(cf) >= 11 and cf == _cd_norm(str(c.get("fiscal_code") or c.get("tax_id") or "")):
        m.append("fiscal_code")
    for k in ("email", "pec", "email_alt"):
        v = (fields.get(k) or "").strip().lower()
        if v and v in {(c.get("email") or "").lower(), (c.get("pec") or "").lower(), (c.get("email_alt") or "").lower()}:
            m.append(k)
    ph = {p for p in (_cd_norm_phone(fields.get("phone")), _cd_norm_phone(fields.get("whatsapp")), _cd_norm_phone(fields.get("phone_alt"))) if len(p) >= 8}
    cph = {p for p in (_cd_norm_phone(c.get("phone")), _cd_norm_phone(c.get("whatsapp")), _cd_norm_phone(c.get("phone_alt"))) if len(p) >= 8}
    if ph & cph:
        m.append("phone")
    ck = _cd_company_key(fields.get("company"))
    if len(ck) >= 4 and ck == _cd_company_key(c.get("company") or ("" if c.get("last_name") else c.get("first_name"))):
        m.append("company")
    nk = _cd_name_key(fields.get("first_name"), fields.get("last_name"))
    if fields.get("last_name") and len(nk) >= 6 and nk == _cd_name_key(c.get("first_name"), c.get("last_name")):
        m.append("name")
    return m


async def _ci_find_duplicates(user: dict, fields: _cd_Dict[str, _cd_Any], limit: int = 5) -> _cd_List[dict]:
    """Contatti del tenant che combaciano con i dati da importare. Scansione in memoria (≤ 3000 contatti, proiezione leggera)."""
    if not fields:
        return []
    tid = tenant_id(user)  # noqa: F821
    try:
        q = await _omni_contact_query(user)  # noqa: F821 — rispetta la visibilità (owner/collaboratori)
    except Exception:
        q = {"user_id": tid}
    proj = {"_id": 0, "contact_id": 1, "first_name": 1, "last_name": 1, "company": 1, "vat_number": 1, "fiscal_code": 1, "tax_id": 1, "email": 1, "pec": 1,
            "email_alt": 1, "phone": 1, "whatsapp": 1, "phone_alt": 1, "address_city": 1, "files": {"$slice": 0}, "status": 1, "contact_code": 1}
    out: _cd_List[dict] = []
    async for c in db.contacts.find(q, proj).limit(3000):  # noqa: F821
        m = _cd_match_fields(fields, c)
        if not m:
            continue
        name = (c.get("company") or f"{c.get('first_name') or ''} {c.get('last_name') or ''}").strip() or c.get("contact_id")
        out.append({"contact_id": c["contact_id"], "name": name, "company": c.get("company") or "", "city": c.get("address_city") or "", "phone": c.get("phone") or "",
                    "email": c.get("email") or "", "contact_code": c.get("contact_code") or "", "status": c.get("status") or "", "match": m, "score": len(m) + (2 if "vat_number" in m or "fiscal_code" in m else 0)})
    out.sort(key=lambda x: -x["score"])
    return out[:limit]


_CD_FILL_KEYS = ("company", "legal_form", "vat_number", "fiscal_code", "address_street", "address_zip", "address_city", "address_province", "address", "email", "pec",
                 "sdi_code", "phone", "whatsapp", "phone_alt", "email_alt", "bank_name", "iban", "role", "website", "first_name", "last_name", "birth_date", "tags")


def _cd_fill_blank(existing: dict, incoming: dict) -> _cd_Dict[str, _cd_Any]:
    """Solo i campi vuoti della scheda esistente vengono compilati (quanto c'è già ha priorità)."""
    upd: _cd_Dict[str, _cd_Any] = {}
    for k in _CD_FILL_KEYS:
        v = incoming.get(k)
        if v in (None, "", [], {}):
            continue
        if existing.get(k) in (None, "", [], {}):
            upd[k] = v
    inc_cf = incoming.get("custom_fields") or {}
    if inc_cf:
        ex_cf = dict(existing.get("custom_fields") or {})
        changed = False
        for k, v in inc_cf.items():
            if v not in (None, "") and ex_cf.get(k) in (None, ""):
                ex_cf[k] = v; changed = True
        if changed:
            upd["custom_fields"] = ex_cf
    return upd


# ---------------------------------------------------------------------------
# Cartella / Drive
# ---------------------------------------------------------------------------
class CiDupIn(_CiBase):  # noqa: F821
    fields: _cd_Dict[str, _cd_Any] = {}


@api_router.post("/contacts/import-folder/{sid}/duplicates")  # noqa: F821
async def ci_duplicates(sid: str, body: CiDupIn, user=Depends(get_current_user)):  # noqa: F821
    await _ci_session(sid, user)  # noqa: F821
    return {"duplicates": await _ci_find_duplicates(user, body.fields or {})}


_cd_orig_analyze = None
_cd_orig_commit = None
for _r in list(api_router.routes):  # noqa: F821
    p = getattr(_r, "path", "")
    if p.endswith("/contacts/import-folder/{sid}/analyze") and "POST" in (getattr(_r, "methods", None) or set()):
        _cd_orig_analyze = _r.endpoint; api_router.routes.remove(_r)  # noqa: F821
    elif p.endswith("/contacts/import-folder/{sid}/commit") and "POST" in (getattr(_r, "methods", None) or set()):
        _cd_orig_commit = _r.endpoint; api_router.routes.remove(_r)  # noqa: F821


if _cd_orig_analyze is not None:
    @api_router.post("/contacts/import-folder/{sid}/analyze")  # noqa: F821
    async def ci_analyze(sid: str, user=Depends(get_current_user)):  # noqa: F811, F821
        res = await _cd_orig_analyze(sid, user)
        try:
            res["duplicates"] = await _ci_find_duplicates(user, res.get("fields") or {})
        except Exception as exc:  # noqa: BLE001
            logger.warning("[import-dedupe] analyze duplicates failed: %s", exc)  # noqa: F821
            res["duplicates"] = []
        return res


class CiCommitMergeIn(CiCommitIn):  # noqa: F821
    merge_into_contact_id: _cd_Optional[str] = None


if _cd_orig_commit is not None:
    @api_router.post("/contacts/import-folder/{sid}/commit")  # noqa: F821
    async def ci_commit(sid: str, body: CiCommitMergeIn, user=Depends(get_current_user)):  # noqa: F811, F821
        target = (body.merge_into_contact_id or "").strip()
        existing = None
        if target:
            q = await _omni_contact_query(user)  # noqa: F821
            existing = await db.contacts.find_one({**q, "contact_id": target})  # noqa: F821
            if not existing:
                raise HTTPException(status_code=404, detail="Contatto da unire non trovato")  # noqa: F821
        res = await _cd_orig_commit(sid, CiCommitIn(**{k: getattr(body, k) for k in CiCommitIn.model_fields}), user)  # noqa: F821
        if not existing:
            res["merged"] = False
            return res
        # «crea poi unisci»: sposta campi (solo vuoti) e documenti dalla scheda appena creata a quella esistente, poi elimina la nuova
        new_doc = await db.contacts.find_one({"contact_id": res["contact_id"]})  # noqa: F821
        if new_doc:
            upd = _cd_fill_blank(existing, new_doc)
            upd["updated_at"] = utcnow()  # noqa: F821
            upd["import_source"] = {**(new_doc.get("import_source") or {}), "merged_into": target, "merged_at": utcnow()}  # noqa: F821
            await db.contacts.update_one({"contact_id": target}, {  # noqa: F821
                "$set": upd,
                "$push": {"files": {"$each": new_doc.get("files") or []},
                          "notes": {"id": f"n_{res['contact_id'][2:]}", "text": f"📂 Unito da importazione cartella «{res.get('company') or ''}»: {res['stats'].get('files', 0)} documenti aggiunti, campi vuoti compilati.",
                                    "created_at": utcnow(), "author_id": user["user_id"], "kind": "import"}},  # noqa: F821
            })
            await db.contacts.delete_one({"contact_id": res["contact_id"]})  # noqa: F821
            await db.contact_import_sessions.update_one({"session_id": sid}, {"$set": {"contact_id": target, "merged_into": target}})  # noqa: F821
        res["merged"] = True
        res["new_contact_id_discarded"] = res["contact_id"]
        res["contact_id"] = target
        res["company"] = existing.get("company") or f"{existing.get('first_name') or ''} {existing.get('last_name') or ''}".strip()
        return res


# ---------------------------------------------------------------------------
# CSV / Excel
# ---------------------------------------------------------------------------
_CD_STD = {"first_name", "last_name", "company", "phone", "phone_alt", "whatsapp", "email", "email_alt", "pec", "vat_number", "fiscal_code", "tax_id", "address_street",
           "address_zip", "address_city", "address_province", "address", "role", "website", "birth_date"}


def _cd_row_payload(row: _cd_Dict[str, str], mapping: _cd_Dict[str, str]) -> _cd_Dict[str, _cd_Any]:
    out: _cd_Dict[str, _cd_Any] = {}
    cf: _cd_Dict[str, _cd_Any] = {}
    for col, val in (row or {}).items():
        t = mapping.get(col, "ignore")
        if t == "ignore" or val in (None, ""):
            continue
        if t.startswith("cf:"):
            cf[t[3:].strip()] = val
        elif t.startswith("custom:"):
            cf[t[7:].strip()] = val
        elif t == "tags":
            out["tags"] = [x.strip() for x in _cd_re.split(r"[,;]", val) if x.strip()]
        elif t in _CD_STD:
            out[t] = val
    if cf:
        out["custom_fields"] = cf
    return out


class ContactsImportCheckDupIn(BaseModel):  # noqa: F821
    rows: _cd_List[_cd_Dict[str, str]]
    mapping: _cd_Dict[str, str]


@api_router.post("/contacts/import/check-duplicates")  # noqa: F821
async def contacts_import_check_duplicates(body: ContactsImportCheckDupIn, user=Depends(get_current_user)):  # noqa: F821
    dups = []
    for idx, row in enumerate(body.rows[:2000]):
        pl = _cd_row_payload(row, body.mapping)
        if not pl:
            continue
        found = await _ci_find_duplicates(user, pl, limit=1)
        if found:
            label = pl.get("company") or f"{pl.get('first_name') or ''} {pl.get('last_name') or ''}".strip() or pl.get("email") or pl.get("phone") or f"riga {idx + 2}"
            dups.append({"row": idx + 2, "index": idx, "label": label, "existing": found[0], "match": found[0]["match"]})
    return {"duplicates": dups, "count": len(dups), "total_rows": len(body.rows)}


class ContactsImportExecuteDedupeIn(ContactsImportExecuteIn):  # noqa: F821
    duplicate_strategy: str = "create"  # create | skip | merge


_cd_orig_execute = None
for _r in list(api_router.routes):  # noqa: F821
    if getattr(_r, "path", "").endswith("/contacts/import/execute") and "POST" in (getattr(_r, "methods", None) or set()):
        _cd_orig_execute = _r.endpoint; api_router.routes.remove(_r)  # noqa: F821
        break

if _cd_orig_execute is not None:
    @api_router.post("/contacts/import/execute")  # noqa: F821
    async def contacts_import_execute(body: ContactsImportExecuteDedupeIn, user=Depends(get_current_user)):  # noqa: F811, F821
        strategy = (body.duplicate_strategy or "create").lower()
        rows = list(body.rows)
        skipped = 0
        merged_ids: _cd_List[str] = []
        if strategy in ("skip", "merge"):
            keep = []
            for row in rows:
                pl = _cd_row_payload(row, body.mapping)
                found = await _ci_find_duplicates(user, pl, limit=1) if pl else []
                if not found:
                    keep.append(row); continue
                if strategy == "skip":
                    skipped += 1; continue
                tgt = found[0]["contact_id"]
                existing = await db.contacts.find_one({"contact_id": tgt})  # noqa: F821
                if existing:
                    upd = _cd_fill_blank(existing, pl)
                    upd["updated_at"] = utcnow()  # noqa: F821
                    await db.contacts.update_one({"contact_id": tgt}, {"$set": upd})  # noqa: F821
                    merged_ids.append(tgt)
            rows = keep
        t0 = utcnow()  # noqa: F821
        res = await _cd_orig_execute(ContactsImportExecuteIn(rows=rows, mapping=body.mapping, default_area=body.default_area), user)  # noqa: F821
        created_ids: _cd_List[str] = []
        try:
            async for c in db.contacts.find({"user_id": tenant_id(user), "created_by": user["user_id"], "imported_at": {"$gte": t0}}, {"_id": 0, "contact_id": 1}).limit(5000):  # noqa: F821
                created_ids.append(c["contact_id"])
        except Exception:
            pass
        res["contact_ids"] = created_ids + merged_ids
        res["created_ids"] = created_ids
        res["merged"] = len(merged_ids)
        res["merged_ids"] = merged_ids
        res["skipped_duplicates"] = skipped
        res["duplicate_strategy"] = strategy
        return res

# axon_lab_multi.py — V50.z375 — AXON LAB (solo Super Master / delegati, MAI in CRT):
#  Fase 1 · «Test estrazione completa»: carica TUTTI i documenti insieme → Axon riconosce il tipo di ogni file ed estrae i dati
#           standard in un'unica passata → tabella di confronto campo per campo con i valori confermati singolarmente
#           (stato: ok | mismatch | not_found | conflict | new). Per un cliente tipo (profile=<id>) o per tutti insieme (profile=all:
#           coerenza tra esempi diversi → «profiles_disagree»). Ultimo test salvato in axon_lab_training.last_test.
#  Fase 2 · Esempi compilati MULTIPLI per modulo (form_templates.lab_examples[]): aggiungi / sostituisci / elimina; a ogni modifica
#           Axon ri-propone il mapping imparando da TUTTI gli esempi combinati (non solo dall'ultimo).
# Endpoint: POST /lab/training/test-extract · GET /lab/training/test-extract?profile= · POST /lab/modules/{id}/examples ·
#           DELETE /lab/modules/{id}/examples/{ex_id} · POST /lab/modules/{id}/examples/repropose

LAB_TEST_MAX_FILES = 14
LAB_CLASSIFY_PROMPT = (
    "Sei Axon Lab. Ricevi UN documento di un cliente (PDF/foto). 1) Riconosci il TIPO tra: " + ", ".join(f"{d['id']} ({d['label']})" for d in LAB_DOCS) +
    ". 2) Estrai TUTTI i dati standard di quel tipo. Chiavi per tipo: " + _json_stdlib.dumps({d["id"]: list(d.get("manual_keys") or []) + LAB_DEFAULT_KEYS.get(d["id"], []) for d in LAB_DOCS}, ensure_ascii=False) +
    '. Rispondi SOLO JSON: {"doc_type":"<id>", "confidence":0-1, "data":{<chiave>:<valore stringa>}}. Se illeggibile o tipo non previsto: {"doc_type":"unknown","data":{}}. Non inventare.'
)


def _lab_norm(v: Any) -> str:
    s = re.sub(r"\s+", " ", str(v or "")).strip().lower()
    s = re.sub(r"[.,;:/\-()']", "", s)
    return s.replace(" ", "") if len(s) < 40 else s


async def _lab_extract_any(name: str, mime: str, data_base64: str) -> dict:
    """Riconosce il tipo di documento ed estrae i dati standard in una sola chiamata LLM."""
    raw = base64.b64decode(data_base64.split(",", 1)[-1])
    if len(raw) > LAB_UPLOAD_MAX:
        return {"name": name, "doc_type": "unknown", "data": {}, "error": "file troppo grande"}
    images: List[str] = []
    text = ""
    if mime == "application/pdf" or name.lower().endswith(".pdf"):
        try:
            from pypdf import PdfReader
            text = "\n".join((pg.extract_text() or "") for pg in PdfReader(io.BytesIO(raw)).pages[:6])
        except Exception:  # noqa: BLE001
            text = ""
        if len(text.strip()) < 200:
            images = [pg["png_b64"] for pg in await run_in_threadpool(_ft_render_pages, raw, 110)][:4]
    else:
        images = [base64.b64encode(raw).decode()]
    try:
        data = await _ft_llm(CRT_DOC_SYSTEM, LAB_CLASSIFY_PROMPT + f"\n\nNOME FILE: {name}" + ("\n\nTESTO DEL DOCUMENTO:\n" + text[:20000] if text.strip() else ""), images or None, session="lab-test")
    except Exception as exc:  # noqa: BLE001
        return {"name": name, "doc_type": "unknown", "data": {}, "error": str(exc)[:160]}
    dt = str(data.get("doc_type") or "unknown")
    if dt not in LAB_DOC_BY_ID:
        dt = "unknown"
    vals = {k: (str(v) if not isinstance(v, (list, dict)) else _json_stdlib.dumps(v, ensure_ascii=False)) for k, v in (data.get("data") or {}).items() if v not in (None, "", [])}
    if vals.get("iban"):
        vals["iban"] = re.sub(r"\s+", "", vals["iban"]).upper()
    if vals.get("pod"):
        vals["pod"] = re.sub(r"\s+", "", vals["pod"]).upper()
    return {"name": name[:120], "doc_type": dt, "confidence": data.get("confidence"), "data": vals}


def _lab_compare(results: List[dict], profiles: List[dict]) -> dict:
    """Tabella campo per campo: valore atteso (confermato per cliente tipo) vs estratto dal test."""
    rows: List[dict] = []
    for spec in LAB_DOCS:
        keys = list(dict.fromkeys(list(spec.get("manual_keys") or []) + LAB_DEFAULT_KEYS.get(spec["id"], [])))
        for k in keys:
            if k.endswith("_uncertain") or k == "iban_valid":
                continue
            expected: Dict[str, str] = {}
            for p in profiles:
                e = (p.get("docs") or {}).get(spec["id"]) or {}
                v = (e.get("values") or {}).get(k) if e.get("status") == "confirmed" else None
                if v:
                    expected[p["profile_id"]] = v
            found = [(r["name"], r["data"][k]) for r in results if r["doc_type"] == spec["id"] and r["data"].get(k)]
            if not expected and not found:
                continue
            distinct = list(dict.fromkeys(_lab_norm(v) for _, v in found))
            exp_norm = set(_lab_norm(v) for v in expected.values())
            if len(distinct) > 1:
                status = "conflict"
            elif not found:
                status = "not_found"
            elif not expected:
                status = "new"
            elif distinct[0] in exp_norm:
                status = "ok"
            else:
                status = "mismatch"
            rows.append({"field": f"{spec['id']}.{k}", "doc": spec["id"], "doc_label": spec["label"], "key": k, "label": LAB_KEY_LABELS.get(k, k),
                         "expected": expected, "expected_disagree": len(exp_norm) > 1, "extracted": [{"file": f, "value": v} for f, v in found], "status": status})
    summary = {s: sum(1 for r in rows if r["status"] == s) for s in ("ok", "mismatch", "not_found", "conflict", "new")}
    summary["total"] = len(rows)
    summary["profiles_disagree"] = sum(1 for r in rows if r["expected_disagree"])
    return {"rows": rows, "summary": summary}


class LabTestFile(BaseModel):
    name: str
    mime: str = "application/pdf"
    data_base64: str


class LabTestIn(BaseModel):
    files: List[LabTestFile] = Field(min_length=1, max_length=LAB_TEST_MAX_FILES)
    profile: Optional[str] = None  # <profile_id> | "all" | None (= primo)


@api_router.post("/lab/training/test-extract")
async def lab_test_extract(body: LabTestIn, user=Depends(get_current_user)):
    await _lab_require_train(user)
    tid = tenant_id(user)
    rows = await _lab_profiles(tid)
    profiles = rows if body.profile == "all" else [await _lab_training_profile(tid, body.profile)]
    results = list(await asyncio.gather(*[_lab_extract_any(f.name, f.mime, f.data_base64) for f in body.files]))
    cmp = _lab_compare(results, profiles)
    out = {"at": utcnow(), "mode": "all" if body.profile == "all" else "single", "profile_ids": [p["profile_id"] for p in profiles],
           "profile_names": {p["profile_id"]: p.get("name") or p["profile_id"] for p in profiles},
           "files": [{k: v for k, v in r.items() if k != "data"} for r in results], "unknown_files": [r["name"] for r in results if r["doc_type"] == "unknown"], **cmp}
    if body.profile != "all":
        await db.axon_lab_training.update_one({"tenant_id": tid, "profile_id": profiles[0]["profile_id"]}, {"$set": {"last_test": out}})
    else:
        await db.axon_lab_settings.update_one({"tenant_id": tid}, {"$set": {"tenant_id": tid, "last_test_all": out}}, upsert=True)
    return out


@api_router.get("/lab/training/test-extract")
async def lab_test_extract_last(profile: Optional[str] = None, user=Depends(get_current_user)):
    await _lab_require_train(user)
    tid = tenant_id(user)
    if profile == "all":
        s = await db.axon_lab_settings.find_one({"tenant_id": tid}, {"_id": 0, "last_test_all": 1}) or {}
        return {"last_test": s.get("last_test_all")}
    t = await _lab_training_profile(tid, profile)
    return {"last_test": t.get("last_test")}


# ------------------------------------------------------------------ Fase 2 · esempi compilati multipli per modulo
class LabExampleIn(BaseModel):
    name: Optional[str] = Field(default=None, max_length=80)
    pdf_base64: str
    replace_id: Optional[str] = None  # sostituisce un esempio esistente


def _lab_examples_pub(t: dict) -> List[dict]:
    return [{"id": x["id"], "name": x.get("name"), "fields": len(x.get("fields") or []), "uploaded_at": x.get("uploaded_at")} for x in (t.get("lab_examples") or [])]


def _lab_combined_example_fields(examples: List[dict]) -> Optional[List[dict]]:
    """Unisce i campi rilevati su TUTTI gli esempi: stessa chiave → valori diversi concatenati «A | B» (così Axon impara la regola generale)."""
    if not examples:
        return None
    byk: Dict[str, dict] = {}
    for ex in examples:
        for f in ex.get("fields") or []:
            if not f.get("example_value"):
                continue
            k = f"{f.get('page', 0)}::{f.get('key') or f.get('label') or ''}"
            cur = byk.setdefault(k, {**f, "example_value": "", "_vals": []})
            v = str(f["example_value"])
            if v not in cur["_vals"]:
                cur["_vals"].append(v)
    out = []
    for f in byk.values():
        f["example_value"] = " | ".join(f.pop("_vals"))
        out.append(f)
    return out


async def _lab_repropose(t: dict, user: dict) -> dict:
    tid = tenant_id(user)
    sources = _lab_sources(await _lab_training(tid))
    ex_fields = _lab_combined_example_fields(t.get("lab_examples") or [])
    mapping, msrc = await _lab_propose_mapping(t.get("fields") or [], ex_fields, sources)
    upd = {"lab_mapping": mapping, "lab_mapping_source": msrc if not ex_fields else f"examples:{len(t.get('lab_examples') or [])}", "lab_has_example": bool(ex_fields), "updated_at": utcnow()}
    await db.form_templates.update_one({"template_id": t["template_id"]}, {"$set": upd})
    t = await db.form_templates.find_one({"template_id": t["template_id"]}, {"_id": 0, "pdf_b64": 0})
    out = _lab_module_pub(t)
    out["examples"] = _lab_examples_pub(t)
    out["sources"] = sources
    return out


async def _lab_module_for(template_id: str, user: dict) -> dict:
    t = await db.form_templates.find_one({"template_id": template_id, "tenant_id": tenant_id(user), "lab": True}, {"_id": 0, "pdf_b64": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Modulo non trovato")
    return t


@api_router.post("/lab/modules/{template_id}/examples")
async def lab_module_example_add(template_id: str, body: LabExampleIn, user=Depends(get_current_user)):
    await _lab_require_train(user)
    t = await _lab_module_for(template_id, user)
    if not body.pdf_base64 or len(body.pdf_base64) > FT_MAX_PDF_B64:
        raise HTTPException(status_code=400, detail="PDF mancante o troppo grande (max ~15 MB)")
    raw = _ft_b64_to_bytes(body.pdf_base64)
    try:
        ex_fields, _ = await _ft_detect_fields(raw, True)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Esempio compilato non leggibile: {str(exc)[:120]}")
    if not any(f.get("example_value") for f in ex_fields):
        raise HTTPException(status_code=422, detail="Nell'esempio non ho trovato valori compilati: carica un modulo davvero compilato")
    examples = [x for x in (t.get("lab_examples") or []) if x["id"] != body.replace_id]
    if len(examples) >= 12:
        raise HTTPException(status_code=400, detail="Massimo 12 esempi per modulo")
    ex_id = body.replace_id or f"ex_{uuid.uuid4().hex[:8]}"
    meta = await _ft_store_pdf(tenant_id(user), "lab_example", f"{template_id}_{ex_id}", raw)
    examples.append({"id": ex_id, "name": (body.name or "").strip()[:80] or f"Esempio {len(examples) + 1}", "fields": ex_fields, "uploaded_at": utcnow(), **{k: v for k, v in meta.items() if k != "pdf_b64"}})
    t["lab_examples"] = examples
    await db.form_templates.update_one({"template_id": template_id}, {"$set": {"lab_examples": examples}})
    return await _lab_repropose(t, user)


@api_router.delete("/lab/modules/{template_id}/examples/{ex_id}")
async def lab_module_example_del(template_id: str, ex_id: str, user=Depends(get_current_user)):
    await _lab_require_train(user)
    t = await _lab_module_for(template_id, user)
    examples = [x for x in (t.get("lab_examples") or []) if x["id"] != ex_id]
    if len(examples) == len(t.get("lab_examples") or []):
        raise HTTPException(status_code=404, detail="Esempio non trovato")
    t["lab_examples"] = examples
    await db.form_templates.update_one({"template_id": template_id}, {"$set": {"lab_examples": examples}})
    return await _lab_repropose(t, user)


@api_router.post("/lab/modules/{template_id}/examples/repropose")
async def lab_module_example_repropose(template_id: str, user=Depends(get_current_user)):
    await _lab_require_train(user)
    return await _lab_repropose(await _lab_module_for(template_id, user), user)


# GET /lab/modules/{id} espone anche la lista esempi (avvolge la route esistente senza ridefinirla)
_lab_module_pub_base = _lab_module_pub


def _lab_module_pub(t: dict, with_fields: bool = True) -> dict:  # noqa: F811
    out = _lab_module_pub_base(t, with_fields)
    out["examples"] = _lab_examples_pub(t)
    out["examples_count"] = len(t.get("lab_examples") or [])
    return out

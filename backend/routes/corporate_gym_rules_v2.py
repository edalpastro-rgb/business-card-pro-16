# corporate_gym_rules_v2.py — V50.z396 — MODIFICHE 4·5·6·7·8 della Gym (modulo ISOLATO, caricato dopo corporate_gym*.py e cgym_areas.py)
#
# MOD 4  Ruolo CLIENTE corretto (WIN-WIN e role-play): il cliente è nel SUO ufficio, aspetta, apre con «Prego, si accomodi» /
#        «Mi dica»; risponde alle domande del consulente senza anticiparle; racconta famiglia/settore/anni se richiesto; passa al tu
#        se proposto; resistenze e prezzo emergono DURANTE la trattativa, mai all'inizio; segue il manuale WIN-WIN in archivio.
# MOD 5  WIN-WIN «Trattativa a Blocchi»: 8 blocchi RIGIDI guidati da Axon (Telefonata → Rapport → Chi sono → Analisi 1° livello →
#        Mercato energia → K-meno → Patto di squadra → Chiusura). Avanzamento SOLO per completamento valutato (non per tempo).
# MOD 6  Trattativa ANT (aree cgym_areas): Axon NON è un cliente ma l'ESAMINATORE TECNICO; il consulente spiega l'ANT blocco per
#        blocco; Axon usa TUTTO il materiale ANT dell'area (testo estratto dai materiali) e a fine blocco dà feedback preciso
#        (detto bene / manca / errato).
# MOD 7  Obiezioni custom del Master: campo `model_answer` (risposta modello) usato SOLO nella valutazione, nascosto ai consulenti
#        (vedi corporate_gym_config.py) — qui viene iniettato nel prompt di valutazione.
# MOD 8  Manuale Obiezioni: knowledge base ESCLUSIVA = testo del PDF Drive collegato alla Gym Obiezioni dalla PAGINA 13 in poi
#        (collection cgym_manual_kb). Il PDF su Drive non viene toccato.
import asyncio as _r2_asyncio
import contextvars as _r2_cv
_R2_WW_BLOCK: _r2_cv.ContextVar = _r2_cv.ContextVar("r2_ww_block", default=None)
_R2_ANT_MATERIALS: _r2_cv.ContextVar = _r2_cv.ContextVar("r2_ant_materials", default=None)
from typing import Any, Dict, List, Optional

CGYM_OBI_KB_FROM_PAGE = 13

# ── MOD 5: 8 blocchi rigidi WIN-WIN ──────────────────────────────────────────────────────────────────────────────
CGYM_WW_BLOCKS: List[Dict[str, str]] = [
    {"id": "telefonata", "name": "1 · Telefonata di presa appuntamento", "consultant": "Il consulente legge/recita lo SCRIPT TELEFONATA in archivio per fissare l'appuntamento.",
     "client": "Sei al TELEFONO nel tuo ufficio: rispondi «Pronto?», ascolti, fai al massimo una domanda di chiarimento, accetti l'appuntamento solo se tono e parole sono corretti e rispettosi del tuo tempo.",
     "done_when": "Il consulente si è presentato, ha spiegato in una frase il motivo, ha proposto giorno e ora e ha confermato l'appuntamento."},
    {"id": "rapport", "name": "2 · Rapport", "consultant": "Il consulente entra in ufficio, si presenta, chiede il nome e crea il clima.",
     "client": "Sei nel tuo ufficio, lo accogli con «Prego, si accomodi» / «Mi dica». Rispondi alle sue domande; se chiede dell'azienda racconti famiglia, settore, anni di attività. Se propone il tu, accetti.",
     "done_when": "Presentazione reciproca fatta, il consulente conosce il tuo nome e qualcosa dell'azienda, clima cordiale."},
    {"id": "chi_sono", "name": "3 · Chi sono", "consultant": "Il consulente spiega chi è, di cosa si occupa e perché è lì, come da manuale WIN-WIN.",
     "client": "Ascolti, fai al massimo una domanda di curiosità («E in cosa consiste, in pratica?»). Nessuna obiezione sul prezzo qui.",
     "done_when": "Il consulente ha detto chi è, di cosa si occupa e il motivo della visita in modo chiaro e coerente col manuale."},
    {"id": "analisi", "name": "4 · Analisi primo livello", "consultant": "Il consulente chiede le fatture e simula la lettura dei dati.",
     "client": "Consegni le fatture e fornisci i DATI del tuo scenario (fornitore attuale, spesa mensile/annua, potenza, consumi) in modo coerente e realistico quando li chiede.",
     "done_when": "Il consulente ha chiesto le fatture, letto/riepilogato i dati principali (fornitore, spesa, consumi, potenza) e li ha confermati con te."},
    {"id": "mercato", "name": "5 · Spiegazione mercato energia", "consultant": "Il consulente spiega come funziona il mercato dell'energia.",
     "client": "Ascolti da imprenditore pratico: una o due domande semplici («E a me cosa cambia?»). Qui possono nascere le prime PERPLESSITÀ, non richieste di sconto.",
     "done_when": "Il consulente ha spiegato in modo semplice e corretto il funzionamento del mercato (produzione, rete, vendita, componenti in bolletta) e tu hai capito."},
    {"id": "kmeno", "name": "6 · K-meno", "consultant": "Il consulente mostra cosa c'è di sbagliato nella fattura attuale (K-meno).",
     "client": "Reagisci con sorpresa o scetticismo realistico; qui emergono le RESISTENZE («il mio fornitore mi ha detto che…», «e se cambio poi…») e le prime domande sul prezzo.",
     "done_when": "Il consulente ha indicato con numeri concreti cosa non va nella fattura attuale e tu hai riconosciuto il problema."},
    {"id": "patto", "name": "7 · Patto di squadra", "consultant": "Il consulente propone la soluzione come patto di squadra.",
     "client": "Valuti la proposta: chiedi garanzie, tempi, cosa succede se qualcosa va storto. Richieste sul prezzo solo se il consulente non ha dato valore.",
     "done_when": "Il consulente ha proposto la soluzione come collaborazione (ruoli, garanzie, prossimi passi) e tu la trovi credibile."},
    {"id": "chiusura", "name": "8 · Chiusura e invito all'azione", "consultant": "Il consulente chiude e lancia l'invito all'azione.",
     "client": "Se tutto è stato fatto bene, accetti e chiedi i prossimi passi pratici; altrimenti rimandi con un motivo preciso.",
     "done_when": "Il consulente ha riassunto, ha lanciato un invito all'azione chiaro con un passo concreto (firma/documenti/data) e tu hai risposto."},
]

CGYM_CLIENT_RULES_V2 = (
    "COMPORTAMENTO DEL CLIENTE (REGOLE ASSOLUTE — V2):\n"
    "- Sei nel TUO ufficio (o al tuo telefono): NON stai cercando il consulente, è lui che è venuto da te. All'inizio APRI SOLO con «Prego, si accomodi» "
    "o «Mi dica» (al telefono: «Pronto?»). MAI elencare i tuoi bisogni spontaneamente, MAI aprire con richieste sul prezzo o sullo sconto.\n"
    "- Rispondi alle domande del consulente, NON le anticipi. Se chiede dell'azienda racconti: famiglia, settore, anni di attività. Se propone il tu, passi al tu.\n"
    "- Le resistenze e le richieste sul prezzo emergono NATURALMENTE più avanti nella trattativa (dal blocco K-meno in poi), mai nei primi blocchi.\n"
    "- Segui fedelmente il MANUALE WIN-WIN in archivio (se presente sotto) per reazioni e obiezioni. Battute brevi e realistiche (max 3 frasi)."
)


def _r2_block_prompt(idx: int) -> str:
    b = CGYM_WW_BLOCKS[max(0, min(idx, len(CGYM_WW_BLOCKS) - 1))]
    return (f"\nBLOCCO ATTUALE {idx + 1}/8 — {b['name']}. Cosa fa il consulente: {b['consultant']} Cosa fai tu (cliente): {b['client']} "
            f"Il blocco è COMPLETATO quando: {b['done_when']}\n"
            "Nel JSON aggiungi anche: \"block_done\": true|false (il consulente ha completato il blocco attuale?), "
            "\"block_feedback\": \"1 frase per il consulente: cosa ha fatto bene e cosa manca nel blocco\".")


# ── MOD 8: KB Obiezioni dalla pagina 13 ───────────────────────────────────────────────────────────────────────────
def _r2_pdf_text_from_page(raw: bytes, from_page: int) -> str:
    import fitz  # PyMuPDF
    out: List[str] = []
    with fitz.open(stream=raw, filetype="pdf") as doc:
        for i in range(max(0, from_page - 1), doc.page_count):
            t = doc[i].get_text("text") or ""
            if t.strip():
                out.append(f"[pag. {i + 1}]\n{t.strip()}")
    return "\n\n".join(out)


async def cgym_obi_kb_index(tid: str, force: bool = False) -> Optional[dict]:
    """Scarica il PDF Drive collegato alla Gym Obiezioni e indicizza SOLO le pagine ≥ 13 in cgym_manual_kb (cache per file/modifiedTime)."""
    cfg = await db.cgym_manuals_config.find_one({"tenant_id": tid}, {"_id": 0}) or {}  # noqa: F821
    link = (_cgym_man_links(cfg) or {}).get("obiezioni")  # noqa: F821
    if not link:
        return None
    service = await _cgym_man_service(tid)  # noqa: F821
    meta = await _r2_asyncio.to_thread(_cgym_man_get_sync, service, link["id"])  # noqa: F821
    files = [meta]
    if meta.get("mimeType") == _CGYM_MAN_FOLDER:  # noqa: F821
        files = [f for f in await _r2_asyncio.to_thread(_cgym_man_list_sync, service, link["id"], False, None, True) if "pdf" in (f.get("mimeType") or "")]  # noqa: F821
    files = [f for f in files if "pdf" in (f.get("mimeType") or "")]
    if not files:
        return None
    sig = "|".join(f"{f.get('id')}@{f.get('modifiedTime')}" for f in files)
    cur = await db.cgym_manual_kb.find_one({"tenant_id": tid, "type": "obiezioni"}, {"_id": 0})  # noqa: F821
    if cur and cur.get("signature") == sig and not force:
        return cur
    texts: List[str] = []
    for f in files[:5]:
        try:
            raw, _m, _n = await _r2_asyncio.to_thread(_cgym_man_download_sync, service, f)  # noqa: F821
            t = await _r2_asyncio.to_thread(_r2_pdf_text_from_page, raw, CGYM_OBI_KB_FROM_PAGE)
            if t:
                texts.append(f"### {f.get('name')}\n{t}")
        except Exception as exc:  # noqa: BLE001
            logger.warning("[cgym-obi-kb] %s: %s", f.get("name"), str(exc)[:160])  # noqa: F821
    doc = {"tenant_id": tid, "type": "obiezioni", "from_page": CGYM_OBI_KB_FROM_PAGE, "signature": sig, "files": [{"id": f.get("id"), "name": f.get("name")} for f in files],
           "text": "\n\n".join(texts)[:200000], "chars": sum(len(t) for t in texts), "updated_at": utcnow()}  # noqa: F821
    await db.cgym_manual_kb.update_one({"tenant_id": tid, "type": "obiezioni"}, {"$set": doc}, upsert=True)  # noqa: F821
    return doc


async def _r2_obi_kb_text(tid: str, limit: int = 9000) -> str:
    cur = await db.cgym_manual_kb.find_one({"tenant_id": tid, "type": "obiezioni"}, {"_id": 0, "text": 1, "updated_at": 1})  # noqa: F821
    stale = not cur or not cur.get("text") or (utcnow() - cur["updated_at"]).total_seconds() > 600 if cur and cur.get("updated_at") else True  # noqa: F821
    if stale:
        try:
            cur = await cgym_obi_kb_index(tid)
        except Exception as exc:  # noqa: BLE001
            logger.warning("[cgym-obi-kb] index skip: %s", str(exc)[:160])  # noqa: F821
            cur = None
    t = (cur or {}).get("text") or ""
    return f"\n\nMANUALE OBIEZIONI (KNOWLEDGE BASE ESCLUSIVA — solo da pag. {CGYM_OBI_KB_FROM_PAGE} in poi; usa SOLO questo):\n{t[:limit]}" if t else ""


@api_router.post("/cgym/manuals/obiezioni/reindex")  # noqa: F821
async def cgym_obi_kb_reindex(user=Depends(get_current_user)):  # noqa: F821
    if not is_owner(user):  # noqa: F821
        raise HTTPException(status_code=403, detail="Solo il Master")  # noqa: F821
    doc = await cgym_obi_kb_index(tenant_id(user), force=True)  # noqa: F821
    if not doc:
        raise HTTPException(status_code=404, detail="Nessun PDF collegato alla Gym Obiezioni")  # noqa: F821
    return {"ok": True, "files": doc["files"], "from_page": doc["from_page"], "chars": doc["chars"]}


async def _r2_ww_manual_text(tid: str, limit: int = 6000) -> str:
    """Manuale WIN-WIN in archivio (Master Files) → il cliente lo segue fedelmente."""
    try:
        doc = await db.master_files.find_one({"tenant_id": tid, "name": {"$regex": "win[\\s-]*win", "$options": "i"}}, {"extracted_text": 1, "text": 1, "summary": 1, "name": 1})  # noqa: F821
        if doc:
            t = doc.get("extracted_text") or doc.get("text") or doc.get("summary") or ""
            if t:
                return f"\n\nMANUALE WIN-WIN «{doc.get('name')}» (seguilo fedelmente):\n{str(t)[:limit]}"
    except Exception:  # noqa: BLE001
        pass
    return ""


# ── MOD 4 + 5: motore role-play (wrap di _cgym_customer_turn) ────────────────────────────────────────────────────
_r2_prev_customer_turn = _cgym_customer_turn  # noqa: F821


async def _cgym_customer_turn(rp: dict, turn_no: int) -> dict:  # noqa: F811
    sc = await _cgym_scenario_for(rp["tenant_id"], rp["scenario"])  # noqa: F821
    max_turns = sc.get("max_turns", CGYM_RP_MAX_TURNS)  # noqa: F821
    is_ww = sc["area"] == "winwin"
    bi = int(rp.get("block_idx") or 0)
    if is_ww:
        _R2_WW_BLOCK.set(CGYM_WW_BLOCKS[min(bi, 7)]["name"])
        rules = CGYM_CLIENT_RULES_V2 + _r2_block_prompt(bi) + await _r2_ww_manual_text(rp["tenant_id"])
        channel, max_sentences = ("telefonata" if CGYM_WW_BLOCKS[bi]["id"] == "telefonata" else "incontro nel tuo ufficio"), 3
    else:
        rules = CGYM_OBJ_RULES.format(max_turns=max_turns) + "\n" + CGYM_CLIENT_RULES_V2 + await _r2_obi_kb_text(rp["tenant_id"], 5000)  # noqa: F821
        channel, max_sentences = "telefonata", 2
    system = CGYM_RP_TURN_SYSTEM.format(persona=sc["persona"], rules=rules, channel=channel, max_sentences=max_sentences, max_turns=max_turns, turn=turn_no)  # noqa: F821
    if turn_no == 0:
        user_text = ("Il consulente sta per iniziare. Apri SOLO con la battuta di accoglienza del cliente («Pronto?» se sei al telefono, altrimenti «Prego, si accomodi» / «Mi dica»): "
                     "nessun bisogno, nessuna richiesta, nessuna obiezione ora." if is_ww else
                     f"{sc['opening_hint']}\nApri tu la conversazione con la tua obiezione (il consulente ha appena finito di presentarsi e proporre l'incontro).")
    else:
        user_text = f"TRASCRIZIONE FINORA:\n{_cgym_transcript_text(rp['turns'])}\n\nRispondi come il cliente all'ultima battuta del consulente."  # noqa: F821
    raw = await _cgym_llm(system, user_text, "claude-haiku-4-5")  # noqa: F821
    data = _cgym_llm_json(raw)  # noqa: F821
    data = data if isinstance(data, dict) else {}
    reply = (data.get("reply") or "").strip() or (raw[:300] if raw else ("Prego, si accomodi." if is_ww else "Guardi, adesso non ho tempo."))
    mood = data.get("mood")
    end = bool(data.get("end"))
    out: Dict[str, Any] = {"reply": reply, "mood": mood if mood in ("chiuso", "scettico", "aperto", "convinto") else "scettico", "end": end}
    if is_ww:
        # MOD 5 — avanzamento SOLO per completamento valutato del blocco (mai per tempo). Ultimo blocco completato → fine.
        done = bool(data.get("block_done")) and turn_no > 0
        out["block_idx"] = bi; out["block_name"] = CGYM_WW_BLOCKS[bi]["name"]; out["block_done"] = done; out["block_feedback"] = (data.get("block_feedback") or "").strip()[:300]
        if done and bi + 1 < len(CGYM_WW_BLOCKS):
            out["block_idx"] = bi + 1; out["block_name"] = CGYM_WW_BLOCKS[bi + 1]["name"]
            out["reply"] = f"{reply} — [AXON] Blocco «{CGYM_WW_BLOCKS[bi]['name']}» completato. {out['block_feedback']} Passiamo a «{CGYM_WW_BLOCKS[bi + 1]['name']}»."
            await db.cgym_roleplays.update_one({"roleplay_id": rp["roleplay_id"]}, {"$set": {"block_idx": bi + 1}, "$push": {"block_log": {"block": CGYM_WW_BLOCKS[bi]["name"], "feedback": out["block_feedback"], "turn": turn_no, "at": utcnow()}}})  # noqa: F821
            rp["block_idx"] = bi + 1; _R2_WW_BLOCK.set(CGYM_WW_BLOCKS[bi + 1]["name"])
            out["end"] = False
        elif done:
            out["reply"] = f"{reply} — [AXON] Blocco 8 completato: trattativa conclusa. {out['block_feedback']}"
            out["end"] = True
        elif turn_no < max_turns:
            out["end"] = False   # non si chiude finché gli 8 blocchi non sono completati (o max_turns)
    if turn_no >= max_turns:
        out["end"] = True
    return out


# /turn e /start espongono «phase»: con i blocchi rigidi = nome del blocco attuale (non più derivato dal tempo)
_r2_prev_ww_phase = _cgym_ww_phase  # noqa: F821


def _cgym_ww_phase(elapsed_min: float, phases=None) -> str:  # noqa: F811
    cur = _R2_WW_BLOCK.get()
    return cur or CGYM_WW_BLOCKS[0]["name"]


# ── MOD 7 + 8: valutazione finale con risposta modello e KB Obiezioni ────────────────────────────────────────────
_r2_prev_scenario_for = _cgym_scenario_for  # noqa: F821


async def _cgym_scenario_for(tid: str, key: str) -> dict:  # noqa: F811
    """Arricchisce `eval_criteria` (usato SOLO nel prompt di valutazione) con la RISPOSTA MODELLO del Master e con la KB Obiezioni."""
    sc = dict(await _r2_prev_scenario_for(tid, key))
    if sc.get("area") == "winwin":
        sc["phases"] = [(float(i + 1), b["name"]) for i, b in enumerate(CGYM_WW_BLOCKS)]  # MOD 5: 8 blocchi rigidi (l'ordine, non i minuti)
    if sc.get("model_answer"):
        sc["eval_criteria"] = (sc.get("eval_criteria") or "") + (f"\nRISPOSTA MODELLO del Master (riferimento per il punteggio: quanto il consulente si avvicina a questa risposta?): «{sc['model_answer']}»")
    if sc.get("area") == "obiezioni":
        kb = await _r2_obi_kb_text(tid, 4000)
        if kb:
            sc["eval_criteria"] = (sc.get("eval_criteria") or "") + kb
    return sc


# ── MOD 6: Trattativa ANT → Axon ESAMINATORE TECNICO ─────────────────────────────────────────────────────────────
# _cga_area (async) è la prima chiamata di /cgym/live/start e /turn: se l'area è ANT precarica il materiale nel contextvar;
# _cga_client_system (sync, chiamata subito dopo) legge il contextvar e restituisce il prompt da ESAMINATORE.
_r2_prev_cga_area = _cga_area  # noqa: F821


async def _cga_area(tid: str, area_id: str) -> dict:  # noqa: F811
    area = await _r2_prev_cga_area(tid, area_id)
    try:
        _R2_ANT_MATERIALS.set(await _cga_materials_text(tid, area_id) if _r2_is_ant(area) else None)
    except Exception:  # noqa: BLE001
        _R2_ANT_MATERIALS.set("" if _r2_is_ant(area) else None)
    return area


_r2_prev_client_system = _cga_client_system  # noqa: F821


def _cga_client_system(area: dict, block: str, level: str = "base") -> str:  # noqa: F811
    mats = _R2_ANT_MATERIALS.get()
    if mats is None or not _r2_is_ant(area):
        return _r2_prev_client_system(area, block, level)
    return _cga_examiner_system(area, block, level, mats)


def _r2_is_ant(area: dict) -> bool:
    n = (area.get("name") or "").lower()
    return "ant" in n.split() or "ant" in n.replace("-", " ").split() or n.startswith("ant") or "trattativa ant" in n or bool(area.get("is_ant"))


async def _cga_materials_text(tid: str, area_id: str, limit: int = 12000) -> str:
    rows = await db.cgym_area_materials.find({"tenant_id": tid, "area_id": area_id}, {"_id": 0, "material_id": 1, "name": 1, "mime": 1, "extracted_text": 1, "storage_path": 1, "data_base64": 1}).to_list(50)  # noqa: F821
    for r in rows:   # estrazione pigra (una volta) per i materiali senza testo indicizzato
        if r.get("extracted_text") is None:
            try:
                raw, mime = await _cga_blob(r)  # noqa: F821
                txt = (await _r2_asyncio.to_thread(_r2_extract_text, raw, mime, r.get("name") or "")).strip()[:60000]
            except Exception:  # noqa: BLE001
                txt = ""
            r["extracted_text"] = txt
            await db.cgym_area_materials.update_one({"material_id": r["material_id"]}, {"$set": {"extracted_text": txt}})  # noqa: F821
    parts = [f"### {r.get('name')}\n{r['extracted_text']}" for r in rows if r.get("extracted_text")]
    return ("\n\nMATERIALE ANT IN ARCHIVIO (riferimento tecnico ESCLUSIVO):\n" + "\n\n".join(parts))[:limit] if parts else ""


def _cga_examiner_system(area: dict, block: str, level: str, materials: str) -> str:
    return (f"Sei AXON, ESAMINATORE TECNICO (come un ingegnere/tecnico esterno esperto). NON interpreti nessun cliente. Il consulente ti sta SPIEGANDO "
            f"il sistema ANT, area «{area['name']}», blocco in corso: «{block}». Tu ascolti, fai al massimo UNA domanda tecnica di approfondimento se serve, "
            "e VALUTI: terminologia corretta, concetti completi, nessun errore tecnico — SOLO sulla base del materiale ANT in archivio (sotto). "
            "Restituisci SOLO JSON: {\"reply\": \"tua battuta da esaminatore (breve; se il blocco è completo dai il feedback preciso: cosa è stato detto bene, cosa manca, cosa è sbagliato)\", "
            "\"tone\": \"green|blue|red\", \"tone_segments\": [{\"tone\": \"green|blue|red\", \"pct\": 0-100}], \"hesitation\": true|false, \"hesitation_reason\": \"...\", "
            "\"block_done\": true|false, \"hint\": \"consiglio breve\", \"distacco\": 0-100, "
            "\"issues\": [{\"tipo\": \"dati|tema|filo_logico|imprecisione|tono|obiezione|invito|distacco\", \"gravita\": \"grave|media|lieve\", \"correzione\": \"cosa dire invece\"}], "
            "\"block_feedback\": {\"detto_bene\": [\"...\"], \"manca\": [\"...\"], \"errato\": [\"...\"]}}. "
            "block_done = true SOLO se la spiegazione del blocco è completa e corretta secondo il materiale. Errori tecnici = gravita grave (tipo dati/tema). "
            "TONE: green = spiegazione chiara e sicura, blue = corretta ma incompleta/tecnica, red = confusa o con errori. DISTACCO (0-100) = sicurezza e professionalità (≥70 corretto). "
            f"Livello: {CGA_LEVELS.get(level, CGA_LEVELS['base'])}" + materials)  # noqa: F821


def _r2_extract_text(raw: bytes, mime: str, name: str) -> str:
    m = (mime or "").lower(); n = (name or "").lower()
    try:
        if "pdf" in m or n.endswith(".pdf"):
            import fitz
            with fitz.open(stream=raw, filetype="pdf") as doc:
                return "\n".join((doc[i].get_text("text") or "") for i in range(doc.page_count))
        if n.endswith((".txt", ".md", ".csv")) or m.startswith("text/"):
            return raw.decode("utf-8", errors="ignore")
        if n.endswith(".docx"):
            import zipfile, re as _re
            from io import BytesIO
            with zipfile.ZipFile(BytesIO(raw)) as z:
                xml = z.read("word/document.xml").decode("utf-8", errors="ignore")
            return _re.sub(r"<[^>]+>", " ", xml.replace("</w:p>", "\n"))
    except Exception as exc:  # noqa: BLE001
        logger.warning("[cga-material] estrazione testo fallita %s: %s", name, str(exc)[:120])  # noqa: F821
    return ""


@api_router.post("/cgym/areas/{area_id}/materials/reindex")  # noqa: F821
async def cga_materials_reindex(area_id: str, user=Depends(get_current_user)):  # noqa: F821
    """Master: (ri)estrae il testo dei materiali già caricati (per quelli caricati prima della V50.z396)."""
    _cga_master(user); tid = tenant_id(user)  # noqa: F821
    n = 0
    async for m in db.cgym_area_materials.find({"tenant_id": tid, "area_id": area_id}, {"_id": 0}):  # noqa: F821
        try:
            raw, mime = await _cga_blob(m)  # noqa: F821
            txt = await _r2_asyncio.to_thread(_r2_extract_text, raw, mime, m.get("name") or "")
            if txt.strip():
                await db.cgym_area_materials.update_one({"material_id": m["material_id"]}, {"$set": {"extracted_text": txt.strip()[:60000]}}); n += 1  # noqa: F821
        except Exception as exc:  # noqa: BLE001
            logger.warning("[cga-material] reindex %s: %s", m.get("name"), str(exc)[:120])  # noqa: F821
    return {"ok": True, "indexed": n}

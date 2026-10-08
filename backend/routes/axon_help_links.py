# axon_help_links.py — V50.z469 — Feature 12/15: Axon ↔ Libretto istruzioni — modulo ISOLATO
#
# Caricato DOPO axon_navigator.py e axon_crm_omniscience.py. Obiettivo: Axon conosce TUTTE le pagine del Libretto (sezioni storiche
# da `axon_app_map.json` + sezioni nuove V50.z456–z466) e può portare l'utente alla pagina giusta con un chip
# `[[NAV:/libretto?section=<id>|📖 Guida: <titolo>]]` (la schermata /libretto scorre alla sezione ed evidenzia la card).
# 1) APP_MAP (Navigatore) esteso con una voce per sezione (`libretto_<id>`, gruppo «Guida», keyword dal titolo/testo).
# 2) Prompt: per domande «come si fa / dove trovo / aiuto / istruzioni» → elenco compatto id → titolo + istruzione di aggiungere il chip.
# 3) Deterministico (zero LLM): «apri il libretto/manuale/guida [su X]» → risposta + chip alla sezione più pertinente.
# 4) `GET /libretto/index` → indice (id, titolo, sottotitolo, route) per app/diagnostica.

import json as _hl_json
import logging as _hl_logging
import os as _hl_os

_hl_log = _hl_logging.getLogger("server")

_HL_EXTRA = [
    ("storico-pun", "Storico PUN", "Widget PUN della Home cliccabile → tabella ultimi 18 mesi (monorario, F1, F2, F3 in €/kWh), mese corrente parziale, PDF scaricabile/condivisibile.", ["pun", "storico pun", "prezzo energia", "fasce", "f1", "f2", "f3", "pdf pun"]),
    ("indirizzi-google", "Indirizzi con Google", "Campo «Cerca indirizzo» (Google Places) in Nuovo contatto, Nuovo appuntamento e Anagrafica Master: compila via, civico, CAP, città, provincia.", ["indirizzo", "indirizzi", "autocompletamento", "google places", "via", "cap", "città"]),
    ("trascrizione-chiamate", "Trascrizione chiamate", "Scheda contatto › Chiamate: carica/registra una chiamata, Axon trascrive, estrae riepilogo, budget e prossimi passi e li salva come nota.", ["trascrizione", "trascrivi", "chiamata registrata", "registrazione chiamata", "deepgram", "riepilogo chiamata"]),
    ("agente-autonomo", "Axon agente multi-step", "Un comando con più azioni («chiudi la trattativa, manda il preventivo e richiamalo tra 30 giorni») eseguito passo per passo con esito e domanda «Come procedo?».", ["multi-step", "agente", "più azioni", "concatena", "come procedo", "automazione"]),
    ("imprevisti", "Gestione imprevisti", "«Mi si è rotta la macchina»: Axon ricalcola l'agenda del giorno e prepara i messaggi ai clienti (email/WhatsApp), nulla parte senza «confermo».", ["imprevisto", "imprevisti", "emergenza", "ritardo", "macchina rotta", "ricalcola agenda", "avvisa i clienti"]),
    ("rubrica-telefono", "Rubrica del telefono", "Se un nome non è in AdvisorOS, Axon cerca nella rubrica del telefono (app mobile, permesso Contatti) e mostra il numero in chat; la rubrica resta sul dispositivo.", ["rubrica", "rubrica telefono", "contatti del telefono", "numero di", "permesso contatti"]),
    ("personalizza-axon", "Personalizza Axon", "Super Master: personalità e stile linguistico dell'assistente da Impostazioni › AI & Axon.", ["personalizza axon", "personalità", "stile", "tono", "carattere di axon"]),
    ("spazio-personale", "Spazio Personale (Super Master)", "Famiglia, case, contatti d'emergenza, documenti del Super Master: cifrati SOLO sul dispositivo, protetti da PIN/biometria, nessuna sincronizzazione; interruttore «Condividi con Axon».", ["spazio personale", "famiglia", "case", "contatti emergenza", "documenti personali", "pin", "biometria", "cifrato"]),
    ("sicurezza-upload", "Sicurezza dei file caricati", "Upload consentiti solo JPG/PNG/PDF (audio per trascrizioni) con limiti di dimensione; antivirus sul server prima del salvataggio.", ["antivirus", "file consentiti", "formati", "upload", "caricamento file", "sicurezza file", "virus"]),
]

_HL_INDEX: List[dict] = []


def _hl_tokens(*texts: str) -> List[str]:
    out, seen = [], set()
    for t in texts:
        for w in re.findall(r"[a-zà-ù0-9]{4,}", (t or "").lower()):
            if w not in _NAV_STOP and w not in seen:
                seen.add(w); out.append(w)
    return out[:14]


def _hl_build_index() -> None:
    try:
        with open(_hl_os.path.join(_ROUTES_DIR, "axon_app_map.json"), "r", encoding="utf-8") as fh:  # NB: __file__ qui è server.py (exec)
            for sec in _hl_json.load(fh):
                sid = sec.get("id")
                if not sid or sid in ("chiusura",):
                    continue
                title = re.sub(r"^\d+\s*·\s*", "", str(sec.get("title") or sid))
                desc = " ".join((sec.get("paragraphs") or [])[:1])[:220]
                _HL_INDEX.append({"id": sid, "title": title, "subtitle": sec.get("subtitle") or "", "desc": desc, "kw": _hl_tokens(title, sec.get("subtitle") or "")})
    except Exception as exc:  # noqa: BLE001
        _hl_log.warning("[help-links] app map load failed: %r", exc)
    for sid, title, desc, kw in _HL_EXTRA:
        _HL_INDEX.append({"id": sid, "title": title, "subtitle": "", "desc": desc, "kw": list(kw) + _hl_tokens(title)})
    for e in _HL_INDEX:
        e["route"] = f"/libretto?section={e['id']}"
        if f"libretto_{e['id']}" not in _NAV_BY_ID:
            entry = dict(id=f"libretto_{e['id']}", name=f"Guida: {e['title']}", route=e["route"], group="Guida", desc=f"Pagina del Libretto istruzioni «{e['title']}». {e['desc']}", kw=["libretto", "guida", "manuale", "istruzioni"] + list(e["kw"]))
            APP_MAP.append(entry); _NAV_BY_ID[entry["id"]] = entry
    for sid, title, desc, _kw in _HL_EXTRA:
        _OMNI_EXTRA_SECTIONS.append((f"Libretto · {title}", f"/libretto?section={sid}", desc))
    # Nuove SCHERMATE (non pagine del libretto) che il Navigatore deve conoscere con la route ESATTA
    for entry in (
        dict(id="storico_pun", name="Storico PUN", route="/pun-storico", group="Home", desc="Tabella PUN ultimi 18 mesi (monorario, F1, F2, F3 in €/kWh) con PDF scaricabile; si apre anche toccando il widget PUN della Home.", kw=["storico pun", "tabella pun", "pun 18 mesi", "pdf pun", "andamento pun"]),
        dict(id="spazio_personale_sm", name="Spazio Personale (Super Master)", route="/spazio-personale", group="Impostazioni", desc="Anagrafica personale cifrata solo sul dispositivo (famiglia, case, contatti d'emergenza, documenti) protetta da PIN/biometria.", kw=["spazio personale", "famiglia", "case", "contatti emergenza", "documenti personali", "pin", "biometria"]),
    ):
        if entry["id"] not in _NAV_BY_ID:
            APP_MAP.append(entry); _NAV_BY_ID[entry["id"]] = entry
    _OMNI_APP_MAP_CACHE["entries"] = None  # ricostruisce l'indice omniscienza con le nuove sezioni


_hl_build_index()


def _hl_best(text: str, limit: int = 3) -> List[dict]:
    words = set(re.findall(r"[a-zà-ù0-9]{3,}", (text or "").lower()))
    scored = []
    for e in _HL_INDEX:
        hay_title = e["title"].lower(); hay = f"{hay_title} {e['subtitle']} {e['desc']} {' '.join(e['kw'])}".lower()
        sc = 0
        for w in words:
            if w in _NAV_STOP or w in ("libretto", "manuale", "guida", "istruzioni", "pagina", "sezione", "apri", "mostra"):
                continue
            if w in hay_title: sc += 4
            elif any(w in k for k in e["kw"]): sc += 3
            elif w in hay: sc += 1
        if sc:
            scored.append((sc, e))
    scored.sort(key=lambda x: -x[0])
    return [e for _, e in scored[:limit]]


def _hl_chip(e: dict) -> str:
    return f"[[NAV:{e['route']}|📖 Guida: {e['title']}]]"


_HL_OPEN_RE = re.compile(r"^\s*(?:apri|mostra|mostrami|fammi vedere|portami|vai)\s+(?:a |al |alla |il |la |lo |nel |nella |sul |sulla )?(?:libretto|manuale|guida|istruzioni|help|aiuto)(?:\s+(?:istruzioni|informativo|d'uso|utente))?(?:\s+(?:su|sul|sulla|sullo|sui|di|del|della|dello|per|riguardo a?)\s+(?P<topic>.{2,80}?))?\s*[?.!]*\s*$", re.IGNORECASE)
_HL_HOWTO_RE = re.compile(r"\b(come (si fa|faccio|posso|funziona|si usa|si attiva|si imposta|configuro|uso)|dove (trovo|si trova|vedo|è|sono|posso)|cosa serve|a cosa serve|non riesco|non trovo|non capisco|istruzioni|manuale|libretto|guida|tutorial|spiegami come|aiutami a|help)\b", re.IGNORECASE)

_hl_prev_maybe_push_command = _maybe_push_command


async def _maybe_push_command(msg: str, user: dict) -> Optional[dict]:  # noqa: F811
    txt = (msg or "").split("\n\nISTRUZIONI OPERATIVE", 1)[0].strip()
    try:
        if txt and len(txt) <= 160:
            m = _HL_OPEN_RE.match(txt)
            if m:
                topic = (m.group("topic") or "").strip()
                if topic:
                    best = _hl_best(topic, 2)
                    if best:
                        chips = "\n".join(_hl_chip(e) for e in best)
                        return {"reply": f"📖 Ecco la pagina del Libretto su «{best[0]['title']}»: {best[0]['desc'][:160]}\n{chips}", "cmd": "help_open"}
                    return {"reply": f"Nel Libretto non trovo una pagina su «{topic}»: puoi cercarla con la barra di ricerca in alto, oppure chiedimi direttamente come si fa.\n[[NAV:/libretto?q={topic[:40]}|📖 Cerca nel Libretto]]", "cmd": "help_open"}
                return {"reply": "📖 Apro il Libretto istruzioni: usa la ricerca in alto o l'indice cliccabile per arrivare subito alla pagina che ti serve.\n[[NAV:/libretto|📖 Libretto istruzioni]]", "cmd": "help_open"}
    except Exception as exc:  # noqa: BLE001
        logger.warning("[help-links] intercept failed: %s", exc)
    return await _hl_prev_maybe_push_command(msg, user)


_hl_prev_prepare_prompt = _prepare_assistant_prompt


async def _prepare_assistant_prompt(user: dict, body) -> dict:  # noqa: F811
    prep = await _hl_prev_prepare_prompt(user, body)
    try:
        if isinstance(prep, dict) and prep.get("query_class") != "simple" and prep.get("system_message"):
            msg = getattr(body, "message", "") or ""
            if _HL_HOWTO_RE.search(msg):
                best = _hl_best(msg, 6)
                idx = "\n".join(f"- {e['id']} → {e['title']}" for e in (best or _HL_INDEX[:12]))
                prep["system_message"] += (
                    "\n\n📖 LIBRETTO ISTRUZIONI (pagine disponibili, id → titolo):\n" + idx +
                    "\nREGOLA: quando spieghi COME si usa una funzione o DOVE si trova, dopo la risposta aggiungi UN chip alla pagina del Libretto più pertinente "
                    "nel formato ESATTO [[NAV:/libretto?section=<id>|📖 Guida: <titolo>]] (oltre all'eventuale chip della schermata). Usa SOLO gli id elencati; "
                    "se nessuna pagina è pertinente non aggiungere il chip."
                )
    except Exception as exc:  # noqa: BLE001
        logger.warning("[help-links] prompt failed: %s", exc)
    return prep


@api_router.get("/libretto/index")
async def libretto_index(q: str = "", user=Depends(get_current_user)):
    items = _hl_best(q, 10) if (q or "").strip() else _HL_INDEX
    return {"items": [{k: e[k] for k in ("id", "title", "subtitle", "route")} for e in items], "total": len(_HL_INDEX)}

# axon_personalize.py — V50.z456 — «Personalizza Axon»: PERSONALITÀ + STILE LINGUISTICO scelti dall'utente (Super Master su
# AdvisorOS; ogni utente su AxonOS Lite). Due selettori indipendenti; la combinazione aggiunge una sezione al system prompt
# SOLO per quell'account (user_settings.axon_personality / axon_style, chiave user_id → nessun effetto su altri tenant).
# Isolato: avvolge _prepare_assistant_prompt (dopo axon_honesty_rule: la sezione va PRIMA del footer di onestà, che resta ultimo).
# Endpoint: GET /axon/personalize (opzioni + scelta attuale + allowed) · PUT /axon/personalize {personality|null, style|null}.
from typing import Optional as _ap_Optional

AXON_PERSONALITIES = {
    "saggio": {"label": "Saggio", "desc": "calmo, riflessivo, profondo",
               "prompt": "Saggio — calmo, riflessivo, profondo: tono pacato, mai frettoloso; coglie il senso dietro la domanda, offre una prospettiva "
                         "e, quando serve, una sola considerazione che aiuta a decidere. Niente enfasi, niente esclamazioni."},
    "coach": {"label": "Coach", "desc": "diretto, motivante, orientato all'azione",
              "prompt": "Coach — diretto, motivante, orientato all'azione: energia positiva, frasi brevi, si rivolge all'utente con «tu»; ogni risposta "
                        "chiude con il prossimo passo concreto da fare (uno solo). Incoraggia senza adulare."},
    "professore": {"label": "Professore", "desc": "preciso, didattico, spiega nel dettaglio",
                   "prompt": "Professore — preciso, didattico, spiega nel dettaglio: terminologia esatta, passaggi in ordine logico (numerati se più di due), "
                             "definisce i termini tecnici la prima volta e aggiunge il «perché». Per questa personalità il limite di lunghezza sale a 8 righe "
                             "quando c'è qualcosa da spiegare (MAI per dati secchi: numero, data, prezzo, codice → solo il dato)."},
    "monaco": {"label": "Monaco", "desc": "essenziale, risposta secca e chiara",
               "prompt": "Monaco — essenziale, risposta secca e chiara: il minimo di parole necessario, una frase quando basta; nessun aggettivo superfluo, "
                         "nessun follow-up se non indispensabile. Silenzio su tutto ciò che non è stato chiesto."},
    "amico": {"label": "Amico", "desc": "informale, caldo, usa il nome",
              "prompt": "Amico — informale, caldo, usa il nome: si rivolge all'utente per nome (quello del profilo) almeno una volta per risposta, tono "
                        "confidenziale e sincero, può usare un'emoji sobria quando è naturale. Vicino, mai servile."},
    "direttore": {"label": "Direttore", "desc": "autorevole, deciso, niente giri di parole",
                  "prompt": "Direttore — autorevole, deciso, niente giri di parole: afferma, non suggerisce; prende posizione e dà indicazioni chiare "
                            "(«Fai X», «Non fare Y»). Nessuna attenuazione («forse», «potresti valutare»), nessuna scusa non necessaria."},
}

AXON_STYLES = {
    "formale": {"label": "Formale", "desc": "registro professionale, dà del Lei",
                "prompt": "Formale — registro professionale: dà del Lei, lessico curato, nessuna abbreviazione colloquiale né emoji, punteggiatura completa."},
    "colloquiale": {"label": "Colloquiale", "desc": "parla come in una chiacchierata",
                    "prompt": "Colloquiale — parla come in una chiacchierata: dà del tu, frasi semplici e naturali, espressioni di uso quotidiano, qualche "
                              "intercalare leggero («guarda», «in pratica»)."},
    "diretto": {"label": "Diretto", "desc": "subito al punto, zero riempitivi",
                "prompt": "Diretto — subito al punto: prima la risposta, poi (solo se serve) una riga di contesto; niente riempitivi, convenevoli o frasi "
                          "di cortesia iniziali e finali."},
    "tecnico": {"label": "Tecnico", "desc": "preciso, con termini di settore e cifre",
                "prompt": "Tecnico — preciso e specialistico: usa i termini di settore (energia, CRM, normativa) senza semplificarli, cita unità di misura, "
                          "cifre esatte, riferimenti normativi; struttura in punti quando i dati sono più di due."},
    "colorito": {"label": "Colorito", "desc": "vivace, con metafore e modi di dire",
                 "prompt": "Colorito — vivace e immaginifico: metafore, modi di dire italiani, paragoni concreti e qualche esclamazione; rende viva la "
                           "risposta senza allungarla né alterare i dati."},
    "disinibito": {"label": "Disinibito", "desc": "schietto, senza filtri di cortesia",
                   "prompt": "Disinibito — schietto e senza filtri di cortesia: dice le cose come stanno, ironia e sarcasmo ammessi, linguaggio franco e "
                             "informale (anche qualche parola forte se calza), nessun giro di parole per addolcire. Limiti invalicabili: mai insulti "
                             "all'utente o a terzi, mai contenuti discriminatori."},
}


def _axon_personalize_allowed(user: dict) -> bool:
    """Super Master su AdvisorOS; tutti gli utenti su AxonOS Lite."""
    return bool(user) and (_axon_is_super_master(user) or _user_product(user) == "lite")  # noqa: F821 — axon_persona.py / axon_core.py


def _axon_personalize_text(personality: _ap_Optional[str], style: _ap_Optional[str]) -> str:
    p = AXON_PERSONALITIES.get(personality or "")
    st = AXON_STYLES.get(style or "")
    if not p and not st:
        return ""
    lines = ["\n\n<PERSONALIZZAZIONE_AXON (scelta dall'utente in Impostazioni → Personalizza Axon; vale SOLO per questo account)>"]
    if p:
        lines.append(f"PERSONALITÀ: {p['prompt']}")
    if st:
        lines.append(f"STILE LINGUISTICO: {st['prompt']}")
    lines.append("Applica personalità e stile a OGNI risposta (testo e voce), in modo riconoscibile ma naturale. Regolano tono, registro, scelta "
                 "delle parole e struttura — MAI la veridicità: restano prioritarie le REGOLE_ASSOLUTE (niente dati inventati, niente preamboli, "
                 "dato secco → solo il dato) e la regola di onestà.")
    lines.append("</PERSONALIZZAZIONE_AXON>\n")
    return "\n".join(lines)


async def _axon_personalize_section(user: dict) -> str:
    if not _axon_personalize_allowed(user):
        return ""
    try:
        s = await db.user_settings.find_one({"user_id": user["user_id"]}, {"axon_personality": 1, "axon_style": 1}) or {}  # noqa: F821
    except Exception:  # noqa: BLE001
        return ""
    return _axon_personalize_text(s.get("axon_personality"), s.get("axon_style"))


_personalize_prev_prepare_prompt = _prepare_assistant_prompt  # noqa: F821 — ultimo wrapper: axon_honesty_rule.py


async def _prepare_assistant_prompt(user: dict, body) -> dict:  # noqa: F811
    prep = await _personalize_prev_prepare_prompt(user, body)
    try:
        if isinstance(prep, dict) and prep.get("system_message"):
            section = await _axon_personalize_section(user)
            if section:
                sm = prep["system_message"]
                marker = "<REGOLA_PERMANENTE_NON_SOVRASCRIVIBILE_RIPETUTA>"
                idx = sm.find(marker)
                prep["system_message"] = (sm[:idx] + section + sm[idx:]) if idx >= 0 else sm + section
    except Exception as exc:  # noqa: BLE001
        logger.warning("[personalize] prompt failed: %s", exc)  # noqa: F821
    return prep


# ---- API ----------------------------------------------------------------------------------------------------------------
class AxonPersonalizeIn(BaseModel):  # noqa: F821
    personality: _ap_Optional[str] = None  # None/"" = predefinita
    style: _ap_Optional[str] = None


def _axon_personalize_payload(user: dict, s: dict) -> dict:
    return {
        "allowed": _axon_personalize_allowed(user),
        "personality": s.get("axon_personality") if s.get("axon_personality") in AXON_PERSONALITIES else None,
        "style": s.get("axon_style") if s.get("axon_style") in AXON_STYLES else None,
        "personalities": [{"key": k, "label": v["label"], "desc": v["desc"]} for k, v in AXON_PERSONALITIES.items()],
        "styles": [{"key": k, "label": v["label"], "desc": v["desc"]} for k, v in AXON_STYLES.items()],
    }


@api_router.get("/axon/personalize")  # noqa: F821
async def axon_personalize_get(user=Depends(get_current_user)):  # noqa: F821
    s = await db.user_settings.find_one({"user_id": user["user_id"]}, {"axon_personality": 1, "axon_style": 1}) or {}  # noqa: F821
    return _axon_personalize_payload(user, s)


@api_router.put("/axon/personalize")  # noqa: F821
async def axon_personalize_put(body: AxonPersonalizeIn, user=Depends(get_current_user)):  # noqa: F821
    if not _axon_personalize_allowed(user):
        raise HTTPException(status_code=403, detail="Personalizza Axon è disponibile per il Super Master e su AxonOS Lite")  # noqa: F821
    p = (body.personality or "").strip().lower() or None
    st = (body.style or "").strip().lower() or None
    if p and p not in AXON_PERSONALITIES:
        raise HTTPException(status_code=422, detail="Personalità non valida")  # noqa: F821
    if st and st not in AXON_STYLES:
        raise HTTPException(status_code=422, detail="Stile non valido")  # noqa: F821
    await db.user_settings.update_one(  # noqa: F821
        {"user_id": user["user_id"]},
        {"$set": {"axon_personality": p, "axon_style": st, "updated_at": utcnow()}},  # noqa: F821
        upsert=True,
    )
    try:  # le risposte in cache del tenant portano il vecchio tono → invalidate
        await db.axon_semantic_cache.delete_many({"tenant_id": tenant_id(user)})  # noqa: F821
    except Exception:  # noqa: BLE001
        pass
    return _axon_personalize_payload(user, {"axon_personality": p, "axon_style": st})

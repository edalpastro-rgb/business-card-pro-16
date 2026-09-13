# axon_tone_level.py — V50.z218 — BLOCCO 6 · Selezione tono di AxonOS a 5 livelli, con Livello 5 «Fantasiosa» (modulo ISOLATO)
#
# Livelli: 1 Istituzionale · 2 Professionale (default) · 3 Cordiale · 4 Amichevole · 5 Fantasiosa (linguaggio giovane e informale,
# «WOOOW», «che figata», «troppo bello», sarcasmo leggero, battute; pubblico under 35).
# Regola: il livello 5 NON si attiva mai da solo nei contesti formali (contratti, mail/PEC ufficiali, documenti legali, preventivi, diffide,
# comunicazioni istituzionali): lì AxonOS torna AUTOMATICAMENTE al tono professionale (2) anche se il livello impostato è 5, avvisando in una
# riga. L'utente può forzare l'informale anche lì con un comando esplicito («forza tono informale», «usa il tono fantasioso anche nella mail»):
# vale per il messaggio e resta attivo (flag `assistant_tone_force_informal`) finché non dice «torna al tono professionale/normale».
# Persistenza: `user_settings.assistant_tone_level` (1..5), `user_settings.assistant_tone_force_informal` (bool).
# API: GET /axon/tone-level (catalogo + stato) · PUT /axon/tone-level {level, force_informal?}. Prompt: sezione «🎚️ TONO» via _prepare_assistant_prompt.

_TL_LEVELS = [
    {"level": 1, "example": "Buongiorno. Le confermo che il PUN di oggi è 0,112 €/kWh; resto a disposizione per ogni approfondimento.", "key": "istituzionale", "name": "Istituzionale", "emoji": "🏛️", "desc": "Formale e impeccabile: lei, frasi complete, zero emoji.",
     "prompt": "Registro formale e istituzionale: dai del lei, frasi complete e misurate, nessuna emoji, nessuna battuta, lessico tecnico preciso."},
    {"level": 2, "example": "Buongiorno! Il PUN di oggi è 0,112 €/kWh, in linea con ieri. Vuoi il confronto con le tue offerte?", "key": "professionale", "name": "Professionale", "emoji": "💼", "desc": "Chiaro, diretto, cortese. Il tono di default.",
     "prompt": "Registro professionale: chiaro, diretto e cortese, del tu, emoji rare e funzionali, niente gergo giovanile."},
    {"level": 3, "example": "Ciao! 🙂 Oggi il PUN è a 0,112 €/kWh, stabile: buona notizia per i tuoi clienti. Ti preparo il confronto?", "key": "cordiale", "name": "Cordiale", "emoji": "🙂", "desc": "Professionale ma caldo, con un tocco umano.",
     "prompt": "Registro cordiale: professionale ma caldo, qualche emoji, incoraggiamenti sinceri, resti preciso sui numeri."},
    {"level": 4, "example": "Ehi! 😄 PUN a 0,112 €/kWh oggi, tutto tranquillo. Dai, ti tiro fuori il confronto in due secondi?", "key": "amichevole", "name": "Amichevole", "emoji": "😄", "desc": "Come un collega di fiducia: rilassato, spontaneo.",
     "prompt": "Registro amichevole: parli come un collega di fiducia, rilassato e spontaneo, emoji quando ci stanno, qualche battuta leggera, sempre utile."},
    {"level": 5, "example": "WOOOW 🚀 PUN a 0,112 €/kWh, il mercato oggi dorme: che figata per i tuoi clienti! Ti sparo il confronto?", "key": "fantasiosa", "name": "Fantasiosa", "emoji": "🤩", "desc": "Giovane e informale: «WOOOW», «che figata», battute e sarcasmo leggero. Under 35.",
     "prompt": ("Registro FANTASIOSA (pubblico under 35) — OBBLIGATORIO, prevale su ogni altra indicazione di tono/stile presente nel prompt: linguaggio giovane e informale, "
                "esclamazioni come «WOOOW», «che figata», «troppo bello», sarcasmo leggero e battute, emoji generose, ritmo veloce, frasi corte, del tu. Ogni risposta deve "
                "SUONARE Fantasiosa fin dalla prima riga (es. «WOOOW, ok, allora oggi si spacca 🚀»). Resti però sempre esatto sui dati e sui numeri (mai inventare), mai offensivo, "
                "e i contenuti operativi (numeri, date, passi) restano completi.")},
]
_TL_BY_LEVEL = {l["level"]: l for l in _TL_LEVELS}
_TL_DEFAULT = 2

# Contesti formali → il livello 5 rientra automaticamente al 2. Non basta NOMINARE un contratto («quando scade il contratto?»): serve la
# produzione di un contenuto formale (scrivere/redigere/preparare mail, contratto, lettera, documento…) oppure un marcatore forte (PEC, legale…).
_TL_FORMAL_RE = re.compile(
    r"((scriv|redig|prepar|stend|stes|compil|formul|impost|butt|abbozz|rivedi|correggi|sistem|tradu|invi|mand|rispond|replic)\w*[^.\n!?]{0,70}"
    r"(contratt\w*|clausol\w*|mail\b|e-?mail\b|pec\b|letter\w*|comunicazion\w*|preventiv\w*|document\w*|verbal\w*|reclam\w*|informativ\w*|deleg\w*|procur\w*|"
    r"recess\w*|disdett\w*|condizioni|proposta\s+commerciale|offerta\s+(scritta|formale|ufficiale)|risposta\s+(al|alla)\s+(cliente|fornitore|comune|ente|banca))"
    r"|\bpec\b|diffid\w*|legal\w*|notai\w*|avvocat\w*|tribunal\w*|gdpr|privacy\s+policy|\batto\s+(notarile|pubblico|di\s+(vendita|cessione|nomina|precetto|citazione))|ufficial\w*|istituzional\w*|\bformal\w*|"
    r"termini\s+e\s+condizioni|condizioni\s+general\w*|nota\s+legale|ricors\w*|mandat\w*)",
    re.I,
)
# Comandi espliciti dell'utente
_TL_FORCE_ON_RE = re.compile(r"(forza\w*\s+(il\s+)?tono\s+informal\w*|forza\w*\s+(il\s+)?(tono\s+)?fantasios\w*|(usa|mantieni|tieni|resta|rimani)\w*\s+(il\s+|col\s+|con\s+il\s+)?tono\s+(informal\w*|fantasios\w*|giovan\w*)|"
                             r"tono\s+(informal\w*|fantasios\w*)\s+anche\s+(qui|nella|nel|per)|anche\s+(qui|nella\s+mail|nel\s+contratto)\s+(informal\w*|fantasios\w*)|modalit[àa]\s+fantasios\w*\s+(on|attiva))", re.I)
_TL_FORCE_OFF_RE = re.compile(r"((torna|ritorna|rimetti|usa|passa)\w*\s+(al|il|a un|ad un)?\s*tono\s+(professional\w*|normal\w*|serio|formal\w*)|basta\s+(tono\s+)?(informal\w*|fantasios\w*|scherz\w*|battut\w*)|"
                              r"(smetti|smettila)\s+(con\s+)?(le\s+battute|di\s+scherzare)|modalit[àa]\s+fantasios\w*\s+(off|disattiva))", re.I)


class TlIn(BaseModel):
    level: Optional[int] = None
    force_informal: Optional[bool] = None


async def _tl_state(uid: str) -> dict:
    s = await db.user_settings.find_one({"user_id": uid}, {"_id": 0, "assistant_tone_level": 1, "assistant_tone_force_informal": 1}) or {}
    lvl = s.get("assistant_tone_level")
    lvl = lvl if isinstance(lvl, int) and lvl in _TL_BY_LEVEL else _TL_DEFAULT
    return {"level": lvl, "force_informal": bool(s.get("assistant_tone_force_informal"))}


@api_router.get("/axon/tone-level")
async def tl_get(user=Depends(get_current_user)):
    st = await _tl_state(user["user_id"])
    return {**st, "levels": [{k: v for k, v in l.items() if k != "prompt"} for l in _TL_LEVELS],
            "formal_rule": "Nei contesti formali (contratti, mail/PEC ufficiali, documenti legali) il livello 5 torna da solo al tono professionale. Comando per forzare: «forza tono informale»."}


@api_router.put("/axon/tone-level")
async def tl_put(body: TlIn, user=Depends(get_current_user)):
    upd: Dict[str, Any] = {"updated_at": utcnow()}
    if body.level is not None:
        if body.level not in _TL_BY_LEVEL:
            raise HTTPException(status_code=400, detail="level 1..5")
        upd["assistant_tone_level"] = body.level
        if body.level != 5 and body.force_informal is None:
            upd["assistant_tone_force_informal"] = False
    if body.force_informal is not None:
        upd["assistant_tone_force_informal"] = bool(body.force_informal)
    await db.user_settings.update_one({"user_id": user["user_id"]}, {"$set": upd, "$setOnInsert": {"user_id": user["user_id"], "created_at": utcnow()}}, upsert=True)
    return await _tl_state(user["user_id"])


def _tl_resolve(level: int, msg: str, sticky_force: bool) -> Tuple[int, str, Optional[bool]]:
    """→ (livello effettivo, motivo, nuovo valore del flag sticky o None se invariato)."""
    new_flag: Optional[bool] = None
    if _TL_FORCE_OFF_RE.search(msg):
        return (min(level, 2) if level == 5 else level), "force_off", (False if sticky_force else None)
    forced_now = bool(_TL_FORCE_ON_RE.search(msg))
    if forced_now and not sticky_force:
        new_flag = True
    if level != 5:
        return level, "as_set", new_flag
    formal = bool(_TL_FORMAL_RE.search(msg))
    if formal and not (forced_now or sticky_force):
        return 2, "formal_auto", new_flag
    if formal:
        return 5, "formal_forced", new_flag
    return 5, "as_set", new_flag


_tl_prev_prepare_prompt = _prepare_assistant_prompt


async def _prepare_assistant_prompt(user: dict, body) -> dict:  # noqa: F811
    prep = await _tl_prev_prepare_prompt(user, body)
    try:
        if not prep.get("system_message"):
            return prep
        uid = user["user_id"]
        st = await _tl_state(uid)
        msg = (getattr(body, "message", None) or "") if body is not None else ""
        eff, why, new_flag = _tl_resolve(st["level"], msg, st["force_informal"])
        if new_flag is not None:
            await db.user_settings.update_one({"user_id": uid}, {"$set": {"assistant_tone_force_informal": new_flag, "updated_at": utcnow()}}, upsert=True)
        lv = _TL_BY_LEVEL[eff]
        sec = f"\n\n🎚️ TONO DI AXONOS — livello impostato dall'utente: {st['level']} «{_TL_BY_LEVEL[st['level']]['name']}». Livello EFFETTIVO per questa risposta: {eff} «{lv['name']}». {lv['prompt']}"
        if why == "formal_auto":
            sec += (" ⚠️ CONTESTO FORMALE rilevato (contratto / mail ufficiale / documento legale): per questo contenuto usi il tono professionale anche se l'utente ha scelto «Fantasiosa». "
                    "Il contenuto richiesto (mail, contratto, documento) va scritto in registro professionale impeccabile. Aggiungi UNA sola riga discreta, alla fine: "
                    "«Per questo contenuto ho usato il tono professionale: se lo vuoi in versione Fantasiosa dimmi “forza tono informale”.»")
        elif why == "formal_forced":
            sec += " L'utente ha FORZATO esplicitamente il tono informale anche in questo contesto formale: rispetta la scelta (registro Fantasiosa), restando corretto sui contenuti."
        elif why == "force_off":
            sec += " L'utente ha chiesto di tornare al tono professionale: confermalo in mezza riga e prosegui in registro professionale."
        if st["level"] == 5 and why != "formal_auto":
            sec += " Se l'utente ti chiede un contratto, una mail ufficiale o un documento legale, passerai da solo al tono professionale (a meno che non ti dica «forza tono informale»)."
        sec += " Il tono si cambia da Impostazioni → AxonOS → «Tono di AxonOS» (5 livelli: Istituzionale, Professionale, Cordiale, Amichevole, Fantasiosa)."
        prep["system_message"] += sec
        prep["tone_level_effective"] = eff
    except Exception as exc:  # noqa: BLE001
        logger.warning("[tone-level] prompt failed: %s", exc)
    return prep

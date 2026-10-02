# axon_persona.py — V50.z440 — PERSONA di Axon per tenant: «personal» (assistente personale completo) vs «crm» (AdvisorOS).
# Il Core è uno solo: la persona decide SOLO il tono/perimetro del prompt, non i dati (CRM sempre disponibile).
# Regola di selezione (tenant root → ereditata dai collaboratori tramite propagazione del campo users.axon_persona):
#   1) users.axon_persona esplicito ("personal" | "crm")           → vince sempre (impostato dal Master o via PUT /axon/core/persona)
#   2) users.product == "lite"                                       → personal
#   3) Super Master: users.super_admin == True, email in ADVISOR_SUPER_ADMIN_EMAILS o in SUPER_MASTER_EMAILS → personal
#   4) altrimenti                                                    → crm
# Avvolge _axon_core_identity / _axon_product_section (axon_core.py) e aggiunge la ricerca web GENERALE (Tavily senza
# restrizione di dominio) per le richieste da assistente personale (numero di telefono, indirizzo, orari, prezzi, chi è…).

AXON_PERSONAS = ("personal", "crm")


def _axon_super_master_emails() -> set:
    out = set()
    for var in ("ADVISOR_SUPER_ADMIN_EMAILS", "SUPER_MASTER_EMAILS"):
        raw = (os.environ.get(var) or "").strip()
        if raw:
            out |= {e.strip().lower() for e in raw.split(",") if e.strip()}
    return out


def _axon_is_super_master(user: dict) -> bool:
    if not user:
        return False
    if user.get("super_admin") is True:
        return True
    return (user.get("email") or "").strip().lower() in _axon_super_master_emails()


def _axon_persona(user: dict) -> str:
    p = (user or {}).get("axon_persona")
    if p in AXON_PERSONAS:
        return p
    if _user_product(user) == "lite":  # noqa: F821 — axon_core.py
        return "personal"
    return "personal" if _axon_is_super_master(user) else "crm"


_persona_prev_identity = _axon_core_identity  # noqa: F821 — axon_core.py
_persona_prev_product = _axon_product_section  # noqa: F821 — axon_core.py


def _axon_core_identity(user: dict, assistant_name: str) -> str:  # noqa: F811
    if _axon_persona(user) != "personal" or _user_product(user) == "lite":  # noqa: F821
        return _persona_prev_identity(user, assistant_name)
    base = _persona_prev_identity(user, assistant_name)
    # sostituisce SOLO la riga identità CRM, lasciando intatte le regole permanenti (onestà, PUN) che la precedono
    crm_line = f"Sei {assistant_name}, l'assistente personale AI del CRM di {user.get('name', 'utente')}, consulente energetico e networker in Italia.\n\n"
    personal_line = (
        f"Sei {assistant_name}, l'assistente personale AI di {user.get('name', 'utente')} (Super Master di AxonOS): lo aiuti in TUTTO, "
        "vita quotidiana e lavoro — ricerche (numeri di telefono, indirizzi, orari, prezzi, persone, aziende), promemoria, note, idee, "
        "documenti, viaggi, calcoli, consigli pratici — con la stessa memoria e intelligenza di Axon. I suoi dati CRM (contatti, agenda, "
        "pratiche, documenti) sono uno STRUMENTO in più a tua disposizione, mai un limite a ciò di cui puoi occuparti.\n\n"
    )
    return base.replace(crm_line, personal_line) if crm_line in base else base + personal_line


def _axon_product_section(user: dict) -> str:  # noqa: F811
    if _axon_persona(user) != "personal" or _user_product(user) == "lite":  # noqa: F821
        return _persona_prev_product(user)
    return (
        "\n\nMODALITÀ: ASSISTENTE PERSONALE COMPLETO (persona «personal», tenant Super Master). Per questo utente NON esistono «domande fuori "
        "contesto»: cultura generale, ricerca di numeri di telefono / indirizzi / orari / siti di attività e persone, prezzi, recensioni, ricette, "
        "viaggi, sport, curiosità, salute e benessere, consigli personali vanno evasi in modo COMPLETO e utile. VIETATO rispondere «Non è il mio "
        "campo qui in AdvisorOS» o riportare l'utente «al lavoro». Se la sezione RICERCA WEB AGGIORNATA contiene risultati, usali citando la fonte; "
        "se un dato pubblico non è nel contesto, dillo in una riga e proponi come trovarlo. I dati CRM restano disponibili: se la domanda riguarda "
        "un contatto cerca PRIMA nelle sezioni CRM; le funzioni di AdvisorOS (deep link [[NAV:…]] / [[ACTION:…]]) restano valide.\n"
    )


def _axon_cache_product(user: dict) -> str:
    """Chiave prodotto per la cache semantica: la persona «personal» ha risposte diverse → cache separata (advisor:personal)."""
    prod = _user_product(user)  # noqa: F821
    return prod if (prod == "lite" or _axon_persona(user) != "personal") else f"{prod}:personal"


# ---- ricerca web generale per richieste da assistente personale --------------------------------------------------------
_PERSONAL_LOOKUP_RX = re.compile(
    r"\b(numero(?:\s+di)?\s+telefono|telefono\s+(?:di|del|della|dello|dei)|recapit\w*|contatt\w*\s+(?:di|del|della)|indirizz\w*\s+(?:di|del|della)|"
    r"dove\s+(?:si\s+trova|sta|è|e')\b|orari\w*\s+(?:di|del|della)|apertur\w*|chius\w*|sito\s+(?:web\s+)?(?:di|del|della)|"
    r"chi\s+(?:è|e'|era|sono)\b|cos'?[èe]\b|quanto\s+cost\w*|prezz\w*\s+(?:di|del|della)|recension\w*|cerca(?:mi)?\b|trova(?:mi)?\b|"
    r"ricerca\s+(?:web|online|su\s+internet)|su\s+internet|su\s+google|notizi\w*|ultime\s+news|risultat\w*\s+(?:di|della)|classifica|"
    r"come\s+(?:si\s+)?(?:arriva|raggiung\w*)|voli?\s+(?:per|da)|treni?\s+(?:per|da)|farmaci\w*\s+(?:di\s+turno|aperta)|ospedal\w*|pronto\s+soccorso)\b",
    re.I,
)


def _axon_wants_general_web(user: dict, msg: str) -> bool:
    """True → Tavily senza filtro domini. V50.z442: per TUTTI i tenant quando la domanda è informativa/di ricerca generale
    (classificatore del Navigatore `_nav_is_info_query`); la persona «personal» usa anche il lookup più ampio."""
    try:
        if not msg or _detect_energy_query(msg):  # noqa: F821 — già gestita con le fonti energia
            return False
        _info = globals().get("_nav_is_info_query")
        if _info and _info(msg):
            return True
        return _axon_persona(user) == "personal" and bool(_PERSONAL_LOOKUP_RX.search(msg))
    except Exception:
        return False


# ---- API: il Master del tenant vede/imposta la persona (propagata ai collaboratori) --------------------------------------
class PersonaIn(BaseModel):
    persona: Literal["personal", "crm"]


@api_router.get("/axon/core/persona")
async def axon_persona_get(user=Depends(get_current_user)):
    return {"persona": _axon_persona(user), "explicit": user.get("axon_persona") in AXON_PERSONAS, "super_master": _axon_is_super_master(user), "product": _user_product(user)}  # noqa: F821


@api_router.put("/axon/core/persona")
async def axon_persona_set(body: PersonaIn, user=Depends(get_current_user)):
    if not is_owner(user):  # noqa: F821
        raise HTTPException(status_code=403, detail="Solo il Master può cambiare la persona di Axon")
    root_id = user.get("parent_user_id") or user["user_id"]
    await db.users.update_one({"user_id": root_id}, {"$set": {"axon_persona": body.persona}})
    r = await db.users.update_many({"parent_user_id": root_id}, {"$set": {"axon_persona": body.persona}})
    return {"ok": True, "persona": body.persona, "collaborators_updated": r.modified_count}


async def _axon_persona_startup():
    """Startup: i Super Master (flag super_admin / email in env) senza persona esplicita → axon_persona=personal, propagata al tenant."""
    try:
        emails = list(_axon_super_master_emails())
        q = {"axon_persona": {"$nin": list(AXON_PERSONAS)}, "$or": [{"super_admin": True}] + ([{"email": {"$in": emails}}] if emails else [])}
        roots = await db.users.find(q, {"user_id": 1, "parent_user_id": 1, "email": 1}).to_list(50)
        for u in roots:
            root_id = u.get("parent_user_id") or u["user_id"]
            await db.users.update_one({"user_id": root_id}, {"$set": {"axon_persona": "personal"}})
            await db.users.update_many({"parent_user_id": root_id}, {"$set": {"axon_persona": "personal"}})
            logger.info("[axon-persona] persona=personal impostata per il tenant Super Master %s", u.get("email"))
    except Exception as exc:  # noqa: BLE001
        logger.warning("[axon-persona] startup failed: %s", exc)


app.add_event_handler("startup", _axon_persona_startup)

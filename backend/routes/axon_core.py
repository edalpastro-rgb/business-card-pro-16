# axon_core.py — V50.z323 «Axon Core»: un solo cervello Axon per tutti i prodotti (AdvisorOS, AxonOS Lite, futuri).
# Ogni utente ha `users.product` ∈ AXON_PRODUCTS (default "advisor"); Axon adatta identità/strumenti al prodotto ma
# condivide memoria personale (per utente, privata) e apprendimento collettivo (anonimo, per tutti).
# Endpoint: GET /axon/core/manifest (pubblico) · GET /admin/axon-core/products (super admin: conteggi)
#           · PUT /admin/users/{user_id}/product (super admin) · GET /axon/core/me (utente: prodotto + funzioni)
# Le altre app puntano EXPO_PUBLIC_BACKEND_URL a questo backend e registrano con {"product": "lite"}.

AXON_CORE_VERSION = "1.0.0"
AXON_DEFAULT_PRODUCT = "advisor"

AXON_PRODUCTS: Dict[str, Dict[str, Any]] = {
    "advisor": {
        "label": "AdvisorOS",
        "tagline": "Per professionisti esigenti",
        "features": ["crm", "team", "calendar", "calls", "bills", "energy", "corporate_gym", "master_files", "mail", "reports",
                     "axon_chat", "axon_memory", "axon_proactive", "axon_voice", "personal_space", "promo", "referral"],
    },
    "lite": {
        "label": "AxonOS Lite",
        "tagline": "Per tutti: studenti, famiglie, piccoli imprenditori",
        "features": ["axon_chat", "axon_memory", "axon_proactive", "axon_voice", "personal_space", "notes", "reminders",
                     "calendar", "promo", "referral"],
    },
}

# Endpoint condivisi che ogni client (Lite incluso) usa: contratto pubblico di Axon Core
AXON_CORE_SHARED_ENDPOINTS = [
    "POST /auth/register {email,password,name,product}", "POST /auth/login", "GET /auth/me", "GET /axon/core/me",
    "POST /assistant/chat (+ SSE stream)", "POST /assistant/tts", "POST /axon/quick-action",
    "GET/POST/PUT/DELETE /axon/memory", "GET /axon/personal-space/summary", "POST /audio-records/{id}/transcribe",
    "GET/PUT /axon/proactive/config", "POST /axon/proactive/trigger", "GET /axon/proactive/items", "GET/POST /axon/proactive/reminders",
    "GET/PUT /user-settings (assistant_name, assistant_voice, assistant_language, assistant_setup_done, activation_done)",
    "GET/PUT /axon/setup/state", "POST /promo/redeem", "GET /promo/my", "GET /referral/me",
    "GET /subscription/status",
]


def _user_product(user: Optional[dict]) -> str:
    p = (user or {}).get("product") or AXON_DEFAULT_PRODUCT
    return p if p in AXON_PRODUCTS else AXON_DEFAULT_PRODUCT


def _axon_core_identity(user: dict, assistant_name: str) -> str:
    """Prima riga del system prompt: identità di Axon in base al prodotto (stessa mente, contesto diverso)."""
    name = user.get("name", "utente")
    if _user_product(user) == "lite":
        return (f"Sei {assistant_name}, l'assistente personale AI di {name} su AxonOS Lite: lo aiuti a ricordare tutto e a non perdersi nulla "
                "(promemoria, note, appuntamenti, scadenze, idee, documenti personali), con la stessa intelligenza e la stessa memoria di Axon.\n\n")
    return f"Sei {assistant_name}, l'assistente personale AI del CRM di {name}, consulente energetico e networker in Italia.\n\n"


def _axon_product_section(user: dict) -> str:
    """Sezione finale del system prompt: cosa esiste (e cosa NO) nel prodotto dell'utente."""
    if _user_product(user) == "lite":
        return ("\n\nPRODOTTO: AxonOS Lite. L'utente NON ha CRM aziendale, team/collaboratori, Corporate Gym, Master Files, bollette clienti, "
                "report o mail aziendali: non proporli e non citare «AdvisorOS» come se fosse la sua app. Concentrati su memoria personale, "
                "promemoria, note, calendario, Sfera personale, ricerca web e consigli pratici. Se chiede una funzione professionale, "
                "spiega che è disponibile in AdvisorOS (per professionisti) senza insistere.\n")
    return ""


@api_router.get("/axon/core/manifest")
async def axon_core_manifest():
    return {
        "name": "Axon Core", "version": AXON_CORE_VERSION,
        "products": [{"id": k, **v} for k, v in AXON_PRODUCTS.items()],
        "shared_endpoints": AXON_CORE_SHARED_ENDPOINTS,
        "data_model": {
            "private": "Spazio privato per utente/tenant (contatti, note, memoria personale, file, chat): mai condiviso tra utenti o prodotti.",
            "collective": "Apprendimento collettivo anonimo (regole di comportamento, feedback 👍/👎, risposte generali): condiviso tra tutti i prodotti, senza dati personali.",
        },
    }


@api_router.get("/axon/core/me")
async def axon_core_me(user=Depends(get_current_user)):
    p = _user_product(user)
    return {"product": p, **AXON_PRODUCTS[p], "core_version": AXON_CORE_VERSION}


class ProductIn(BaseModel):
    product: Literal["advisor", "lite"]


@api_router.get("/admin/axon-core/products")
async def axon_core_products(user=Depends(require_super_admin)):
    out = []
    for k, v in AXON_PRODUCTS.items():
        q = {"product": k} if k != AXON_DEFAULT_PRODUCT else {"$or": [{"product": k}, {"product": {"$exists": False}}, {"product": None}]}
        total = await db.users.count_documents(q)
        owners = await db.users.count_documents({**q, "parent_user_id": {"$in": [None, ""]}}) if k != AXON_DEFAULT_PRODUCT else await db.users.count_documents({"$and": [q, {"parent_user_id": {"$in": [None, ""]}}]})
        out.append({"id": k, "label": v["label"], "users": total, "owners": owners})
    return {"core_version": AXON_CORE_VERSION, "items": out}


@api_router.put("/admin/users/{user_id}/product")
async def axon_core_set_product(user_id: str, body: ProductIn, user=Depends(require_super_admin)):
    r = await db.users.update_one({"user_id": user_id}, {"$set": {"product": body.product}})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Utente non trovato")
    # collaboratori seguono l'owner
    await db.users.update_many({"parent_user_id": user_id}, {"$set": {"product": body.product}})
    return {"ok": True, "user_id": user_id, "product": body.product}


async def _axon_core_migrate_products():
    """Startup: utenti senza `product` → advisor (tutti gli esistenti sono AdvisorOS)."""
    try:
        r = await db.users.update_many({"product": {"$exists": False}}, {"$set": {"product": AXON_DEFAULT_PRODUCT}})
        if r.modified_count:
            logger.info(f"[axon-core] product=advisor impostato su {r.modified_count} utenti")
    except Exception as exc:
        logger.warning(f"[axon-core] migrazione product fallita: {exc}")

# tag 2026-10-19 (blocchi) — BLOCCHI: moduli attivabili per organizzazione in base alla licenza.
# • Catalogo in codice (BLOCKS_CATALOG): aggiungere un blocco = una riga qui (eventuali sottovoci in `children`).
# • Stato per organizzazione in Mongo `org_blocks` {tenant_id, enabled: [key…]} → nessun deploy per accendere/spegnere.
# • Chi comanda: SOLO il SuperMaster (require_super_admin) assegna i blocchi alle organizzazioni (Master licenze).
# • Spento = sparisce per TUTTI (Master compreso): il frontend legge GET /blocks e mostra solo i blocchi abilitati
#   (menu completo drawer/sidebar, schermata /blocchi/<key>); Axon riceve l'elenco dei blocchi attivi nel prompt.
from typing import Any, Dict, List, Set

BLOCKS_CATALOG: List[Dict[str, Any]] = [
    {"key": "energia", "label": "Energia", "icon": "flash-outline", "color": "#F59E0B",
     "description": "Vendita e gestione contratti luce e gas: offerte, listini, analisi consumi e pratiche.",
     "children": [
         {"key": "energia_ant", "label": "ANT", "icon": "document-text-outline", "description": "Pratiche ANT: raccolta dati, documenti e stato di avanzamento."},
         {"key": "energia_fotovoltaico", "label": "Fotovoltaico", "icon": "sunny-outline", "description": "Impianti fotovoltaici: sopralluogo, preventivo, pratiche di connessione e incentivi."},
     ]},
    {"key": "efficientamento", "label": "Efficientamento", "icon": "leaf-outline", "color": "#10B981",
     "description": "Efficientamento energetico: diagnosi, interventi, incentivi e monitoraggio dei risparmi.", "children": []},
    {"key": "ristorante", "label": "Ristorante", "icon": "restaurant-outline", "color": "#EF4444",
     "description": "Gestione clienti ristorazione: fornitori, menu, prenotazioni e marketing locale.", "children": []},
]
_BLOCK_KEYS: Set[str] = {b["key"] for b in BLOCKS_CATALOG}


class OrgBlockToggle(BaseModel):  # noqa: F821 — pydantic da 00_core
    enabled: bool


async def blocks_enabled_for_tenant(tid: str) -> Set[str]:
    doc = await db.org_blocks.find_one({"tenant_id": tid}, {"_id": 0, "enabled": 1})  # noqa: F821
    return {k for k in (doc or {}).get("enabled", []) if k in _BLOCK_KEYS}


def _blocks_items(enabled: Set[str]) -> List[Dict[str, Any]]:
    return [{**b, "enabled": b["key"] in enabled, "route": f"/blocchi/{b['key']}",
             "children": [{**c, "route": f"/blocchi/{c['key']}"} for c in b.get("children", [])]} for b in BLOCKS_CATALOG]


@api_router.get("/blocks")  # noqa: F821
async def blocks_for_me(user=Depends(get_current_user)):  # noqa: F821
    """Catalogo + stato per l'organizzazione dell'utente. Il frontend mostra SOLO `enabled: true`."""
    enabled = await blocks_enabled_for_tenant(tenant_id(user))  # noqa: F821
    return {"items": _blocks_items(enabled), "enabled_keys": sorted(enabled)}


@api_router.get("/admin/blocks")  # noqa: F821
async def admin_blocks(user=Depends(require_super_admin)):  # noqa: F821
    """Pannello SuperMaster: catalogo + tutte le organizzazioni (Master radice) con i blocchi abilitati."""
    orgs = await db.users.find({"role": "owner", "$or": [{"parent_user_id": None}, {"parent_user_id": {"$exists": False}}]},  # noqa: F821
                               {"_id": 0, "user_id": 1, "email": 1, "first_name": 1, "last_name": 1, "company_name": 1, "advisor_tier": 1}).sort("email", 1).to_list(2000)
    states = {d["tenant_id"]: d.get("enabled", []) async for d in db.org_blocks.find({}, {"_id": 0, "tenant_id": 1, "enabled": 1})}  # noqa: F821
    out = []
    for o in orgs:
        name = " ".join(x for x in [o.get("first_name"), o.get("last_name")] if x) or o.get("email") or o["user_id"]
        out.append({"tenant_id": o["user_id"], "name": name, "email": o.get("email") or "", "company": o.get("company_name") or "", "tier": o.get("advisor_tier") or "test",
                    "enabled_keys": sorted(k for k in states.get(o["user_id"], []) if k in _BLOCK_KEYS)})
    return {"catalog": _blocks_items(set()), "orgs": out}


@api_router.put("/admin/blocks/{tid}/{key}")  # noqa: F821
async def admin_block_toggle(tid: str, key: str, body: OrgBlockToggle, user=Depends(require_super_admin)):  # noqa: F821
    if key not in _BLOCK_KEYS:
        raise HTTPException(status_code=404, detail="Blocco sconosciuto")  # noqa: F821
    if not await db.users.find_one({"user_id": tid, "role": "owner"}, {"_id": 0, "user_id": 1}):  # noqa: F821
        raise HTTPException(status_code=404, detail="Organizzazione non trovata")  # noqa: F821
    op = {"$addToSet": {"enabled": key}} if body.enabled else {"$pull": {"enabled": key}}
    await db.org_blocks.update_one({"tenant_id": tid}, {**op, "$set": {"updated_at": utcnow(), "updated_by": user["user_id"]}}, upsert=True)  # noqa: F821
    enabled = await blocks_enabled_for_tenant(tid)
    logger.info("[blocchi] %s → %s %s (by %s)", tid, key, "ON" if body.enabled else "OFF", user.get("email"))  # noqa: F821
    return {"tenant_id": tid, "enabled_keys": sorted(enabled)}


# ── Deterministico: «apri Fotovoltaico», «portami in ANT», «apri il blocco Ristorante» → deep link del blocco/sottovoce (o
# messaggio licenza se spento). Prima del Navigatore (evita i template fuzzy «Apri X» sbagliati). Pattern wrapper come axon_stress_test.
import re as _blk_re

_BLK_OPEN_RE = _blk_re.compile(r"^\s*(?:axon[,!]?\s*)?(?:apri|aprimi|vai (?:a|su|in|al|alla|nel|nella)|portami (?:a|su|in|al|alla|nel|nella)|mostrami|entra (?:in|nel|nella))\s+(?:il |la |lo |l')?(?:blocco |sezione |modulo )?(?P<name>[\w' ]{2,40}?)\s*[\.\!\?]*\s*$", _blk_re.I)
_blocks_prev_nav_intercept = _nav_intercept  # noqa: F821 — axon_navigator / axon_stress_test


def _blk_find(name: str):
    n = name.strip().lower()
    for b in BLOCKS_CATALOG:
        if n == b["label"].lower():
            return b, None
        for c in b.get("children", []):
            if n == c["label"].lower() or n == f"{b['label']} {c['label']}".lower():
                return b, c
    return None, None


async def _nav_intercept(msg: str, user: dict):  # noqa: F811
    m = _BLK_OPEN_RE.match(msg or "")
    if m:
        b, c = _blk_find(m.group("name"))
        if b:
            if b["key"] in await blocks_enabled_for_tenant(tenant_id(user)):  # noqa: F821
                tgt = c or b
                return _nav_reply(f"Ecco {tgt['label']}" + (f" (blocco {b['label']})" if c else "") + ":\n" + f"[[NAV:/blocchi/{tgt['key']}|{tgt['label']}]]")  # noqa: F821
            return _nav_reply(f"Il blocco «{b['label']}» non è incluso nella tua licenza: chiedi al SuperMaster di attivarlo dal pannello «Blocchi per licenza».")  # noqa: F821
    return await _blocks_prev_nav_intercept(msg, user)

_blocks_prev_prepare_prompt = _prepare_assistant_prompt  # noqa: F821 — 21_axon_streaming (namespace condiviso)


def blocks_prompt_section(enabled: Set[str]) -> str:
    on = [b for b in BLOCKS_CATALOG if b["key"] in enabled]
    off = [b["label"] for b in BLOCKS_CATALOG if b["key"] not in enabled]
    if on:
        rows = "; ".join(f"{b['label']} → [[NAV:/blocchi/{b['key']}|{b['label']}]]" + (" (sottovoci: " + ", ".join(f"{c['label']} → [[NAV:/blocchi/{c['key']}|{c['label']}]]" for c in b["children"]) + ")" if b.get("children") else "") for b in on)
        txt = f"🧩 BLOCCHI attivi per questa organizzazione (menu «BLOCCHI»): {rows}. Per «apri <sottovoce>» usa il marker ESATTO della sottovoce (es. Fotovoltaico → /blocchi/energia_fotovoltaico), non quello del blocco padre."
    else:
        txt = "🧩 BLOCCHI: nessun blocco attivo per questa organizzazione (la sezione «BLOCCHI» non compare nel menu)."
    if off:
        txt += f" Blocchi NON inclusi nella licenza: {', '.join(off)} — non proporli né linkarli; se l'utente li chiede: «non è incluso nella tua licenza, chiedi al SuperMaster di attivarlo»."
    return "\n\n" + txt + "\n"


async def _prepare_assistant_prompt(user: dict, body) -> dict:  # noqa: F811
    prep = await _blocks_prev_prepare_prompt(user, body)
    try:
        if isinstance(prep, dict) and prep.get("system_message") and not prep.get("listino_lock"):
            prep["system_message"] += blocks_prompt_section(await blocks_enabled_for_tenant(tenant_id(user)))  # noqa: F821
    except Exception as exc:  # noqa: BLE001
        logger.warning("[blocchi] prompt failed: %s", exc)  # noqa: F821
    return prep

# home_layout.py — V50.z505 — Home personalizzabile (Super Master): quali blocchi mostrare, in che ordine e in che posizione
# (sinistra / destra / larghezza intera) sulla Home web. Registro dei blocchi = fonte di verità: ogni blocco futuro va aggiunto
# a HOME_BLOCKS e compare automaticamente nelle Impostazioni (merge con i default al momento della lettura).
# Salvataggio per account in user_settings.home_layout (chiave user_id). Lettura libera (tutti), scrittura SOLO Super Master.
# Endpoint: GET /home/layout → {allowed, blocks[]} · PUT /home/layout {blocks:[{id, visible, pos}]} · DELETE /home/layout (ripristina).
from typing import List as _hl_List, Optional as _hl_Optional

HOME_BLOCK_POSITIONS = ("left", "right", "full")

# Ordine di default richiesto il 09/10/2026: Master, PUN, Ritelefonate | Appuntamenti, Calendario, Statistiche, Scadenze, Comunica.
HOME_BLOCKS: _hl_List[dict] = [
    {"id": "master",       "label": "Interfaccia Master",        "hint": "Bottone verso agenda, contatti, contratti e team (solo titolare)", "pos": "full"},
    {"id": "pun",          "label": "PUN energia",               "hint": "PUN aggiornato e gli altri widget dashboard (allerte meteo, Corporate Gym)", "pos": "full"},
    {"id": "callbacks",    "label": "Ritelefonate di oggi",      "hint": "Elenco delle ritelefonate del giorno per area", "pos": "left"},
    {"id": "appointments", "label": "Appuntamenti di oggi",      "hint": "Conteggio appuntamenti di oggi → calendario", "pos": "right"},
    {"id": "calendar",     "label": "Calendario",                "hint": "Calendario mensile compatto con i giorni che hanno appuntamenti", "pos": "full"},
    {"id": "stats",        "label": "Statistiche",               "hint": "KPI e grafici di appuntamenti e ritelefonate", "pos": "full"},
    {"id": "deadlines",    "label": "Scadenze",                  "hint": "Scadenze bollette/contratti entro 30-180 giorni", "pos": "full"},
    {"id": "company",      "label": "Comunica con l'azienda",    "hint": "Numeri di servizio e contatti aziendali", "pos": "full"},
    {"id": "beta",         "label": "Programma Beta",            "hint": "Missione della settimana e Diario del venerdì (visibile solo se il programma è attivo)", "pos": "full"},
]


class HomeBlockIn(BaseModel):  # noqa: F821
    id: str
    visible: bool = True
    pos: str = "full"


class HomeLayoutIn(BaseModel):  # noqa: F821
    blocks: _hl_List[HomeBlockIn]


def _hl_merge(saved: _hl_Optional[_hl_List[dict]]) -> _hl_List[dict]:
    """Ordine/visibilità/posizione salvati + blocchi nuovi (non ancora in DB) accodati con i loro default."""
    meta = {b["id"]: b for b in HOME_BLOCKS}
    out: _hl_List[dict] = []
    seen: set = set()
    for s in saved or []:
        bid = s.get("id") if isinstance(s, dict) else None
        if bid not in meta or bid in seen:
            continue
        seen.add(bid)
        pos = s.get("pos") if s.get("pos") in HOME_BLOCK_POSITIONS else meta[bid]["pos"]
        out.append({**meta[bid], "visible": bool(s.get("visible", True)), "pos": pos})
    for b in HOME_BLOCKS:
        if b["id"] not in seen:
            out.append({**b, "visible": True})
    for i, b in enumerate(out):
        b["order"] = i
    return out


@api_router.get("/home/layout")  # noqa: F821
async def home_layout_get(user=Depends(get_current_user)):  # noqa: F821
    doc = await db.user_settings.find_one({"user_id": user["user_id"]}, {"home_layout": 1, "_id": 0})  # noqa: F821
    saved = (doc or {}).get("home_layout")
    return {"allowed": is_super_admin(user), "customized": bool(saved), "blocks": _hl_merge(saved)}  # noqa: F821


@api_router.put("/home/layout")  # noqa: F821
async def home_layout_put(body: HomeLayoutIn, user=Depends(require_super_admin)):  # noqa: F821
    known = {b["id"] for b in HOME_BLOCKS}
    clean: _hl_List[dict] = []
    seen: set = set()
    for b in body.blocks:
        if b.id not in known or b.id in seen:
            continue
        if b.pos not in HOME_BLOCK_POSITIONS:
            raise HTTPException(status_code=400, detail=f"Posizione non valida per «{b.id}»: {b.pos}")  # noqa: F821
        seen.add(b.id)
        clean.append({"id": b.id, "visible": bool(b.visible), "pos": b.pos})
    await db.user_settings.update_one({"user_id": user["user_id"]}, {"$set": {"home_layout": clean}}, upsert=True)  # noqa: F821
    return {"allowed": True, "customized": True, "blocks": _hl_merge(clean)}


@api_router.delete("/home/layout")  # noqa: F821
async def home_layout_reset(user=Depends(require_super_admin)):  # noqa: F821
    await db.user_settings.update_one({"user_id": user["user_id"]}, {"$unset": {"home_layout": ""}})  # noqa: F821
    return {"allowed": True, "customized": False, "blocks": _hl_merge(None)}

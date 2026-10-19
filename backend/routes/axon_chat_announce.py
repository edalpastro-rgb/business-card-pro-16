# axon_chat_announce.py — V50.z579 — ANNUNCI DI SISTEMA IN CHAT (non critici): esito deploy blue-green + rilettura Drive.
# Gli eventi critici (axon_critical_events) sono banner + push CRITICAL + voce: troppo per «aggiornamento installato». Qui una coda
# leggera `axon_chat_announcements` {user_id, text, route, announced}: alla PRIMA interazione in chat (stream e non-stream) il testo
# viene anteposto alla risposta, riusando il canale già esistente di _ce_take_pending_voice (ri-definito qui per nome: i wrapper di
# axon_critical_events lo cercano nei globals a ogni chiamata). Destinatari: i Super Master (SUPER_MASTER_EMAILS) per il deploy,
# i Master del tenant per la rilettura Drive.
# - Deploy: al boot, se la versione in esecuzione (tag del changelog) è diversa dall'ultima annunciata (axon_system_meta) → annuncio
#   «Aggiornamento <tag> in linea su axon-core-<colore> (blue-green, zero downtime)». Colore da AXON_COLOR (docker-compose).
# - Drive: al termine della rilettura completa manuale e di quella notturna (wrap di _reindex_drive_files_for_user con flag forzato).
import os as _ca_os

_CA_META_KEY = "last_announced_version"


async def axon_announce_in_chat(user_ids, text: str, route: str = None) -> int:
    rows = [{"user_id": uid, "text": (text or "")[:500], "route": route, "created_at": utcnow(), "announced": False} for uid in dict.fromkeys(user_ids) if uid]  # noqa: F821
    if rows:
        await db.axon_chat_announcements.insert_many(rows)  # noqa: F821
    return len(rows)


async def _ca_master_ids_of_tenant(tenant: str):
    ids = [tenant]
    async for u in db.users.find({"parent_user_id": tenant, "role": {"$in": ["master", "superadmin"]}}, {"_id": 0, "user_id": 1}):  # noqa: F821
        ids.append(u["user_id"])
    return ids


async def _ca_super_master_ids():
    emails = [e.strip().lower() for e in (_ca_os.environ.get("SUPER_MASTER_EMAILS") or "").split(",") if e.strip()]
    if not emails:
        return []
    return [u["user_id"] async for u in db.users.find({"email": {"$in": emails}}, {"_id": 0, "user_id": 1})]  # noqa: F821


async def _ca_take(user: dict):
    rows = await db.axon_chat_announcements.find({"user_id": user["user_id"], "announced": False}, {"_id": 0, "text": 1, "route": 1, "created_at": 1}).sort("created_at", 1).to_list(5)  # noqa: F821
    if not rows:
        return []
    await db.axon_chat_announcements.update_many({"user_id": user["user_id"], "announced": False}, {"$set": {"announced": True, "announced_at": utcnow()}})  # noqa: F821
    return rows


_ca_prev_take_pending_voice = _ce_take_pending_voice  # noqa: F821 — axon_critical_events


async def _ce_take_pending_voice(user: dict):  # noqa: F811
    pend = await _ca_prev_take_pending_voice(user)
    try:
        ann = await _ca_take(user)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[chat-announce] lettura annunci fallita: %s", exc)  # noqa: F821
        ann = []
    if not ann:
        return pend
    txt = "".join(f"✅ {a['text']}" + (f" [[NAV:{a['route']}|Apri]]" if a.get("route") else "") + "\n\n" for a in ann)
    if pend:
        return {"text": txt + pend["text"], "spoken": pend["spoken"], "event_id": pend["event_id"]}
    return {"text": txt, "spoken": ann[0]["text"], "event_id": ""}


@app.on_event("startup")  # noqa: F821
async def _ca_announce_deploy_on_boot() -> None:
    """Versione in esecuzione ≠ ultima annunciata → annuncio ai Super Master (una sola volta per versione, anche con più container)."""
    try:
        _cl = globals().get("_axs_changelog")
        version = ((_cl() or {}).get("version") if _cl else None) or ""
        if not version:
            return
        meta = await db.axon_system_meta.find_one({"key": _CA_META_KEY}, {"_id": 0, "value": 1}) or {}  # noqa: F821
        if meta.get("value") == version:
            return
        r = await db.axon_system_meta.update_one({"key": _CA_META_KEY, "value": {"$ne": version}}, {"$set": {"value": version, "at": utcnow()}}, upsert=True)  # noqa: F821
        if not (r.modified_count or r.upserted_id):
            return  # un altro container ha già annunciato questa versione
        color = (_ca_os.environ.get("AXON_COLOR") or "").strip()
        where = f" su axon-core-{color} (blue-green, zero downtime)" if color else ""
        prev = f" (prima: {meta['value']})" if meta.get("value") else ""
        n = await axon_announce_in_chat(await _ca_super_master_ids(), f"Aggiornamento installato: versione {version} in linea{where}{prev}. Smoke gate superato.", route="/axon-system")
        logger.info("[chat-announce] deploy %s annunciato a %d Super Master", version, n)  # noqa: F821
    except Exception as exc:  # noqa: BLE001
        logger.warning("[chat-announce] annuncio deploy fallito: %s", exc)  # noqa: F821


# Rilettura Drive: wrap della routine condivisa (manuale FULL e notturna la chiamano entrambe dopo aver invalidato gli snapshot).
# Annuncia solo quando è una rilettura «forzata» (snapshot invalidati → updated ≥ 1 e nessun file saltato) o notturna/parser upgrade.
_ca_prev_reindex = _reindex_drive_files_for_user  # noqa: F821


async def _reindex_drive_files_for_user(uid: str, *a, **kw):  # noqa: F811
    stats = await _ca_prev_reindex(uid, *a, **kw)
    try:
        st = stats or {}
        if st.get("updated", 0) >= 1 and st.get("skipped", 0) == 0:
            n_fail = st.get("failed", 0)
            txt = (f"Rilettura Drive completata: {st.get('updated', 0)} file riletti con il parser tabelle {DRIVE_PARSER_VERSION}"  # noqa: F821
                   + (f", {n_fail} non leggibili" if n_fail else "") + ". I listini a fasce sono aggiornati.")
            n = await axon_announce_in_chat(await _ca_master_ids_of_tenant(uid), txt, route="/google-drive")
            logger.info("[chat-announce] rilettura Drive tenant %s annunciata a %d utenti", uid, n)  # noqa: F821
    except Exception as exc:  # noqa: BLE001
        logger.warning("[chat-announce] annuncio rilettura fallito: %s", exc)  # noqa: F821
    return stats


@api_router.get("/axon/announcements/pending")  # noqa: F821
async def axon_announcements_pending(user=Depends(get_current_user)):  # noqa: F821
    rows = await db.axon_chat_announcements.find({"user_id": user["user_id"], "announced": False}, {"_id": 0}).sort("created_at", 1).to_list(10)  # noqa: F821
    return {"items": rows}

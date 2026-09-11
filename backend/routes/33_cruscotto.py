# 33_cruscotto.py — Master Dashboard Cruscotto
# Estratto da server.py (righe originali 23159-23287). Caricato da server.py nel
# namespace condiviso: le definizioni di TUTTI i moduli sono visibili qui (nessun import necessario).
# V45 — Master Dashboard "Cruscotto"
# Aggrega in un unico payload:
#  - Feedback stats (👍/👎) tenant-wide 30gg
#  - Proposte pending
#  - Top 5 collaboratori attivi (+ mini KPI)
#  - Totali (contatti/appuntamenti/callbacks tenant-wide 30gg)
#  - Documenti Axon + regole attive
#  - Semantic cache size (metrica di health)
# =========================================================================

@api_router.get("/master/dashboard")
async def master_dashboard(user=Depends(get_current_user)):
    """Master-only. Cruscotto tenant-wide."""
    _require_master(user)
    tid = tenant_id(user)
    now = utcnow()
    d30 = now - timedelta(days=30)

    # Tenant users (Master + collabs)
    tenant_user_ids: List[str] = await db.users.distinct(
        "user_id", {"$or": [{"user_id": tid}, {"parent_user_id": tid}]}
    )
    collab_ids = [uid for uid in tenant_user_ids if uid != tid]

    # Feedback stats tenant-wide 30gg
    fb_ups = await db.assistant_feedback.count_documents(
        {"user_id": {"$in": tenant_user_ids}, "rating": "up", "updated_at": {"$gte": d30}}
    )
    fb_downs = await db.assistant_feedback.count_documents(
        {"user_id": {"$in": tenant_user_ids}, "rating": "down", "updated_at": {"$gte": d30}}
    )
    fb_total = fb_ups + fb_downs

    # Proposals pending
    proposals_pending = await db.axon_rule_proposals.count_documents(
        {"tenant_id": tid, "status": "pending"}
    )
    proposals_accepted = await db.axon_rule_proposals.count_documents(
        {"tenant_id": tid, "status": "accepted"}
    )

    # Tenant totals 30gg
    contacts_30d = await db.contacts.count_documents(
        {"user_id": {"$in": tenant_user_ids}, "created_at": {"$gte": d30}}
    )
    contacts_total = await db.contacts.count_documents({"user_id": {"$in": tenant_user_ids}})
    appts_30d = await db.appointments.count_documents(
        {"user_id": {"$in": tenant_user_ids}, "date": {"$gte": d30}}
    )
    appts_upcoming = await db.appointments.count_documents(
        {"user_id": {"$in": tenant_user_ids}, "date": {"$gte": now}}
    )
    callbacks_pending = await db.callbacks.count_documents(
        {"user_id": {"$in": tenant_user_ids}, "status": {"$ne": "done"}}
    )
    chat_msgs_30d = await db.assistant_messages.count_documents(
        {"user_id": {"$in": tenant_user_ids}, "role": "user", "created_at": {"$gte": d30}}
    )

    # Knowledge base sizes
    docs_count = await db.master_documents.count_documents({"tenant_id": tid})
    rules_count = await db.ai_teach_rules.count_documents({"user_id": tid})
    urls_count = await db.ai_teach_urls.count_documents({"user_id": tid}) if hasattr(db, "ai_teach_urls") else 0

    # Semantic cache (global — same for everyone)
    sem_cache_size = await db.axon_semantic_cache.count_documents({"expires_at": {"$gt": now}})

    # Top 5 collabs by chat activity 30gg
    top_collabs: List[dict] = []
    if collab_ids:
        collab_docs = await db.users.find(
            {"user_id": {"$in": collab_ids}},
            {"_id": 0, "user_id": 1, "name": 1, "email": 1, "picture": 1, "areas": 1},
        ).to_list(500)
        for m in collab_docs:
            metrics = await _compute_team_member_metrics(m["user_id"])
            top_collabs.append({
                "user_id": m["user_id"],
                "name": m.get("name") or "",
                "email": m.get("email") or "",
                "picture": m.get("picture"),
                "areas": m.get("areas") or [],
                "chat_msgs_30d": metrics.get("chat_msgs_30d", 0),
                "appts_30d": metrics.get("appts_30d", 0),
                "contacts_total": metrics.get("contacts_total", 0),
                "last_active_at": metrics.get("last_active_at"),
            })
        top_collabs.sort(
            key=lambda x: (x.get("chat_msgs_30d", 0), x.get("appts_30d", 0)),
            reverse=True,
        )
        top_collabs = top_collabs[:5]

    return {
        "feedback": {
            "ups": fb_ups,
            "downs": fb_downs,
            "total": fb_total,
            "satisfaction_rate": round((fb_ups / fb_total) * 100.0, 1) if fb_total else None,
            "window_days": 30,
        },
        "proposals": {
            "pending": proposals_pending,
            "accepted_total": proposals_accepted,
        },
        "activity": {
            "contacts_30d": contacts_30d,
            "contacts_total": contacts_total,
            "appts_30d": appts_30d,
            "appts_upcoming": appts_upcoming,
            "callbacks_pending": callbacks_pending,
            "chat_msgs_30d": chat_msgs_30d,
        },
        "knowledge": {
            "docs_count": docs_count,
            "rules_count": rules_count,
            "urls_count": urls_count,
            "semantic_cache_size": sem_cache_size,
        },
        "team": {
            "collaborators_total": len(collab_ids),
            "top_active": top_collabs,
        },
        "generated_at": now.isoformat(),
    }



# =========================================================================

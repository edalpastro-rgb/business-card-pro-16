# admin_reset.py — V50.z288 — «Azzera dati di test» (solo Master, conferma testuale).
# Cancella per il tenant: clienti e tutto ciò che è legato ai clienti, calendario, sveglie/timer, aree/categorie/gruppi,
# profilo Master e profili team. MANTIENE: tutto ciò che riguarda Axon (chat, regole, KB, documenti insegnati, link, memoria,
# script, cheat sheet, offerte, file Master, modelli moduli, ordine CRT, impostazioni voce/tour/interessi), accessi
# (Drive/Dropbox/Outlook/mail/SMTP), utenti/collaboratori, dispositivi e branding.

class AdminResetIn(BaseModel):
    confirm: str  # deve essere esattamente "AZZERA"


# collezioni → chiavi con cui sono legate al tenant/utenti del team
_RESET_BY_TEAM_USER = [  # documenti con user_id / created_by / tenant_id di un utente del team
    "contacts", "contact_notes", "contact_visits", "visit_candidates", "callbacks", "call_logs", "business_cards", "business_card_views",
    "identity_documents", "energy_bills", "bill_drafts", "contracts", "filled_forms", "crt_practices", "review_requests", "reviews",
    "birthday_messages", "invites", "appointments", "axon_proactive_reminders", "geo_routes", "geo_km_log", "axon_alarms", "groups",
    "axon_custom_areas", "axon_area_profiles", "contact_custom_field_defs", "master_profiles", "team_member_profiles", "info_requests",
    "public_leads", "audio_records", "my_thing", "axon_alerts", "axon_expenses", "axon_expense_reports", "axon_statement_reports",
    "offline_ops", "offline_conflicts",
    "axon_notifications", "axon_proactive_log",  # segnalazioni/promemoria proattivi su clienti ormai cancellati (non è apprendimento)
]
_RESET_BY_CONTACT = ["contact_doc_facts", "contact_notes", "energy_bills", "callbacks", "call_logs", "appointments", "identity_documents", "birthday_messages", "review_requests", "reviews", "contracts", "filled_forms", "crt_practices", "bill_drafts"]


@api_router.post("/admin/reset-test-data")
async def admin_reset_test_data(body: AdminResetIn, user=Depends(get_current_user)):
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master può azzerare i dati")
    if (body.confirm or "").strip().upper() != "AZZERA":
        raise HTTPException(status_code=400, detail="Scrivi AZZERA per confermare")
    tenant = tenant_id(user)
    team = [tenant] + await descendant_user_ids(tenant)
    contact_ids = [c["contact_id"] for c in await db.contacts.find({"$or": [{"user_id": {"$in": team}}, {"created_by": {"$in": team}}, {"tenant_id": tenant}]}, {"_id": 0, "contact_id": 1}).to_list(100000)]
    deleted: Dict[str, int] = {}
    for col in _RESET_BY_CONTACT:
        if contact_ids:
            r = await db[col].delete_many({"contact_id": {"$in": contact_ids}})
            deleted[col] = deleted.get(col, 0) + r.deleted_count
    for col in _RESET_BY_TEAM_USER:
        r = await db[col].delete_many({"$or": [{"tenant_id": tenant}, {"user_id": {"$in": team}}, {"created_by": {"$in": team}}, {"owner_id": {"$in": team}}]})
        deleted[col] = deleted.get(col, 0) + r.deleted_count
    # flag di onboarding/wizard aree: si riparte dal principio (le impostazioni voce/tour/interessi restano)
    await db.user_settings.update_many({"user_id": {"$in": team}}, {"$unset": {"areas_setup_done": "", "onboarding_done": "", "wizard_done": ""}})
    logger.warning("[admin] reset test data by %s tenant=%s deleted=%s", user["user_id"], tenant, {k: v for k, v in deleted.items() if v})
    return {"ok": True, "deleted": {k: v for k, v in deleted.items() if v}, "total": sum(deleted.values()), "contacts": len(contact_ids)}

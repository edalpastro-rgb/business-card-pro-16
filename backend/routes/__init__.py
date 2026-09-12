"""Moduli del backend AdvisorOS (split di server.py — V50.z161).

Ordine di caricamento OBBLIGATORIO: server.py esegue i file in questa sequenza nel
proprio namespace globale (stessa semantica del monolite originale: ordine di
registrazione route, modelli definiti prima dell'uso, side-effect a import time).
Per aggiungere un modulo: crearlo in routes/ e inserirlo QUI nella posizione corretta.
"""
MODULES = [
    "00_core.py",
    "01_helpers.py",
    "02_models.py",
    "03_auth.py",
    "04_settings_dashboard.py",
    "05_push_object_storage.py",
    "06_team.py",
    "07_contacts.py",
    "08_calendar.py",
    "09_callbacks_calls_reports.py",
    "10_invites_groups_smtp_bulk.py",
    "11_team_chat_vcard_mything.py",
    "12_ai_contact_copilot.py",
    "13_bills.py",
    "14_deadlines_axon_analysis.py",
    "15_cte_quick_bills.py",
    "16_master_files_business_card.py",
    "17_company_offers_docs.py",
    "18_master_interface.py",
    "19_axon_assistant_core.py",
    "20_axon_memory.py",
    "axon_crm_omniscience.py",  # V50.z180 — Axon vede tutte le sezioni (DATI COMPLETI CRM + mappa app); usato da 21
    "21_axon_streaming.py",
    "22_axon_alarm_commit_teach.py",
    "23_axon_feedback_rag_rules.py",
    "24_axon_quick_actions_memory.py",
    "25_health_birthday_banners.py",
    "26_scanner.py",
    "27_teach_ai_kb.py",
    "28_google_drive.py",
    "29_dropbox.py",
    "30_support_help_alerts.py",
    "31_mail_imap_autocrm_outlook.py",
    "32_team_profile.py",
    "33_cruscotto.py",
    "34_alarms_homeassistant.py",
    "35_reviews_leads.py",
    "36_admin_clients.py",
    "36b_axon_pdf_link_parser.py",  # V50.z164 — modulo isolato (wrap di _build_axon_teach_section)
    "corporate_gym.py",  # Corporate Gym (Blocco 1) — modulo isolato, collection cgym_* (PRIMA di 37: include_router)
    "corporate_gym_manuals.py",  # Corporate Gym · Manuali Google Drive (AxonOS) — modulo isolato, dipende da 28_google_drive
    "axon_notifications.py",  # V50.z181 — Notifiche push AxonOS (isolato; usa send_push di 05, cgym_weekly_report, _bill_deadline_entry)
    "axon_chat_push.py",  # V50.z184 — Axon invia push in autonomia dalla chat: consegna server-side promemoria/timer + comandi push (isolato; dopo axon_notifications e 34)
    "master_docs_files.py",
    "auth_quick_unlock.py",
    "axon_self_learning.py",
    "axon_memory.py",  # V50.z192 — Blocco 9b: "Cosa sa Axon di me" memoria visibile/controllabile (isolato; dopo axon_self_learning, avvolge _build_crm_omniscience_section)  # V50.z188 — Blocco 7: autoapprendimento anonimizzato AxonOS (isolato; usa _axn_scheduler, avvolge _build_crm_omniscience_section)  # V50.z187 — Accesso rapido login (impronta/Face ID/PIN) con dispositivo fidato (isolato; usa create_jwt, UserOut)  # V50.z185 — Knowledge Base: PDF originale su Object Storage + link firmato + testo estratto (isolato; usa 05 storage, _cgym_man_base_url)
    "axon_push_bridge.py",  # V50.z193 — Bridge persistente AxonOS → Push Service: wrapper send_push (esito reale + outbox retry), push_devices, diagnostica, test programmato (isolato; dopo axon_chat_push, prima di 37)
    "axon_imported_data.py",  # V50.z194 — Dati importati da PDF/Excel/CSV memorizzati su conferma («Vuoi che memorizzi…?»), condivisi col team, iniettati nelle chat, gestiti in Memoria AxonOS (isolato; avvolge _build_attachments_section_advanced, _prepare_assistant_prompt, _maybe_push_command)
    "axon_proactive.py",  # V50.z196 — Blocco 9: proattività AxonOS (briefing 07:30, suggerimenti max N/g, alert critici, report lunedì, promemoria proattivi, trigger ViolaWake-ready) (isolato; dopo axon_imported_data, avvolge _prepare_assistant_prompt e _maybe_push_command)
    "axon_integrations.py",  # V50.z197 — Blocco 8 Fase 1: hub Integrazioni a due sfere (Google Calendar/Contacts per sfera, refs, contesto) (isolato; riusa OAuth Drive, avvolge _prepare_assistant_prompt)
    "axon_expenses.py",  # V50.z198 — Blocco 8 Fase 2: scontrini → nota spese per sfera (PDF), estratto conto → report (isolato; Gemini vision, Object Storage, avvolge _maybe_push_command)
    "axon_media.py",  # V50.z199 — Blocco 8 Fase 3: archivio intelligente foto/audio/video a due sfere («Privata o aziendale?», Whisper + Gemini, ricerca, reminder Non classificato) (isolato; avvolge _maybe_push_command e _prepare_assistant_prompt)
    "37_app_startup_scheduler.py",
]

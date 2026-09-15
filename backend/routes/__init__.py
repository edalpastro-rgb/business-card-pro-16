"""Moduli del backend AdvisorOS (split di server.py — V50.z161).

Ordine di caricamento OBBLIGATORIO: server.py esegue i file in questa sequenza nel
proprio namespace globale (stessa semantica del monolite originale: ordine di
registrazione route, modelli definiti prima dell'uso, side-effect a import time).
Per aggiungere un modulo: crearlo in routes/ e inserirlo QUI nella posizione corretta.
"""
MODULES = [
    "00_core.py",
    "01_helpers.py",
    "01b_heavy_bridge.py",  # V50.z210 — heavy_call/heavy_call_sync → sottoprocesso workers/heavy_worker.py (cv2/fitz/pdfplumber MAI nel processo API)
    "01c_field_crypto.py",  # V50.z217 — cifratura trasparente a livello di campo di master_profiles (CF, data di nascita, indirizzi, telefono): proxy su db.master_profiles + migrazione all'avvio
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
    "corporate_gym_config.py",  # V50.z203 — Pannello Master Coach: override role-play (testo, immagine, durata, interventi, checklist, cliente simulato, manuale) + fasi di sessione con riferimento Drive; ridefinisce _cgym_scenario_for
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
    "axon_expense_history.py",  # V50.z229 — storico spese: selezione/scarto, chiusura mese → PDF in Master Files (spese/anno/mese), archivio, statistiche e insight comportamentali
    "axon_media.py",  # V50.z199 — Blocco 8 Fase 3: archivio intelligente foto/audio/video a due sfere («Privata o aziendale?», Whisper + Gemini, ricerca, reminder Non classificato) (isolato; avvolge _maybe_push_command e _prepare_assistant_prompt)
    "axon_system_awareness.py",  # V50.z200 — Axon vede il backend in tempo reale: eventi API/log/deploy/job, versioni app installate (heartbeat) + alert «app aggiornata», CHANGELOG nel prompt, stato sistema (isolato; middleware HTTP, logging handler, avvolge _maybe_push_command e _prepare_assistant_prompt)
    "axon_drive_root.py",  # V50.z201 — Drive: file ROOT sempre visibili ([ROOT FILES] nel prompt), shortcut risolti, OCR Gemini per PDF senza testo, retry download (isolato; ridefinisce _drive_walk_and_collect/_drive_download_text, avvolge _reindex_drive_files_for_user e _fetch_teach_drive_pdfs_for_query)
    "axon_uploads.py",  # V50.z202 — Upload multipart a chunk (Master Files → Object Storage, solo riferimento in Mongo; trascrizione Whisper da file) (isolato; usato anche dalla patch JSON legacy in 16)
    "axon_personal_space.py",  # V50.z205 — Blocco 8 Fase 4: «Spazio Personale» Sfera Home (riepilogo hub, audio personali con sfera + trascrizione automatica, tag sfera su ogni voce della memoria Axon) (isolato; hook _audio_record_hooks di 18, avvolge _am_analyze e _maybe_push_command)
    "axon_pun_quick.py",  # V50.z206 — Azioni Rapide PUN come calcolatore: job giornaliero GME (anche anni passati) → gme_pun_cache, GET /quick-action/pun-18 JSON+Markdown pronti, hook _qa_deterministic di 24, chat «tabella pun…», regole assolute anti-allucinazione nel prompt (isolato; avvolge _maybe_push_command e _prepare_assistant_prompt)
    "axon_quick_reply.py",  # V50.z207 — Pulsanti Sì/No/Forse sulle domande chiuse di Axon: POST /axon/quick-reply (log) + nota nel prompt per interpretare la risposta breve come risposta all'ultima domanda (isolato; avvolge _prepare_assistant_prompt)
    "axon_app_info.py",  # V50.z208 — Profilo: piano attivo + versione APK installata/disponibile (GET /axon/app-info, PUT /axon/app-info/plan) (isolato; legge axon_client_versions e app.json)
    "axon_setup_wizard.py",  # V50.z211 — Wizard onboarding «Set Up and Go»: stato per utente (GET/PUT /axon/setup/state, nudge, reset) + avviso Axon in chat se la configurazione manca (isolato; avvolge _prepare_assistant_prompt)
    "axon_wizard_anagrafica.py",  # V50.z212 — Blocco 2 Step 1: decodifica codice fiscale, anagrafica nel prompt (mai richiedere), chat → Anagrafica (isolato; avvolge _prepare_assistant_prompt e _maybe_push_command)
    "axon_wizard_sphere.py",  # V50.z214 — Blocco 3 Step 2+3: sfera obbligatoria (business|home|both) + catalogo aree con switch e interessi futuri (GET /axon/setup/areas, PUT /axon/setup/sphere-areas) (isolato; avvolge _prepare_assistant_prompt)
    "axon_wizard_talk.py",  # V50.z215 — Blocco 4 Step 4 «Parla a Neo»: testo/file multipart 50MB/audio Whisper → Neo estrae proposte (mail principale, indirizzo, …) + fatti; confirm un tap → master_profiles/users/axon_user_memory (isolato; riusa axon_uploads, heavy_call, _axm_llm_json)
    "axon_tone_level.py",  # V50.z218 — Blocco 6: tono AxonOS a 5 livelli (5 = Fantasiosa), fallback automatico al professionale nei contesti formali, comando «forza tono informale» (GET/PUT /axon/tone-level) (isolato; avvolge _prepare_assistant_prompt)
    "axon_wizard_complete.py",  # V50.z216 — Blocco 5: completamento wizard (messaggio personalizzato, stats), Profilo → «La mia configurazione Set Up» (GET /axon/setup/config, POST /axon/setup/reopen), FAQ post-wizard nel prompt Axon (isolato; avvolge _prepare_assistant_prompt)
    "axon_push_urgency.py",  # V50.z220 — push a livelli di urgenza CRITICAL/HIGH/NORMAL: canali Android urgent_alerts/standard_alerts/default, campi iOS-ready, helper send_critical_alert/send_standard_notif, wrapper send_push (dopo axon_push_bridge)
    "axon_ops_status.py",  # V50.z222 — autonomia Axon: GET /integrations/outbox/status|recent (message_id per ogni push), GET /jobs/gme-fetcher/status (+run), POST /notify, wrapper _punq_refresh (durata/errori/timeout 20s), sezione prompt live (dopo axon_push_urgency)
    "axon_chat_queue.py",  # V50.z223 — chat non bloccante: coda messaggi con priorità (POST /chat/messages, GET/PATCH/DELETE /chat/queue, /chat/queue/next) + tab = sessioni (GET/POST/PATCH /chat/tabs)
    "axon_area_wizard.py",  # V50.z227 — mini-wizard per area (upload OCR/AI → campi precompilati, cartella personale/lavoro/famiglia), profili area, aree custom, promemoria scadenze 30/15/7/0, prompt PROFILI AREA + marker [[CONFIGURA:key]] (dopo alarms/chat_push/wizard_talk)
    "axon_org_branding.py",  # V50.z232 — Personalizzazione Aziendale: logo header per tenant + ragione sociale/P.IVA/indirizzo → firma PDF/documenti/comunicazioni (wrap _prepare_assistant_prompt)
    "axon_personal_lock.py",  # V50.z237 — PIN 6 cifre server-side per Spazio Personale (set/verify/change), rate limit, «Ho dimenticato il PIN» via Emergent Resend → fallback SMTP tenant (isolato)
    "axon_neo_bridge.py",  # V50.z239 — «Prompt per Neo»: comando chat «invia … a Neo» → Master Files category neo_prompts (pending/read/done), «stato prompt Neo», regola prompt anti-allucinazione «nessun canale diretto con Neo», API /neo-bridge/prompts (avvolge _maybe_push_command e _prepare_assistant_prompt; dopo tutti i wrapper)
    "bill_analysis_config.py",  # V50.z251 — Pannello «Configura Analisi Fatture» per tenant: campi estrazione spuntabili, comparativa (layout/stile/sezioni/campi/base), richieste manuali (GET/PUT /bills/analysis-config); usato da 13_bills e 17_company_offers_docs
    "axon_geo_routing.py",  # V50.z240 — FEAT-GEO-001 Fase 1: GET /geo/contacts-map (geocoding cache contacts.geo), POST /geo/optimal-route (NN + 2-opt, geo_routes) (isolato; dopo 07_contacts per _geocode_one)
    "geo_km_log.py",  # V50.z253 — Resoconto Km: visite completate nel Giro Ottimale → km da percorso (POST/GET/DELETE /geo/km-log) (isolato; dopo axon_geo_routing)
    "contact_visits.py",  # V50.z256 — Rilevamento Visite: visite confermate, candidati GPS, frequenza ripasso, /visits/* (isolato; dopo axon_geo_routing e geo_km_log; avvolge _prepare_assistant_prompt)
    "37_app_startup_scheduler.py",
]

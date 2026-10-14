# landing_cms.py — V50.z530 — Landing pubblica «Axon Core» + CMS admin
#
# • GET /public/landing (NESSUN login): contenuti (default + override salvati dal CMS) e contatori «posti Founder rimasti»
#   calcolati in tempo reale: limite − account registrati con quel piano (users.plan: builder | professional; gli account
#   senza piano contano come professional — decisione cliente).
# • CMS: singleton Mongo `landing_content` (_id="global"), stesso pattern del libretto. Protezione DOPPIA: Super Admin
#   (36_admin_clients.require_super_admin) + password dedicata LANDING_CMS_PASSWORD (.env) nell'header X-CMS-Password.
#   GET /landing/cms/content · PUT /landing/cms/content · POST /landing/cms/reset · POST /landing/cms/unlock (verifica password).
import asyncio
import copy
import hashlib
import hmac
import os
import re
import uuid
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from fastapi import Depends, Header, HTTPException
from pydantic import BaseModel, Field

LANDING_DEFAULTS: Dict[str, Any] = {
    "hero": {
        "badge": "🚀 Offerta Lancio: Diventa un Fondatore (Prezzo bloccato per sempre)",
        "title": "L'Intelligenza Artificiale che lavora per te. E custodisce la tua vita.",
        "subtitle": "Scopri l'ecosistema modulare protetto dal GDPR europeo. Fai decollare la tua produttività con il CRM AdvisorOS o custodisci i tuoi ricordi per sempre nel caveau privato di AxonOS. Senza che un solo dato venga mai regalato ai cloud americani.",
        "cta_primary": "Attiva AxonLite (Promo Founder)",
        "cta_secondary": "Scopri AdvisorOS per Professionisti",
        # V50.z545 — fascia numeri sotto le CTA (modificabile dal CMS)
        "stats": [
            {"n": "186", "label": "funzioni integrate tra AdvisorOS e AxonOS", "accent": True},
            {"n": "2", "label": "mondi, un solo cervello italiano", "accent": False},
            {"n": "100%", "label": "dati su server in Italia · GDPR", "accent": False},
        ],
    },
    "worlds": {
        "title": "I due mondi",
        "left_kicker": "AdvisorOS",
        "left_title": "Produttività Aziendale senza Limiti",
        "left_text": "Il CRM intelligente progettato per azzerare i tempi morti. Scannerizza documenti fiscali, compila automaticamente il tuo calendario e riassumi le note dei clienti in tempo reale. Un'AI integrata e potenziata sui nostri server privati, libera dai limiti soffocanti dei software tradizionali.",
        "right_kicker": "AxonOS · AxonLite",
        "right_title": "Il Custode della tua Storia e del tuo Studio",
        "right_text": "Un assistente vocale ambientale con microfono sempre aperto e ascolto locale protetto, pensato per conoscerti intimamente giorno dopo giorno. Carica i tuoi libri di testo, i tuoi appunti privati o le tue riflessioni quotidiane in un'area totalmente blindata e isolata dal mondo, creando la tua vera memoria ereditaria digitale.",
        # V50.z547 — link Vimeo (o YouTube) dei due video: vuoto = placeholder «sarà inserito il link Vimeo»
        "left_video_url": "",
        "right_video_url": "",
    },
    "manifesto": {
        "title": "La tua mente e il tuo lavoro non sono in vendita.",
        "pillars": [
            {"icon": "shield-checkmark", "title": "Privacy Sovrana", "text": "Tutto viene elaborato e protetto su infrastrutture dedicate in Italia (Server Aruba). Nessun dato fa addestramento."},
            {"icon": "wallet", "title": "Zero Costi Nascosti", "text": "Grazie al motore vettoriale proprietario inserito nel Core, carichi e interroghi libri e file fino a 20MB senza spendere patrimoni in token."},
            {"icon": "infinite", "title": "La Memoria ti Segue", "text": "Se chiudi la tua attività lavorativa, l'intelligenza di Core scollega il CRM ma non ti abbandona: tutti i tuoi dati e i tuoi ricordi migrano istantaneamente nella tua app privata AxonOS."},
        ],
    },
    "plans": {
        "title": "Piani Founder",
        "subtitle": "Prezzo bloccato per sempre per i primi 100 di ogni piano.",
        "builder": {
            "badge": "LIMITED FOUNDERS EDITION",
            "name": "Piano Builder Founder",
            "price_old": 25, "price": 19, "limit": 100,
            "features": ["Assistente vocale ambientale", "Area Vita Privata su server italiano", "20MB Knowledge Base (5.000 frammenti vettoriali locali)"],
            "cta": "Blocca il prezzo a 19€",
        },
        "professional": {
            "badge": "PROFESSIONAL FOUNDER",
            "name": "Piano Professional Founder",
            "price_old": 49, "price": 30, "limit": 100,
            "features": ["Tutto il piano Personal incluso", "Ecosistema CRM completo", "Automazione calendario", "Note clienti intelligenti", "Scanner documenti aziendali"],
            "cta": "Blocca il prezzo a 30€",
        },
        "seats_label": "posti rimasti su {limit}",
        "sold_out_label": "Posti Founder esauriti",
    },
    "footer": {"text": "Axon Core · AdvisorOS · AxonOS — Infrastruttura dedicata in Italia, GDPR europeo."},
    # V50.z546 — PAGINE DI APPROFONDIMENTO (italianbrain.it/axonos · /advisoros e, nell'app, /landing/axonos · /landing/advisoros).
    # Stesso singleton del CMS: ogni testo è modificabile da /admin/landing-cms. Le icone sono emoji (identiche su web statico e app).
    "pages": {
        # V50.z549 — struttura aggiornata: hero · dolore · 4 pilastri · Axon Drive & Domotica · onboarding (modal) · tariffa+founder · ponte
        "axon": {
            "hero": {
                "kicker": "AxonOS · Impresa Familiare",
                "title": "AxonOS: L'Assistente Personale Vocale che elimina 100 app e organizza la tua Impresa Familiare.",
                "subtitle": "Smetti di impazzire dietro a mille calendari, note scritte, scontrini e scadenze sanitarie. Riversa tutto dentro il tuo Caveau Digitale protetto su server italiani. Configuralo in meno di 5 minuti, dagli il nome che preferisci e lascia che sia lui a semplificarti la vita quotidiana.",
                "video_label": "[VIDEO 90 secondi — AxonOS in azione: sarà inserito il link Vimeo]",
                "video_url": "",
                "cta": "Attiva AxonOS: Prova Gratuita di 15 Giorni",
                "cta_note": "Nessuna carta di credito richiesta",
            },
            "pain": {
                "kicker": "Il dolore",
                "title": "Lo «Svuotatasche» digitale della famiglia",
                "items": [
                    {"emoji": "📱", "title": "Il Concetto delle 100 app", "text": "L'utente privato vive sommerso da notifiche e app frammentate: note, spese di casa, promemoria farmaci, documenti cartacei. AxonOS centralizza tutto in un unico interlocutore."},
                    {"emoji": "🏠", "title": "La Famiglia è un'Impresa", "text": "Gestire scadenze dei figli, visite e bilancio di casa richiede l'efficacia di un software aziendale, ma con la semplicità di una chiacchierata vocale."},
                ],
            },
            "pillars": {
                "kicker": "I quattro pilastri",
                "title": "Un solo assistente, quattro superpoteri per la tua famiglia",
                "items": [
                    {"emoji": "🗣️", "title": "Assistente Vocale di Casa (Hands-Free)", "text": "Ascolta a mani libere. Riconosce le voci biometriche dei familiari, associando a ciascuno la propria agenda e le proprie abitudini."},
                    {"emoji": "🩺", "title": "Guardiano della Salute e Cartella Clinica", "text": "Foto referti → cartella clinica digitale. Foto ricetta → sveglie e promemoria automatici nel calendario."},
                    {"emoji": "🗄️", "title": "Caveau Documenti", "text": "Archiviazione crittografata, ricerca vocale («Axon, mostrami la patente di papà»). Diario privato e appunti di studio."},
                    {"emoji": "🔮", "title": "Memoria Proattiva per le Spese", "text": "Foto scontrini → bilancio mensile per articoli. Proattivo: «Emanuele, sono 15 giorni che non compri il latte, lo aggiungo alla lista?»"},
                ],
            },
            "drive": {
                "kicker": "Axon Drive & Domotica",
                "title": "Axon Drive & Domotica: dal cruscotto al cancello di casa",
                "intro": "Axon si trasferisce sul grande schermo della vettura e comanda la casa, senza mai passare da cloud americani.",
                "items": [
                    {"emoji": "🖥️", "title": "Interfaccia su CarPlay e Android Auto", "text": "Proietta schede riassuntive scritte sul monitor della vettura: vedi quello che hai chiesto prima che venga salvato."},
                    {"emoji": "✅", "title": "Conferma senza distrazioni", "text": "Confermi con un cenno vocale o un Tap sul display, con gli occhi sulla strada."},
                    {"emoji": "🧭", "title": "Navigazione predittiva", "text": "«Portami da mio figlio», «Vai a Casa 2»: Axon conosce i tuoi luoghi e imposta il percorso."},
                    {"emoji": "🏡", "title": "Integrazione Domotica Privata", "text": "Collegato alla tua VPS italiana senza passare da Cloud americani. «Axon, sto arrivando, apri il cancello elettrico.»"},
                ],
            },
            "onboarding": {
                "kicker": "Onboarding guidato",
                "title": "A prova di nonno, in 5 minuti",
                "text": "Pensi che configurare un assistente familiare sia complicato? Scopri come Axon ti prende per mano e costruisce la tua struttura in meno di 5 minuti.",
                "cta": "🔍 Guarda come funziona l'Onboarding Guidato",
                "modal": {
                    "title": "L'Onboarding Guidato, minuto per minuto",
                    "steps": [
                        {"emoji": "🎙️", "title": "Minuto 1: Riconoscimento Vocale Setup", "text": "L'assistente impara a riconoscere la tua frequenza vocale e quella dei tuoi cari."},
                        {"emoji": "🏷️", "title": "Minuto 2: Personalizzazione del Nome", "text": "Scegli come chiamarlo (Axon, Orsetto, o il nome che preferisci). Risponderà solo a te."},
                        {"emoji": "🔗", "title": "Minuto 3: Sincronizzazione Account", "text": "Colleghi i calendari precedenti (Google o Apple) con un click."},
                        {"emoji": "🗄️", "title": "Minuto 4: Creazione del Caveau", "text": "Carichi il tuo primo documento o scontrino per testare l'assistente fotografico."},
                        {"emoji": "🚀", "title": "Minuto 5: Sei Pronto!", "text": "L'assistente è attivo per comandi vocali in auto e a casa."},
                    ],
                    "close": "✖ Chiudi e torna alla pagina",
                },
            },
            "pricing": {
                "kicker": "Pacchetti e Offerta Soci Fondatori",
                "badge": "TARIFFA UNICA FAMILIARE",
                "title": "Un solo prezzo per tutto il nucleo familiare",
                "text": "Spazio Caveau crittografato su server 100% italiani. 500 interazioni vocali al mese incluse.",
                "bullets": ["Caveau crittografato su server 100% italiani", "500 interazioni vocali al mese incluse", "Partner, figli, nonni: tutti dentro, nessun costo per utente aggiuntivo"],
                "founders_text": "Per i primi 100 iscritti: interazioni ILLIMITATE per sempre non appena si raggiunge il 100° utente, allo stesso prezzo.",
                "highlight": "🔥 Solo {left} posti Founder rimasti su {limit}",
                "cta": "Attiva AxonOS: Prova Gratuita di 15 Giorni",
            },
            "bridge": {
                "kicker": "Lavori nel commerciale?",
                "title": "AdvisorOS: il sistema operativo da campo per il consulente",
                "text": "Lo stesso cervello italiano, pensato per chi vende: CRM vocale mentre guidi, dati energia integrati, pipeline documentale automatica.",
                "cta": "Scopri AdvisorOS per il Business",
            },
        },
        "advisor": {
            "hero": {
                "kicker": "AdvisorOS · Consulenti Commerciali",
                "title": "AdvisorOS: Il sistema operativo da campo per il consulente commerciale che parla con il suo CRM mentre guida.",
                "subtitle": "Cancella l'inferno di 15 applicazioni diverse aperte contemporaneamente. Prendi il controllo totale di contatti, trattative, scadenze e dati del mercato energetico in un'unica schermata, a mani libere e in totale mobilità.",
                "video_label": "[VIDEO specialistico — AdvisorOS sul campo: sarà inserito il link Vimeo]",
                "video_url": "",
                "cta": "Attiva la Prova Gratuita — Operativo in 5 Minuti",
            },
            "pain": {
                "kicker": "Il dolore",
                "title": "Smetti di fare l'impiegato la sera a casa",
                "text1": "La giornata del consulente: auto, navigatore, WhatsApp che squilla, un Excel aperto sul telefono e un CRM rigido che va compilato la sera, a casa, quando i clienti sono già un ricordo. Ogni dato va riscritto due volte.",
                "text2": "La svolta: un'interfaccia mobile-first che si modella sulla tua azienda, non il contrario. Onboarding guidato, campi personalizzabili in pochi secondi, voce al posto della tastiera.",
            },
            "compare": {
                "kicker": "Confronto",
                "title": "AdvisorOS vs I Giganti",
                "col_need": "Cosa ti serve sul campo",
                "col_us": "AdvisorOS",
                "col_them": "I Giganti Generalisti (Salesforce, HubSpot…)",
                "rows": [
                    {"need": "Uso in auto Voce-First", "us": "✅ Nativo", "them": "🟡 App mobile digitata"},
                    {"need": "AI che ESEGUE azioni", "us": "✅ Comandi multi-step", "them": "🟡 Solo suggerimenti costosi"},
                    {"need": "Dati Energia Integrati", "us": "✅ Nativi PUN e GME", "them": "❌ Assenti, a tue spese"},
                    {"need": "Gestione Imprevisti", "us": "✅ Ricalcola agenda", "them": "❌ Assente"},
                    {"need": "Privacy e Sovranità", "us": "✅ VPS proprio, dati tuoi", "them": "❌ Cloud americani"},
                    {"need": "Tempo di Attivazione", "us": "✅ Minuti", "them": "❌ Settimane con partner costosi"},
                ],
            },
            # V50.z547 — blocco comparativo (subito sotto la tabella) con nota di trasparenza sui marchi
            "diff": {
                "kicker": "La differenza",
                "title": "Perché AdvisorOS cancella i CRM tradizionali",
                "intro": "Salesforce e HubSpot sono piattaforme rigide nate per chi lavora seduto a una scrivania. AdvisorOS è l'unico sistema operativo mobile-first nato per chi ha l'auto come ufficio.",
                "items": [
                    {"emoji": "🚘", "title": "Unicità sul Mercato", "text": "Nessun CRM al mondo ti permette di aggiornare una trattativa via voce mentre guidi e, un secondo dopo, aprire il garage o vedere i prezzi PUN in tempo reale. Integrazione nativa con Android Auto e Apple CarPlay."},
                    {"emoji": "🔓", "title": "Nessun Vendor Lock-in", "text": "Con i CRM classici, se smetti di pagare perdi lo storico clienti. AdvisorOS gira sulla tua VPS: i dati restano tuoi anche se cambi mandato o agenzia."},
                    {"emoji": "⏱️", "title": "Time-to-Value immediato", "text": "I CRM generalisti richiedono settimane e consulenti costosi. AdvisorOS ti rende operativo sul campo in meno di 5 minuti."},
                ],
                "note": "Nota di trasparenza: i marchi Salesforce, HubSpot, Zoho, Pipedrive e vtenext appartengono ai rispettivi proprietari. Le funzionalità e i prezzi indicati fanno riferimento ai listini pubblici aggiornati al 2026. AdvisorOS è una piattaforma indipendente non affiliata ai suddetti marchi.",
            },
            "features": {
                "kicker": "Funzionalità specialistiche",
                "title": "L'Armatura del Consulente: quattro aree costruite per chi vende sul campo",
                "subtitle": "Progettato per l'utilizzo in mobilità con una sola mano direttamente dallo smartphone, o integrato sul cruscotto della tua vettura.",  # V50.z550
                "items": [
                    {"emoji": "🎙️", "title": "Axon Operativo", "text": "Wake-word personalizzabile («Viola»). Comandi multi-step vocali con conferma vocale: «Sposta l'appuntamento con Rossi a giovedì e avvisalo via WhatsApp»."},
                    {"emoji": "⚡", "title": "Dati di Settore Nativi", "text": "Prezzi PUN e fasce GME in tempo reale, storico 18 mesi, PDF scaricabili da mostrare al cliente."},
                    {"emoji": "📄", "title": "Pipeline Documentale", "text": "Foto di bollette e contratti → anagrafica compilata automaticamente. Trascrizione delle chiamate con estrazione di budget e next step direttamente nelle note CRM."},
                    {"emoji": "🛡️", "title": "Deploy Sovrano", "text": "VPS proprietaria: i dati restano tuoi anche se cambi mandato. Massima reattività anche nelle zone d'ombra. Se internet cade durante il tuo giro visite, l'app non si blocca: usa la rubrica locale come fallback e memorizza le note vocali offline per non lasciarti mai a piedi."},
                ],
            },
            # V50.z547 — blocco «Advisor Drive» (in coda alla sezione Armatura del Consulente)
            "drive": {
                "kicker": "Advisor Drive",
                "title": "Advisor Drive: L'ufficio sul tuo cruscotto (Zero errori, Massima sicurezza)",
                "intro": "AdvisorOS porta il CRM sul grande schermo della tua vettura tramite Apple CarPlay e Android Auto.",
                "items": [
                    {"emoji": "🖥️", "title": "Interfaccia Visiva d'Impatto", "text": "Se chiedi di fissare un appuntamento o aggiornare una trattativa, il sistema ti mostra sul monitor la scheda di riepilogo con i dati inseriti."},
                    {"emoji": "✅", "title": "Doppia Conferma Vocale o Touch", "text": "Verifichi i dettagli del cliente prima di salvare nel CRM. Un cenno vocale o un Tap sullo schermo autorizza il salvataggio, eliminando ogni rischio di errore con gli occhi fissi sulla strada."},
                ],
            },
            # V50.z548 — «Perché i consulenti scelgono AdvisorOS» (subito prima di Pacchetti e prezzi) + modal confronto tecnico (tabella configurabile)
            "why": {
                "kicker": "Il confronto",
                "title": "Perché i consulenti sul campo scelgono AdvisorOS rispetto ai CRM tradizionali?",
                "items": [
                    {"emoji": "🚗", "title": "Uso in Auto (Voice-First)", "text": "I colossi del software sono nati per chi sta seduto dietro a una scrivania. AdvisorOS è l'unico sistema operativo mobile progettato per essere usato a mani libere mentre guidi tramite Apple CarPlay e Android Auto."},
                    {"emoji": "🇮🇹", "title": "Proprietà e Privacy del Dato", "text": "Con i CRM tradizionali, se cambi mandato o agenzia perdi i tuoi clienti. AdvisorOS gira sulla tua VPS privata: i tuoi dati restano tuoi al 100% e non finiscono in mano al fornitore di energia o ai cloud USA."},
                    {"emoji": "💶", "title": "Un Decimo del Costo", "text": "I giganti partono da 100€/utente/mese più costi extra a consumo per l'AI. Il nostro target è una tariffa flat accessibile e trasparente."},
                ],
                "cta": "🔍 Guarda il confronto tecnico completo con gli altri software",
                "modal": {
                    "title": "Confronto tecnico completo",
                    "col_need": "Cosa ti serve sul campo",
                    "columns": ["AdvisorOS", "Salesforce + Agentforce", "HubSpot (Breeze)", "Zoho CRM (Zia)", "Pipedrive (AI)", "vtenext / CRM Italiani", "CRM Gratis + ChatGPT/Gemini"],  # V50.z550 — 7ª colonna
                    "rows": [
                        {"need": "Uso in auto (Voce-First, CarPlay/Android Auto)", "cells": ["✅ Nativo (Advisor Drive)", "🟡 App buona, non voice-first", "🟡 Solo da fermo", "🟡 Solo da fermo", "🟡 Solo da fermo", "❌ Assente", "❌ App separate, solo da fermo"]},
                        {"need": "AI che ESEGUE azioni (Comandi Multi-Step)", "cells": ["✅ Nativo con conferma", "✅ Disponibile a consumo extra", "🟡 Solo piani Enterprise", "🟡 Assistenti di testo", "🟡 Pochi suggerimenti", "❌ Assente", "🟡 Solo chat: copia-incolla manuale"]},
                        {"need": "Dati Mercato Energia Nativi (PUN/GME + PDF)", "cells": ["✅ Nativo (Storico 18 mesi)", "❌", "❌", "❌", "❌", "❌", "❌"]},
                        {"need": "Gestione Imprevisti (Ricalcolo agenda + SMS)", "cells": ["✅ Nativo", "🟡 Da costruire da zero", "❌", "❌", "❌", "❌", "❌"]},
                        {"need": "Pipeline Documentale (Scanner bollette e foto)", "cells": ["✅ Offline-ready", "🟡 Via app partner esterne", "❌", "🟡 Solo biglietti da visita", "❌", "❌", "🟡 Manuale: foto → chat → ricopiare"]},
                        {"need": "Privacy: Dati cifrati on-device + VPS Propria", "cells": ["✅ Totale (No Cloud USA)", "❌ Cloud USA", "❌ Cloud USA", "❌ Cloud USA", "❌ Cloud USA", "🟡 On-premise possibile", "❌ Dati clienti nelle chat su cloud USA"]},
                        {"need": "Tempo per essere Operativi sul campo", "cells": ["⏱️ Minuti", "❌ Settimane/Mesi", "❌ Giorni/Settimane", "❌ Giorni/Settimane", "⏱️ Ore", "❌ Giorni/Settimane", "🟡 Ore + configurazioni"]},
                        {"need": "Prezzo indicativo/utente/mese", "cells": ["Target 25–49€", "❌ 100–330€ + AI a consumo", "❌ 20–150€", "❌ 14–52€", "❌ 14–99€ + add-on AI", "❌ 20–60€", "🟡 0–20€ + abbonamento AI"]},
                        # V50.z550 — confronto con «CRM Gratis + ChatGPT/Gemini»
                        {"need": "Funzionamento Offline", "cells": ["✅ Sì (dati salvati localmente e sincronizzati sulla VPS al ritorno della rete)", "❌ Solo online", "❌ Solo online", "❌ Solo online", "🟡 Lettura parziale", "❌ Solo online", "❌ No (ChatGPT e Gemini vanno in timeout senza internet)"]},
                        {"need": "Setup e Collegamento", "cells": ["✅ 5 Minuti (onboarding guidato nativo tutto in uno)", "❌ Partner e consulenti", "❌ Giorni/Settimane", "❌ Giorni/Settimane", "🟡 Ore", "❌ Giorni/Settimane", "❌ Complesso (richiede configurazioni API e piattaforme ponte come Zapier/Make con costi extra nascosti)"]},
                    ],
                    "note": "Nota di trasparenza: I marchi Salesforce, HubSpot, Zoho, Pipedrive e vtenext appartengono ai rispettivi proprietari. Le funzionalità e i prezzi indicati fanno riferimento ai listini pubblici aggiornati al 2026. AdvisorOS è una piattaforma indipendente non affiliata ai suddetti marchi.",
                    "close": "✖️ Chiudi e torna alla pagina",
                },
            },
            "pricing": {
                "kicker": "Pacchetti e prezzi",
                "title": "Dal professionista singolo alla rete Enterprise",
                "founders_title": "Offerta Soci Fondatori",
                "founders_text": "500 interazioni/mese incluse. ILLIMITATE per i primi 100 iscritti, senza aumento di prezzo.",
                "founders_highlight": "🔥 Solo {left} posti Founder rimasti su {limit}",
                "tiers": [
                    {"emoji": "👤", "name": "Professionista Singolo", "text": "Interfaccia personale focalizzata: contatti, trattative, scadenze e Axon vocale."},
                    {"emoji": "👥", "name": "Master Small (1-10 collaboratori)", "text": "Pannello centralizzato, onboarding del team, permessi granulari."},
                    {"emoji": "🏢", "name": "Master Medium (11-50 collaboratori)", "text": "Tutto Small + report di squadra avanzati."},
                    {"emoji": "🏛️", "name": "Master Enterprise (oltre 51)", "text": "Integrazioni verticali con i sistemi back-office aziendali."},
                ],
                "cta_trial": "Attiva la Prova Gratuita",
                "cta_quote": "Richiedi un Preventivo su Misura",
                "quote_email": "info@advisoros.cloud",
                "quote_subject": "Richiesta preventivo AdvisorOS",
            },
        },
    },
}


def _landing_merge(base: Any, over: Any) -> Any:
    if isinstance(base, dict) and isinstance(over, dict):
        out = dict(base)
        for k, v in over.items():
            out[k] = _landing_merge(base.get(k), v) if k in base else v
        return out
    return over if over is not None else base


async def _landing_content() -> Dict[str, Any]:
    doc = await db.landing_content.find_one({"_id": "global"}, {"_id": 0, "content": 1, "updated_at": 1, "updated_by": 1})  # noqa: F821
    over = (doc or {}).get("content") or {}
    # V50.z549 — la pagina AxonOS ha cambiato struttura (pain/pillars/onboarding.modal): un override salvato con la vecchia
    # struttura (senza «pillars») riporterebbe i testi vecchi → viene ignorato e ripartono i nuovi default.
    axon_over = (over.get("pages") or {}).get("axon")
    if isinstance(axon_over, dict) and "pillars" not in axon_over:
        over = {**over, "pages": {k: v for k, v in over["pages"].items() if k != "axon"}}
    content = _landing_merge(copy.deepcopy(LANDING_DEFAULTS), over)
    return {"content": content, "is_default": not doc, "updated_at": (doc or {}).get("updated_at"), "updated_by": (doc or {}).get("updated_by")}


async def _landing_seats(content: Dict[str, Any]) -> Dict[str, Dict[str, int]]:
    base_q = {"role": "owner", "parent_user_id": {"$in": [None, ""]}}
    builder = await db.users.count_documents({**base_q, "plan": "builder"})  # noqa: F821
    professional = await db.users.count_documents({**base_q, "plan": {"$ne": "builder"}})  # noqa: F821 — senza piano = professional
    out = {}
    for key, taken in (("builder", builder), ("professional", professional)):
        limit = int((content.get("plans", {}).get(key, {}) or {}).get("limit") or 100)
        out[key] = {"limit": limit, "taken": taken, "left": max(0, limit - taken)}
    return out


@api_router.get("/public/landing")  # noqa: F821
async def public_landing():
    data = await _landing_content()
    return {"content": data["content"], "seats": await _landing_seats(data["content"]), "updated_at": data["updated_at"].isoformat() if data.get("updated_at") else None}


@api_router.get("/public/landing/page/{slug}")  # noqa: F821
async def public_landing_page(slug: str):
    """V50.z546 — Contenuti di UNA pagina di approfondimento (axon | advisor) + piani/posti: usata dalle pagine statiche
    italianbrain.it/axonos e /advisoros (JS leggero, same-origin via proxy nginx) e dalle route /landing/axonos · /landing/advisoros."""
    if slug not in ("axon", "advisor"):
        raise HTTPException(status_code=404, detail="Pagina non trovata")
    data = await _landing_content()
    content = data["content"]
    return {"slug": slug, "page": content["pages"][slug], "plans": content["plans"], "seats": await _landing_seats(content)}


# ───────────────────────────── CMS (Super Admin + password dedicata) ─────────────────────────────
def _cms_password_ok(pw: Optional[str]) -> bool:
    expected = (os.environ.get("LANDING_CMS_PASSWORD") or "").strip()
    return bool(expected) and bool(pw) and hmac.compare_digest(expected, (pw or "").strip())


def _cms_can_admin(user: dict) -> bool:
    """V50.z531 — Amministratore del CMS: Super Admin (flag/ADVISOR_SUPER_ADMIN_EMAILS) OPPURE Master radice del workspace
    (role owner senza parent) OPPURE email in SUPER_MASTER_EMAILS — stessa logica del libretto (V50.z290: in produzione il flag
    super_admin non coincideva con l'account del Master e il pannello restava bloccato). La password CMS resta il 2° fattore."""
    try:
        if is_super_admin(user):  # noqa: F821 — 36_admin_clients
            return True
    except Exception:  # noqa: BLE001
        pass
    try:
        _require_super_master(user)  # noqa: F821 — 27_teach_ai_kb (Master radice o SUPER_MASTER_EMAILS)
        return True
    except HTTPException:
        return False


async def _require_cms_admin(user=Depends(get_current_user)):  # noqa: F821
    if not _cms_can_admin(user):
        raise HTTPException(status_code=403, detail="Sezione riservata all'amministratore (Master)")
    return user


@api_router.get("/landing/cms/permission")  # noqa: F821
async def landing_cms_permission(user=Depends(get_current_user)):  # noqa: F821
    return {"can": _cms_can_admin(user), "password_configured": bool((os.environ.get("LANDING_CMS_PASSWORD") or "").strip())}


async def _require_cms(user=Depends(_require_cms_admin), x_cms_password: Optional[str] = Header(default=None, alias="X-CMS-Password")):
    if not (os.environ.get("LANDING_CMS_PASSWORD") or "").strip():
        raise HTTPException(status_code=503, detail="LANDING_CMS_PASSWORD non configurata nel .env del server")
    if not _cms_password_ok(x_cms_password):
        raise HTTPException(status_code=401, detail="Password CMS errata")
    return user


class CmsUnlockIn(BaseModel):
    password: str = Field(min_length=1, max_length=200)


class CmsContentIn(BaseModel):
    content: Dict[str, Any]


@api_router.post("/landing/cms/unlock")  # noqa: F821
async def landing_cms_unlock(body: CmsUnlockIn, user=Depends(_require_cms_admin)):
    if not (os.environ.get("LANDING_CMS_PASSWORD") or "").strip():
        raise HTTPException(status_code=503, detail="LANDING_CMS_PASSWORD non configurata nel .env del server")
    if not _cms_password_ok(body.password):
        raise HTTPException(status_code=401, detail="Password CMS errata")
    return {"ok": True}


@api_router.get("/landing/cms/content")  # noqa: F821
async def landing_cms_get(user=Depends(_require_cms)):
    data = await _landing_content()
    return {**data, "updated_at": data["updated_at"].isoformat() if data.get("updated_at") else None, "defaults": LANDING_DEFAULTS, "seats": await _landing_seats(data["content"])}


@api_router.put("/landing/cms/content")  # noqa: F821
async def landing_cms_put(body: CmsContentIn, user=Depends(_require_cms)):
    content = body.content or {}
    for key in ("builder", "professional"):
        plan = (content.get("plans") or {}).get(key) or {}
        for f in ("price_old", "price", "limit"):
            if f in plan and plan[f] is not None:
                try:
                    plan[f] = int(plan[f]) if f == "limit" else float(plan[f])
                except (TypeError, ValueError):
                    raise HTTPException(status_code=400, detail=f"Valore non numerico per plans.{key}.{f}")
        if plan.get("limit") is not None and plan["limit"] < 0:
            raise HTTPException(status_code=400, detail="Il limite posti non può essere negativo")
    await db.landing_content.replace_one({"_id": "global"}, {"_id": "global", "content": content, "updated_at": utcnow(), "updated_by": user.get("email") or user.get("user_id")}, upsert=True)  # noqa: F821
    data = await _landing_content()
    return {"ok": True, "content": data["content"], "seats": await _landing_seats(data["content"])}


@api_router.post("/landing/cms/reset")  # noqa: F821
async def landing_cms_reset(user=Depends(_require_cms)):
    await db.landing_content.delete_one({"_id": "global"})  # noqa: F821
    return {"ok": True, "content": LANDING_DEFAULTS}


# ───────────────────────────── V50.z533 — FAQ gestibili dal CMS + ricerca in /help + conoscenza per Axon ─────────────────────────────
# Singleton Mongo `faq_content` (_id="global", items=[...]); se assente → FAQ_DEFAULTS. Pubbliche (GET /public/faq), modificabili
# dal CMS (stessa protezione della landing: Master/Super Admin + X-CMS-Password). `_build_faq_section(msg)` → le 3 FAQ più
# pertinenti al messaggio (sovrapposizione di parole chiave) come sezione del prompt di Axon, così «dove trovo X» ha la risposta giusta.
FAQ_DEFAULTS: List[Dict[str, str]] = [
    {
        "id": "faq_01",
        "icon": "school-outline",
        "q": "Come carico un contratto esempio per addestrare Axon?",
        "a": "Vai in Axon Lab › Area Master › Addestramento (Fase 2 · Moduli). Clicca \"Carica contratto compilato di esempio\" e seleziona il file da Drive, Dropbox o dal tuo dispositivo. Axon lo analizza e impara automaticamente la struttura e i campi da compilare."
    },
    {
        "id": "faq_02",
        "icon": "swap-vertical-outline",
        "q": "Posso modificare l'ordine delle pagine nel documento finale?",
        "a": "Sì. Prima di salvare puoi trascinare le sezioni nell'ordine che preferisci, oppure impostare un ordine predefinito nel pannello Master che si applica automaticamente a ogni nuovo documento."
    },
    {
        "id": "faq_03",
        "icon": "save-outline",
        "q": "Dove si salva il documento compilato?",
        "a": "Al termine della compilazione puoi scegliere: cartella del cliente, database Master, condivisione via email o link, o stampa diretta via WiFi. Puoi salvare in più posti contemporaneamente."
    },
    {
        "id": "faq_04",
        "icon": "documents-outline",
        "q": "Axon può compilare qualsiasi tipo di contratto?",
        "a": "Axon funziona con qualsiasi documento PDF che hai caricato come modello. Più esempi compilati gli fornisci, più diventa preciso. Contratti energia, telco, bancari, assicurativi — se hai il modello, Axon lo compila."
    },
    {
        "id": "faq_05",
        "icon": "create-outline",
        "q": "Cosa succede se Axon sbaglia a compilare un campo?",
        "a": "Prima di salvare puoi revisionare e correggere ogni campo manualmente. Axon mostra in anteprima tutto il documento compilato e segnala i campi su cui non è sicuro."
    },
    {
        "id": "faq_06",
        "icon": "phone-portrait-outline",
        "q": "Posso usare AdvisorOS da mobile e desktop contemporaneamente?",
        "a": "Sì. AdvisorOS è sincronizzato in tempo reale su tutti i dispositivi. Puoi iniziare una pratica da desktop e completarla da mobile senza perdere nulla."
    },
    {
        "id": "faq_07",
        "icon": "add-circle-outline",
        "q": "Come aggiungo un nuovo fornitore o modello di contratto?",
        "a": "Da Axon Lab › Addestramento › Fase 2, carica il modulo vuoto del nuovo fornitore e un esempio compilato. Axon lo riconosce automaticamente e lo aggiunge ai modelli disponibili."
    },
    {
        "id": "faq_08",
        "icon": "lock-closed-outline",
        "q": "I dati dei miei clienti sono al sicuro?",
        "a": "Tutti i dati dei clienti sono crittografati e accessibili solo a te e ai collaboratori che autorizzi. Nessun dato viene condiviso con terze parti."
    },
    {
        "id": "faq_09",
        "icon": "people-outline",
        "q": "Posso condividere l'accesso con un collaboratore?",
        "a": "Sì. Dal pannello Master puoi aggiungere collaboratori con livelli di accesso personalizzati — puoi decidere cosa possono vedere e cosa possono modificare."
    },
    {
        "id": "faq_10",
        "icon": "calendar-outline",
        "q": "Come funziona il briefing pre-appuntamento di Axon?",
        "a": "Prima di ogni appuntamento in calendario Axon ti invia un riepilogo automatico: chi incontri, cosa ha acquistato in passato, chi lo ha referenziato, le scadenze aperte e i punti da affrontare. Tutto senza che tu debba chiedere nulla."
    },
    {
        "id": "faq_11",
        "icon": "book-outline",
        "q": "Dove carico i miei libri e appunti perché Axon li ricordi?",
        "a": "Vai in Axon (hub) › «La mia Knowledge Base», oppure Profilo › «La mia Knowledge Base». Puoi caricare PDF/TXT fino a 20 MB o incollare un testo: Axon lo indicizza sul server (senza costi AI) e lo usa quando fai domande in chat. I documenti sono privati e visibili solo a te."
    },
    {
        "id": "faq_12",
        "icon": "chatbubbles-outline",
        "q": "Cosa sono i crediti AI e cosa succede quando finiscono?",
        "a": "I crediti AI mensili coprono SOLO la chat con Axon (testo e voce): 1 messaggio = 1 credito. Tutte le altre funzioni AI (analisi documenti e bollette, trascrizione chiamate, email automatiche, OCR) sono incluse senza limiti. Quando finiscono si ricaricano il 1° del mese; dalla chat puoi richiedere un pacchetto add-on. Il saldo è nel Profilo."
    },
    {
        "id": "faq_13",
        "icon": "gift-outline",
        "q": "Come funziona «Porta un amico»?",
        "a": "In Profilo › «Porta un amico» trovi il tuo codice e il link da condividere. Quando l'amico si registra ricevi 30 crediti AI bonus; quando attiva un piano a pagamento ne riceve 30 anche lui. I crediti bonus non scadono."
    },
    {
        "id": "faq_14",
        "icon": "call-outline",
        "q": "Dove gestisco le call telefoniche programmate?",
        "a": "Nel modulo Call (menu › Call): il bottone «+ Call» crea una nuova call con titolo, data/ora e tipo; dalla lista registri l'esito. Le call compaiono anche in Calendario e nella Home tra le ritelefonate del giorno."
    },
    {
        "id": "faq_15",
        "icon": "color-palette-outline",
        "q": "Come cambio tema (chiaro/scuro) o la voce di Axon?",
        "a": "Profilo › Impostazioni › Aspetto per il tema (Luce, Pearl, Slate, Midnight). Profilo › Impostazioni › Assistente per nome, voce, lingua e tono di Axon."
    },
    {
        "id": "faq_16",
        "icon": "help-buoy-outline",
        "q": "Come segnalo un bug o chiedo assistenza?",
        "a": "Tab Help in basso: compila il modulo «Descrivi il problema» (puoi spuntare i problemi ricorrenti e allegare screenshot). Axon prova a risolvere subito; se serve la richiesta passa al Master. Trovi anche i contatti di supporto e il form «Invia un consiglio»."
    }
]


async def _faq_items() -> List[Dict[str, str]]:
    doc = await db.faq_content.find_one({"_id": "global"}, {"_id": 0, "items": 1})  # noqa: F821
    items = (doc or {}).get("items")
    if isinstance(items, list) and items:
        return items
    out = copy.deepcopy(FAQ_DEFAULTS)
    for it in out:  # V50.z541 — ruoli di default sulle FAQ storiche
        it.setdefault("roles", _FAQ_DEFAULT_ROLES.get(it["id"], []))
    return out + copy.deepcopy(FAQ_ROLE_DEFAULTS)


# ───────────────────────────── V50.z541 — FAQ PER RUOLO + FAQ landing / italianbrain.it / inviti ─────────────────────────────
# Ogni FAQ ha `roles` ⊆ {superadmin, master, manager, collab}; vuoto = visibile a tutti. Il ruolo del lettore si ricava dal
# token (se presente): super_admin → superadmin (vede TUTTO), owner → master, admin → manager, member/consultant → collab,
# anonimo → solo FAQ generali. Un Collaboratore non vede le guide del Master; un Master non vede quelle del Supermaster.
FAQ_ROLES = ("superadmin", "master", "manager", "collab")
_FAQ_DEFAULT_ROLES: Dict[str, List[str]] = {
    "faq_01": ["master", "manager"], "faq_07": ["master", "manager"], "faq_09": ["master", "manager"], "faq_13": ["master"],
}
FAQ_ROLE_DEFAULTS: List[Dict[str, Any]] = [
    {"id": "faq_17", "icon": "globe-outline", "roles": ["master"],
     "q": "Cos'è la landing page italianbrain.it e come la uso?",
     "a": "italianbrain.it è la pagina pubblica di presentazione di AxonOS: spiega il Manifesto Privacy, i piani e i posti Founder rimasti. È fuori dall'app (sito statico): condividila a chi vuoi presentare AxonOS. Chi clicca «Inizia» arriva alla registrazione dell'app. Il link è in Pannello Master › Condividi landing e nella Business Card. Dai bottoni «Attiva AxonLite»/«19€» e «Scopri AdvisorOS» si aprono le due pagine di approfondimento (italianbrain.it/axonos e /advisoros), i cui testi si modificano dal CMS Landing › sezioni 5 e 6."},
    {"id": "faq_18", "icon": "link-outline", "roles": ["master", "manager"],
     "q": "Come invito i miei utenti: link via email o creazione manuale?",
     "a": "Due modi, entrambi da Pannello Master. 1) Link di registrazione: Invita collaboratore › scegli il ruolo (Collaboratore, Manager, Master figlio) › Crea link › invialo via email, WhatsApp o QR; chi lo apre si registra ed entra nella tua organizzazione. 2) Creazione manuale: Gestione Team › «Aggiungi» › inserisci nome, email, password e aree: l'utente è pronto subito. Ogni Manager può creare i propri Collaboratori."},
    {"id": "faq_19", "icon": "layers-outline", "roles": ["master"],
     "q": "Quanti utenti posso avere? Come funzionano i piani?",
     "a": "Il piano scelto alla registrazione fissa il totale di utenti della tua organizzazione (tu + Manager + Collaboratori di ogni livello): Collaboratore singolo (1 utente), Master fino a 10, Master fino a 50, oltre 50 su preventivo. Al limite, inviti e creazioni manuali vengono bloccati con l'avviso «Limite del piano raggiunto»: fai l'upgrade da Gestione Team › «Passa al piano superiore» (pagamento o richiesta al Supermaster)."},
    {"id": "faq_20", "icon": "git-network-outline", "roles": ["master", "manager"],
     "q": "Che differenza c'è tra Master, Manager e Collaboratore?",
     "a": "Master: titolare dell'organizzazione, gestisce piani, team, inviti, aree, Libretto e addestramento di Axon. Manager: coordina i propri Collaboratori (li crea, assegna aree, vede le loro statistiche) ma non i piani. Collaboratore: lavoro operativo su contatti, appuntamenti, contratti e Axon. Il Supermaster è il gestore della piattaforma e vede tutte le organizzazioni."},
    {"id": "faq_21", "icon": "people-outline", "roles": ["collab"],
     "q": "Cosa posso fare come Collaboratore?",
     "a": "Tutto il lavoro operativo: contatti e CRM, calendario e call, contratti compilati da Axon, Knowledge Base personale, chat con Axon, scanner documenti. Le impostazioni di squadra (aree, inviti, Libretto, addestramento) sono del tuo Manager/Master: se ti serve qualcosa di quel tipo chiedi a lui dal tab Help › «Chiedi al Master»."},
    {"id": "faq_22", "icon": "person-add-outline", "roles": ["manager"],
     "q": "Come aggiungo un Collaboratore alla mia squadra?",
     "a": "Pannello Master › Gestione Team › «Aggiungi»: nome, email, password provvisoria e almeno un'area. Il Collaboratore comparirà sotto di te nella gerarchia e vedrai le sue statistiche in Team Insights. Se il Master ha raggiunto il limite utenti del piano l'aggiunta viene bloccata: chiedi al Master l'upgrade."},
    {"id": "faq_23", "icon": "shield-checkmark-outline", "roles": ["superadmin"],
     "q": "Dove gestisco tutti gli utenti registrati (ruoli, piani, eliminazione)?",
     "a": "Pannello Master › sezione Super Admin › «Utenti registrati» (/admin/users): elenco di tutti gli utenti di tutte le organizzazioni con ricerca e filtri. Azioni per utente: Cambia ruolo (Master/Manager/Collaboratore/Consulente), Sposta sotto un altro Master o Manager, Assegna piano, Reinvia email di benvenuto, Verifica email, Elimina (con eliminazione a cascata se ha utenti sotto)."},
    {"id": "faq_24", "icon": "pricetags-outline", "roles": ["superadmin"],
     "q": "Come modifico piani e prezzi senza toccare il codice?",
     "a": "Pannello Master › Super Admin › «Piani e prezzi»: etichetta, prezzo mensile, numero massimo di utenti, badge e flag «preventivo» per ogni piano. Le modifiche sono immediate nel modulo di registrazione, nel paywall (pagamento Stripe) e nei controlli di limite utenti."},
    {"id": "faq_25", "icon": "mail-open-outline", "roles": ["superadmin"],
     "q": "L'email di benvenuto non è arrivata a un nuovo iscritto: cosa faccio?",
     "a": "L'email parte subito alla registrazione e viene ritentata alla verifica del codice. In /admin/users il filtro «Senza benvenuto» mostra chi non l'ha ricevuta e l'eventuale errore del provider; il tasto «Reinvia benvenuto» la rimanda. Il testo si modifica in Super Admin › «Email di benvenuto» (deve essere attiva)."},
    {"id": "faq_26", "icon": "chatbubbles-outline", "roles": ["superadmin"],
     "q": "Come gestisco le FAQ per ruolo?",
     "a": "CMS Landing › sezione FAQ: ogni domanda ha i chip Supermaster / Master / Manager / Collaboratore. Nessun chip = visibile a tutti. Il Centro Assistenza mostra a ogni utente solo le FAQ del suo ruolo (più quelle generali) e Axon usa le stesse FAQ come fonte di verità nelle risposte."},
]


def _faq_role_of(user: Optional[dict]) -> Optional[str]:
    if not user:
        return None
    if is_super_admin(user):  # noqa: F821
        return "superadmin"
    r = user.get("role") or "member"
    return "master" if r == "owner" else "manager" if r == "admin" else "collab"


def _faq_visible(items: List[Dict[str, Any]], role: Optional[str]) -> List[Dict[str, Any]]:
    if role == "superadmin":
        return items
    return [it for it in items if not it.get("roles") or (role and role in it.get("roles", []))]


async def _faq_optional_user(authorization: Optional[str]) -> Optional[dict]:
    if not authorization:
        return None
    try:
        return await get_current_user(authorization)  # noqa: F821
    except Exception:  # noqa: BLE001
        return None


async def _faq_items_for(authorization: Optional[str]) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    role = _faq_role_of(await _faq_optional_user(authorization))
    return _faq_visible(await _faq_items(), role), role


@api_router.get("/public/faq")  # noqa: F821
async def public_faq(authorization: Optional[str] = Header(None)):
    items, role = await _faq_items_for(authorization)
    return {"items": items, "role": role}


class FaqItemIn(BaseModel):
    id: Optional[str] = None
    icon: Optional[str] = "help-circle-outline"
    q: str = Field(min_length=3, max_length=300)
    a: str = Field(min_length=3, max_length=3000)
    roles: Optional[List[str]] = None  # V50.z541


class FaqPutIn(BaseModel):
    items: List[FaqItemIn] = Field(max_length=200)


@api_router.put("/landing/cms/faq")  # noqa: F821
async def landing_cms_faq_put(body: FaqPutIn, user=Depends(_require_cms)):
    items = []
    for i, it in enumerate(body.items, 1):
        roles = [r for r in (it.roles or []) if r in FAQ_ROLES]
        items.append({"id": (it.id or "").strip() or f"faq_{uuid.uuid4().hex[:8]}", "icon": (it.icon or "help-circle-outline").strip(), "q": it.q.strip(), "a": it.a.strip(), "roles": roles})
    await db.faq_content.replace_one({"_id": "global"}, {"_id": "global", "items": items, "updated_at": utcnow(), "updated_by": user.get("email") or user.get("user_id")}, upsert=True)  # noqa: F821
    _faq_vec_cache.clear()
    return {"ok": True, "items": items}


@api_router.post("/landing/cms/faq/reset")  # noqa: F821
async def landing_cms_faq_reset(user=Depends(_require_cms)):
    await db.faq_content.delete_one({"_id": "global"})  # noqa: F821
    _faq_vec_cache.clear()
    return {"ok": True, "items": FAQ_DEFAULTS}


# ───────────────────────────── V50.z536 — FAQ suggerite SEMANTICHE (MiniLM locale, zero crediti AI) ─────────────────────────────
# Mentre l'utente digita nel Centro Assistenza, GET /public/faq/suggest?q=… restituisce le 3 FAQ più vicine per significato
# (cosine su embedding all-MiniLM-L6-v2 — lo stesso motore ONNX della Knowledge Base). Gli embedding delle FAQ sono calcolati una
# volta e messi in cache in memoria (invalidata quando il CMS pubblica nuove FAQ). Fallback keyword se il modello non è disponibile.
_faq_vec_cache: Dict[str, Any] = {}
FAQ_SUGGEST_MIN_SIM = 0.30


def _faq_sig(items: List[Dict[str, str]]) -> str:
    return hashlib.sha1("\x1f".join(f"{it.get('id')}|{it.get('q')}|{it.get('a')}" for it in items).encode("utf-8")).hexdigest()


async def _faq_vectors(items: List[Dict[str, str]]) -> List[List[float]]:
    sig = _faq_sig(items)
    if _faq_vec_cache.get("sig") != sig:
        texts = [f"{it.get('q', '')}\n{(it.get('a', '') or '')[:400]}" for it in items]
        vecs = await asyncio.to_thread(_kb_embedder.embed, texts)  # noqa: F821 — axon_knowledge_base
        _faq_vec_cache.update({"sig": sig, "vecs": vecs})
    return _faq_vec_cache["vecs"]


async def _faq_semantic_top(query: str, k: int = 3, items: Optional[List[Dict[str, Any]]] = None) -> List[Dict[str, Any]]:
    items = await _faq_items() if items is None else items
    if not items:
        return []
    q = (query or "").strip()[:500]
    if _kb_embedder.available:  # noqa: F821
        vecs = await _faq_vectors(items)
        qv = (await asyncio.to_thread(_kb_embedder.embed, [q]))[0]  # noqa: F821
        qa = np.asarray(qv, dtype=np.float32)
        sims = np.asarray(vecs, dtype=np.float32) @ qa
        # piccolo bonus lessicale: parole della domanda presenti nella FAQ (aiuta con termini propri come "Libretto", "CRT")
        q_tok = _faq_tokens(q)
        order = np.argsort(-sims)
        out = []
        for i in order[: max(k * 3, 6)]:
            it = items[int(i)]
            lex = len(q_tok & (_faq_tokens(it.get("q", "")) | _faq_tokens(it.get("a", ""))))
            score = float(sims[int(i)]) + 0.05 * min(lex, 3)
            if score >= FAQ_SUGGEST_MIN_SIM:
                out.append({**it, "score": round(score, 3)})
        out.sort(key=lambda x: -x["score"])
        return out[:k]
    # fallback keyword (stesso scoring di _build_faq_section)
    q_tok = _faq_tokens(q)
    scored = []
    for it in items:
        score = 2.0 * len(q_tok & _faq_tokens(it.get("q", ""))) + 0.5 * len(q_tok & _faq_tokens(it.get("a", "")))
        if score > 0:
            scored.append((score, it))
    scored.sort(key=lambda x: -x[0])
    return [{**it, "score": s} for s, it in scored[:k]]


@api_router.get("/public/faq/suggest")  # noqa: F821
async def public_faq_suggest(q: str = "", k: int = 3, authorization: Optional[str] = Header(None)):
    q = (q or "").strip()
    if len(q) < 3:
        return {"items": [], "engine": "none"}
    visible, _role = await _faq_items_for(authorization)  # V50.z541 — solo FAQ del ruolo del lettore
    items = await _faq_semantic_top(q, max(1, min(int(k or 3), 6)), items=visible)
    return {"items": items, "engine": "minilm-local" if _kb_embedder.available else "keyword"}  # noqa: F821


_FAQ_STOP = {"come", "dove", "cosa", "che", "chi", "quando", "quale", "quali", "posso", "puoi", "devo", "fare", "faccio", "trovo", "trovare", "sono", "essere",
             "il", "lo", "la", "i", "gli", "le", "un", "una", "uno", "di", "del", "della", "dei", "delle", "degli", "a", "al", "alla", "ai", "alle", "da", "dal", "dalla",
             "in", "nel", "nella", "nei", "nelle", "con", "su", "sul", "sulla", "per", "tra", "fra", "e", "o", "ma", "non", "si", "mi", "ti", "ci", "vi", "se", "è", "ho", "hai",
             "ha", "c'è", "ce", "questo", "questa", "quello", "quella", "anche", "più", "molto", "tutto", "tutti", "axon", "app", "advisoros"}
_FAQ_RX_WORD = re.compile(r"[a-zàèéìòù0-9]{3,}")


def _faq_tokens(text: str) -> set:
    toks = set()
    for w in _FAQ_RX_WORD.findall((text or "").lower()):
        if w in _FAQ_STOP:
            continue
        toks.add(w[:-1] if len(w) > 5 and w[-1] in "aeio" else w)  # stem grezzo: libri/libro, crediti/credito
    return toks


async def _build_faq_section(msg: str, k: int = 3, user: Optional[dict] = None) -> str:
    q_tok = _faq_tokens(msg)
    if len(q_tok) < 1:
        return ""
    scored = []
    for it in _faq_visible(await _faq_items(), _faq_role_of(user)) if user else await _faq_items():
        t_q = _faq_tokens(it.get("q", ""))
        t_a = _faq_tokens(it.get("a", ""))
        score = 2.0 * len(q_tok & t_q) + 0.5 * len(q_tok & t_a)
        if score >= 2.0:
            scored.append((score, it))
    if not scored:
        return ""
    scored.sort(key=lambda x: -x[0])
    lines = ["\n\nFAQ UFFICIALI DELL'APP (pertinenti alla domanda — usale per rispondere con il percorso corretto; sono la fonte di verità su dove si trovano le funzioni):"]
    for _, it in scored[:k]:
        lines.append(f"D: {it['q']}\nR: {it['a']}")
    return "\n".join(lines) + "\n"

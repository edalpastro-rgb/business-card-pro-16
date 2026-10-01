# axon_crm_omniscience.py — V50.z180 — Axon "vede" TUTTA l'app
# Modulo ISOLATO. Costruisce la sezione di prompt "DATI COMPLETI CRM" (tutte le sezioni/collezioni di AdvisorOS,
# nel rispetto delle regole di visibilità: tenant + contact_visibility_filter + ownership per i collaboratori)
# e la "MAPPA DELL'APP" (cosa fa ogni sezione, dal Libretto + voci del menu) così Axon può rispondere su
# qualunque riga dell'app: contatti (con note, file, bollette, contratti, richiamate, chiamate, profilo AI),
# appuntamenti (passati/futuri), scadenze, contratti, telefonate, ritelefonate, gruppi, My Thing, team,
# Corporate Gym, caselle mail, Master Files, documenti/offerte azienda, KB, regole insegnate, sveglie, biglietto, chat.
#
# Usa helper del namespace: db, tenant_id, is_owner, is_admin_or_owner, contact_visibility_filter, utcnow,
# _fmt_dt_it, _bill_deadline_entry, logger.

import json as _omni_json
import os as _omni_os
import re as _omni_re
import unicodedata as _omni_unicodedata

_OMNI_MAX_CHARS = 32000
_OMNI_APP_MAP_PATH = _omni_os.path.join(_omni_os.path.dirname(_omni_os.path.abspath(__file__)), "axon_app_map.json")

# Sezioni non coperte dal Libretto (menu laterale / rotte) — una riga ciascuna
_OMNI_EXTRA_SECTIONS = [
    ("Cruscotto", "/cruscotto", "KPI personali e del team: telefonate, appuntamenti, contratti, obiettivi, grafici."),
    ("Scadenze", "/deadlines", "Scadenze contratti/bollette dei clienti (calcolate dalle bollette analizzate): scadute, critiche, in avviso; posticipa o ignora."),
    ("Bollette & Analisi", "/bill-quick e scheda contatto → tab Fatture", "Carica/scanna bollette luce-gas, AxonOS estrae dati (fornitore, offerta, consumi, costi) e produce analisi/confronti; genera proposte PDF."),
    ("Scanner documenti", "/scanner", "Scanner con fotocamera: rileva bordi, ritaglia, multi-pagina, PDF."),
    ("Axon Hub", "/axon-hub", "Centro di controllo di AxonOS: chat, memoria, cervello, script, cheatsheet bollette, alert, allarmi."),
    ("Cervello Axon", "/axon-brain", "Profilo/personalità di AxonOS e istruzioni permanenti (PINNED)."),
    ("Script Axon", "/axon-scripts", "Script di chiamata/vendita salvati e importabili."),
    ("Timer & Sveglie", "/axon-alarms", "Sveglie, timer e promemoria gestiti da Axon."),
    ("Avvisi Axon", "/axon-alerts", "Alert proattivi generati da Axon (scadenze, opportunità)."),
    ("Home Assistant", "/axon-homeassistant", "Integrazione domotica Home Assistant tramite Axon."),
    ("Caselle Mail", "/email-accounts", "Account email IMAP/Outlook collegati: lettura mail, Auto-CRM da mail (proposte contatti/appuntamenti)."),
    ("Auto-CRM da Mail", "/mail-crm-proposals", "Proposte automatiche di contatti/appuntamenti estratte dalle email."),
    ("Chat Team", "/chat", "Chat interna tra Master e collaboratori (canali e messaggi diretti)."),
    ("Anagrafica Master", "/anagrafica-master", "Dati aziendali del Master (ragione sociale, contatti, comunicazioni azienda)."),
    ("Master Files", "/master-files", "Archivio file del Master: analisi, proposte, documenti generati; condivisi con il team."),
    ("Google Drive / Dropbox", "/google-drive, /dropbox", "Collegamento cloud: cartelle indicizzate per Axon, allegati in chat, manuali Corporate Gym."),
    ("Biglietto da visita", "/business-card", "Biglietto digitale con QR/link pubblico, statistiche visualizzazioni, recensioni pubbliche e lead."),
    ("Team Insights", "/team-insights", "Analisi AI delle performance dei collaboratori (Master)."),
    ("Viola · comandi vocali (ViolaWake)", "/viola-wake", "Modulo opzionale per azienda (attivato dal Master, sovrapprezzo): wake-word «Viola» riconosciuta offline sul telefono (Picovoice), comando trascritto dal telefono, poi trigger proattivo (briefing/scansione/report) o chat Axon con risposta parlata. Richiede build nativa. API /viola-wake/settings, /viola-wake/module, /viola-wake/route, /viola-wake/events."),
    ("Confronto collaboratori", "/team-compare", "Master: KPI a confronto per periodo (30/90/365 gg/sempre): classifica con punteggio 0-100, grafico per metrica (contratti, valore €, appuntamenti svolti, contatti, chiamate, richiamate, corsi/attestati, domande ad Axon, conversione), testa a testa fra due collaboratori, tabella completa con media squadra. API GET /team-insights/compare?period=30."),
    ("Team", "/team", "Collaboratori del tenant: ruoli, inviti, profili, visibilità contatti."),
    ("Gruppi", "/groups", "Gruppi/etichette di contatti con colore."),
    ("Ritelefonate", "/home?section=ritelefonate (nuova: /callback/new)", "Richiamate programmate con priorità, notifiche e esiti."),
    ("Contratti", "/master (nuovo: /contract/new)", "Contratti dei clienti: fornitore, importo, stato, date attivazione/scadenza."),
    ("Meteo", "/meteo", "Meteo per città (Open-Meteo) usato anche da Axon."),
    ("Leads pubblici", "/leads", "Richieste ricevute dal biglietto/landing pubblica."),
    ("Recensioni", "/reviews-analytics", "Raccolta e analisi recensioni clienti."),
    ("Inviti / Invitati", "/invita, /invitati", "Inviti a eventi/serate e gestione invitati."),
    ("Eventi & Banner", "/event-banners", "Eventi e banner promozionali in app."),
    ("Audio personali", "/my-audios", "Registrazioni vocali salvate (note audio)."),
    ("Bug & Idee", "/bug-report", "Segnalazioni e suggerimenti all'Help Center."),
    ("Sicurezza", "/impostazioni?section=security (avanzata: /security)", "PIN/biometria Spazio Personale, blocco app, 2FA, cambio password, dispositivi collegati, info sicurezza."),
    ("Azioni rapide", "/quick-actions", "Scorciatoie personalizzabili in Home."),
    ("Libretto Informativo", "/libretto", "Manuale d'uso completo dell'app (tour guidato), scaricabile in PDF."),
    # V50.z277 — nuove funzioni (Area Corsi v2, Modelli moduli, Documenti di riconoscimento, Voce Axon)
    ("Area Corsi", "/courses (nuovo: /courses/new · dashboard: /courses/dashboard)", "Formazione del team a cartelle: Master/Manager creano un corso (titolo, appunti, data/luogo con Maps, destinatari, allegati PDF/foto/audio/Office, reminder 3/7/14 gg); i collaboratori vedono il badge NUOVO lampeggiante finché non aprono, la lettura viene registrata e notificata al creatore, poi rispondono ✅ Partecipo / ❌ Non partecipo (con motivo). Il creatore vede la lista partecipanti (letto/stato/motivazioni) ed esporta Excel/PDF. Dentro il corso: TEST/QUIZ (domande a scelta multipla + risposta aperta finale, punteggio, tempo, statistiche, reminder se non completato); RELAZIONE VOCALE di fine corso (il Master la detta, Whisper trascrive, Axon la organizza in riassunto/punti salienti/azioni/feedback/proposte, modificabile, opzionalmente visibile ai partecipanti); PRESENTAZIONE POWERPOINT (.pptx: Axon la genera dai materiali caricati oppure da ciò che il Master detta a voce — funziona anche senza materiali —, oppure il Master la scrive a mano slide per slide con titolo, punti e note relatore; scaricabile, aggiungibile ai materiali, visibile ai partecipanti); ATTESTATO DI PARTECIPAZIONE PDF automatico (emesso quando il collaboratore risponde ✅ Partecipo e completa il test se presente — mai prima della data del corso: notifica 🎓, download dalla cartella corso; il Master scarica quello di ogni partecipante; contiene logo/nome azienda, nome, corso, data/luogo, punteggio, numero attestato). FASE 5 — ORA del corso e PROMEMORIA PRE-LEZIONE automatici (7/3/1 giorni prima o giorno stesso, alle 08:45) ai partecipanti ✅ e a chi non ha risposto (mai a chi ha detto ❌) + riepilogo presenze al formatore; il giorno dopo la lezione: attestati automatici agli idonei, «completa il test» a chi manca, riepilogo «Corso svolto: N attestati pronti». SPUNTA PRESENZE IN AULA (card nel dettaglio corso, formatore): segna presenti/assenti → l'attestato spetta SOLO ai presenti; bottone «Rilascia attestati ai presenti / a tutti i ✅» (anche senza test) con notifica «🎓 Attestato pronto». DASHBOARD AZIENDA (/courses/dashboard, Master; Manager solo i propri corsi): letture, partecipazione %, test e punteggio medio per corso, per manager e per area, con filtri periodo."),
    ("Modelli moduli (PDF da compilare)", "/form-templates", "Solo Master: carica i PDF dei moduli aziendali (contratti, deleghe, privacy); Axon rileva i campi (AcroForm o AI con posizione) e li compila automaticamente con i dati del cliente (anagrafica, documenti di riconoscimento, bollette/fatture, visura); il PDF compilato è modificabile e pronto per stampa/firma, usabile da Nuovo Contratto."),
    ("Documenti di riconoscimento", "/anagrafica-master (sezione Documenti) e scheda contatto", "Carta d'identità, patente, passaporto, tessera sanitaria: foto fronte/retro con OCR automatico dei dati, data di scadenza tracciata; email di avviso 3 mesi prima e popup in app 1 mese prima della scadenza. I documenti del cliente servono anche per l'autocompilazione dei moduli."),
    ("Compilazione CRT (ex Nuovo contratto)", "/crt", "Pratica contratto per cliente con più servizi insieme (Luce, Gas, Telco). Passo 1 dossier documenti: carta d'identità, codice fiscale, visura camerale (denominazione, P.IVA, sede, PEC, REA, ATECO, legale rappresentante), IBAN (con controllo), codice SDI/PEC, referente contratto (cellulare/email), CTE, contratto del precedente fornitore — caricati da telefono/Drive/Dropbox e letti da Axon, correggibili; documenti già in scheda riutilizzabili. Passo 2 per servizio: si scelgono le fatture già analizzate del cliente → ogni fattura è una fornitura (POD/PDR) con indirizzo, potenza, tensione, fornitore e consumo 12 mesi: reale se 12 mesi, stimato (somma ÷ mesi × 12) con 4-11 mesi, 'storico insufficiente' sotto 4 mesi (correggibile a mano); stesso POD su più fatture unito. Si sceglie il modello del fornitore (Modelli moduli) e Axon compila: righe forniture numerate, caselle a carattere singolo, checkbox tensione; se le righe non bastano replica lo stesso modulo (modulo 1 di N). Verifica/correzione nel modulo compilato. Passo 3: PDF unico compresso con indice (ordine standard appreso dall'esempio pratica completa), salvato in scheda, condivisibile via mail/WhatsApp o QR code (link pubblico 7 giorni, download senza login). Stati: bozza, completa, inviata, attivata, KO. Master: zona esempi compilati (Axon impara quali campi lasciare vuoti) ed esempio pratica completa (ordine documenti). I moduli vanno ricaricati quando il fornitore li aggiorna."),
    ("Modalità offline e sincronizzazione", "/offline-sync", "AdvisorOS funziona anche in modalità aereo o senza rete: il login resta valido, tutte le schermate si aprono con gli ultimi dati scaricati (precaricamento automatico di clienti, agenda, corsi, team, notifiche, impostazioni ogni 15 minuti e all'apertura). Creazioni/modifiche/cancellazioni fatte offline (clienti, appuntamenti, note, richiamate, partecipazione corsi…) vengono salvate in una coda locale, mostrate subito come «in attesa ⏳» e inviate al server in ordine appena torna la connessione: da quel momento sono visibili a tutto il gruppo. Banner in alto «Modalità offline» / «N modifiche in attesa»; pannello con Sincronizza ora, Precarica ora, elenco modifiche (riprova/elimina). Se lo stesso elemento è stato modificato anche online nel frattempo, vince l'ultima versione ma Master e autore ricevono una notifica di conflitto con link all'elemento. Non disponibili offline: Axon chat/voce, OCR biglietti e documenti, generazione PDF/PowerPoint, invio email, caricamento file pesanti."),
    ("Voce, lingua e tono di Axon (Impostazioni AxonOS › Assistente)", "/impostazioni?section=assistente", "Sezione «AI & Axon · Assistente» di Impostazioni AxonOS: nome, tono, voce con cui Axon parla (anteprima audio) e lingua delle risposte; dal Tour Guidato: tasto silenzia, ricomincia dall'inizio, testo evidenziato mentre Axon legge."),
    # V50.z303 — funzioni recenti: dispositivi, regole assolute, coda chat, screenshot/contesto, consigliato per te, reset dati, libretto editor, tour interessi
    ("Dispositivi collegati", "/devices (Impostazioni → Sicurezza)", "Ogni account può usare al massimo 1 telefono + 1 tablet + 1 PC. Se accedi da un nuovo dispositivo dello stesso tipo, il precedente viene disconnesso e sospeso (torna attivo quando il nuovo fa logout o viene rimosso). Schermata «I miei dispositivi» con rimozione; il Master vede i dispositivi del team e il log accessi (data, IP, esito)."),
    ("Motore regole assolute (Insegna ad Axon)", "/ai-teach", "Ogni regola insegnata ad Axon ha un PESO 0-100 (chip: 100 massima, 80 alta, 60 normale, 40 bassa; dedotto anche dal testo: velocità 100, brevità 80, alla lettera 75, pulsanti 70, formato 65, conferma 50, spiegazioni 40, proattività 35). Quando due regole sono in conflitto per lo stesso messaggio (es. «rispondi subito» contro «chiedi sempre conferma») vince quella con peso maggiore e l'altra viene sospesa solo per quel messaggio; i conflitti risolti sono registrati. In chat: «quale regola vince per …» e «log conflitti regole»."),
    ("Chat non bloccante (coda messaggi)", "Chat Axon (bottone AxonOS) · tab «Coda»", "Mentre Axon sta elaborando una risposta puoi continuare a scrivere: il tasto invio diventa arancione ⏱ e il messaggio va in coda server-side (sopravvive alla chiusura dell'app) con priorità URGENTE/ALTA/NORMALE. Ogni bozza compare in chat come bolla tratteggiata «⏳ N° in coda · ~ETA» con Invia ora (urgente, salta la coda), Modifica (cambia il testo prima dell'elaborazione) ed Elimina; parte da sola appena Axon finisce (una alla volta). Tab «Coda»: elaborate di recente e bozze non riuscite con Riprova. Una bozza rimasta bloccata in elaborazione si sblocca da sola dopo 150 secondi."),
    ("Screenshot e contesto schermata per Axon", "Chat Axon → allegati (📎) → «Screenshot schermata»", "Con un tocco Axon cattura la schermata da cui è stato aperto e la allega al messaggio (utile per segnalare bug o chiedere aiuto su ciò che vedi). Axon riceve sempre anche la POSIZIONE ATTUALE dell'utente nell'app (schermata/route) e la usa per rispondere «dove sono» e per suggerire la funzione giusta."),
    ("Consigliato per te (Home)", "/home", "Card in Home sotto «Interfaccia Master» con le scorciatoie alle funzioni a cui l'utente ha detto SÌ nel form interessi del Tour guidato (fino a 8, con icona e gruppo); × nasconde una voce, ↻ rifà il tour. Nascosta se il tour non è stato fatto."),
    ("Tour guidato e form interessi", "/tour (tutte le funzioni: /tour-features)", "Primo avvio in 3 DOMANDE a tocco (ruolo · cosa vendi · quanti clienti) con voce di Axon (pausa/stop/silenzia): la Home viene configurata subito con le funzioni giuste (card «Consigliato per te»). Poi, OPZIONALE, il «Profilo completo»: form spuntabile di 20 domande Sì/No per round, con «Aggiungi nota» sotto ogni domanda (precisazioni che Axon rispetta alla lettera), round illimitati di altre 20 domande generate dall'AI finché l'utente dice «NO, è tutto»; le risposte creano il profilo interessi usato da Axon per personalizzare risposte e suggerimenti proattivi e alimentano la card «Consigliato per te»."),
    ("Azzera dati di test (Master)", "/impostazioni (hub, in fondo — solo Master)", "Cancella in un colpo tutti i dati di prova (clienti, appuntamenti, ritelefonate, contratti, scadenze…) preservando account, collaboratori, impostazioni, branding e tutto ciò che è stato insegnato ad Axon (regole, conoscenza, esempi). Richiede la parola di conferma."),
    ("Editor Libretto illustrativo", "/libretto-editor (Impostazioni → Personalizzazione)", "Il Master modifica testi, sezioni e mockup del Libretto illustrativo / presentazione AdvisorOS, con anteprima e PDF."),
    ("Prompt per Neo", "Master Files → Prompt per Neo", "Le richieste di sviluppo dettate ad Axon («prompt per Neo») vengono salvate in Master Files con stato in attesa/completato: l'utente le copia e le incolla nella chat di sviluppo; «stato prompt Neo» le elenca, «prompt Neo #N completato» le chiude. Axon non ha un canale diretto con Neo."),
]

_OMNI_APP_MAP_CACHE = {"text": None}


def _omni_app_map_entries() -> list:
    """[(titolo, testo_completo)] — libretto + sezioni extra (cache)."""
    if _OMNI_APP_MAP_CACHE.get("entries") is not None:
        return _OMNI_APP_MAP_CACHE["entries"]
    entries = []
    try:
        with open(_OMNI_APP_MAP_PATH, "r", encoding="utf-8") as fh:
            for sec in _omni_json.load(fh):
                if sec.get("id") in ("consigli", "faq", "intro"):
                    continue
                desc = " ".join((sec.get("paragraphs") or [])[:2])[:300]
                entries.append((str(sec.get("title") or ""), f"• {sec.get('title')} — {sec.get('subtitle')}. {desc}"))
    except Exception as exc:  # noqa: BLE001
        logger.debug("[axon-omni] app map load failed: %s", exc)
    for name, route, desc in _OMNI_EXTRA_SECTIONS:
        entries.append((name, f"• {name} ({route}) — {desc}"))
    _OMNI_APP_MAP_CACHE["entries"] = entries
    return entries


_OMNI_STOP = {"come", "cosa", "dove", "quando", "perché", "perche", "posso", "puoi", "sono", "della", "delle", "degli", "dello", "nella", "nelle", "questo", "questa", "quale", "quali", "fare", "faccio", "voglio", "vorrei", "anche", "molto", "tutti", "tutte", "essere", "avere", "mi", "ti", "che", "per", "con", "una", "uno", "gli", "le", "il", "la", "di", "da", "in", "un", "e", "a", "o", "è", "ho", "hai", "ha", "se", "non", "ma", "del", "al", "ai", "sul", "sui"}


def _omni_app_map_text(msg: str = "") -> str:
    """V50.z308 — CONSOLIDAMENTO PROMPT: prima TUTTE le ~75 sezioni (≈13k+ caratteri) finivano in ogni prompt, in doppio con
    l'elenco del Navigatore. Ora: indice compatto dei titoli + testo completo SOLO delle sezioni pertinenti al messaggio (max 8)."""
    entries = _omni_app_map_entries()
    words = {w for w in _omni_re.findall(r"[a-zà-ù0-9]{3,}", _omni_norm(msg)) if w not in _OMNI_STOP}
    scored = []
    for title, text in entries:
        low = _omni_norm(text)
        sc = sum(3 if w in _omni_norm(title) else 1 for w in words if w in low)
        if sc:
            scored.append((sc, text))
    scored.sort(key=lambda x: -x[0])
    picked = [t for _, t in scored[:5]]
    # V50.z421 — consolidamento: l'indice dei ~75 titoli (≈1.8k car.) duplicava l'ELENCO SCHERMATE del Navigatore → solo le sezioni pertinenti.
    if not picked:
        return ""
    lines = ["MAPPA DELL'APP ADVISOROS — sezioni pertinenti a questo messaggio (per le altre usa l'ELENCO SCHERMATE del Navigatore):"]
    lines.extend(picked)
    return "\n".join(lines)


def _omni_norm(s: str) -> str:
    nfkd = _omni_unicodedata.normalize("NFKD", s or "")
    return "".join(ch for ch in nfkd if not _omni_unicodedata.combining(ch)).lower()


def _omni_name(c: dict) -> str:
    n = f"{c.get('first_name', '') or ''} {c.get('last_name', '') or ''}".strip()
    return n or (c.get("company") or c.get("email") or c.get("contact_code") or "?")


def _omni_dt(v) -> str:
    try:
        return _fmt_dt_it(v) if v else ""
    except Exception:
        return str(v or "")[:16]


_OMNI_STOP = set("""ciao axon neo dimmi dammi fammi mostrami elenca elencami quali quale quanti quante chi cosa come dove quando perche perché
tutti tutte tutto ogni ultimi ultime prossimi prossime oggi domani ieri settimana mese anno contatto contatti cliente clienti appuntamento
appuntamenti nota note richiamata richiamate ritelefonata ritelefonate telefonata telefonate chiamata chiamate contratto contratti scadenza
scadenze bolletta bollette gruppo gruppi team collaboratore collaboratori master gym corporate sessione sessioni report statistiche riassumi
riepilogo lista elenco info informazioni dati scheda profilo storico della delle degli dello del dei di da in con per su sul sulla sui che il
lo la le gli un una uno non sono ho hai abbiamo mio mia miei mie tuo tua vorrei voglio puoi potresti sai sapere conosci vedi vedere leggi
leggere trova cerca cercami mostra apri dice detto fatto fare mi ti ci si e o ma se anche ancora gia già più piu meno molto poco bene male
luce gas energia energetico offerta offerte fornitore prezzo prezzi costo costi euro kwh pun arera tabella grafico settembre ottobre novembre
dicembre gennaio febbraio marzo aprile maggio giugno luglio agosto lunedi lunedì martedi martedì mercoledi mercoledì giovedi giovedì venerdi
venerdì sabato domenica app sezione sezioni funzione funzioni advisoros""".split())


def _omni_terms(msg: str) -> list:
    """Parole candidate per la ricerca mirata (nomi propri, aziende, città, telefoni, email)."""
    terms = []
    for m in _omni_re.findall(r"[\w'@.+-]{3,}", msg or "", flags=_omni_re.UNICODE):
        t = m.strip(".,;:!?'\"").lower()
        if not t or t in _OMNI_STOP or t.isdigit() and len(t) < 6:
            continue
        if len(t) < 3:
            continue
        terms.append(t)
    # dedup mantenendo l'ordine
    seen = set(); out = []
    for t in terms:
        if t not in seen:
            seen.add(t); out.append(t)
    return out[:8]


async def _omni_contact_query(user: dict) -> dict:
    q = {"user_id": tenant_id(user)}
    try:
        vis = await contact_visibility_filter(user)
    except Exception:
        vis = None
    if vis:
        q = {"$and": [q, vis]}
    return q


def _omni_own(user: dict, extra: dict = None) -> dict:
    """Filtro per collezioni con user_id=tenant e created_by/assignee (stessa logica di _build_assistant_context)."""
    base = {"user_id": tenant_id(user)}
    if not is_owner(user):
        base["$or"] = [{"created_by": user["user_id"]}, {"assignee_user_id": user["user_id"]}, {"broadcast_to_user_ids": user["user_id"]}]
    if extra:
        base.update(extra)
    return base


def _omni_compact_contact(c: dict) -> dict:
    out = {
        "id": c.get("contact_id"), "nome": _omni_name(c), "codice": c.get("contact_code"),
        "tel": c.get("phone") or c.get("phone_mobile") or c.get("whatsapp") or "", "email": c.get("email") or "",
        "citta": c.get("address_city") or c.get("city") or "", "area": c.get("area") or "", "stato": c.get("status") or "",
        "cliente_attivo": bool(c.get("is_active_client")), "tag": c.get("tags") or [], "fonte": c.get("source") or "",
        "creato": _omni_dt(c.get("created_at")),
    }
    return {k: v for k, v in out.items() if v not in ("", None, [], False)}


async def _omni_contact_dossier(user: dict, c: dict) -> dict:
    """Tutto ciò che l'app sa di un contatto (senza blob binari)."""
    tid = tenant_id(user); cid = c.get("contact_id")
    skip = {"_id", "notes", "files", "user_id", "created_by", "custom_fields"}
    dossier = {k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in c.items()
               if k not in skip and v not in ("", None, [], {}, False)}
    dossier["nome"] = _omni_name(c)
    notes = []
    for n in (c.get("notes") or [])[-12:]:
        kind = n.get("kind") or "text"
        txt = (n.get("text") or n.get("link_title") or n.get("link_url") or f"[{kind}]")
        notes.append(f"{_omni_dt(n.get('created_at'))} · {kind}: {str(txt)[:300]}")
    async for n in db.contact_notes.find({"contact_id": cid}, {"_id": 0, "text": 1, "created_at": 1, "source": 1}).sort("created_at", -1).limit(12):
        notes.append(f"{_omni_dt(n.get('created_at'))} · {n.get('source') or 'nota'}: {(n.get('text') or '')[:300]}")
    if notes:
        dossier["note"] = notes[:20]
    files = [f"{f.get('name') or f.get('title') or '?'} ({f.get('mime') or ''}, {_omni_dt(f.get('created_at'))})" for f in (c.get("files") or [])[-15:]]
    if files:
        dossier["file_allegati"] = files
    appts = []
    async for a in db.appointments.find({"user_id": tid, "$or": [{"contact_id": cid}, {"participant_contact_ids": cid}]},
                                        {"_id": 0, "title": 1, "start_at": 1, "location": 1, "done": 1, "outcome_tags": 1, "outcome_notes": 1, "notes": 1, "contract_signed": 1, "value_amount": 1}).sort("start_at", -1).limit(15):
        appts.append({"quando": _omni_dt(a.get("start_at")), "titolo": a.get("title") or "", "luogo": a.get("location") or "",
                      "fatto": bool(a.get("done")), "esito": a.get("outcome_tags") or [], "note_esito": (a.get("outcome_notes") or "")[:200],
                      "note": (a.get("notes") or "")[:200], "contratto_firmato": bool(a.get("contract_signed")), "valore": a.get("value_amount")})
    if appts:
        dossier["appuntamenti"] = appts
    cbs = []
    async for cb in db.callbacks.find({"contact_id": cid}, {"_id": 0}).sort("created_at", -1).limit(10):
        cbs.append({"quando": _omni_dt(cb.get("next_at") or cb.get("scheduled_at")), "titolo": cb.get("title") or "", "note": (cb.get("notes") or "")[:200],
                    "stato": cb.get("status") or ("fatta" if cb.get("done") else "aperta"), "priorita": cb.get("priority") or ""})
    if cbs:
        dossier["ritelefonate"] = cbs
    calls = []
    async for cl in db.call_logs.find({"contact_id": cid}, {"_id": 0, "created_at": 1, "outcome_id": 1, "note": 1, "duration_sec": 1, "channel": 1}).sort("created_at", -1).limit(15):
        calls.append(f"{_omni_dt(cl.get('created_at'))} · {cl.get('channel') or 'phone'} · esito {cl.get('outcome_id') or '?'} · {cl.get('duration_sec') or 0}s · {(cl.get('note') or '')[:150]}")
    if calls:
        dossier["telefonate"] = calls
    ctrs = []
    async for ct in db.contracts.find({"contact_id": cid}, {"_id": 0, "contract_number": 1, "contract_type": 1, "supplier": 1, "amount_eur": 1, "status": 1, "signed_date": 1, "activation_date": 1, "expiry_date": 1, "notes": 1, "title": 1}).sort("created_at", -1).limit(10):
        ctrs.append({k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in ct.items() if v not in ("", None)})
    if ctrs:
        dossier["contratti"] = ctrs
    bills = []
    async for b in db.energy_bills.find({"contact_id": cid}, {"_id": 0, "pdf_base64": 0}).sort("created_at", -1).limit(8):
        ext = b.get("extracted") or {}
        entry = {"tipo": b.get("bill_type"), "file": b.get("pdf_name"), "stato": b.get("status"), "caricata": _omni_dt(b.get("created_at"))}
        for k in ("fornitore", "nome_offerta", "consumo_annuo", "spesa_totale", "periodo", "data_scadenza", "durata_offerta", "pod", "pdr", "potenza", "prezzo_energia", "prezzo_gas", "totale_bolletta"):
            if ext.get(k) not in (None, ""):
                entry[k] = ext.get(k)
        try:
            d = _bill_deadline_entry(b)
            if d:
                entry["scadenza_contratto"] = {k: d.get(k) for k in ("due_date", "days_left", "status") if d.get(k) is not None}
        except Exception:
            pass
        bills.append(entry)
    if bills:
        dossier["bollette"] = bills
    prof = await db.axon_profiles.find_one({"contact_id": cid}, {"_id": 0, "best_contact_time": 1, "communication_style": 1, "interest_level": 1, "interest_trend": 1, "key_topics": 1, "recurring_objections": 1, "strategic_suggestion": 1})
    if prof:
        dossier["profilo_axon"] = prof
    analyses = []
    async for a in db.axon_analyses.find({"contact_id": cid}, {"_id": 0, "created_at": 1, "interaction_type": 1, "summary": 1, "next_step": 1, "tone": 1}).sort("created_at", -1).limit(5):
        analyses.append(f"{_omni_dt(a.get('created_at'))} · {a.get('interaction_type')} · {a.get('tone')} · {a.get('summary')} → {a.get('next_step')}")
    if analyses:
        dossier["analisi_axon"] = analyses
    if c.get("group_ids"):
        gnames = [g.get("name") async for g in db.groups.find({"group_id": {"$in": c["group_ids"]}}, {"_id": 0, "name": 1})]
        dossier["gruppi"] = gnames
    if c.get("referred_by_contact_id"):
        r = await db.contacts.find_one({"contact_id": c["referred_by_contact_id"]}, {"first_name": 1, "last_name": 1})
        if r:
            dossier["segnalato_da"] = _omni_name(r)
    return dossier


async def _omni_find_contacts(user: dict, terms: list, limit: int = 3) -> list:
    if not terms:
        return []
    base = await _omni_contact_query(user)
    ors = []
    for t in terms:
        rx = {"$regex": _omni_re.escape(t), "$options": "i"}
        ors += [{"first_name": rx}, {"last_name": rx}, {"company": rx}, {"email": rx}, {"phone": rx}, {"contact_code": rx}, {"address_city": rx}, {"tags": rx}, {"fiscal_code": rx}, {"vat_number": rx}]
    q = {"$and": [base, {"$or": ors}]}
    cands = await db.contacts.find(q).limit(40).to_list(40)
    # ranking: quante parole matchano nome/cognome (match pieno vale di più)
    def score(c):
        s = 0
        full = _omni_norm(_omni_name(c)); parts = full.split()
        for t in terms:
            tn = _omni_norm(t)
            if tn in parts:
                s += 5
            elif tn in full:
                s += 3
            elif any(tn in _omni_norm(str(c.get(k) or "")) for k in ("company", "email", "phone", "address_city", "contact_code")):
                s += 2
        return s
    cands.sort(key=score, reverse=True)
    return cands[:limit]


_OMNI_LIST_RX = _omni_re.compile(r"elenc|lista|list[ae]\b|tutti|tutte|quali|clienti|contatti|prospect|citt[àa]|zona|provincia|senza appuntamento|non visitat|anagrafica|rubrica|export|csv|tabella|mappa")


def _omni_contact_list_limit(msg_low: str) -> int:
    """V50.z421 — consolidamento prompt: l'elenco contatti completo (fino a 250 × ~150 car. ≈ 37k) solo se il messaggio chiede
    liste/filtri di clienti; altrimenti 30 righe (conteggi e per_stato/area/città restano sempre; il contatto citato per nome arriva con la SCHEDA COMPLETA)."""
    return 250 if _OMNI_LIST_RX.search(msg_low or "") else 30


async def _omni_overview(user: dict, msg_low: str) -> dict:
    """Panoramica di TUTTE le sezioni con conteggi + liste compatte (limiti per non saturare il prompt)."""
    tid = tenant_id(user); uid = user["user_id"]; now = utcnow()
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    cq = await _omni_contact_query(user)
    ov: dict = {}

    # --- Contatti: totale, per stato/area/città, lista compatta (fino a 250) ---
    total = await db.contacts.count_documents(cq)
    by_status = {}; by_area = {}; by_city = {}
    async for row in db.contacts.aggregate([{"$match": cq}, {"$group": {"_id": {"s": "$status", "a": "$area", "c": "$address_city"}, "n": {"$sum": 1}}}]):
        k = row["_id"] or {}
        by_status[k.get("s") or "?"] = by_status.get(k.get("s") or "?", 0) + row["n"]
        by_area[k.get("a") or "?"] = by_area.get(k.get("a") or "?", 0) + row["n"]
        if k.get("c"):
            by_city[k["c"]] = by_city.get(k["c"], 0) + row["n"]
    active_clients = await db.contacts.count_documents({"$and": [cq, {"is_active_client": True}]})
    lst = []
    async for c in db.contacts.find(cq, {"_id": 0, "contact_id": 1, "first_name": 1, "last_name": 1, "company": 1, "contact_code": 1, "phone": 1, "phone_mobile": 1, "whatsapp": 1, "email": 1, "address_city": 1, "city": 1, "area": 1, "status": 1, "is_active_client": 1, "tags": 1, "source": 1, "created_at": 1}).sort("last_name", 1).limit(_omni_contact_list_limit(msg_low)):
        lst.append(_omni_compact_contact(c))
    ov["contatti"] = {"totale": total, "clienti_attivi": active_clients, "per_stato": by_status, "per_area": by_area,
                      "per_citta_top": dict(sorted(by_city.items(), key=lambda x: -x[1])[:15]),
                      "elenco": lst, "elenco_troncato": total > len(lst)}

    # --- Appuntamenti: passati 30gg + futuri 60gg, statistiche ---
    appts = []
    a_q = _omni_own(user, {"start_at": {"$gte": today - timedelta(days=30), "$lte": today + timedelta(days=60)}})
    cmap_ids = set()
    async for a in db.appointments.find(a_q, {"_id": 0, "appointment_id": 1, "title": 1, "start_at": 1, "location": 1, "contact_id": 1, "done": 1, "outcome_tags": 1, "contract_signed": 1, "is_phone": 1, "area": 1, "value_amount": 1, "appointment_type_tags": 1}).sort("start_at", 1).limit(80):
        appts.append(a)
        if a.get("contact_id"):
            cmap_ids.add(a["contact_id"])
    names = {}
    if cmap_ids:
        async for c in db.contacts.find({"contact_id": {"$in": list(cmap_ids)}}, {"_id": 0, "contact_id": 1, "first_name": 1, "last_name": 1}):
            names[c["contact_id"]] = _omni_name(c)
    ov["appuntamenti"] = {
        "totale_storico": await db.appointments.count_documents(_omni_own(user)),
        "oggi": await db.appointments.count_documents(_omni_own(user, {"start_at": {"$gte": today, "$lt": today + timedelta(days=1)}})),
        "prossimi_7gg": await db.appointments.count_documents(_omni_own(user, {"start_at": {"$gte": today, "$lt": today + timedelta(days=7)}})),
        "ultimi_30gg_fatti": await db.appointments.count_documents(_omni_own(user, {"start_at": {"$gte": today - timedelta(days=30), "$lt": now}, "done": True})),
        "ultimi_30gg_con_contratto": await db.appointments.count_documents(_omni_own(user, {"start_at": {"$gte": today - timedelta(days=30), "$lt": now}, "contract_signed": True})),
        "elenco_-30gg_+60gg": [{"quando": _omni_dt(a.get("start_at")), "titolo": a.get("title") or "", "cliente": names.get(a.get("contact_id")),
                                "luogo": a.get("location") or "", "tipo": a.get("appointment_type_tags") or [], "telefonico": bool(a.get("is_phone")),
                                "fatto": bool(a.get("done")), "esito": a.get("outcome_tags") or [], "contratto": bool(a.get("contract_signed")), "valore": a.get("value_amount") or None}
                               for a in appts],
    }

    # --- Ritelefonate aperte ---
    cbs = []
    cb_q = {"$and": [{"$or": [{"user_id": tid}, {"tenant_id": tid}]}, {"$or": [{"done": False}, {"done": {"$exists": False}}]}, {"status": {"$nin": ["done", "fatta", "cancelled"]}}]}
    if not is_owner(user):
        cb_q["$and"].append({"$or": [{"created_by": uid}, {"user_id": uid}, {"assignee_user_id": uid}]})
    async for cb in db.callbacks.find(cb_q, {"_id": 0}).sort("created_at", -1).limit(40):
        cname = names.get(cb.get("contact_id"))
        if not cname and cb.get("contact_id"):
            c = await db.contacts.find_one({"contact_id": cb["contact_id"]}, {"first_name": 1, "last_name": 1}); cname = _omni_name(c) if c else None
        cbs.append({"quando": _omni_dt(cb.get("next_at") or cb.get("scheduled_at")), "titolo": cb.get("title") or "", "cliente": cname, "tel": cb.get("phone") or "",
                    "priorita": cb.get("priority") or "", "note": (cb.get("notes") or "")[:120]})
    ov["ritelefonate_aperte"] = {"totale": len(cbs), "elenco": cbs}

    # --- Telefonate: oggi / 7gg / 30gg + esiti + ultime 20 ---
    cl_base = _omni_own(user)
    per_esito = {}
    async for row in db.call_logs.aggregate([{"$match": _omni_own(user, {"created_at": {"$gte": today - timedelta(days=30)}})}, {"$group": {"_id": "$outcome_id", "n": {"$sum": 1}}}]):
        per_esito[row["_id"] or "?"] = row["n"]
    last_calls = []
    async for cl in db.call_logs.find(cl_base, {"_id": 0, "created_at": 1, "outcome_id": 1, "note": 1, "phone": 1, "contact_id": 1, "duration_sec": 1}).sort("created_at", -1).limit(20):
        last_calls.append(f"{_omni_dt(cl.get('created_at'))} · {names.get(cl.get('contact_id')) or cl.get('phone') or '?'} · {cl.get('outcome_id') or '?'} · {(cl.get('note') or '')[:80]}")
    ov["telefonate"] = {"oggi": await db.call_logs.count_documents(_omni_own(user, {"created_at": {"$gte": today}})),
                        "ultimi_7gg": await db.call_logs.count_documents(_omni_own(user, {"created_at": {"$gte": today - timedelta(days=7)}})),
                        "ultimi_30gg": await db.call_logs.count_documents(_omni_own(user, {"created_at": {"$gte": today - timedelta(days=30)}})),
                        "esiti_30gg": per_esito, "ultime": last_calls}

    # --- Contratti: tutti (fino a 60) + per stato + somma importi ---
    ctrs = []; per_stato = {}; tot_eur = 0.0
    async for ct in db.contracts.find(_omni_own(user), {"_id": 0, "pdf_base64": 0}).sort("created_at", -1).limit(60):
        per_stato[ct.get("status") or "?"] = per_stato.get(ct.get("status") or "?", 0) + 1
        try:
            tot_eur += float(ct.get("amount_eur") or ct.get("amount") or 0)
        except Exception:
            pass
        cname = names.get(ct.get("contact_id"))
        if not cname and ct.get("contact_id"):
            c = await db.contacts.find_one({"contact_id": ct["contact_id"]}, {"first_name": 1, "last_name": 1}); cname = _omni_name(c) if c else None
        ctrs.append({"numero": ct.get("contract_number") or ct.get("title") or "", "cliente": cname, "tipo": ct.get("contract_type") or "", "fornitore": ct.get("supplier") or "",
                     "importo_eur": ct.get("amount_eur") or ct.get("amount"), "stato": ct.get("status") or "", "firma": _omni_dt(ct.get("signed_date")),
                     "attivazione": _omni_dt(ct.get("activation_date")), "scadenza": _omni_dt(ct.get("expiry_date")), "note": (ct.get("notes") or "")[:100]})
    ov["contratti"] = {"totale": await db.contracts.count_documents(_omni_own(user)), "per_stato": per_stato, "somma_importi_eur_elenco": round(tot_eur, 2), "elenco": ctrs}

    # --- Scadenze (da bollette analizzate) ---
    try:
        contact_ids = [c["id"] for c in lst if c.get("id")]
        if total > len(lst):
            contact_ids = [c["contact_id"] async for c in db.contacts.find(cq, {"_id": 0, "contact_id": 1}).limit(5000)]
        dl = []
        async for b in db.energy_bills.find({"user_id": tid, "contact_id": {"$in": contact_ids}, "status": "done"}, {"_id": 0, "pdf_base64": 0}).limit(2000):
            d = _bill_deadline_entry(b)
            if d and d.get("days_left") is not None and -365 <= d["days_left"] <= 180:
                cn = names.get(b.get("contact_id"))
                if not cn:
                    c = await db.contacts.find_one({"contact_id": b.get("contact_id")}, {"first_name": 1, "last_name": 1}); cn = _omni_name(c) if c else None
                dl.append({"cliente": cn, "tipo": d.get("bill_type"), "fornitore": d.get("fornitore"), "offerta": d.get("nome_offerta"), "scade_il": str(d.get("due_date") or "")[:10], "giorni": d.get("days_left"), "stato": d.get("status")})
        dl.sort(key=lambda x: x.get("giorni") if x.get("giorni") is not None else 9999)
        ov["scadenze_contratti_da_bollette"] = {"totale": len(dl), "elenco": dl[:40]}
    except Exception as exc:  # noqa: BLE001
        ov["scadenze_contratti_da_bollette"] = {"errore": str(exc)[:100]}

    # --- Bollette analizzate (conteggio) ---
    ov["bollette_analizzate"] = {"totale": await db.energy_bills.count_documents({"user_id": tid, "status": "done"}),
                                 "in_errore": await db.energy_bills.count_documents({"user_id": tid, "status": "error"})}

    # --- Note recenti (embedded nei contatti + contact_notes) ---
    recent_notes = []
    async for n in db.contact_notes.find({"tenant_id": tid} if is_owner(user) else {"tenant_id": tid, "user_id": uid}, {"_id": 0, "contact_id": 1, "text": 1, "created_at": 1}).sort("created_at", -1).limit(15):
        cn = names.get(n.get("contact_id"))
        if not cn and n.get("contact_id"):
            c = await db.contacts.find_one({"contact_id": n["contact_id"]}, {"first_name": 1, "last_name": 1}); cn = _omni_name(c) if c else "?"
        recent_notes.append(f"{_omni_dt(n.get('created_at'))} · {cn}: {(n.get('text') or '')[:160]}")
    async for c in db.contacts.find({"$and": [cq, {"notes.0": {"$exists": True}}]}, {"_id": 0, "first_name": 1, "last_name": 1, "notes": {"$slice": -3}}).sort("updated_at", -1).limit(15):
        for n in c.get("notes") or []:
            if n.get("text"):
                recent_notes.append(f"{_omni_dt(n.get('created_at'))} · {_omni_name(c)}: {n['text'][:160]}")
    ov["note_recenti"] = recent_notes[:30]

    # --- Gruppi ---
    ov["gruppi"] = [g.get("name") async for g in db.groups.find({"user_id": tid}, {"_id": 0, "name": 1}).limit(50)]

    # --- Team (Master vede tutti; collaboratore vede sé stesso) ---
    if is_admin_or_owner(user):
        members = []
        async for u in db.users.find({"$or": [{"user_id": tid}, {"parent_user_id": tid}]}, {"_id": 0, "user_id": 1, "name": 1, "email": 1, "role": 1, "created_at": 1}).limit(100):
            m_uid = u["user_id"]
            members.append({"nome": u.get("name"), "email": u.get("email"), "ruolo": u.get("role"),
                            "contatti_creati": await db.contacts.count_documents({"user_id": tid, "created_by": m_uid}),
                            "appuntamenti_30gg": await db.appointments.count_documents({"user_id": tid, "created_by": m_uid, "start_at": {"$gte": today - timedelta(days=30)}}),
                            "telefonate_30gg": await db.call_logs.count_documents({"user_id": tid, "created_by": m_uid, "created_at": {"$gte": today - timedelta(days=30)}}),
                            "contratti": await db.contracts.count_documents({"user_id": tid, "created_by": m_uid})})
        ov["team"] = {"membri": members}

    # --- Corporate Gym ---
    try:
        g_q = {"tenant_id": tid} if is_admin_or_owner(user) else {"tenant_id": tid, "user_id": uid}
        _gym_detail = bool(_omni_re.search(r"gym|formazion|role.?play|obiezion|allenament|training|collaborator|team|report|punteggi|sessioni", msg_low or ""))
        sessions = await db.cgym_sessions.find(g_q, {"_id": 0, "user_id": 1, "type": 1, "title": 1, "status": 1, "score": 1, "scheduled_at": 1, "completed_at": 1, "mandatory": 1}).sort("created_at", -1).limit(40).to_list(40)
        u_names = {}
        async for u in db.users.find({"user_id": {"$in": list({s.get("user_id") for s in sessions})}}, {"_id": 0, "user_id": 1, "name": 1}):
            u_names[u["user_id"]] = u.get("name")
        scores = [float(s["score"]) for s in sessions if s.get("score") is not None]
        reports = []
        async for r in db.cgym_ai_reports.find(g_q if is_admin_or_owner(user) else {"tenant_id": tid, "user_id": uid}, {"_id": 0, "kind": 1, "agent_name": 1, "generated_at": 1, "content": 1}).sort("generated_at", -1).limit(3):
            ct = r.get("content") or {}
            reports.append({"tipo": r.get("kind"), "agente": r.get("agent_name"), "quando": _omni_dt(r.get("generated_at")), "sintesi": str(ct.get("summary") or ct.get("sintesi") or ct)[:160]})  # V50.z421 — 400 → 160 car.
        ov["corporate_gym"] = {"sessioni_totali": len(sessions), "completate": sum(1 for s in sessions if s.get("status") == "completata"),
                               "da_fare": sum(1 for s in sessions if s.get("status") not in ("completata", "annullata")),
                               "punteggio_medio": round(sum(scores) / len(scores), 1) if scores else None,
                               "roleplay_disponibili": await db.cgym_roleplays.count_documents({}),
                               "sessioni": [{"chi": u_names.get(s.get("user_id")), "tipo": s.get("type"), "titolo": s.get("title"), "stato": s.get("status"), "punteggio": s.get("score"),
                                             "programmata": _omni_dt(s.get("scheduled_at")), "completata": _omni_dt(s.get("completed_at")), "obbligatoria": bool(s.get("mandatory"))} for s in (sessions[:6] if _gym_detail else [])],
                               "report_axon": reports if _gym_detail else [],  # V50.z421 — dettagli Gym solo se richiesti (messaggio su gym/formazione/collaboratori)
                               "manuali_drive": bool(await db.cgym_manuals_config.find_one({"tenant_id": tid}, {"_id": 1}))}
    except Exception as exc:  # noqa: BLE001
        ov["corporate_gym"] = {"errore": str(exc)[:100]}

    # --- My Thing, audio, biglietto, mail, master files, documenti/offerte, KB, regole, sveglie, chat, link, drive ---
    my_q = {"owner_user_id": uid}
    ov["my_thing"] = {"totale": await db.my_thing.count_documents(my_q),
                      "elementi": [f"{m.get('kind')}: {m.get('title') or ''} — {(m.get('body') or '')[:80]}" async for m in db.my_thing.find(my_q, {"_id": 0, "kind": 1, "title": 1, "body": 1}).sort("created_at", -1).limit(6)]}  # V50.z421 — 15 → 6
    ov["audio_personali"] = await db.audio_records.count_documents({"created_by": uid})
    bc = await db.business_cards.find_one({"user_id": uid}, {"_id": 0, "display_name": 1, "title": 1, "card_id": 1})
    if bc:
        ov["biglietto_da_visita"] = {"nome": bc.get("display_name"), "titolo": bc.get("title"), "visualizzazioni": await db.business_card_views.count_documents({"card_id": bc.get("card_id")}),
                                     "lead_ricevuti": await db.public_leads.count_documents({"user_id": uid}), "recensioni": await db.reviews.count_documents({"user_id": uid})}
    ov["caselle_mail"] = [f"{m.get('label') or ''} <{m.get('email')}> ({m.get('provider')}){' — errore: ' + m['last_error'][:60] if m.get('last_error') else ''}" async for m in db.mail_accounts.find({"user_id": uid}, {"_id": 0, "email": 1, "label": 1, "provider": 1, "last_error": 1}).limit(10)]
    mf_q = {"user_id": tid}
    ov["master_files"] = {"totale": await db.master_files.count_documents(mf_q),
                          "ultimi": [f"{f.get('category') or ''} · {f.get('title') or f.get('name')} ({_omni_dt(f.get('created_at'))})" async for f in db.master_files.find(mf_q, {"_id": 0, "category": 1, "title": 1, "name": 1, "created_at": 1}).sort("created_at", -1).limit(6)]}  # V50.z421 — 15 → 6
    ov["documenti_azienda"] = [d.get("name") async for d in db.company_documents.find({"tenant_id": tid}, {"_id": 0, "name": 1}).limit(20)]
    ov["offerte_azienda"] = [f"{o.get('bill_type')}: {o.get('label') or o.get('pdf_name')}" async for o in db.company_offers.find({"user_id": tid}, {"_id": 0, "bill_type": 1, "label": 1, "pdf_name": 1}).limit(20)]
    ov["documenti_master_rag"] = [f"{d.get('name')} ({d.get('total_pages') or 0} pag.)" async for d in db.master_documents.find({"tenant_id": tid}, {"_id": 0, "name": 1, "total_pages": 1}).limit(20)]
    ov["kb_pagine_web_salvate"] = [k.get("title") or k.get("url") async for k in db.axon_kb.find({"user_id": tid}, {"_id": 0, "title": 1, "url": 1}).limit(20)]
    ov["regole_insegnate_ad_axon"] = [f"{r.get('category') or ''}: {r.get('title')}" async for r in db.ai_teach_rules.find({"user_id": tid}, {"_id": 0, "title": 1, "category": 1}).limit(25)]
    ov["link_web_personali"] = [f"{l.get('title')} — {l.get('url')}" async for l in db.web_links.find({"user_id": uid}, {"_id": 0, "title": 1, "url": 1}).limit(15)]
    ov["sveglie_timer"] = [f"{a.get('kind')} {a.get('label') or ''} {a.get('time') or ''} {'ON' if a.get('enabled') else 'off'}" async for a in db.axon_alarms.find({"user_id": uid}, {"_id": 0, "kind": 1, "label": 1, "time": 1, "enabled": 1}).limit(10)]
    ov["chat_team_canali"] = await db.chat_channels.count_documents({"$or": [{"user_id": tid}, {"member_user_ids": uid}]})
    ov["google_drive_collegato"] = bool(await db.google_drive_connections.find_one({"user_id": tid}, {"_id": 1}))
    ov["inviti_eventi"] = await db.invites.count_documents({"user_id": tid})
    st = await db.settings.find_one({"user_id": tid}, {"_id": 0, "app_name": 1, "energy_title": 1, "network_title": 1, "custom_areas": 1, "call_outcomes": 1, "appointment_outcomes": 1, "office_address": 1})
    if st:
        ov["impostazioni_tenant"] = {"nome_app": st.get("app_name"), "aree": [st.get("energy_title"), st.get("network_title")] + [a.get("name") for a in (st.get("custom_areas") or []) if isinstance(a, dict)],
                                    "esiti_chiamata": [o.get("label") if isinstance(o, dict) else o for o in (st.get("call_outcomes") or [])][:15],
                                    "esiti_appuntamento": [o.get("label") if isinstance(o, dict) else o for o in (st.get("appointment_outcomes") or [])][:15],
                                    "indirizzo_ufficio": st.get("office_address")}
    return ov


async def _build_crm_omniscience_section(user: dict, msg: str) -> str:
    """Sezione prompt: mappa app + panoramica completa + dossier dei contatti citati nel messaggio."""
    import time as _omni_time
    _t0 = _omni_time.time()
    msg_low = (msg or "").lower()
    _map = _omni_app_map_text(msg)
    parts = [("\n\n" + _map) if _map else ""]
    try:
        ov = await _omni_overview(user, msg_low)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[axon-omni] overview failed: %s", exc)
        ov = {"errore": str(exc)[:200]}
    dossiers = []
    try:
        terms = _omni_terms(msg)
        for c in await _omni_find_contacts(user, terms):
            dossiers.append(await _omni_contact_dossier(user, c))
    except Exception as exc:  # noqa: BLE001
        logger.warning("[axon-omni] dossier failed: %s", exc)
    if dossiers:
        parts.append("\n\nSCHEDE COMPLETE DEI CONTATTI CITATI NEL MESSAGGIO (tutto ciò che l'app sa di loro — note, file, appuntamenti, "
                     "ritelefonate, telefonate, contratti, bollette, scadenze, profilo Axon):\n" + _omni_json.dumps(dossiers, ensure_ascii=False, default=str))
    ov_json = _omni_json.dumps(ov, ensure_ascii=False, default=str)
    budget = _OMNI_MAX_CHARS - sum(len(p) for p in parts)
    if len(ov_json) > budget:
        # riduci progressivamente le liste lunghe
        for k in ("contatti", "appuntamenti", "contratti"):
            if k in ov and isinstance(ov[k], dict):
                for lk in list(ov[k].keys()):
                    if lk.startswith("elenco") and isinstance(ov[k][lk], list):
                        ov[k][lk] = ov[k][lk][:40]
                        ov[k]["elenco_troncato"] = True
        ov_json = _omni_json.dumps(ov, ensure_ascii=False, default=str)
        if len(ov_json) > budget:
            ov_json = ov_json[:max(2000, budget)] + "\n... (troncato)"
    parts.append("\n\nDATI COMPLETI CRM — TUTTE LE SEZIONI DELL'APP (JSON; conteggi reali + elenchi; rispetta la visibilità dell'utente). "
                 "Usa QUESTI dati per qualunque domanda su contatti, appuntamenti, note, scadenze, contratti, telefonate, ritelefonate, gruppi, team, "
                 "Corporate Gym, My Thing, mail, Master Files, documenti, KB, regole, sveglie, biglietto, impostazioni. Se un elenco è "
                 "'elenco_troncato', di' che stai mostrando i primi risultati e invita a precisare il nome per la scheda completa:\n" + ov_json)
    out = "".join(parts)
    logger.info("[axon-omni] section built in %.2fs — %d chars, %d dossier", _omni_time.time() - _t0, len(out), len(dossiers))
    return out

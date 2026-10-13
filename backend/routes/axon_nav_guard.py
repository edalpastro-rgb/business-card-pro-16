# ============================================================================
# V50.z487 — NAV GUARD: nessun link interno rotto nelle risposte di Axon
# ----------------------------------------------------------------------------
# • _NAV_REAL_PATHS: elenco delle schermate REALI dell'app (file sotto frontend/app) + prefissi dinamici (/contact/<id>…)
# • _NAV_ALIASES: route «inventate» tipiche del modello (/settings, /permissions, /configurazione-guidata…) → route vera
# • _nav_resolve_route(route, label): route valida (normalizzata) oppure None
# • _nav_sanitize_markers(text): ogni [[NAV:route|label]] non valido → route corretta se riconoscibile (alias / nome schermata),
#   altrimenti istruzioni testuali passo-passo (mai un pulsante che porta a una schermata sbagliata o inesistente)
# • NavStreamFilter: stessa pulizia sullo stream SSE (trattiene i «[[…]]» finché il marker non è completo)
# • APP_MAP: aggiunte le schermate mancanti (Permessi dispositivo, Set Up and Go, Storico PUN, Privacy, Dispositivi…)
# • Prompt: il modello deve usare SOLO route presenti nell'elenco; schermata assente → spiegazione a parole
# • GPS: client_context.position (lat/lon reali dal telefono) → sezione «POSIZIONE GPS» + clienti più vicini
# ============================================================================
import re as _ng_re
import difflib as _ng_difflib
import asyncio as _ng_asyncio
from typing import Optional as _ng_Optional

# ---------------------------------------------------------------------------
# 1) Schermate REALI (frontend/app/**.tsx → route). Le route dinamiche sono prefissi.
# ---------------------------------------------------------------------------
_NAV_REAL_PATHS = {
    "/", "/home", "/calendario", "/chat", "/contatti", "/help", "/impostazioni", "/report", "/webviewer",
    "/admin/beta", "/admin/customers", "/admin/onboarding", "/admin/org-plans", "/admin/promo-codes", "/admin/users", "/admin/register-guard", "/admin/upload-guard", "/admin/wake-samples", "/admin/welcome-email",
    "/ai-teach", "/anagrafica-master", "/appointment/new", "/appointment-stats", "/auth/forgot-password", "/axon-alarms", "/axon-alerts", "/axon-brain",
    "/axon-cheatsheet", "/axon-expenses", "/axon-homeassistant", "/axon-hub", "/axon-insights", "/axon-integrations", "/axon-lab", "/axon-lab/business",
    "/axon-lab/delegates", "/axon-lab/rules", "/axon-lab/training", "/axon-media", "/axon-memory", "/axon-notifications", "/axon-proactive",
    "/axon-scripts-import", "/axon-scripts", "/axon-stress-report", "/axon-system", "/axon-voice", "/beta-diary", "/beta-nps", "/bill-quick", "/bug-report",
    "/business-card-stats", "/business-card", "/call-script-config", "/callback/new", "/chat/new", "/contact/new", "/contact/import-folder", "/contacts-import",
    "/contract/new", "/corporate/new", "/corporate-gym", "/corporate-gym/areas-edit", "/corporate-gym/assign", "/corporate-gym/coach-panel", "/corporate-gym/live",
    "/corporate-gym/manuals-config", "/corporate-gym/obiezioni", "/corporate-gym/ratings", "/corporate-gym/roleplay", "/corporate-gym/stats", "/corporate-gym/win-win",
    "/call", "/courses", "/courses/dashboard", "/courses/new", "/crt", "/cruscotto", "/custom-fields", "/dashboard-config", "/deadlines", "/devices", "/documenti-axon",
    "/dropbox", "/email-accounts", "/email-config", "/event-banners", "/faq", "/form-templates", "/google-drive-picker", "/google-drive", "/groups",
    "/help-center-admin", "/help-center", "/info-request-chat", "/info-requests", "/invita-amico", "/invita-pick", "/invita", "/invitati", "/invite-collaborator",
    "/km-report", "/le-mie-aree", "/libretto-editor", "/libretto", "/lite", "/login", "/mail-crm-proposals", "/map-clients", "/master-files", "/master",
    "/mercato", "/meteo", "/my-audios", "/my-thing", "/my-web", "/neo-memory", "/offline-sync", "/optimal-route", "/outlook", "/paywall", "/pdf-viewer",
    "/permessi-onboarding", "/permessi", "/personalizzazione-aziendale", "/privacy-policy", "/pun-storico", "/quick-actions", "/reviews-analytics", "/scanner",
    "/security-info", "/security", "/settings-app", "/setup-config", "/setup", "/smtp", "/spazio-personale-anagrafica", "/spazio-personale", "/team-compare",
    "/team-insights", "/team", "/tour-features", "/tour", "/viola-wake", "/voice-copilot", "/voice-enroll", "/voice-profiles", "/wake-training",
    "/wake-word-training", "/wake-word",
}
# route dinamiche: /prefisso/<id>
_NAV_DYNAMIC_PREFIXES = ("/appointment/", "/audio-transcript/", "/axon-lab/module/", "/axon-lab/practice/", "/callback/", "/chat/", "/contact/edit/", "/contact/",
                         "/corporate-gym/area/", "/courses/", "/crt/", "/event/", "/filled-form/", "/form-template/", "/groups/", "/invite/", "/public-lead/",
                         "/public-review/", "/public-reviews/")
# sezioni valide di /impostazioni?section=
_NAV_SETTINGS_SECTIONS = {"general", "security", "billing", "branding", "integrations", "axon", "assistente", "assistant"}
_NAV_SETTINGS_SECTION_ALIASES = {
    "generale": "general", "generali": "general", "profilo": "general", "profile": "general", "dati": "general", "preferenze": "general", "gps": "general", "visite": "general",
    "sicurezza": "security", "password": "security", "2fa": "security", "pin": "security",
    "abbonamento": "billing", "pagamenti": "billing", "pagamento": "billing", "piano": "billing", "promo": "billing", "fatturazione": "billing",
    "personalizzazione": "branding", "brand": "branding", "logo": "branding", "azienda": "branding",
    "integrazioni": "integrations", "integration": "integrations", "servizi": "integrations",
    "ai": "axon", "assistente": "axon", "assistant": "axon", "voce": "axon", "lingua": "axon", "tono": "axon", "axonos": "axon", "ai-axon": "axon",
    # sezioni che NON esistono dentro Impostazioni → schermata dedicata
    "permessi": "@/permessi?standalone=1", "permissions": "@/permessi?standalone=1", "autorizzazioni": "@/permessi?standalone=1",
    "notifiche": "@/axon-notifications?tab=prefs", "notifications": "@/axon-notifications?tab=prefs",
    "dispositivi": "@/devices", "devices": "@/devices", "offline": "@/offline-sync", "aree": "@/le-mie-aree",
    "wizard": "@/setup", "setup": "@/setup", "configurazione": "@/setup", "privacy": "@/privacy-policy",
}
# route inventate dal modello → route reale (chiavi SENZA query, minuscole)
_NAV_ALIASES = {
    "/settings": "/impostazioni", "/setting": "/impostazioni", "/impostazione": "/impostazioni", "/profilo": "/impostazioni?section=general", "/profile": "/impostazioni?section=general",
    "/preferenze": "/impostazioni?section=general", "/account": "/impostazioni?section=general", "/dati-personali": "/impostazioni?section=general",
    "/sicurezza": "/impostazioni?section=security", "/password": "/impostazioni?section=security", "/2fa": "/impostazioni?section=security",
    "/abbonamento": "/impostazioni?section=billing", "/billing": "/impostazioni?section=billing", "/pagamenti": "/impostazioni?section=billing", "/promo": "/impostazioni?section=billing",
    "/integrazioni": "/axon-integrations", "/integrations": "/axon-integrations",
    "/axon-settings": "/impostazioni?section=axon", "/axon-config": "/impostazioni?section=axon", "/impostazioni-axon": "/impostazioni?section=axon", "/assistente": "/impostazioni?section=axon",
    "/permissions": "/permessi?standalone=1", "/permessi-dispositivo": "/permessi?standalone=1", "/autorizzazioni": "/permessi?standalone=1", "/impostazioni/permessi": "/permessi?standalone=1",
    "/settings/permissions": "/permessi?standalone=1", "/device-permissions": "/permessi?standalone=1",
    "/setup-wizard": "/setup", "/wizard": "/setup", "/configurazione-guidata": "/setup", "/configurazione": "/setup", "/set-up-and-go": "/setup", "/setup-and-go": "/setup", "/onboarding": "/setup",
    "/notifiche": "/axon-notifications?tab=prefs", "/notifications": "/axon-notifications?tab=prefs", "/impostazioni/notifiche": "/axon-notifications?tab=prefs",
    "/agenda": "/calendario", "/calendar": "/calendario", "/appuntamenti": "/calendario", "/appointments": "/calendario", "/appointment": "/appointment/new", "/nuovo-appuntamento": "/appointment/new",
    "/contacts": "/contatti", "/clienti": "/contatti", "/clients": "/contatti", "/rubrica": "/contatti", "/anagrafica": "/contatti", "/nuovo-contatto": "/contact/new", "/contatto/nuovo": "/contact/new", "/contact": "/contatti",
    "/mappa": "/map-clients", "/map": "/map-clients", "/mappa-clienti": "/map-clients", "/clienti-vicini": "/map-clients",
    "/scan": "/scanner", "/scanner-documenti": "/scanner", "/ocr": "/scanner", "/documenti": "/documenti-axon",
    "/fatture": "/bill-quick", "/bollette": "/bill-quick", "/bills": "/bill-quick", "/analisi-fatture": "/bill-quick", "/analisi-bolletta": "/bill-quick",
    "/aiuto": "/help", "/supporto": "/help", "/support": "/help", "/assistenza": "/help", "/segnala": "/help-center", "/bug": "/help-center",
    "/manuale": "/libretto", "/guida": "/libretto", "/libretto-istruzioni": "/libretto", "/istruzioni": "/libretto",
    "/import": "/contacts-import", "/importa-contatti": "/contacts-import", "/importa": "/contacts-import",
    "/giro": "/optimal-route", "/giro-ottimale": "/optimal-route", "/axon-drive": "/voice-copilot", "/drive": "/voice-copilot", "/copilota": "/voice-copilot", "/navigatore": "/optimal-route",
    "/km": "/km-report", "/chilometri": "/km-report", "/spese": "/axon-expenses", "/expenses": "/axon-expenses",
    "/memoria": "/axon-memory", "/memory": "/axon-memory", "/insegna": "/ai-teach", "/teach": "/ai-teach", "/regole": "/ai-teach",
    "/allarmi": "/axon-alarms", "/alarms": "/axon-alarms", "/avvisi": "/axon-alerts", "/alerts": "/axon-alerts",
    "/audio": "/my-audios", "/registrazioni": "/my-audios", "/trascrizioni": "/my-audios",
    "/mail": "/email-accounts", "/email": "/email-accounts", "/posta": "/email-accounts", "/caselle-mail": "/email-accounts",
    "/collaboratori": "/team", "/squadra": "/team", "/team-management": "/team", "/invita-collaboratore": "/invite-collaborator",
    "/corsi": "/courses", "/formazione": "/courses", "/gym": "/corporate-gym",
    "/contratti": "/crt", "/contratto": "/crt", "/pratiche": "/crt", "/nuovo-contratto": "/contract/new",
    "/pun": "/pun-storico", "/storico-pun": "/pun-storico", "/prezzo-energia": "/pun-storico",
    "/privacy": "/privacy-policy", "/informativa-privacy": "/privacy-policy", "/dispositivi": "/devices", "/offline": "/offline-sync", "/sincronizzazione": "/offline-sync",
    "/aree": "/le-mie-aree", "/campi": "/custom-fields", "/campi-personalizzati": "/custom-fields", "/azioni-rapide": "/quick-actions", "/widget": "/dashboard-config",
    "/statistiche": "/home?section=statistiche", "/dashboard": "/home?section=statistiche", "/kpi": "/home?section=statistiche", "/scadenze": "/deadlines", "/telefonate": "/call", "/chiamate": "/call",
    "/ritelefonate": "/home?section=ritelefonate", "/richiamate": "/home?section=ritelefonate", "/callbacks": "/home?section=ritelefonate", "/callback": "/callback/new",
    "/biglietto": "/business-card", "/biglietto-da-visita": "/business-card", "/vcard": "/business-card",
    "/wake-word-settings": "/viola-wake", "/ehi-axon": "/viola-wake", "/voce": "/impostazioni?section=axon", "/tts": "/impostazioni?section=axon",
    "/beta": "/beta-diary", "/diario": "/beta-diary", "/nps": "/beta-nps", "/sondaggio": "/beta-nps",
    "/archivio": "/master-files", "/file": "/master-files", "/files": "/master-files", "/drive-google": "/google-drive", "/gdrive": "/google-drive",
    "/mercato-energia": "/mercato", "/concorrenti": "/mercato", "/benchmark": "/mercato",
    "/tour-guidato": "/tour", "/funzioni": "/tour-features", "/tutte-le-funzioni": "/tour-features",
    "/invita-amici": "/invita-amico", "/referral": "/invita-amico", "/codice-amico": "/impostazioni?section=billing",
    "/cruscotto-beta": "/admin/beta", "/onboarding-consulenti": "/admin/onboarding",
}

# percorso «a parole» per gruppo APP_MAP (fallback quando non esiste una schermata/route)
_NAV_GROUP_PATH = {
    "Home": "tab «Home» in basso", "Contatti": "tab «Contatti» in basso", "Calendario": "tab «Calendario» in basso",
    "AxonOS": "Home → icona Axon in alto → «Axon Hub»", "Axon Drive": "Home → «Azioni rapide» → «Axon Drive»",
    "Fatture e Scanner": "Home → «Azioni rapide»", "Caselle Mail": "tab «Impostazioni» → «Integrazioni» → «Caselle mail»",
    "Help": "tab «Help» in basso", "Profilo": "tab «Impostazioni» in basso", "Impostazioni": "tab «Impostazioni» in basso",
    "Master": "Home → card «Interfaccia Master»",
}


def _nav_split(route: str):
    r = (route or "").strip()
    r = r.split("#")[0]
    if "?" in r:
        p, q = r.split("?", 1)
    else:
        p, q = r, ""
    p = ("/" + p.strip().lstrip("/")).rstrip("/") or "/"
    return p.lower(), q.strip()


def _nav_path_exists(path: str) -> bool:
    if path in _NAV_REAL_PATHS:
        return True
    return any(path.startswith(pre) and len(path) > len(pre) and "/" not in path[len(pre):] for pre in _NAV_DYNAMIC_PREFIXES)


def _nav_fix_settings_query(q: str) -> _ng_Optional[str]:
    """/impostazioni?section=X → query valida, '@/route' per redirezione, '' se nessuna sezione, None se sconosciuta."""
    m = _ng_re.search(r"(?:^|&)section=([^&]*)", q or "")
    if not m:
        return q or ""
    sec = (m.group(1) or "").strip().lower()
    if not sec:
        return ""  # «?section=» vuoto → hub Impostazioni
    if sec in _NAV_SETTINGS_SECTIONS:
        return f"section={'axon' if sec in ('assistente', 'assistant') else sec}"
    al = _NAV_SETTINGS_SECTION_ALIASES.get(sec)
    if al:
        return al if al.startswith("@") else f"section={al}"
    return None


def _nav_slug_match(path: str) -> _ng_Optional[str]:
    """Route quasi giusta (refuso / inglese / trattini) → route reale più simile."""
    cands = sorted(_NAV_REAL_PATHS)
    best = _ng_difflib.get_close_matches(path, cands, n=1, cutoff=0.86)
    if best:
        return best[0]
    # ultimo segmento del path (es. /impostazioni/dispositivi → /dispositivi → /devices)
    last = "/" + path.rsplit("/", 1)[-1]
    if last != path:
        if last in _NAV_REAL_PATHS:
            return last
        if last in _NAV_ALIASES:
            return _NAV_ALIASES[last]
    return None


def _nav_route_by_label(label: str, user: _ng_Optional[dict] = None) -> _ng_Optional[str]:
    """Etichetta del pulsante → voce APP_MAP (keyword scoring del navigatore)."""
    try:
        toks = _nav_tokens(label or "")  # noqa: F821 — axon_navigator.py
        if not toks:
            return None
        master = _nav_is_master(user or {})  # noqa: F821
        last = toks[-1]  # «Impostazioni → Permessi»: l'ultima parola è il bersaglio
        best, best_score = None, 0
        for e in APP_MAP:  # noqa: F821
            if (e.get("master_only") and not master) or "{id}" in e["route"]:
                continue
            sc = _nav_score(e, toks)  # noqa: F821
            if not sc:
                continue
            sc += 2 * len(set(_nav_tokens(e["name"])) & set(toks))  # noqa: F821
            if any(last in _nav_tokens(k) for k in e["kw"]):  # noqa: F821
                sc += 3
            if sc > best_score:
                best, best_score = e, sc
        return best["route"] if best and best_score >= 5 else None
    except Exception:
        return None


def _nav_resolve_route(route: str, label: str = "", user: _ng_Optional[dict] = None) -> _ng_Optional[str]:
    """Route valida normalizzata oppure None (schermata inesistente / non mappabile)."""
    if _ng_re.match(r"^(tel|sms|mailto):", (route or "").strip(), _ng_re.I):  # V50.z502 — «chiama Rossi»: link telefono passano intatti
        return route.strip()
    path, q = _nav_split(route)
    if "{id}" in path or "<id>" in path or ":id" in path:  # placeholder non risolto → lista
        base = path.split("/{")[0].split("/<")[0].split("/:")[0]
        return {"/contact": "/contatti", "/appointment": "/calendario", "/callback": "/home?section=ritelefonate", "/chat": "/chat", "/courses": "/courses", "/crt": "/crt", "/groups": "/groups"}.get(base, "/contatti")
    if path in _NAV_ALIASES and not _nav_path_exists(path):
        path, q2 = _nav_split(_NAV_ALIASES[path])
        q = q or q2
    if not _nav_path_exists(path):
        alt = _nav_slug_match(path)
        if alt:
            path, q2 = _nav_split(alt)
            q = q or q2
    if not _nav_path_exists(path):
        by_label = _nav_route_by_label(label, user) if label else None
        if by_label:
            return by_label
        return None
    if path == "/permessi" and not q:
        q = "standalone=1"  # aperta da Axon/Impostazioni: «Continua» torna indietro invece di rilanciare il wizard
    if path == "/impostazioni":
        fq = _nav_fix_settings_query(q)
        if fq is None:
            by_label = _nav_route_by_label(label, user) if label else None
            return by_label or "/impostazioni"
        if fq.startswith("@"):
            return fq[1:]
        return "/impostazioni" + (f"?{fq}" if fq else "")
    return path + (f"?{q}" if q else "")


def _nav_text_fallback(label: str, user: _ng_Optional[dict] = None) -> str:
    """Istruzioni testuali quando non esiste una schermata raggiungibile con un link."""
    lab = (label or "").strip().strip("«»\"'").strip() or "questa funzione"
    lab = _ng_re.sub(r"^(apri|vai a|vai su|vai in|mostra|portami a|portami in|apri la|apri il)\s+", "", lab, flags=_ng_re.I)
    try:
        hits = _nav_match(lab, user or {}, limit=1)  # noqa: F821
    except Exception:
        hits = []
    if hits:
        h = hits[0]
        grp = _NAV_GROUP_PATH.get(h.get("group") or "", "menu principale")
        return f"ℹ️ Per «{lab}»: {grp} → cerca la voce «{h['name']}»."
    return f"ℹ️ «{lab}»: non c'è una schermata dedicata in AdvisorOS. Dimmi cosa vuoi fare e ti guido passo passo."


_RX_ONE_NAV = _ng_re.compile(r"\[\[NAV:([^|\]]+)\|([^\]]+)\]\]")


def _nav_sanitize_markers(text: str, user: _ng_Optional[dict] = None) -> str:
    """Ogni marker NAV punta a una schermata reale, altrimenti diventa istruzione testuale. Idempotente."""
    if not text or "[[NAV:" not in text:
        return text
    seen = set()

    def _fix(m):
        route, label = m.group(1).strip(), m.group(2).strip()
        ok = _nav_resolve_route(route, label, user)
        if not ok:
            logger.info("[NAV-GUARD] route inesistente «%s» (%s) → istruzioni testuali", route, label)  # noqa: F821
            return _nav_text_fallback(label, user)
        if ok in seen:
            return ""
        seen.add(ok)
        if ok != route:
            logger.info("[NAV-GUARD] route corretta «%s» → «%s» (%s)", route, ok, label)  # noqa: F821
        return f"[[NAV:{ok}|{label}]]"

    out = _RX_ONE_NAV.sub(_fix, text)
    return _ng_re.sub(r"\n{3,}", "\n\n", out)


class NavStreamFilter:
    """Filtro per lo stream SSE: trattiene il testo da «[[» finché il marker non è chiuso, poi lo emette sanificato."""

    def __init__(self, user: _ng_Optional[dict] = None):
        self.user = user
        self.buf = ""

    def feed(self, chunk: str) -> str:
        if not chunk:
            return ""
        self.buf += chunk
        out = []
        while self.buf:
            i = self.buf.find("[[")
            if i == -1:
                # tieni un eventuale «[» finale (potrebbe essere l'inizio di «[[»)
                if self.buf.endswith("["):
                    out.append(self.buf[:-1]); self.buf = "["
                else:
                    out.append(self.buf); self.buf = ""
                break
            out.append(self.buf[:i])
            rest = self.buf[i:]
            j = rest.find("]]")
            if j == -1:
                if len(rest) > 600:  # marker mai chiuso: non è un marker
                    out.append(rest); self.buf = ""
                else:
                    self.buf = rest
                break
            marker = rest[: j + 2]
            out.append(_nav_sanitize_markers(marker, self.user) if marker.startswith("[[NAV:") else marker)
            self.buf = rest[j + 2:]
        return "".join(out)

    def flush(self) -> str:
        b, self.buf = self.buf, ""
        return _nav_sanitize_markers(b, self.user) if b else ""


# ---------------------------------------------------------------------------
# 2) APP_MAP: schermate che mancavano (Axon inventava la route)
# ---------------------------------------------------------------------------
_NAV_EXTRA_ENTRIES = [
    dict(id="permessi_dispositivo", name="Permessi del dispositivo (GPS, microfono, fotocamera, rubrica)", route="/permessi?standalone=1", group="Profilo",
         desc="Stato dei 4 permessi di sistema con «Consenti» / «Impostazioni» per ciascuno (anche da Impostazioni → Generale → «Permessi del dispositivo»).",
         kw=["permessi", "permesso", "autorizzazioni", "permessi dispositivo", "permessi app", "permesso gps", "permesso posizione", "permesso microfono", "permesso fotocamera", "permesso rubrica", "attivare gps", "abilitare microfono", "consenti posizione", "impostazioni permessi", "permessi di sistema"]),
    dict(id="setup_wizard", name="Set Up and Go · configurazione guidata", route="/setup", group="Profilo",
         desc="Wizard iniziale in 3-4 passi: Chi sei (anagrafica, anche da scansione documento), Sfera e tono, Aree, Parla a Neo. Da Impostazioni → Abbonamento → card «Set Up and Go» si rivede la configurazione (/setup-config).",
         kw=["set up and go", "setup and go", "full and go", "configurazione guidata", "configurazione iniziale", "wizard iniziale", "rifare la configurazione", "chi sei", "sfera e tono", "parla a neo", "primo avvio", "setup"]),
    dict(id="setup_config", name="La mia configurazione Set Up", route="/setup-config", group="Profilo", desc="Riepilogo modificabile di quanto scelto nel wizard Set Up and Go.", kw=["mia configurazione", "configurazione set up", "modificare configurazione", "riepilogo configurazione"]),
    dict(id="privacy_policy", name="Privacy policy (informativa GDPR)", route="/privacy-policy", group="Help", desc="Informativa privacy interna: titolare, dati trattati, finalità, diritti.", kw=["privacy", "privacy policy", "informativa privacy", "gdpr", "trattamento dati", "i miei diritti"]),
    dict(id="pun_storico", name="Storico PUN", route="/pun-storico", group="Home", desc="Tabella PUN ultimi 18 mesi (monorario e fasce F1/F2/F3) con export PDF.", kw=["storico pun", "pun storico", "pun mensile", "andamento pun", "pun ultimi mesi", "tabella pun"]),
    dict(id="beta_diary", name="Diario del venerdì (Programma Beta)", route="/beta-diary", group="Help", desc="3 domande a settimana per i consulenti del Programma Beta.", kw=["diario del venerdi", "diario beta", "programma beta", "missioni beta", "beta tester"]),
    dict(id="beta_nps", name="Sondaggio NPS", route="/beta-nps", group="Help", desc="Sondaggio «lo consiglieresti?» 0-10 con commenti.", kw=["nps", "sondaggio", "lo consiglieresti", "valuta l app", "feedback app"]),
    dict(id="axon_media", name="Archivio foto / audio / video", route="/axon-media", group="AxonOS", desc="Archivio intelligente di foto, note vocali e video catturati con Axon.", kw=["archivio foto", "archivio media", "foto salvate", "video salvati", "note vocali salvate", "galleria axon"]),
    dict(id="voice_profiles", name="Voci autorizzate (impronta vocale)", route="/voice-profiles", group="AxonOS", desc="Impronta vocale del proprietario e voci secondarie autorizzate a comandare Axon.", kw=["impronta vocale", "voci autorizzate", "riconoscimento voce", "voce del proprietario", "registra la mia voce", "voice id"]),
    dict(id="axon_proactive", name="Proattività AxonOS", route="/axon-proactive", group="AxonOS", desc="Suggerimenti e azioni proattive di Axon (cosa ha notato, cosa propone).", kw=["proattivita", "proattivo", "suggerimenti di axon", "cosa hai notato", "axon proattivo"]),
    dict(id="axon_system", name="Stato sistema", route="/axon-system", group="AxonOS", desc="Versione backend, changelog, stato servizi visti da AxonOS.", kw=["stato sistema", "versione app", "changelog", "che versione", "aggiornamenti app", "stato servizi"]),
    dict(id="axon_scripts", name="Script di chiamata (Playbook)", route="/axon-scripts", group="Master", desc="Banca degli script telefonici e playbook per i collaboratori.", kw=["script", "script di chiamata", "script telefonico", "playbook", "cosa dire al telefono", "copione"], master_only=True),
    dict(id="reviews_analytics", name="Recensioni · analytics", route="/reviews-analytics", group="Master", desc="Media stelle, trend, top clienti, tasso di risposta alle recensioni.", kw=["recensioni", "analytics recensioni", "stelle", "media recensioni", "feedback clienti"]),
    dict(id="info_requests", name="Richieste informazioni (lead dal web)", route="/info-requests", group="Contatti", desc="Richieste arrivate dalla landing / biglietto digitale, con chat.", kw=["richieste informazioni", "richieste dal sito", "lead dal web", "richieste web", "chi mi ha scritto dal sito"]),
    dict(id="event_banners", name="Eventi e banner", route="/event-banners", group="Master", desc="Banner di eventi e comunicazioni in Home per il team.", kw=["eventi", "banner eventi", "evento aziendale", "comunicazione evento"], master_only=True),
    dict(id="invitati", name="Invitati (referral)", route="/invitati", group="Profilo", desc="Chi hai invitato con il tuo codice amico e lo stato degli inviti.", kw=["invitati", "chi ho invitato", "miei inviti", "stato inviti", "amici invitati"]),
    dict(id="my_web", name="Il mio sito / pagina web", route="/my-web", group="Profilo", desc="La tua pagina pubblica collegata al biglietto digitale.", kw=["mio sito", "pagina web", "la mia pagina", "sito personale", "landing personale"]),
    dict(id="business_card_stats", name="Statistiche biglietto digitale", route="/business-card-stats", group="Contatti", desc="Visite e contatti generati dal link pubblico del biglietto da visita.", kw=["statistiche biglietto", "quante visite biglietto", "biglietto visite", "chi ha aperto il biglietto"]),
    dict(id="help_center", name="Help Center · ticket", route="/help-center", group="Help", desc="Apri un ticket: problema, idea, richiesta privacy / cancellazione dati.", kw=["help center", "ticket", "aprire un ticket", "segnalazione", "centro assistenza"]),
    dict(id="scanner_docs", name="Scansione documento (compila i campi)", route="/scanner", group="Fatture e Scanner", desc="Dentro «Nuovo contatto», «Set Up and Go › Chi sei» e Anagrafica: pulsante «Scansiona documento» (carta d'identità, passaporto, patente, biglietto da visita) che compila i campi in automatico.", kw=["scansiona documento", "scansione documento", "fotografa il documento", "compila dai documenti", "leggi la carta d identita", "carta d identita del cliente", "passaporto del cliente", "documento del cliente"]),
]
try:
    _ng_existing = {e["id"] for e in APP_MAP}  # noqa: F821
    for _e in _NAV_EXTRA_ENTRIES:
        if _e["id"] not in _ng_existing:
            APP_MAP.append(_e)  # noqa: F821
            _NAV_BY_ID[_e["id"]] = _e  # noqa: F821
    # «impostazioni» → non deve più catturare «permessi»; «gps_visite» non deve rispondere a «permesso gps»
    for _e in APP_MAP:  # noqa: F821
        if _e["id"] == "gps_visite":
            _e["kw"] = [k for k in _e["kw"] if k not in ("gps", "geolocalizzazione")]
    _NAV_VOCAB_CACHE["set"] = None  # noqa: F821 — ricalcola il vocabolario keyword
except Exception as _e:  # noqa: BLE001
    logger.warning("[NAV-GUARD] APP_MAP extend failed: %s", _e)  # noqa: F821


# ---------------------------------------------------------------------------
# 3) Prompt: SOLO route dell'elenco; schermata assente → a parole
# ---------------------------------------------------------------------------
_ng_prev_prompt_section = _nav_prompt_section  # noqa: F821

_NG_OLD_RULE = "MAI descrivere il percorso a parole («vai in Impostazioni → Generale»). "
_NG_NEW_RULE = ("ROUTE: usa ESCLUSIVAMENTE le route dell'ELENCO SCHERMATE qui sotto, copiate carattere per carattere (query comprese: "
                "/impostazioni accetta solo section=general|security|billing|branding|integrations|axon). MAI inventare, tradurre o comporre route "
                "(niente /settings, /permissions, /impostazioni/permessi, /configurazione-guidata…): un link sbagliato è peggio di nessun link. "
                "Se la schermata che serve NON è nell'elenco → NESSUN marker: spiega il percorso a parole, passo per passo (tab in basso → voce → card). "
                "Quando la route esiste, non descrivere il percorso a parole: metti il marker. "
                "PERMESSI / AUTORIZZAZIONI dell'app (GPS, posizione, microfono, fotocamera, rubrica) → SEMPRE [[NAV:/permessi?standalone=1|Permessi del dispositivo]] "
                "(NON la sezione Generale e NON /impostazioni?section=permessi, che non esiste). Configurazione guidata / Set Up and Go → [[NAV:/setup|Set Up and Go]]. ")


def _nav_prompt_section(user: dict, msg: str) -> str:  # noqa: F811
    s = _ng_prev_prompt_section(user, msg)
    return s.replace(_NG_OLD_RULE, _NG_NEW_RULE) if _NG_OLD_RULE in s else s + "\n" + _NG_NEW_RULE


# ---------------------------------------------------------------------------
# 4) GPS reale dal telefono (client_context.position) → prompt + clienti più vicini
# ---------------------------------------------------------------------------
_RX_NEAR = _ng_re.compile(r"\b(vicin\w*|qui (intorno|attorno|vicino)|intorno a me|attorno a me|nei dintorni|nelle vicinanze|zona|da qui|dove (sono|mi trovo)|più vicin\w*|piu vicin\w*|distanz\w*|quanto dist\w*|a che distanza|chi (c è|c'è|ho) (qui|vicino)|clienti (in|nella) zona|raggio)\b", _ng_re.I)


async def _nav_nearby_clients(user: dict, lat: float, lon: float, limit: int = 8) -> list:
    """Clienti con indirizzo geocodificato (cache 30 gg) ordinati per distanza dalla posizione reale."""
    try:
        q = await _omni_contact_query(user)  # noqa: F821
    except Exception:
        return []
    rows = []
    async for c in db.contacts.find(q, {"_id": 0, "contact_id": 1, "first_name": 1, "last_name": 1, "company": 1, "address": 1, "address_street": 1, "address_zip": 1, "address_city": 1, "address_province": 1, "preferred_address": 1, "work_address": 1, "residence_address": 1, "phone": 1, "geo": 1}).limit(400):  # noqa: F821
        rows.append(c)
    if not rows:
        return []

    async def _coords(c):
        g = c.get("geo") if isinstance(c.get("geo"), dict) else None
        if g and g.get("lat") is not None and g.get("lon") is not None:
            return {"lat": float(g["lat"]), "lon": float(g["lon"])}
        addr = _best_addr_for_contact(c)  # noqa: F821
        if not addr:
            return None
        try:
            return await _ng_asyncio.wait_for(_geocode_one(addr), timeout=2.5)  # noqa: F821
        except Exception:
            return None

    sem = _ng_asyncio.Semaphore(6)

    async def _one(c):
        async with sem:
            return c, await _coords(c)

    try:
        pairs = await _ng_asyncio.wait_for(_ng_asyncio.gather(*[_one(c) for c in rows]), timeout=7.0)
    except Exception:
        return []
    out = []
    for c, co in pairs:
        if not co:
            continue
        km = _haversine_km(lat, lon, co["lat"], co["lon"])  # noqa: F821
        out.append((km, c))
    out.sort(key=lambda x: x[0])
    return [{"contact_id": c["contact_id"], "name": _nav_cname(c), "city": c.get("address_city") or "", "km": round(km, 1), "phone": c.get("phone") or ""} for km, c in out[:limit]]  # noqa: F821


async def _nav_gps_section(user: dict, ctx, msg: str) -> str:
    if not isinstance(ctx, dict):
        return ""
    pos = ctx.get("position")
    if not isinstance(pos, dict):
        return ""
    try:
        lat, lon = float(pos.get("lat")), float(pos.get("lon"))
    except Exception:
        return ""
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return ""
    acc = pos.get("accuracy_m")
    age = pos.get("age_s")
    src = "rilevata ora dal GPS del telefono" if (age is None or float(age) < 120) else f"ultima nota, {int(float(age) // 60)} min fa"
    txt = (f"\n\n📡 POSIZIONE GPS REALE DELL'UTENTE ({src}): lat {lat:.5f}, lon {lon:.5f}"
           + (f", precisione ±{int(float(acc))} m" if acc not in (None, "") else "") + ". "
           "Usa QUESTE coordinate per «dove sono», «clienti vicini», «percorso da qui», meteo locale: la posizione è disponibile, non dire mai che non puoi conoscerla. "
           "Per aprire il navigatore verso un cliente usa il marker [[NAV:/optimal-route?contacts=<contact_id>|🚗 Naviga verso <nome>]].")
    if _RX_NEAR.search(msg or ""):
        try:
            near = await _nav_nearby_clients(user, lat, lon)
        except Exception as e:  # noqa: BLE001
            logger.warning("[NAV-GUARD] nearby failed: %s", e)  # noqa: F821
            near = []
        if near:
            txt += "\nCLIENTI PIÙ VICINI (distanza in linea d'aria dalla posizione reale): " + "; ".join(
                f"{n['name']}" + (f" ({n['city']})" if n["city"] else "") + f" · {n['km']} km · contact_id {n['contact_id']}" + (f" · tel {n['phone']}" if n["phone"] else "") for n in near) + "."
        else:
            txt += "\nNessun cliente con indirizzo geocodificato nel raggio noto: proponi di completare gli indirizzi in anagrafica."
    return txt


_ng_prev_prepare = _prepare_assistant_prompt  # noqa: F821


async def _prepare_assistant_prompt(user: dict, body) -> dict:  # noqa: F811
    prep = await _ng_prev_prepare(user, body)
    try:
        if isinstance(prep, dict) and isinstance(prep.get("system_message"), str):
            msg = getattr(body, "message", None) or (body.get("message") if isinstance(body, dict) else "") or ""
            ctx = getattr(body, "client_context", None) or (body.get("client_context") if isinstance(body, dict) else None) or (user.get("_client_ctx") if isinstance(user, dict) else None)
            gps = await _nav_gps_section(user, ctx, msg)
            if gps:
                prep["system_message"] += gps
                logger.info("[NAV-GUARD] GPS reale nel prompt (%s) · near=%s", str(ctx.get("position"))[:60], bool(_RX_NEAR.search(msg or "")))  # noqa: F821
    except Exception as e:  # noqa: BLE001
        logger.warning("[NAV-GUARD] gps section failed: %s", e)  # noqa: F821
    return prep


# ---------------------------------------------------------------------------
# 5) Endpoint non-stream: sanifica la risposta; endpoint di servizio per test/diagnostica
# ---------------------------------------------------------------------------
_ng_orig_chat = None
for _r in list(api_router.routes):  # noqa: F821
    if getattr(_r, "path", "").endswith("/assistant/chat") and "POST" in (getattr(_r, "methods", None) or set()):
        _ng_orig_chat = _r.endpoint
        api_router.routes.remove(_r)  # noqa: F821
        break

if _ng_orig_chat is not None:
    @api_router.post("/assistant/chat")  # noqa: F821
    async def assistant_chat(body: AssistantChatIn, user=Depends(get_current_user)):  # noqa: F811, F821
        out = await _ng_orig_chat(body, user)
        if isinstance(out, dict) and out.get("reply"):
            out["reply"] = _nav_sanitize_markers(out["reply"], user)
        return out


class _NavSanitizeIn(BaseModel):  # noqa: F821
    text: str


@api_router.post("/axon/nav/sanitize")  # noqa: F821
async def axon_nav_sanitize(body: _NavSanitizeIn, user=Depends(get_current_user)):  # noqa: F821
    """Diagnostica: applica la stessa pulizia dei marker NAV usata su chat e stream."""
    return {"text": _nav_sanitize_markers(body.text or "", user)}


@api_router.get("/axon/nav/routes")  # noqa: F821
async def axon_nav_routes(user=Depends(get_current_user)):  # noqa: F821
    """Elenco delle route reali (per diagnostica e per il frontend)."""
    return {"paths": sorted(_NAV_REAL_PATHS), "dynamic_prefixes": list(_NAV_DYNAMIC_PREFIXES), "aliases": _NAV_ALIASES, "settings_sections": sorted(_NAV_SETTINGS_SECTIONS)}

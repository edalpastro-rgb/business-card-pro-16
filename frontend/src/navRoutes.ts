// navRoutes.ts — V50.z487 — Schermate REALI dell'app (file sotto /app) + alias: ogni deep link di Axon viene verificato qui
// prima di diventare un pulsante. Route inesistente → nessun pulsante rotto (il backend ha già convertito il marker in
// istruzioni testuali; questo è il paracadute lato client, anche per messaggi vecchi in cache).
// NB: tenere allineato con backend/routes/axon_nav_guard.py (_NAV_REAL_PATHS) quando si aggiunge una schermata.
export const KNOWN_ROUTES: ReadonlySet<string> = new Set([
  "/", "/home", "/calendario", "/chat", "/contatti", "/help", "/impostazioni", "/report", "/webviewer",
  "/admin/beta", "/admin/customers", "/admin/onboarding", "/admin/org-plans", "/admin/promo-codes", "/admin/users", "/admin/register-guard", "/admin/upload-guard", "/admin/wake-samples", "/admin/welcome-email",
  "/ai-teach", "/anagrafica-master", "/appointment/new", "/appointment-stats", "/auth/forgot-password", "/axon-alarms", "/axon-alerts", "/axon-brain",
  "/axon-cheatsheet", "/axon-expenses", "/axon-homeassistant", "/axon-hub", "/axon-insights", "/axon-integrations", "/axon-lab", "/axon-lab/business",
  "/axon-lab/delegates", "/axon-lab/rules", "/axon-lab/training", "/axon-media", "/axon-memory", "/axon-notifications", "/axon-proactive",
  "/axon-scripts-import", "/axon-scripts", "/axon-stress-report", "/axon-system", "/axon-voice", "/beta-diary", "/beta-nps", "/bill-quick", "/bug-report",
  "/business-card-stats", "/business-card", "/call", "/call-script-config", "/callback/new", "/chat/new", "/contact/new", "/contact/import-folder", "/contacts-import",
  "/contract/new", "/corporate/new", "/corporate-gym", "/corporate-gym/areas-edit", "/corporate-gym/assign", "/corporate-gym/coach-panel", "/corporate-gym/live",
  "/corporate-gym/manuals-config", "/corporate-gym/obiezioni", "/corporate-gym/ratings", "/corporate-gym/roleplay", "/corporate-gym/stats", "/corporate-gym/win-win",
  "/courses", "/courses/dashboard", "/courses/new", "/crt", "/cruscotto", "/custom-fields", "/dashboard-config", "/deadlines", "/devices", "/documenti-axon",
  "/dropbox", "/email-accounts", "/email-config", "/event-banners", "/faq", "/form-templates", "/google-drive-picker", "/google-drive", "/groups",
  "/help-center-admin", "/help-center", "/info-request-chat", "/info-requests", "/invita-amico", "/invita-pick", "/invita", "/invitati", "/invite-collaborator",
  "/km-report", "/admin/landing-cms", "/landing", "/landing/axonos", "/landing/advisoros", "/le-mie-aree", "/libretto-editor", "/libretto", "/manuale", "/lite", "/login", "/mail-crm-proposals", "/map-clients", "/master-files", "/master",
  "/mercato", "/meteo", "/my-audios", "/my-thing", "/my-web", "/neo-memory", "/offline-sync", "/optimal-route", "/outlook", "/paywall", "/pdf-viewer",
  "/permessi-onboarding", "/permessi", "/personalizzazione-aziendale", "/privacy-policy", "/pun-storico", "/quick-actions", "/reviews-analytics", "/scanner",
  "/security-info", "/security", "/settings-app", "/setup-config", "/setup", "/smtp", "/spazio-personale-anagrafica", "/spazio-personale", "/team-compare",
  "/team-insights", "/team", "/tour-features", "/tour", "/viola-wake", "/voice-copilot", "/voice-enroll", "/voice-profiles", "/wake-training",
  "/wake-word-training", "/wake-word",
]);

const DYNAMIC_PREFIXES = ["/appointment/", "/audio-transcript/", "/axon-lab/module/", "/axon-lab/practice/", "/callback/", "/chat/", "/contact/edit/", "/contact/",
  "/corporate-gym/area/", "/courses/", "/crt/", "/event/", "/filled-form/", "/form-template/", "/groups/", "/invite/", "/public-lead/", "/public-review/", "/public-reviews/"];

const SETTINGS_SECTIONS = new Set(["general", "security", "billing", "branding", "integrations", "axon", "assistente", "assistant"]);

const ALIASES: Record<string, string> = {
  "/settings": "/impostazioni", "/profilo": "/impostazioni?section=general", "/profile": "/impostazioni?section=general", "/sicurezza": "/impostazioni?section=security",
  "/abbonamento": "/impostazioni?section=billing", "/integrazioni": "/axon-integrations", "/axon-settings": "/impostazioni?section=axon",
  "/permissions": "/permessi?standalone=1", "/impostazioni/permessi": "/permessi?standalone=1", "/autorizzazioni": "/permessi?standalone=1",
  "/setup-wizard": "/setup", "/wizard": "/setup", "/configurazione-guidata": "/setup", "/configurazione": "/setup", "/onboarding": "/setup",
  "/notifiche": "/axon-notifications?tab=prefs", "/notifications": "/axon-notifications?tab=prefs",
  "/agenda": "/calendario", "/calendar": "/calendario", "/appuntamenti": "/calendario", "/contacts": "/contatti", "/clienti": "/contatti", "/rubrica": "/contatti",
  "/mappa": "/map-clients", "/map": "/map-clients", "/scan": "/scanner", "/fatture": "/bill-quick", "/bollette": "/bill-quick", "/aiuto": "/help", "/supporto": "/help",
  "/guida": "/libretto", "/import": "/contacts-import", "/giro": "/optimal-route", "/axon-drive": "/voice-copilot", "/km": "/km-report",
  "/spese": "/axon-expenses", "/memoria": "/axon-memory", "/insegna": "/ai-teach", "/allarmi": "/axon-alarms", "/avvisi": "/axon-alerts", "/mail": "/email-accounts",
  "/email": "/email-accounts", "/collaboratori": "/team", "/corsi": "/courses", "/contratti": "/crt", "/pun": "/pun-storico", "/privacy": "/privacy-policy",
  "/dispositivi": "/devices", "/offline": "/offline-sync", "/aree": "/le-mie-aree", "/statistiche": "/home?section=statistiche", "/scadenze": "/deadlines",
  "/ritelefonate": "/home?section=ritelefonate", "/biglietto": "/business-card", "/telefonate": "/call", "/chiamate": "/call",
};

function split(route: string): [string, string] {
  const r = (route || "").trim().split("#")[0];
  const i = r.indexOf("?");
  const path = ("/" + (i >= 0 ? r.slice(0, i) : r).trim().replace(/^\/+/, "")).replace(/\/+$/, "") || "/";
  return [path.toLowerCase(), i >= 0 ? r.slice(i + 1) : ""];
}

export function routeExists(path: string): boolean {
  if (KNOWN_ROUTES.has(path)) return true;
  return DYNAMIC_PREFIXES.some((p) => path.startsWith(p) && path.length > p.length && !path.slice(p.length).includes("/"));
}

/** Route valida (normalizzata) oppure null se la schermata non esiste. */
export function resolveNavRoute(route: string): string | null {
  let [path, q] = split(route);
  if (/\{id\}|<id>|:id/.test(path)) return path.startsWith("/appointment") ? "/calendario" : "/contatti";
  if (!routeExists(path) && ALIASES[path]) { const [p2, q2] = split(ALIASES[path]); path = p2; q = q || q2; }
  if (!routeExists(path)) {
    const last = "/" + path.split("/").pop();
    if (last !== path && routeExists(last)) path = last;
    else if (last !== path && ALIASES[last]) { const [p2, q2] = split(ALIASES[last]); path = p2; q = q || q2; }
  }
  if (!routeExists(path)) return null;
  if (path === "/impostazioni" && q) {
    const m = /(?:^|&)section=([^&]*)/.exec(q);
    if (m) {
      const sec = decodeURIComponent(m[1] || "").toLowerCase();
      if (!sec) return "/impostazioni";
      if (!SETTINGS_SECTIONS.has(sec)) {
        if (/perm|autorizz/.test(sec)) return "/permessi?standalone=1";
        if (/notif/.test(sec)) return "/axon-notifications?tab=prefs";
        return "/impostazioni";
      }
      q = `section=${sec === "assistente" || sec === "assistant" ? "axon" : sec}`;
    }
  }
  if (path === "/permessi" && !q) q = "standalone=1";
  return path + (q ? `?${q}` : "");
}

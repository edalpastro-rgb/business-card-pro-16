// V50.z34 — Palette semantica AdvisorOS Pro (Proposta A confermata dall'utente).
// Ogni schermata/azione appartiene a UNA sola categoria. Le UI (Master menu,
// Home quick actions, Axon Hub, drawer futuro) leggono da qui in modo che il
// codice colore sia coerente ovunque. Modifica UNA sola volta qui per
// aggiornare l'intera app.

export type MenuCategoryKey =
  | "crm"          // CRM Core
  | "axon"         // AI & Axon
  | "comm"         // Comunicazioni
  | "docs"         // Documenti & Cloud
  | "team"         // Team & Insights
  | "admin";       // Amministrazione

export type MenuCategory = {
  key: MenuCategoryKey;
  label: string;
  color: string;   // main color (icon fg on light bg / bg on dark)
  soft: string;    // 22 alpha version for pill backgrounds
  icon: string;    // Ionicons name for category header
  order: number;   // sort in drawer/lists
};

export const MENU_CATEGORIES: Record<MenuCategoryKey, MenuCategory> = {
  crm:   { key: "crm",   label: "CRM Core",          color: "#0EA5E9", soft: "#0EA5E922", icon: "briefcase",     order: 1 },
  axon:  { key: "axon",  label: "AI & Axon",         color: "#7C3AED", soft: "#7C3AED22", icon: "sparkles",       order: 2 },
  comm:  { key: "comm",  label: "Comunicazioni",     color: "#F97316", soft: "#F9731622", icon: "mail",           order: 3 },
  docs:  { key: "docs",  label: "Documenti & Cloud", color: "#10B981", soft: "#10B98122", icon: "cloud",          order: 4 },
  team:  { key: "team",  label: "Team & Insights",   color: "#EAB308", soft: "#EAB30822", icon: "people",         order: 5 },
  admin: { key: "admin", label: "Amministrazione",   color: "#475569", soft: "#47556922", icon: "settings",       order: 6 },
};

// Mappa route → categoria. Usato dal Master menu, drawer e Axon Hub.
export const ROUTE_CATEGORY: Record<string, MenuCategoryKey> = {
  // CRM Core
  "/contact/new":         "crm",
  "/contact/[id]":        "crm",
  "/contacts":            "crm",
  "/appointment/new":     "crm",
  "/calendario":          "crm",
  "/deadlines":           "crm",
  "/cruscotto":           "crm",
  "/notes":               "crm",
  "/corporate/new":       "crm",
  "/invitati":            "crm",

  // AI & Axon
  "/axon-hub":            "axon",
  "/axon-alarms":         "axon",
  "/axon-alerts":         "axon",
  "/axon-homeassistant":  "axon",
  "/ai-teach":            "axon",
  "/voice-copilot":       "axon",
  "/help-center":         "axon",

  // Comunicazioni
  "/email-accounts":      "comm",
  "/mail-crm-proposals":  "comm",
  "/outlook":             "comm",
  "/(tabs)/chat":         "comm",

  // Documenti & Cloud
  "/master-files":        "docs",
  "/google-drive":        "docs",
  "/business-cards":      "docs",

  // Team & Insights
  "/team-insights":       "team",
  "/invite-collaborator": "team",
  "/report":              "team",

  // Amministrazione
  "/settings-app":        "admin",
  "/impostazioni":        "admin",
  "/(tabs)/impostazioni": "admin",
  "/bug-report":          "admin",
  "/help-center-admin":   "admin",
};

export function categoryForRoute(route: string): MenuCategory {
  const k = ROUTE_CATEGORY[route] || "admin";
  return MENU_CATEGORIES[k];
}

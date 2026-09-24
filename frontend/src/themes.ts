// V50.z338/z339 — Sistema temi AdvisorOS (Luce · Pearl · Slate · Midnight).
//
// Perché la lettura è SINCRONA: gli StyleSheet delle schermate sono creati al caricamento dei moduli, quindi la
// palette attiva deve essere nota PRIMA di qualsiasi render. Web → localStorage; nativo → SecureStore.getItem (sync).
// Il cambio tema salva la preferenza (locale per-utente + backend settings.ui_theme) e ricarica l'app: RoutePersistence
// (V50.z242) riporta l'utente sulla stessa schermata. Equivalente RN delle «CSS variables»: ogni schermata legge
// HT / CT / theme che derivano da ACTIVE_THEME.

import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

export type ThemeId = "light" | "pearl" | "slate" | "midnight";
export const DEFAULT_THEME: ThemeId = "slate";
export const THEME_IDS: ThemeId[] = ["light", "pearl", "slate", "midnight"];

export type Palette = {
  id: ThemeId;
  name: string;
  bg: string;        // sfondo pagina
  bgGradient?: [string, string]; // sfumatura leggerissima (Pearl)
  card: string;      // superfici card
  card2: string;     // superfici secondarie (input, righe)
  border: string;
  borderStrong: string;
  text: string;
  text2: string;     // testo secondario (leggibile)
  muted: string;     // testo terziario / icone spente
  accent: string;    // colore azione primaria
  accentDeep: string;
  accent2: string;   // accento informativo (Axon / dati)
  nav: string;       // bottom nav
  navActive: string;
  navInactive: string;
  radius: number;    // raggio card
  glass: string;
  glassStrong: string;
  shadow: boolean;   // card con ombra morbida invece del bordo netto (Pearl)
  isDark: boolean;
  statusBar: "light" | "dark";
};

export const PALETTES: Record<ThemeId, Palette> = {
  light: {
    id: "light", name: "Luce",
    bg: "#ffffff", card: "#f5f7fa", card2: "#eceff5", border: "#e8eaf0", borderStrong: "#d3d7e2",
    text: "#1a1a2e", text2: "#4b5068", muted: "#6b7280",
    accent: "#5e6ad2", accentDeep: "#4b56b8", accent2: "#0ea5e9",
    nav: "#ffffff", navActive: "#5e6ad2", navInactive: "#9aa0b4",
    radius: 14, glass: "rgba(26,26,46,0.05)", glassStrong: "rgba(26,26,46,0.09)", shadow: false, isDark: false, statusBar: "dark",
  },
  pearl: {
    id: "pearl", name: "Pearl",
    bg: "#f0f2f8", bgGradient: ["#f4f6fb", "#eceef6"], card: "#ffffff", card2: "#f6f7fb", border: "rgba(26,26,46,0.06)", borderStrong: "rgba(26,26,46,0.14)",
    text: "#1a1a2e", text2: "#5b6382", muted: "#8890a8",
    accent: "#6b7fc7", accentDeep: "#5a6db3", accent2: "#5aa9c9",
    nav: "#ffffff", navActive: "#6b7fc7", navInactive: "#a0a6bc",
    radius: 16, glass: "rgba(26,26,46,0.04)", glassStrong: "rgba(26,26,46,0.08)", shadow: true, isDark: false, statusBar: "dark",
  },
  slate: {
    id: "slate", name: "Slate",
    bg: "#2d3250", card: "#363d5c", card2: "#3e4668", border: "#424a6a", borderStrong: "#535c80",
    text: "#ffffff", text2: "#c5cbe3", muted: "#a0a8c8",
    accent: "#6b8cff", accentDeep: "#5273e6", accent2: "#7dd3fc",
    nav: "#252a45", navActive: "#6b8cff", navInactive: "#8b93b8",
    radius: 16, glass: "rgba(255,255,255,0.06)", glassStrong: "rgba(255,255,255,0.11)", shadow: false, isDark: true, statusBar: "light",
  },
  midnight: {
    id: "midnight", name: "Midnight",
    bg: "#0d0d14", card: "#13131e", card2: "#1a1a28", border: "#1e1e2e", borderStrong: "#2c2c40",
    text: "#f0f0f8", text2: "#a8a8c4", muted: "#6b6b8a",
    accent: "#4d8ef7", accentDeep: "#3a78de", accent2: "#38bdf8",
    nav: "#0d0d14", navActive: "#4d8ef7", navInactive: "#6b6b8a",
    radius: 14, glass: "rgba(255,255,255,0.05)", glassStrong: "rgba(255,255,255,0.10)", shadow: false, isDark: true, statusBar: "light",
  },
};

const LAST_KEY = "axon_theme_last";
const userKey = (userId: string) => `axon_theme_${userId}`;

function readSync(key: string): string | null {
  try {
    if (Platform.OS === "web") return typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    return SecureStore.getItem(key);
  } catch { return null; }
}
async function write(key: string, value: string): Promise<void> {
  try {
    if (Platform.OS === "web") { localStorage.setItem(key, value); return; }
    await SecureStore.setItemAsync(key, value);
  } catch { /* ignore */ }
}

export function isThemeId(v: unknown): v is ThemeId {
  return v === "light" || v === "pearl" || v === "slate" || v === "midnight";
}
/** Normalizza id legacy (V50.z338 3 temi: grey → slate, dark → midnight). */
export function normalizeThemeId(v: unknown): ThemeId | null {
  if (v === "grey") return "slate";
  if (v === "dark") return "midnight";
  return isThemeId(v) ? v : null;
}

function resolveInitial(): ThemeId {
  return normalizeThemeId(readSync(LAST_KEY)) || DEFAULT_THEME;
}

/** Tema attivo per TUTTA la sessione (cambia solo con reload). */
export const ACTIVE_THEME_ID: ThemeId = resolveInitial();
export const ACTIVE: Palette = PALETTES[ACTIVE_THEME_ID];

/** Tema salvato per un utente specifico (o null). */
export function getUserTheme(userId: string): ThemeId | null {
  return normalizeThemeId(readSync(userKey(userId)));
}

/** Salva la preferenza (locale + «ultimo tema» usato al boot). */
export async function persistTheme(id: ThemeId, userId?: string | null): Promise<void> {
  await write(LAST_KEY, id);
  if (userId) await write(userKey(userId), id);
  try { const AS = (await import("@react-native-async-storage/async-storage")).default; await AS.setItem(LAST_KEY, id); } catch { /* mirror best-effort */ }
}

/** Fallback asincrono (AsyncStorage) usato al boot se la lettura sincrona di SecureStore non ha restituito nulla. */
export async function readThemeFallback(): Promise<ThemeId | null> {
  try { const AS = (await import("@react-native-async-storage/async-storage")).default; return normalizeThemeId(await AS.getItem(LAST_KEY)); } catch { return null; }
}
export const BOOT_THEME_FROM_STORAGE: boolean = normalizeThemeId(readSync(LAST_KEY)) !== null;

// V50.z350 — GUARD anti-loop (bug APK 1.0.85/86: Home → spinner all'infinito). Un riavvio AUTOMATICO all'avvio è
// consentito solo se (a) il tema appena salvato è rileggibile in modo sincrono (altrimenti al prossimo boot il
// mismatch si ripresenterebbe identico) e (b) non è già stato fatto un riavvio per lo stesso tema negli ultimi 2 minuti.
// Se il guard non è scrivibile/rileggibile → NON si riavvia: l'app resta usabile con il tema di default.
const RELOAD_GUARD_KEY = "axon_theme_reload_guard";
const RELOAD_GUARD_MS = 2 * 60 * 1000;

export async function safeThemeReload(target: ThemeId): Promise<boolean> {
  if (readSync(LAST_KEY) !== target) return false;                    // (a) storage non affidabile → niente loop
  try {
    const raw = readSync(RELOAD_GUARD_KEY);
    if (raw) {
      const g = JSON.parse(raw) as { target?: string; at?: number };
      if (g.target === target && Date.now() - (g.at || 0) < RELOAD_GUARD_MS) return false;   // (b) già riavviato
    }
  } catch { /* guard illeggibile → lo riscriviamo sotto */ }
  const stamp = JSON.stringify({ target, at: Date.now() });
  await write(RELOAD_GUARD_KEY, stamp);
  if (readSync(RELOAD_GUARD_KEY) !== stamp) return false;               // guard non persistito → niente riavvio
  return reloadApp();
}

/** Ricarica il bundle JS per applicare la nuova palette SUBITO, senza chiudere l'app (RoutePersistence riporta
 *  sulla stessa schermata). Web: location.reload(). Nativo: react-native-restart (build release/dev client) →
 *  fallback DevSettings.reload() (Expo Go). Ritorna false solo se nessun meccanismo è disponibile. */
export async function reloadApp(): Promise<boolean> {
  if (Platform.OS === "web") {
    try { (globalThis as any).location?.reload(); return true; } catch { return false; }
  }
  try {
    const mod: any = await import("react-native-restart");
    const RNRestart = mod?.default || mod;
    if (RNRestart && typeof RNRestart.restart === "function") { RNRestart.restart(); return true; }
  } catch { /* modulo nativo assente (Expo Go) → DevSettings */ }
  try {
    const { DevSettings } = await import("react-native");
    if (typeof DevSettings?.reload !== "function") return false;
    DevSettings.reload();
    return true;
  } catch { return false; }
}

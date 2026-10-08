// devicePermissions.ts — V50.z484 — PERMESSI DI SISTEMA (GPS, microfono, fotocamera, contatti) verificati DAVVERO a livello OS.
// Il «consenti» dentro l'app non basta: qui si legge lo stato reale (granted / canAskAgain) e si espone:
//   • getDevicePermissions()   → stato di tutti e 4 (cache 5 s), con refresh automatico al rientro in foreground (dopo Impostazioni)
//   • useDevicePermissions()   → hook reattivo per il banner Home e per il contesto inviato ad Axon
//   • ensureDevicePermission() → al momento dell'uso: se manca → richiesta (se possibile) altrimenti ALERT con nome e percorso + «Apri impostazioni»
//   • permissionsForAxon()     → stringa compatta «gps:ok mic:negato …» inviata in client_context ad ogni messaggio
// Web: i permessi OS non sono interrogabili in modo uniforme → tutto «n/d» (nessun banner, nessun blocco).
import { useEffect, useState } from "react";
import { Alert, AppState, Linking, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type PermKey = "location" | "microphone" | "camera" | "contacts";
export type PermStatus = "granted" | "denied" | "blocked" | "undetermined" | "unavailable";
export type PermInfo = { key: PermKey; label: string; status: PermStatus; purpose: string };

export const PERM_META: Record<PermKey, { label: string; purpose: string; icon: string; ios: string; android: string }> = {
  location: { label: "Posizione (GPS)", purpose: "clienti vicini, percorsi, meteo e rilevamento visite", icon: "location", ios: "Impostazioni → Privacy e sicurezza → Localizzazione → AdvisorOS → «Mentre usi l'app»", android: "Impostazioni → App → AdvisorOS → Autorizzazioni → Posizione → «Solo mentre usi l'app»" },
  microphone: { label: "Microfono", purpose: "dettatura, note vocali, Axon Drive e «Ehi Axon»", icon: "mic", ios: "Impostazioni → Privacy e sicurezza → Microfono → AdvisorOS", android: "Impostazioni → App → AdvisorOS → Autorizzazioni → Microfono → «Consenti»" },
  camera: { label: "Fotocamera", purpose: "foto bollette, documenti e biglietti da visita", icon: "camera", ios: "Impostazioni → Privacy e sicurezza → Fotocamera → AdvisorOS", android: "Impostazioni → App → AdvisorOS → Autorizzazioni → Fotocamera → «Consenti»" },
  contacts: { label: "Contatti (rubrica)", purpose: "importare clienti dalla rubrica e trovare numeri che il CRM non ha", icon: "people", ios: "Impostazioni → Privacy e sicurezza → Contatti → AdvisorOS", android: "Impostazioni → App → AdvisorOS → Autorizzazioni → Contatti → «Consenti»" },
};
const ORDER: PermKey[] = ["location", "microphone", "camera", "contacts"];

const toStatus = (r: { granted: boolean; canAskAgain?: boolean; status?: string } | null | undefined): PermStatus => {
  if (!r) return "unavailable";
  if (r.granted) return "granted";
  if (r.status === "undetermined" && r.canAskAgain !== false) return "undetermined";
  return r.canAskAgain === false ? "blocked" : "denied";
};

async function readOne(key: PermKey): Promise<PermStatus> {
  if (Platform.OS === "web") return "unavailable";
  try {
    if (key === "location") { const L = await import("expo-location"); return toStatus(await L.getForegroundPermissionsAsync()); }
    if (key === "camera") { const C = await import("expo-camera"); return toStatus(await C.Camera.getCameraPermissionsAsync()); }
    if (key === "microphone") { const A = await import("expo-audio"); return toStatus(await A.getRecordingPermissionsAsync()); }
    const Ct = await import("expo-contacts"); return toStatus(await Ct.getPermissionsAsync());
  } catch { return "unavailable"; }
}

async function requestOne(key: PermKey): Promise<PermStatus> {
  if (Platform.OS === "web") return "unavailable";
  try {
    if (key === "location") { const L = await import("expo-location"); return toStatus(await L.requestForegroundPermissionsAsync()); }
    if (key === "camera") { const C = await import("expo-camera"); return toStatus(await C.Camera.requestCameraPermissionsAsync()); }
    if (key === "microphone") { const A = await import("expo-audio"); return toStatus(await A.requestRecordingPermissionsAsync()); }
    const Ct = await import("expo-contacts"); return toStatus(await Ct.requestPermissionsAsync());
  } catch { return "unavailable"; }
}

// ---- cache + subscribers ----
let cache: PermInfo[] | null = null;
let cacheAt = 0;
let inflight: Promise<PermInfo[]> | null = null;
const subs = new Set<(p: PermInfo[]) => void>();
const emit = () => { if (cache) subs.forEach((f) => { try { f(cache!); } catch { /* noop */ } }); };

export async function getDevicePermissions(force = false): Promise<PermInfo[]> {
  if (!force && cache && Date.now() - cacheAt < 5000) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    const statuses = await Promise.all(ORDER.map(readOne));
    cache = ORDER.map((key, i) => ({ key, label: PERM_META[key].label, purpose: PERM_META[key].purpose, status: statuses[i] }));
    cacheAt = Date.now(); inflight = null; emit();
    return cache;
  })();
  return inflight;
}

export const missingPermissions = (list: PermInfo[]) => list.filter((p) => p.status === "denied" || p.status === "blocked" || p.status === "undetermined");

/** Stringa compatta per Axon (client_context.device_permissions): «gps:ok, microfono:negato, fotocamera:non richiesto, rubrica:bloccato». */
export function permissionsForAxon(list: PermInfo[] | null): string | undefined {
  if (!list || Platform.OS === "web") return undefined;
  const it: Record<PermStatus, string> = { granted: "ok", denied: "NEGATO", blocked: "NEGATO (bloccato: solo da Impostazioni)", undetermined: "non ancora richiesto", unavailable: "n/d" };
  const short: Record<PermKey, string> = { location: "gps", microphone: "microfono", camera: "fotocamera", contacts: "rubrica" };
  return `${Platform.OS}: ` + list.map((p) => `${short[p.key]}:${it[p.status]}`).join(", ");
}

// refresh al rientro in foreground (l'utente torna dalle Impostazioni di sistema)
if (Platform.OS !== "web") {
  AppState.addEventListener("change", (st) => { if (st === "active") void getDevicePermissions(true); });
}

export function useDevicePermissions(): { perms: PermInfo[] | null; missing: PermInfo[]; refresh: () => Promise<void> } {
  const [perms, setPerms] = useState<PermInfo[] | null>(cache);
  useEffect(() => {
    subs.add(setPerms);
    void getDevicePermissions();
    return () => { subs.delete(setPerms); };
  }, []);
  return { perms, missing: perms ? missingPermissions(perms) : [], refresh: async () => { await getDevicePermissions(true); } };
}

export function openSystemSettings() {
  Linking.openSettings().catch(() => Alert.alert("Impostazioni", "Apri le Impostazioni del telefono → App → AdvisorOS → Autorizzazioni."));
}

/** Percorso leggibile per abilitare il permesso sul sistema in uso. */
export const settingsPath = (key: PermKey) => (Platform.OS === "ios" ? PERM_META[key].ios : PERM_META[key].android);

/**
 * Da chiamare quando l'utente USA una funzione che richiede il permesso. Ritorna true se concesso.
 * Se manca: 1 richiesta di sistema (se ancora possibile); se negato/bloccato → alert con nome, percorso e «Apri impostazioni».
 */
export async function ensureDevicePermission(key: PermKey, opts?: { silent?: boolean }): Promise<boolean> {
  if (Platform.OS === "web") return true;
  let st = await readOne(key);
  if (st === "granted" || st === "unavailable") { void getDevicePermissions(true); return true; }
  if (st === "undetermined" || st === "denied") st = await requestOne(key);
  void getDevicePermissions(true);
  if (st === "granted") return true;
  if (!opts?.silent) {
    const m = PERM_META[key];
    Alert.alert(
      `Permesso «${m.label}» non attivo`,
      `Questa funzione (${m.purpose}) richiede il permesso di sistema «${m.label}», che risulta ${st === "blocked" ? "bloccato" : "negato"} dal telefono.\n\nPer attivarlo:\n${settingsPath(key)}`,
      [{ text: "Più tardi", style: "cancel" }, { text: "Apri impostazioni", onPress: openSystemSettings }],
    );
  }
  return false;
}

// ---- V50.z485 — Onboarding permessi al primo avvio (app/permessi-onboarding.tsx) ----
export const PERM_ONBOARDING_KEY = (userId: string) => `perm_onboarding_done_${userId}`;

/** true se va mostrato: nativo, non ancora fatto per questo utente e almeno un permesso non concesso. */
export async function shouldShowPermOnboarding(userId?: string | null): Promise<boolean> {
  if (Platform.OS === "web" || !userId) return false;
  if ((await AsyncStorage.getItem(PERM_ONBOARDING_KEY(userId)).catch(() => null)) === "1") return false;
  const perms = await getDevicePermissions(true).catch(() => null);
  return !!perms && perms.some((p) => p.status !== "granted" && p.status !== "unavailable");
}

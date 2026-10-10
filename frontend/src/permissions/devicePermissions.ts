// devicePermissions.ts — V50.z484 — PERMESSI DI SISTEMA (GPS, microfono, fotocamera, contatti) verificati DAVVERO a livello OS.
// Il «consenti» dentro l'app non basta: qui si legge lo stato reale (granted / canAskAgain) e si espone:
//   • getDevicePermissions()   → stato di tutti e 4 (cache 5 s), con refresh automatico al rientro in foreground (dopo Impostazioni)
//   • useDevicePermissions()   → hook reattivo per il banner Home e per il contesto inviato ad Axon
//   • ensureDevicePermission() → al momento dell'uso: se manca → richiesta (se possibile) altrimenti ALERT con nome e percorso + «Apri impostazioni»
//   • permissionsForAxon()     → stringa compatta «gps:ok mic:negato …» inviata in client_context ad ogni messaggio
// Web: i permessi OS non sono interrogabili in modo uniforme → tutto «n/d» (nessun banner, nessun blocco).
import { useEffect, useState } from "react";
import { Alert, AppState, Linking, PermissionsAndroid, Platform } from "react-native";
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

// ── V50.z516 — ANDROID: richiesta tramite PermissionsAndroid.request (dialog di sistema garantito), NON più via moduli Expo
// importati dinamicamente dentro un try/catch silenzioso (sull'APK il bottone «Consenti» girava senza aprire nulla e ogni errore
// spariva come «unavailable»). Le richieste sono SERIALIZZATE (una alla volta): due request concorrenti su Android lasciano la
// seconda promise appesa per sempre → spinner infinito.
const ANDROID_PERMS: Record<PermKey, string[]> = {
  // stringhe letterali: `PermissionsAndroid.PERMISSIONS` è undefined su web/iOS e romperebbe il modulo al caricamento
  location: ["android.permission.ACCESS_FINE_LOCATION", "android.permission.ACCESS_COARSE_LOCATION"],
  microphone: ["android.permission.RECORD_AUDIO"],
  camera: ["android.permission.CAMERA"],
  contacts: ["android.permission.READ_CONTACTS", "android.permission.WRITE_CONTACTS"],
};
let requestChain: Promise<unknown> = Promise.resolve();
const serialize = <T,>(fn: () => Promise<T>): Promise<T> => {
  const p = requestChain.then(fn, fn);
  requestChain = p.catch(() => undefined);
  return p;
};

async function androidRead(key: PermKey): Promise<PermStatus> {
  const perms = ANDROID_PERMS[key];
  const checks = await Promise.all(perms.map((p) => PermissionsAndroid.check(p as any)));
  if (checks[0]) return "granted"; // il primo è quello essenziale (FINE / RECORD_AUDIO / CAMERA / READ_CONTACTS)
  // non concesso: distinguo «mai chiesto» da «negato/bloccato» con lo stato Expo (sola lettura, nessun dialog)
  try { return await expoRead(key); } catch { return "denied"; }
}

async function androidRequest(key: PermKey): Promise<PermStatus> {
  const perms = ANDROID_PERMS[key];
  const res = await PermissionsAndroid.requestMultiple(perms as any);
  const main = (res as Record<string, string>)[perms[0]];
  const anyGranted = Object.values(res).some((v) => v === "granted");
  if (main === "granted" || (key === "location" && anyGranted)) return "granted";
  if (main === "never_ask_again") return "blocked";
  return "denied";
}

async function expoRead(key: PermKey): Promise<PermStatus> {
  if (key === "location") { const L = await import("expo-location"); return toStatus(await L.getForegroundPermissionsAsync()); }
  if (key === "camera") { const C = await import("expo-camera"); return toStatus(await C.Camera.getCameraPermissionsAsync()); }
  if (key === "microphone") { const A = await import("expo-audio"); return toStatus(await A.getRecordingPermissionsAsync()); }
  const Ct = await import("expo-contacts"); return toStatus(await Ct.getPermissionsAsync());
}

async function expoRequest(key: PermKey): Promise<PermStatus> {
  if (key === "location") { const L = await import("expo-location"); return toStatus(await L.requestForegroundPermissionsAsync()); }
  if (key === "camera") { const C = await import("expo-camera"); return toStatus(await C.Camera.requestCameraPermissionsAsync()); }
  if (key === "microphone") { const A = await import("expo-audio"); return toStatus(await A.requestRecordingPermissionsAsync()); }
  const Ct = await import("expo-contacts"); return toStatus(await Ct.requestPermissionsAsync());
}

async function readOne(key: PermKey): Promise<PermStatus> {
  if (Platform.OS === "web") return "unavailable";
  try { return Platform.OS === "android" ? await androidRead(key) : await expoRead(key); }
  catch (e) { console.warn(`[permessi] lettura «${key}» fallita:`, e); return "unavailable"; }
}

/** Richiesta di sistema. Propaga l'errore (niente catch silenzioso): chi chiama lo mostra all'utente. */
async function requestOne(key: PermKey): Promise<PermStatus> {
  if (Platform.OS === "web") return "unavailable";
  return serialize(() => (Platform.OS === "android" ? androidRequest(key) : expoRequest(key)));
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
  if (st === "undetermined" || st === "denied") {
    try { st = await requestOne(key); }
    catch (e: any) {
      // V50.z516 — errore VISIBILE (prima spariva in un catch silenzioso)
      console.warn(`[permessi] richiesta «${key}» fallita:`, e);
      if (!opts?.silent) Alert.alert(`Permesso «${PERM_META[key].label}»`, `Il telefono non ha aperto la richiesta (${e?.message || "errore sconosciuto"}). Puoi attivarlo a mano:\n${settingsPath(key)}`, [{ text: "Più tardi", style: "cancel" }, { text: "Apri impostazioni", onPress: openSystemSettings }]);
      void getDevicePermissions(true);
      return false;
    }
  }
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

/** V50.z516 — come ensureDevicePermission ma PROPAGA l'errore (usata dall'onboarding, che lo mostra nella sua UI). */
export async function requestDevicePermission(key: PermKey): Promise<PermStatus> {
  if (Platform.OS === "web") return "unavailable";
  const cur = await readOne(key);
  if (cur === "granted" || cur === "unavailable" || cur === "blocked") { void getDevicePermissions(true); return cur; }
  const st = await requestOne(key);
  void getDevicePermissions(true);
  return st;
}

// ---- V50.z516 — «Visualizzazione in primo piano» (SYSTEM_ALERT_WINDOW, solo Android): non è un permesso runtime → si attiva
// dalla schermata di sistema «Mostra sopra altre app». Non esiste API JS per leggerne lo stato senza modulo nativo: l'utente
// conferma e lo ricordiamo per utente.
export const OVERLAY_META = { label: "Visualizzazione in primo piano", purpose: "mostrare Axon sopra le altre app (Axon Drive, «Ehi Axon», avvisi mentre guidi)", icon: "layers",
  android: "Impostazioni → App → AdvisorOS → Mostra sopra altre app → «Concedi autorizzazione»" };
export const OVERLAY_KEY = (userId: string) => `overlay_perm_confirmed_${userId}`;
export const overlaySupported = () => Platform.OS === "android";
export async function openOverlaySettings(): Promise<void> {
  // Apre direttamente l'elenco «Mostra sopra altre app» (Settings.ACTION_MANAGE_OVERLAY_PERMISSION); l'utente sceglie AdvisorOS.
  try { await Linking.sendIntent("android.settings.action.MANAGE_OVERLAY_PERMISSION"); }
  catch (e) { console.warn("[permessi] overlay settings:", e); openSystemSettings(); }
}
export const overlayConfirmed = async (userId?: string | null) => !!userId && (await AsyncStorage.getItem(OVERLAY_KEY(userId)).catch(() => null)) === "1";
export const setOverlayConfirmed = async (userId: string, v: boolean) => AsyncStorage.setItem(OVERLAY_KEY(userId), v ? "1" : "0").catch(() => {});

// ---- V50.z485 — Onboarding permessi al primo avvio (app/permessi-onboarding.tsx) ----
export const PERM_ONBOARDING_KEY = (userId: string) => `perm_onboarding_done_${userId}`;

/** true se va mostrato: nativo, non ancora fatto per questo utente e almeno un permesso non concesso. */
export async function shouldShowPermOnboarding(userId?: string | null): Promise<boolean> {
  if (Platform.OS === "web" || !userId) return false;
  if ((await AsyncStorage.getItem(PERM_ONBOARDING_KEY(userId)).catch(() => null)) === "1") return false;
  const perms = await getDevicePermissions(true).catch(() => null);
  return !!perms && perms.some((p) => p.status !== "granted" && p.status !== "unavailable");
}

/** V50.z516 — «Rivedi introduzione» (Impostazioni): azzera i flag locali di tour e permessi così il flusso riparte dall'inizio. */
export async function resetOnboardingFlags(userId: string): Promise<void> {
  await AsyncStorage.multiRemove([`onboarding_done_${userId}`, PERM_ONBOARDING_KEY(userId)]).catch(() => {});
}

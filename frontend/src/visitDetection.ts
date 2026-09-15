// visitDetection.ts — V50.z256 — Motore «Rilevamento Visite» (client-side geofencing sui clienti geocodificati)
//
// • Impostazioni (user_settings.visit_detection): enabled, stay_minutes (soglia permanenza), radius_m, mode realtime|evening|both, recap_time.
// • Sorgenti posizione: foreground (Location.watchPositionAsync) + background (expo-task-manager + startLocationUpdatesAsync,
//   SOLO build nativa) → entrambe chiamano processLocation(); lo stato vive in AsyncStorage (niente React) così il task in
//   background e l'app condividono la stessa sosta in corso.
// • Una sosta diventa «candidata» solo dopo stay_minutes continuativi entro radius_m da uno o più clienti (tutti quelli nel raggio
//   sono inclusi: sceglie l'utente). Candidati → POST /visits/candidates; in modalità Tempo Reale/Entrambe si emette un evento
//   (popup in app) o una notifica locale (in background). Fine Giornata: notifica/recap alle recap_time con spunte pre-selezionate.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import * as Notifications from "expo-notifications";
import { api } from "@/src/api";

export type VisitMode = "realtime" | "evening" | "both";
export type VisitDetectionSettings = { enabled: boolean; stay_minutes: number; radius_m: number; mode: VisitMode; recap_time: string };
export const VD_DEFAULT: VisitDetectionSettings = { enabled: false, stay_minutes: 10, radius_m: 150, mode: "both", recap_time: "18:30" };

export type VisitCandidate = { cand_id: string; contact_id: string; contact_name: string; city?: string; date: string; started_at: string; ended_at?: string | null; stay_minutes: number; lat?: number | null; lon?: number | null; status: string };
export type GeoContact = { contact_id: string; name: string; city?: string; address?: string; lat: number | null; lon: number | null };

const K_SETTINGS = "vd_settings_v1";
const K_CONTACTS = "vd_contacts_v1";      // { at, items: GeoContact[] }
const K_STATE = "vd_state_v1";            // { dwell: { ids, since, lat, lon, reported } | null, lastFix }
const K_RECAP_SHOWN = "vd_recap_shown_v1"; // 'YYYY-MM-DD'
export const VD_TASK = "advisoros-visit-detection";
const CONTACTS_TTL_MS = 60 * 60 * 1000;

// ---------- Event bus (foreground popup) ----------
type Listener = (ev: { type: "candidates"; items: VisitCandidate[] } | { type: "recap"; date: string } | { type: "settings"; settings: VisitDetectionSettings }) => void;
const listeners = new Set<Listener>();
export function onVisitEvent(fn: Listener) { listeners.add(fn); return () => { listeners.delete(fn); }; }
function emit(ev: Parameters<Listener>[0]) { listeners.forEach((l) => { try { l(ev); } catch {} }); }

// ---------- Utils ----------
export const todayLocal = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR, dLon = (lon2 - lon1) * toR;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
const readJson = async <T,>(k: string, fb: T): Promise<T> => { try { const raw = await AsyncStorage.getItem(k); return raw ? (JSON.parse(raw) as T) : fb; } catch { return fb; } };
const writeJson = (k: string, v: any) => AsyncStorage.setItem(k, JSON.stringify(v)).catch(() => {});

// ---------- Settings ----------
export async function loadVisitSettings(): Promise<VisitDetectionSettings> {
  try {
    const r = await api<{ visit_detection: VisitDetectionSettings }>("/visits/settings");
    const s = { ...VD_DEFAULT, ...(r.visit_detection || {}) };
    await writeJson(K_SETTINGS, s);
    return s;
  } catch { return readJson(K_SETTINGS, VD_DEFAULT); }
}
export async function saveVisitSettings(s: VisitDetectionSettings): Promise<VisitDetectionSettings> {
  await api("/user-settings", { method: "PUT", body: { visit_detection: s } });
  await writeJson(K_SETTINGS, s);
  emit({ type: "settings", settings: s });
  return s;
}
const cachedSettings = () => readJson<VisitDetectionSettings>(K_SETTINGS, VD_DEFAULT);

// ---------- Contatti geocodificati (cache locale, refresh orario) ----------
export async function refreshGeoContacts(force = false): Promise<GeoContact[]> {
  const cache = await readJson<{ at: number; items: GeoContact[] }>(K_CONTACTS, { at: 0, items: [] });
  if (!force && cache.items.length && Date.now() - cache.at < CONTACTS_TTL_MS) return cache.items;
  try {
    const r = await api<{ items: GeoContact[] }>("/geo/contacts-map?scope=mine");
    const items = (r.items || []).filter((c) => c.lat != null && c.lon != null).map((c) => ({ contact_id: c.contact_id, name: c.name, city: c.city, address: c.address, lat: c.lat, lon: c.lon }));
    await writeJson(K_CONTACTS, { at: Date.now(), items });
    return items;
  } catch { return cache.items; }
}

// ---------- Core: una posizione → stato sosta ----------
type Dwell = { ids: string[]; since: number; lat: number; lon: number; reported: boolean; maxStay: number };
type VdState = { dwell: Dwell | null; lastFix?: number };

export async function processLocation(lat: number, lon: number, ts = Date.now(), background = false): Promise<void> {
  const s = await cachedSettings();
  if (!s.enabled) return;
  const contacts = await refreshGeoContacts();
  const near = contacts.filter((c) => haversineM(lat, lon, c.lat!, c.lon!) <= s.radius_m).map((c) => c.contact_id);
  const st = await readJson<VdState>(K_STATE, { dwell: null });
  let dwell = st.dwell;
  if (near.length) {
    const overlap = dwell ? dwell.ids.some((id) => near.includes(id)) : false;
    if (!dwell || !overlap) dwell = { ids: near, since: ts, lat, lon, reported: false, maxStay: 0 };
    else { dwell.ids = Array.from(new Set([...dwell.ids, ...near])); }
    const minutes = Math.floor((ts - dwell.since) / 60000);
    dwell.maxStay = Math.max(dwell.maxStay, minutes);
    if (!dwell.reported && minutes >= s.stay_minutes) {
      dwell.reported = true;
      await reportCandidates(dwell, contacts, s, background);
    }
  } else if (dwell) {
    // uscita dal raggio (isteresi: 1.5× raggio) → chiude la sosta
    const far = contacts.filter((c) => dwell!.ids.includes(c.contact_id)).every((c) => haversineM(lat, lon, c.lat!, c.lon!) > s.radius_m * 1.5);
    if (far) dwell = null;
  }
  await writeJson(K_STATE, { dwell, lastFix: ts });
}

async function reportCandidates(d: Dwell, contacts: GeoContact[], s: VisitDetectionSettings, background: boolean) {
  const started = new Date(d.since).toISOString();
  const body = d.ids.map((id) => ({ contact_id: id, started_at: started, ended_at: null, stay_minutes: Math.max(s.stay_minutes, d.maxStay), lat: d.lat, lon: d.lon, date: todayLocal(new Date(d.since)) }));
  let created: VisitCandidate[] = [];
  try { created = (await api<{ created: VisitCandidate[] }>("/visits/candidates", { method: "POST", body })).created || []; } catch { return; }
  if (!created.length) return;
  if (s.mode === "realtime" || s.mode === "both") {
    if (background && Platform.OS !== "web") {
      const names = created.map((c) => c.contact_name).join(", ");
      await Notifications.scheduleNotificationAsync({
        content: { title: created.length > 1 ? "Sei da uno di questi clienti?" : `Sei da ${names}?`, body: "Visita effettuata? Tocca per confermare e aggiungere una nota.", data: { type: "visit_candidates", date: created[0].date }, sound: "default" },
        trigger: null,
      }).catch(() => {});
    } else emit({ type: "candidates", items: created });
  }
  void contacts;
}

// ---------- Recap serale ----------
/** "HH:MM" → [h, m] (default 18:30; NB: 0 è un valore valido, niente `||`). */
export function parseHHMM(t?: string): [number, number] {
  const mm = /^(\d{1,2}):(\d{2})$/.exec(t || "");
  if (!mm) return [18, 30];
  const h = Math.min(23, Math.max(0, Number(mm[1]))), m = Math.min(59, Math.max(0, Number(mm[2])));
  return [isNaN(h) ? 18 : h, isNaN(m) ? 30 : m];
}
export function recapDue(s: VisitDetectionSettings, now = new Date()): boolean {
  if (s.mode === "realtime") return false;
  const [h, m] = parseHHMM(s.recap_time);
  return now.getHours() * 60 + now.getMinutes() >= h * 60 + m;
}
export async function maybeTriggerRecap(s: VisitDetectionSettings): Promise<boolean> {
  if (!s.enabled || !recapDue(s)) return false;
  const day = todayLocal();
  const shown = await AsyncStorage.getItem(K_RECAP_SHOWN);
  if (shown === day) return false;
  try {
    const r = await api<{ items: VisitCandidate[] }>(`/visits/candidates?date=${day}`);
    if (!r.items?.length) return false;
    await AsyncStorage.setItem(K_RECAP_SHOWN, day);
    emit({ type: "recap", date: day });
    return true;
  } catch { return false; }
}
export async function scheduleEveningRecapNotification(s: VisitDetectionSettings): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    const all = await Notifications.getAllScheduledNotificationsAsync();
    for (const n of all) if ((n.content?.data as any)?.type === "visit_recap") await Notifications.cancelScheduledNotificationAsync(n.identifier);
    if (!s.enabled || s.mode === "realtime") return;
    const [h, m] = parseHHMM(s.recap_time);
    await Notifications.scheduleNotificationAsync({
      content: { title: "Recap visite di oggi", body: "Controlla le soste rilevate e conferma le visite con un tap.", data: { type: "visit_recap" }, sound: "default" },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: h, minute: m } as any,
    });
  } catch {}
}

// ---------- Permessi + start/stop tracking ----------
export async function ensureLocationPermission(background: boolean): Promise<"granted" | "denied" | "blocked"> {
  const fg = await Location.getForegroundPermissionsAsync();
  let status = fg.status;
  if (status !== "granted") {
    if (!fg.canAskAgain) return "blocked";
    status = (await Location.requestForegroundPermissionsAsync()).status;
    if (status !== "granted") return "denied";
  }
  if (background && Platform.OS !== "web") {
    const bg = await Location.getBackgroundPermissionsAsync();
    if (bg.status !== "granted") {
      if (!bg.canAskAgain) return "granted"; // foreground ok, background bloccato: si continua solo con app aperta
      await Location.requestBackgroundPermissionsAsync().catch(() => null);
    }
  }
  return "granted";
}

let fgSub: Location.LocationSubscription | null = null;
export async function startForegroundWatch(): Promise<void> {
  if (fgSub) return;
  try {
    fgSub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced, timeInterval: 60000, distanceInterval: 40 }, (loc) => {
      void processLocation(loc.coords.latitude, loc.coords.longitude, loc.timestamp || Date.now(), false);
    });
  } catch { fgSub = null; }
}
export function stopForegroundWatch() { try { fgSub?.remove(); } catch {} fgSub = null; }

export async function startBackgroundUpdates(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  try {
    const bg = await Location.getBackgroundPermissionsAsync();
    if (bg.status !== "granted") return false;
    if (await Location.hasStartedLocationUpdatesAsync(VD_TASK)) return true;
    await Location.startLocationUpdatesAsync(VD_TASK, {
      accuracy: Location.Accuracy.Balanced, timeInterval: 120000, distanceInterval: 60, pausesUpdatesAutomatically: true, showsBackgroundLocationIndicator: false,
      foregroundService: { notificationTitle: "Rilevamento visite attivo", notificationBody: "AdvisorOS riconosce le soste presso i tuoi clienti", notificationColor: "#0EA5E9" },
    });
    return true;
  } catch { return false; }
}
export async function stopBackgroundUpdates(): Promise<void> {
  if (Platform.OS === "web") return;
  try { if (await Location.hasStartedLocationUpdatesAsync(VD_TASK)) await Location.stopLocationUpdatesAsync(VD_TASK); } catch {}
}

// Task in background (deve essere definito a livello di modulo, solo build nativa)
if (Platform.OS !== "web") {
  try {
    TaskManager.defineTask(VD_TASK, async ({ data, error }: any) => {
      if (error || !data?.locations?.length) return;
      const loc = data.locations[data.locations.length - 1];
      await processLocation(loc.coords.latitude, loc.coords.longitude, loc.timestamp || Date.now(), true);
    });
  } catch {}
}

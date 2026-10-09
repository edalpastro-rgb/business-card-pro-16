// pushBridge.ts — V50.z193 — Bridge persistente telefono ↔ Push Service AxonOS (modulo ISOLATO)
//
// Cosa fa (nessuna modifica a pushRegister.ts / axonNotifications.ts):
//   1) Canale Android `default` a livello MODULO (importanza MAX): richiesto dal playbook Emergent Push per
//      rendere i push "data-only" quando l'app è in background o chiusa (Android 8+). Senza canale = nessuna notifica.
//   2) Registrazione token con RETRY (3 tentativi, backoff 2s/6s/15s) + report dello stato al server
//      (`POST /axon/push/device`: permesso, registrato sì/no, errore reale del token, ambiente Expo Go/standalone).
//      Così AxonOS sa se il telefono può ricevere i push e perché no (es. Firebase mancante).
//   3) Nudge settimanale: permesso negato definitivamente → messaggio in chat AxonOS (non popup), throttling
//      client (AsyncStorage `pushNudgeAt`) + server (7 giorni).
//   4) Ack dei test programmati: quando arriva la push con `data.test_id` (ricevuta o toccata) → `POST /tests/{id}/ack`
//      → la card mostra "Ricevuto sul telefono ✅".
import { useEffect, useRef } from "react";
import { AppState, Platform, Vibration } from "react-native";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "@/src/api";
import { registerForPush } from "@/src/pushRegister";

// 1) Canali Android a livello modulo — devono esistere PRIMA che arrivi qualsiasi push (Android 8+: priorità, suono, LED e
//    vibrazione sono proprietà del canale; il backend sceglie il canale con `data.channel_id`, vedi routes/axon_push_urgency.py).
//    V50.z220 — canali per livello di urgenza: `urgent_alerts` (CRITICAL: LED rosso, vibrazione lunga, MAX, bypass DND, lockscreen
//    completo), `standard_alerts` (HIGH: LED blu, vibrazione breve), `default` (NORMAL, canale storico). Le proprietà di un canale sono
//    congelate dall'OS alla creazione: per cambiarle serve un nuovo id (es. urgent_alerts_v2).
//    iOS-ready: iOS non ha canali; suono/badge/interruption level arrivano dal payload (aps) e dal `setNotificationHandler`.
if (Platform.OS === "android") {
  Notifications.setNotificationChannelAsync("default", {
    name: "AxonOS",
    importance: Notifications.AndroidImportance.MAX,
    sound: "default",
    vibrationPattern: [0, 250, 250, 250],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  }).catch(() => {});
  Notifications.setNotificationChannelAsync("urgent_alerts", {
    name: "Avvisi urgenti",
    description: "Notifiche critiche: scadenze, ritelefonate urgenti, allerte. LED rosso e vibrazione lunga.",
    importance: Notifications.AndroidImportance.MAX,
    sound: "default", // → "urgent.wav" quando il file sarà bundlato nel plugin expo-notifications (app.json → sounds)
    vibrationPattern: [0, 500, 100, 500],
    enableLights: true,
    lightColor: "#FF0000",
    enableVibrate: true,
    bypassDnd: true,
    showBadge: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  }).catch(() => {});
  // V50.z492 — «Trova il mio telefono»: sveglia il telefono a schermo spento, suono dedicato (find_phone.wav bundlato via app.json), vibrazione lunga, bypass DND
  Notifications.setNotificationChannelAsync("find_phone", {
    name: "Trova il mio telefono",
    description: "Squillo dedicato quando chiedi ad Axon «dove sei?» da un altro dispositivo.",
    importance: Notifications.AndroidImportance.MAX,
    sound: "find_phone.wav",
    vibrationPattern: [0, 1500, 150, 1500, 150, 1500],
    enableLights: true,
    lightColor: "#EA580C",
    enableVibrate: true,
    bypassDnd: true,
    showBadge: false,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  }).catch(() => {});
  Notifications.setNotificationChannelAsync("standard_alerts", {
    name: "Notifiche standard",
    description: "Task completati, messaggi del team, aggiornamenti.",
    importance: Notifications.AndroidImportance.HIGH,
    sound: "default",
    vibrationPattern: [0, 300],
    enableLights: true,
    lightColor: "#0066FF",
    enableVibrate: true,
    showBadge: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  }).catch(() => {});
}

/** V50.z220 — Feedback locale quando una push arriva con l'app aperta: Android vibra (CRITICAL: 500-100-500 ms), iOS haptic pesante. */
async function urgencyFeedback(data: any) {
  const u = String(data?.urgency || "").toUpperCase();
  if (!u || u === "NORMAL") return;
  try {
    if (Platform.OS === "android") Vibration.vibrate(u === "CRITICAL" ? [0, 500, 100, 500] : 300);
    else if (Platform.OS === "ios") {
      const Haptics = await import("expo-haptics");
      await Haptics.notificationAsync(u === "CRITICAL" ? Haptics.NotificationFeedbackType.Error : Haptics.NotificationFeedbackType.Success);
    }
  } catch { /* opzionale */ }
}

export type PushDevice = {
  platform: string; registered: boolean; permission: string; can_ask_again: boolean; token_hint?: string | null;
  error?: string | null; app_env?: string | null; registered_at?: string | null; last_seen_at?: string | null;
  last_delivered_at?: string | null; last_failed_at?: string | null; last_push_status?: string | null;
};
export type PushTest = { test_id: string; status: string; scheduled_at: string; fired_at?: string | null; ack_at?: string | null; minutes: number };
export type PushStatus = {
  push_configured: boolean; level: "ok" | "warn" | "off"; summary: string; devices: PushDevice[];
  last_push?: { at: string; status: string; title: string } | null; outbox_pending: number;
  last_test?: PushTest | null; last_test_label?: string | null;
};

export const pushApi = {
  status: () => api<PushStatus>("/axon/push/status"),
  scheduleTest: (minutes = 2) => api<{ ok: boolean; test: PushTest; label: string; push_configured: boolean }>("/axon/push/test-scheduled", { method: "POST", body: { minutes } }),
  ack: (testId: string) => api<{ ok: boolean }>(`/axon/push/tests/${testId}/ack`, { method: "POST" }),
  nudge: () => api<{ ok: boolean; skipped: boolean }>("/axon/push/nudge", { method: "POST" }),
  report: (body: Record<string, any>) => api<PushStatus>("/axon/push/device", { method: "POST", body }),
  testUrgency: (urgency: "CRITICAL" | "HIGH" | "NORMAL") => api<{ ok: boolean; urgency: string; channel_id: string; push_configured: boolean }>("/axon/push/test-urgency", { method: "POST", body: { urgency } }), // V50.z220
};

function appEnv(): string {
  if (Platform.OS === "web") return "web";
  if ((Constants as any).appOwnership === "expo" || (Constants as any).executionEnvironment === "storeClient") return "expo_go";
  return __DEV__ ? "dev" : "standalone";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const RETRY_MS = [0, 2000, 6000, 15000];
const NUDGE_KEY = "pushNudgeAt";
const NUDGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Registra il token (con retry) e comunica al server lo stato reale del telefono. Ritorna lo stato server. */
export async function syncPushDevice(userId: string): Promise<PushStatus | null> {
  if (!userId || Platform.OS === "web") return null;
  let perm: Notifications.NotificationPermissionsStatus | null = null;
  try { perm = await Notifications.getPermissionsAsync(); } catch { /* ignore */ }
  let registered = false;
  let error: string | null = null;
  let tokenHint: string | null = null;
  for (let i = 0; i < RETRY_MS.length && !registered; i++) {
    if (RETRY_MS[i]) await sleep(RETRY_MS[i]);
    try { registered = await registerForPush(userId); } catch (e: any) { error = String(e?.message || e); }
    if (!registered) {
      try { perm = await Notifications.getPermissionsAsync(); } catch { /* ignore */ }
      if (!perm?.granted) break; // permesso negato/non concesso: inutile riprovare
      // permesso ok ma registrazione fallita → cattura il motivo reale (es. Firebase non inizializzato)
      try { const t = await Notifications.getDevicePushTokenAsync(); tokenHint = String(t?.data || "").slice(-6) || null; }
      catch (e: any) { error = String(e?.message || e).slice(0, 200); }
    }
  }
  if (registered) {
    try { const t = await Notifications.getDevicePushTokenAsync(); tokenHint = String(t?.data || "").slice(-6) || null; } catch { /* ignore */ }
  }
  const permission = perm?.granted ? "granted" : perm?.status === "denied" ? "denied" : "undetermined";
  // 3) nudge settimanale in chat (permesso negato e non richiedibile)
  if (permission === "denied" && perm && perm.canAskAgain === false) {
    try {
      const last = Number((await AsyncStorage.getItem(NUDGE_KEY)) || 0);
      if (!last || Date.now() - last > NUDGE_MS) {
        await pushApi.nudge();
        await AsyncStorage.setItem(NUDGE_KEY, String(Date.now()));
      }
    } catch { /* ignore */ }
  }
  try {
    return await pushApi.report({
      platform: Platform.OS, registered, permission, can_ask_again: perm?.canAskAgain ?? true, token_hint: tokenHint,
      error, app_env: appEnv(), device_name: (Constants as any).deviceName || null,
      app_version: (Constants as any).expoConfig?.version || null,
    });
  } catch { return null; }
}

/** Ack al server quando arriva/viene toccata una push di test programmato. */
function ackIfTest(data: any) {
  const id = data?.test_id;
  if (typeof id === "string" && id) pushApi.ack(id).catch(() => {});
}

/** Montare UNA volta nel layout radice (solo con utente loggato): sync all'avvio + al ritorno in foreground (max 1 ogni 30 min). */
export function PushBridgeSync({ userId }: { userId?: string | null }) {
  const lastSync = useRef(0);
  useEffect(() => {
    if (!userId || Platform.OS === "web") return;
    const run = () => {
      if (Date.now() - lastSync.current < 30 * 60 * 1000) return;
      lastSync.current = Date.now();
      syncPushDevice(userId).catch(() => {});
    };
    const t = setTimeout(run, 1500);
    const appSub = AppState.addEventListener("change", (st) => { if (st === "active") run(); });
    const recv = Notifications.addNotificationReceivedListener((n) => { const d = n?.request?.content?.data; ackIfTest(d); void urgencyFeedback(d); });
    const tap = Notifications.addNotificationResponseReceivedListener((r) => ackIfTest(r?.notification?.request?.content?.data));
    return () => { clearTimeout(t); appSub.remove(); recv.remove(); tap.remove(); };
  }, [userId]);
  return null;
}

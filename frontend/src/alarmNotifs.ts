// V50.z8 — Axon Alarms: sincronizzazione notifiche locali via expo-notifications.
// Le sveglie sono salvate sul backend (fonte di verità); questo modulo si
// occupa di:
//  • schedulare le prossime N occorrenze come notifiche locali
//  • cancellare le vecchie notifiche di una sveglia rimossa/disabilitata
//  • cache dei suoni custom in expo-file-system
//
// NB: iOS non supporta suoni notifica arbitrari senza bundling. In
// foreground playAlarmSound() riproduce il file custom via expo-audio.

import * as Notifications from "expo-notifications";
import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";
import { storage } from "@/src/utils/storage";
import { api } from "@/src/api";
import { ensureNotifPermission } from "@/src/notifs";

export type AlarmKind = "timer" | "alarm" | "reminder";

// V50.z13 — Notification handler: forza sound+banner anche in foreground.
// Idempotente: la prima chiamata configura il canale Android + handler globale.
let _handlerConfigured = false;
export async function configureAlarmNotifications(): Promise<void> {
  if (_handlerConfigured || Platform.OS === "web") return;
  _handlerConfigured = true;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("axon-alarms", {
        name: "Sveglie Axon",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 400, 200, 400, 200, 400],
        sound: "default",
        enableVibrate: true,
        bypassDnd: true,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      });
    }
  } catch { /* ignore */ }
}


export type Alarm = {
  id: string;
  kind: AlarmKind;
  label: string;
  note?: string | null;
  enabled: boolean;
  sound_ref: string; // "default" | sound_id
  vibrate: boolean;
  duration_seconds?: number;
  time?: string; // "HH:MM"
  weekdays?: number[]; // 0=Dom ... 6=Sab
  trigger_at?: string; // ISO
  created_at: string;
  updated_at: string;
};

const IDS_KEY = (alarmId: string) => `alarm_notif_ids_${alarmId}`;

// ── Utils ────────────────────────────────────────────────────────────
async function loadNotifIds(alarmId: string): Promise<string[]> {
  const raw = (await storage.getItem<string | null>(IDS_KEY(alarmId), null)) as string | null;
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

async function saveNotifIds(alarmId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) await storage.removeItem(IDS_KEY(alarmId));
  else await storage.setItem(IDS_KEY(alarmId), JSON.stringify(ids));
}

async function cancelAlarmNotifs(alarmId: string): Promise<void> {
  if (Platform.OS === "web") return;
  const ids = await loadNotifIds(alarmId);
  for (const nid of ids) {
    try { await Notifications.cancelScheduledNotificationAsync(nid); } catch { /* ignore */ }
  }
  await saveNotifIds(alarmId, []);
}

/**
 * Calcola la prossima occorrenza (Date UTC) di una sveglia ricorrente.
 * @param time "HH:MM"
 * @param weekdays [] = one-shot alla prossima occorrenza; altrimenti 0..6
 * @param from base time (default: ora)
 */
function nextOccurrence(time: string, weekdays: number[], from: Date = new Date()): Date | null {
  const [hStr, mStr] = time.split(":");
  const H = parseInt(hStr, 10);
  const M = parseInt(mStr, 10);
  if (isNaN(H) || isNaN(M)) return null;
  // If no recurrence → today at H:M if in future, else tomorrow
  if (!weekdays || weekdays.length === 0) {
    const cand = new Date(from);
    cand.setHours(H, M, 0, 0);
    if (cand.getTime() <= from.getTime() + 1000) cand.setDate(cand.getDate() + 1);
    return cand;
  }
  // Find next weekday in list
  for (let i = 0; i < 8; i++) {
    const cand = new Date(from);
    cand.setDate(cand.getDate() + i);
    cand.setHours(H, M, 0, 0);
    if (cand.getTime() <= from.getTime() + 1000) continue;
    const wd = cand.getDay(); // 0=Sunday ... 6=Saturday
    if (weekdays.includes(wd)) return cand;
  }
  return null;
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Schedula (o riprogramma) tutte le notifiche locali di una sveglia.
 * Se disabilitata / senza trigger → cancella tutte.
 */
export async function syncAlarmNotifs(a: Alarm): Promise<void> {
  if (Platform.OS === "web") return;
  const granted = await ensureNotifPermission();
  if (!granted) return;

  // Cancella prima le vecchie
  await cancelAlarmNotifs(a.id);
  if (!a.enabled) return;

  // Assicura canale Android con vibrazione
  if (Platform.OS === "android") {
    try {
      await Notifications.setNotificationChannelAsync("axon-alarms", {
        name: "Sveglie Axon",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: a.vibrate ? [0, 400, 200, 400, 200, 400] : [0],
        sound: "default",
        enableVibrate: a.vibrate,
      });
    } catch { /* ignore */ }
  }

  const commonContent = {
    title: a.label || (a.kind === "timer" ? "Timer scaduto" : a.kind === "alarm" ? "Sveglia" : "Promemoria"),
    body: a.note || (a.kind === "timer" ? "Il tuo timer è scaduto" : a.kind === "alarm" ? "È ora di svegliarsi" : "Promemoria da Axon"),
    sound: "default" as const,
    data: { tag: `alarm_${a.id}`, alarmId: a.id, kind: a.kind, soundRef: a.sound_ref },
  };

  const newIds: string[] = [];

  if (a.kind === "timer" || a.kind === "reminder") {
    if (!a.trigger_at) return;
    const when = new Date(a.trigger_at);
    if (when.getTime() < Date.now() + 1000) return;
    try {
      const nid = await Notifications.scheduleNotificationAsync({
        content: commonContent,
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: when,
          channelId: Platform.OS === "android" ? "axon-alarms" : undefined,
        } as any,
      });
      newIds.push(nid);
    } catch { /* ignore */ }
  } else if (a.kind === "alarm") {
    if (!a.time) return;
    const weekdays = a.weekdays || [];
    if (weekdays.length === 0) {
      // One-shot: prossima occorrenza
      const when = nextOccurrence(a.time, []);
      if (!when) return;
      try {
        const nid = await Notifications.scheduleNotificationAsync({
          content: commonContent,
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: when,
            channelId: Platform.OS === "android" ? "axon-alarms" : undefined,
          } as any,
        });
        newIds.push(nid);
      } catch { /* ignore */ }
    } else {
      // Ricorrente: schedula un weekly per ogni giorno selezionato
      for (const wd of weekdays) {
        try {
          const [hStr, mStr] = a.time.split(":");
          const H = parseInt(hStr, 10);
          const M = parseInt(mStr, 10);
          // expo-notifications WEEKLY: weekday 1..7 (1=Sunday)
          const nid = await Notifications.scheduleNotificationAsync({
            content: commonContent,
            trigger: {
              type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
              weekday: (wd + 1) as number, // 0=Dom → 1
              hour: H,
              minute: M,
              channelId: Platform.OS === "android" ? "axon-alarms" : undefined,
            } as any,
          });
          newIds.push(nid);
        } catch { /* ignore */ }
      }
    }
  }

  if (newIds.length > 0) await saveNotifIds(a.id, newIds);
}

/**
 * Cancella completamente le notifiche di una sveglia (chiamare a delete).
 */
export async function removeAlarmNotifs(alarmId: string): Promise<void> {
  await cancelAlarmNotifs(alarmId);
}

/**
 * Ri-sincronizza tutte le sveglie del server (chiamare al mount della pagina
 * o al login) → garantisce coerenza dopo reboot o cambio dispositivo.
 */
export async function syncAllAlarms(): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    const r = await api<{ items: Alarm[] }>("/axon/alarms");
    for (const a of r.items || []) {
      await syncAlarmNotifs(a);
    }
  } catch { /* ignore */ }
}

// ── Custom sound cache ──────────────────────────────────────────────

const SOUND_CACHE_DIR = `${FileSystem.cacheDirectory ?? ""}axon-sounds/`;

async function ensureSoundDir(): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(SOUND_CACHE_DIR);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(SOUND_CACHE_DIR, { intermediates: true });
    }
  } catch { /* ignore */ }
}

/**
 * Scarica (se necessario) il suono custom nel filesystem cache del device.
 * Ritorna un `file://` URI utilizzabile con expo-audio, o null in caso di errore.
 */
export async function getCustomSoundUri(soundId: string): Promise<string | null> {
  if (!soundId || soundId === "default") return null;
  if (Platform.OS === "web") return null;
  try {
    await ensureSoundDir();
    const targetPath = `${SOUND_CACHE_DIR}${soundId}.mp3`;
    const info = await FileSystem.getInfoAsync(targetPath);
    if (info.exists && info.size && info.size > 100) return targetPath;
    // Scarica base64 dal backend e salva
    const r = await api<{ data_base64: string; mime?: string }>(`/axon/alarm-sounds/${soundId}/data`);
    if (!r.data_base64) return null;
    await FileSystem.writeAsStringAsync(targetPath, r.data_base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return targetPath;
  } catch {
    return null;
  }
}

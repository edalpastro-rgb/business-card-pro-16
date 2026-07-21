import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { storage } from "@/src/utils/storage";

let configured = false;

async function configure() {
  if (configured) return;
  configured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  if (Platform.OS === "android") {
    try {
      await Notifications.setNotificationChannelAsync("default", {
        name: "ProSync",
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
      });
    } catch {}
  }
}

const key = (kind: "appt" | "cb", id: string) => `notif_${kind}_${id}`;

async function saveIds(kind: "appt" | "cb", id: string, ids: string[]) {
  await storage.setItem(key(kind, id), JSON.stringify(ids));
}
async function loadIds(kind: "appt" | "cb", id: string): Promise<string[]> {
  const raw = (await storage.getItem<string | null>(key(kind, id), null)) as string | null;
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}
async function clearIds(kind: "appt" | "cb", id: string) {
  await storage.removeItem(key(kind, id));
}

export async function ensureNotifPermission(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  await configure();
  const settings = await Notifications.getPermissionsAsync();
  if (settings.granted) return true;
  if (!settings.canAskAgain) return false;
  const req = await Notifications.requestPermissionsAsync();
  return req.granted;
}

async function scheduleAt(when: Date, title: string, body: string): Promise<string | null> {
  if (Platform.OS === "web") return null;
  if (when.getTime() < Date.now() + 1000) return null;
  await configure();
  const id = await Notifications.scheduleNotificationAsync({
    content: { title, body, sound: "default" },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when } as any,
  });
  return id;
}

export async function scheduleAppointmentReminder(id: string, title: string, startAt: Date): Promise<void> {
  await cancelAppointmentReminder(id);
  const granted = await ensureNotifPermission();
  if (!granted) return;
  const ids: string[] = [];
  const pre = new Date(startAt.getTime() - 15 * 60 * 1000);
  const id1 = await scheduleAt(pre, "Promemoria appuntamento", `${title} tra 15 minuti`);
  if (id1) ids.push(id1);
  const id2 = await scheduleAt(startAt, "Appuntamento adesso", title);
  if (id2) ids.push(id2);
  if (ids.length) await saveIds("appt", id, ids);
}

export async function scheduleCallbackReminder(id: string, title: string, at: Date): Promise<void> {
  await cancelCallbackReminder(id);
  const granted = await ensureNotifPermission();
  if (!granted) return;
  const nid = await scheduleAt(at, "Ritelefonata", title);
  if (nid) await saveIds("cb", id, [nid]);
}

// Birthday: repeats yearly. birthDate string "dd/mm/yyyy" or "dd/mm"
export async function scheduleBirthdayReminder(contactId: string, contactName: string, birthDate: string, daysBefore: number = 1): Promise<void> {
  await cancelBirthdayReminder(contactId);
  if (Platform.OS === "web") return;
  const parts = birthDate.split("/").map((x) => parseInt(x, 10));
  if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) return;
  const day = parts[0], month = parts[1];
  const granted = await ensureNotifPermission();
  if (!granted) return;
  const ids: string[] = [];
  await configure();
  // schedule yearly notification on the alert day (daysBefore before birthday) at 9:00
  const alertDate = new Date();
  alertDate.setFullYear(alertDate.getFullYear(), month - 1, day);
  alertDate.setDate(alertDate.getDate() - Math.max(0, daysBefore));
  try {
    const id1 = await Notifications.scheduleNotificationAsync({
      content: { title: `Compleanno in arrivo`, body: `${contactName} compie gli anni tra ${daysBefore} giorno/i`, sound: "default" },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.YEARLY, month: (alertDate.getMonth()), day: alertDate.getDate(), hour: 9, minute: 0 } as any,
    });
    ids.push(id1);
  } catch {}
  try {
    const id2 = await Notifications.scheduleNotificationAsync({
      content: { title: `Buon compleanno!`, body: `Oggi ${contactName} festeggia il compleanno`, sound: "default" },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.YEARLY, month: month - 1, day, hour: 9, minute: 0 } as any,
    });
    ids.push(id2);
  } catch {}
  if (ids.length) await storage.setItem(`notif_bday_${contactId}`, JSON.stringify(ids));
}

export async function cancelBirthdayReminder(contactId: string) {
  const raw = (await storage.getItem<string | null>(`notif_bday_${contactId}`, null)) as string | null;
  if (!raw) return;
  try {
    const ids = JSON.parse(raw) as string[];
    for (const nid of ids) {
      try { await Notifications.cancelScheduledNotificationAsync(nid); } catch {}
    }
  } catch {}
  await storage.removeItem(`notif_bday_${contactId}`);
}

export async function cancelAppointmentReminder(id: string) {
  const ids = await loadIds("appt", id);
  await cancelReminders(ids);
  await clearIds("appt", id);
}

export async function cancelCallbackReminder(id: string) {
  const ids = await loadIds("cb", id);
  await cancelReminders(ids);
  await clearIds("cb", id);
}

async function cancelReminders(ids: string[]) {
  if (Platform.OS === "web" || ids.length === 0) return;
  for (const nid of ids) {
    try { await Notifications.cancelScheduledNotificationAsync(nid); } catch {}
  }
}

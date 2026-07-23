import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

/**
 * Best-effort local notifications helper. Silent no-op on web / Expo Go where
 * push isn't available. All scheduling is LOCAL (no server push).
 */

let permissionAsked = false;

export async function ensureNotifPermission(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  try {
    const settings = await Notifications.getPermissionsAsync();
    if (settings.granted) return true;
    if (settings.canAskAgain && !permissionAsked) {
      permissionAsked = true;
      const req = await Notifications.requestPermissionsAsync();
      return req.granted;
    }
    return false;
  } catch {
    return false;
  }
}

export function configureNotifHandler() {
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
  } catch {
    // ignore on unsupported platforms
  }
}

export async function scheduleOneShot(id: string, title: string, body: string, when: Date): Promise<string | null> {
  if (Platform.OS === "web") return null;
  if (!(await ensureNotifPermission())) return null;
  try {
    // Cancel any previous scheduling for this logical id
    await cancelByTag(id);
    const notifId = await Notifications.scheduleNotificationAsync({
      content: { title, body, data: { tag: id } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when } as any,
    });
    return notifId;
  } catch {
    return null;
  }
}

export async function scheduleDailyAt(id: string, title: string, body: string, hour: number, minute: number): Promise<string | null> {
  if (Platform.OS === "web") return null;
  if (!(await ensureNotifPermission())) return null;
  try {
    await cancelByTag(id);
    const notifId = await Notifications.scheduleNotificationAsync({
      content: { title, body, data: { tag: id } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute } as any,
    });
    return notifId;
  } catch {
    return null;
  }
}

export async function scheduleYearlyAt(id: string, title: string, body: string, month: number, day: number, hour = 9, minute = 0): Promise<string | null> {
  if (Platform.OS === "web") return null;
  if (!(await ensureNotifPermission())) return null;
  try {
    await cancelByTag(id);
    const notifId = await Notifications.scheduleNotificationAsync({
      content: { title, body, data: { tag: id } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.YEARLY, month, day, hour, minute } as any,
    });
    return notifId;
  } catch {
    return null;
  }
}

export async function cancelByTag(tag: string) {
  if (Platform.OS === "web") return;
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const s of scheduled) {
      const t = (s.content as any)?.data?.tag;
      if (t === tag) {
        await Notifications.cancelScheduledNotificationAsync(s.identifier);
      }
    }
  } catch {}
}

export async function cancelAllMyThing() {
  if (Platform.OS === "web") return;
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const s of scheduled) {
      const t = (s.content as any)?.data?.tag;
      if (typeof t === "string" && t.startsWith("mt_")) {
        await Notifications.cancelScheduledNotificationAsync(s.identifier);
      }
    }
  } catch {}
}

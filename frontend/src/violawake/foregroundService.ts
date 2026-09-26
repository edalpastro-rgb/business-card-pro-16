// V50.z316 — ViolaWake SDK: servizio Android in primo piano (notifica «Viola in ascolto»).
// Il modulo nativo viene generato da plugins/withViolaWakeService.js in prebuild; se assente
// (iOS, Expo Go, build vecchia) tutte le chiamate sono no-op. Su Android 13+ chiediamo anche
// POST_NOTIFICATIONS così la notifica persistente è visibile (senza, il servizio gira comunque).
import { NativeModules, PermissionsAndroid, Platform } from "react-native";

type Native = { start: (title: string, body: string) => Promise<boolean>; stop: () => Promise<boolean> };
const native: Native | undefined = Platform.OS === "android" ? (NativeModules as any).ViolaWakeService : undefined;

export const FOREGROUND_SERVICE_AVAILABLE = !!native;

export async function ensureNotificationPermission(): Promise<void> {
  if (Platform.OS !== "android" || Platform.Version < 33) return;
  try {
    const perm = (PermissionsAndroid.PERMISSIONS as any).POST_NOTIFICATIONS;
    if (perm && !(await PermissionsAndroid.check(perm))) await PermissionsAndroid.request(perm);
  } catch { /* la notifica potrà non mostrarsi: il servizio funziona comunque */ }
}

export async function startForegroundService(keywordLabel: string): Promise<boolean> {
  if (!native) return false;
  try {
    await ensureNotificationPermission();
    await native.start("Axon in ascolto", `Di' «${keywordLabel}» per parlare con Axon · tocca per aprire`);
    return true;
  } catch {
    return false;
  }
}

export async function stopForegroundService(): Promise<void> {
  if (!native) return;
  try { await native.stop(); } catch { /* già fermo */ }
}

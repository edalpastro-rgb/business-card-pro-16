import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { api } from "@/src/api";

/**
 * V50.z84 — Registrazione device token per Emergent managed push notifications.
 * Chiamare `registerForPush(userId)` dopo login e ad ogni app open.
 * Silent no-op su web/Expo Go dove getDevicePushTokenAsync non funziona.
 */

let lastRegistered: { userId: string; token: string } | null = null;

export async function registerForPush(userId: string): Promise<boolean> {
  if (!userId) return false;
  if (Platform.OS === "web") return false;
  try {
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) {
      if (!perm.canAskAgain) return false;
      const req = await Notifications.requestPermissionsAsync();
      if (!req.granted) return false;
    }
    // Ottieni token nativo (FCM/APNs)
    let tokenResp: { data?: string } | null = null;
    try {
      tokenResp = await Notifications.getDevicePushTokenAsync();
    } catch (e) {
      // In Expo Go / dev-client su iOS senza APNs environment questo throw
      console.warn("[push] getDevicePushTokenAsync failed:", (e as any)?.message || e);
      return false;
    }
    const token = tokenResp?.data;
    if (!token) return false;

    // Evita re-registrazioni duplicate
    if (lastRegistered && lastRegistered.userId === userId && lastRegistered.token === token) {
      return true;
    }
    try {
      await api(`/register-push`, {
        method: "POST",
        body: { user_id: userId, platform: Platform.OS, device_token: token },
      });
      lastRegistered = { userId, token };
      return true;
    } catch (e) {
      console.warn("[push] register-push failed:", (e as any)?.message || e);
      return false;
    }
  } catch (e) {
    console.warn("[push] registerForPush error:", (e as any)?.message || e);
    return false;
  }
}

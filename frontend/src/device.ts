// device.ts — V50.z293 — Identità del dispositivo per il registro «1 telefono + 1 tablet + 1 PC».
// ID stabile: Android ID / iOS identifierForVendor (expo-application); fallback UUID persistito (web: localStorage via AsyncStorage).
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type DeviceInfo = { device_id: string; type: "phone" | "tablet" | "pc"; name: string; platform: string };

const KEY = "advisoros.device.id.v1";
let cached: DeviceInfo | null = null;

/** Listener per il logout forzato quando il server risponde 401 «device_suspended». */
const suspendedListeners = new Set<(reason: string) => void>();
export function onDeviceSuspended(fn: (reason: string) => void): () => void { suspendedListeners.add(fn); return () => { suspendedListeners.delete(fn); }; }
export function emitDeviceSuspended(reason: string): void { suspendedListeners.forEach((l) => { try { l(reason); } catch {} }); }

async function stableId(): Promise<string> {
  try {
    if (Platform.OS === "android") {
      const App = await import("expo-application");
      const id = App.getAndroidId?.();
      if (id) return `and_${id}`;
    } else if (Platform.OS === "ios") {
      const App = await import("expo-application");
      const id = await App.getIosIdForVendorAsync?.();
      if (id) return `ios_${id}`;
    }
  } catch {}
  let id = await AsyncStorage.getItem(KEY);
  if (!id) {
    id = `${Platform.OS === "web" ? "web" : "dev"}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
    await AsyncStorage.setItem(KEY, id);
  }
  return id;
}

export async function getDeviceInfo(): Promise<DeviceInfo> {
  if (cached) return cached;
  const device_id = await stableId();
  let type: DeviceInfo["type"] = "phone";
  let name = "Dispositivo";
  if (Platform.OS === "web") {
    type = "pc";
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
    const os = /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "";
    if (/iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))) type = "tablet";
    else if (/iPhone|Android.*Mobile/.test(ua)) type = "phone";
    name = `${browser} su ${os || "web"}`.trim();
  } else {
    try {
      const Dev = await import("expo-device");
      type = Dev.deviceType === Dev.DeviceType.TABLET ? "tablet" : Dev.deviceType === Dev.DeviceType.DESKTOP ? "pc" : "phone";
      name = [Dev.brand, Dev.modelName].filter(Boolean).join(" ") || (Platform.OS === "ios" ? "iPhone" : "Android");
    } catch { name = Platform.OS === "ios" ? "iPhone" : "Android"; }
  }
  cached = { device_id, type, name: name.slice(0, 80), platform: `${Platform.OS} ${Platform.Version ?? ""}`.trim() };
  return cached;
}

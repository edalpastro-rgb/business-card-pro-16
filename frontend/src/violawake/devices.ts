// devices.ts — V50.z370 — Sistema vocale · Blocco 1: selezione dispositivo (Desktop = web app su PC · Telefono · Tablet).
// Presenza via heartbeat mentre si ascolta; alla wake-word si chiede al server chi deve rispondere.
import { Platform } from "react-native";
import * as Device from "expo-device";
import { api } from "@/src/api";
import { deviceKey } from "@/src/systemHeartbeat";

export type VdKind = "desktop" | "phone" | "tablet";
export type VdWake = { mode: "respond" | "ask" | "silent"; prompt?: string; active_kind?: VdKind | null; options?: string[] };
export type VdSelect = { ok: boolean; message: string; is_me?: boolean; active_kind?: VdKind };

export function deviceKind(): VdKind {
  if (Platform.OS === "web") return "desktop";
  return Device.deviceType === Device.DeviceType.TABLET ? "tablet" : "phone";
}
export const KIND_LABEL: Record<VdKind, string> = { desktop: "Desktop", phone: "Telefono", tablet: "Tablet" };

/** «passa al telefono» / «rispondi dal desktop» / «usa il tablet» → true se è un comando di cambio dispositivo */
export const isSwitchCommand = (t: string): boolean =>
  /\b(passa|passare|sposta|rispondi|usa|vai)\b/i.test(t) && /\b(desktop|computer|pc|portatile|telefono|cellulare|smartphone|tablet|ipad)\b/i.test(t);

export const vdApi = {
  heartbeat: async (listening: boolean) => api("/voice-devices/heartbeat", { method: "POST", body: { device_key: await deviceKey(), kind: deviceKind(), listening } }),
  wake: async () => api<VdWake>("/voice-devices/wake", { method: "POST", body: { device_key: await deviceKey(), kind: deviceKind() } }),
  select: async (transcript: string) => api<VdSelect>("/voice-devices/select", { method: "POST", body: { device_key: await deviceKey(), kind: deviceKind(), transcript } }),
  release: async () => api("/voice-devices/release", { method: "POST", body: { device_key: await deviceKey() } }),
};

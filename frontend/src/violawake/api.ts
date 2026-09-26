// V50.z315 — ViolaWake SDK: chiamate al backend (impostazioni, modulo azienda, routing, eventi).
import { Platform } from "react-native";
import { api } from "@/src/api";
import type { ViolaRoute, ViolaSettings, ViolaSettingsResponse, ViolaEvent } from "./types";

export const violaApi = {
  getSettings: () => api<ViolaSettingsResponse>("/viola-wake/settings"),
  updateSettings: (patch: Partial<ViolaSettings>) => api<ViolaSettingsResponse>("/viola-wake/settings", { method: "PUT", body: patch }),
  setModule: (enabled: boolean, note?: string) => api<{ ok: boolean; module: ViolaSettingsResponse["module"] }>("/viola-wake/module", { method: "PUT", body: { enabled, note } }),
  route: (transcript: string, guard_token?: string, speaker_profile_id?: string | null) => api<ViolaRoute>("/viola-wake/route", { method: "POST", body: { transcript, ...(guard_token ? { guard_token } : {}), ...(speaker_profile_id ? { speaker_profile_id } : {}) } }),
  trigger: (action: string) => api<{ ok: boolean; reply?: string | null; deeplink?: string | null }>("/axon/proactive/trigger", { method: "POST", body: { action, source: "wake_word" } }),
  events: (limit = 30) => api<{ items: ViolaEvent[]; total: number }>(`/viola-wake/events?limit=${limit}`),
  logEvent: (kind: string, extra?: { transcript?: string; detail?: string; engine?: string; latency_ms?: number }) =>
    api("/viola-wake/event", { method: "POST", body: { kind, platform: Platform.OS, ...(extra || {}) } }).catch(() => null),
  tts: (text: string) => api<{ audio_base64: string; mime: string }>("/assistant/tts", { method: "POST", body: { text } }),
};

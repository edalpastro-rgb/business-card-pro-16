// voiceprintApi.ts — V50.z372 — Impronta vocale (Blocchi 2-3): client API + tipi + memoria dell'ultimo parlante riconosciuto.
import { api } from "@/src/api";

export type VpPermissionKey = "briefing" | "chat" | "crm" | "device" | "critical";
export type VpPermissions = Record<VpPermissionKey, boolean>;
export type VpProfile = {
  profile_id: string; name: string; role: "owner" | "secondary"; status: "active" | "paused";
  permissions: VpPermissions; quality?: { speech_sec: number; snr_db: number; consistency: number } | null;
  chunks?: number; created_at?: string; updated_at?: string; last_match_at?: string | null; matches?: number;
};
export type VpStatus = {
  engine_ready: boolean; engine_error?: string | null; ffmpeg: boolean; enabled: boolean; enforced: boolean; threshold: number;
  level: "strict" | "normal" | "tolerant" | "custom"; my_profile: VpProfile | null; profiles_count: number; active_count: number;
  min_speech_sec: number; min_consistency: number; is_master: boolean; permission_keys: VpPermissionKey[]; permission_labels: Record<VpPermissionKey, string>;
};
export type VpQuality = { speech_sec: number; snr_db: number; consistency: number; chunks: number; progress: number; ready: boolean; min_speech_sec: number; min_consistency: number; accepted?: boolean; hint?: string | null };
export type SpeakerInfo = { profile_id: string; name: string; role: "owner" | "secondary"; permissions: Partial<VpPermissions> };

export const vpApi = {
  status: () => api<VpStatus>("/voiceprint/status"),
  warmup: () => api<{ ok: boolean }>("/voiceprint/engine/warmup", { method: "POST" }),
  enrollText: () => api<{ paragraphs: string[]; words: number; estimated_sec: number; min_speech_sec: number }>("/voiceprint/enroll/text"),
  enrollStart: (body: { role: "owner" | "secondary"; name?: string; profile_id?: string }) =>
    api<{ session_id: string; role: string; name: string; paragraphs: string[]; min_speech_sec: number; min_consistency: number }>("/voiceprint/enroll/start", { method: "POST", body }),
  enrollChunk: (session_id: string, audio_base64: string, mime: string) => api<VpQuality>("/voiceprint/enroll/chunk", { method: "POST", body: { session_id, audio_base64, mime } }),
  enrollFinish: (session_id: string) => api<{ ok: boolean; profile: VpProfile; quality: VpQuality; message: string }>("/voiceprint/enroll/finish", { method: "POST", body: { session_id } }),
  profiles: () => api<{ items: VpProfile[]; total: number; permission_keys: VpPermissionKey[]; permission_labels: Record<VpPermissionKey, string> }>("/voiceprint/profiles"),
  patchProfile: (id: string, body: { name?: string; permissions?: Partial<VpPermissions>; status?: "active" | "paused" }) => api<{ ok: boolean; profile: VpProfile }>(`/voiceprint/profiles/${id}`, { method: "PATCH", body }),
  deleteProfile: (id: string) => api<{ ok: boolean }>(`/voiceprint/profiles/${id}`, { method: "DELETE" }),
  settings: (body: { enabled?: boolean; level?: "strict" | "normal" | "tolerant" }) => api<VpStatus>("/voiceprint/settings", { method: "PUT", body }),
};

// Ultimo esito della verifica voce (impostato dalla cattura del comando, letto dal provider).
let last: { speaker: SpeakerInfo | null; unknown: boolean } = { speaker: null, unknown: false };
export function setLastSpeaker(speaker: SpeakerInfo | null | undefined, unknown: boolean) { last = { speaker: speaker || null, unknown }; }
export function takeLastSpeaker() { const l = last; last = { speaker: null, unknown: false }; return l; }

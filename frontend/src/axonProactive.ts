import { router } from "expo-router";
// axonProactive.ts — V50.z196 — Client Blocco 9 (proattività) + ponte "apri la chat con un prompt" (modulo ISOLATO)
//
// openAxonChat(prompt?) è il TRIGGER UNICO lato app: usato dal tap sulle bubble/notifiche e riutilizzabile da un
// segnale vocale esterno (ViolaWake) senza modifiche interne: emette l'evento "axon:open-chat" che il FAB ascolta.
import { DeviceEventEmitter } from "react-native";
import { api } from "@/src/api";

export const AXON_OPEN_CHAT_EVENT = "axon:open-chat";
let pendingPrompt: string | null = null;
let pendingVoice = false; // V50.z315 — ViolaWake: risposta parlata anche se la chat è in modalità testo

export function openAxonChat(prompt?: string | null, opts?: { voice?: boolean }) {
  pendingPrompt = prompt && prompt.trim() ? prompt.trim() : null;
  pendingVoice = !!opts?.voice && !!pendingPrompt;
  DeviceEventEmitter.emit(AXON_OPEN_CHAT_EVENT, { prompt: pendingPrompt, voice: pendingVoice });
}

/** Letto UNA volta dal modal chat quando si apre: se c'è un prompt in attesa lo invia. */
export function consumePendingPrompt(): string | null {
  const p = pendingPrompt; pendingPrompt = null; return p;
}

/** Letto insieme al prompt: true se la risposta va anche letta a voce (comando vocale ViolaWake). */
export function consumePendingVoice(): boolean {
  const v = pendingVoice; pendingVoice = false; return v;
}

export type ProactiveAction = { label: string; prompt?: string; route?: string };
export type ProactiveItem = {
  item_id: string; kind: "briefing" | "suggestion" | "alert" | "weekly"; type: string; type_label: string; title: string; body: string;
  chat_text: string; actions: ProactiveAction[]; deeplink: string; source: string; created_at: string;
  read_at?: string | null; dismissed_at?: string | null; responded_at?: string | null; push_status?: string | null;
};
export type ProactiveConfig = {
  briefing_enabled: boolean; briefing_time: string; briefing_days: number[]; weekly_report_enabled: boolean; weekly_report_time: string;
  max_suggestions_per_day: number; quiet_start: string; quiet_end: string; inactive_days: number; deadline_hours: number; callback_overdue_hours: number;
  contract_days: number; anomaly_pct: number; goal_alert_pct: number; weekly_targets: Record<string, number>; alerts: Record<string, boolean>;
  team_max_suggestions_per_day: number; is_master: boolean; effective_max_suggestions_per_day: number; type_labels: Record<string, string>;
};
export type ProactiveReminder = { reminder_id: string; text: string; due_at: string; status: string; origin: string };

export const proactiveApi = {
  config: () => api<ProactiveConfig>("/axon/proactive/config"),
  saveConfig: (body: Partial<ProactiveConfig>) => api<ProactiveConfig>("/axon/proactive/config", { method: "PUT", body }),
  trigger: (action: "briefing" | "weekly_report" | "scan" | "open", source = "manual", item_id?: string) =>
    api<{ ok: boolean; item: ProactiveItem | null; reply: string | null; deeplink: string }>("/axon/proactive/trigger", { method: "POST", body: { action, source, item_id } }),
  items: (opts?: { limit?: number; home?: boolean }) => api<{ items: ProactiveItem[] }>("/axon/proactive/items", { query: { limit: opts?.limit ?? 30, home: opts?.home ? "true" : undefined } }),
  item: (id: string) => api<ProactiveItem>(`/axon/proactive/items/${id}`),
  dismissAll: () => api<{ ok: boolean; dismissed: number }>("/axon/proactive/items/dismiss-all", { method: "POST" }), // V50.z233
  act: (id: string, action: "dismiss" | "respond" | "read") => api<{ ok: boolean }>(`/axon/proactive/items/${id}/${action}`, { method: "POST" }),
  reminders: () => api<{ items: ProactiveReminder[] }>("/axon/proactive/reminders"),
  addReminder: (text: string, due_at: string) => api<{ ok: boolean }>("/axon/proactive/reminders", { method: "POST", body: { text, due_at } }),
  delReminder: (id: string) => api<{ ok: boolean }>(`/axon/proactive/reminders/${id}`, { method: "DELETE" }),
};

/** Tap/voce su un suggerimento: segna "risposto" e apre la chat con il prompt dell'azione (o il testo del suggerimento). */
export function respondToItem(item: ProactiveItem, action?: ProactiveAction) {
  proactiveApi.act(item.item_id, "respond").catch(() => {});
  // V50.z231 — azione con `route` → navigazione diretta (es. «Aggiorna le schede» → /le-mie-aree); altrimenti prompt in chat
  const a = action || item.actions?.[0];
  if (a?.route) { router.push(a.route as any); return; }
  openAxonChat(a?.prompt || `Riguardo a: ${item.title}`);
}

export const KIND_ICON: Record<string, string> = { briefing: "sunny", suggestion: "bulb", alert: "warning", weekly: "calendar" };
export const KIND_COLOR: Record<string, string> = { briefing: "#F59E0B", suggestion: "#7C3AED", alert: "#DC2626", weekly: "#0EA5E9" };

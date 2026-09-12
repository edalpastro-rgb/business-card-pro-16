// Notifiche push AxonOS (V50.z181) — client API + hook badge (icona app + drawer).
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { api } from "@/src/api";

export type AxnKind = "cgym_due" | "callback_urgent" | "credits" | "weekly_report" | "axon_message" | "reminder"
  | "proactive_briefing" | "proactive_suggestion" | "proactive_alert" | "proactive_weekly"; // V50.z196 — Blocco 9 proattività

export type AxnNotification = {
  notif_id: string; tenant_id: string; user_id: string; kind: AxnKind; title: string; body: string;
  data: { deeplink?: string; [k: string]: any }; created_at: string; read: boolean; read_at: string | null;
  push_sent: boolean; team_copy_of?: string | null;
};

export type AxnPrefs = {
  user_id: string; enabled: boolean; kinds: Record<AxnKind, boolean>; team_copies: boolean; credits_plan_monthly: number;
  kinds_labels: Record<AxnKind, string>; is_owner: boolean; credits_used_month?: number;
};

export const axnApi = {
  list: (unreadOnly = false) => api<{ items: AxnNotification[]; unread: number }>(`/axon-notifications`, { query: { unread_only: unreadOnly ? "true" : undefined, limit: 100 } }),
  unread: () => api<{ unread: number }>("/axon-notifications/unread-count"),
  read: (id: string) => api<{ unread: number }>(`/axon-notifications/${id}/read`, { method: "POST" }),
  readAll: () => api<{ unread: number }>("/axon-notifications/read-all", { method: "POST" }),
  remove: (id: string) => api<{ unread: number }>(`/axon-notifications/${id}`, { method: "DELETE" }),
  prefs: () => api<AxnPrefs>("/axon-notifications/prefs"),
  setPrefs: (body: Partial<Pick<AxnPrefs, "enabled" | "kinds" | "team_copies" | "credits_plan_monthly">>) => api<AxnPrefs>("/axon-notifications/prefs", { method: "PUT", body }),
  test: () => api<{ ok: boolean; push_configured: boolean }>("/axon-notifications/test", { method: "POST" }),
};

export const AXN_KIND_ICON: Record<AxnKind, string> = {
  cgym_due: "barbell", callback_urgent: "call", credits: "flash", weekly_report: "stats-chart", axon_message: "sparkles", reminder: "alarm",
  proactive_briefing: "sunny", proactive_suggestion: "bulb", proactive_alert: "warning", proactive_weekly: "calendar", // V50.z196
};

/** Aggiorna il badge sull'icona dell'app (solo nativo). */
export async function setAppBadge(n: number) {
  if (Platform.OS === "web") return;
  try { await Notifications.setBadgeCountAsync(Math.max(0, n)); } catch { /* ignore */ }
}

/**
 * Conteggio non lette: refresh all'avvio, ogni 60s, al ritorno in foreground e quando arriva una push.
 * Sincronizza il badge dell'icona app.
 */
export function useAxnUnread(enabled = true) {
  const [unread, setUnread] = useState(0);
  const timer = useRef<any>(null);
  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const r = await axnApi.unread();
      setUnread(r.unread || 0);
      setAppBadge(r.unread || 0);
    } catch { /* offline: mantieni valore */ }
  }, [enabled]);
  useEffect(() => {
    if (!enabled) return;
    refresh();
    timer.current = setInterval(refresh, 60000);
    const appSub = AppState.addEventListener("change", (st) => { if (st === "active") refresh(); });
    let pushSub: { remove: () => void } | null = null;
    if (Platform.OS !== "web") {
      pushSub = Notifications.addNotificationReceivedListener((n) => {
        const b = Number((n?.request?.content?.data as any)?.badge);
        if (Number.isFinite(b)) { setUnread(b); setAppBadge(b); } else refresh();
      });
    }
    return () => { if (timer.current) clearInterval(timer.current); appSub.remove(); pushSub?.remove(); };
  }, [enabled, refresh]);
  return { unread, refresh, setUnread: (n: number) => { setUnread(n); setAppBadge(n); } };
}

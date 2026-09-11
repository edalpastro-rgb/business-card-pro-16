// Corporate Gym — client API + tipi (Blocco 1). Modulo isolato.
import { api } from "@/src/api";

export type CgymType = "obiezioni" | "winwin";
export type CgymStatus = "assegnata" | "in_corso" | "completata";

export type CgymSession = {
  session_id: string;
  tenant_id: string;
  user_id: string;
  user_name?: string;
  assigned_by: string;
  type: CgymType;
  title: string;
  scheduled_at: string; // ISO UTC
  status: CgymStatus;
  mandatory: boolean;
  score: number | null;
  created_at: string;
  completed_at: string | null;
};

export type CgymSummary = {
  due_soon: CgymSession[];
  due_soon_count: number;
  today_total: number;
  today_done: number;
  mandatory_pending: number;
  overdue: number;
  server_time: string;
};

export type CgymTeamRow = {
  user_id: string;
  name: string;
  role?: string;
  assegnata: number;
  in_corso: number;
  completata: number;
  mandatory_pending: number;
  avg_score: number | null;
};

export const CGYM_HEADER_IMAGE =
  "https://customer-assets-rejwkqb3.emergentagent.net/wingman/96afd50f-e973-4b52-8752-8e66a92b8a17/attachments/1d79424d611e4599b47c114b70799652_2-cropped.png";

export const CGYM_ORANGE = "#F97316";

export const CGYM_TYPE_META: Record<CgymType, { label: string; icon: "chatbubble-ellipses" | "handshake" | "people"; color: string; route: string }> = {
  obiezioni: { label: "Gym Obiezioni", icon: "chatbubble-ellipses", color: "#DC2626", route: "/corporate-gym/obiezioni" },
  winwin: { label: "Gym WIN-WIN", icon: "people", color: "#0F9D58", route: "/corporate-gym/win-win" },
};

export const cgymApi = {
  summary: () => api<CgymSummary>("/cgym/summary"),
  list: (q: { scope?: "mine" | "team"; type?: CgymType; status?: CgymStatus } = {}) =>
    api<{ items: CgymSession[] }>("/cgym/sessions", { query: q as any }),
  create: (body: { type: CgymType; scheduled_at: string; user_id?: string; title?: string; mandatory?: boolean }) =>
    api<CgymSession>("/cgym/sessions", { method: "POST", body }),
  update: (id: string, body: Partial<Pick<CgymSession, "status" | "score" | "scheduled_at" | "title" | "mandatory">>) =>
    api<CgymSession>(`/cgym/sessions/${id}`, { method: "PATCH", body }),
  remove: (id: string) => api<{ ok: boolean }>(`/cgym/sessions/${id}`, { method: "DELETE" }),
  teamOverview: () => api<{ items: CgymTeamRow[] }>("/cgym/team-overview"),
};

export function fmtCgymDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const hhmm = d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return `Oggi · ${hhmm}`;
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  if (d.toDateString() === tomorrow.toDateString()) return `Domani · ${hhmm}`;
  return `${d.toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "short" })} · ${hhmm}`;
}

export function isPast(iso: string): boolean {
  const t = new Date(iso).getTime();
  return !isNaN(t) && t < Date.now();
}

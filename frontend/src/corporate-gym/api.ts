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
  assigned_total: number; // Blocco 3 — assegnate dal Master
  assigned_done: number;
  assigned_pending: number;
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

// Icone ufficiali delle due aree (immagini fornite dall'utente); `icon` Ionicons resta come fallback/righe compatte.
export const CGYM_TYPE_META: Record<CgymType, { label: string; icon: "chatbubble-ellipses" | "handshake" | "people"; color: string; route: string; image: string }> = {
  obiezioni: {
    label: "Gym Obiezioni", icon: "chatbubble-ellipses", color: "#DC2626", route: "/corporate-gym/obiezioni",
    image: "https://customer-assets-rejwkqb3.emergentagent.net/wingman/96afd50f-e973-4b52-8752-8e66a92b8a17/attachments/3efe302090d947e78e18f1eda6137539_obbiezioni%20logo2_0.png",
  },
  winwin: {
    label: "Gym WIN-WIN", icon: "people", color: "#0F9D58", route: "/corporate-gym/win-win",
    image: "https://customer-assets-rejwkqb3.emergentagent.net/wingman/96afd50f-e973-4b52-8752-8e66a92b8a17/attachments/7644430fa87e47c2a2b4b8a139f64318_logo%20winwin.png",
  },
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

// ---------------- Blocco 2 — Role-play vocale ----------------
export type CgymMood = "chiuso" | "scettico" | "aperto" | "convinto";
export type CgymRoleplayTurnOut = {
  transcript?: string;
  reply: string;
  mood: CgymMood;
  audio_base64: string | null;
  audio_mime: string;
  turn: number;
  max_turns: number;
  ended: boolean;
};
export type CgymRoleplayStartOut = CgymRoleplayTurnOut & { roleplay_id: string; scenario: string; scenario_label: string };
export type CgymFeedback = {
  score: number;
  summary: string;
  what_worked: string[];
  to_improve: string[];
  best_line: string;
  suggested_answer: string;
};
export type CgymRoleplay = {
  roleplay_id: string;
  session_id: string | null;
  scenario: string;
  status: "active" | "finished";
  turns: { role: "cliente" | "consulente"; text: string; mood?: CgymMood; at: string }[];
  score: number | null;
  feedback: CgymFeedback | null;
};

export const cgymRoleplayApi = {
  start: (body: { session_id?: string; scenario?: "tempo"; tts?: boolean }) =>
    api<CgymRoleplayStartOut>("/cgym/roleplay/start", { method: "POST", body }),
  turn: (id: string, body: { audio_base64?: string; mime?: string; text?: string; tts?: boolean }) =>
    api<CgymRoleplayTurnOut>(`/cgym/roleplay/${id}/turn`, { method: "POST", body }),
  finish: (id: string) => api<CgymRoleplay>(`/cgym/roleplay/${id}/finish`, { method: "POST" }),
  get: (id: string) => api<CgymRoleplay>(`/cgym/roleplay/${id}`),
};

export const CGYM_MOOD_META: Record<CgymMood, { label: string; color: string }> = {
  chiuso: { label: "Chiuso", color: "#DC2626" },
  scettico: { label: "Scettico", color: "#F59E0B" },
  aperto: { label: "Aperto", color: "#0EA5E9" },
  convinto: { label: "Convinto", color: "#0F9D58" },
};

// ---------------- Blocco 3 — Assegnazioni Master ----------------
export type CgymAssignment = {
  assignment_id: string;
  target: "team" | "users";
  user_ids: string[];
  user_names: string[];
  type: CgymType;
  title: string;
  per_day: number;
  due_date: string; // YYYY-MM-DD
  mandatory: boolean;
  sessions_total: number;
  sessions_done: number;
  per_user?: { user_id: string; name: string; total: number; done: number }[];
  overdue?: boolean;
  created_at: string;
};

export const cgymAssignApi = {
  create: (body: { target: "team" | "users"; user_ids?: string[]; type: CgymType; per_day: number; due_date: string; title?: string }) =>
    api<CgymAssignment>("/cgym/assignments", { method: "POST", body }),
  list: () => api<{ items: CgymAssignment[] }>("/cgym/assignments"),
  remove: (id: string) => api<{ ok: boolean; deleted_sessions: number }>(`/cgym/assignments/${id}`, { method: "DELETE" }),
};

export function toYMD(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

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
  phase?: string | null;
  ended: boolean;
};
export type CgymRoleplayStartOut = CgymRoleplayTurnOut & { roleplay_id: string; scenario: string; scenario_label: string; area: CgymType; duration_min: number; started_at: string };

// Blocco 5 — scenari role-play
export type CgymScenarioKey = "tempo" | "costo" | "decisore" | "winwin";
export const CGYM_SCENARIO_META: Record<CgymScenarioKey, { label: string; short: string; area: CgymType; duration_min: number; max_turns: number; icon: "time" | "cash" | "people-circle" | "handshake" | "briefcase"; customer: string; description: string; tips: string[] }> = {
  tempo: {
    label: "Obiezione TEMPO", short: "TEMPO", area: "obiezioni", duration_min: 5, max_turns: 5, icon: "time",
    customer: "Marco, titolare di un'officina",
    description: "Hai appena proposto un'analisi delle bollette: il cliente non ha tempo e rimanda. Gestisci l'obiezione come faresti al telefono.",
    tips: ["Riconosci l'obiezione senza contrastarla", "Quantifica il tempo che chiedi e il beneficio", "Proponi uno slot preciso e breve"],
  },
  costo: {
    label: "Obiezione COSTO", short: "COSTO", area: "obiezioni", duration_min: 5, max_turns: 5, icon: "cash",
    customer: "Giuseppe, titolare di un bar-pasticceria",
    description: "La proposta gli sembra cara e il fornitore attuale promette un prezzo migliore: chiede subito uno sconto.",
    tips: ["Chiedi cosa sta confrontando davvero", "Sposta dal prezzo unitario al costo totale annuo e al valore", "Niente sconti immediati: concessioni solo in cambio di qualcosa"],
  },
  decisore: {
    label: "Obiezione DECISORE", short: "DECISORE", area: "obiezioni", duration_min: 5, max_turns: 5, icon: "people-circle",
    customer: "Laura, responsabile amministrativa di uno studio dentistico",
    description: "\"Devo parlarne con il dottore, non decido io.\" Rispetta il suo ruolo e porta la trattativa al decisore senza scavalcarla.",
    tips: ["Capisci come si decide davvero: chi, quando, con quali criteri", "Aiutala a presentare la proposta (sintesi e numeri)", "Proponi un incontro a tre con data e ora"],
  },
  winwin: {
    label: "Trattativa WIN-WIN", short: "WIN-WIN", area: "winwin", duration_min: 45, max_turns: 30, icon: "briefcase",
    customer: "Elena Rossi, direttrice acquisti di una PMI con 3 supermercati (≈180.000 €/anno di energia)",
    description: "Sessione completa da 45 minuti: trattativa integrata sul contratto di fornitura (prezzo, durata, pagamento, servizi, green). Elena chiede il prezzo più basso e uscita libera, ma ha interessi nascosti da scoprire.",
    tips: ["Fase 1-2: clima e domande aperte per scoprire gli interessi reali", "Fase 3: crea opzioni e pacchetti, allarga la torta oltre il prezzo", "Fase 4: scambia concessioni (\"se... allora\"), mai regali", "Fase 5: sintesi e accordo concreto su prezzo, durata, pagamento"],
  },
};
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
  start: (body: { session_id?: string; scenario?: CgymScenarioKey; tts?: boolean }) =>
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

// ---------------- Blocco 4 — Dashboard statistiche Master ----------------
export type CgymCriterion = { key: string; label: string; count: number };
export type CgymAgentStats = {
  user_id: string;
  name: string;
  role?: string;
  rank: number;
  assigned_total: number;
  assigned_done: number;
  self_total: number;
  completed_total: number;
  overdue: number;
  roleplays: number;
  avg_score: number | null;
  last_score: number | null;
  best_score: number | null;
  trend: number | null;
  completion_rate: number | null;
  convinto_rate: number | null;
  timeline: { date: string; at: string; score: number }[];
  strengths: CgymCriterion[];
  weaknesses: CgymCriterion[];
  by_type: Record<string, { total: number; done: number }>;
};
export type CgymStats = {
  days: number;
  generated_at: string;
  team: {
    agents: number;
    active_agents: number;
    assigned_total: number;
    assigned_done: number;
    completion_rate: number | null;
    completed_total: number;
    overdue: number;
    avg_score: number | null;
    roleplays: number;
    weekly: { week: string; avg: number; n: number }[];
    weaknesses: CgymCriterion[];
    strengths: CgymCriterion[];
  };
  agents: CgymAgentStats[];
};
export type CgymAgentFeedback = {
  character: string;
  where_to_improve: string[];
  corrective_actions: string[];
  strengths: string[];
  encouragement: string;
  suggested_focus: string;
};
export type CgymWeeklyReport = {
  headline: string;
  team_gaps: string[];
  highlights: string[];
  agents_to_watch: string[];
  new_scenarios: { title: string; objection: string; why: string }[];
  manual_updates: string[];
  next_week_plan: string;
};
export type CgymAiReport<T> = { report_id?: string; generated_at?: string; week?: string; content: T | null };

export const cgymStatsApi = {
  stats: (days: number) => api<CgymStats>("/cgym/stats", { query: { days } as any }),
  agentFeedback: (id: string, force = false) =>
    api<CgymAiReport<CgymAgentFeedback>>(`/cgym/stats/agent-feedback/${id}`, { method: "POST", query: { force: force ? "true" : "false" } as any }),
  agentFeedbackGet: (id: string) => api<CgymAiReport<CgymAgentFeedback>>(`/cgym/stats/agent-feedback/${id}`),
  weekly: (force = false) => api<CgymAiReport<CgymWeeklyReport>>("/cgym/stats/weekly-report", { method: "POST", query: { force: force ? "true" : "false" } as any }),
  weeklyGet: () => api<CgymAiReport<CgymWeeklyReport>>("/cgym/stats/weekly-report"),
};

// areasApi.ts — V50.z365 — Corporate Gym: aree dinamiche, materiali, registrazioni trattativa, sessione live, valutazioni.
import { api, apiUpload } from "@/src/api";

export type CgaArea = {
  area_id: string; key: string; name: string; color: string; route: string | null; builtin: boolean; order: number; description: string;
  blocks: string[]; image: string | null; logo_b64: string | null; materials: number; references: number; my_sessions: number; my_last_rating: string | null;
};
export type CgaMaterial = { material_id: string; name: string; mime: string; size: number; created_at: string };
export type CgaReference = { ref_id: string; title: string; notes: string; kind: "audio" | "video"; mime: string; size: number; created_at: string; compressing?: boolean; compressed?: boolean; transcript_id?: string | null };
export type Tone = "green" | "blue" | "red";
export type CgaTurn = { role: "client" | "consultant"; text: string; tone?: Tone; tone_segments?: { tone: Tone; pct: number }[]; hesitation?: boolean; hint?: string | null; block_idx: number; distacco?: number; distacco_color?: "verde" | "blu" | "rosso"; interventions?: { tipo: string; correzione: string }[] };
export type CgaLevel = "base" | "medio" | "esperto";
export const CGA_LEVEL_LABEL: Record<CgaLevel, string> = { base: "BASE", medio: "MEDIO", esperto: "ESPERTO" };
export const CGA_LEVEL_HINT: Record<CgaLevel, string> = {
  base: "Axon ascolta il 90% del tempo: interviene solo su errori gravi di dati o uscite totali dal tema.",
  medio: "Axon interviene al 50%: dati inventati, dati errati e perdita del filo logico.",
  esperto: "Axon interviene su ogni errore, uscita dal filo logico e imprecisione rispetto alla presentazione di riferimento.",
};
export const DISTACCO_COLOR: Record<string, string> = { verde: "#22C55E", blu: "#3B82F6", rosso: "#EF4444" };
export type CgaSession = {
  session_id: string; area_id: string; area_name: string; blocks: string[]; block_idx: number; repeats: number; status: "live" | "done"; source: "live" | "recording";
  turns: CgaTurn[]; score: number | null; rating: string | null; tone_mix?: Record<Tone, number>;
  // V50.z387 — addestramento a tre livelli + parametri Manuale Unico
  training_level?: CgaLevel; params?: Record<"tono" | "obiezioni" | "invito_azione" | "distacco" | "dati" | "filo_logico", number>; distacco_color?: "verde" | "blu" | "rosso";
  tono_giudizio?: string; interventions?: { quando: string; tipo: string; correzione: string }[];
  feedback?: { summary: string; good: string[]; redo: string[]; per_block: { block: string; score: number; note: string }[] } | null; manager_report?: string | null; audio_base64?: string | null;
};
export type CgaIntervention = { tipo: string; gravita?: string; correzione: string; quando?: string; block?: string };
export type CgaTurnOut = { ok: boolean; reason?: string; message?: string; transcript?: string; reply?: string; audio_base64?: string | null; tone?: Tone; tone_segments?: { tone: Tone; pct: number }[]; hesitation?: boolean; hesitation_reason?: string | null; hint?: string | null; action?: "continue" | "repeat" | "correct" | "next_block" | "all_done"; block_idx?: number; blocks?: string[];
  // V50.z388 — distacco in tempo reale + interventi di Axon filtrati per livello
  distacco?: number; distacco_color?: DistaccoColor; interventions?: CgaIntervention[]; training_level?: CgaLevel };
export type DistaccoColor = "verde" | "blu" | "rosso";
export const DISTACCO_LABEL: Record<DistaccoColor, string> = { verde: "Distacco corretto", blu: "Troppo coinvolto emotivamente", rosso: "Distacco perso" };
export type CgaRatingRow = { user_id: string; user_name: string; area_id: string; area_name: string; history: { session_id: string; date: string; score: number | null; rating: string | null; source: string }[]; last_score: number | null; last_rating: string | null; avg_score: number | null; avg_rating: string | null; trend: number | null; needs_intervention: boolean };

export const TONE_COLOR: Record<Tone, string> = { green: "#16A34A", blue: "#0EA5E9", red: "#DC2626" };
export const TONE_LABEL: Record<Tone, string> = { green: "Rapport / obiezione", blue: "Spiegazione", red: "Distacco / incalzare" };
export const RATING_COLOR: Record<string, string> = { OSCENO: "#DC2626", MEDIOCRE: "#F97316", DOVERE: "#EAB308", ECCELLENTE: "#16A34A" };

export const cgaApi = {
  areas: () => api<{ items: CgaArea[]; is_master: boolean }>("/cgym/areas"),
  create: (body: { name: string; description?: string; blocks?: string[]; logo_b64?: string }) => api<CgaArea>("/cgym/areas", { method: "POST", body }),
  update: (id: string, body: { name?: string; description?: string; blocks?: string[]; logo_b64?: string | null }) => api<CgaArea>(`/cgym/areas/${id}`, { method: "PATCH", body }),
  materials: (id: string) => api<{ items: CgaMaterial[] }>(`/cgym/areas/${id}/materials`),
  addMaterial: (id: string, body: { name: string; mime: string; data_base64: string }) => api<CgaMaterial>(`/cgym/areas/${id}/materials`, { method: "POST", body }),
  materialContent: (id: string, mid: string) => api<{ name: string; mime: string; data_base64: string }>(`/cgym/areas/${id}/materials/${mid}/content`),
  delMaterial: (id: string, mid: string) => api(`/cgym/areas/${id}/materials/${mid}`, { method: "DELETE" }),
  references: (id: string) => api<{ items: CgaReference[] }>(`/cgym/areas/${id}/references`),
  addReference: (id: string, form: FormData) => apiUpload<CgaReference>(`/cgym/areas/${id}/references`, form),
  referenceLink: (rid: string) => api<{ url: string; mime: string; kind: string }>(`/cgym/references/${rid}/link`, { method: "POST" }),
  delReference: (rid: string) => api(`/cgym/references/${rid}`, { method: "DELETE" }),
  liveStart: (area_id: string, training_level?: CgaLevel) => api<CgaSession>("/cgym/live/start", { method: "POST", body: { area_id, training_level } }),
  liveTurn: (sid: string, body: { audio_base64?: string; mime?: string; text?: string; tts?: boolean }) => api<CgaTurnOut>(`/cgym/live/${sid}/turn`, { method: "POST", body }),
  liveFinish: (sid: string) => api<CgaSession>(`/cgym/live/${sid}/finish`, { method: "POST" }),
  fromRecording: (body: { area_id: string; audio_base64: string; mime: string; title?: string; training_level?: CgaLevel }) => api<CgaSession>("/cgym/live/from-recording", { method: "POST", body }),
  ratings: (q: { user_id?: string; area_id?: string } = {}) => api<{ items: CgaRatingRow[]; is_master: boolean }>("/cgym/ratings", { query: q as any }),
};

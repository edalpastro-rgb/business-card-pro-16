// src/utils/beta.ts — V50.z474 — Beta sul campo: tracciamento eventi d'uso (fire-and-forget) per il cruscotto Master.
// Eventi: app_open (1/giorno, dedup lato server) · pun_history · scanner · voice_message · stt_error · nps_shown · axon_appointment {ms}.
import { api } from "@/src/api";

export type BetaEvent = "app_open" | "pun_history" | "scanner" | "voice_message" | "stt_error" | "nps_shown" | "axon_appointment";

let lastAppOpenDay = "";

export function track(name: BetaEvent, meta?: Record<string, string | number | boolean>): void {
  if (name === "app_open") {
    const day = new Date().toISOString().slice(0, 10);
    if (lastAppOpenDay === day) return;
    lastAppOpenDay = day;
  }
  api("/beta/event", { method: "POST", body: { name, meta } }).catch(() => {});
}

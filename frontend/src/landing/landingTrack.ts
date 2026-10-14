// landingTrack.ts — V50.z551 — Statistiche landing: contatore anonimo giornaliero (visite + click) → POST /public/landing/track.
// Nessun dato personale, nessun cookie. Fire-and-forget: non deve mai rallentare o rompere la pagina.
import { BACKEND_URL } from "@/src/api";

export type TrackPage = "home" | "axon" | "advisor";
export type TrackEvent = "view" | "cta_register" | "cta_axonos" | "cta_advisoros" | "onboarding_open" | "compare_open" | "cta_quote" | "video_play";

export function trackLanding(page: TrackPage, event: TrackEvent) {
  try {
    fetch(`${BACKEND_URL}/api/public/landing/track`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ page, event, src: "app" }), keepalive: true } as any).catch(() => {});
  } catch { /* noop */ }
}

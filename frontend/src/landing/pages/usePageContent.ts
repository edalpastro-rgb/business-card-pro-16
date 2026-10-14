// usePageContent.ts — V50.z546 — Contenuti delle pagine di approfondimento (/landing/axonos · /landing/advisoros) dal CMS:
// GET /public/landing/page/{slug} → { page, plans, seats }. Stesso singleton della landing: ogni testo si modifica da /admin/landing-cms.
import { useEffect, useState } from "react";
import { BACKEND_URL } from "@/src/api";

export type Seats = { limit: number; taken: number; left: number };
export type PagePlan = { badge: string; name: string; price_old: number; price: number; limit: number; features: string[]; cta: string };
export type PageData<P> = { slug: string; page: P; plans: { builder: PagePlan; professional: PagePlan }; seats: { builder: Seats; professional: Seats } };

export const fmtPrice = (n: number) => (Number.isInteger(n) ? `${n}€` : `${n.toFixed(2).replace(".", ",")}€`);

/** Sostituisce {left} {limit} {taken} {price} {price_old} nei testi del CMS. */
export function fillVars(text: string | undefined, seats?: Seats, plan?: PagePlan): string {
  return String(text || "").replace(/\{(left|limit|taken|price|price_old)\}/g, (_, k) => {
    if (k === "price") return plan ? fmtPrice(plan.price) : "";
    if (k === "price_old") return plan ? fmtPrice(plan.price_old) : "";
    const v = seats ? (seats as any)[k] : undefined;
    return v == null ? "" : String(v);
  });
}

export function usePageContent<P>(slug: "axon" | "advisor") {
  const [data, setData] = useState<PageData<P> | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => fetch(`${BACKEND_URL}/api/public/landing/page/${slug}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => { if (alive) { setData(j); setFailed(false); } }).catch(() => { if (alive) setFailed((f) => f || true); });
    load();
    const t = setInterval(load, 60_000); // posti Founder «in tempo reale»
    return () => { alive = false; clearInterval(t); };
  }, [slug]);
  return { data, failed: failed && !data };
}

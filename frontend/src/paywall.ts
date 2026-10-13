// paywall.ts — V50.z330 — Stato «abbonamento scaduto»: il backend risponde 402 subscription_expired su tutte le API
// principali; `api()` emette l'evento, `PaywallGuard` (in _layout) porta l'utente su /paywall.
import { useEffect, useRef } from "react";
import { usePathname, router } from "expo-router";
import { api } from "@/src/api";
import { onSubscriptionExpired } from "@/src/paywallEvents";

/** Rotte raggiungibili anche con abbonamento scaduto (blocco, codici, logout, auth). */
export const PAYWALL_ALLOWED = ["/paywall", "/login", "/auth", "/2fa", "/verify", "/faq", "/help-center", "/index", "/"];
export function isPaywallAllowed(pathname: string | null | undefined): boolean {
  const p = pathname || "/";
  return PAYWALL_ALLOWED.some((a) => p === a || p.startsWith(a + "/")) || p.startsWith("/impostazioni");
}

export type SubscriptionState = { status: string; expires_at: string | null; days_left: number | null; is_active: boolean };

/** Hook montato una volta in _layout: controlla lo stato al login e reagisce al 402. */
export function usePaywallGuard(userId: string | undefined) {
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  const goingRef = useRef(false);

  const go = () => {
    if (goingRef.current || isPaywallAllowed(pathRef.current)) return;
    goingRef.current = true;
    router.replace("/paywall" as any);
    setTimeout(() => { goingRef.current = false; }, 1500);
  };

  useEffect(() => onSubscriptionExpired(go), []);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    api<SubscriptionState>("/subscription/status").then((s) => { if (alive && s?.status === "expired") go(); }).catch(() => {});
    return () => { alive = false; };
  }, [userId]);
}

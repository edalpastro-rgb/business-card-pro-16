// V50.z334 — Tema della Home/Contatti · V50.z338/z339 — derivato dal TEMA ATTIVO (Luce · Pearl · Slate · Midnight, src/themes.ts).
// Le chiavi restano quelle usate da Home, Contatti, Calendario, Help: cambiando tema cambia tutto in cascata
// (equivalente RN delle CSS variables: la palette è risolta al boot e ogni StyleSheet la eredita).
import { ACTIVE } from "@/src/themes";

const hexA = (hex: string, a: number) => {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

const isDark = ACTIVE.isDark;
const pearl = ACTIVE.id === "pearl"; // accenti sobri/desaturati per categoria

export const HT = {
  bg: ACTIVE.bg,
  card: ACTIVE.card,
  card2: ACTIVE.card2,
  border: ACTIVE.border,
  borderStrong: ACTIVE.borderStrong,
  text: ACTIVE.text,
  text2: ACTIVE.text2,
  muted: ACTIVE.muted,
  white: "#FFFFFF",
  radius: ACTIVE.radius,
  // accenti
  brand: ACTIVE.accent,
  brandDeep: ACTIVE.accentDeep,
  brandTint: hexA(ACTIVE.accent, isDark ? 0.18 : 0.12),
  brandLine: hexA(ACTIVE.accent, 0.45),
  axon: ACTIVE.accent2,
  axonTint: hexA(ACTIVE.accent2, isDark ? 0.16 : 0.12),
  axonLine: hexA(ACTIVE.accent2, 0.45),
  violet: isDark ? "#A78BFA" : "#7C3AED",
  violetTint: isDark ? "rgba(167,139,250,0.16)" : "rgba(124,58,237,0.10)",
  success: isDark ? "#4ADE80" : pearl ? "#4f9d7a" : "#16A34A",
  successTint: isDark ? "rgba(74,222,128,0.14)" : pearl ? "rgba(79,157,122,0.12)" : "rgba(22,163,74,0.10)",
  danger: isDark ? "#F87171" : pearl ? "#c76b6b" : "#DC2626",
  dangerTint: isDark ? "rgba(248,113,113,0.16)" : pearl ? "rgba(199,107,107,0.12)" : "rgba(220,38,38,0.10)",
  warning: isDark ? "#FBBF24" : pearl ? "#d0955a" : "#D97706",
  warningTint: isDark ? "rgba(251,191,36,0.16)" : pearl ? "rgba(208,149,90,0.14)" : "rgba(217,119,6,0.12)",
  // riga/pill trasparenti su card
  glass: ACTIVE.glass,
  glassStrong: ACTIVE.glassStrong,
  // bottom nav
  nav: ACTIVE.nav,
  navActive: ACTIVE.navActive,
  navInactive: ACTIVE.navInactive,
  isDark,
  // Pearl: card con ombra morbida (0 2px 12px rgba(0,0,0,0.08)) e zero bordi netti — negli altri temi oggetto vuoto
  cardShadow: (ACTIVE.shadow
    ? { shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 2 }, elevation: 3 }
    : {}) as { shadowColor?: string; shadowOpacity?: number; shadowRadius?: number; shadowOffset?: { width: number; height: number }; elevation?: number },
  navShadow: (ACTIVE.shadow
    ? { shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: -2 }, elevation: 6 }
    : {}) as Record<string, unknown>,
};

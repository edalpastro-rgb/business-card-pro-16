// V50.z334 — Tema DARK/PREMIUM della Home, derivato dalla palette della landing (src/landing/palette.ts)
// così Home e sito pubblico parlano lo stesso linguaggio visivo: navy profondo, card con bordi sottili,
// arancio «OS» per le azioni primarie, ciano AxonOS per l'intelligenza, verde/rosso/ambra vivaci e leggibili.
import { LP } from "@/src/landing/palette";

export const HT = {
  bg: LP.surface,
  card: LP.surface2,
  card2: LP.surface3,
  border: LP.border,
  borderStrong: LP.borderStrong,
  text: LP.onSurface,
  text2: LP.onSurface2,
  muted: LP.muted,
  white: "#FFFFFF",
  // accenti
  brand: LP.brand,
  brandDeep: LP.brandDeep,
  brandTint: "rgba(249,115,22,0.16)",
  brandLine: LP.brandLine,
  axon: LP.axon,
  axonTint: "rgba(56,189,248,0.14)",
  axonLine: LP.axonLine,
  violet: "#A78BFA",
  violetTint: "rgba(167,139,250,0.16)",
  success: "#4ADE80",
  successTint: "rgba(74,222,128,0.14)",
  danger: "#F87171",
  dangerTint: "rgba(248,113,113,0.16)",
  warning: "#FBBF24",
  warningTint: "rgba(251,191,36,0.16)",
  // riga/pill trasparenti su card
  glass: "rgba(255,255,255,0.06)",
  glassStrong: "rgba(255,255,255,0.10)",
};

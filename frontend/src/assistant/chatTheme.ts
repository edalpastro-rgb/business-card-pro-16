// V50.z337 — Palette chat Axon dark/premium · V50.z338 — derivata dal TEMA ATTIVO (Chiaro · Grigio · Scuro).
import { ACTIVE } from "@/src/themes";

const hexA = (hex: string, a: number) => {
  const h = hex.replace("#", "");
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};
const d = ACTIVE.isDark;

export const CT = {
  bg: ACTIVE.bg,             // area chat
  bar: ACTIVE.card,          // toolbar superiore, input bar, sheet
  surface: ACTIVE.card,      // bolla Axon, menu
  surfaceUser: ACTIVE.card2, // bolla utente
  border: ACTIVE.border,     // separatori sottili
  borderGhost: ACTIVE.borderStrong, // ghost buttons
  text: ACTIVE.text,
  text2: ACTIVE.text2,
  muted: ACTIVE.muted,
  accent: ACTIVE.accent,     // blu elettrico / accent del tema
  accentGlow: hexA(ACTIVE.accent, 0.35),
  accentTint: hexA(ACTIVE.accent, d ? 0.14 : 0.10),
  // quick reply desaturati
  yes: d ? "#5fb37a" : "#2f9e5a",
  no: d ? "#d16a6a" : "#c0392b",
  maybe: d ? "#d1b35f" : "#b7860b",
  danger: d ? "#e0605f" : "#c0392b",
  warning: d ? "#d9a441" : "#b7860b",
  success: d ? "#5fb37a" : "#2f9e5a",
};

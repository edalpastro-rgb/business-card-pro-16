/**
 * Business Card — constants (colors, card dimensions).
 * Kept internal to the module; other modules must NOT import these directly.
 */

// Palette
export const CARD_NAVY = "#1A2A6C";
export const CARD_BLUE_MED = "#3A6BA5";
export const CARD_GOLD = "#D4B26A";
export const CARD_BACK_BG = "#FCFCFC";
export const CARD_TEXT = "#0F172A";
export const CARD_TEXT_MUTED = "#64748B";

// Card geometry — classic business card ratio 1.75:1
export const CARD_W = 340;
export const CARD_H = Math.round(CARD_W / 1.75); // ≈ 194

// DOM ids for html2canvas capture (web only)
export const FRONT_WEB_ID = "bc-front-web";
export const BACK_WEB_ID = "bc-back-web";
export const FRONT_WEB_OUTER_ID = `${FRONT_WEB_ID}-outer`;
export const BACK_WEB_OUTER_ID = `${BACK_WEB_ID}-outer`;

// CSS keyframes injected once for LIVE preview animations (web only)
export const ANIM_STYLE_ID = "bc-anim-css";

// QR type options presented to the user
export const QR_TYPES: readonly {
  id: "app" | "website" | "text" | "vcard";
  label: string;
  hint: string;
}[] = [
  { id: "app", label: "Link app demo", hint: "URL della tua demo su Emergent" },
  { id: "website", label: "Sito web", hint: "https://…" },
  { id: "vcard", label: "vCard contatto", hint: "Genera automaticamente da nome/tel/email" },
  { id: "text", label: "Testo libero", hint: "Qualsiasi messaggio" },
];

// Visual effects for the public shared page
export const VISUAL_EFFECTS: readonly { id: "none" | "shimmer" | "border"; label: string; hint: string }[] = [
  { id: "none", label: "Nessuno", hint: "Card statica senza animazione" },
  { id: "shimmer", label: "Shimmer", hint: "Luce diagonale che scorre ogni 10s" },
  { id: "border", label: "Bordo luminoso", hint: "Filo di luce sul perimetro in loop" },
];

// V27 — Themes for the public link redesign. Each is a preset of colors that
// the backend also knows about (server.py mirrors this list).
export type ThemePreset = {
  id: "sunset" | "midnight" | "ivory" | "mono" | "gold";
  label: string;
  hint: string;
  swatchTop: string;
  swatchBot: string;
  primary: string;
  secondary: string;
};
export const CARD_THEMES: readonly ThemePreset[] = [
  { id: "sunset",   label: "Sunset",   hint: "Arancio + Navy · default",       swatchTop: "#FF6B35", swatchBot: "#1B2B4B", primary: "#FF6B35", secondary: "#1B2B4B" },
  { id: "midnight", label: "Midnight", hint: "Navy pieno con accento arancio", swatchTop: "#1B2B4B", swatchBot: "#FF6B35", primary: "#1B2B4B", secondary: "#FF6B35" },
  { id: "ivory",    label: "Ivory",    hint: "Navy su fondo crema · elegante",  swatchTop: "#FFFBF3", swatchBot: "#1B2B4B", primary: "#1B2B4B", secondary: "#B8845A" },
  { id: "mono",     label: "Mono",     hint: "Bianco/Nero · minimal estremo",  swatchTop: "#FFFFFF", swatchBot: "#0F172A", primary: "#0F172A", secondary: "#0F172A" },
  { id: "gold",     label: "Gold",     hint: "Navy + Oro · premium",           swatchTop: "#1B2B4B", swatchBot: "#D4A853", primary: "#1B2B4B", secondary: "#D4A853" },
];

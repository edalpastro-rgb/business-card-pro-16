/**
 * Business Card — strict TypeScript types.
 * Public API of the module is defined here; internal helpers may add types locally.
 */

export type QrType = "app" | "website" | "text" | "vcard";
export type VisualEffect = "none" | "shimmer" | "border";
/** V27 — Card theme (public link redesign) */
export type CardTheme = "sunset" | "midnight" | "ivory" | "mono" | "gold";

/** The persisted business card document (mirrors backend response). */
export type BusinessCard = {
  card_id?: string;
  display_name?: string;
  title?: string;
  company_name?: string;
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  tagline?: string;
  logo_base64?: string;
  photo_base64?: string;
  accent_color?: string;
  qr_type?: QrType;
  qr_content?: string;
  demo_app_link?: string;
  link_title?: string;
  visual_effect?: VisualEffect;
  // V27 — Redesign fields
  card_theme?: CardTheme;
  show_photo?: boolean;
};

/** Minimum fields needed to build a vCard string. */
export type VCardInput = {
  display_name?: string;
  title?: string;
  company_name?: string;
  phone?: string;
  email?: string;
  website?: string;
};

/** Options for share-image generation. */
export type ShareImageOptions = {
  /** Optional PNG file name (without extension). */
  fileName?: string;
};

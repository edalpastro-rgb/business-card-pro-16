/**
 * vCard string builder — module-owned utility.
 */
import type { VCardInput } from "../types";

export function buildVCard(input: VCardInput): string {
  const lines: string[] = ["BEGIN:VCARD", "VERSION:3.0"];
  if (input.display_name) lines.push(`FN:${input.display_name}`);
  if (input.company_name) lines.push(`ORG:${input.company_name}`);
  if (input.title) lines.push(`TITLE:${input.title}`);
  if (input.phone) lines.push(`TEL:${input.phone}`);
  if (input.email) lines.push(`EMAIL:${input.email}`);
  if (input.website) lines.push(`URL:${input.website}`);
  lines.push("END:VCARD");
  return lines.join("\n");
}

/**
 * Derive the string encoded in the QR based on the card's configured qr_type.
 * Returns a safe fallback space " " so QR renderers don't crash on empty input.
 */
export function computeQrValue(card: {
  qr_type?: "app" | "website" | "text" | "vcard";
  qr_content?: string;
  demo_app_link?: string;
  website?: string;
  display_name?: string;
  company_name?: string;
  title?: string;
  phone?: string;
  email?: string;
  tagline?: string;
}): string {
  const t = card.qr_type || "website";
  if (t === "app") return card.demo_app_link || card.qr_content || "https://emergent.sh";
  if (t === "website") return card.website || card.qr_content || "https://example.com";
  if (t === "text") return card.qr_content || card.tagline || card.display_name || " ";
  // vcard
  return buildVCard(card);
}

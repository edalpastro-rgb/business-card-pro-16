/**
 * Business Card module — PUBLIC API.
 * Other modules MUST import ONLY from this file. Internal files (constants,
 * hooks, components, lib) are considered private.
 *
 * Exports:
 *  - BusinessCardScreen : the mountable screen component
 *  - buildVCard         : pure helper to build a vCard 3.0 string
 *  - computeQrValue     : derives QR content from a card record
 *  - getPublicShareUrl  : builds the public share URL for a saved card
 *  - BusinessCard, QrType, VisualEffect, VCardInput, ShareImageOptions : strict types
 */
export { BusinessCardScreen } from "./screens/BusinessCardScreen";
export { BusinessCardStatsScreen } from "./screens/BusinessCardStatsScreen";
export { buildVCard, computeQrValue } from "./lib/vcard";
export { getPublicShareUrl } from "./api";
export type {
  BusinessCard,
  BusinessCardStats,
  QrType,
  VisualEffect,
  VCardInput,
  ShareImageOptions,
} from "./types";

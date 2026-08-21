/**
 * Business Card — backend calls.
 * All requests go through `apiCall` and return `Result<T>`; no exceptions leak out.
 */
import { apiCall } from "@/src/shared";
import type { Result } from "@/src/shared";
import type { BusinessCard } from "./types";

export function fetchBusinessCard(): Promise<Result<BusinessCard>> {
  return apiCall<BusinessCard>("/master/business-card");
}

export function saveBusinessCard(card: BusinessCard): Promise<Result<BusinessCard>> {
  return apiCall<BusinessCard>("/master/business-card", { method: "PUT", body: card });
}

/** Build the public share URL for a saved card. */
export function getPublicShareUrl(cardId: string): string {
  const backend = process.env.EXPO_PUBLIC_BACKEND_URL || "";
  return `${backend}/api/master/business-card/public/${cardId}`;
}

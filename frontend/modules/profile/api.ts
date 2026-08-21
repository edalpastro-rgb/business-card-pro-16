/**
 * Profile module — backend calls with Result<T>.
 */
import { apiCall } from "@/src/shared";
import type { Result } from "@/src/shared";
import type { UserProfile, ProfileUpdateInput, UserSettings } from "./types";

export function getMe(): Promise<Result<{ user: UserProfile }>> {
  return apiCall<{ user: UserProfile }>("/auth/me");
}

export function updateProfile(body: ProfileUpdateInput): Promise<Result<{ user: UserProfile }>> {
  return apiCall<{ user: UserProfile }>("/auth/profile", { method: "PUT", body });
}

export function getUserSettings(): Promise<Result<UserSettings>> {
  return apiCall<UserSettings>("/user-settings");
}

export function updateUserSettings(body: Partial<UserSettings>): Promise<Result<UserSettings>> {
  return apiCall<UserSettings>("/user-settings", { method: "PUT", body });
}

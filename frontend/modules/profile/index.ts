/**
 * Profile module — PUBLIC API.
 * Owns consultant profile, logo, app settings, security surfaces.
 */
export type {
  UserProfile,
  UserRole,
  ProfileUpdateInput,
  ThemeMode,
  UserSettings,
} from "./types";

export {
  getMe,
  updateProfile,
  getUserSettings,
  updateUserSettings,
} from "./api";

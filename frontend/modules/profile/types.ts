/**
 * Profile module — strict TypeScript types for user profile and app settings.
 */

export type UserRole = "owner" | "admin" | "member";

export type UserProfile = {
  user_id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  role: UserRole;
  areas?: string[];
  parent_user_id?: string;
  additional_emails?: string[];
  subscription_status?: string;
  avatar_base64?: string;
};

export type ProfileUpdateInput = Partial<Pick<UserProfile,
  "first_name" | "last_name" | "avatar_base64" | "additional_emails"
>>;

export type ThemeMode = "light" | "dark" | "auto";

export type UserSettings = {
  theme?: ThemeMode;
  accent_color?: string;
  banner_image_url?: string;
  assistant_name?: string;
  assistant_response_mode?: "text" | "voice" | "both";
  assistant_voice?: string;
};

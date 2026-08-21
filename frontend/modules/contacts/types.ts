/**
 * Contacts module — strict TypeScript types.
 * These are the ONLY types other modules may consume for contact data.
 */

export type ContactArea = "energy" | "network";
export type ContactSource = "personal" | "referral";
export type ContactReferralType = "" | "direct" | "from_contact";

export type ContactNoteKind = "text" | "audio" | "photo" | "video" | "file" | "link";
export type ContactNoteCategory = "general" | "email" | "referral" | null;

export type ContactNote = {
  id: string;
  kind: ContactNoteKind;
  category?: ContactNoteCategory;
  text?: string;
  audio_base64?: string;
  audio_mime?: string;
  photo_base64?: string;
  video_base64?: string;
  video_mime?: string;
  file_base64?: string;
  file_name?: string;
  file_mime?: string;
  file_size?: number;
  link_url?: string;
  link_title?: string;
  created_at: string;
  duration_ms?: number;
};

export type ContactFile = {
  id: string;
  name: string;
  mime: string;
  size: number;
  created_at: string;
  data_base64?: string;
};

export type Anniversary = { name: string; date: string };

/** Full contact record (mirrors backend GET /contacts/{id}). */
export type Contact = {
  contact_id: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  address: string;
  phone_alt?: string;
  whatsapp?: string;
  email_alt?: string;
  telegram?: string;
  address_street?: string;
  address_number?: string;
  address_zip?: string;
  address_city?: string;
  address_province?: string;
  work_address?: string;
  residence_address?: string;
  birth_date?: string;
  fiscal_code?: string;
  vat_number?: string;
  anniversaries?: Anniversary[];
  website?: string;
  linkedin?: string;
  instagram?: string;
  facebook?: string;
  area: ContactArea;
  additional_areas?: string[];
  source: ContactSource | string;
  referral_note?: string;
  email_note?: string;
  general_note?: string;
  tags?: string[];
  group_ids?: string[];
  referred_by_contact_id?: string;
  notes?: ContactNote[];
  files?: ContactFile[];
  avatar_base64?: string;
  assigned_to_user_id?: string;
  contact_code?: string;
  // Birthday reminders (V38H)
  birthday_alert_days_before?: number;
  birthday_auto_send?: boolean;
  birthday_message?: string;
  birthday_message_link?: string;
  birthday_sender_email?: string;
  birthday_recipient_email?: string;
  is_active_client?: boolean;
};

/** Lightweight contact projection used in pickers/lists. */
export type ContactLite = {
  contact_id: string;
  first_name: string;
  last_name: string;
  phone?: string;
  phone_alt?: string;
  email?: string;
  email_alt?: string;
  whatsapp?: string;
  area?: string;
};

export type ContactGroup = { group_id: string; name: string; color: string };

export type CustomArea = { id: string; name: string; color: string; icon?: string };

export type ContactSettings = {
  energy_title: string;
  energy_color: string;
  network_title: string;
  network_color: string;
  custom_areas: CustomArea[];
};

/** Body sent to POST/PUT /contacts. Server accepts partial data. */
export type ContactWriteInput = Partial<Omit<Contact, "contact_id" | "notes" | "files">>;

/**
 * Agenda module — strict TypeScript types for appointments/calendar.
 */

export type AppointmentArea = "energy" | "network";
export type AppointmentRecurrence = "none" | "weekly" | "monthly" | "yearly";
export type BroadcastScope = "all" | "subtree" | "custom";

export type AppointmentAttachment = {
  local_id?: string;
  id?: string;
  kind: "photo" | "audio" | "video" | "file";
  photo_base64?: string;
  audio_base64?: string;
  audio_mime?: string;
  video_base64?: string;
  video_mime?: string;
  file_base64?: string;
  file_name?: string;
  file_mime?: string;
  file_size?: number;
};

export type Appointment = {
  appointment_id: string;
  title: string;
  contact_id?: string;
  participant_contact_ids?: string[];
  area: AppointmentArea;
  start_at: string;
  duration_min: number;
  reminder_minutes?: number;
  recurrence?: AppointmentRecurrence;
  is_phone?: boolean;
  phone_mobile?: string;
  phone_work?: string;
  phone_target?: "" | "mobile" | "work";
  location?: string;
  map_address?: string;
  full_address?: string;
  notes?: string;
  value_amount?: string | number;
  appointment_type_tags?: string[];
  product_categories?: string[];
  note_attachments?: AppointmentAttachment[];
  is_broadcast?: boolean;
  broadcast_scope?: BroadcastScope;
  broadcast_to_user_ids?: string[];
  broadcast_notify_advance_min?: number;
  read_only?: boolean;
  outcome_id?: string;
  created_by?: string;
};

export type AppointmentWriteInput = Partial<Omit<Appointment, "appointment_id">>;

export type AppointmentOutcome = { id: string; name: string; color: string; icon?: string; counts_as?: string };

export type TeamMember = { user_id: string; name: string; role: string };

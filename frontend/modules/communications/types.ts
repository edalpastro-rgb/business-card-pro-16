/**
 * Communications module — types (chat, shared assets).
 */

export type MessageKind = "text" | "audio" | "photo" | "video" | "file" | "link";

export type ChatMessage = {
  message_id: string;
  channel_id: string;
  from_user_id: string;
  kind: MessageKind;
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
};

export type ChatChannel = {
  channel_id: string;
  name: string;
  kind: "direct" | "group";
  member_user_ids: string[];
  last_message_at?: string;
  unread_count?: number;
};

export type ShareTargetKind = "system" | "whatsapp" | "email" | "copy";

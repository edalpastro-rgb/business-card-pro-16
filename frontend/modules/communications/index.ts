/**
 * Communications module — PUBLIC API.
 * Owns chat, share sheet, and in-app notification surfaces.
 */
export type {
  MessageKind,
  ChatMessage,
  ChatChannel,
  ShareTargetKind,
} from "./types";

export {
  listChatChannels,
  listChannelMessages,
  sendChannelMessage,
} from "./api";

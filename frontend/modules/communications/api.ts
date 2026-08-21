/**
 * Communications module — backend calls with Result<T>.
 */
import { apiCall } from "@/src/shared";
import type { Result } from "@/src/shared";
import type { ChatChannel, ChatMessage } from "./types";

export function listChatChannels(): Promise<Result<{ items: ChatChannel[] }>> {
  return apiCall<{ items: ChatChannel[] }>("/chat/channels");
}

export function listChannelMessages(channelId: string): Promise<Result<{ items: ChatMessage[] }>> {
  return apiCall<{ items: ChatMessage[] }>(`/chat/channels/${channelId}/messages`);
}

export function sendChannelMessage(channelId: string, body: Partial<ChatMessage>): Promise<Result<ChatMessage>> {
  return apiCall<ChatMessage>(`/chat/channels/${channelId}/messages`, { method: "POST", body });
}

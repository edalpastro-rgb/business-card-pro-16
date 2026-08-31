// V40 — SSE streaming client for the Axon Assistant.
// Consumes Server-Sent Events from POST /api/assistant/chat/stream and
// dispatches meta / delta / done callbacks. Compatible with both React
// Native (native fetch, no ReadableStream on Android in some setups) and
// Web (uses ReadableStream reader). Falls back to a full-buffer parse
// when a streaming reader is unavailable, so the UX still works.

import { getToken } from "@/src/api";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL as string;

export type StreamMeta = {
  session_id?: string;
  assistant_name?: string;
  from_cache?: boolean;
  cache_similarity?: number;
};

export type StreamDone = {
  used_web_search?: boolean;
  web_sources?: { title: string; url: string }[];
  from_cache?: boolean;
  session_id?: string;
};

export type StreamAssistantChatArgs = {
  message: string;
  session_id?: string;
  attachments?: { name: string; mime: string; data_base64: string }[];
  signal?: AbortSignal;
  onMeta?: (meta: StreamMeta) => void;
  onDelta?: (chunk: string) => void;
  onDone?: (done: StreamDone) => void;
};

export type StreamAssistantChatResult = {
  reply: string;
  session_id?: string;
  from_cache: boolean;
  used_web_search: boolean;
  web_sources: { title: string; url: string }[];
};

/**
 * Parse a single SSE event block. Each block has 1+ lines:
 *   event: <name>
 *   data: <json string>
 * Multiple `data:` lines are concatenated with '\n' per SSE spec.
 */
function parseSSEBlock(block: string): { event: string; data: any } | null {
  const lines = block.split(/\r?\n/);
  let event = "message";
  const dataLines: string[] = [];
  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith(":")) continue; // comment
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const field = line.slice(0, idx);
    const value = line.slice(idx + 1).trimStart();
    if (field === "event") event = value;
    else if (field === "data") dataLines.push(value);
  }
  if (!dataLines.length) return null;
  const raw = dataLines.join("\n");
  try {
    return { event, data: JSON.parse(raw) };
  } catch {
    return { event, data: raw };
  }
}

export async function streamAssistantChat(
  args: StreamAssistantChatArgs
): Promise<StreamAssistantChatResult> {
  const token = await getToken();
  const url = `${BASE}/api/assistant/chat/stream`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      message: args.message,
      session_id: args.session_id,
      attachments: args.attachments || [],
    }),
    signal: args.signal,
  });

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = j.detail || j.message || msg;
    } catch {}
    throw new Error(msg);
  }

  const result: StreamAssistantChatResult = {
    reply: "",
    session_id: undefined,
    from_cache: false,
    used_web_search: false,
    web_sources: [],
  };

  const dispatch = (event: string, data: any) => {
    if (event === "meta") {
      if (data?.session_id) result.session_id = data.session_id;
      if (data?.from_cache) result.from_cache = true;
      args.onMeta?.(data);
    } else if (event === "delta") {
      const chunk = typeof data?.text === "string" ? data.text : "";
      if (chunk) {
        result.reply += chunk;
        args.onDelta?.(chunk);
      }
    } else if (event === "done") {
      result.used_web_search = !!data?.used_web_search;
      result.web_sources = data?.web_sources || [];
      if (typeof data?.from_cache === "boolean") result.from_cache = data.from_cache;
      if (data?.session_id) result.session_id = data.session_id;
      args.onDone?.(data);
    } else if (event === "error") {
      throw new Error(data?.error || "Errore streaming");
    }
  };

  // Feed a growing SSE buffer, extract complete `\n\n`-terminated blocks.
  let buffer = "";
  const feed = (chunk: string) => {
    buffer += chunk;
    // SSE blocks are separated by blank lines (\n\n or \r\n\r\n)
    let sepIdx: number;
    // eslint-disable-next-line no-cond-assign
    while ((sepIdx = buffer.search(/\r?\n\r?\n/)) !== -1) {
      const block = buffer.slice(0, sepIdx);
      buffer = buffer.slice(sepIdx).replace(/^\r?\n\r?\n/, "");
      const parsed = parseSSEBlock(block);
      if (parsed) dispatch(parsed.event, parsed.data);
    }
  };

  const body: any = (res as any).body;
  const canStream =
    body && typeof body.getReader === "function" && typeof TextDecoder !== "undefined";

  if (canStream) {
    const reader = body.getReader();
    const decoder = new TextDecoder("utf-8");
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      if (text) feed(text);
    }
    // flush any final buffer (in case last block missed trailing \n\n)
    if (buffer.trim()) feed("\n\n");
  } else {
    // Fallback: read the entire body as text, then parse.
    // Not "live" but still functional; result comes back in one shot.
    const text = await res.text();
    feed(text);
    if (buffer.trim()) feed("\n\n");
  }

  return result;
}

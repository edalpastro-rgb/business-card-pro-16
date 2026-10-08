// V40 — SSE streaming client for the Axon Assistant.
// Consumes Server-Sent Events from POST /api/assistant/chat/stream and
// dispatches meta / delta / done callbacks. Compatible with both React
// Native (native fetch, no ReadableStream on Android in some setups) and
// Web (uses ReadableStream reader). Falls back to a full-buffer parse
// when a streaming reader is unavailable, so the UX still works.

import { getToken, BACKEND_URL } from "@/src/api";
import type { Alarm } from "@/src/alarmNotifs";

const BASE = BACKEND_URL as string;

export type StreamMeta = {
  session_id?: string;
  message_id?: string;
  assistant_name?: string;
  from_cache?: boolean;
  cache_similarity?: number;
};

export type StreamDone = {
  message_id?: string;
  used_web_search?: boolean;
  web_sources?: { title: string; url: string }[];
  from_cache?: boolean;
  session_id?: string;
  // V50.z125 — sveglia/timer/promemoria creato da comando vocale/testuale
  alarm?: Alarm | null;
  // V50.z126 — azione rapida: timestamp salvataggio in cache QA
  qa_updated_at?: string | null;
};

export type StreamProgress = { stage?: string; text?: string; model?: string };

export type StreamAssistantChatArgs = {
  message: string;
  session_id?: string;
  attachments?: { name: string; mime: string; data_base64: string }[];
  merge_images?: boolean; // V50.z438 — foto multiple = pagine dello stesso documento (default true lato backend)
  // V50.z126 — etichetta azione rapida (il backend arricchisce il prompt e salva in cache)
  quick_label?: string;
  // V50.z291 — posizione attuale nell'app (route, parametri, titolo) → Axon sa dove si trova l'utente
  client_context?: { route: string; params?: Record<string, string>; title?: string; voice?: boolean; personal_vault?: string; device_permissions?: string; position?: { lat: number; lon: number; accuracy_m: number | null; age_s: number } }; // V50.z487 position (GPS reale) // V50.z484 device_permissions // V50.z305 voice → risposta breve · V50.z469 personal_vault (Spazio Personale, solo per questa richiesta)
  signal?: AbortSignal;
  onMeta?: (meta: StreamMeta) => void;
  onProgress?: (p: StreamProgress) => void;
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
    } else if (event === "progress") {
      args.onProgress?.(data || {});
    } else if (event === "error") {
      throw new Error(data?.error || "Errore streaming");
    }
  };

  // Feed a growing SSE buffer, extract complete `\n\n`-terminated blocks.
  let buffer = "";
  const feed = (chunk: string) => {
    buffer += chunk;
    let sepIdx: number;
    // eslint-disable-next-line no-cond-assign
    while ((sepIdx = buffer.search(/\r?\n\r?\n/)) !== -1) {
      const block = buffer.slice(0, sepIdx);
      buffer = buffer.slice(sepIdx).replace(/^\r?\n\r?\n/, "");
      const parsed = parseSSEBlock(block);
      if (parsed) dispatch(parsed.event, parsed.data);
    }
  };

  // V50.b — Su React Native (Android/iOS) `fetch()` NON supporta lo streaming
  // del body: getReader() è undefined e il codice cadeva nel fallback
  // res.text() che aspetta il body COMPLETO prima di emettere delta.
  // Usiamo XMLHttpRequest con onprogress: responseText cresce man mano che
  // arrivano i chunk SSE dal backend → streaming live anche su native.
  // Su Web moderno preferiamo la ReadableStream fetch (più efficiente).
  const isWeb = typeof (globalThis as any).ReadableStream !== "undefined" &&
    typeof (globalThis as any).TextDecoder !== "undefined" &&
    typeof (globalThis as any).document !== "undefined";

  if (isWeb) {
    // ---- Web path: fetch + ReadableStream reader ----
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
        merge_images: args.merge_images,
        quick_label: args.quick_label || undefined,
        client_context: args.client_context || undefined,
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

    const body: any = (res as any).body;
    const canStream = body && typeof body.getReader === "function";
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
      if (buffer.trim()) feed("\n\n");
    } else {
      const text = await res.text();
      feed(text);
      if (buffer.trim()) feed("\n\n");
    }
    return result;
  }

  // ---- Native (RN) path: XMLHttpRequest with onprogress ----
  await new Promise<void>((resolve, reject) => {
    let lastLen = 0;
    let aborted = false;
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url, true);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.setRequestHeader("Accept", "text/event-stream");
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    // Do NOT set responseType — we need responseText to grow incrementally

    if (args.signal) {
      const s = args.signal;
      const onAbort = () => {
        aborted = true;
        try { xhr.abort(); } catch {}
        reject(new Error("Aborted"));
      };
      if (s.aborted) return onAbort();
      s.addEventListener("abort", onAbort, { once: true });
    }

    xhr.onprogress = () => {
      if (aborted) return;
      try {
        const full: string = xhr.responseText || "";
        if (full.length > lastLen) {
          const chunk = full.slice(lastLen);
          lastLen = full.length;
          feed(chunk);
        }
      } catch {
        /* swallow: some RN builds throw on responseText mid-stream */
      }
    };

    xhr.onreadystatechange = () => {
      if (xhr.readyState === 4) {
        if (aborted) return;
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const full: string = xhr.responseText || "";
            if (full.length > lastLen) {
              feed(full.slice(lastLen));
              lastLen = full.length;
            }
            if (buffer.trim()) feed("\n\n");
            resolve();
          } catch (e) {
            reject(e);
          }
        } else {
          let msg = `HTTP ${xhr.status}`;
          try {
            const j = JSON.parse(xhr.responseText || "{}");
            msg = j.detail || j.message || msg;
          } catch {}
          reject(new Error(msg));
        }
      }
    };

    xhr.onerror = () => reject(new Error("Errore di rete"));
    // V50.z121 — Timeout esplicito (prima assente → richiesta appesa per sempre su nativo)
    xhr.timeout = 120000;
    xhr.ontimeout = () => reject(new Error("Timeout: il server non ha risposto entro 2 minuti"));

    xhr.send(JSON.stringify({
      message: args.message,
      session_id: args.session_id,
      attachments: args.attachments || [],
      merge_images: args.merge_images,
      quick_label: args.quick_label || undefined,
      client_context: args.client_context || undefined,
    }));
  });

  return result;
}

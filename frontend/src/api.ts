import { storage } from "@/src/utils/storage";
import { emitDeviceSuspended } from "@/src/device"; // V50.z293
import { emitSubscriptionExpired } from "@/src/paywallEvents"; // V50.z330
import * as offline from "@/src/offline"; // V50.z279 — modalità aereo: cache GET + coda scritture

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL as string;
const TOKEN_KEY = "auth_token_v1";

export async function getToken(): Promise<string | null> {
  return (await storage.secureGet<string | null>(TOKEN_KEY, null)) as string | null;
}
// V50.z21 — Helper per download binari (allegati mail) e altre fetch dirette
export async function getAuthHeader(): Promise<Record<string, string>> {
  const t = await getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}
export async function setToken(t: string) {
  await storage.secureSet(TOKEN_KEY, t);
}
export async function clearToken() {
  await storage.secureRemove(TOKEN_KEY);
}

export type ApiOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  body?: any;
  query?: Record<string, string | number | boolean | undefined>;
  // V29.n — Consente al chiamante di passare un AbortSignal per interrompere la richiesta in corso.
  signal?: AbortSignal;
};

/** V50.z317 — FastAPI 422 restituisce `detail` come lista di oggetti → testo leggibile (evita «[object Object]»). */
function detailToText(d: unknown, fallback: string): string {
  if (typeof d === "string") return d;
  if (Array.isArray(d)) {
    const parts = d.map((x: any) => (typeof x === "string" ? x : x?.msg ? `${(x.loc || []).slice(-1)[0] || "campo"}: ${x.msg}` : "")).filter(Boolean);
    return parts.length ? parts.join(" · ") : fallback;
  }
  if (d && typeof d === "object") return (d as any).message || (d as any).msg || fallback;
  return fallback;
}

export async function api<T = any>(path: string, opts: ApiOptions = {}): Promise<T> {
  const token = await getToken();
  const q = opts.query
    ? "?" +
      Object.entries(opts.query)
        .filter(([, v]) => v !== undefined && v !== "")
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join("&")
    : "";
  const method: offline.Method = opts.method || "GET";
  if (token) offline.setOfflineScope(token);
  let res: Response;
  // V50.z279 — se siamo già offline non aspettiamo il timeout di rete: 4s poi cache/coda
  let signal = opts.signal; let killer: any = null;
  if (offline.isOffline() && !signal && typeof AbortController !== "undefined") { const ac = new AbortController(); signal = ac.signal; killer = setTimeout(() => ac.abort(), 4000); }
  try {
    res = await fetch(`${BASE}/api${path}${q}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal,
    });
  } catch (netErr: any) {
    const timedOut = killer && netErr?.name === "AbortError";
    // V29.n — AbortError from user "Stop" button — silent.
    if (!timedOut && (netErr?.name === "AbortError" || /aborted|abort/i.test(String(netErr?.message || "")))) {
      throw netErr;
    }
    const raw = String(netErr?.message || netErr || "");
    if (timedOut || /failed to fetch|network request failed|networkerror|load failed/i.test(raw)) {
      // V50.z279 — MODALITÀ OFFLINE: GET → ultimo dato in cache; scritture → coda di sincronizzazione
      offline.markOffline();
      if (method === "GET") {
        const c = await offline.cacheGet(path, q);
        if (c) return c.data as T;
        throw new offline.OfflineError("Dati non disponibili offline: apri questa sezione quando sei connesso.");
      }
      if (offline.canQueue(path, method, opts.body)) return (await offline.enqueue(method, path, opts.query, opts.body)) as T;
      throw new offline.OfflineError("Funzione non disponibile offline: riprova quando torni connesso.");
    }
    throw netErr;
  } finally { if (killer) clearTimeout(killer); }
  offline.markOnline();
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = detailToText(j.detail, j.message || msg);
    } catch {}
    // V50.z293 — dispositivo sospeso/rimosso dal registro (account in uso su un altro dispositivo dello stesso tipo) → logout forzato
    if (res.status === 401 && msg === "device_suspended") emitDeviceSuspended(msg);
    // V50.z330 — prova/abbonamento scaduto → schermata /paywall
    if (res.status === 402 && msg === "subscription_expired") emitSubscriptionExpired();
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as any;
  const data = (await res.json()) as T;
  if (method === "GET" && !path.startsWith("/offline")) void offline.cacheSet(path, q, data);
  return data;
}

// V50.z279 — trasporto per la coda offline: replay idempotente + ping di riconnessione
offline.bindOfflineTransport(
  (op) => api("/offline/replay", { method: "POST", body: { op_id: op.op_id, method: op.method, path: op.path, query: op.query, body: op.body, queued_at: op.queued_at, base_updated_at: op.base_updated_at, label: op.label } }),
  async () => { const ac = typeof AbortController !== "undefined" ? new AbortController() : null; const t = ac ? setTimeout(() => ac.abort(), 5000) : null; try { const r = await fetch(`${BASE}/api/health`, { signal: ac?.signal }); return r.ok; } finally { if (t) clearTimeout(t); } },
);

// V50.z84 — Multipart upload helper (per allegati chat)
export async function apiUpload<T = any>(path: string, form: FormData): Promise<T> {
  const token = await getToken();
  // NON impostare Content-Type manualmente: il runtime aggiunge la boundary
  const res = await fetch(`${BASE}/api${path}`, {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: form,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); msg = detailToText(j.detail, j.message || msg); } catch {}
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

// V50.z84 — Costruisce URL completo per un file autenticato con token in query
// (usato per <Image source={{ uri }}> su web dove non si possono passare headers).
export async function buildFileUrl(path: string): Promise<string> {
  const token = await getToken();
  const sep = path.includes("?") ? "&" : "?";
  return `${BASE}/api${path}${token ? `${sep}token=${encodeURIComponent(token)}` : ""}`;
}

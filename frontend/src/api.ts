import { storage } from "@/src/utils/storage";

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

export async function api<T = any>(path: string, opts: ApiOptions = {}): Promise<T> {
  const token = await getToken();
  const q = opts.query
    ? "?" +
      Object.entries(opts.query)
        .filter(([, v]) => v !== undefined && v !== "")
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join("&")
    : "";
  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}${q}`, {
      method: opts.method || "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (netErr: any) {
    // V29.n — AbortError from user "Stop" button — silent.
    if (netErr?.name === "AbortError" || /aborted|abort/i.test(String(netErr?.message || ""))) {
      throw netErr;
    }
    // V38S — Convert the raw "TypeError: Failed to fetch" (browser) or
    // "Network request failed" (RN) into a user-friendly Italian message.
    const raw = String(netErr?.message || netErr || "");
    if (/failed to fetch|network request failed|networkerror/i.test(raw)) {
      throw new Error("Connessione al server interrotta. Verifica la rete e riprova.");
    }
    throw netErr;
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = j.detail || j.message || msg;
    } catch {}
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as any;
  return (await res.json()) as T;
}

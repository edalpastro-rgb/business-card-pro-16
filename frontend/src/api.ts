import { storage } from "@/src/utils/storage";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL as string;
const TOKEN_KEY = "auth_token_v1";

export async function getToken(): Promise<string | null> {
  return (await storage.secureGet<string | null>(TOKEN_KEY, null)) as string | null;
}
export async function setToken(t: string) {
  await storage.secureSet(TOKEN_KEY, t);
}
export async function clearToken() {
  await storage.secureRemove(TOKEN_KEY);
}

export type ApiOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: any;
  query?: Record<string, string | number | boolean | undefined>;
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
  const res = await fetch(`${BASE}/api${path}${q}`, {
    method: opts.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
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

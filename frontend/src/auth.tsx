import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { Platform } from "react-native";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { api, getToken, setToken, clearToken } from "@/src/api";
import { storage } from "@/src/utils/storage";

export type User = {
  user_id: string;
  email: string;
  name: string;
  picture?: string | null;
  role: string;
  areas: string[];
  parent_user_id?: string | null;
  avatar_base64?: string | null;
  two_factor_enabled?: boolean;
  additional_emails?: string[];
  company_name?: string | null;
  company_logo_base64?: string | null;
  // V50.z140 — Header tabelle AxonOS
  table_header_name?: string | null;
  table_header_logo_base64?: string | null;
};

const TRUST_KEY = "trust_expires_at_v1";
const PIN_HASH_KEY = "app_lock_pin_hash_v1";
const BIO_ENABLED_KEY = "app_lock_bio_v1";
const APP_LOCK_ENABLED_KEY = "app_lock_enabled_v1";
const LAST_UNLOCK_KEY = "app_last_unlock_v1";

// App lock triggers after this idle interval (in minutes) when trust is still valid
const APP_LOCK_IDLE_MINUTES = 5;

export type LoginResult =
  | { requires_2fa: true; temp_token: string }
  | { requires_2fa: false; ok: true };

type AuthCtx = {
  user: User | null;
  loading: boolean;
  loginEmail: (email: string, password: string) => Promise<LoginResult>;
  verify2FA: (tempToken: string, code: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  loginGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  // App lock
  locked: boolean;
  setLocked: (l: boolean) => void;
  unlockWithPin: (pin: string) => Promise<boolean>;
  hasPinConfigured: () => Promise<boolean>;
  isBiometricEnabled: () => Promise<boolean>;
  markUnlocked: () => Promise<void>;
  // Trust
  trustExpiresAt: string | null;
  isTrustValid: () => Promise<boolean>;
};

const Ctx = createContext<AuthCtx | null>(null);

async function saveTrust(iso: string | null) {
  if (iso) await storage.secureSet(TRUST_KEY, iso);
  else await storage.secureRemove(TRUST_KEY);
}
async function loadTrust(): Promise<string | null> {
  return (await storage.secureGet<string | null>(TRUST_KEY, null)) as string | null;
}

export async function isTrustStillValid(): Promise<boolean> {
  const iso = await loadTrust();
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return isFinite(t) && t > Date.now();
}

export async function isAppLockEnabled(): Promise<boolean> {
  return !!(await storage.secureGet<boolean>(APP_LOCK_ENABLED_KEY, false));
}

export async function setAppLockEnabled(v: boolean) {
  await storage.secureSet(APP_LOCK_ENABLED_KEY, v);
}

// Simple deterministic PIN "hash" (client-side only, plus device secure store).
// This is meant purely as a quick unlock — the real 2FA still guards the account.
async function pinHash(pin: string): Promise<string> {
  // Lightweight non-crypto hash + salt string — good enough on-device.
  const salt = "dp-crm-pin-salt-2026";
  let h = 0;
  const s = salt + "|" + pin;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return `pinh:${h}`;
}

export async function setPin(pin: string) {
  const h = await pinHash(pin);
  await storage.secureSet(PIN_HASH_KEY, h);
}

export async function hasPin(): Promise<boolean> {
  const h = (await storage.secureGet<string | null>(PIN_HASH_KEY, null)) as string | null;
  return !!h;
}

export async function verifyPin(pin: string): Promise<boolean> {
  const stored = (await storage.secureGet<string | null>(PIN_HASH_KEY, null)) as string | null;
  if (!stored) return false;
  const h = await pinHash(pin);
  return h === stored;
}

export async function clearPin() {
  await storage.secureRemove(PIN_HASH_KEY);
}

export async function setBiometricEnabled(v: boolean) {
  await storage.secureSet(BIO_ENABLED_KEY, v);
}

export async function biometricEnabled(): Promise<boolean> {
  return !!(await storage.secureGet<boolean>(BIO_ENABLED_KEY, false));
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [trustExpiresAt, setTrustExpiresAt] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const t = await getToken();
    if (!t) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const r = await api<{ user: User }>("/auth/me");
      setUser(r.user);
    } catch {
      await clearToken();
      await saveTrust(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      // Handle web session_id in URL first
      if (Platform.OS === "web" && typeof window !== "undefined") {
        const hash = window.location.hash || "";
        const search = window.location.search || "";
        const m = (hash + " " + search).match(/session_id=([^&\s]+)/);
        if (m) {
          try {
            const r = await api<{ token: string; user: User }>("/auth/google-session", {
              method: "POST",
              body: { session_id: m[1] },
            });
            await setToken(r.token);
            const iso = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
            await saveTrust(iso);
            setTrustExpiresAt(iso);
            setUser(r.user);
            window.history.replaceState(null, "", window.location.pathname);
            setLoading(false);
            return;
          } catch (e) {
            console.warn("google session err", e);
          }
        }
      }
      await refresh();

      // Load trust + determine if lock needed
      const iso = await loadTrust();
      setTrustExpiresAt(iso);
      const trustValid = iso && new Date(iso).getTime() > Date.now();
      const appLockOn = await isAppLockEnabled();
      const lastUnlock = (await storage.secureGet<number | null>(LAST_UNLOCK_KEY, null)) as number | null;
      const idleMs = APP_LOCK_IDLE_MINUTES * 60 * 1000;
      const wasRecent = lastUnlock && Date.now() - Number(lastUnlock) < idleMs;

      if (trustValid && appLockOn && !wasRecent) {
        setLocked(true);
      } else if (!trustValid) {
        // Trust expired: fresh full login required
        const t = await getToken();
        if (t) {
          await clearToken();
          await saveTrust(null);
          setUser(null);
        }
      }
    })();
  }, [refresh]);

  const loginEmail = async (email: string, password: string): Promise<LoginResult> => {
    const r = await api<
      | { requires_2fa: true; temp_token: string }
      | { requires_2fa?: false; token: string; user: User; trust_expires_at: string }
    >("/auth/login", { method: "POST", body: { email, password } });

    if ("requires_2fa" in r && r.requires_2fa) {
      return { requires_2fa: true, temp_token: r.temp_token };
    }
    const rr = r as { token: string; user: User; trust_expires_at: string };
    await setToken(rr.token);
    await saveTrust(rr.trust_expires_at);
    setTrustExpiresAt(rr.trust_expires_at);
    await storage.secureSet(LAST_UNLOCK_KEY, Date.now());
    setUser(rr.user);
    return { requires_2fa: false, ok: true };
  };

  const verify2FA = async (tempToken: string, code: string) => {
    const r = await api<{ token: string; user: User; trust_expires_at: string }>(
      "/auth/login/2fa",
      { method: "POST", body: { temp_token: tempToken, code } }
    );
    await setToken(r.token);
    await saveTrust(r.trust_expires_at);
    setTrustExpiresAt(r.trust_expires_at);
    await storage.secureSet(LAST_UNLOCK_KEY, Date.now());
    setUser(r.user);
  };

  const register = async (email: string, password: string, name: string) => {
    const r = await api<{ token: string; user: User }>("/auth/register", {
      method: "POST",
      body: { email, password, name },
    });
    await setToken(r.token);
    const iso = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    await saveTrust(iso);
    setTrustExpiresAt(iso);
    await storage.secureSet(LAST_UNLOCK_KEY, Date.now());
    setUser(r.user);
  };

  const loginGoogle = async () => {
    // V49.b — Redirect + auth-base robusti anche in build deployati dove alcune
    // env vars possono essere stripped o parziali (es. `https://auth.` senza
    // dominio → URL rotto `https://auth./?...`). Manteniamo il valore da .env
    // se sensato, altrimenti facciamo fallback hardcoded ai domini Emergent.
    const DEPLOY_BASE = "https://business-card-pro-16.emergent.host";
    const AUTH_FALLBACK = "https://auth.emergentagent.com";
    const rawAuthBase = String(process.env.EXPO_PUBLIC_EMERGENT_AUTH_URL || "").trim();
    // Sano solo se ha un host con almeno un punto seguito da estensione.
    const authHostOk = /^https?:\/\/[^./]+\.[^./]+/i.test(rawAuthBase);
    const emergentAuthBase = (authHostOk ? rawAuthBase : AUTH_FALLBACK).replace(/\/+$/, "");
    // Redirect verso l'app: su web usiamo l'origin corrente; se assente (SSR /
    // ambienti dove window è undefined) ripieghiamo sul dominio di deploy.
    let redirectUrl: string;
    if (Platform.OS === "web") {
      const origin = typeof window !== "undefined" && window.location?.origin
        ? window.location.origin
        : "";
      redirectUrl = (origin || DEPLOY_BASE) + "/";
    } else {
      redirectUrl = Linking.createURL("");
    }
    const authUrl = `${emergentAuthBase}/?redirect=${encodeURIComponent(redirectUrl)}`;
    if (Platform.OS === "web") {
      window.location.href = authUrl;
      return;
    }
    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
    if (result.type !== "success" || !result.url) return;
    const m = result.url.match(/session_id=([^&#]+)/);
    if (!m) return;
    const r = await api<{ token: string; user: User }>("/auth/google-session", {
      method: "POST",
      body: { session_id: m[1] },
    });
    await setToken(r.token);
    const iso = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    await saveTrust(iso);
    setTrustExpiresAt(iso);
    await storage.secureSet(LAST_UNLOCK_KEY, Date.now());
    setUser(r.user);
  };

  const logout = async () => {
    try { await api("/auth/logout", { method: "POST" }); } catch {}
    await clearToken();
    await saveTrust(null);
    setTrustExpiresAt(null);
    await storage.secureRemove(LAST_UNLOCK_KEY);
    setUser(null);
    setLocked(false);
  };

  const unlockWithPin = async (pin: string) => {
    const ok = await verifyPin(pin);
    if (ok) {
      await storage.secureSet(LAST_UNLOCK_KEY, Date.now());
      setLocked(false);
    }
    return ok;
  };

  const markUnlocked = async () => {
    await storage.secureSet(LAST_UNLOCK_KEY, Date.now());
    setLocked(false);
  };

  return (
    <Ctx.Provider value={{
      user, loading, loginEmail, verify2FA, register, loginGoogle, logout, refresh,
      locked, setLocked, unlockWithPin, hasPinConfigured: hasPin, isBiometricEnabled: biometricEnabled, markUnlocked,
      trustExpiresAt, isTrustValid: isTrustStillValid,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used inside AuthProvider");
  return c;
}

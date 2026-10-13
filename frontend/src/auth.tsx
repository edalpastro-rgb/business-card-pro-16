import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { getDeviceInfo, onDeviceSuspended } from "@/src/device"; // V50.z293
import { notify } from "@/src/utils/notify";
import { Platform } from "react-native";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { api, getToken, setToken, clearToken, BACKEND_URL } from "@/src/api";
import { storage } from "@/src/utils/storage";
import { installPrefsSync, restorePrefsFromServer, disablePrefsSync, flush as flushPrefs } from "@/src/utils/prefsSync";
// V50.z428 — preferenze (PIN, tema, widget sidebar, impostazioni…) specchiate sul server e ripristinate al login
installPrefsSync();
const syncPrefs = () => Promise.race([restorePrefsFromServer(), new Promise<void>((res) => setTimeout(res, 3500))]);

WebBrowser.maybeCompleteAuthSession();
const usedSessionIds = new Set<string>(); // V50.z272 — un session_id va scambiato una sola volta

export type User = {
  user_id: string;
  email: string;
  name: string;
  email_verified?: boolean | null; // V50.z433
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

// V50.z434 — extra registrazione: cognome, promo, consensi, anti-bot (challenge/PoW/Turnstile/honeypot)
export type RegisterExtra = {
  lastName?: string; promoCode?: string; privacyAccepted?: boolean; newsletter?: boolean;
  challengeId?: string; powNonce?: string; turnstileToken?: string | null; hp?: string;
  plan?: "builder" | "professional"; // V50.z530 — piano Founder scelto dalla landing
  orgPlan?: string; // V50.z541 — piano organizzazione scelto nel modulo (collab | master10 | master50 | enterprise)
};

export type LoginResult =
  | { requires_2fa: true; temp_token: string }
  | { requires_2fa: false; requires_email_verification: true; email: string } // V50.z433
  | { requires_2fa: false; ok: true };

type AuthCtx = {
  user: User | null;
  loading: boolean;
  loginEmail: (email: string, password: string) => Promise<LoginResult>;
  verify2FA: (tempToken: string, code: string) => Promise<void>;
  register: (email: string, password: string, name: string, extra?: RegisterExtra) => Promise<{ promo: { ok: boolean; code: string; message: string } | null; requiresEmailVerification: boolean }>;
  /** V50.z433 — attivazione account con codice a 6 cifre ricevuto via email */
  verifyEmail: (code: string) => Promise<void>;
  resendEmailCode: () => Promise<string>;
  /** V50.z433 — true se al boot il token appartiene a un account non ancora attivato */
  pendingEmailVerification: string | null;
  loginGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  /** V50.z187 — sessione già emessa dal server (accesso rapido con impronta/Face ID/PIN) */
  loginWithSession: (token: string, user: User) => Promise<void>;
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
  const [pendingEmailVerification, setPendingEmailVerification] = useState<string | null>(null); // V50.z433
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
      if (r.user?.email_verified === false) { // V50.z433 — account da attivare: resta sul login con la schermata del codice
        setPendingEmailVerification(r.user.email);
        setUser(null);
        return;
      }
      await syncPrefs();
      setUser(r.user);
    } catch (e: any) {
      // V50.z279 — offline senza cache: non invalidare la sessione (il token resta valido al ritorno online)
      if (e?.offline) { setUser(null); return; }
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
              body: { session_id: m[1], device: await getDeviceInfo() },
            });
            await setToken(r.token);
            const iso = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
            await saveTrust(iso);
            setTrustExpiresAt(iso);
            await syncPrefs();
            setUser(r.user);
            window.history.replaceState(null, "", window.location.pathname);
            setLoading(false);
            return;
          } catch (e: any) {
            console.warn("google session err", e);
            notify("Accesso Google non riuscito", e?.message || "Il codice di accesso non è valido o è scaduto: riprova.");
          }
        }
      }
      // V50.z272 — Native cold start: l'app è stata riaperta dal deep link frontend://#session_id=… (Android Custom Tabs)
      if (Platform.OS !== "web") {
        try {
          const initial = await Linking.getInitialURL();
          const m = initial ? initial.match(/[?#&]session_id=([^&#]+)/) : null;
          if (m && !usedSessionIds.has(m[1])) {
            usedSessionIds.add(m[1]);
            const r = await api<{ token: string; user: User }>("/auth/google-session", { method: "POST", body: { session_id: decodeURIComponent(m[1]), device: await getDeviceInfo() } });
            await setToken(r.token);
            const iso = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
            await saveTrust(iso);
            setTrustExpiresAt(iso);
            await storage.secureSet(LAST_UNLOCK_KEY, Date.now());
            await syncPrefs();
            setUser(r.user);
            setLoading(false);
            return;
          }
        } catch (e) {
          console.warn("google cold-start session err", e);
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

  // V50.z430 — Bug 1: deep link «frontend://#session_id=…» ricevuto ad app GIÀ aperta (es. dopo il bottone «Apri AdvisorOS»
  // della pagina di ritorno, quando loginGoogle ha già smesso di attendere) → completa comunque l'accesso.
  useEffect(() => {
    if (Platform.OS === "web") return;
    const sub = Linking.addEventListener("url", (e) => {
      const m = e?.url ? e.url.match(/[?#&]session_id=([^&#]+)/) : null;
      if (!m || usedSessionIds.has(m[1])) return;
      // lascia 1,5 s a loginGoogle (se in attesa) per consumarlo; altrimenti lo gestiamo qui
      setTimeout(() => {
        if (usedSessionIds.has(m[1])) return;
        usedSessionIds.add(m[1]);
        void (async () => {
          try {
            const r = await api<{ token: string; user: User }>("/auth/google-session", { method: "POST", body: { session_id: decodeURIComponent(m[1]), device: await getDeviceInfo() } });
            await setToken(r.token);
            const iso = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
            await saveTrust(iso);
            setTrustExpiresAt(iso);
            await storage.secureSet(LAST_UNLOCK_KEY, Date.now());
            await syncPrefs();
            setUser(r.user);
            setLoading(false);
          } catch (err: any) {
            notify("Accesso Google non riuscito", err?.message || "Riprova dall'app.");
          }
        })();
      }, 1500);
    });
    return () => sub.remove();
  }, []);

  const loginEmail = async (email: string, password: string): Promise<LoginResult> => {
    const r = await api<
      | { requires_2fa: true; temp_token: string }
      | { requires_email_verification: true; token: string; email: string }
      | { requires_2fa?: false; token: string; user: User; trust_expires_at: string }
    >("/auth/login", { method: "POST", body: { email, password, device: await getDeviceInfo() } }); // V50.z293

    if ("requires_2fa" in r && r.requires_2fa) {
      return { requires_2fa: true, temp_token: r.temp_token };
    }
    if ("requires_email_verification" in r && r.requires_email_verification) { // V50.z433
      await setToken(r.token);
      setPendingEmailVerification(r.email);
      return { requires_2fa: false, requires_email_verification: true, email: r.email };
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
      { method: "POST", body: { temp_token: tempToken, code, device: await getDeviceInfo() } }
    );
    await setToken(r.token);
    await saveTrust(r.trust_expires_at);
    setTrustExpiresAt(r.trust_expires_at);
    await storage.secureSet(LAST_UNLOCK_KEY, Date.now());
    await syncPrefs();
    setUser(r.user);
  };

  // V50.z433 — Cognome + codice promozionale opzionale (stesso sistema promo del Master/landing); l'account resta da attivare
  // finché l'utente non inserisce il codice ricevuto via email (verifyEmail): token salvato, `user` impostato solo dopo.
  const register = async (email: string, password: string, name: string, extra?: RegisterExtra) => {
    const r = await api<{ token: string; user: User; promo?: { ok: boolean; code: string; message: string } | null; requires_email_verification?: boolean }>("/auth/register", {
      method: "POST",
      body: {
        email, password, name, product: "advisor", // V50.z323 — Axon Core: questa app è AdvisorOS
        last_name: extra?.lastName || undefined, promo_code: extra?.promoCode || undefined, plan: extra?.plan || undefined, org_plan: extra?.orgPlan || undefined,
        privacy_accepted: !!extra?.privacyAccepted, newsletter: !!extra?.newsletter,
        challenge_id: extra?.challengeId, pow_nonce: extra?.powNonce, turnstile_token: extra?.turnstileToken || undefined, hp: extra?.hp || "",
      },
    });
    await setToken(r.token);
    const iso = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    await saveTrust(iso);
    setTrustExpiresAt(iso);
    await storage.secureSet(LAST_UNLOCK_KEY, Date.now());
    if (r.requires_email_verification) {
      setPendingEmailVerification(r.user.email);
      return { promo: r.promo ?? null, requiresEmailVerification: true };
    }
    await syncPrefs();
    setUser(r.user);
    return { promo: r.promo ?? null, requiresEmailVerification: false };
  };

  const verifyEmail = async (code: string) => {
    const r = await api<{ ok: boolean; user: User }>("/auth/verify-email", { method: "POST", body: { code } });
    setPendingEmailVerification(null);
    await syncPrefs();
    setUser(r.user);
  };

  const resendEmailCode = async () => {
    const r = await api<{ ok: boolean; message?: string }>("/auth/verify-email/resend", { method: "POST" });
    return r.message || "Codice inviato.";
  };

  const loginGoogle = async () => {
    // V50.z272 — Emergent Google Auth secondo playbook: base auth FISSA https://auth.emergentagent.com
    // (l'env di deploy può contenere domini diversi, es. auth.emergent.host → "not found"); redirect per piattaforma;
    // su Android il callback può arrivare da result.url, dal listener `url` o da getInitialURL (dismiss ≠ annullato).
    const AUTH_BASE = "https://auth.emergentagent.com";
    const DEPLOY_BASE = (BACKEND_URL || "").replace(/\/+$/, ""); // V50.z373 — nessun host fisso: origine del sito o env di deploy
    let redirectUrl: string;
    // V50.z430 — Bug 1 (tablet/APK): Chrome Custom Tabs può bloccare il redirect automatico verso «frontend://» (pagina bianca
    // su emergentagent.com). Il redirect passa da una pagina https del backend (/api/auth/app-return) che riapre l'app con il
    // deep link e, se il browser lo blocca, mostra il bottone «Apri AdvisorOS». openAuthSessionAsync resta in ascolto sullo schema app.
    const appScheme = Platform.OS === "web" ? "" : Linking.createURL("");
    if (Platform.OS === "web") {
      const origin = typeof window !== "undefined" && window.location?.origin ? window.location.origin : "";
      redirectUrl = (origin || DEPLOY_BASE) + "/";
    } else {
      redirectUrl = DEPLOY_BASE ? `${DEPLOY_BASE}/api/auth/app-return?to=${encodeURIComponent(appScheme)}` : appScheme;
    }
    const authUrl = `${AUTH_BASE}/?redirect=${encodeURIComponent(redirectUrl)}`;
    if (Platform.OS === "web") {
      window.location.href = authUrl;
      return;
    }
    let hotUrl: string | null = null;
    const sub = Linking.addEventListener("url", (e) => { if (e?.url && /session_id=/.test(e.url)) hotUrl = e.url; });
    let cbUrl: string | null = null;
    try {
      const result = await WebBrowser.openAuthSessionAsync(authUrl, appScheme);
      if (result.type === "success" && result.url) cbUrl = result.url;
    } catch {}
    if (!cbUrl) {
      // V50.z430 — il deep link può arrivare qualche istante DOPO la chiusura della Custom Tab (bottone «Apri AdvisorOS»)
      for (let i = 0; i < 8 && !hotUrl; i++) await new Promise((r) => setTimeout(r, 400));
      cbUrl = hotUrl || (await Linking.getInitialURL().catch(() => null));
    }
    sub.remove();
    if (!cbUrl) return;
    const m = cbUrl.match(/[?#&]session_id=([^&#]+)/);
    if (!m) return;
    if (usedSessionIds.has(m[1])) return;
    usedSessionIds.add(m[1]);
    try {
      const r = await api<{ token: string; user: User }>("/auth/google-session", {
        method: "POST",
        body: { session_id: decodeURIComponent(m[1]), device: await getDeviceInfo() },
      });
      await setToken(r.token);
      const iso = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
      await saveTrust(iso);
      setTrustExpiresAt(iso);
      await storage.secureSet(LAST_UNLOCK_KEY, Date.now());
      await syncPrefs();
      setUser(r.user);
    } catch (e: any) {
      notify("Accesso Google non riuscito", e?.message || "Riprova tra qualche secondo.");
    }
  };

  // V50.z293 — dispositivo sospeso da un altro login dello stesso tipo → esci e avvisa
  useEffect(() => onDeviceSuspended(() => {
    void (async () => {
      await clearToken(); await saveTrust(null); setTrustExpiresAt(null); setUser(null); setLocked(false);
      notify("Sessione chiusa", "Il tuo account è stato aperto su un altro dispositivo dello stesso tipo: questo è stato disconnesso. Quando l'altro termina la sessione potrai rientrare.");
    })();
  }), []);

  const logout = async () => {
    try { await flushPrefs(); } catch { /* ignore */ }
    disablePrefsSync();
    try { await api("/auth/logout", { method: "POST" }); } catch {}
    await clearToken();
    await saveTrust(null);
    setTrustExpiresAt(null);
    await storage.secureRemove(LAST_UNLOCK_KEY);
    setPendingEmailVerification(null); // V50.z433
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

  // V50.z187 — usata dal modulo isolato `src/quickUnlock`
  const loginWithSession = async (token: string, u: User) => {
    await setToken(token);
    await storage.secureSet(LAST_UNLOCK_KEY, Date.now());
    setUser(u);
    setLocked(false);
  };

  const markUnlocked = async () => {
    await storage.secureSet(LAST_UNLOCK_KEY, Date.now());
    setLocked(false);
  };

  return (
    <Ctx.Provider value={{
      user, loading, loginEmail, verify2FA, register, loginGoogle, logout, refresh, loginWithSession,
      verifyEmail, resendEmailCode, pendingEmailVerification, // V50.z433
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

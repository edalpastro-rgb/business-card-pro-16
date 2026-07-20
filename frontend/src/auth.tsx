import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { Platform } from "react-native";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { api, getToken, setToken, clearToken } from "@/src/api";

export type User = {
  user_id: string;
  email: string;
  name: string;
  picture?: string | null;
  role: string;
  areas: string[];
};

type AuthCtx = {
  user: User | null;
  loading: boolean;
  loginEmail: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  loginGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

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
    })();
  }, [refresh]);

  const loginEmail = async (email: string, password: string) => {
    const r = await api<{ token: string; user: User }>("/auth/login", {
      method: "POST",
      body: { email, password },
    });
    await setToken(r.token);
    setUser(r.user);
  };

  const register = async (email: string, password: string, name: string) => {
    const r = await api<{ token: string; user: User }>("/auth/register", {
      method: "POST",
      body: { email, password, name },
    });
    await setToken(r.token);
    setUser(r.user);
  };

  const loginGoogle = async () => {
    const redirectUrl =
      Platform.OS === "web"
        ? (typeof window !== "undefined" ? window.location.origin + "/" : "")
        : Linking.createURL("");
    const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
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
    setUser(r.user);
  };

  const logout = async () => {
    try { await api("/auth/logout", { method: "POST" }); } catch {}
    await clearToken();
    setUser(null);
  };

  return (
    <Ctx.Provider value={{ user, loading, loginEmail, register, loginGoogle, logout, refresh }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used inside AuthProvider");
  return c;
}

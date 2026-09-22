// appStatePersist.ts — V50.z242 — BUG-STATE-001: persistenza stato app su background/foreground e cold start.
// • Ultima rotta (href + timestamp) salvata ad ogni navigazione → ripristinata al riavvio (solo nativo, entro 12 h).
// • Bozze campi testo (`useDraft`): salva in AsyncStorage con debounce, ricarica al mount, rimuove quando vuoto.
// • Flag «chat Axon aperta» per riaprire il pannello al rientro.
import { useCallback, useEffect, useRef } from "react";
import { AppState, NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const ROUTE_KEY = "nav_last_route_v2";
export const CHAT_OPEN_KEY = "axon_chat_open_v1";
export const ROUTE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/** Rotte da NON ripristinare (auth, landing, root, flussi transitori). */
export function isRestorableRoute(pathname: string): boolean {
  if (!pathname || pathname === "/" || pathname === "/index" || pathname === "/home" || pathname === "/(tabs)/home") return false;
  return !/^\/(login|landing|register|forgot|reset|auth|2fa|verify|voice-copilot|_sitemap)/.test(pathname);
}

/** Se un deeplink (tap su notifica) sta guidando la navigazione al cold start, il ripristino automatico viene saltato. */
export const navRestoreGuard = { skip: false, done: false, loaded: false };

export function buildHref(pathname: string, params: Record<string, any>): string {
  const q = Object.entries(params || {})
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .filter(([, v]) => !pathname.split("/").includes(String(v))) // i segmenti dinamici ([id]) sono già nel path
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(Array.isArray(v) ? v.join(",") : String(v))}`)
    .join("&");
  return q ? `${pathname}?${q}` : pathname;
}

export async function saveLastRoute(href: string): Promise<void> {
  try { await AsyncStorage.setItem(ROUTE_KEY, JSON.stringify({ href, at: Date.now() })); } catch { /* ignore */ }
}

export async function loadLastRoute(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(ROUTE_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as { href: string; at: number };
    if (!j?.href || Date.now() - Number(j.at || 0) > ROUTE_MAX_AGE_MS) return null;
    return j.href;
  } catch { return null; }
}

export async function clearLastRoute(): Promise<void> {
  try { await AsyncStorage.multiRemove([ROUTE_KEY, CHAT_OPEN_KEY]); } catch { /* ignore */ }
}

/** Bozza di un campo testo: ricarica al mount (solo se il campo è vuoto), salva con debounce, cancella quando vuoto. */
export function useDraft(key: string, value: string, setValue: (v: string) => void, enabled = true) {
  const loaded = useRef(false);
  const valueRef = useRef(value);
  valueRef.current = value;
  useEffect(() => {
    if (!enabled || loaded.current) return;
    loaded.current = true;
    AsyncStorage.getItem(key).then((d) => { if (d && !valueRef.current) setValue(d); }).catch(() => {});
  }, [key, enabled, setValue]);
  useEffect(() => {
    if (!enabled || !loaded.current) return;
    const t = setTimeout(() => {
      if (value) AsyncStorage.setItem(key, value).catch(() => {});
      else AsyncStorage.removeItem(key).catch(() => {});
    }, 600);
    return () => clearTimeout(t);
  }, [key, value, enabled]);
}

export async function clearDraft(key: string): Promise<void> {
  try { await AsyncStorage.removeItem(key); } catch { /* ignore */ }
}

// ── V50.z243 — Scroll memorizzato: posizione di scorrimento salvata (debounce + subito in background) e ripristinata al
// rimontaggio/riavvio appena il contenuto è abbastanza alto (entro 12 h). Funziona con FlatList (scrollToOffset) e ScrollView (scrollTo).
export function useScrollMemory(key: string) {
  const ref = useRef<any>(null);
  const y = useRef(0);
  const contentH = useRef(0);
  const saved = useRef<number | null>(null);
  const restored = useRef(false);
  const timer = useRef<any>(null);
  const storageKey = `scroll_pos_${key}`;

  const persist = useCallback(() => {
    AsyncStorage.setItem(storageKey, JSON.stringify({ y: y.current, at: Date.now() })).catch(() => {});
  }, [storageKey]);

  const tryRestore = useCallback(() => {
    if (restored.current || saved.current == null || !ref.current) return;
    if (saved.current <= 0) { restored.current = true; return; }
    if (contentH.current < saved.current + 100) return; // contenuto non ancora caricato del tutto
    restored.current = true;
    const r = ref.current;
    try {
      if (typeof r.scrollToOffset === "function") r.scrollToOffset({ offset: saved.current, animated: false });
      else if (typeof r.scrollTo === "function") r.scrollTo({ y: saved.current, animated: false });
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(storageKey).then((raw) => {
      if (!raw) return;
      const j = JSON.parse(raw) as { y: number; at: number };
      if (Date.now() - Number(j.at || 0) > ROUTE_MAX_AGE_MS) return;
      saved.current = Number(j.y) || 0;
      tryRestore();
    }).catch(() => {});
    const sub = AppState.addEventListener("change", (st) => { if (st === "background" || st === "inactive") persist(); });
    return () => { sub.remove(); if (timer.current) clearTimeout(timer.current); };
  }, [storageKey, persist, tryRestore]);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    y.current = e.nativeEvent.contentOffset.y;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(persist, 400);
  }, [persist]);

  const onContentSizeChange = useCallback((_w: number, h: number) => { contentH.current = h; tryRestore(); }, [tryRestore]);

  return { ref, onScroll, onContentSizeChange, scrollEventThrottle: 250 };
}

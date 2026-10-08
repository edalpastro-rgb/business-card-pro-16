// V50.z428 — PREFS SYNC: tutte le preferenze locali dell'utente specchiate sul server (GET/PUT /me/prefs) e ripristinate
// al login/avvio su dispositivo «vuoto» (APK reinstallata, aggiornamento, nuovo tablet). Funziona a livello di storage, senza
// toccare le singole schermate: patch di AsyncStorage (setItem/removeItem/multiSet/multiRemove) + della `storage.secureSet/
// secureRemove` (SecureStore) per le chiavi sensibili whitelisted (PIN aree critiche, blocco app, quick unlock).
// Esclusi: cache offline, code, bozze, token/sessioni, dati voluminosi/temporanei.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { api } from "@/src/api";
import { storage } from "@/src/utils/storage";

type PrefItem = { v: any; at: number };

// chiavi SecureStore da sincronizzare (hash PIN, non il PIN in chiaro; comunque protette dall'autenticazione dell'account)
const SECURE_ALLOW = new Set(["app_lock_pin_hash_v1", "app_lock_enabled_v1", "quick_unlock_v1", "app_lock_bio_v1", "personal_space_bio_enabled_v1"]);
// prefissi/chiavi locali da NON sincronizzare
const SKIP_PREFIX = ["pv_", "offc:", "offq", "offidmap", "draft_", "axon_chat_session", "auth", "token", "session", "cache", "wt_resume", "pending_referral",
  "post_reload_route", "axon_theme_pending", "download_dir", "k_recap", "nudge_", "weather_alert_dismissed_", "@expo", "expo", "EXPO", "react-navigation",
  "persist:", "sentry", "__", "landing_seen", "trust_", "advisoros.device", "axs_device", "app_last_unlock", "device_", "push_token", "expo_push", "app_bg_at", "axon_chat_read_at"];
const MAX_VALUE = 60 * 1024;

const shouldSync = (key: string, secure = false) => {
  if (secure) return SECURE_ALLOW.has(key);
  const k = key.toLowerCase();
  return !SKIP_PREFIX.some((p) => k.startsWith(p.toLowerCase()));
};

let installed = false;
let enabled = false; // true solo con utente loggato
let pending: Record<string, PrefItem> = {};
let timer: ReturnType<typeof setTimeout> | null = null;
let origSet: typeof AsyncStorage.setItem;
let origRemove: typeof AsyncStorage.removeItem;
let origSecureSet: typeof storage.secureSet;

function queue(key: string, v: any) {
  if (!enabled) return;
  if (v !== null && typeof v === "string" && v.length > MAX_VALUE) return;
  pending[key] = { v, at: Date.now() };
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flush(), 1500);
}

export async function flush(): Promise<void> {
  if (!enabled) return;
  const batch = pending; pending = {};
  if (!Object.keys(batch).length) return;
  try {
    await api("/me/prefs", { method: "PUT", body: { prefs: batch, device: Platform.OS } });
  } catch {
    // offline / errore → rimetti in coda (senza sovrascrivere valori più nuovi)
    for (const [k, it] of Object.entries(batch)) if (!pending[k] || pending[k].at < it.at) pending[k] = it;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void flush(), 15000);
  }
}

export function installPrefsSync(): void {
  if (installed) return;
  installed = true;
  origSet = AsyncStorage.setItem.bind(AsyncStorage);
  origRemove = AsyncStorage.removeItem.bind(AsyncStorage);
  const origMultiSet = AsyncStorage.multiSet.bind(AsyncStorage);
  const origMultiRemove = AsyncStorage.multiRemove.bind(AsyncStorage);
  AsyncStorage.setItem = async (key: string, value: string, cb?: any) => {
    const r = await origSet(key, value, cb);
    if (shouldSync(key)) queue(key, value);
    return r;
  };
  AsyncStorage.removeItem = async (key: string, cb?: any) => {
    const r = await origRemove(key, cb);
    if (shouldSync(key)) queue(key, null);
    return r;
  };
  AsyncStorage.multiSet = async (pairs: readonly (readonly [string, string])[], cb?: any) => {
    const r = await origMultiSet(pairs, cb);
    for (const [k, v] of pairs) if (shouldSync(k)) queue(k, v);
    return r;
  };
  AsyncStorage.multiRemove = async (keys: readonly string[], cb?: any) => {
    const r = await origMultiRemove(keys as string[], cb);
    for (const k of keys) if (shouldSync(k)) queue(k, null);
    return r;
  };
  origSecureSet = storage.secureSet.bind(storage);
  const origSecureRemove = storage.secureRemove.bind(storage);
  storage.secureSet = (async (key: string, value: any) => {
    const ok = await origSecureSet(key, value);
    if (ok && shouldSync(key, true)) queue(`secure:${key}`, JSON.stringify(value));
    return ok;
  }) as typeof storage.secureSet;
  storage.secureRemove = (async (key: string) => {
    const ok = await origSecureRemove(key);
    if (ok && shouldSync(key, true)) queue(`secure:${key}`, null);
    return ok;
  }) as typeof storage.secureRemove;
}

/** Al login/avvio con utente valido: scarica le preferenze dal server e ripristina quelle MANCANTI in locale
 *  (dispositivo nuovo / APK reinstallata). Le chiavi presenti in locale ma assenti sul server vengono caricate sul server. */
export async function restorePrefsFromServer(): Promise<{ restored: number; uploaded: number }> {
  enabled = true;
  let restored = 0, uploaded = 0;
  try {
    const r = await api<{ prefs: Record<string, PrefItem> }>("/me/prefs");
    const remote = r.prefs || {};
    const localKeys = new Set((await AsyncStorage.getAllKeys()) as string[]);
    for (const [key, it] of Object.entries(remote)) {
      if (it?.v === null || it?.v === undefined) continue;
      if (key.startsWith("secure:")) {
        const sk = key.slice(7);
        const cur = await storage.secureGet<any>(sk, null);
        if (cur === null || cur === undefined) {
          try { await origSecureSet(sk, JSON.parse(String(it.v))); restored++; } catch { /* ignore */ }
        }
        continue;
      }
      if (!localKeys.has(key)) { await origSet(key, String(it.v)); restored++; }
    }
    // upload delle chiavi locali che il server non ha ancora (prima attivazione del sync su un dispositivo già configurato)
    const toUpload: Record<string, PrefItem> = {};
    for (const key of localKeys) {
      if (!shouldSync(key) || remote[key]) continue;
      const v = await AsyncStorage.getItem(key);
      if (v !== null && v.length <= MAX_VALUE) toUpload[key] = { v, at: Date.now() - 1 };
    }
    for (const sk of SECURE_ALLOW) {
      if (remote[`secure:${sk}`]) continue;
      const cur = await storage.secureGet<any>(sk, null);
      if (cur !== null && cur !== undefined) toUpload[`secure:${sk}`] = { v: JSON.stringify(cur), at: Date.now() - 1 };
    }
    if (Object.keys(toUpload).length) {
      try { await api("/me/prefs", { method: "PUT", body: { prefs: toUpload, device: Platform.OS } }); uploaded = Object.keys(toUpload).length; } catch { /* riprova al prossimo avvio */ }
    }
  } catch { /* offline: si riprova al prossimo avvio */ }
  return { restored, uploaded };
}

export function disablePrefsSync(): void { enabled = false; pending = {}; }

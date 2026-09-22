// offline.ts — V50.z279 — MODALITÀ AEREO / OFFLINE
// 1) Cache di lettura: ogni GET riuscita viene salvata (AsyncStorage) → senza rete `api()` restituisce l'ultimo dato.
// 2) Coda di scrittura: POST/PUT/PATCH/DELETE senza rete vengono accodate con risposta ottimistica (id temporanei `tmp_…`)
//    e applicate alla cache locale (liste/dettagli) così l'app resta coerente; al ritorno online la coda viene inviata
//    in ordine a `POST /offline/replay` (idempotente, rileva i conflitti e avvisa il Master).
// 3) Stato rete osservabile (`useOffline`), precaricamento sezioni principali, pannello /offline-sync.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

export type Method = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
export type QueuedOp = {
  op_id: string; method: Method; path: string; query?: Record<string, any>; body?: any; queued_at: string;
  label: string; status: "pending" | "failed" | "conflict"; error?: string; tmp_id?: string; id_key?: string; base_updated_at?: string;
};
export type OfflineState = { offline: boolean; pending: number; failed: number; syncing: boolean; lastSync: string | null; lastResult: string | null };

export class OfflineError extends Error { offline = true; constructor(msg: string) { super(msg); this.name = "OfflineError"; } }

const CACHE_PREFIX = "offc:"; const INDEX_KEY = "offc:index:v1"; const QUEUE_KEY = "offq:v1"; const IDMAP_KEY = "offidmap:v1";
const MAX_ENTRY = 400 * 1024; const MAX_TOTAL = 12 * 1024 * 1024; const MAX_BODY = 250 * 1024;
type IndexEntry = { path: string; q: string; at: number; size: number };

let state: OfflineState = { offline: false, pending: 0, failed: 0, syncing: false, lastSync: null, lastResult: null };
const listeners = new Set<(s: OfflineState) => void>();
let scope = "anon"; let index: Record<string, IndexEntry> | null = null; let queue: QueuedOp[] | null = null; let idMap: Record<string, string> | null = null;
let replayFn: ((op: QueuedOp) => Promise<{ status: number; data: any; conflict?: boolean; error?: string }>) | null = null;
let pingFn: (() => Promise<boolean>) | null = null; let pingTimer: any = null;

function emit() { listeners.forEach((l) => l(state)); }
function set(p: Partial<OfflineState>) { state = { ...state, ...p }; emit(); }
export function getOfflineState() { return state; }
export function subscribeOffline(l: (s: OfflineState) => void) { listeners.add(l); l(state); return () => { listeners.delete(l); }; }
export function setOfflineScope(userKey: string | null) { scope = userKey ? userKey.slice(-16) : "anon"; }
export function isOffline() { return state.offline; }
/** Collega le funzioni che dipendono da `api()` (evita import circolari). */
export function bindOfflineTransport(replay: typeof replayFn, ping: typeof pingFn) { replayFn = replay; pingFn = ping; }

// ---------- rete ----------
export function markOffline() {
  if (!state.offline) { set({ offline: true }); startPing(); }
}
export function markOnline() {
  const was = state.offline;
  if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
  if (was) { set({ offline: false }); void syncQueue(); }
}
function startPing() {
  if (pingTimer) return;
  pingTimer = setInterval(async () => {
    if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.onLine === false) return;
    try { if (pingFn && (await pingFn())) markOnline(); } catch { /* ancora offline */ }
  }, 15000);
}
if (Platform.OS === "web" && typeof window !== "undefined") {
  window.addEventListener("offline", () => markOffline());
  window.addEventListener("online", () => { void (async () => { try { if (!pingFn || (await pingFn())) markOnline(); } catch { /* noop */ } })(); });
}

// ---------- cache ----------
const norm = (path: string, q: string) => `${scope}|${path}|${q || ""}`;
async function loadIndex() { if (index) return index; try { index = JSON.parse((await AsyncStorage.getItem(INDEX_KEY)) || "{}"); } catch { index = {}; } return index!; }
let saveIdxTimer: any = null;
function saveIndexSoon() { if (saveIdxTimer) return; saveIdxTimer = setTimeout(async () => { saveIdxTimer = null; try { await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(index || {})); } catch { /* noop */ } }, 800); }

export async function cacheSet(path: string, q: string, data: any) {
  try {
    const raw = JSON.stringify({ at: Date.now(), data });
    if (raw.length > MAX_ENTRY) return;
    const idx = await loadIndex(); const key = norm(path, q);
    await AsyncStorage.setItem(CACHE_PREFIX + key, raw);
    idx[key] = { path, q, at: Date.now(), size: raw.length };
    let total = Object.values(idx).reduce((a, e) => a + e.size, 0);
    if (total > MAX_TOTAL) {
      for (const [k, e] of Object.entries(idx).sort((a, b) => a[1].at - b[1].at)) { if (total <= MAX_TOTAL * 0.8) break; await AsyncStorage.removeItem(CACHE_PREFIX + k); delete idx[k]; total -= e.size; }
    }
    saveIndexSoon();
  } catch { /* noop */ }
}
export async function cacheGet(path: string, q: string): Promise<{ data: any; at: number } | null> {
  try {
    const exact = await AsyncStorage.getItem(CACHE_PREFIX + norm(path, q));
    if (exact) return JSON.parse(exact);
    // fallback: stesso path senza filtri (lista completa) → gli screen filtrano lato client
    const idx = await loadIndex();
    const cand = Object.entries(idx).filter(([k, e]) => k.startsWith(`${scope}|`) && e.path === path && !e.q).sort((a, b) => b[1].at - a[1].at)[0];
    if (cand) { const raw = await AsyncStorage.getItem(CACHE_PREFIX + cand[0]); if (raw) return JSON.parse(raw); }
  } catch { /* noop */ }
  return null;
}
async function cachePatch(path: string, q: string, fn: (data: any) => any) {
  const key = norm(path, q); const raw = await AsyncStorage.getItem(CACHE_PREFIX + key); if (!raw) return;
  try { const e = JSON.parse(raw); const nd = fn(e.data); if (nd !== undefined) await AsyncStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ at: e.at, data: nd })); } catch { /* noop */ }
}
async function cacheEntriesForPath(path: string): Promise<IndexEntry[]> { const idx = await loadIndex(); return Object.entries(idx).filter(([k, e]) => k.startsWith(`${scope}|`) && e.path === path).map(([, e]) => e); }
export async function cacheInvalidatePrefix(prefix: string) {
  const idx = await loadIndex();
  for (const [k, e] of Object.entries(idx)) if (k.startsWith(`${scope}|`) && e.path.startsWith(prefix)) { await AsyncStorage.removeItem(CACHE_PREFIX + k); delete idx[k]; }
  saveIndexSoon();
}
export async function cacheStats() { const idx = await loadIndex(); const mine = Object.entries(idx).filter(([k]) => k.startsWith(`${scope}|`)); return { entries: mine.length, bytes: mine.reduce((a, [, e]) => a + e.size, 0), newest: mine.reduce((a, [, e]) => Math.max(a, e.at), 0) }; }
export async function cacheClear() { const idx = await loadIndex(); for (const k of Object.keys(idx)) { await AsyncStorage.removeItem(CACHE_PREFIX + k); } index = {}; saveIndexSoon(); }

// ---------- coda ----------
const DENY = /^\/(ai|axon|assistant|scanner|ocr|auth|tour|stress|push|voice|whisper|tts|geo|email|mail|upload|import|export|reports?\/generate|form-templates\/fill|identity-docs\/ocr|offline)|\/(pptx|pdf|slides\/generate|report\/transcribe|files|photos|ocr|share|send|dispatch)(\/|$)/i;
const ID_KEYS: Record<string, string> = { contacts: "contact_id", appointments: "appointment_id", notes: "note_id", callbacks: "callback_id", courses: "course_id", deadlines: "deadline_id", groups: "group_id", tasks: "task_id", activities: "activity_id", calls: "call_id", deals: "deal_id", visits: "visit_id" };
const LABELS: Record<string, string> = { contacts: "Cliente", appointments: "Appuntamento", notes: "Nota", callbacks: "Richiamata", courses: "Corso", deadlines: "Scadenza", groups: "Gruppo", tasks: "Attività", activities: "Attività", calls: "Chiamata", deals: "Trattativa", visits: "Visita" };
const VERB: Record<string, string> = { POST: "Creazione", PUT: "Modifica", PATCH: "Modifica", DELETE: "Eliminazione" };

export function canQueue(path: string, method: Method, body?: any): boolean {
  if (method === "GET" || DENY.test(path)) return false;
  if (body && JSON.stringify(body).length > MAX_BODY) return false;
  return true;
}
async function loadQueue() { if (queue) return queue; try { queue = JSON.parse((await AsyncStorage.getItem(QUEUE_KEY)) || "[]"); } catch { queue = []; } return queue!; }
async function saveQueue() { await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue || [])); set({ pending: (queue || []).filter((o) => o.status === "pending").length, failed: (queue || []).filter((o) => o.status !== "pending").length }); }
async function loadIdMap() { if (idMap) return idMap; try { idMap = JSON.parse((await AsyncStorage.getItem(IDMAP_KEY)) || "{}"); } catch { idMap = {}; } return idMap!; }
export async function getQueue() { return [...(await loadQueue())]; }
export async function initOffline() { await loadQueue(); await loadIdMap(); await saveQueue(); }

function segs(path: string) { return path.split("?")[0].split("/").filter(Boolean); }
function describe(method: Method, path: string, body: any): { label: string; entity: string; idKey: string } {
  const s = segs(path); const entity = s.length >= 3 && LABELS[s[2]] ? s[2] : s[0];
  const name = body?.first_name || body?.title || body?.name ? ` «${[body?.first_name, body?.last_name].filter(Boolean).join(" ") || body?.title || body?.name}»` : "";
  return { label: `${VERB[method] || method} ${LABELS[entity] || entity}${name}`, entity, idKey: ID_KEYS[entity] || "id" };
}

/** Accoda una scrittura offline e restituisce una risposta ottimistica; aggiorna la cache locale (liste + dettaglio). */
export async function enqueue(method: Method, path: string, query: Record<string, any> | undefined, body: any): Promise<any> {
  const q = await loadQueue(); const { label, idKey } = describe(method, path, body); const s = segs(path);
  const op: QueuedOp = { op_id: `op_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, method, path, query, body, queued_at: new Date().toISOString(), label, status: "pending", id_key: idKey };
  let optimistic: any = { ok: true, _pending: true };
  if (method === "POST" && s.length === 1) {                       // creazione in una collezione → id temporaneo
    op.tmp_id = `tmp_${Math.random().toString(36).slice(2, 12)}`;
    optimistic = { ...(body || {}), [idKey]: op.tmp_id, _pending: true, created_at: op.queued_at, updated_at: op.queued_at };
    for (const e of await cacheEntriesForPath(`/${s[0]}`)) await cachePatch(e.path, e.q, (d) => Array.isArray(d) ? [optimistic, ...d] : d && Array.isArray(d.items) ? { ...d, items: [optimistic, ...d.items], total: (d.total || d.items.length) + 1 } : d);
    await cacheSet(`/${s[0]}/${op.tmp_id}`, "", optimistic);
  } else if ((method === "PUT" || method === "PATCH") && s.length === 2) {  // modifica dettaglio
    const cur = await cacheGet(`/${s[0]}/${s[1]}`, "");
    op.base_updated_at = cur?.data?.updated_at;
    optimistic = { ...(cur?.data || {}), ...(body || {}), [idKey]: s[1], _pending: true, updated_at: op.queued_at };
    await cacheSet(`/${s[0]}/${s[1]}`, "", optimistic);
    for (const e of await cacheEntriesForPath(`/${s[0]}`)) await cachePatch(e.path, e.q, (d) => { const upd = (x: any) => (x && x[idKey] === s[1] ? { ...x, ...(body || {}), _pending: true } : x); return Array.isArray(d) ? d.map(upd) : d && Array.isArray(d.items) ? { ...d, items: d.items.map(upd) } : d; });
  } else if (method === "DELETE" && s.length === 2) {
    for (const e of await cacheEntriesForPath(`/${s[0]}`)) await cachePatch(e.path, e.q, (d) => { const keep = (x: any) => !(x && x[idKey] === s[1]); return Array.isArray(d) ? d.filter(keep) : d && Array.isArray(d.items) ? { ...d, items: d.items.filter(keep) } : d; });
    await cacheInvalidatePrefix(`/${s[0]}/${s[1]}`);
    if (s[1].startsWith("tmp_")) { queue = q.filter((o) => o.tmp_id !== s[1] && !o.path.includes(s[1])); await saveQueue(); return { ok: true, _pending: true }; }
  } else if (method === "POST" && s.length === 3) {                 // sotto-risorsa (note, attività, partecipazione…) → il dettaglio si aggiorna al sync
    optimistic = { ...(body || {}), [ID_KEYS[s[2]] || "id"]: `tmp_${Math.random().toString(36).slice(2, 12)}`, _pending: true, created_at: op.queued_at };
  }
  q.push(op); await saveQueue();
  return optimistic;
}

function rewrite<T>(v: T, map: Record<string, string>): T {
  if (typeof v === "string") return (map[v] || v) as any;
  if (Array.isArray(v)) return v.map((x) => rewrite(x, map)) as any;
  if (v && typeof v === "object") { const o: any = {}; for (const [k, x] of Object.entries(v as any)) o[k] = rewrite(x, map); return o; }
  return v;
}
function rewritePath(path: string, map: Record<string, string>) { return path.split("/").map((p) => map[p] || p).join("/"); }

/** Invia la coda al server (in ordine). Si ferma al primo errore di rete; gli errori applicativi restano in coda come «falliti». */
export async function syncQueue(): Promise<{ done: number; failed: number; conflicts: number }> {
  const res = { done: 0, failed: 0, conflicts: 0 };
  if (state.syncing || !replayFn) return res;
  const q = await loadQueue(); const map = await loadIdMap();
  if (!q.some((o) => o.status === "pending")) return res;
  set({ syncing: true });
  const touched = new Set<string>();
  try {
    for (const op of [...q]) {
      if (op.status !== "pending") continue;
      const sent: QueuedOp = { ...op, path: rewritePath(op.path, map), body: rewrite(op.body, map), query: rewrite(op.query, map) };
      if (/\/tmp_/.test(sent.path)) { op.status = "failed"; op.error = "L'elemento collegato non è stato creato"; res.failed++; continue; }
      let r: { status: number; data: any; conflict?: boolean; error?: string };
      try { r = await replayFn(sent); } catch (e: any) { if (e?.offline || /rete|connessione|network|fetch/i.test(String(e?.message))) { markOffline(); break; } r = { status: 0, data: null, error: e?.message || String(e) }; }
      touched.add(`/${segs(op.path)[0]}`);
      if (r.status >= 200 && r.status < 300) {
        if (op.tmp_id && r.data && op.id_key && r.data[op.id_key]) { map[op.tmp_id] = r.data[op.id_key]; await cacheInvalidatePrefix(`/${segs(op.path)[0]}/${op.tmp_id}`); }
        queue = (queue || []).filter((o) => o.op_id !== op.op_id); res.done++;
        if (r.conflict) res.conflicts++;
      } else { op.status = r.conflict ? "conflict" : "failed"; op.error = r.error || `Errore ${r.status}`; res.failed++; }
      await saveQueue();
    }
    await AsyncStorage.setItem(IDMAP_KEY, JSON.stringify(map));
    for (const p of touched) await cacheInvalidatePrefix(p);
    if (res.done || res.failed) set({ lastSync: new Date().toISOString(), lastResult: `${res.done} sincronizzate${res.failed ? `, ${res.failed} da controllare` : ""}${res.conflicts ? `, ${res.conflicts} conflitti segnalati al Master` : ""}` });
  } finally { set({ syncing: false }); await saveQueue(); }
  return res;
}
export async function retryOp(op_id: string) { const q = await loadQueue(); const op = q.find((o) => o.op_id === op_id); if (op) { op.status = "pending"; op.error = undefined; await saveQueue(); void syncQueue(); } }
export async function dropOp(op_id: string) { queue = (await loadQueue()).filter((o) => o.op_id !== op_id); await saveQueue(); }

// ---------- precaricamento ----------
export const PREFETCH_PATHS = ["/auth/me", "/user-settings", "/settings", "/contacts", "/appointments", "/appointments/stats", "/calendar/team", "/calendar/team-members", "/groups", "/callbacks", "/deadlines/upcoming", "/courses", "/team/members", "/axon-notifications", "/master/info", "/reports", "/my-thing", "/chat/channels", "/subscription/status", "/tour/features", "/identity-documents", "/form-templates"];

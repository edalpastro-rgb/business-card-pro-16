/**
 * V50.z337 — Scanner offline: se la connessione cade durante la generazione/salvataggio del PDF il lavoro
 * (pagine già elaborate + nome + opzioni) viene salvato in locale e ripreso AUTOMATICAMENTE al ritorno
 * della rete, senza errori bloccanti.
 *
 *  - `savePendingScan(job)`   → salva su file (nativo) / memoria (web)
 *  - `loadPendingScan()` / `clearPendingScan()`
 *  - `startScannerResumeWatcher()` → una sola volta in _layout: ascolta lo stato offline/online del
 *    trasporto (`subscribeOffline`) e riprende il job appena si torna online (o all'avvio se c'è rete).
 *  - `runPendingScanJob(job)` → merge-pdf + salvataggio in I miei file (+ file cliente), notifica finale.
 */
import { Platform } from "react-native";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { subscribeOffline, isOffline } from "@/src/offline";

export type PendingScanPage = { data_base64: string; mime: string; already_cropped: boolean; already_processed: boolean; ocr: any | null };
export type PendingScanJob = {
  id: string;
  created_at: string;
  name: string;
  pages: PendingScanPage[];
  enhance: boolean;
  autocrop: boolean;
  grayscale: boolean;
  contactId?: string | null;
  source?: string | null;
};

const FILE_NAME = "scanner_pending_job_v1.json";
let memJob: PendingScanJob | null = null; // web / fallback

async function filePath(): Promise<string | null> {
  if (Platform.OS === "web") return null;
  try {
    const FS = await import("expo-file-system/legacy");
    const dir = FS.documentDirectory || FS.cacheDirectory;
    return dir ? `${dir}${FILE_NAME}` : null;
  } catch {
    return null;
  }
}

export async function savePendingScan(job: PendingScanJob): Promise<void> {
  memJob = job;
  const p = await filePath();
  if (!p) return;
  try {
    const FS = await import("expo-file-system/legacy");
    await FS.writeAsStringAsync(p, JSON.stringify(job));
  } catch { /* resta in memoria */ }
}

export async function loadPendingScan(): Promise<PendingScanJob | null> {
  if (memJob) return memJob;
  const p = await filePath();
  if (!p) return null;
  try {
    const FS = await import("expo-file-system/legacy");
    const info = await FS.getInfoAsync(p);
    if (!info.exists) return null;
    const raw = await FS.readAsStringAsync(p);
    const j = JSON.parse(raw) as PendingScanJob;
    if (j && Array.isArray(j.pages) && j.pages.length) { memJob = j; return j; }
  } catch { /* nessun job */ }
  return null;
}

export async function clearPendingScan(): Promise<void> {
  memJob = null;
  const p = await filePath();
  if (!p) return;
  try {
    const FS = await import("expo-file-system/legacy");
    await FS.deleteAsync(p, { idempotent: true });
  } catch { /* noop */ }
}

/** Esegue merge-pdf + salvataggio. Lancia se la rete manca (il chiamante decide se salvare il job). */
export async function runPendingScanJob(job: PendingScanJob): Promise<{ pdf_base64: string; name: string; page_count: number; ocr_text?: string; text_hash?: string | null }> {
  const r = await api<{ pdf_base64: string; name: string; page_count: number; ocr_text?: string; ocr_conf?: number | null; text_hash?: string | null }>(
    "/scanner/merge-pdf",
    { method: "POST", body: { pages: job.pages, enhance: job.enhance, autocrop: job.autocrop, grayscale: job.grayscale, name: job.name, ocr: true } },
  );
  const fname = r.name.toLowerCase().endsWith(".pdf") ? r.name : `${r.name}.pdf`;
  const bytes = Math.floor((r.pdf_base64.length * 3) / 4);
  const saves: Promise<unknown>[] = [
    api("/master-files", { method: "POST", body: { category: job.source === "bills" ? "bills" : "scanner", name: fname, mime: "application/pdf", data_base64: r.pdf_base64, size: bytes, source: job.source || (job.contactId ? "contact" : "widget"), source_contact_id: job.contactId || null, ocr_text: r.ocr_text || null, text_hash: r.text_hash || null } }),
  ];
  if (job.contactId) saves.push(api(`/contacts/${job.contactId}/files`, { method: "POST", body: { name: fname, mime: "application/pdf", data_base64: r.pdf_base64, size: bytes } }));
  const results = await Promise.allSettled(saves);
  const failed = results.filter((x) => x.status === "rejected") as PromiseRejectedResult[];
  if (failed.length) throw (failed[0].reason instanceof Error ? failed[0].reason : new Error(String(failed[0].reason)));
  return r;
}

export function isNetworkError(e: unknown): boolean {
  const any = e as any;
  if (any?.offline === true || any?.name === "OfflineError") return true;
  const msg = String(any?.message || any || "");
  return /failed to fetch|network request failed|networkerror|load failed|offline|timeout|non raggiungibile/i.test(msg);
}

let watcherStarted = false;
let resuming = false;

async function tryResume(): Promise<void> {
  if (resuming) return;
  const job = await loadPendingScan();
  if (!job || isOffline()) return;
  resuming = true;
  try {
    const r = await runPendingScanJob(job);
    await clearPendingScan();
    notify("PDF salvato ✅", `«${r.name}» (${r.page_count} pag.) è stato completato e archiviato in I miei file › ${job.source === "bills" ? "Fatture" : "Scanner"} appena tornata la connessione.`);
  } catch (e) {
    if (!isNetworkError(e)) {
      // errore non di rete (es. pagine non valide): il job non può riuscire → non insistere
      await clearPendingScan();
      notify("Scansione non completata", String((e as any)?.message || e));
    }
  } finally {
    resuming = false;
  }
}

export function startScannerResumeWatcher(): () => void {
  if (watcherStarted) return () => {};
  watcherStarted = true;
  let wasOffline = isOffline();
  const unsub = subscribeOffline((s) => {
    if (wasOffline && !s.offline) void tryResume();
    wasOffline = s.offline;
  });
  // all'avvio (rete presente) + controllo periodico di sicurezza ogni 60 s
  void tryResume();
  const t = setInterval(() => { void tryResume(); }, 60000);
  return () => { unsub(); clearInterval(t); watcherStarted = false; };
}

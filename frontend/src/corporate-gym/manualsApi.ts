// Corporate Gym — Manuali su Google Drive (AxonOS gestore manuali). Client API isolato.
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Router } from "expo-router";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { api } from "@/src/api";
import type { CgymType } from "@/src/corporate-gym/api";

export type CgymManualRef = { kind: "folder" | "file"; id: string; name?: string | null; mime?: string | null };

export type CgymManualsConfig = {
  configured: boolean;
  root_folder_id: string | null;
  root_folder_name: string | null;
  links: Partial<Record<CgymType, CgymManualRef>>;
  updated_at: string | null;
  can_edit: boolean;
  master_drive_connected: boolean;
  drive_configured: boolean;
  types: { type: CgymType; label: string; link: CgymManualRef | null; soft_message: string | null }[];
};

export type CgymManualFile = {
  id: string;
  name: string;
  mime: string | null;
  is_folder?: boolean;
  size: number | null;
  modified_time: string | null;
  web_view_link: string | null;
  exportable: boolean;
  readable?: boolean;
};

export type CgymManualsList = {
  type?: CgymType;
  label?: string;
  items: CgymManualFile[];
  missing_subfolder?: boolean;
  linked: boolean;
  soft_message: string | null;
  link?: CgymManualRef | null;
  root_folder_name?: string | null;
  fetched_at?: string;
};

export type CgymManualLink = CgymManualFile & { url: string; download_url: string; expires_at: string };

export type DriveFolder = { id: string; name: string; path?: string };

export const cgymManualsApi = {
  config: () => api<CgymManualsConfig>("/cgym/manuals/config"),
  /** V50.z203 — collega manualmente cartella O file Drive a una sezione (solo Master Coach). */
  setLink: (body: { type: CgymType; kind: "folder" | "file"; id: string; name?: string }) => api<CgymManualsConfig>("/cgym/manuals/config", { method: "PUT", body }),
  clearLink: (type?: CgymType) => api<{ ok: boolean }>("/cgym/manuals/config", { method: "DELETE", query: { type } }),
  list: (type: CgymType, q?: string) => api<CgymManualsList>(`/cgym/manuals/${type}`, { query: { q } }),
  /** Manuali di un riferimento (sezione o fase). */
  listRef: (ref: CgymManualRef, q?: string) => api<CgymManualsList>("/cgym/manuals/ref", { query: { kind: ref.kind, id: ref.id, q } }),
  link: (type: CgymType | "any", fileId: string) => api<CgymManualLink>(`/cgym/manuals/${type}/files/${fileId}/link`, { method: "POST" }),
  /** Browser Drive del Master: cartelle E file. */
  browse: (parent: string, q?: string) => api<{ parent: string; items: CgymManualFile[]; folders: CgymManualFile[]; files: CgymManualFile[]; global_search: boolean }>("/cgym/manuals/browse", { query: { parent, q } }),
  browseFolders: (parent: string, q?: string) =>
    api<{ folders: DriveFolder[]; global_search?: boolean }>("/google-drive/folders/browse", { query: { parent, q } }),
  driveStatus: () => api<{ connected: boolean; configured: boolean; google_email?: string }>("/google-drive/status"),
};

export function fmtManualSize(bytes: number | null): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function fmtManualDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
}

/** V50.z400 — Pagina iniziale per sezione: il manuale Obiezioni si apre direttamente a pagina 13 (le prime 12 sono introduzione). */
export const CGYM_MANUAL_START_PAGE: Partial<Record<CgymType, number>> = { obiezioni: 13 };

export type PdfOpenOpts = { page?: number; authToken?: string | null; downloadUrl?: string | null; mime?: string | null };

/** V50.z400 — Apre un PDF nel VISUALIZZATORE INTERNO (/pdf-viewer, pdf.js in WebView): nessun PDF esce mai dall'app.
 *  Immagini e altri formati → InAppWebViewer (/webviewer). Web: nuova scheda del browser (con #page=). */
export function openPdfInApp(router: Router, url: string, name: string, opts: PdfOpenOpts = {}) {
  const isPdf = !opts.mime || opts.mime.includes("pdf") || /\.pdf$/i.test(name);
  const page = Math.max(1, opts.page || 1);
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") window.open(url + (isPdf && page > 1 ? `#page=${page}` : ""), "_blank", "noopener");
    return;
  }
  if (!isPdf) { router.push(`/webviewer?url=${encodeURIComponent(url)}&title=${encodeURIComponent(name)}` as any); return; }
  const q = new URLSearchParams({ url, name, page: String(page), ...(opts.authToken ? { auth: "1" } : {}), ...(opts.downloadUrl ? { dl: opts.downloadUrl } : {}), ...(opts.mime ? { mime: opts.mime } : {}) });
  router.push(`/pdf-viewer?${q.toString()}` as any);
}

/** Apre il manuale DENTRO l'app (V50.z400; prima: browser esterno). `type` decide la pagina iniziale (Obiezioni → 13). */
export function openManual(router: Router, link: CgymManualLink, type?: CgymType | "any" | null) {
  const page = type && type !== "any" ? CGYM_MANUAL_START_PAGE[type] : undefined;
  openPdfInApp(router, link.url, link.name, { page, downloadUrl: link.download_url, mime: link.mime });
}

const DOWNLOAD_DIR_KEY = "cgym_download_dir_uri";
const ANDROID_DOWNLOADS_TREE = "content://com.android.externalstorage.documents/tree/primary%3ADownload";

/** Android: salva `base64` nella cartella Download (Storage Access Framework). La cartella viene scelta UNA volta e ricordata.
 *  V50.z400 — permesso negato/annullato: NIENTE vicolo cieco → ritorna null e il chiamante ripiega sul pannello «Salva in…». */
export async function saveToAndroidDownloads(name: string, mime: string, base64: string): Promise<string | null> {
  const SAF = FileSystem.StorageAccessFramework;
  let dir = await AsyncStorage.getItem(DOWNLOAD_DIR_KEY);
  const tryCreate = async (d: string) => { const uri = await SAF.createFileAsync(d, name, mime); await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 }); return uri; };
  if (dir) {
    try { return await tryCreate(dir); } catch { dir = null; await AsyncStorage.removeItem(DOWNLOAD_DIR_KEY); }
  }
  let perm: { granted: boolean; directoryUri?: string } = { granted: false };
  try { perm = await SAF.requestDirectoryPermissionsAsync(ANDROID_DOWNLOADS_TREE) as any; } catch { /* alcuni dispositivi rifiutano initialUri */ }
  if (!perm.granted) {
    try { perm = await SAF.requestDirectoryPermissionsAsync() as any; } catch { perm = { granted: false }; } // seconda chance senza cartella suggerita
  }
  if (!perm.granted || !perm.directoryUri) return null;
  await AsyncStorage.setItem(DOWNLOAD_DIR_KEY, perm.directoryUri);
  try { return await tryCreate(perm.directoryUri); } catch { await AsyncStorage.removeItem(DOWNLOAD_DIR_KEY); return null; }
}

/** V50.z400 — Salva un file locale (cache) sul dispositivo: Android → cartella Download (SAF), se il permesso viene negato →
 *  pannello «Salva in…» di sistema (mai un errore secco) · iOS → «Salva su File». Ritorna il messaggio da mostrare. */
export async function saveLocalFileToDevice(localUri: string, name: string, mime: string): Promise<string> {
  if (Platform.OS === "android") {
    const b64 = await FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 });
    const saved = await saveToAndroidDownloads(name, mime, b64);
    if (saved) return "Salvato nella cartella Download";
  }
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(localUri, { mimeType: mime, dialogTitle: Platform.OS === "android" ? "Salva in…" : name, UTI: mime.includes("pdf") ? "com.adobe.pdf" : undefined });
    return Platform.OS === "android" ? "Scegli dove salvare il file" : "File pronto";
  }
  throw new Error("Salvataggio non disponibile su questo dispositivo");
}

/** V50.z400 — Scarica un URL (con eventuali header) e lo salva sul dispositivo. Web → download del browser. */
export async function downloadToDevice(url: string, name: string, mime: string, headers?: Record<string, string>): Promise<string> {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") window.open(url, "_blank", "noopener");
    return "Download avviato";
  }
  const safe = (name || "file.pdf").replace(/[^\w.\-àèéìòù ]+/gi, "_");
  const dest = `${FileSystem.cacheDirectory}cgym-${Date.now()}-${safe}`;
  const res = await FileSystem.downloadAsync(url, dest, headers ? { headers } : undefined);
  if (res.status && res.status >= 400) throw new Error(`Download fallito (HTTP ${res.status})`);
  return saveLocalFileToDevice(res.uri, safe, mime || "application/pdf");
}

/** Scarica il manuale: web → download del browser · Android → Download (o «Salva in…») · iOS → «Salva su File». */
export async function downloadManual(link: CgymManualLink): Promise<string> {
  return downloadToDevice(link.download_url, link.name || "manuale.pdf", link.mime || "application/pdf");
}

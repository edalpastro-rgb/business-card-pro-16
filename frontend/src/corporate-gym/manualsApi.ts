// Corporate Gym — Manuali su Google Drive (AxonOS gestore manuali). Client API isolato.
import { Platform, Linking } from "react-native";
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

/** Apre il manuale nel BROWSER ESTERNO del dispositivo (V50.z395 — la WebView interna falliva con net::ERR_FAILED sui PDF). */
export function openManual(_router: Router, link: CgymManualLink) {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") window.open(link.url, "_blank", "noopener");
    return;
  }
  void Linking.openURL(link.url);
}

const DOWNLOAD_DIR_KEY = "cgym_download_dir_uri";
const ANDROID_DOWNLOADS_TREE = "content://com.android.externalstorage.documents/tree/primary%3ADownload";

/** Android: salva `base64` nella cartella Download (Storage Access Framework). La cartella viene scelta UNA volta e ricordata. */
export async function saveToAndroidDownloads(name: string, mime: string, base64: string): Promise<string> {
  const SAF = FileSystem.StorageAccessFramework;
  let dir = await AsyncStorage.getItem(DOWNLOAD_DIR_KEY);
  const tryCreate = async (d: string) => { const uri = await SAF.createFileAsync(d, name, mime); await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 }); return uri; };
  if (dir) {
    try { return await tryCreate(dir); } catch { dir = null; await AsyncStorage.removeItem(DOWNLOAD_DIR_KEY); }
  }
  const perm = await SAF.requestDirectoryPermissionsAsync(ANDROID_DOWNLOADS_TREE);
  if (!perm.granted) throw new Error("Permesso alla cartella Download negato");
  await AsyncStorage.setItem(DOWNLOAD_DIR_KEY, perm.directoryUri);
  return tryCreate(perm.directoryUri);
}

/** Scarica il manuale: web → download del browser · Android → file salvato in Download (nessun pannello di condivisione) · iOS → «Salva su File». */
export async function downloadManual(link: CgymManualLink): Promise<void> {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") window.open(link.download_url, "_blank", "noopener");
    return;
  }
  const safe = (link.name || "manuale.pdf").replace(/[^\w.\-àèéìòù ]+/gi, "_");
  const dest = `${FileSystem.cacheDirectory}cgym-${safe}`;
  const res = await FileSystem.downloadAsync(link.download_url, dest);
  if (res.status && res.status >= 400) throw new Error(`Download fallito (HTTP ${res.status})`);
  if (Platform.OS === "android") {
    const b64 = await FileSystem.readAsStringAsync(res.uri, { encoding: FileSystem.EncodingType.Base64 });
    await saveToAndroidDownloads(safe, link.mime || "application/pdf", b64);
    return;
  }
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(res.uri, { mimeType: link.mime || "application/pdf", dialogTitle: link.name, UTI: "com.adobe.pdf" });
  } else {
    throw new Error("Salvataggio non disponibile su questo dispositivo");
  }
}

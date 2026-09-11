// Corporate Gym — Manuali su Google Drive (AxonOS gestore manuali). Client API isolato.
import { Platform } from "react-native";
import type { Router } from "expo-router";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { api } from "@/src/api";
import { openInAppLink } from "@/src/utils/openInAppLink";
import type { CgymType } from "@/src/corporate-gym/api";

export type CgymManualSub = { id: string; name: string } | null | undefined;

export type CgymManualsConfig = {
  configured: boolean;
  root_folder_id: string | null;
  root_folder_name: string | null;
  subfolders: Partial<Record<CgymType, { id: string; name: string }>>;
  updated_at: string | null;
  can_edit: boolean;
  master_drive_connected: boolean;
  drive_configured: boolean;
  types: { type: CgymType; label: string; subfolder: CgymManualSub }[];
  missing_subfolders?: CgymType[];
};

export type CgymManualFile = {
  id: string;
  name: string;
  mime: string | null;
  size: number | null;
  modified_time: string | null;
  web_view_link: string | null;
  exportable: boolean;
};

export type CgymManualsList = {
  type: CgymType;
  label: string;
  items: CgymManualFile[];
  missing_subfolder: boolean;
  root_folder_name: string | null;
  subfolder: CgymManualSub;
  fetched_at?: string;
};

export type CgymManualLink = CgymManualFile & { url: string; download_url: string; expires_at: string };

export type DriveFolder = { id: string; name: string; path?: string };

export const cgymManualsApi = {
  config: () => api<CgymManualsConfig>("/cgym/manuals/config"),
  setConfig: (body: { folder_id: string; folder_name?: string }) => api<CgymManualsConfig>("/cgym/manuals/config", { method: "PUT", body }),
  clearConfig: () => api<{ ok: boolean }>("/cgym/manuals/config", { method: "DELETE" }),
  list: (type: CgymType, q?: string) => api<CgymManualsList>(`/cgym/manuals/${type}`, { query: { q } }),
  link: (type: CgymType, fileId: string) => api<CgymManualLink>(`/cgym/manuals/${type}/files/${fileId}/link`, { method: "POST" }),
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

/** Apre il manuale: web → nuova scheda; iOS → WebView interna (PDF nativo); Android → WebView con viewer Google Docs. */
export function openManual(router: Router, link: CgymManualLink) {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") window.open(link.url, "_blank", "noopener");
    return;
  }
  const url = Platform.OS === "android"
    ? `https://docs.google.com/viewer?embedded=true&url=${encodeURIComponent(link.url)}`
    : link.url;
  openInAppLink(router, url, { title: link.name });
}

/** Scarica il manuale: web → download del browser; nativo → file in cache + share sheet (salva / apri con app PDF). */
export async function downloadManual(link: CgymManualLink): Promise<void> {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") window.open(link.download_url, "_blank", "noopener");
    return;
  }
  const safe = (link.name || "manuale.pdf").replace(/[^\w.\-àèéìòù ]+/gi, "_");
  const dest = `${FileSystem.cacheDirectory}cgym-${safe}`;
  const res = await FileSystem.downloadAsync(link.download_url, dest);
  if (res.status && res.status >= 400) throw new Error(`Download fallito (HTTP ${res.status})`);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(res.uri, { mimeType: link.mime || "application/pdf", dialogTitle: link.name, UTI: "com.adobe.pdf" });
  } else {
    throw new Error("Condivisione non disponibile su questo dispositivo");
  }
}

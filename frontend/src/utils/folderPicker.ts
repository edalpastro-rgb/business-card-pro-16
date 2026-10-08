// folderPicker.ts — V50.z479 — «Carica cartella» riusabile per TUTTI i punti di upload dell'app (stesso comportamento della
// schermata Importazione clienti, app/contact/import-folder.tsx):
//   • Web desktop  → <input type="file" webkitdirectory> (Chrome/Edge/Firefox/Safari desktop)
//   • Android app  → Directory.pickDirectoryAsync() (Storage Access Framework: permesso solo sulla cartella scelta)
//   • iOS / browser mobile → NON disponibile (folderPickAvailable() = false → mostrare solo «Carica file»)
// Scansione ricorsiva delle sottocartelle (max 12 livelli, max 150 file), file nascosti esclusi.
import { Platform } from "react-native";
import { Directory, File as FsFile, Paths } from "expo-file-system";
import { COMMON_FILE_EXTS } from "@/src/utils/filePicker";
import type { UploadSource } from "@/src/utils/upload";

export type FolderFile = { name: string; relPath: string; size: number; mime: string; uri?: string; blob?: File; fsFile?: FsFile };

const MAX_FILES = 150;
const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", heic: "image/heic", heif: "image/heif", bmp: "image/bmp", tif: "image/tiff", tiff: "image/tiff",
  txt: "text/plain", md: "text/markdown", rtf: "application/rtf", csv: "text/csv", json: "application/json",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", odt: "application/vnd.oasis.opendocument.text",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ods: "application/vnd.oasis.opendocument.spreadsheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", aac: "audio/aac", ogg: "audio/ogg", opus: "audio/opus", mp4: "video/mp4", mov: "video/quicktime",
};

export const mimeForName = (name: string, fallback = "application/octet-stream") => MIME_BY_EXT[(name.split(".").pop() || "").toLowerCase()] || fallback;

/** Regex di default: le estensioni «comuni» accettate dagli upload generici (PDF, immagini, documenti, fogli, presentazioni, JSON). */
export const COMMON_EXT_RE = new RegExp(`(${COMMON_FILE_EXTS.map((e) => e.replace(".", "\\.")).join("|")})$`, "i");

/** true solo dove la selezione cartella funziona davvero: Android app + browser desktop. iOS e browser mobile → false. */
export function folderPickAvailable(): boolean {
  if (Platform.OS === "android") return true;
  if (Platform.OS === "web") {
    const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
    return typeof document !== "undefined" && !/Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  }
  return false;
}

function scanDirectory(dir: Directory, prefix: string, out: FolderFile[], extRe: RegExp, depth = 0) {
  if (depth > 12 || out.length >= MAX_FILES) return;
  let items: (Directory | FsFile)[] = [];
  try { items = dir.list(); } catch { return; }
  for (const it of items) {
    if (out.length >= MAX_FILES) break;
    const name = (it as any).name as string;
    if (!name || name.startsWith(".")) continue;
    if (it instanceof Directory) { scanDirectory(it, `${prefix}${name}/`, out, extRe, depth + 1); continue; }
    if (!extRe.test(name)) continue;
    let size = 0;
    try { size = (it as FsFile).size || 0; } catch { size = 0; }
    out.push({ name, relPath: `${prefix}${name}`, size, mime: mimeForName(name), uri: it.uri, fsFile: it as FsFile });
  }
}

function pickFolderWeb(extRe: RegExp): Promise<FolderFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file"; input.multiple = true;
    input.setAttribute("webkitdirectory", ""); input.setAttribute("directory", "");
    input.style.position = "fixed"; input.style.left = "-9999px"; input.style.opacity = "0";
    let settled = false;
    const finish = (files: FolderFile[]) => { if (settled) return; settled = true; try { document.body.removeChild(input); } catch { /* noop */ } resolve(files); };
    input.addEventListener("cancel", () => finish([]));
    input.onchange = () => {
      const list = input.files; const out: FolderFile[] = [];
      for (let i = 0; list && i < list.length && out.length < MAX_FILES; i++) {
        const f = list[i] as File & { webkitRelativePath?: string };
        if (f.name.startsWith(".") || !extRe.test(f.name)) continue; // .DS_Store, Thumbs…
        out.push({ name: f.name, relPath: f.webkitRelativePath || f.name, size: f.size, mime: f.type || mimeForName(f.name), blob: f });
      }
      finish(out);
    };
    document.body.appendChild(input);
    input.click();
  });
}

/**
 * Apre il selettore di cartella e restituisce i file contenuti (ricorsivo). `[]` se l'utente annulla o la cartella è vuota.
 * Lancia un errore solo per problemi reali (permessi, launcher). Chiamare solo se `folderPickAvailable()`.
 */
export async function pickFolderFiles(opts?: { extRe?: RegExp }): Promise<FolderFile[]> {
  const extRe = opts?.extRe || COMMON_EXT_RE;
  if (Platform.OS === "web") return pickFolderWeb(extRe);
  let dir: Awaited<ReturnType<typeof Directory.pickDirectoryAsync>> | null = null;
  try {
    dir = await Directory.pickDirectoryAsync();
  } catch (e: any) {
    const msg = String(e?.message || e || "");
    if (/cancel|annull/i.test(msg)) return [];
    if (!/launcher|register|rejected/i.test(msg)) throw e;
    await new Promise((r) => setTimeout(r, 350)); // launcher non ancora pronto → un solo secondo tentativo
    dir = await Directory.pickDirectoryAsync();
  }
  if (!dir) return [];
  const root = (dir as any).name || decodeURIComponent(dir.uri.split(/[/:]/).pop() || "Cartella");
  const out: FolderFile[] = [];
  scanDirectory(dir as unknown as Directory, `${root}/`, out, extRe);
  return out;
}

/** Contenuto in base64 «nudo» (senza prefisso data:). */
export async function folderFileBase64(f: FolderFile): Promise<string> {
  if (f.fsFile) return await f.fsFile.base64();
  if (f.blob) {
    return await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onerror = () => reject(new Error("Errore lettura file"));
      r.onload = () => { const s = String(r.result || ""); resolve(s.slice(s.indexOf(",") + 1)); };
      r.readAsDataURL(f.blob as Blob);
    });
  }
  throw new Error("File non leggibile");
}

/** Data URL completo (per i punti che usano uriToBase64DataUrl). */
export async function folderFileDataUrl(f: FolderFile): Promise<string> {
  return `data:${f.mime};base64,${await folderFileBase64(f)}`;
}

/** Sorgente per gli upload multipart (uploadMasterFile…). Android SAF: copia in cache → file:// leggibile da FormData. */
export async function folderFileUploadSource(f: FolderFile): Promise<UploadSource> {
  if (f.blob) return { blob: f.blob, name: f.name, mime: f.mime };
  if (f.fsFile) {
    const dest = new FsFile(Paths.cache, `folder_${Date.now()}_${f.name.replace(/[^\w.\-]+/g, "_")}`);
    try { if (dest.exists) dest.delete(); } catch { /* noop */ }
    f.fsFile.copy(dest);
    return { uri: dest.uri, name: f.name, mime: f.mime };
  }
  return { uri: f.uri || "", name: f.name, mime: f.mime };
}

/** Riepilogo uniforme a fine import (es. «12 file caricati · 1 errore»). */
export function folderSummary(ok: number, failed: number): string {
  return `${ok} file caricat${ok === 1 ? "o" : "i"}${failed ? ` · ${failed} non riuscit${failed === 1 ? "o" : "i"}` : ""}`;
}

import * as DocumentPicker from "expo-document-picker";
import { Platform } from "react-native";

/**
 * v2.20 — Centralized "common file formats" list used by any generic file
 * attachment picker across the app (contact files, appointment notes, chat
 * attachments, note comments, etc.). Adding a format here propagates it
 * everywhere the wrapper is used.
 */
export const COMMON_FILE_MIME_TYPES: string[] = [
  // PDF
  "application/pdf",
  // Images (JPG, PNG, GIF, WEBP, HEIC, BMP, TIFF)
  "image/jpeg", "image/png", "image/gif", "image/webp",
  "image/heic", "image/heif", "image/bmp", "image/tiff",
  // Text / Documents
  "text/plain", "text/markdown", "text/rtf", "application/rtf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/vnd.oasis.opendocument.text", // .odt
  // Spreadsheets
  "text/csv",
  "application/vnd.ms-excel", // .xls
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  // Presentazioni — V50.z387: .pptx/.ppt accettati ovunque
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
  "application/vnd.ms-powerpoint", // .ppt
  "application/vnd.oasis.opendocument.spreadsheet", // .ods
  // Slides
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  // Data
  "application/json",
];

/**
 * Extensions used as fallback validation when the MIME reported by the OS
 * is empty or "application/octet-stream" (common on Android + some iOS versions).
 */
export const COMMON_FILE_EXTS: string[] = [
  ".pdf",
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif", ".bmp", ".tif", ".tiff",
  ".txt", ".md", ".rtf",
  ".doc", ".docx", ".odt",
  ".csv", ".xls", ".xlsx", ".ods",
  ".ppt", ".pptx",
  ".json",
];

export type CommonFileAsset = {
  uri: string;
  name?: string;
  mimeType?: string | null;
  size?: number | null;
};

/** Returns a human-readable list for error messages */
export const COMMON_FILE_LABEL = "PDF, immagini (JPG/PNG/GIF/WEBP/HEIC), documenti (DOC/DOCX/TXT/RTF), fogli (XLS/XLSX/CSV), presentazioni (PPT/PPTX), JSON";

/**
 * Return an Italian error message if the asset's extension/MIME is not in the
 * supported list, or `null` if it's valid.
 */
export function validateCommonFile(asset: CommonFileAsset | null | undefined): string | null {
  if (!asset || !asset.uri) return "Nessun file selezionato.";
  const mime = (asset.mimeType || "").toLowerCase();
  const name = (asset.name || "").toLowerCase();
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  if (mime && COMMON_FILE_MIME_TYPES.includes(mime)) return null;
  if (ext && COMMON_FILE_EXTS.includes(ext)) return null;
  // Some browsers report generic MIME for HEIC — accept if extension matches
  if (mime.startsWith("image/") || mime.startsWith("text/") || mime === "application/octet-stream") {
    if (COMMON_FILE_EXTS.includes(ext)) return null;
  }
  return `Formato non supportato: ${ext || mime || "sconosciuto"}. Formati ammessi: ${COMMON_FILE_LABEL}.`;
}

/**
 * Wrapper around DocumentPicker that returns the picked asset validated
 * against the common formats. Returns `{ asset, error, base64 }` — caller
 * decides whether to `notify` the error or ignore.
 *
 * V28.m — Web workaround: su browser (specialmente Android) il selettore
 * DocumentPicker mostra solo Camera/Foto quando la lista di MIME include
 * troppi image/*. Su web usiamo un `<input type="file">` con accept limitato
 * a documenti (PDF, Excel, CSV, Word…) così il browser apre direttamente il
 * file manager. Ritorniamo anche `base64` già decodificato per evitare che i
 * chiamanti debbano ri-leggere via FileReader/expo-file-system.
 */
export const WEB_FALLBACK_ACCEPT =
  "application/pdf," +
  "application/vnd.ms-excel," +
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet," +
  "text/csv," +
  ".docx,.doc,.xls,.xlsx,.csv,.pdf,.txt,.md,.rtf,.odt,.ods,.ppt,.pptx,.json";

async function pickCommonFileWeb(): Promise<{ asset: CommonFileAsset | null; error: string | null; base64?: string }> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") {
      resolve({ asset: null, error: "DOM non disponibile su questa piattaforma." });
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = WEB_FALLBACK_ACCEPT;
    input.style.position = "fixed";
    input.style.left = "-9999px";
    input.style.top = "-9999px";
    input.style.opacity = "0";
    let settled = false;
    const cleanup = () => { try { document.body.removeChild(input); } catch { /* ignore */ } };
    // Some browsers don't fire cancel; fall back to a focus listener
    const onCancel = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ asset: null, error: null });
    };
    input.addEventListener("cancel", onCancel);
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) { onCancel(); return; }
      settled = true;
      const reader = new FileReader();
      reader.onerror = () => { cleanup(); resolve({ asset: null, error: "Errore lettura file" }); };
      reader.onload = () => {
        cleanup();
        const dataUrl = String(reader.result || "");
        const comma = dataUrl.indexOf(",");
        const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : "";
        const asset: CommonFileAsset = {
          uri: dataUrl,
          name: file.name,
          mimeType: file.type || null,
          size: file.size,
        };
        const err = validateCommonFile(asset);
        resolve({ asset: err ? null : asset, error: err, base64: err ? undefined : b64 });
      };
      reader.readAsDataURL(file);
    };
    document.body.appendChild(input);
    input.click();
  });
}

export async function pickCommonFile(opts?: { multiple?: boolean }): Promise<{ asset: CommonFileAsset | null; error: string | null; base64?: string }> {
  // V28.m — Web fallback: bypass del DocumentPicker (che su Android mostra
  // solo Camera/Foto) usando un input HTML nativo con accept documenti.
  if (Platform.OS === "web") {
    return pickCommonFileWeb();
  }
  try {
    const res = await DocumentPicker.getDocumentAsync({
      type: COMMON_FILE_MIME_TYPES,
      multiple: opts?.multiple ?? false,
      copyToCacheDirectory: true,
    });
    if (res.canceled || !res.assets?.[0]) return { asset: null, error: null };
    const asset = res.assets[0];
    const err = validateCommonFile(asset);
    return { asset: err ? null : asset, error: err };
  } catch (e: any) {
    return { asset: null, error: e?.message || "Errore nella selezione del file" };
  }
}

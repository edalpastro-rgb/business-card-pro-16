import * as DocumentPicker from "expo-document-picker";

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
 * against the common formats. Returns `{ asset, error }` — caller decides
 * whether to `notify` the error or ignore.
 */
export async function pickCommonFile(opts?: { multiple?: boolean }): Promise<{ asset: CommonFileAsset | null; error: string | null }> {
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

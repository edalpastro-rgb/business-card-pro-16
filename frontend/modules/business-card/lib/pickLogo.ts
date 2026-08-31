/**
 * Logo picker with cross-platform adapter:
 *  - Web  → native HTML <input type="file"> (no expo-image-picker on web)
 *  - Native → expo-image-picker (dynamic import to avoid loading it on web)
 *
 * Returns a base64 data URL suitable for direct storage/preview, or null on cancel/error.
 *
 * V29.av — Alpha channel preservation:
 * `allowsEditing: true` on iOS/Android forces the native cropper which FLATTENS
 * transparency to JPEG. To keep the alpha channel of PNG logos, we disable the
 * automatic cropper AND detect the real MIME type from the file's magic bytes
 * (falling back to expo-image-picker's mimeType hint). PNG inputs are returned
 * as `data:image/png;base64,...` so downstream renderers receive the transparent
 * logo unaltered.
 */
import { Platform } from "react-native";
import type { Result } from "@/src/shared";
import { ok, err } from "@/src/shared";
import { pickSingleImageDataUrlWeb } from "@/src/web-image-picker";

/** Detect image MIME by inspecting the first bytes (from base64). Returns null if unknown. */
function sniffMimeFromBase64(b64: string): string | null {
  // Take the very first characters of the raw base64 (before padding).
  const head = b64.slice(0, 16);
  // PNG magic: 89 50 4E 47 0D 0A 1A 0A → base64 starts with "iVBORw0KGgo"
  if (head.startsWith("iVBORw0KGgo")) return "image/png";
  // JPEG magic: FF D8 FF → base64 starts with "/9j/"
  if (head.startsWith("/9j/")) return "image/jpeg";
  // WebP: RIFF....WEBP → starts with "UklGR" then "V0VCUA" at offset ~12
  if (head.startsWith("UklGR")) return "image/webp";
  // GIF: "GIF87a" or "GIF89a" → base64 starts with "R0lGOD"
  if (head.startsWith("R0lGOD")) return "image/gif";
  return null;
}

/** Extract MIME type from a data URI header if present, else null. */
function mimeFromDataUri(uri: string | null | undefined): string | null {
  if (!uri || !uri.startsWith("data:")) return null;
  const m = /^data:([^;,]+)/.exec(uri);
  return m ? m[1].toLowerCase() : null;
}

export async function pickCardLogo(): Promise<Result<string | null>> {
  try {
    if (Platform.OS === "web") {
      const uri = await pickSingleImageDataUrlWeb("image/*");
      // On web the picker already returns the ORIGINAL file (no re-encoding)
      // so PNG with alpha is preserved automatically.
      return ok(uri);
    }
    const ImagePicker = await import("expo-image-picker");
    const FileSystem = await import("expo-file-system/legacy");
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return ok(null);
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1.0, // Full quality — no re-encoding
      allowsEditing: false, // ⚠️ MUST stay false: native cropper flattens PNG alpha to JPEG.
      base64: false,
    });
    if (res.canceled || !res.assets?.[0]?.uri) return ok(null);
    const a = res.assets[0];
    const b64 = await FileSystem.readAsStringAsync(a.uri, { encoding: FileSystem.EncodingType.Base64 });
    // Detect the real MIME with magic-byte sniff (most accurate), fall back to
    // the picker's mimeType hint, then to the file extension, then default to png
    // if we can't tell (safer than jpeg — the backend can re-encode if needed).
    const sniffed = sniffMimeFromBase64(b64);
    const uriExt = (a.uri || "").toLowerCase().split(".").pop() || "";
    const extMime =
      uriExt === "png" ? "image/png" :
      uriExt === "webp" ? "image/webp" :
      uriExt === "gif" ? "image/gif" :
      uriExt === "jpg" || uriExt === "jpeg" ? "image/jpeg" :
      null;
    const mime = sniffed || (a.mimeType && a.mimeType.startsWith("image/") ? a.mimeType : null) || extMime || "image/png";
    return ok(`data:${mime};base64,${b64}`);
  } catch (e) {
    return err<string | null>(e instanceof Error ? e.message : "Errore nel caricamento del logo");
  }
}

/** Exported helpers for reuse & unit tests. */
export const _test_sniffMimeFromBase64 = sniffMimeFromBase64;
export const _test_mimeFromDataUri = mimeFromDataUri;

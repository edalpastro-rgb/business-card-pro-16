import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";

/**
 * Convert a local URI (file://, blob:, data:) to a base64 data URL.
 * Works on both native (FileSystem) and web (fetch + FileReader).
 * Returns "data:<mime>;base64,<...>".
 */
export async function uriToBase64DataUrl(uri: string, mimeFallback = "application/octet-stream"): Promise<string> {
  if (!uri) throw new Error("empty uri");

  // Already a data URL
  if (uri.startsWith("data:")) return uri;

  if (Platform.OS === "web") {
    // Fetch the blob URL and convert with FileReader
    const resp = await fetch(uri);
    const blob = await resp.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("read failed"));
      reader.onload = () => {
        const r = reader.result;
        if (typeof r === "string") resolve(r);
        else reject(new Error("bad reader result"));
      };
      reader.readAsDataURL(blob);
    });
  }

  // Native path
  const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  return `data:${mimeFallback};base64,${b64}`;
}

/**
 * Convert a local URI to a plain base64 string (no data: prefix).
 */
export async function uriToBase64(uri: string): Promise<string> {
  const dataUrl = await uriToBase64DataUrl(uri);
  const idx = dataUrl.indexOf(",");
  return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
}

/**
 * Estimate the size (bytes) of a base64 string.
 */
export function base64ByteSize(b64: string): number {
  const payload = b64.startsWith("data:") ? b64.slice(b64.indexOf(",") + 1) : b64;
  const pad = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.floor((payload.length * 3) / 4) - pad;
}

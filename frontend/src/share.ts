import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system/legacy";
import { Platform, Share, Linking } from "react-native";

/** Best-effort native share sheet. Falls back to Web API / mailto. */
export async function shareText(text: string, title = "Condividi") {
  try {
    if (Platform.OS === "web") {
      // @ts-ignore
      if (navigator.share) { await navigator.share({ text, title }); return; }
      await Linking.openURL(`mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(text)}`);
      return;
    }
    await Share.share({ message: text, title });
  } catch (e) {
    console.warn("shareText failed", e);
  }
}

/** Decode a base64 string (data-URI or bare) into a Uint8Array (browser-safe). */
function base64ToBytes(dataUri: string): Uint8Array {
  const base64 = dataUri.includes(",") ? dataUri.split(",")[1] : dataUri;
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Fallback: trigger a download of a data URI in the browser. */
function webDownload(dataUri: string, fileName: string) {
  const a = document.createElement("a");
  a.href = dataUri;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Share a base64 data URI (audio/photo/file) via the native share sheet.
 * - iOS/Android: uses expo-sharing (system share sheet).
 * - Web: uses the Web Share API (Level 2 — with files) if available; otherwise
 *   falls back to a normal download.
 */
export async function shareDataUri(dataUri: string, fileName: string, mime = "application/octet-stream") {
  try {
    if (Platform.OS === "web") {
      const nav: any = (globalThis as any).navigator;
      // Try Web Share API with files first (mobile browsers, Safari iOS, Android Chrome)
      if (nav?.canShare && nav?.share && typeof File !== "undefined") {
        try {
          const bytes = base64ToBytes(dataUri);
          const file = new File([bytes], fileName, { type: mime });
          if (nav.canShare({ files: [file] })) {
            await nav.share({ files: [file], title: fileName });
            return;
          }
        } catch (err: any) {
          // User cancelled the share sheet — do NOT fall back to download.
          if (err?.name === "AbortError") return;
          // Otherwise fall through to download fallback below.
          console.warn("navigator.share(files) failed, falling back to download", err);
        }
      }
      // Fallback for desktop browsers or if Web Share API is unavailable
      webDownload(dataUri, fileName);
      return;
    }
    const base64 = dataUri.includes(",") ? dataUri.split(",")[1] : dataUri;
    const path = `${FileSystem.cacheDirectory}${fileName}`;
    await FileSystem.writeAsStringAsync(path, base64, { encoding: FileSystem.EncodingType.Base64 });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(path, { mimeType: mime, dialogTitle: "Condividi" });
    }
  } catch (e) {
    console.warn("shareDataUri failed", e);
  }
}

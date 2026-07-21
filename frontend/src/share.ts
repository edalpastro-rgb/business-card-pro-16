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

/**
 * Share a base64 data URI (audio/photo/file) via native share sheet.
 * On web it triggers a download.
 */
export async function shareDataUri(dataUri: string, fileName: string, mime = "application/octet-stream") {
  try {
    if (Platform.OS === "web") {
      const a = document.createElement("a");
      a.href = dataUri;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
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

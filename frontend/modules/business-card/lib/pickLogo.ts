/**
 * Logo picker with cross-platform adapter:
 *  - Web  → native HTML <input type="file"> (no expo-image-picker on web)
 *  - Native → expo-image-picker (dynamic import to avoid loading it on web)
 *
 * Returns a base64 data URL suitable for direct storage/preview, or null on cancel/error.
 */
import { Platform } from "react-native";
import type { Result } from "@/src/shared";
import { ok, err } from "@/src/shared";
import { pickSingleImageDataUrlWeb } from "@/src/web-image-picker";

export async function pickCardLogo(): Promise<Result<string | null>> {
  try {
    if (Platform.OS === "web") {
      const uri = await pickSingleImageDataUrlWeb("image/*");
      return ok(uri);
    }
    const ImagePicker = await import("expo-image-picker");
    const FileSystem = await import("expo-file-system/legacy");
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return ok(null);
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      allowsEditing: true,
      base64: false,
    });
    if (res.canceled || !res.assets?.[0]?.uri) return ok(null);
    const a = res.assets[0];
    const b64 = await FileSystem.readAsStringAsync(a.uri, { encoding: FileSystem.EncodingType.Base64 });
    return ok(`data:${a.mimeType || "image/jpeg"};base64,${b64}`);
  } catch (e) {
    return err<string | null>(e instanceof Error ? e.message : "Errore nel caricamento del logo");
  }
}

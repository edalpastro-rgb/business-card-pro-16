import { Platform } from "react-native";
import { pickSingleImageDataUrlWeb, pickFilesWeb, WebPickedAsset } from "./web-image-picker";

/**
 * Universal image picker helpers.
 * - Web: uses native HTML <input type="file"> + FileReader (bypasses expo-image-picker
 *   which throws "Failed to read the selected media" on some browsers).
 * - Native (iOS/Android): uses expo-image-picker.
 */

/**
 * Pick an avatar image and return a base64 data URL.
 */
export async function pickAvatarBase64(): Promise<string | null> {
  if (Platform.OS === "web") {
    return pickSingleImageDataUrlWeb("image/*");
  }

  // Native platforms – lazy-load to avoid loading native module on web
  const ImagePicker = await import("expo-image-picker");
  const FileSystem = await import("expo-file-system/legacy");

  const p = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!p.granted) return null;

  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.6,
    base64: false,
  });
  if (res.canceled || !res.assets?.[0]) return null;
  const asset = res.assets[0];
  if (asset.base64) return `data:${asset.mimeType || "image/jpeg"};base64,${asset.base64}`;
  try {
    const b64 = await FileSystem.readAsStringAsync(asset.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return `data:${asset.mimeType || "image/jpeg"};base64,${b64}`;
  } catch {
    return null;
  }
}

/**
 * Universal image asset (works on web + native). Callers can adapt to
 * their own data model.
 */
export type UniversalPickedAsset = {
  uri: string;               // data URL on web, file URI on native
  base64?: string;           // base64 string (may be empty on native if not requested)
  mimeType: string;
  fileName?: string;
  size?: number;
  width?: number;
  height?: number;
};

export type UniversalPickerOptions = {
  multiple?: boolean;
  quality?: number;          // 0-1 (native only)
  allowsEditing?: boolean;   // native only
  aspect?: [number, number]; // native only
  fromCamera?: boolean;      // if true, opens camera on native
  videos?: boolean;          // if true, allows videos too
};

/**
 * Universal image picker – returns a list of picked assets. Returns [] on cancel.
 */
export async function pickImages(opts: UniversalPickerOptions = {}): Promise<UniversalPickedAsset[]> {
  const { multiple = false, quality = 0.5, allowsEditing, aspect, fromCamera = false, videos = false } = opts;

  if (Platform.OS === "web") {
    // On web, we cannot open the camera reliably via input, so we ignore fromCamera.
    const accept = videos ? "image/*,video/*" : "image/*";
    const assets = await pickFilesWeb({ accept, multiple });
    return assets.map((a: WebPickedAsset) => ({
      uri: a.uri,
      base64: a.base64,
      mimeType: a.mimeType,
      fileName: a.fileName,
      size: a.size,
      width: a.width,
      height: a.height,
    }));
  }

  // Native
  const ImagePicker = await import("expo-image-picker");
  const perm = fromCamera
    ? await ImagePicker.requestCameraPermissionsAsync()
    : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return [];

  const mediaTypes = videos
    ? ImagePicker.MediaTypeOptions.All
    : ImagePicker.MediaTypeOptions.Images;

  const nativeOpts: any = {
    mediaTypes,
    quality,
    base64: false,
    allowsMultipleSelection: !fromCamera && multiple,
    allowsEditing: !!allowsEditing,
  };
  if (aspect) nativeOpts.aspect = aspect;

  const res = fromCamera
    ? await ImagePicker.launchCameraAsync(nativeOpts)
    : await ImagePicker.launchImageLibraryAsync(nativeOpts);

  if (res.canceled || !res.assets?.length) return [];

  return res.assets.map((a: any) => ({
    uri: a.uri,
    base64: a.base64,
    mimeType: a.mimeType || (a.type === "video" ? "video/mp4" : "image/jpeg"),
    fileName: a.fileName,
    size: a.fileSize,
    width: a.width,
    height: a.height,
  }));
}

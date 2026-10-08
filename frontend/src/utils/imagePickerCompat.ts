/**
 * imagePickerCompat — Drop-in replacement for expo-image-picker.launchImageLibraryAsync
 * that works reliably on web by using a native HTML <input type="file"> element.
 *
 * On native (iOS/Android) this delegates to expo-image-picker.
 * On web, it uses pickFilesWeb (HTML input + FileReader).
 *
 * Returned shape mirrors ImagePicker.ImagePickerResult so existing call sites
 * do NOT need to change their result handling logic.
 */
import { Platform } from "react-native";
// V50.z462 — import STATICO: su Android l'ActivityResultLauncher di ExponentImagePicker viene registrato alla creazione del modulo;
// con il vecchio `await import("expo-image-picker")` dentro la funzione il modulo nasceva a Activity già RESUMED →
// «Call to function ExponentImagePicker.launchCameraAsync has been rejected». Importato qui, si registra all'avvio dell'app.
import * as ImagePicker from "expo-image-picker";
import { pickFilesWeb, WebPickedAsset } from "@/src/web-image-picker";

export type PickerAsset = {
  uri: string;              // web: data URL; native: file URI
  base64?: string;          // present on web (always); optional on native
  mimeType?: string;
  fileName?: string;
  fileSize?: number;
  width?: number;
  height?: number;
  type?: "image" | "video";
};

export type PickerResult = {
  canceled: boolean;
  assets?: PickerAsset[] | null;
};

export type LaunchLibraryOptions = {
  mediaTypes?: "images" | "videos" | "all";
  allowsMultipleSelection?: boolean;
  quality?: number;
  allowsEditing?: boolean;
  aspect?: [number, number];
  base64?: boolean;
};

/**
 * Universal library picker – works on web and native.
 * Result shape mirrors expo-image-picker's ImagePickerResult.
 */
export async function launchLibraryUniversal(
  opts: LaunchLibraryOptions = {}
): Promise<PickerResult> {
  const {
    mediaTypes = "images",
    allowsMultipleSelection = false,
    quality = 0.6,
    allowsEditing,
    aspect,
    base64,
  } = opts;

  if (Platform.OS === "web") {
    let accept = "image/*";
    if (mediaTypes === "videos") accept = "video/*";
    else if (mediaTypes === "all") accept = "image/*,video/*";
    const picked = await pickFilesWeb({ accept, multiple: allowsMultipleSelection });
    if (!picked || picked.length === 0) return { canceled: true, assets: null };
    const assets: PickerAsset[] = picked.map((a: WebPickedAsset) => ({
      uri: a.uri,
      base64: a.base64,
      mimeType: a.mimeType,
      fileName: a.fileName,
      fileSize: a.size,
      width: a.width,
      height: a.height,
      type: a.mimeType.startsWith("video/") ? "video" : "image",
    }));
    return { canceled: false, assets };
  }

  // Native
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return { canceled: true, assets: null };

  const nativeMedia =
    mediaTypes === "videos"
      ? ImagePicker.MediaTypeOptions.Videos
      : mediaTypes === "all"
      ? ImagePicker.MediaTypeOptions.All
      : ImagePicker.MediaTypeOptions.Images;

  const nativeOpts: any = {
    mediaTypes: nativeMedia,
    quality,
    base64: !!base64,
    allowsMultipleSelection,
  };
  if (allowsEditing !== undefined) nativeOpts.allowsEditing = allowsEditing;
  if (aspect) nativeOpts.aspect = aspect;

  const res = await ImagePicker.launchImageLibraryAsync(nativeOpts);
  if (res.canceled || !res.assets?.length) return { canceled: true, assets: null };
  const assets: PickerAsset[] = res.assets.map((a: any) => ({
    uri: a.uri,
    base64: a.base64,
    mimeType: a.mimeType,
    fileName: a.fileName,
    fileSize: a.fileSize,
    width: a.width,
    height: a.height,
    type: (a.type === "video" ? "video" : "image") as "image" | "video",
  }));
  return { canceled: false, assets };
}

export type LaunchCameraOptions = {
  mediaTypes?: "images" | "videos" | "all";
  quality?: number;
  allowsEditing?: boolean;
  aspect?: [number, number];
  base64?: boolean;
};

/**
 * Universal camera launcher. On web there is no reliable camera capture
 * so we fall back to the picker with capture hint (mobile browsers may
 * open camera). On native, uses expo-image-picker.launchCameraAsync.
 */
export async function launchCameraUniversal(
  opts: LaunchCameraOptions = {}
): Promise<PickerResult> {
  const { mediaTypes = "images", quality = 0.6, allowsEditing, aspect, base64 } = opts;

  if (Platform.OS === "web") {
    // Mobile web: hint capture=environment; desktop web: just opens file picker.
    let accept = "image/*";
    if (mediaTypes === "videos") accept = "video/*";
    else if (mediaTypes === "all") accept = "image/*,video/*";
    const picked = await pickFilesWeb({ accept, multiple: false, capture: "environment" });
    if (!picked || picked.length === 0) return { canceled: true, assets: null };
    const a = picked[0];
    return {
      canceled: false,
      assets: [
        {
          uri: a.uri,
          base64: a.base64,
          mimeType: a.mimeType,
          fileName: a.fileName,
          fileSize: a.size,
          width: a.width,
          height: a.height,
          type: a.mimeType.startsWith("video/") ? "video" : "image",
        },
      ],
    };
  }

  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return { canceled: true, assets: null };

  const nativeMedia =
    mediaTypes === "videos"
      ? ImagePicker.MediaTypeOptions.Videos
      : mediaTypes === "all"
      ? ImagePicker.MediaTypeOptions.All
      : ImagePicker.MediaTypeOptions.Images;

  const nativeOpts: any = {
    mediaTypes: nativeMedia,
    quality,
    base64: !!base64,
  };
  if (allowsEditing !== undefined) nativeOpts.allowsEditing = allowsEditing;
  if (aspect) nativeOpts.aspect = aspect;

  let res: any;
  try {
    res = await ImagePicker.launchCameraAsync(nativeOpts);
  } catch (e: any) {
    // V50.z462 — launcher non pronto / fotocamera occupata: un secondo tentativo dopo che l'Activity ha completato il ciclo
    if (/rejected|launcher|register/i.test(String(e?.message || e))) {
      await new Promise((r) => setTimeout(r, 350));
      res = await ImagePicker.launchCameraAsync(nativeOpts);
    } else throw e;
  }
  if (res.canceled || !res.assets?.length) return { canceled: true, assets: null };
  const assets: PickerAsset[] = res.assets.map((a: any) => ({
    uri: a.uri,
    base64: a.base64,
    mimeType: a.mimeType,
    fileName: a.fileName,
    fileSize: a.fileSize,
    width: a.width,
    height: a.height,
    type: (a.type === "video" ? "video" : "image") as "image" | "video",
  }));
  return { canceled: false, assets };
}

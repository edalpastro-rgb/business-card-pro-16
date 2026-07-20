import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";

export async function pickAvatarBase64(): Promise<string | null> {
  if (Platform.OS !== "web") {
    const p = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!p.granted) return null;
  }
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.6,
    base64: Platform.OS === "web",
  });
  if (res.canceled || !res.assets?.[0]) return null;
  const asset = res.assets[0];
  if (asset.base64) return `data:${asset.mimeType || "image/jpeg"};base64,${asset.base64}`;
  try {
    const b64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
    return `data:${asset.mimeType || "image/jpeg"};base64,${b64}`;
  } catch {
    return null;
  }
}

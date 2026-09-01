// Icon font loader for Expo apps. Fonts are loaded from a CDN under Expo Go
// (StoreClient) — that's where @expo/vector-icons' .ttf files come back as
// 0 bytes from Metro's asset resolver on Android. On Web we ALSO load from CDN
// because production web builds served under a custom domain (e.g. Emergent
// deploy) sometimes miss the @font-face registration for @expo/vector-icons —
// visible symptom: labels visible but icons rendered as empty/tofu boxes.
// Native dev/prod builds skip CDN entirely (react-native-vector-icons
// autolinking handles bundling).
// ICON_VECTOR_VERSION must match @expo/vector-icons in package.json.
// Usage: const [loaded, error] = useIconFonts();

import Constants, { ExecutionEnvironment } from "expo-constants";
import { useFonts } from "expo-font";
import { Platform } from "react-native";

const ICON_VECTOR_VERSION = "15.1.1";

// short internal fontName (what the library queries) -> CDN .ttf file name
const ICON_FAMILIES: Record<string, string> = {
  anticon: "AntDesign",
  entypo: "Entypo",
  evilicons: "EvilIcons",
  feather: "Feather",
  FontAwesome: "FontAwesome",
  Fontisto: "Fontisto",
  foundation: "Foundation",
  ionicons: "Ionicons",
  "material-community": "MaterialCommunityIcons",
  material: "MaterialIcons",
  octicons: "Octicons",
  "simple-line-icons": "SimpleLineIcons",
  zocial: "Zocial",
  // FontAwesome5 style variants (key = `FontAwesome5Free-<style>`)
  "FontAwesome5Free-Regular": "FontAwesome5_Regular",
  "FontAwesome5Free-Solid": "FontAwesome5_Solid",
  "FontAwesome5Free-Brand": "FontAwesome5_Brands",
  // FontAwesome6 style variants (key = `FontAwesome6Free-<style>`)
  "FontAwesome6Free-Regular": "FontAwesome6_Regular",
  "FontAwesome6Free-Solid": "FontAwesome6_Solid",
  "FontAwesome6Free-Brand": "FontAwesome6_Brands",
};

const cdnUrl = (file: string): string =>
  `https://cdn.jsdelivr.net/npm/@expo/vector-icons@${ICON_VECTOR_VERSION}/build/vendor/react-native-vector-icons/Fonts/${file}.ttf`;

const iconFontMap = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(ICON_FAMILIES).map(([key, file]) => [key, cdnUrl(file)]),
  );

// V49.d — Carica i font da CDN sia su Expo Go sia su Web (per garantire che
// le icone dei bottom tab e delle schermate siano sempre visibili anche in
// build web deployate). Su Native dev/prod restiamo con mappa vuota (autolink).
const shouldUseCdn = (): boolean =>
  Platform.OS === "web" ||
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

export const useIconFonts = (): readonly [boolean, Error | null] =>
  useFonts(shouldUseCdn() ? iconFontMap() : {});

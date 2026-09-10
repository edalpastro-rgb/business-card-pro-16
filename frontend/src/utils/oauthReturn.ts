import { Platform } from "react-native";
import * as Linking from "expo-linking";
import Constants from "expo-constants";

// V50.z154 — Info di ritorno all'app da inviare a POST /<provider>/oauth/start.
// Il backend le usa nella pagina di callback per riportare l'utente DENTRO l'app
// (deep-link + intent:// su Android) invece di indovinare la piattaforma dallo
// User-Agent. `returnUrl` va passato anche a WebBrowser.openAuthSessionAsync
// così il custom tab si chiude appena l'app riceve il deep-link.
export function buildOAuthReturn(path: string, provider: string): {
  returnUrl: string;
  body: { return_url: string; android_package?: string; platform: string };
} {
  const returnUrl = Linking.createURL(path, { queryParams: { oauth: provider } });
  // In Expo Go (storeClient) il package dell'app non è quello installato → niente intent.
  const isExpoGo = Constants.executionEnvironment === "storeClient";
  const pkg = Platform.OS === "android" && !isExpoGo ? Constants.expoConfig?.android?.package : undefined;
  return {
    returnUrl,
    body: { return_url: returnUrl, ...(pkg ? { android_package: pkg } : {}), platform: Platform.OS },
  };
}

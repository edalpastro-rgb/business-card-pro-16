// NativeDocScanner.ts — V50.z246 — Scanner documenti NATIVO (Apple VisionKit su iOS / Google ML Kit su Android) via
// react-native-document-scanner-plugin: bordi rilevati in tempo reale dall'hardware, autofocus/HDR/stabilizzazione di sistema,
// ritaglio + raddrizzamento prospettico istantanei, multi-pagina. Zero server nel loop di acquisizione.
// Richiede build nativa: in Expo Go / web il modulo non c'è → `isNativeScannerAvailable()` = false e resta LiveCameraScanner.
import { Platform } from "react-native";

export type NativeScanPage = { data_base64: string; mime: "image/jpeg" };

let _mod: any | null | undefined; // undefined = non ancora provato, null = non disponibile

function loadModule(): any | null {
  if (_mod !== undefined) return _mod;
  if (Platform.OS === "web") { _mod = null; return _mod; }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require("react-native-document-scanner-plugin");
    const api = m?.default || m;
    _mod = api && typeof api.scanDocument === "function" ? api : null;
  } catch {
    _mod = null; // Expo Go / web: TurboModule assente
  }
  return _mod;
}

export function isNativeScannerAvailable(): boolean {
  return !!loadModule();
}

/**
 * Apre lo scanner di sistema. `maxPages` (solo Android) limita il numero di pagine; su iOS l'utente decide.
 * Ritorna le pagine già ritagliate e raddrizzate (JPEG base64) oppure [] se l'utente annulla.
 * Lancia un errore se il modulo nativo non è disponibile (chiamare prima `isNativeScannerAvailable()`).
 */
export async function scanWithNativeScanner(maxPages?: number): Promise<NativeScanPage[]> {
  const api = loadModule();
  if (!api) throw new Error("Scanner nativo non disponibile su questo dispositivo (serve la build nativa)");
  const res = await api.scanDocument({ responseType: "base64", croppedImageQuality: 92, ...(maxPages && Platform.OS === "android" ? { maxNumDocuments: maxPages } : {}) });
  if (!res || res.status === "cancel" || !Array.isArray(res.scannedImages)) return [];
  const pages = res.scannedImages
    .filter((s: unknown) => typeof s === "string" && (s as string).length > 100)
    .map((s: string) => ({ data_base64: s.startsWith("data:") ? s.split(",", 2)[1] : s, mime: "image/jpeg" as const }));
  return maxPages ? pages.slice(0, maxPages) : pages;
}

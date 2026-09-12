// systemHeartbeat.tsx — V50.z200 — L'app comunica ad AxonOS versione installata e dispositivo (heartbeat)
// Montare UNA volta nel layout radice con utente loggato: all'avvio + al ritorno in foreground (max 1 ogni 30 min).
// Così Axon rileva da solo gli aggiornamenti dell'app (APK/IPA) e avvisa con le novità del CHANGELOG.
import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import * as Application from "expo-application";
import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "@/src/api";

const KEY = "axs_device_key_v1";

async function deviceKey(): Promise<string> {
  let k = await AsyncStorage.getItem(KEY);
  if (!k) {
    k = `${Platform.OS}-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    await AsyncStorage.setItem(KEY, k);
  }
  return k;
}

function appEnv(): string {
  if (Platform.OS === "web") return "web";
  return (Constants as any).appOwnership === "expo" || (Constants as any).executionEnvironment === "storeClient" ? "expo-go" : "standalone";
}

export async function sendSystemHeartbeat(): Promise<void> {
  const env = appEnv();
  await api("/axon/system/heartbeat", {
    method: "POST",
    body: {
      device_key: await deviceKey(),
      platform: Platform.OS,
      app_version: Platform.OS !== "web" && env === "standalone" ? Application.nativeApplicationVersion : null,
      build_number: Platform.OS !== "web" && env === "standalone" ? Application.nativeBuildVersion : null,
      js_version: Constants.expoConfig?.version || null,
      device_name: (Constants as any).deviceName || null,
      os_version: Platform.OS === "web" ? null : String((Platform as any).Version ?? ""),
      expo_sdk: Constants.expoConfig?.sdkVersion || null,
      app_env: env,
    },
  });
}

export function SystemHeartbeat({ userId }: { userId?: string | null }) {
  const last = useRef(0);
  useEffect(() => {
    if (!userId) return;
    const run = () => {
      if (Date.now() - last.current < 30 * 60 * 1000) return;
      last.current = Date.now();
      sendSystemHeartbeat().catch(() => {});
    };
    const t = setTimeout(run, 2500);
    const sub = AppState.addEventListener("change", (st) => { if (st === "active") run(); });
    return () => { clearTimeout(t); sub.remove(); };
  }, [userId]);
  return null;
}

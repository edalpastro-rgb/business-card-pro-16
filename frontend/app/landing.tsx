// landing.tsx — V50.z535 — /landing reindirizza alla landing pubblica esterna https://italianbrain.it (pagina statica su nginx).
// Il componente interno (src/landing/AxonCoreLanding.tsx) è stato rimosso. Se arriva ?ref=<codice amico> si va al login con il codice,
// così il referral continua a funzionare; su nativo si apre il browser e si torna al login.
import React, { useEffect } from "react";
import { View, ActivityIndicator, Linking, Platform, StyleSheet } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { LP } from "@/src/landing/palette";

export const PUBLIC_LANDING_URL = "https://italianbrain.it";

export default function LandingRedirect() {
  const router = useRouter();
  const { ref } = useLocalSearchParams<{ ref?: string }>();
  useEffect(() => {
    const code = typeof ref === "string" ? ref.trim() : "";
    if (code) { router.replace({ pathname: "/login", params: { ref: code, mode: "register" } } as any); return; }
    if (Platform.OS === "web") { (globalThis as any).window?.location?.replace(PUBLIC_LANDING_URL); return; }
    Linking.openURL(PUBLIC_LANDING_URL).catch(() => {});
    router.replace("/login" as any);
  }, [ref, router]);
  return <View style={s.root} testID="landing-redirect"><ActivityIndicator color={LP.axon} /></View>;
}

const s = StyleSheet.create({ root: { flex: 1, backgroundColor: LP.surface, alignItems: "center", justifyContent: "center" } });

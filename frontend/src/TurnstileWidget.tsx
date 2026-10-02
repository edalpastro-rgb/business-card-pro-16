// V50.z434 — Widget Cloudflare Turnstile (anti-bot) per la registrazione. La pagina del widget è servita dal backend
// (/api/auth/register/turnstile-page) e restituisce il token via postMessage: iframe su web, WebView su nativo.
// Il dominio del backend va aggiunto agli «hostnames» del sito Turnstile nel pannello Cloudflare.
import React, { useMemo, useEffect } from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import { WebView } from "react-native-webview";
import { BACKEND_URL } from "@/src/api";
import { HT } from "@/src/homeTheme";

type Props = { siteKey: string; onToken: (token: string | null) => void; theme?: "light" | "dark" | "auto" };

export function TurnstileWidget({ siteKey, onToken, theme = "dark" }: Props) {
  const url = useMemo(() => `${(BACKEND_URL || "").replace(/\/+$/, "")}/api/auth/register/turnstile-page?sitekey=${encodeURIComponent(siteKey)}&theme=${theme}`, [siteKey, theme]);

  const handle = (raw: string) => {
    try {
      const m = JSON.parse(raw);
      if (m?.type === "turnstile" && m.token) onToken(String(m.token));
      else if (m?.type === "turnstile-expired" || m?.type === "turnstile-error") onToken(null);
    } catch { /* messaggi di altri script */ }
  };

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const listener = (ev: MessageEvent) => { if (typeof ev.data === "string") handle(ev.data); };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!siteKey) return null;
  return (
    <View style={styles.wrap} testID="turnstile-widget">
      <Text style={styles.label}>Verifica anti-bot</Text>
      {Platform.OS === "web"
        ? React.createElement("iframe", { src: url, title: "Verifica anti-bot", style: { width: "100%", height: 72, border: 0, background: "transparent" }, sandbox: "allow-scripts allow-same-origin allow-forms allow-popups" })
        : <WebView source={{ uri: url }} style={styles.webview} onMessage={(e) => handle(e.nativeEvent.data)} javaScriptEnabled originWhitelist={["*"]} scrollEnabled={false} />}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { color: HT.text2, fontSize: 13, fontWeight: "600" },
  webview: { height: 72, backgroundColor: "transparent" },
});

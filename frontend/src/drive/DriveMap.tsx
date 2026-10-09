// DriveMap.tsx — V50.z497 — Axon Drive: mappa Google Maps EMBEDDED con il percorso attivo verso l'indirizzo del cliente.
//  Origine = GPS letto adesso (readOriginNow); URL classico «maps?saddr&daddr&output=embed» (nessuna chiave richiesta).
//  Web: <iframe>; nativo: react-native-webview. Pulsante piccolo «Apri nell'app» per la guida turn-by-turn in Google Maps / Waze.
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Platform, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { WebView } from "react-native-webview";
import { readOriginNow, openNavigation } from "@/src/utils/navLinks";

type Props = { address: string; label?: string };

export function driveEmbedUrl(address: string, origin?: { lat: number; lon: number } | null): string {
  const daddr = encodeURIComponent(address);
  const saddr = origin ? `&saddr=${origin.lat.toFixed(6)},${origin.lon.toFixed(6)}` : "";
  return `https://maps.google.com/maps?daddr=${daddr}${saddr}&dirflg=d&output=embed&hl=it`;
}

export function DriveMap({ address, label }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const o = await readOriginNow().catch(() => null);
      if (alive) setUrl(driveEmbedUrl(address, o));
    })();
    return () => { alive = false; };
  }, [address]);

  let map: React.ReactNode;
  if (!url) {
    map = <View style={styles.center}><ActivityIndicator color="#10B981" size="large" /><Text style={styles.hint}>Leggo la tua posizione…</Text></View>;
  } else if (Platform.OS === "web") {
    map = React.createElement("iframe", { src: url, style: { border: 0, width: "100%", height: "100%", borderRadius: 16 }, allow: "geolocation", loading: "eager", title: "Navigazione", "data-testid": "drive-map-iframe" });
  } else {
    map = <WebView source={{ uri: url }} style={styles.web} geolocationEnabled javaScriptEnabled domStorageEnabled startInLoadingState testID="drive-map-webview" />;
  }
  return (
    <View style={styles.wrap} testID="drive-map">
      <View style={styles.mapBox}>{map}</View>
      <View style={styles.bar}>
        <Ionicons name="navigate" size={18} color="#10B981" />
        <Text style={styles.addr} numberOfLines={1}>{label ? `${label} · ` : ""}{address}</Text>
        <Pressable onPress={() => void openNavigation("google", { address, label })} style={styles.openBtn} testID="drive-map-open-google" hitSlop={6}>
          <Text style={styles.openTxt}>Maps</Text>
        </Pressable>
        <Pressable onPress={() => void openNavigation("waze", { address, label })} style={[styles.openBtn, { backgroundColor: "#33CCFF" }]} testID="drive-map-open-waze" hitSlop={6}>
          <Text style={styles.openTxt}>Waze</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, gap: 8 },
  mapBox: { flex: 1, borderRadius: 16, overflow: "hidden", backgroundColor: "#0B1A2B" },
  web: { flex: 1, backgroundColor: "#0B1A2B" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  hint: { color: "rgba(255,255,255,0.75)", fontSize: 14 },
  bar: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 },
  addr: { flex: 1, color: "#FFF", fontSize: 14, fontWeight: "700" },
  openBtn: { minHeight: 36, paddingHorizontal: 12, borderRadius: 10, backgroundColor: "#4285F4", alignItems: "center", justifyContent: "center" },
  openTxt: { color: "#FFF", fontWeight: "900", fontSize: 13 },
});

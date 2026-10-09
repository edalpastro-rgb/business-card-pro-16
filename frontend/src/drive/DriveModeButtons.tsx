// DriveModeButtons.tsx — V50.z495/z497 — Axon Drive: i DUE bottoni in fondo alla schermata (nient'altro in basso).
//  «Tocca per parlare»: tocchi → parli → il silenzio (1-2 s) invia da solo (ri-tocco = invia subito). Pulsa in rosso mentre ascolta.
//  «Sempre attivo»: avvia/ferma l'ascolto continuo (Axon ascolta → risponde → riascolta).
import React from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { DriveAudioMode } from "./driveSettings";

type Props = { mode: DriveAudioMode; onPress: (m: DriveAudioMode) => void; listening: boolean; alwaysOn: boolean; busy?: boolean };

export function DriveModeButtons({ mode, onPress, listening, alwaysOn, busy }: Props) {
  const tapActive = mode === "tap" && listening;
  const alwaysActive = mode === "always" && alwaysOn;
  return (
    <View style={styles.row} testID="drive-mode-buttons">
      <Pressable
        onPress={() => onPress("tap")}
        accessibilityRole="button"
        accessibilityState={{ selected: mode === "tap" }}
        style={({ pressed }) => [styles.btn, mode === "tap" && styles.btnTap, tapActive && styles.btnTapLive, pressed && { opacity: 0.85 }]}
        testID="drive-mode-tap"
      >
        <View style={[styles.iconWrap, { backgroundColor: tapActive ? "#DC2626" : mode === "tap" ? "#38BDF8" : "rgba(255,255,255,0.14)" }]}>
          {busy && mode === "tap" ? <ActivityIndicator color="#FFF" /> : <Ionicons name={tapActive ? "stop" : "mic"} size={30} color="#FFF" />}
        </View>
        <Text style={[styles.title, mode === "tap" && { color: tapActive ? "#FCA5A5" : "#38BDF8" }]} numberOfLines={1}>Tocca per parlare</Text>
        <Text style={styles.sub} numberOfLines={1}>{tapActive ? "Ti ascolto… tocca per inviare" : "Tocchi, parli, invia da solo"}</Text>
      </Pressable>
      <Pressable
        onPress={() => onPress("always")}
        accessibilityRole="button"
        accessibilityState={{ selected: mode === "always" }}
        style={({ pressed }) => [styles.btn, mode === "always" && styles.btnAlways, alwaysActive && styles.btnAlwaysLive, pressed && { opacity: 0.85 }]}
        testID="drive-mode-always"
      >
        <View style={[styles.iconWrap, { backgroundColor: alwaysActive ? "#10B981" : mode === "always" ? "#10B981" : "rgba(255,255,255,0.14)" }]}>
          <Ionicons name={alwaysActive ? "stop" : "infinite"} size={30} color="#FFF" />
        </View>
        <Text style={[styles.title, mode === "always" && { color: "#34D399" }]} numberOfLines={1}>Sempre attivo</Text>
        <Text style={styles.sub} numberOfLines={1}>{alwaysActive ? "Ascolto continuo · tocca per fermare" : "Mani libere, ascolto continuo"}</Text>
        {alwaysActive ? <View style={styles.liveDot} /> : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 12, alignSelf: "stretch" },
  btn: { flex: 1, minHeight: 132, borderRadius: 22, borderWidth: 2, borderColor: "rgba(255,255,255,0.18)", backgroundColor: "rgba(6,14,26,0.72)", padding: 14, alignItems: "center", justifyContent: "center", gap: 6 },
  btnTap: { borderColor: "#38BDF8", backgroundColor: "rgba(56,189,248,0.18)" },
  btnTapLive: { borderColor: "#DC2626", backgroundColor: "rgba(220,38,38,0.22)" },
  btnAlways: { borderColor: "#10B981", backgroundColor: "rgba(16,185,129,0.18)" },
  btnAlwaysLive: { borderColor: "#34D399", backgroundColor: "rgba(16,185,129,0.3)" },
  iconWrap: { width: 60, height: 60, borderRadius: 30, alignItems: "center", justifyContent: "center" },
  title: { color: "#FFF", fontSize: 17, fontWeight: "900", textAlign: "center" },
  sub: { color: "rgba(255,255,255,0.72)", fontSize: 12, textAlign: "center" },
  liveDot: { position: "absolute", top: 10, right: 10, width: 12, height: 12, borderRadius: 6, backgroundColor: "#34D399" },
});

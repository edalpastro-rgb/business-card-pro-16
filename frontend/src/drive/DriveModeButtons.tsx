// DriveModeButtons.tsx — V50.z495 — Axon Drive: due bottoni grandi per la modalità di ascolto.
//  «Tocca per parlare»: tocchi il mic, parli, il silenzio (1-2 s) invia da solo.
//  «Sempre attivo»: microfono sempre aperto, Axon ascolta → risponde → riascolta, senza toccare nulla.
import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { DriveAudioMode } from "./driveSettings";

type Props = { mode: DriveAudioMode; onChange: (m: DriveAudioMode) => void; disabled?: boolean };

const OPTIONS: Array<{ id: DriveAudioMode; title: string; sub: string; icon: any; color: string }> = [
  { id: "tap", title: "Tocca per parlare", sub: "Tocchi, parli, invia da solo", icon: "hand-left", color: "#38BDF8" },
  { id: "always", title: "Sempre attivo", sub: "Ascolto continuo, mani libere", icon: "infinite", color: "#10B981" },
];

export function DriveModeButtons({ mode, onChange, disabled }: Props) {
  return (
    <View style={styles.row} testID="drive-mode-buttons">
      {OPTIONS.map((o) => {
        const on = mode === o.id;
        return (
          <Pressable
            key={o.id}
            onPress={() => onChange(o.id)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={({ pressed }) => [styles.btn, on && { borderColor: o.color, backgroundColor: `${o.color}33` }, pressed && { opacity: 0.85 }, disabled && { opacity: 0.6 }]}
            testID={`drive-mode-${o.id}`}
          >
            <View style={[styles.iconWrap, { backgroundColor: on ? o.color : "rgba(255,255,255,0.14)" }]}>
              <Ionicons name={o.icon} size={26} color="#FFF" />
            </View>
            <Text style={[styles.title, on && { color: o.color }]} numberOfLines={1}>{o.title}</Text>
            <Text style={styles.sub} numberOfLines={2}>{o.sub}</Text>
            {on ? <View style={[styles.badge, { backgroundColor: o.color }]}><Text style={styles.badgeTxt}>ATTIVA</Text></View> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 12, alignSelf: "stretch" },
  btn: { flex: 1, minHeight: 124, borderRadius: 20, borderWidth: 2, borderColor: "rgba(255,255,255,0.18)", backgroundColor: "rgba(6,14,26,0.66)", padding: 14, alignItems: "center", justifyContent: "center", gap: 6 },
  iconWrap: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  title: { color: "#FFF", fontSize: 16, fontWeight: "900", textAlign: "center" },
  sub: { color: "rgba(255,255,255,0.72)", fontSize: 12, textAlign: "center", lineHeight: 16 },
  badge: { position: "absolute", top: 8, right: 8, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  badgeTxt: { color: "#FFF", fontSize: 10, fontWeight: "900", letterSpacing: 1 },
});

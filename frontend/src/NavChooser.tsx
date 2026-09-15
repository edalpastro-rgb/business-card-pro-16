// NavChooser.tsx — V50.z253 — Popup di scelta navigatore (Google Maps · Waze · Apple Maps) con destinazione precompilata.
// Uso: const nav = useNavChooser(); nav.open({ lat, lon, label }); … {nav.element}
import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, Modal, Linking, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";

export type NavTarget = { lat?: number | null; lon?: number | null; address?: string; label?: string };

type App = { id: "google" | "waze" | "apple"; name: string; icon: any; color: string; url: (t: NavTarget) => string };

const dest = (t: NavTarget) => (t.lat != null && t.lon != null ? `${t.lat},${t.lon}` : encodeURIComponent(t.address || ""));

export const NAV_APPS: App[] = [
  { id: "google", name: "Google Maps", icon: "navigate", color: "#4285F4", url: (t) => `https://www.google.com/maps/dir/?api=1&destination=${dest(t)}&travelmode=driving` },
  { id: "waze", name: "Waze", icon: "car", color: "#33CCFF", url: (t) => (t.lat != null && t.lon != null ? `https://www.waze.com/ul?ll=${t.lat},${t.lon}&navigate=yes` : `https://www.waze.com/ul?q=${encodeURIComponent(t.address || "")}&navigate=yes`) },
  { id: "apple", name: "Maps (Apple)", icon: "map", color: "#111820", url: (t) => `https://maps.apple.com/?daddr=${dest(t)}&dirflg=d` },
];

/** Unisce indirizzo e città evitando duplicati («Via Verdi 15, 31100 Treviso, TV» + «Treviso»). */
export function joinAddr(address?: string | null, city?: string | null): string {
  const a = (address || "").trim(); const c = (city || "").trim();
  return !c || a.toLowerCase().includes(c.toLowerCase()) ? a : [a, c].filter(Boolean).join(", ");
}

export function openNavApp(app: App, t: NavTarget) {
  if ((t.lat == null || t.lon == null) && !t.address) { notify("Indirizzo mancante", "Nessuna posizione disponibile per questa tappa."); return; }
  Linking.openURL(app.url(t)).catch(() => notify("Navigazione", `Impossibile aprire ${app.name}`));
}

export function useNavChooser() {
  const [target, setTarget] = useState<NavTarget | null>(null);
  const apps = Platform.OS === "android" ? NAV_APPS.filter((a) => a.id !== "apple") : NAV_APPS;
  const element = (
    <Modal visible={!!target} transparent animationType="fade" onRequestClose={() => setTarget(null)}>
      <Pressable style={styles.backdrop} onPress={() => setTarget(null)} testID="nav-chooser-backdrop">
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()} testID="nav-chooser">
          <Text style={styles.title}>Naviga con…</Text>
          {!!target?.label && <Text style={styles.sub} numberOfLines={2}>{target.label}{target.address ? ` · ${target.address}` : ""}</Text>}
          {apps.map((a) => (
            <Pressable key={a.id} onPress={() => { const t = target!; setTarget(null); openNavApp(a, t); }} style={styles.row} testID={`nav-chooser-${a.id}`}>
              <View style={[styles.icon, { backgroundColor: a.color }]}><Ionicons name={a.icon} size={20} color="#FFF" /></View>
              <Text style={styles.rowTxt}>{a.name}</Text>
              <Ionicons name="open-outline" size={18} color={theme.color.muted} />
            </Pressable>
          ))}
          <Pressable onPress={() => setTarget(null)} style={styles.cancel} testID="nav-chooser-cancel"><Text style={styles.cancelTxt}>Annulla</Text></Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
  return { open: (t: NavTarget) => setTarget(t), element };
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", padding: 24 },
  sheet: { width: "100%", maxWidth: 360, backgroundColor: theme.color.surfaceSecondary, borderRadius: 18, padding: 16, gap: 8 },
  title: { fontSize: 17, fontWeight: "800", color: theme.color.onSurface },
  sub: { fontSize: 12, color: theme.color.muted, marginBottom: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingHorizontal: 10, borderRadius: 12, backgroundColor: theme.color.surface, minHeight: 52 },
  icon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  rowTxt: { flex: 1, fontSize: 15, fontWeight: "700", color: theme.color.onSurface },
  cancel: { alignItems: "center", paddingVertical: 12, minHeight: 44, justifyContent: "center" },
  cancelTxt: { color: theme.color.muted, fontWeight: "700" },
});

// NavChooser.tsx — V50.z253 — Popup di scelta navigatore (Google Maps · Waze · Apple Maps) con destinazione precompilata.
// Uso: const nav = useNavChooser(); nav.open({ lat, lon, label }); … {nav.element}
import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, Modal, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { notify } from "@/src/utils/notify";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium
import { openNavigation } from "@/src/utils/navLinks"; // V50.z488

export type NavTarget = { lat?: number | null; lon?: number | null; address?: string; label?: string };

type App = { id: "google" | "waze" | "apple"; name: string; icon: any; color: string; url: (t: NavTarget) => string };

const dest = (t: NavTarget) => (t.lat != null && t.lon != null ? `${t.lat},${t.lon}` : encodeURIComponent(t.address || ""));

export const NAV_APPS: App[] = [
  { id: "google", name: "Google Maps", icon: "navigate", color: "#4285F4", url: (t) => `https://www.google.com/maps/dir/?api=1&destination=${dest(t)}&travelmode=driving` },
  { id: "waze", name: "Waze", icon: "car", color: "#33CCFF", url: (t) => (t.lat != null && t.lon != null ? `https://www.waze.com/ul?ll=${t.lat},${t.lon}&navigate=yes` : `https://www.waze.com/ul?q=${encodeURIComponent(t.address || "")}&navigate=yes`) },
  { id: "apple", name: "Maps (Apple)", icon: "map", color: HT.text, url: (t) => `https://maps.apple.com/?daddr=${dest(t)}&dirflg=d` },
];

/** Unisce indirizzo e città evitando duplicati («Via Verdi 15, 31100 Treviso, TV» + «Treviso»). */
export function joinAddr(address?: string | null, city?: string | null): string {
  const a = (address || "").trim(); const c = (city || "").trim();
  return !c || a.toLowerCase().includes(c.toLowerCase()) ? a : [a, c].filter(Boolean).join(", ");
}

export function openNavApp(app: App, t: NavTarget) {
  // V50.z488 — GPS letto al momento del tap + destinazione in coordinate precise (Google Places); link waze://?ll= e maps/dir?origin=&destination=
  void openNavigation(app.id, { address: t.address, lat: t.lat, lon: t.lon, label: t.label });
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
              <Ionicons name="open-outline" size={18} color={HT.muted} />
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
  sheet: { width: "100%", maxWidth: 360, backgroundColor: HT.card2, borderRadius: 18, padding: 16, gap: 8 },
  title: { fontSize: 17, fontWeight: "800", color: HT.text },
  sub: { fontSize: 12, color: HT.muted, marginBottom: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingHorizontal: 10, borderRadius: 12, backgroundColor: HT.card2, minHeight: 52 },
  icon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  rowTxt: { flex: 1, fontSize: 15, fontWeight: "700", color: HT.text },
  cancel: { alignItems: "center", paddingVertical: 12, minHeight: 44, justifyContent: "center" },
  cancelTxt: { color: HT.muted, fontWeight: "700" },
});

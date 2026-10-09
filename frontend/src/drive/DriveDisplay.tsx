// DriveDisplay.tsx — V50.z495 — Axon Drive: display dinamico contestuale.
//  Default: comandi suggeriti. Dopo una richiesta vocale il contenuto cambia QUI (ritelefonate del giorno, ultima nota,
//  navigazione verso il cliente con scelta indirizzo) senza uscire dalla modalità Drive; dopo 5 s di inattività si torna ai suggerimenti.
import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { openNavigation, type NavApp } from "@/src/utils/navLinks";

export type DriveCallbackItem = { callback_id?: string; contact_id?: string; title: string; contact_name?: string | null; time: string; phone?: string | null; note?: string; area?: string };
export type DriveAddressOption = { key: string; label: string; address: string };
export type DriveDisplayData =
  | { type: "callbacks"; label: string; items: DriveCallbackItem[] }
  | { type: "note"; contact_name: string; contact_id?: string; text: string; date: string }
  | { type: "navigate"; contact_name: string; contact_id?: string; address: string; address_label?: string; nav_app?: NavApp | null }
  | { type: "navigate_choice"; contact_name: string; contact_id?: string; options: DriveAddressOption[]; nav_app?: NavApp | null };

export const DRIVE_SUGGESTIONS = [
  { emoji: "🧑", title: "Crea un contatto", sample: "Crea contatto Mario Rossi 333 1234567 Milano energia" },
  { emoji: "📝", title: "Aggiungi una nota", sample: "Aggiungi nota su Rossi: proposta gas entro venerdì" },
  { emoji: "📞", title: "Programma una richiamata", sample: "Programma richiamata a Rossi domani alle 15" },
  { emoji: "📋", title: "Mostra le ritelefonate", sample: "Mostrami le ritelefonate di oggi" },
  { emoji: "🧭", title: "Portami da un cliente", sample: "Portami da Rossi · Dammi le indicazioni per Bianchi" },
  { emoji: "💬", title: "Chiedi qualcosa ad Axon", sample: "Leggimi l'ultima nota su Rossi · Che tempo fa a Padova?" },
];

type Props = {
  data: DriveDisplayData | null;
  onPickAddress?: (opt: DriveAddressOption) => void;
};

export function openDriveNavigation(app: NavApp, address: string, label?: string) {
  return openNavigation(app, { address, label: label || address });
}

export function DriveDisplay({ data, onPickAddress }: Props) {
  if (!data) {
    return (
      <View style={styles.panel} testID="drive-examples">
        <Text style={styles.panelTitle}>Cosa puoi dirmi</Text>
        {DRIVE_SUGGESTIONS.map((ex) => (
          <View key={ex.title} style={styles.exRow}>
            <Text style={styles.exEmoji}>{ex.emoji}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.exTitle}>{ex.title}</Text>
              <Text style={styles.exSample} numberOfLines={2}>&ldquo;{ex.sample}&rdquo;</Text>
            </View>
          </View>
        ))}
      </View>
    );
  }

  if (data.type === "callbacks") {
    return (
      <View style={[styles.panel, { borderColor: "#F59E0B" }]} testID="drive-display-callbacks">
        <View style={styles.head}><Ionicons name="call" size={20} color="#F59E0B" /><Text style={[styles.panelTitle, { color: "#F59E0B", marginBottom: 0 }]}>{data.label}</Text><Text style={styles.count}>{data.items.length}</Text></View>
        {data.items.length === 0 ? <Text style={styles.empty}>Nessuna ritelefonata programmata</Text> : null}
        {data.items.map((it, i) => (
          <View key={it.callback_id || `${i}`} style={styles.cbRow} testID={`drive-cb-${i}`}>
            <View style={styles.timeBox}><Text style={styles.timeTxt}>{it.time || "--:--"}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cbName} numberOfLines={1}>{it.contact_name || it.title}</Text>
              {it.phone ? <Text style={styles.cbSub} numberOfLines={1}>{it.phone}</Text> : null}
              {it.note ? <Text style={styles.cbSub} numberOfLines={2}>{it.note}</Text> : null}
            </View>
            <View style={[styles.dot, { backgroundColor: it.area === "network" ? "#A78BFA" : "#38BDF8" }]} />
          </View>
        ))}
      </View>
    );
  }

  if (data.type === "note") {
    return (
      <View style={[styles.panel, { borderColor: "#A78BFA" }]} testID="drive-display-note">
        <View style={styles.head}><Ionicons name="document-text" size={20} color="#A78BFA" /><Text style={[styles.panelTitle, { color: "#A78BFA", marginBottom: 0 }]}>Ultima nota · {data.contact_name}</Text></View>
        {data.date ? <Text style={styles.cbSub}>{data.date}</Text> : null}
        <Text style={styles.noteTxt}>{data.text || "Nessuna nota scritta per questo cliente."}</Text>
      </View>
    );
  }

  if (data.type === "navigate_choice") {
    return (
      <View style={[styles.panel, { borderColor: "#10B981" }]} testID="drive-display-nav-choice">
        <View style={styles.head}><Ionicons name="navigate" size={20} color="#10B981" /><Text style={[styles.panelTitle, { color: "#10B981", marginBottom: 0 }]}>Quale indirizzo di {data.contact_name}?</Text></View>
        <Text style={styles.cbSub}>Dillo a voce («casa», «lavoro») oppure tocca</Text>
        {data.options.map((o, i) => (
          <Pressable key={o.key} onPress={() => onPickAddress?.(o)} style={({ pressed }) => [styles.optBtn, pressed && { opacity: 0.85 }]} testID={`drive-addr-${o.key}`}>
            <View style={styles.optNum}><Text style={styles.optNumTxt}>{i + 1}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cbName}>{o.label}</Text>
              <Text style={styles.cbSub} numberOfLines={2}>{o.address}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.7)" />
          </Pressable>
        ))}
      </View>
    );
  }

  // navigate
  return (
    <View style={[styles.panel, { borderColor: "#10B981" }]} testID="drive-display-navigate">
      <View style={styles.head}><Ionicons name="navigate" size={20} color="#10B981" /><Text style={[styles.panelTitle, { color: "#10B981", marginBottom: 0 }]}>Portami da {data.contact_name}</Text></View>
      {data.address ? (
        <>
          {data.address_label ? <Text style={styles.cbSub}>{data.address_label}</Text> : null}
          <Text style={styles.noteTxt}>{data.address}</Text>
          <View style={styles.navRow}>
            <Pressable onPress={() => void openDriveNavigation("google", data.address, data.contact_name)} style={({ pressed }) => [styles.navBtn, { backgroundColor: "#4285F4" }, pressed && { opacity: 0.85 }]} testID="drive-nav-google">
              <Ionicons name="navigate" size={22} color="#FFF" /><Text style={styles.navTxt}>Google Maps</Text>
            </Pressable>
            <Pressable onPress={() => void openDriveNavigation("waze", data.address, data.contact_name)} style={({ pressed }) => [styles.navBtn, { backgroundColor: "#33CCFF" }, pressed && { opacity: 0.85 }]} testID="drive-nav-waze">
              <Ionicons name="car" size={22} color="#FFF" /><Text style={styles.navTxt}>Waze</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <Text style={styles.empty}>Nessun indirizzo salvato: aggiungilo nella scheda cliente.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { alignSelf: "stretch", backgroundColor: "rgba(6,14,26,0.72)", borderRadius: 18, padding: 14, gap: 8, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.12)" },
  panelTitle: { color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  count: { marginLeft: "auto", color: "#FFF", fontWeight: "900", fontSize: 14, backgroundColor: "rgba(255,255,255,0.14)", paddingHorizontal: 10, paddingVertical: 2, borderRadius: 999 },
  empty: { color: "rgba(255,255,255,0.75)", fontSize: 15, fontStyle: "italic", paddingVertical: 8 },
  exRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 7, paddingHorizontal: 4, minHeight: 52 },
  exEmoji: { fontSize: 28, width: 38, textAlign: "center" },
  exTitle: { color: "#FFF", fontSize: 17, fontWeight: "800" },
  exSample: { color: "rgba(255,255,255,0.72)", fontSize: 13, lineHeight: 18, marginTop: 2 },
  cbRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingHorizontal: 4, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.1)", minHeight: 56 },
  timeBox: { backgroundColor: "rgba(245,158,11,0.2)", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  timeTxt: { color: "#F59E0B", fontWeight: "900", fontSize: 18 },
  cbName: { color: "#FFF", fontSize: 18, fontWeight: "800" },
  cbSub: { color: "rgba(255,255,255,0.72)", fontSize: 13, marginTop: 2 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  noteTxt: { color: "#FFF", fontSize: 19, lineHeight: 27, fontWeight: "600" },
  optBtn: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 64, borderRadius: 14, borderWidth: 1.5, borderColor: "rgba(16,185,129,0.6)", backgroundColor: "rgba(16,185,129,0.14)", paddingHorizontal: 12, paddingVertical: 10 },
  optNum: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#10B981", alignItems: "center", justifyContent: "center" },
  optNumTxt: { color: "#FFF", fontWeight: "900", fontSize: 18 },
  navRow: { flexDirection: "row", gap: 12, marginTop: 4 },
  navBtn: { flex: 1, minHeight: 64, borderRadius: 16, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  navTxt: { color: "#FFF", fontWeight: "900", fontSize: 16 },
});

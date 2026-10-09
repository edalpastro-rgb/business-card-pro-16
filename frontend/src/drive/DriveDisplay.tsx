// DriveDisplay.tsx — V50.z495/z497 — Axon Drive: DISPLAY DINAMICO CENTRALE (riempie lo spazio, nessuno scroll).
//  Default: 4 suggerimenti fissi. Dopo una richiesta vocale il contenuto cambia QUI, senza uscire dalla modalità Drive:
//  navigazione → mappa Google embedded a tutto display · foto → ritratto grande · elenco (ritelefonate/appuntamenti) → voci grandi ·
//  nota → testo grande (letto a voce). Dopo 5 s di inattività dalla risposta si torna ai suggerimenti (la mappa resta finché guidi).
import React from "react";
import { View, Text, StyleSheet, Pressable, Image } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { NavApp } from "@/src/utils/navLinks";
import { DriveMap } from "./DriveMap";

export type DriveListItem = { callback_id?: string; appointment_id?: string; contact_id?: string; title: string; contact_name?: string | null; time: string; phone?: string | null; note?: string; place?: string; area?: string };
export type DriveAddressOption = { key: string; label: string; address: string };
export type DriveDisplayData =
  | { type: "callbacks"; label: string; items: DriveListItem[] }
  | { type: "appointments"; label: string; items: DriveListItem[] }
  | { type: "note"; contact_name: string; contact_id?: string; text: string; date: string }
  | { type: "photo"; contact_name: string; contact_id?: string; photo: string; subtitle?: string }
  | { type: "navigate"; contact_name: string; contact_id?: string; address: string; address_label?: string; nav_app?: NavApp | null }
  | { type: "navigate_choice"; contact_name: string; contact_id?: string; options: DriveAddressOption[]; nav_app?: NavApp | null };

export const DRIVE_SUGGESTIONS = [
  { emoji: "🧑", title: "Crea un contatto", sample: "Crea contatto Mario Rossi 333 1234567 Milano energia" },
  { emoji: "📝", title: "Aggiungi una nota", sample: "Aggiungi nota su Rossi: proposta gas entro venerdì" },
  { emoji: "📞", title: "Programma una richiamata", sample: "Programma richiamata a Rossi domani alle 15" },
  { emoji: "💬", title: "Chiedi qualcosa ad Axon", sample: "Portami da Rossi · Mostrami le ritelefonate di oggi · Leggimi l'ultima nota su Rossi" },
];

type Props = { data: DriveDisplayData | null; onPickAddress?: (opt: DriveAddressOption) => void };

const MAX_ROWS = 6;

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

  if (data.type === "navigate") {
    if (!data.address) {
      return (
        <View style={[styles.panel, styles.centerPanel, { borderColor: "#10B981" }]} testID="drive-display-navigate">
          <Ionicons name="navigate" size={48} color="#10B981" />
          <Text style={styles.bigTxt}>Nessun indirizzo per {data.contact_name}</Text>
          <Text style={styles.sub}>Aggiungilo nella scheda cliente e riprova.</Text>
        </View>
      );
    }
    return <View style={styles.fill} testID="drive-display-navigate"><DriveMap address={data.address} label={data.contact_name} /></View>;
  }

  if (data.type === "photo") {
    return (
      <View style={[styles.panel, styles.centerPanel, { borderColor: "#A78BFA" }]} testID="drive-display-photo">
        {data.photo ? <Image source={{ uri: data.photo }} style={styles.photo} resizeMode="cover" testID="drive-photo-img" /> : (
          <View style={[styles.photo, styles.photoEmpty]}><Ionicons name="person" size={96} color="rgba(255,255,255,0.5)" /></View>
        )}
        <Text style={styles.bigTxt}>{data.contact_name}</Text>
        {data.subtitle ? <Text style={styles.sub}>{data.subtitle}</Text> : null}
        {!data.photo ? <Text style={styles.sub}>Nessuna foto nella scheda</Text> : null}
      </View>
    );
  }

  if (data.type === "callbacks" || data.type === "appointments") {
    const isCb = data.type === "callbacks";
    const color = isCb ? "#F59E0B" : "#38BDF8";
    const rows = data.items.slice(0, MAX_ROWS);
    return (
      <View style={[styles.panel, { borderColor: color }]} testID={`drive-display-${data.type}`}>
        <View style={styles.head}>
          <Ionicons name={isCb ? "call" : "calendar"} size={22} color={color} />
          <Text style={[styles.panelTitle, { color, marginBottom: 0 }]}>{data.label}</Text>
          <Text style={styles.count}>{data.items.length}</Text>
        </View>
        {rows.length === 0 ? <View style={styles.centerPanel}><Text style={styles.bigTxt}>{isCb ? "Nessuna ritelefonata" : "Nessun appuntamento"}</Text></View> : null}
        {rows.map((it, i) => (
          <View key={it.callback_id || it.appointment_id || `${i}`} style={styles.listRow} testID={`drive-${isCb ? "cb" : "appt"}-${i}`}>
            <View style={[styles.timeBox, { backgroundColor: `${color}33` }]}><Text style={[styles.timeTxt, { color }]}>{it.time || "--:--"}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.listName} numberOfLines={1}>{isCb ? (it.contact_name || it.title) : it.title}</Text>
              <Text style={styles.listSub} numberOfLines={1}>{isCb ? (it.phone || it.note || "") : [it.contact_name, it.place].filter(Boolean).join(" · ")}</Text>
            </View>
          </View>
        ))}
        {data.items.length > MAX_ROWS ? <Text style={styles.sub}>+{data.items.length - MAX_ROWS} altre</Text> : null}
      </View>
    );
  }

  if (data.type === "note") {
    return (
      <View style={[styles.panel, { borderColor: "#A78BFA" }]} testID="drive-display-note">
        <View style={styles.head}><Ionicons name="document-text" size={22} color="#A78BFA" /><Text style={[styles.panelTitle, { color: "#A78BFA", marginBottom: 0 }]}>Ultima nota · {data.contact_name}</Text>{data.date ? <Text style={styles.count}>{data.date}</Text> : null}</View>
        <View style={styles.centerPanel}>
          <Text style={styles.noteTxt} numberOfLines={9}>{data.text || "Nessuna nota scritta per questo cliente."}</Text>
        </View>
      </View>
    );
  }

  // navigate_choice
  return (
    <View style={[styles.panel, { borderColor: "#10B981" }]} testID="drive-display-nav-choice">
      <View style={styles.head}><Ionicons name="navigate" size={22} color="#10B981" /><Text style={[styles.panelTitle, { color: "#10B981", marginBottom: 0 }]}>Quale indirizzo di {data.contact_name}?</Text></View>
      <Text style={styles.sub}>Dillo a voce («casa», «lavoro») oppure tocca</Text>
      {data.options.slice(0, 3).map((o, i) => (
        <Pressable key={o.key} onPress={() => onPickAddress?.(o)} style={({ pressed }) => [styles.optBtn, pressed && { opacity: 0.85 }]} testID={`drive-addr-${o.key}`}>
          <View style={styles.optNum}><Text style={styles.optNumTxt}>{i + 1}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.listName}>{o.label}</Text>
            <Text style={styles.listSub} numberOfLines={2}>{o.address}</Text>
          </View>
          <Ionicons name="chevron-forward" size={22} color="rgba(255,255,255,0.7)" />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  panel: { flex: 1, backgroundColor: "rgba(6,14,26,0.72)", borderRadius: 18, padding: 14, gap: 8, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.12)", overflow: "hidden" },
  centerPanel: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  panelTitle: { color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  count: { marginLeft: "auto", color: "#FFF", fontWeight: "900", fontSize: 14, backgroundColor: "rgba(255,255,255,0.14)", paddingHorizontal: 10, paddingVertical: 2, borderRadius: 999 },
  sub: { color: "rgba(255,255,255,0.75)", fontSize: 14, textAlign: "center" },
  bigTxt: { color: "#FFF", fontSize: 24, fontWeight: "900", textAlign: "center" },
  exRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 4, minHeight: 52 },
  exEmoji: { fontSize: 30, width: 40, textAlign: "center" },
  exTitle: { color: "#FFF", fontSize: 19, fontWeight: "800" },
  exSample: { color: "rgba(255,255,255,0.72)", fontSize: 13, lineHeight: 18, marginTop: 2 },
  listRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 4, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.1)", minHeight: 52, maxHeight: 84 },
  timeBox: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, minWidth: 74, alignItems: "center" },
  timeTxt: { fontWeight: "900", fontSize: 20 },
  listName: { color: "#FFF", fontSize: 20, fontWeight: "800" },
  listSub: { color: "rgba(255,255,255,0.72)", fontSize: 14, marginTop: 2 },
  noteTxt: { color: "#FFF", fontSize: 22, lineHeight: 31, fontWeight: "600", textAlign: "center" },
  photo: { width: 220, height: 220, borderRadius: 110, borderWidth: 4, borderColor: "#A78BFA" },
  photoEmpty: { alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.08)" },
  optBtn: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 64, borderRadius: 14, borderWidth: 1.5, borderColor: "rgba(16,185,129,0.6)", backgroundColor: "rgba(16,185,129,0.14)", paddingHorizontal: 12, paddingVertical: 10 },
  optNum: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#10B981", alignItems: "center", justifyContent: "center" },
  optNumTxt: { color: "#FFF", fontWeight: "900", fontSize: 18 },
});

// CrtDocOrder.tsx — V50.z286 — Editor ordine documenti del PDF unico: righe riordinabili (▲▼), includi/escludi (occhio),
// tipologie personalizzate. Usato in Compilazione CRT (ordine predefinito, Master) e nella singola pratica (override).
import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

type Props = {
  order: string[];
  excluded: string[];
  labels: Record<string, string>;
  onChange: (order: string[], excluded: string[]) => void;
  onAddCustom?: (label: string) => void;
  testID?: string;
};

const ICON: Record<string, string> = { form_luce: "flash", form_gas: "flame", form_telco: "call", sepa: "card", pda: "document-text", procura: "ribbon", id_card: "id-card", tax_code: "medkit", visura: "business", visura_catastale: "home", iban: "cash", sdi: "at", cte: "pricetag", previous_contract: "document", bills: "receipt", referent: "person" };

export function CrtDocOrder({ order, excluded, labels, onChange, onAddCustom, testID = "crt-order" }: Props) {
  const [custom, setCustom] = useState("");
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir; if (j < 0 || j >= order.length) return;
    const next = [...order]; [next[i], next[j]] = [next[j], next[i]]; onChange(next, excluded);
  };
  const toggle = (k: string) => onChange(order, excluded.includes(k) ? excluded.filter((x) => x !== k) : [...excluded, k]);
  const included = order.filter((k) => !excluded.includes(k)).length;
  return (
    <View style={{ gap: 6 }} testID={testID}>
      <Text style={s.hint}>{included} tipologie nel PDF unico · tocca l&apos;occhio per escludere/includere, le frecce per spostare.</Text>
      {order.map((k, i) => {
        const off = excluded.includes(k);
        return (
          <View key={k} style={[s.row, off && s.rowOff]} testID={`${testID}-row-${k}`}>
            <Text style={s.num}>{off ? "–" : order.slice(0, i + 1).filter((x) => !excluded.includes(x)).length}</Text>
            <Ionicons name={(ICON[k] || (k.startsWith("custom_") ? "document-attach" : "document")) as any} size={16} color={off ? HT.muted : HT.brand} />
            <Text style={[s.lbl, off && { color: HT.muted, textDecorationLine: "line-through" }]} numberOfLines={1}>{labels[k] || k}</Text>
            <Pressable onPress={() => toggle(k)} hitSlop={6} style={s.ib} testID={`${testID}-toggle-${k}`} accessibilityLabel={off ? "Includi" : "Escludi"}><Ionicons name={off ? "eye-off-outline" : "eye-outline"} size={18} color={off ? HT.muted : HT.text} /></Pressable>
            <Pressable onPress={() => move(i, -1)} disabled={i === 0} hitSlop={4} style={[s.ib, i === 0 && { opacity: 0.25 }]} testID={`${testID}-up-${k}`} accessibilityLabel="Sposta su"><Ionicons name="chevron-up" size={18} color={HT.text} /></Pressable>
            <Pressable onPress={() => move(i, 1)} disabled={i === order.length - 1} hitSlop={4} style={[s.ib, i === order.length - 1 && { opacity: 0.25 }]} testID={`${testID}-down-${k}`} accessibilityLabel="Sposta giù"><Ionicons name="chevron-down" size={18} color={HT.text} /></Pressable>
          </View>
        );
      })}
      {onAddCustom ? (
        <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
          <TextInput value={custom} onChangeText={setCustom} placeholder="Altra tipologia (es. Contratto di locazione)" placeholderTextColor={HT.muted} style={s.input} testID={`${testID}-custom-input`} />
          <Pressable onPress={() => { if (custom.trim()) { onAddCustom(custom.trim()); setCustom(""); } }} disabled={!custom.trim()} style={[s.add, !custom.trim() && { opacity: 0.5 }]} testID={`${testID}-custom-add`}><Ionicons name="add" size={20} color="#FFF" /></Pressable>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  hint: { fontSize: 12, color: HT.muted, lineHeight: 17 },
  row: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, paddingHorizontal: 8, borderRadius: 10, backgroundColor: HT.card2, borderWidth: 1, borderColor: HT.border },
  rowOff: { backgroundColor: HT.card, borderStyle: "dashed" },
  num: { width: 20, fontSize: 12, fontWeight: "900", color: HT.muted, textAlign: "center" },
  lbl: { flex: 1, fontSize: 13, fontWeight: "700", color: HT.text },
  ib: { width: 36, height: 40, alignItems: "center", justifyContent: "center" },
  input: { flex: 1, backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border, borderRadius: 10, paddingHorizontal: 10, minHeight: 44, fontSize: 13, color: HT.text },
  add: { width: 44, height: 44, borderRadius: 12, backgroundColor: HT.brand, alignItems: "center", justifyContent: "center" },
});

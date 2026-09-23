/**
 * V50.z343 — Axon Lab · Checklist documenti (ordine fisso) con stato visivo per documento + barra di completamento.
 * Usata sia nell'Area Master (cliente tipo) sia nell'Area Consulente (pratica cliente).
 */
import React from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { HT } from "@/src/homeTheme";
import { type LabDocSpec, type LabDocEntry, STATUS_LABEL } from "@/src/axonlab/labApi";

type Props = {
  specs: LabDocSpec[];
  docs: Record<string, LabDocEntry>;
  busy: Record<string, boolean>;
  completion: { confirmed: number; total: number; percent: number };
  onPress: (spec: LabDocSpec) => void;
  title?: string;
};

export function statusColor(st: string) {
  return st === "confirmed" ? HT.success : st === "uploaded" ? HT.warning : HT.muted;
}

export function LabDocChecklist({ specs, docs, busy, completion, onPress, title }: Props) {
  return (
    <View style={s.wrap} testID="lab-checklist">
      <View style={s.head}>
        <Text style={s.title}>{title || "Checklist documenti"}</Text>
        <Text style={s.pct} testID="lab-checklist-pct">{completion.percent}% · {completion.confirmed}/{completion.total}</Text>
      </View>
      <View style={s.track}><View style={[s.fill, { width: `${Math.max(2, completion.percent)}%` }]} /></View>
      {specs.map((sp, i) => {
        const e = docs[sp.id] || { status: "none", files: [], extracted: {}, values: {} };
        const st = e.status || "none";
        const n = Object.keys(st === "confirmed" ? e.values || {} : e.extracted || {}).length;
        return (
          <Pressable key={sp.id} onPress={() => onPress(sp)} style={s.row} testID={`lab-doc-${sp.id}`}>
            <View style={[s.num, { borderColor: statusColor(st) }]}><Text style={[s.numTxt, { color: statusColor(st) }]}>{i + 1}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>{sp.label}</Text>
              <Text style={s.hint} numberOfLines={1}>{e.reused_from && st === "uploaded" ? `${e.reused_from} · da confermare` : e.derived_from && st === "uploaded" ? "Proposto da Axon · da confermare" : n > 0 ? `${n} dati ${st === "confirmed" ? "confermati" : "estratti"}` : sp.hint}</Text>
            </View>
            {busy[sp.id] ? <ActivityIndicator size="small" color={HT.axon} /> : (
              <View style={[s.pill, { backgroundColor: st === "confirmed" ? HT.successTint : st === "uploaded" ? HT.warningTint : HT.card2 }]}>
                <Ionicons name={st === "confirmed" ? "checkmark-circle" : st === "uploaded" ? "time" : "ellipse-outline"} size={13} color={statusColor(st)} />
                <Text style={[s.pillTxt, { color: statusColor(st) }]}>{STATUS_LABEL[st]}</Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { backgroundColor: HT.card, borderRadius: 16, borderWidth: 1, borderColor: HT.border, padding: 12, gap: 6 },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { color: HT.text, fontWeight: "900", fontSize: 15 },
  pct: { color: HT.axon, fontWeight: "800", fontSize: 12 },
  track: { height: 6, borderRadius: 999, backgroundColor: HT.card2, overflow: "hidden", marginBottom: 6 },
  fill: { height: 6, borderRadius: 999, backgroundColor: HT.axon },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, borderTopWidth: 1, borderTopColor: HT.border, minHeight: 52 },
  num: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  numTxt: { fontSize: 11, fontWeight: "900" },
  label: { color: HT.text, fontWeight: "700", fontSize: 13.5 },
  hint: { color: HT.muted, fontSize: 11.5, marginTop: 1 },
  pill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 999 },
  pillTxt: { fontSize: 10.5, fontWeight: "800" },
});

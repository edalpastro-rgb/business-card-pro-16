// app/axon-lab/rules.tsx — V50.z357 — AXON LAB · Riepilogo regole (Super Master): campo → documento sorgente → campo sorgente → moduli che la usano.
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { HT } from "@/src/homeTheme";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { LabHeader, labStyles as L } from "@/src/axonlab/LabHeader";

type Rule = { field_key: string; field_label: string; source: string; source_doc: string; source_key_label: string; modules: { template_id: string; name: string; trained: boolean }[] };
type Resp = { items: Rule[]; total: number; modules: number; trained: number; manual_fields: number };

export default function AxonLabRules() {
  const router = useRouter();
  const pagePad = usePageBottomPadding();
  const [data, setData] = useState<Resp | null>(null);
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try { setData(await api<Resp>("/lab/rules")); } catch (e: any) { setErr(e?.message || "Errore"); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const items = (data?.items || []).filter((r) => !q.trim() || `${r.field_label} ${r.source_doc} ${r.source_key_label} ${r.modules.map((m) => m.name).join(" ")}`.toLowerCase().includes(q.toLowerCase()));
  const byDoc = items.reduce<Record<string, Rule[]>>((acc, r) => { (acc[r.source_doc] = acc[r.source_doc] || []).push(r); return acc; }, {});

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: HT.card2 }} edges={["top"]}>
      <LabHeader title="Regole apprese" sub="Valgono per tutti i consulenti e tutti i clienti · data e luogo sempre manuali" testID="lab-rules" />
      {!data && !err ? <ActivityIndicator style={{ marginTop: 40 }} color={HT.axon} /> : null}
      {err ? <Text style={[L.cardSub, { margin: 14, color: HT.danger }]}>{err}</Text> : null}
      {data ? (
        <ScrollView contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: pagePad + 24 }}>
          <View style={s.stats}>
            {[[data.total, "regole"], [data.trained, "moduli addestrati"], [data.modules - data.trained, "da addestrare"], [data.manual_fields, "campi manuali"]].map(([n, l]) => (
              <View key={String(l)} style={s.stat}><Text style={s.statN}>{n}</Text><Text style={s.statL}>{l}</Text></View>
            ))}
          </View>
          <TextInput value={q} onChangeText={setQ} placeholder="Cerca campo, documento o modulo…" placeholderTextColor={HT.muted} style={L.input} testID="lab-rules-search" />
          {!items.length ? <Text style={L.cardSub}>Nessuna regola salvata: addestra un modulo nella Fase 2.</Text> : null}
          {Object.entries(byDoc).map(([doc, rules]) => (
            <View key={doc} style={L.card} testID={`lab-rules-doc-${doc.replace(/\W/g, "_")}`}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name="document-text" size={16} color={HT.axon} />
                <Text style={[L.cardTitle, { flex: 1 }]}>{doc}</Text>
                <Text style={L.muted}>{rules.length} {rules.length === 1 ? "regola" : "regole"}</Text>
              </View>
              {rules.map((r, i) => (
                <View key={`${r.source}-${i}`} style={s.rule}>
                  <View style={s.ruleRow}>
                    <Text style={s.field} numberOfLines={1}>{r.field_label.replace(/:$/, "")}</Text>
                    <Ionicons name="arrow-back" size={14} color={HT.muted} />
                    <Text style={s.src} numberOfLines={1}>{r.source_key_label}</Text>
                  </View>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                    {r.modules.map((m) => (
                      <Pressable key={m.template_id} onPress={() => router.push(`/axon-lab/module/${m.template_id}` as any)} style={[s.mod, !m.trained && { borderColor: HT.warning }]} testID={`lab-rule-mod-${m.template_id}`}>
                        <Ionicons name={m.trained ? "checkmark-circle" : "time-outline"} size={12} color={m.trained ? HT.success : HT.warning} />
                        <Text style={s.modTxt} numberOfLines={1}>{m.name}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          ))}
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  stats: { flexDirection: "row", gap: 8 },
  stat: { flex: 1, backgroundColor: HT.card, borderRadius: 12, borderWidth: 1, borderColor: HT.border, padding: 10, alignItems: "center" },
  statN: { color: HT.text, fontWeight: "900", fontSize: 18 },
  statL: { color: HT.muted, fontSize: 10.5, textAlign: "center" },
  rule: { gap: 6, paddingVertical: 8, borderTopWidth: 1, borderTopColor: HT.border },
  ruleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  field: { color: HT.text, fontWeight: "800", fontSize: 13, flexShrink: 1 },
  src: { color: HT.axon, fontWeight: "700", fontSize: 12.5, flexShrink: 1 },
  mod: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, minHeight: 28, borderRadius: 999, backgroundColor: HT.card2, borderWidth: 1, borderColor: HT.border, maxWidth: "100%" },
  modTxt: { color: HT.text2, fontSize: 11.5, fontWeight: "700" },
});

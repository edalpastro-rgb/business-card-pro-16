// app/axon-lab/index.tsx — V50.z343 — AXON LAB · hub: due aree separate (Addestramento Master · Compilazione Business)
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { HT } from "@/src/homeTheme";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { LabHeader, labStyles as L } from "@/src/axonlab/LabHeader";
import type { LabModule, LabPractice } from "@/src/axonlab/labApi";

export default function AxonLabHub() {
  const router = useRouter();
  const pagePad = usePageBottomPadding();
  const [access, setAccess] = useState<{ is_master: boolean; can_train: boolean } | null>(null);
  const [modules, setModules] = useState<LabModule[]>([]);
  const [practices, setPractices] = useState<LabPractice[]>([]);
  const [completion, setCompletion] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const a = await api<{ is_master: boolean; can_train: boolean }>("/lab/access");
      setAccess(a);
      const [m, p] = await Promise.all([api<{ items: LabModule[] }>("/lab/modules"), api<{ items: LabPractice[] }>("/lab/practices")]);
      setModules(m.items || []); setPractices(p.items || []);
      if (a.can_train) {
        const t = await api<{ completion: { percent: number } }>("/lab/training");
        setCompletion(t.completion.percent);
      }
    } catch { setAccess((a) => a || { is_master: false, can_train: false }); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const trained = modules.filter((m) => m.trained).length;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: HT.card2 }} edges={["top"]}>
      <LabHeader title="Axon Lab" sub="Mostra un esempio, collega i campi: Axon impara e compila da solo" testID="lab-hub" />
      {!access ? <ActivityIndicator style={{ marginTop: 40 }} color={HT.axon} /> : (
        <ScrollView contentContainerStyle={{ padding: 14, gap: 14, paddingBottom: pagePad + 24 }}>
          <View style={s.principle}>
            <Ionicons name="sparkles" size={18} color={HT.axon} />
            <Text style={s.principleTxt}>Documento compilato come esempio → modulo vuoto → collega i campi. Axon impara la regola generale e la applica a tutti i clienti.</Text>
          </View>

          {access.can_train ? (
            <Pressable onPress={() => router.push("/axon-lab/training" as any)} style={[L.card, s.area, { borderColor: HT.axonLine }]} testID="lab-area-training">
              <View style={[L.areaBadge, { backgroundColor: HT.axonTint }]}><Text style={[L.areaBadgeTxt, { color: HT.axon }]}>AREA MASTER · ADDESTRAMENTO</Text></View>
              <View style={s.areaRow}>
                <View style={[s.areaIcon, { backgroundColor: HT.axonTint }]}><Ionicons name="school" size={26} color={HT.axon} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={L.cardTitle}>Insegna ad Axon</Text>
                  <Text style={L.cardSub}>Fase 1 · anagrafica cliente tipo ({completion ?? 0}%) · Fase 2 · moduli addestrati {trained}/{modules.length}</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={HT.muted} />
              </View>
            </Pressable>
          ) : null}

          <Pressable onPress={() => router.push("/axon-lab/business" as any)} style={[L.card, s.area, { borderColor: HT.brandLine }]} testID="lab-area-business">
            <View style={[L.areaBadge, { backgroundColor: HT.brandTint }]}><Text style={[L.areaBadgeTxt, { color: HT.brand }]}>AREA CONSULENTE · COMPILAZIONE BUSINESS</Text></View>
            <View style={s.areaRow}>
              <View style={[s.areaIcon, { backgroundColor: HT.brandTint }]}><Ionicons name="documents" size={26} color={HT.brand} /></View>
              <View style={{ flex: 1 }}>
                <Text style={L.cardTitle}>Compila i contratti di un cliente</Text>
                <Text style={L.cardSub}>{practices.length} pratiche · {trained} moduli pronti · Axon compila tutti i moduli in parallelo</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={HT.muted} />
            </View>
          </Pressable>

          {access.is_master ? (
            <Pressable onPress={() => router.push("/axon-lab/delegates" as any)} style={[L.card, { flexDirection: "row", alignItems: "center", gap: 10 }]} testID="lab-delegates-link">
              <Ionicons name="people" size={20} color={HT.text2} />
              <View style={{ flex: 1 }}><Text style={[L.cardTitle, { fontSize: 14 }]}>{"Delegati all'addestramento"}</Text><Text style={L.cardSub}>Scegli i membri del team che possono aiutarti a insegnare ad Axon</Text></View>
              <Ionicons name="chevron-forward" size={18} color={HT.muted} />
            </Pressable>
          ) : null}

          {!access.can_train && trained === 0 ? (
            <View style={[L.card, { backgroundColor: HT.warningTint, borderColor: HT.warning }]}>
              <Text style={[L.cardSub, { color: HT.text }]}>{"Nessun modulo addestrato dal Master: chiedi al tuo Master di completare l'Area Addestramento di Axon Lab."}</Text>
            </View>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  principle: { flexDirection: "row", gap: 10, alignItems: "flex-start", backgroundColor: HT.card, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: HT.border },
  principleTxt: { color: HT.text2, fontSize: 12.5, lineHeight: 18, flex: 1 },
  area: { gap: 12 },
  areaRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  areaIcon: { width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center" },
});

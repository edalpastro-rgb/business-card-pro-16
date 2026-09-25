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
import type { LabModule } from "@/src/axonlab/labApi";

export default function AxonLabHub() {
  const router = useRouter();
  const pagePad = usePageBottomPadding();
  const [access, setAccess] = useState<{ is_master: boolean; can_train: boolean } | null>(null);
  const [modules, setModules] = useState<LabModule[]>([]);
    const [completion, setCompletion] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const a = await api<{ is_master: boolean; can_train: boolean }>("/lab/access");
      setAccess(a);
      const m = await api<{ items: LabModule[] }>("/lab/modules");
      setModules(m.items || []);
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
      <LabHeader title="Axon Lab" sub="Super Master · Axon impara dal cliente tipo e dalle tue regole" testID="lab-hub" />
      {!access ? <ActivityIndicator style={{ marginTop: 40 }} color={HT.axon} /> : !access.can_train ? (
        <View style={[L.card, { margin: 14, backgroundColor: HT.warningTint, borderColor: HT.warning }]} testID="lab-no-access">
          <Text style={[L.cardSub, { color: HT.text }]}>Axon Lab è riservato al Super Master e ai suoi delegati.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 14, gap: 14, paddingBottom: pagePad + 24 }}>
          <View style={s.principle}>
            <Ionicons name="sparkles" size={18} color={HT.axon} />
            <Text style={s.principleTxt}>Fase 1: documenti del cliente tipo → Axon impara i campi anagrafici. Fase 2: modulo vuoto + sorgente → per ogni campo scegli da dove prendere il dato. Axon salva la regola, non il valore: vale per tutti i consulenti e tutti i clienti. Data e luogo restano sempre manuali.</Text>
          </View>

          {/* V50.z356 — hub Super Master: due aree distinte, nessun riferimento alla compilazione consulente */}
          <Pressable onPress={() => router.push("/axon-lab/training" as any)} style={[L.card, s.area, { borderColor: HT.axonLine }]} testID="lab-area-training">
            <View style={[L.areaBadge, { backgroundColor: HT.axonTint }]}><Text style={[L.areaBadgeTxt, { color: HT.axon }]}>AREA 1 · FASE 1 · CLIENTE TIPO</Text></View>
            <View style={s.areaRow}>
              <View style={[s.areaIcon, { backgroundColor: HT.axonTint }]}><Ionicons name="person-circle" size={26} color={HT.axon} /></View>
              <View style={{ flex: 1 }}>
                <Text style={L.cardTitle}>Anagrafica base del cliente tipo</Text>
                <Text style={L.cardSub}>Carica i documenti di un cliente reale: Axon impara nome, CF, P.IVA, indirizzo, legale rappresentante, contatti, timbro · {completion ?? 0}% completato</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={HT.muted} />
            </View>
          </Pressable>

          <Pressable onPress={() => router.push("/axon-lab/training?phase=2" as any)} style={[L.card, s.area, { borderColor: HT.brandLine }]} testID="lab-area-modules">
            <View style={[L.areaBadge, { backgroundColor: HT.brandTint }]}><Text style={[L.areaBadgeTxt, { color: HT.brand }]}>AREA 2 · FASE 2 · ADDESTRAMENTO MODULI</Text></View>
            <View style={s.areaRow}>
              <View style={[s.areaIcon, { backgroundColor: HT.brandTint }]}><Ionicons name="git-branch" size={26} color={HT.brand} /></View>
              <View style={{ flex: 1 }}>
                <Text style={L.cardTitle}>Un modulo alla volta</Text>
                <Text style={L.cardSub}>Modulo vuoto + documento sorgente → per ogni campo «Da dove prendo questo dato?» → regola generale valida per tutto il team · {trained}/{modules.length} moduli addestrati</Text>
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

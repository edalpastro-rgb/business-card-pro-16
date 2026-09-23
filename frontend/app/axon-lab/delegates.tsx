// app/axon-lab/delegates.tsx — V50.z343 — AXON LAB · Delegati all'addestramento (solo Master)
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Switch, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { HT } from "@/src/homeTheme";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { LabHeader, labStyles as L } from "@/src/axonlab/LabHeader";

type Member = { user_id: string; name?: string; email?: string; role?: string };

export default function AxonLabDelegates() {
  const pagePad = usePageBottomPadding();
  const [members, setMembers] = useState<Member[]>([]);
  const [delegates, setDelegates] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { const r = await api<{ delegates: string[]; members: Member[] }>("/lab/delegates"); setMembers(r.members || []); setDelegates(r.delegates || []); }
    catch (e: any) { notify("Delegati", e?.message || ""); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggle = async (uid: string, on: boolean) => {
    const next = on ? [...delegates, uid] : delegates.filter((d) => d !== uid);
    setDelegates(next);
    try { const r = await api<{ delegates: string[] }>("/lab/delegates", { method: "PUT", body: { delegates: next } }); setDelegates(r.delegates); }
    catch (e: any) { notify("Errore", e?.message || ""); load(); }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: HT.card2 }} edges={["top"]}>
      <LabHeader title="Delegati Axon Lab" sub="Chi può aiutarti nell'Area Addestramento" testID="lab-delegates" />
      {loading ? <ActivityIndicator style={{ marginTop: 40 }} color={HT.axon} /> : (
        <ScrollView contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: pagePad + 24 }}>
          <Text style={L.cardSub}>I delegati possono caricare documenti del cliente tipo, confermare i dati e addestrare i moduli. Il modello resta unico e globale per tutto il team.</Text>
          {members.length === 0 ? <View style={L.card}><Text style={L.cardSub}>Nessun membro nel team. Aggiungi collaboratori da Impostazioni › Team.</Text></View> : null}
          {members.map((mb) => {
            const on = delegates.includes(mb.user_id);
            return (
              <View key={mb.user_id} style={[L.card, s.row]} testID={`lab-delegate-${mb.user_id}`}>
                <View style={[s.avatar, { backgroundColor: on ? HT.axonTint : HT.card2 }]}><Ionicons name="person" size={18} color={on ? HT.axon : HT.muted} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={L.cardTitle} numberOfLines={1}>{mb.name || mb.email}</Text>
                  <Text style={L.cardSub} numberOfLines={1}>{mb.email} · {mb.role || "membro"}{on ? " · Delegato Axon Lab" : ""}</Text>
                </View>
                <Switch value={on} onValueChange={(v) => toggle(mb.user_id, v)} trackColor={{ true: HT.axon, false: HT.border }} thumbColor={HT.white} />
              </View>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
});

// AxonInitiativeCard.tsx — V50.z419 — Livello di iniziativa di Axon (collaboratore): cresce con la fiducia del cliente.
// 1 · Discreto: solo il colore ambra sul pallino quando ha qualcosa da dirti.
// 2 · Una riga in chat: «Ho qualcosa da dirti, quando vuoi» — tocchi tu quando vuoi.
// 3 · Inizia lui: appena apri la chat Axon parla per primo («Ho una cosa da dirti»). Autorizzazione esplicita del cliente.
import React, { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { HT } from "@/src/homeTheme";
import { notify } from "@/src/utils/notify";

const LEVELS = [
  { k: 1, icon: "ellipse-outline" as const, title: "Discreto", sub: "Solo il pallino cambia colore (ambra) quando Axon ha qualcosa da dirti." },
  { k: 2, icon: "chatbubble-ellipses-outline" as const, title: "Una riga in chat", sub: "«Ho qualcosa da dirti, quando vuoi»: la apri tu, quando vuoi." },
  { k: 3, icon: "flash-outline" as const, title: "Inizia lui", sub: "Appena apri la chat Axon parla per primo. Autorizzi tu, esplicitamente." },
];

export function AxonInitiativeCard() {
  const [level, setLevel] = useState<number>(1);
  useEffect(() => { api<{ level: number }>("/axon/briefing").then((b) => setLevel(b?.level || 1)).catch(() => {}); }, []);
  const choose = async (k: number) => {
    setLevel(k);
    try { await api("/axon/briefing/level", { method: "PUT", body: { level: k } }); }
    catch (e: any) { notify("Axon", e?.message || "Salvataggio non riuscito"); }
  };
  return (
    <View style={s.card} testID="axon-initiative-card">
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Ionicons name="people-outline" size={18} color={HT.violet} />
        <Text style={s.title}>Iniziativa di Axon</Text>
      </View>
      <Text style={s.hint}>Axon analizza da solo i tuoi dati (contratti, ritelefonate, agenda, PUN, lead) e prepara un briefing. Decidi tu quanto può farsi avanti.</Text>
      {LEVELS.map((l) => {
        const on = level === l.k;
        return (
          <Pressable key={l.k} onPress={() => choose(l.k)} style={[s.row, on && s.rowOn]} testID={`axon-initiative-${l.k}`} accessibilityRole="radio" accessibilityState={{ selected: on }}>
            <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={20} color={on ? HT.violet : HT.muted} />
            <Ionicons name={l.icon} size={18} color={on ? HT.violet : HT.text2} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[s.lbl, on && { color: HT.violet }]}>{l.k} · {l.title}</Text>
              <Text style={s.sub}>{l.sub}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: HT.card, borderRadius: 14, borderWidth: 1, borderColor: HT.border, padding: 14, gap: 10, marginTop: 14 },
  title: { fontSize: 15, fontWeight: "900", color: HT.text, flex: 1 },
  hint: { fontSize: 12.5, color: HT.muted, lineHeight: 18 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 12, borderWidth: 1, borderColor: HT.border, backgroundColor: HT.card2, paddingVertical: 10, paddingHorizontal: 12, minHeight: 56 },
  rowOn: { borderColor: HT.violet, backgroundColor: HT.violetTint },
  lbl: { fontSize: 14, fontWeight: "800", color: HT.text },
  sub: { fontSize: 11.5, color: HT.muted, marginTop: 2 },
});

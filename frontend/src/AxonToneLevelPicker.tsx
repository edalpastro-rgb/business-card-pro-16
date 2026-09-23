// src/AxonToneLevelPicker.tsx — V50.z218 — BLOCCO 6: selezione tono di AxonOS a 5 livelli (5 = «Fantasiosa», under 35).
// GET/PUT /axon/tone-level. Il livello 5 non si attiva mai da solo nei contesti formali (contratti, mail ufficiali, documenti legali):
// lì AxonOS torna al professionale; l'utente può forzarlo con «forza tono informale» (flag mostrato qui, disattivabile).
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Switch, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

const PURPLE = "#7C3AED";
type Level = { level: number; key: string; name: string; emoji: string; desc: string; example?: string };
type St = { level: number; force_informal: boolean; levels: Level[] };

export function AxonToneLevelPicker({ title = "Tono di AxonOS", intro }: { title?: string; intro?: string }) {
  const [st, setSt] = useState<St | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => { api<St>("/axon/tone-level").then(setSt).catch(() => {}); }, []);
  if (!st) return null;
  const save = async (body: { level?: number; force_informal?: boolean }) => {
    const next = { ...st, ...body, force_informal: body.level !== undefined && body.level !== 5 ? false : (body.force_informal ?? st.force_informal) };
    setSt(next);
    try { const r = await api<Partial<St>>("/axon/tone-level", { method: "PUT", body }); setSt((s) => (s ? { ...s, ...r } : s)); setSaved(true); setTimeout(() => setSaved(false), 1800); } catch {}
  };
  const cur = st.levels.find((l) => l.level === st.level);
  return (
    <View style={{ marginTop: 14 }} testID="axon-tone-picker">
      <Text style={styles.label}>{title} {saved ? <Text style={{ color: "#16A34A" }}>· ✓ Salvato</Text> : null}</Text>
      {!!intro && <Text style={styles.intro}>{intro}</Text>}
      <View style={styles.row}>
        {st.levels.map((l) => {
          const on = l.level === st.level;
          return (
            <Pressable key={l.level} onPress={() => save({ level: l.level })} style={[styles.chip, on && styles.chipOn, l.level === 5 && on && styles.chipFun]} testID={`axon-tone-${l.level}`} accessibilityRole="radio" accessibilityState={{ selected: on }}>
              <Text style={styles.chipNum}>{l.level}</Text>
              <Text style={styles.chipEmoji}>{l.emoji}</Text>
              <Text style={[styles.chipName, on && { color: l.level === 5 ? "#FDBA74" : PURPLE }]} numberOfLines={1}>{l.name}</Text>
            </Pressable>
          );
        })}
      </View>
      {cur && <Text style={styles.desc} testID="axon-tone-desc">{cur.emoji} <Text style={{ fontWeight: "800" }}>{cur.name}</Text> · {cur.desc}</Text>}
      {/* V50.z219 — anteprima: una riga d'esempio per ogni livello, tap = seleziona */}
      <View style={styles.examples} testID="axon-tone-examples">
        {st.levels.map((l) => {
          const on = l.level === st.level;
          return (
            <Pressable key={l.level} onPress={() => save({ level: l.level })} style={[styles.exRow, on && styles.exRowOn, on && l.level === 5 && styles.exRowFun]} testID={`axon-tone-example-${l.level}`}>
              <Text style={styles.exEmoji}>{l.emoji}</Text>
              <Text style={[styles.exTxt, on && { color: HT.text, fontWeight: "700" }]} numberOfLines={2}>«{l.example}»</Text>
            </Pressable>
          );
        })}
      </View>
      {st.level === 5 && (
        <View style={styles.funBox} testID="axon-tone-fun-note">
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
            <Ionicons name="shield-checkmark" size={16} color="#FDBA74" style={{ marginTop: 1 }} />
            <Text style={styles.funTxt}>Nei contesti formali (contratti, mail e PEC ufficiali, documenti legali) AxonOS torna da solo al tono professionale, anche con il livello 5. Per averlo informale anche lì basta dirgli in chat «forza tono informale»; «torna al tono professionale» annulla.</Text>
          </View>
          <View style={styles.forceRow}>
            <Text style={styles.forceTxt}>Forza informale anche nei contesti formali</Text>
            <Switch value={st.force_informal} onValueChange={(v) => save({ force_informal: v })} trackColor={{ true: "#FDBA74", false: "#CBD5E1" }} thumbColor={Platform.OS === "android" ? "#FFF" : undefined} testID="axon-tone-force-switch" />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: "700", color: HT.text2 },
  row: { flexDirection: "row", gap: 6, marginTop: 6 },
  chip: { flex: 1, alignItems: "center", justifyContent: "center", gap: 2, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 2, borderWidth: 1, borderColor: HT.border, backgroundColor: HT.card, minHeight: 64 },
  chipOn: { backgroundColor: '#F1EEFF', borderColor: PURPLE },
  chipFun: { backgroundColor: HT.brandTint, borderColor: '#F97316' },
  chipNum: { fontSize: 10, fontWeight: "800", color: HT.muted },
  chipEmoji: { fontSize: 18 },
  chipName: { fontSize: 9.5, fontWeight: "700", color: HT.text2 },
  intro: { fontSize: 12, color: HT.muted, marginTop: 2, lineHeight: 16 },
  desc: { fontSize: 12, color: HT.text2, marginTop: 8, lineHeight: 17 },
  examples: { marginTop: 8, gap: 4 },
  exRow: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, paddingVertical: 6, paddingHorizontal: 8, borderWidth: 1, borderColor: "transparent", minHeight: 40 },
  exRowOn: { backgroundColor: '#F1EEFF', borderColor: HT.violet + '66' },
  exRowFun: { backgroundColor: HT.brandTint, borderColor: HT.brandLine },
  exEmoji: { fontSize: 14 },
  exTxt: { flex: 1, fontSize: 11.5, color: HT.muted, lineHeight: 15, fontStyle: "italic" },
  funBox: { marginTop: 8, backgroundColor: HT.brandTint, borderRadius: 12, padding: 10, gap: 8, borderWidth: 1, borderColor: HT.brandLine },
  funTxt: { flex: 1, fontSize: 11.5, color: "#7C2D12", lineHeight: 16 },
  forceRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  forceTxt: { flex: 1, fontSize: 12, fontWeight: "700", color: "#7C2D12" },
});

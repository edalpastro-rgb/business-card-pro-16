// AiCreditsCard.tsx — V50.z526 — Profilo: badge «Fondatore» (primi 100 workspace) + barra crediti AI del mese
// (consumati/restanti fino al reset del 1°) + box separato per i crediti bonus referral che non scadono.
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { api } from "@/src/api";
import { HT } from "@/src/homeTheme";
import { theme } from "@/src/theme";

const GOLD = "#D4A017"; // oro del badge Fondatore: identico in chiaro e scuro

type Founder = { founder: boolean; rank: number | null; max_rank: number; text: string | null };
type Credits = { base_credits: number; bonus_credits: number; monthly_base: number; total: number; renews_on?: string; enforce: boolean };

function renewalLabel(iso?: string): string {
  const d = iso ? new Date(`${iso}T00:00:00`) : new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1);
  return d.toLocaleDateString("it-IT", { day: "numeric", month: "long" });
}

export function FounderBadge() {
  const [f, setF] = useState<Founder | null>(null);
  useEffect(() => { api<Founder>("/profile/founder").then(setF).catch(() => {}); }, []);
  if (!f?.founder) return null;
  return (
    <View style={s.founder} testID="founder-badge">
      <View style={s.founderHead}>
        <Ionicons name="ribbon" size={16} color={GOLD} />
        <Text style={s.founderTitle}>Fondatore{f.rank ? ` · #${f.rank}` : ""}</Text>
      </View>
      <Text style={s.founderTxt}>{f.text}</Text>
    </View>
  );
}

export function AiCreditsCard() {
  const [c, setC] = useState<Credits | null | false>(null); // false = endpoint non disponibile → card nascosta
  const load = useCallback(() => { api<Credits>("/ai/credits/me").then(setC).catch(() => setC(false)); }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  if (c === false) return null;
  if (!c) return <View style={s.card} testID="ai-credits-card"><ActivityIndicator color={HT.violet} /></View>;
  const total = Math.max(c.monthly_base, 1);
  const left = Math.max(0, Math.min(c.base_credits, c.monthly_base));
  const used = c.monthly_base - left;
  const pctLeft = left / total;
  const barColor = pctLeft > 0.5 ? HT.success : pctLeft > 0.2 ? HT.warning : HT.danger;
  return (
    <View style={s.card} testID="ai-credits-card">
      <View style={s.head}>
        <View style={s.icon}><Ionicons name="chatbubbles" size={18} color={HT.violet} /></View>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Crediti AI · chat con Axon</Text>
          <Text style={s.sub}>Solo la chat (testo e voce) consuma crediti. Tutte le altre funzioni AI sono incluse senza limiti.</Text>
        </View>
      </View>

      <View style={s.rowBetween}>
        <Text style={s.lbl}>Crediti base del mese</Text>
        <Text style={s.val} testID="ai-credits-left">{left} <Text style={s.valMuted}>/ {c.monthly_base}</Text></Text>
      </View>
      <View style={s.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: c.monthly_base, now: left }}>
        <View style={[s.fill, { width: `${Math.round(pctLeft * 100)}%`, backgroundColor: barColor }]} />
      </View>
      <View style={s.rowBetween}>
        <Text style={s.meta} testID="ai-credits-used">Usati {used}</Text>
        <Text style={s.meta}>Reset il {renewalLabel(c.renews_on)}</Text>
      </View>
      {left === 0 ? <Text style={[s.meta, { color: HT.danger, fontWeight: "800" }]}>{c.enforce ? "Chat Axon in pausa fino al reset (o con un pacchetto add-on)." : "Crediti base esauriti: stai usando i bonus."}</Text> : null}

      <View style={s.bonus} testID="ai-credits-bonus">
        <View style={s.bonusIcon}><Ionicons name="gift" size={18} color={HT.violet} /></View>
        <View style={{ flex: 1 }}>
          <Text style={s.bonusTitle}>Crediti bonus · non scadono</Text>
          <Text style={s.sub}>Accumulati con «Porta un amico» e pacchetti add-on. Si usano dopo i crediti base.</Text>
        </View>
        <Text style={s.bonusVal} testID="ai-credits-bonus-value">{c.bonus_credits}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  founder: { marginTop: 8, alignSelf: "flex-start", backgroundColor: "rgba(212,160,23,0.14)", borderWidth: 1, borderColor: GOLD, borderRadius: theme.radius.md, paddingHorizontal: 10, paddingVertical: 6, gap: 2 },
  founderHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  founderTitle: { fontSize: 12, fontWeight: "900", color: GOLD, letterSpacing: 0.3 },
  founderTxt: { fontSize: 11.5, fontWeight: "700", color: HT.text },
  card: { backgroundColor: HT.card, borderRadius: theme.radius.md, padding: 16, borderWidth: 1, borderColor: HT.border, gap: 10 },
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  icon: { width: 40, height: 40, borderRadius: 12, backgroundColor: HT.violetTint, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 15, fontWeight: "700", color: HT.text },
  sub: { fontSize: 12, color: HT.muted, marginTop: 2, lineHeight: 16 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  lbl: { fontSize: 12.5, fontWeight: "700", color: HT.text2 },
  val: { fontSize: 16, fontWeight: "900", color: HT.text },
  valMuted: { fontSize: 12.5, fontWeight: "700", color: HT.muted },
  track: { height: 10, borderRadius: 5, backgroundColor: HT.card2, borderWidth: 1, borderColor: HT.border, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 5 },
  meta: { fontSize: 12, color: HT.muted, fontWeight: "600" },
  bonus: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 4, backgroundColor: HT.violetTint, borderRadius: theme.radius.md, padding: 12, borderWidth: 1, borderColor: HT.violet + "55" },
  bonusIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: HT.card, alignItems: "center", justifyContent: "center" },
  bonusTitle: { fontSize: 13.5, fontWeight: "800", color: HT.text },
  bonusVal: { fontSize: 22, fontWeight: "900", color: HT.violet },
});

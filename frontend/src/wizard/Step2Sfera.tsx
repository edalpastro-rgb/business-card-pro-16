// src/wizard/Step2Sfera.tsx — V50.z214 — BLOCCO 3 · Step 2 «Sfera»: scelta OBBLIGATORIA fra Business, Home, Entrambe.
// «Entrambe» attiva entrambi i percorsi (Business + Home) nello Step 3 «Aree». Salva in PUT /axon/setup/sphere-areas {sphere}.
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { api } from "@/src/api";
import type { StepBinder } from "@/src/wizard/Step1Anagrafica";
import { AxonToneLevelPicker } from "@/src/AxonToneLevelPicker"; // V50.z219 — tono nel wizard
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

export type Sphere = "business" | "home" | "both";

const OPTIONS: Array<{ key: Sphere; title: string; desc: string; icon: keyof typeof Ionicons.glyphMap; colors: [string, string]; emoji: string }> = [
  { key: "business", title: "Business", desc: "Clienti, bollette, PUN, mail, team: AdvisorOS come strumento di lavoro.", icon: "briefcase", colors: [HT.axon, "#3B82F6"], emoji: "🟦" },
  { key: "home", title: "Home", desc: "La tua vita privata: ricordi, spese, meteo, sveglie. Mai mescolata al CRM.", icon: "home", colors: [HT.success, "#10B981"], emoji: "🟢" },
  { key: "both", title: "Entrambe", desc: "Lavoro e vita privata insieme: Axon tiene le due sfere separate, tu le usi entrambe.", icon: "infinite", colors: [HT.violet, "#A855F7"], emoji: "✨" },
];

export function Step2Sfera({ bind, initial }: { bind: StepBinder; initial?: Sphere | null }) {
  const [sphere, setSphere] = useState<Sphere | null>(initial ?? null);
  const [error, setError] = useState("");

  const submit = useCallback(async (): Promise<boolean> => {
    if (!sphere) { setError("Scegli una sfera per continuare: puoi cambiarla in ogni momento da Impostazioni."); return false; }
    try { await api("/axon/setup/sphere-areas", { method: "PUT", body: { sphere } }); return true; }
    catch (e: any) { setError(e?.message || "Salvataggio non riuscito"); return false; }
  }, [sphere]);
  useEffect(() => { bind(submit); }, [bind, submit]);

  return (
    <View style={{ gap: 12 }} testID="step2-sfera">
      <Text style={styles.lead}>In quale sfera userai AdvisorOS? <Text style={{ color: "#DC2626" }}>*</Text></Text>
      {OPTIONS.map((o) => {
        const on = sphere === o.key;
        return (
          <Pressable key={o.key} onPress={() => { setSphere(o.key); setError(""); }} style={[styles.card, on && styles.cardOn]} testID={`sfera-pick-${o.key}`} accessibilityRole="radio" accessibilityState={{ selected: on }}>
            <LinearGradient colors={o.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.iconWrap}>
              <Ionicons name={o.icon} size={26} color="#FFF" />
            </LinearGradient>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.title}>{o.emoji} {o.title}</Text>
              <Text style={styles.desc}>{o.desc}</Text>
            </View>
            <View style={[styles.radio, on && styles.radioOn]}>{on && <Ionicons name="checkmark" size={14} color="#FFF" />}</View>
          </Pressable>
        );
      })}
      {sphere === "both" && <Text style={styles.hint} testID="sfera-both-hint">Nel prossimo passo vedrai prima le aree Business, poi quelle Home.</Text>}
      {!!error && <Text style={styles.err} testID="sfera-error">{error}</Text>}
      {/* V50.z219 — Come deve parlarti Neo: si salva subito, Neo parla così dal primo giorno */}
      <View style={styles.toneCard} testID="sfera-tone">
        <AxonToneLevelPicker title="Come deve parlarti Neo?" intro="Scegli il tono: si applica subito, lo cambi quando vuoi da Impostazioni → AxonOS." />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  lead: { fontSize: 14.5, fontWeight: "800", color: HT.text, marginTop: 4 },
  card: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: HT.card, borderRadius: 18, padding: 14, minHeight: 84, borderWidth: 2, borderColor: HT.violetTint },
  cardOn: { borderColor: '#7C3AED', backgroundColor: HT.violetTint },
  iconWrap: { width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 17, fontWeight: "900", color: HT.text },
  desc: { fontSize: 12.5, color: HT.muted, lineHeight: 17 },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: HT.borderStrong, alignItems: "center", justifyContent: "center" },
  radioOn: { borderColor: '#7C3AED', backgroundColor: '#7C3AED' },
  hint: { fontSize: 12.5, color: HT.violet, fontWeight: "700", backgroundColor: HT.violetTint, borderRadius: 12, padding: 10 },
  err: { fontSize: 12.5, color: "#DC2626", fontWeight: "700" },
  toneCard: { backgroundColor: HT.card, borderRadius: 18, padding: 14, paddingTop: 2, borderWidth: 1, borderColor: HT.violetTint, marginTop: 4 },
});

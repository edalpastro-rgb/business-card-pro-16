// src/wizard/Step2Sfera.tsx — V50.z214 — BLOCCO 3 · Step 2 «Sfera»: scelta OBBLIGATORIA fra Business, Home, Entrambe.
// «Entrambe» attiva entrambi i percorsi (Business + Home) nello Step 3 «Aree». Salva in PUT /axon/setup/sphere-areas {sphere}.
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { api } from "@/src/api";
import type { StepBinder } from "@/src/wizard/Step1Anagrafica";

export type Sphere = "business" | "home" | "both";

const OPTIONS: Array<{ key: Sphere; title: string; desc: string; icon: keyof typeof Ionicons.glyphMap; colors: [string, string]; emoji: string }> = [
  { key: "business", title: "Business", desc: "Clienti, bollette, PUN, mail, team: AdvisorOS come strumento di lavoro.", icon: "briefcase", colors: ["#1D4ED8", "#3B82F6"], emoji: "🟦" },
  { key: "home", title: "Home", desc: "La tua vita privata: ricordi, spese, meteo, sveglie. Mai mescolata al CRM.", icon: "home", colors: ["#047857", "#10B981"], emoji: "🟢" },
  { key: "both", title: "Entrambe", desc: "Lavoro e vita privata insieme: Axon tiene le due sfere separate, tu le usi entrambe.", icon: "infinite", colors: ["#6D28D9", "#A855F7"], emoji: "✨" },
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
    </View>
  );
}

const styles = StyleSheet.create({
  lead: { fontSize: 14.5, fontWeight: "800", color: "#1B2B4B", marginTop: 4 },
  card: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: "#FFF", borderRadius: 18, padding: 14, minHeight: 84, borderWidth: 2, borderColor: "#EDE9FE" },
  cardOn: { borderColor: "#7C3AED", backgroundColor: "#FAF5FF" },
  iconWrap: { width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 17, fontWeight: "900", color: "#1B2B4B" },
  desc: { fontSize: 12.5, color: "#64748B", lineHeight: 17 },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: "#CBD5E1", alignItems: "center", justifyContent: "center" },
  radioOn: { borderColor: "#7C3AED", backgroundColor: "#7C3AED" },
  hint: { fontSize: 12.5, color: "#5B21B6", fontWeight: "700", backgroundColor: "#F5F3FF", borderRadius: 12, padding: 10 },
  err: { fontSize: 12.5, color: "#DC2626", fontWeight: "700" },
});

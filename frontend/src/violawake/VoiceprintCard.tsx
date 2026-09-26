// VoiceprintCard.tsx — V50.z372 — Impostazioni → Voce: stato dell'impronta vocale + accesso a «Voci autorizzate» / registrazione.
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { HT } from "@/src/homeTheme";
import { vpApi, type VpStatus } from "@/src/violawake/voiceprintApi";

export function VoiceprintCard({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [st, setSt] = useState<VpStatus | null>(null);
  useEffect(() => { vpApi.status().then(setSt).catch(() => {}); }, []);
  const mine = st?.my_profile || null;
  const on = !!st?.enforced;
  return (
    <View style={[styles.card, on && { borderColor: HT.success }]} testID="voiceprint-card">
      <View style={styles.row}>
        <View style={[styles.icon, on && { backgroundColor: HT.successTint }]}><Ionicons name="finger-print" size={18} color={on ? HT.success : HT.violet} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Impronta vocale</Text>
          <Text style={styles.sub} testID="voiceprint-card-status">
            {!st ? "…" : on ? `Attiva: Axon risponde solo a ${st.active_count === 1 ? "te" : `${st.active_count} voci registrate`}, le altre vengono ignorate in silenzio.` : mine ? "Registrata ma in pausa: Axon risponde a chiunque." : "Non registrata: Axon risponde a chiunque dica «Axon». Leggi un testo di 2-3 minuti per attivarla."}
          </Text>
        </View>
      </View>
      {!compact || !mine ? (
        <Pressable onPress={() => router.push((mine ? "/voice-profiles" : { pathname: "/voice-enroll", params: { role: "owner" } }) as any)} style={styles.btn} testID="voiceprint-card-action">
          <Ionicons name={mine ? "people" : "mic"} size={16} color="#FFF" /><Text style={styles.btnTxt}>{mine ? "Voci autorizzate e permessi" : "Registra la tua voce"}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: HT.card, borderRadius: 16, borderWidth: 1, borderColor: HT.border, padding: 14, gap: 12, marginTop: 14 },
  row: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  icon: { width: 36, height: 36, borderRadius: 10, backgroundColor: HT.violetTint, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 15, fontWeight: "900", color: HT.text }, sub: { fontSize: 12, color: HT.muted, lineHeight: 17, marginTop: 2 },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 46, borderRadius: 12, backgroundColor: HT.violet, paddingHorizontal: 14 },
  btnTxt: { color: "#FFF", fontWeight: "800", fontSize: 13 },
});

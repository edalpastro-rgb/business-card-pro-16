// WakeTrainingCard.tsx — V50.z398 — Card «Addestramento wake-word» nel pannello Master: link pubblico /wake-training da copiare o
// condividere (tutti i Master) + accesso al pannello /admin/wake-samples (solo Super Master, GET /wake-samples/access).
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { WAKE_TRAINING_URL, shareWakeTrainingLink } from "@/src/wake/wakeLink";
import { HT } from "@/src/homeTheme";

export function WakeTrainingCard() {
  const router = useRouter();
  const [superMaster, setSuperMaster] = useState(false);
  useEffect(() => { api<{ is_super_master: boolean }>("/wake-samples/access").then((r) => setSuperMaster(!!r?.is_super_master)).catch(() => setSuperMaster(false)); }, []);

  const copy = async () => { try { await Clipboard.setStringAsync(WAKE_TRAINING_URL); notify("Link copiato"); } catch { notify("Copia non riuscita"); } };

  return (
    <View style={s.card} testID="wake-training-card">
      <View style={s.head}>
        <View style={s.icon}><Ionicons name="mic" size={20} color="#FFF" /></View>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Addestramento wake-word «Axon»</Text>
          <Text style={s.sub}>Pagina pubblica, senza login: chi la apre registra la sua voce e aiuta Axon a riconoscere la parola.</Text>
        </View>
      </View>
      <Pressable onPress={copy} style={s.linkBox} testID="wake-training-link"><Ionicons name="link" size={16} color={HT.violet} /><Text style={s.link} numberOfLines={1}>{WAKE_TRAINING_URL.replace(/^https?:\/\//, "")}</Text><Ionicons name="copy-outline" size={16} color={HT.muted} /></Pressable>
      <View style={s.row}>
        <Pressable onPress={copy} style={s.ghost} testID="wake-training-copy"><Ionicons name="copy-outline" size={18} color={HT.violet} /><Text style={s.ghostTxt}>Copia link</Text></Pressable>
        {Platform.OS !== "web" ? <Pressable onPress={shareWakeTrainingLink} style={s.ghost} testID="wake-training-share"><Ionicons name="share-social-outline" size={18} color={HT.violet} /><Text style={s.ghostTxt}>Condividi</Text></Pressable> : null}
        {superMaster ? <Pressable onPress={() => router.push("/admin/wake-samples" as any)} style={s.primary} testID="wake-training-admin"><Ionicons name="stats-chart" size={18} color="#FFF" /><Text style={s.primaryTxt}>Pannello campioni</Text></Pressable> : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { marginHorizontal: 16, marginTop: 12, backgroundColor: HT.card, borderRadius: 16, borderWidth: 1, borderColor: HT.border, padding: 14, gap: 10 },
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  icon: { width: 40, height: 40, borderRadius: 12, backgroundColor: "#7C3AED", alignItems: "center", justifyContent: "center" },
  title: { fontSize: 15, fontWeight: "900", color: HT.text }, sub: { fontSize: 12, color: HT.muted, lineHeight: 16, marginTop: 2 },
  linkBox: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: HT.border, backgroundColor: HT.card2, paddingHorizontal: 12 },
  link: { flex: 1, color: HT.violet, fontWeight: "700", fontSize: 13 },
  row: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  ghost: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 44, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: HT.violet + "66", backgroundColor: HT.violetTint }, ghostTxt: { color: HT.violet, fontWeight: "800", fontSize: 13 },
  primary: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 44, paddingHorizontal: 12, borderRadius: 12, backgroundColor: HT.violet }, primaryTxt: { color: "#FFF", fontWeight: "800", fontSize: 13 },
});

// WakeTrainingSheet.tsx — V50.z401 — Foglio «Addestramento wake-word Axon» (Impostazioni › AI & Axon): link pubblico in evidenza,
// azioni chiare con icona + etichetta (Copia link · Condividi · Apri pagina) e accesso al pannello campioni (solo Super Master).
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Modal, Platform, Linking } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { useBottomSheetPadding } from "@/src/utils/bottomSheetInsets";
import { WAKE_TRAINING_URL, shareWakeTrainingLink } from "@/src/wake/wakeLink";
import { HT } from "@/src/homeTheme";

const VIOLET = "#7C3AED";

export function WakeTrainingSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const router = useRouter();
  const pad = useBottomSheetPadding();
  const [superMaster, setSuperMaster] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!visible) return;
    setCopied(false);
    api<{ is_super_master: boolean }>("/wake-samples/access").then((r) => setSuperMaster(!!r?.is_super_master)).catch(() => setSuperMaster(false));
  }, [visible]);

  const copy = async () => { try { await Clipboard.setStringAsync(WAKE_TRAINING_URL); setCopied(true); notify("Link copiato"); } catch { notify("Copia non riuscita"); } };
  const Action = ({ icon, label, onPress, testID, primary }: { icon: React.ComponentProps<typeof Ionicons>["name"]; label: string; onPress: () => void; testID: string; primary?: boolean }) => (
    <Pressable onPress={onPress} style={[s.action, primary && s.actionPrimary]} testID={testID}>
      <View style={[s.actionIcon, primary && { backgroundColor: "rgba(255,255,255,0.2)" }]}><Ionicons name={icon} size={20} color={primary ? "#FFF" : VIOLET} /></View>
      <Text style={[s.actionTxt, primary && { color: "#FFF" }]}>{label}</Text>
    </Pressable>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.back} onPress={onClose} testID="wake-sheet-backdrop" />
      <View style={[s.sheet, { paddingBottom: pad }]} testID="wake-training-sheet">
        <View style={s.handle} />
        <View style={s.head}>
          <View style={s.headIcon}><Ionicons name="mic" size={22} color="#FFF" /></View>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>Addestramento wake-word «Axon»</Text>
            <Text style={s.sub}>Pagina pubblica, senza login: chi la apre registra la propria voce in 5 minuti e aiuta Axon a riconoscere la parola.</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={10} style={s.close} testID="wake-sheet-close"><Ionicons name="close" size={22} color={HT.text} /></Pressable>
        </View>

        <Text style={s.label}>Link pubblico</Text>
        <Pressable onPress={copy} style={s.linkBox} testID="wake-training-link">
          <Ionicons name="link-outline" size={18} color={VIOLET} />
          <Text style={s.link} numberOfLines={1}>{WAKE_TRAINING_URL.replace(/^https?:\/\//, "")}</Text>
          <View style={[s.copiedPill, copied && { backgroundColor: "#16A34A" }]}><Ionicons name={copied ? "checkmark" : "copy-outline"} size={14} color="#FFF" /><Text style={s.copiedTxt}>{copied ? "Copiato" : "Copia"}</Text></View>
        </Pressable>

        <View style={s.actions}>
          <Action icon="copy-outline" label="Copia link" onPress={copy} testID="wake-training-copy" />
          {Platform.OS !== "web" ? <Action icon="share-social-outline" label="Condividi" onPress={shareWakeTrainingLink} testID="wake-training-share" /> : null}
          <Action icon="open-outline" label="Apri pagina" onPress={() => Linking.openURL(WAKE_TRAINING_URL)} testID="wake-training-open" />
        </View>

        {superMaster ? (
          <Pressable onPress={() => { onClose(); router.push("/admin/wake-samples" as any); }} style={s.panelBtn} testID="wake-training-admin">
            <Ionicons name="stats-chart" size={18} color="#FFF" />
            <Text style={s.panelTxt}>Pannello campioni raccolti</Text>
            <Ionicons name="chevron-forward" size={18} color="#FFF" />
          </Pressable>
        ) : null}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  back: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: { backgroundColor: HT.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 18, paddingTop: 8, gap: 14 },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: HT.border, marginBottom: 4 },
  head: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  headIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: VIOLET, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 16, fontWeight: "900", color: HT.text }, sub: { fontSize: 12.5, color: HT.muted, lineHeight: 17, marginTop: 3 },
  close: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 11, fontWeight: "800", color: HT.muted, textTransform: "uppercase", letterSpacing: 0.5 },
  linkBox: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 50, borderRadius: 14, borderWidth: 1, borderColor: HT.border, backgroundColor: HT.card2, paddingLeft: 14, paddingRight: 8 },
  link: { flex: 1, color: HT.text, fontWeight: "700", fontSize: 13.5 },
  copiedPill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: VIOLET, borderRadius: 999, paddingHorizontal: 10, height: 30 }, copiedTxt: { color: "#FFF", fontWeight: "800", fontSize: 12 },
  actions: { flexDirection: "row", gap: 10 },
  action: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6, minHeight: 78, borderRadius: 16, borderWidth: 1, borderColor: HT.border, backgroundColor: HT.card2, paddingVertical: 10 },
  actionPrimary: { backgroundColor: VIOLET, borderColor: VIOLET },
  actionIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(124,58,237,0.14)", alignItems: "center", justifyContent: "center" },
  actionTxt: { color: HT.text, fontWeight: "800", fontSize: 12.5 },
  panelBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 50, borderRadius: 14, backgroundColor: VIOLET },
  panelTxt: { flex: 1, color: "#FFF", fontWeight: "800", fontSize: 14, textAlign: "center" },
});

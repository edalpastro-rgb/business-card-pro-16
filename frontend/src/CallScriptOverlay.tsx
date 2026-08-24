/**
 * V27 — CallScriptOverlay: opens when the agent taps "Chiama" / "Contatta cliente"
 * on the contact card. Shows the phone number prominently + the Master-configured
 * script (with {name}/{agent} placeholders substituted). The agent reads the
 * script while manually dialing (or taps the big number to open the dialer).
 */
import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Modal, Pressable, ScrollView, Linking, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";

const C = { primary: "#FF6B35", primarySoft: "#FFF1E9", navy: "#1B2B4B", muted: "#94A3B8", success: "#16A34A" };

type Props = {
  visible: boolean;
  onClose: () => void;
  contactName?: string;
  contactPhone?: string;
};

export function CallScriptOverlay({ visible, onClose, contactName, contactPhone }: Props) {
  const { user } = useAuth();
  const [script, setScript] = useState("");
  const [fontSize, setFontSize] = useState(16);

  const load = useCallback(async () => {
    try {
      const s = await api<{ call_script?: string }>("/settings");
      setScript(s.call_script || "");
    } catch { setScript(""); }
  }, []);

  useEffect(() => { if (visible) load(); }, [visible, load]);

  const rendered = (script || "")
    .replace(/\{agent\}/g, user?.name?.split(" ")[0] || "")
    .replace(/\{name\}/g, (contactName || "").split(" ")[0] || "cliente");

  const dial = () => {
    const num = (contactPhone || "").replace(/[^\d+]/g, "");
    if (!num) return;
    const url = `tel:${num}`;
    if (Platform.OS === "web") { try { window.location.href = url; } catch { /* ignore */ } }
    else Linking.openURL(url).catch(() => {});
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card} testID="call-script-overlay">
          {/* Header */}
          <View style={styles.hdr}>
            <View style={styles.hdrIcon}><Ionicons name="megaphone" size={18} color="#FFF" /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Chiamata: {contactName || "Cliente"}</Text>
              <Text style={styles.sub}>Leggi lo script mentre chiami</Text>
            </View>
            <Pressable onPress={() => setFontSize((s) => Math.max(12, s - 2))} hitSlop={8} style={styles.zoomBtn}><Ionicons name="remove" size={18} color={C.navy} /></Pressable>
            <Pressable onPress={() => setFontSize((s) => Math.min(26, s + 2))} hitSlop={8} style={styles.zoomBtn}><Ionicons name="add" size={18} color={C.navy} /></Pressable>
            <Pressable onPress={onClose} hitSlop={8} testID="call-script-overlay-close"><Ionicons name="close" size={22} color={C.navy} /></Pressable>
          </View>

          {/* Phone (tap to dial) */}
          {contactPhone ? (
            <Pressable onPress={dial} style={styles.phoneCard} testID="call-script-dial">
              <View style={styles.phoneIcon}><Ionicons name="call" size={22} color="#FFF" /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.phoneLbl}>Tocca per chiamare</Text>
                <Text style={styles.phoneNum}>{contactPhone}</Text>
              </View>
              <Ionicons name="arrow-forward-circle" size={26} color={C.success} />
            </Pressable>
          ) : (
            <View style={[styles.phoneCard, { backgroundColor: "#FEE2E2" }]}>
              <Ionicons name="warning" size={20} color="#DC2626" />
              <Text style={{ color: "#DC2626", fontWeight: "700", fontSize: 13 }}>Nessun numero di telefono</Text>
            </View>
          )}

          {/* Script body */}
          <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={{ padding: 18 }}>
            {rendered ? (
              <Text style={[styles.scriptTxt, { fontSize, lineHeight: fontSize * 1.55 }]} testID="call-script-overlay-text">{rendered}</Text>
            ) : (
              <View style={styles.empty}>
                <Ionicons name="information-circle-outline" size={30} color={C.muted} />
                <Text style={styles.emptyTxt}>Nessuno script configurato</Text>
                <Text style={styles.emptySub}>Il Master può inserirlo dalle Impostazioni → &quot;Script Telefonata&quot;</Text>
              </View>
            )}
          </ScrollView>

          <View style={styles.footer}>
            <Text style={styles.footerTxt}>Segui lo script · Manteniamo lo standard del team</Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(15,23,42,0.55)", justifyContent: "flex-end" },
  card: { backgroundColor: "#FFF", borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: "94%", overflow: "hidden" },
  hdr: { flexDirection: "row", alignItems: "center", gap: 8, padding: 14, borderBottomWidth: 1, borderBottomColor: "#EEF0F4" },
  hdrIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.primary, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 16, fontWeight: "800", color: C.navy, letterSpacing: -0.2 },
  sub: { fontSize: 11, color: C.muted, marginTop: 2, fontWeight: "600" },
  zoomBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: C.primarySoft, alignItems: "center", justifyContent: "center" },
  phoneCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#DCFCE7", padding: 14, marginHorizontal: 14, marginTop: 14, borderRadius: 14 },
  phoneIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.success, alignItems: "center", justifyContent: "center" },
  phoneLbl: { fontSize: 11, fontWeight: "700", color: "#166534", textTransform: "uppercase", letterSpacing: 0.5 },
  phoneNum: { fontSize: 22, fontWeight: "900", color: C.navy, letterSpacing: -0.5, marginTop: 2 },
  scriptTxt: { color: C.navy, fontWeight: "500" },
  footer: { padding: 10, borderTopWidth: 1, borderTopColor: "#EEF0F4", backgroundColor: "#F8FAFC" },
  footerTxt: { fontSize: 11, color: C.muted, textAlign: "center", fontWeight: "600" },
  empty: { alignItems: "center", padding: 30, gap: 8 },
  emptyTxt: { color: C.navy, fontWeight: "800", fontSize: 14 },
  emptySub: { color: C.muted, fontSize: 12, textAlign: "center" },
});

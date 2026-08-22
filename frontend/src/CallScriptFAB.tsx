/**
 * V27 — CallScriptFAB: floating overlay that shows the Master-configured
 * phone-call script. Behaves like the CalculatorFAB — always visible above
 * the current screen so the agent can read the script while talking on the
 * phone without navigating away.
 *
 * The script text is loaded from GET /api/settings.call_script (with
 * {name}/{agent} placeholders left as-is so the agent can adapt on the fly).
 */
import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Modal, ScrollView, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useRegisterFab } from "@/src/FabStack";

const C = { primary: "#FF6B35", primarySoft: "#FFF1E9", navy: "#1B2B4B", muted: "#94A3B8" };

export function CallScriptFAB() {
  const [open, setOpen] = useState(false);
  const [script, setScript] = useState("");
  const [fontSize, setFontSize] = useState(16);
  const { user } = useAuth();

  // Register presence so other floating FABs can stack correctly
  useRegisterFab("call-script", true);

  const load = useCallback(async () => {
    try {
      const s = await api<{ call_script?: string }>("/settings");
      setScript(s.call_script || "");
    } catch { setScript(""); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Replace {agent} with current user name for convenience (script still editable in settings)
  const rendered = (script || "").replace(/\{agent\}/g, user?.name?.split(" ")[0] || "");

  return (
    <>
      <Pressable
        testID="call-script-fab"
        onPress={() => { load(); setOpen(true); }}
        style={styles.fab}
        accessibilityLabel="Apri script telefonata"
      >
        <Ionicons name="mic-outline" size={22} color="#FFF" />
        <Text style={styles.fabLbl}>Script</Text>
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.backdrop}>
          <View style={styles.card} testID="call-script-card">
            <View style={styles.hdr}>
              <View style={styles.hdrIcon}>
                <Ionicons name="megaphone" size={18} color="#FFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>Script telefonata</Text>
                <Text style={styles.sub}>Configurabile dal Master · Impostazioni</Text>
              </View>
              <Pressable onPress={() => setFontSize((s) => Math.max(12, s - 2))} hitSlop={8} style={styles.zoomBtn} testID="call-script-zoom-out">
                <Ionicons name="remove" size={18} color={C.navy} />
              </Pressable>
              <Pressable onPress={() => setFontSize((s) => Math.min(26, s + 2))} hitSlop={8} style={styles.zoomBtn} testID="call-script-zoom-in">
                <Ionicons name="add" size={18} color={C.navy} />
              </Pressable>
              <Pressable onPress={() => setOpen(false)} hitSlop={8} testID="call-script-close">
                <Ionicons name="close" size={22} color={C.navy} />
              </Pressable>
            </View>
            <ScrollView style={styles.body} contentContainerStyle={{ padding: 18 }}>
              {rendered ? (
                <Text style={[styles.scriptTxt, { fontSize, lineHeight: fontSize * 1.55 }]} testID="call-script-text">
                  {rendered}
                </Text>
              ) : (
                <View style={styles.empty}>
                  <Ionicons name="information-circle-outline" size={30} color={C.muted} />
                  <Text style={styles.emptyTxt}>Nessuno script configurato</Text>
                  <Text style={styles.emptySub}>
                    Il Master può inserirlo dalle Impostazioni → &quot;Script telefonata&quot;
                  </Text>
                </View>
              )}
            </ScrollView>
            <View style={styles.footer}>
              <Text style={styles.footerTxt}>Placeholder disponibili: {`{name}`} · {`{agent}`}</Text>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  // FAB — sits slightly ABOVE the tab bar with a distinctive shape
  fab: {
    position: "absolute",
    right: 18,
    bottom: 178, // above the tab bar (85 tab + padding)
    backgroundColor: C.navy,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    ...Platform.select({
      ios: { shadowColor: "#0F172A", shadowOpacity: 0.28, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
      android: { elevation: 8 },
      default: {},
    }),
    zIndex: 999,
  },
  fabLbl: { color: "#FFF", fontWeight: "800", fontSize: 12, letterSpacing: 0.3 },

  backdrop: { flex: 1, backgroundColor: "rgba(15,23,42,0.55)", justifyContent: "center", alignItems: "center", padding: 12 },
  card: { width: "100%", maxWidth: 460, maxHeight: "80%", backgroundColor: "#FFF", borderRadius: 22, overflow: "hidden" },
  hdr: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderBottomWidth: 1, borderBottomColor: "#EEF0F4" },
  hdrIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.primary, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 16, fontWeight: "800", color: C.navy, letterSpacing: -0.2 },
  sub: { fontSize: 11, color: C.muted, marginTop: 2, fontWeight: "600" },
  zoomBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: C.primarySoft, alignItems: "center", justifyContent: "center" },
  body: { flexGrow: 0 },
  scriptTxt: { color: C.navy, fontWeight: "500" },
  footer: { padding: 10, borderTopWidth: 1, borderTopColor: "#EEF0F4", backgroundColor: "#F8FAFC" },
  footerTxt: { fontSize: 11, color: C.muted, textAlign: "center", fontWeight: "600" },
  empty: { alignItems: "center", padding: 30, gap: 8 },
  emptyTxt: { color: C.navy, fontWeight: "800", fontSize: 14 },
  emptySub: { color: C.muted, fontSize: 12, textAlign: "center" },
});

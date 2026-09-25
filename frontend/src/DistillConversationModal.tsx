/**
 * V50.z143 — "Distilla conversazione in regole" (Master).
 * L'utente incolla il testo di una chat storica oppure sceglie una sessione salvata;
 * il backend passa il testo a Claude (`POST /api/axon/teach/distill-conversation`) che
 * estrae le regole comportamentali come JSON e le salva come regole PINNED di AxonOS.
 * Regola modal (CHANGELOG §12): footer FISSO con azione primaria + chiudi sempre visibili.
 */
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Modal, Pressable, TextInput, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useInsetsSafe } from "@/src/hooks/useSafeBottom";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

type SessionRow = { session_id: string; count: number; last_at?: string; preview: string };
type CreatedRule = { rule_id: string; title: string; text: string; category: string };
type DistillResult = { created: CreatedRule[]; count: number; extracted: number; skipped_duplicates: number };

type Props = { visible: boolean; onClose: () => void; onDone?: (created: CreatedRule[]) => void };

const PURPLE = "#7C3AED";

export function DistillConversationModal({ visible, onClose, onDone }: Props) {
  const insets = useInsetsSafe(); // V50.z165 — fallback bottom dentro Modal
  const { height: winH } = useWindowDimensions();
  const [mode, setMode] = useState<"paste" | "history">("paste");
  const [text, setText] = useState("");
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [selectedSid, setSelectedSid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DistillResult | null>(null);

  useEffect(() => {
    if (!visible) {
      setText(""); setSelectedSid(null); setResult(null); setBusy(false); setMode("paste");
    }
  }, [visible]);

  useEffect(() => {
    if (!visible || mode !== "history" || sessions.length) return;
    let alive = true;
    setSessionsLoading(true);
    api<{ sessions: SessionRow[] }>("/assistant/sessions?limit=30")
      .then((r) => { if (alive) setSessions(r?.sessions || []); })
      .catch((e: any) => notify("Errore", e?.message || "Impossibile caricare le chat"))
      .finally(() => { if (alive) setSessionsLoading(false); });
    return () => { alive = false; };
  }, [visible, mode, sessions.length]);

  const canRun = !busy && (mode === "paste" ? text.trim().length >= 20 : !!selectedSid);

  const run = async () => {
    if (!canRun) return;
    setBusy(true);
    setResult(null);
    try {
      const body = mode === "paste" ? { text: text.trim(), max_rules: 8 } : { session_id: selectedSid, max_rules: 8 };
      const r = await api<DistillResult>("/axon/teach/distill-conversation", { method: "POST", body });
      setResult(r);
      if (r.count > 0) onDone?.(r.created);
    } catch (e: any) {
      notify("Errore distillazione", e?.message || "");
    } finally {
      setBusy(false);
    }
  };

  const fmtDate = (iso?: string) => {
    if (!iso) return "";
    try { return new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" }); } catch { return ""; }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={() => !busy && onClose()}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.back}>
        <View style={[styles.card, { maxHeight: winH * 0.9, paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={styles.hdr}>
            <View style={[styles.hdrIcon]}><Ionicons name="flask" size={18} color="#FFF" /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Distilla conversazione in regole</Text>
              <Text style={styles.sub}>Claude estrae le regole apprese e le salva come regole PINNED</Text>
            </View>
            <Pressable onPress={() => !busy && onClose()} hitSlop={10} testID="distill-close">
              <Ionicons name="close" size={22} color={HT.text} />
            </Pressable>
          </View>

          {/* Selettore modalità */}
          <View style={styles.modeRow}>
            <Pressable testID="distill-mode-paste" onPress={() => setMode("paste")} style={[styles.modeBtn, mode === "paste" && styles.modeBtnOn]}>
              <Ionicons name="clipboard-outline" size={15} color={mode === "paste" ? "#FFF" : PURPLE} />
              <Text style={[styles.modeTxt, mode === "paste" && { color: "#FFF" }]}>Incolla testo</Text>
            </Pressable>
            <Pressable testID="distill-mode-history" onPress={() => setMode("history")} style={[styles.modeBtn, mode === "history" && styles.modeBtnOn]}>
              <Ionicons name="time-outline" size={15} color={mode === "history" ? "#FFF" : PURPLE} />
              <Text style={[styles.modeTxt, mode === "history" && { color: "#FFF" }]}>Chat storica</Text>
            </Pressable>
          </View>

          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ padding: 14, gap: 10 }} keyboardShouldPersistTaps="handled">
            {mode === "paste" ? (
              <>
                <TextInput
                  testID="distill-text-input"
                  value={text}
                  onChangeText={setText}
                  multiline
                  placeholder={"Incolla qui la conversazione (es. da WhatsApp, email o una vecchia chat con Axon)…\n\nMaster: quando ti chiedo X fai sempre Y\nAxon: Capito, da ora in avanti…"}
                  placeholderTextColor={HT.muted}
                  style={styles.input}
                  textAlignVertical="top"
                  editable={!busy}
                />
                <Text style={styles.hint}>{text.trim().length} caratteri · minimo 20 · conversazioni lunghe vengono analizzate a blocchi (max ~33.000)</Text>
              </>
            ) : sessionsLoading ? (
              <ActivityIndicator color={HT.violet} style={{ marginVertical: 20 }} />
            ) : sessions.length === 0 ? (
              <Text style={styles.hint}>Nessuna chat salvata.</Text>
            ) : (
              sessions.map((s) => {
                const on = selectedSid === s.session_id;
                return (
                  <Pressable key={s.session_id} testID={`distill-session-${s.session_id}`} onPress={() => setSelectedSid(s.session_id)} style={[styles.sessRow, on && styles.sessRowOn]}>
                    <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={18} color={on ? PURPLE : HT.muted} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.sessPreview} numberOfLines={2}>{s.preview}</Text>
                      <Text style={styles.sessMeta}>{s.count} messaggi · {fmtDate(s.last_at)}</Text>
                    </View>
                  </Pressable>
                );
              })
            )}

            {result && (
              <View style={styles.resultBox} testID="distill-result">
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Ionicons name={result.count > 0 ? "checkmark-circle" : "information-circle"} size={18} color={result.count > 0 ? "#0F9D58" : "#F59E0B"} />
                  <Text style={styles.resultTitle}>
                    {result.count > 0 ? `${result.count} regole PINNED salvate` : "Nessuna nuova regola"}
                    {result.skipped_duplicates > 0 ? ` · ${result.skipped_duplicates} già presenti` : ""}
                  </Text>
                </View>
                {result.count === 0 && (
                  <Text style={styles.hint}>Claude non ha trovato lezioni esplicite (istruzioni, preferenze, correzioni) oppure erano già tra le regole.</Text>
                )}
                {result.created.map((r) => (
                  <View key={r.rule_id} style={styles.ruleRow}>
                    <View style={styles.catBadge}><Text style={styles.catTxt}>{r.category}</Text></View>
                    <Text style={styles.ruleTitle}>{r.title}</Text>
                    <Text style={styles.ruleText}>{r.text}</Text>
                  </View>
                ))}
              </View>
            )}
          </ScrollView>

          {/* Footer FISSO */}
          <View style={styles.footer}>
            <Pressable onPress={() => !busy && onClose()} style={[styles.btn, { backgroundColor: HT.card2 }]} testID="distill-cancel">
              <Text style={{ color: HT.text, fontWeight: "700" }}>{result ? "Chiudi" : "Annulla"}</Text>
            </Pressable>
            <Pressable onPress={run} disabled={!canRun} style={[styles.btn, { backgroundColor: canRun ? PURPLE : "#C4B5FD", flex: 2 }]} testID="distill-run">
              {busy ? (
                <>
                  <ActivityIndicator color="#FFF" size="small" />
                  <Text style={styles.btnTxt}>Claude sta leggendo…</Text>
                </>
              ) : (
                <>
                  <Ionicons name="sparkles" size={16} color="#FFF" />
                  <Text style={styles.btnTxt}>{result ? "Distilla di nuovo" : "Distilla con Claude"}</Text>
                </>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  back: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  card: { backgroundColor: HT.card, borderTopLeftRadius: 22, borderTopRightRadius: 22, overflow: "hidden" },
  hdr: { flexDirection: "row", alignItems: "center", gap: 10, padding: 16, borderBottomWidth: 1, borderBottomColor: HT.border },
  hdrIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: PURPLE, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 16, fontWeight: "800", color: HT.text },
  sub: { fontSize: 11, color: HT.muted, marginTop: 2 },
  modeRow: { flexDirection: "row", gap: 8, paddingHorizontal: 14, paddingTop: 12 },
  modeBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5, borderColor: HT.violet, minHeight: 44 },
  modeBtnOn: { backgroundColor: PURPLE },
  modeTxt: { fontSize: 13, fontWeight: "800", color: HT.violet },
  input: { backgroundColor: HT.card2, borderRadius: 12, borderWidth: 1, borderColor: HT.border, padding: 12, minHeight: 160, maxHeight: 260, fontSize: 13, color: HT.text, lineHeight: 19 },
  hint: { fontSize: 11, color: HT.muted, fontStyle: "italic" },
  sessRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: HT.border, backgroundColor: HT.card2, minHeight: 56 },
  sessRowOn: { borderColor: HT.violet, backgroundColor: HT.violetTint },
  sessPreview: { fontSize: 13, fontWeight: "700", color: HT.text },
  sessMeta: { fontSize: 11, color: HT.muted, marginTop: 2 },
  resultBox: { backgroundColor: HT.violetTint, borderRadius: 12, padding: 12, gap: 8, borderWidth: 1, borderColor: HT.violet + '66' },
  resultTitle: { fontSize: 13, fontWeight: "800", color: HT.text },
  ruleRow: { backgroundColor: HT.card, borderRadius: 10, padding: 10, gap: 4, borderWidth: 1, borderColor: HT.border },
  catBadge: { alignSelf: "flex-start", backgroundColor: PURPLE, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  catTxt: { color: "#FFF", fontSize: 10, fontWeight: "800" },
  ruleTitle: { fontSize: 13, fontWeight: "800", color: HT.text },
  ruleText: { fontSize: 12, color: HT.text2, lineHeight: 17 },
  footer: { flexDirection: "row", gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: HT.border },
  btn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 46, borderRadius: 12 },
  btnTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
});

export default DistillConversationModal;

/**
 * V49.j — Floating support button + in-app assistance sheet.
 *
 * Il FAB è visibile su tutte le pagine (mounted in _layout.tsx). Al tap apre
 * un bottom sheet con:
 *   • Lista di problemi comuni preconfigurati (checkbox multipla)
 *   • Testo libero "Altro"
 *   • Bottone per allegare file/screenshot
 *   • Risposte AI di Axon (Claude Sonnet 5)
 *   • 👍/👎 su ogni risposta per registrare feedback
 *   • Se ≥ 2 tentativi non risolvono → il ticket passa in stato "escalated"
 *     e viene mostrato al Master nella pagina "Bug, Errori e Idee".
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Modal, View, Text, StyleSheet, Pressable, ScrollView, TextInput,
  ActivityIndicator, Platform, Alert,
} from "react-native";
import { usePathname } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { pickCommonFile } from "@/src/utils/filePicker";
import { useBottomSheetPadding } from "@/src/utils/bottomSheetInsets";
import { useAuth } from "@/src/auth";

type Preset = { id: string; label: string };
type SupportAttachment = { name: string; mime: string; data_base64?: string; size?: number };
type SupportMsg = {
  from: "user" | "ai";
  text: string;
  checks?: string[];
  attachments?: SupportAttachment[];
  feedback?: "up" | "down";
  created_at?: string;
};
type Ticket = {
  ticket_id: string;
  status: "open" | "escalated" | "resolved";
  attempts: number;
  messages: SupportMsg[];
  escalated_at?: string;
};

const HIDE_ON_PATHS = ["/login", "/index", "/", "/landing", "/auth"];

const C = {
  primary: "#FF6B35",
  navy: "#0F2438",
  muted: "#94A3B8",
  border: "#E2E8F0",
  green: "#16A34A",
  red: "#DC2626",
  purple: "#7C3AED",
};

export function SupportFab() {
  const pathname = usePathname() || "/";
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  const hide = HIDE_ON_PATHS.some((p) => pathname === p) || pathname.startsWith("/auth");
  if (!user || hide) return null;

  return (
    <>
      <Pressable
        testID="support-fab"
        onPress={() => setOpen(true)}
        style={styles.fab}
        accessibilityLabel="Assistenza"
      >
        <Ionicons name="help-circle" size={26} color="#FFF" />
      </Pressable>
      <SupportSheet visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

function SupportSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const bottomPad = useBottomSheetPadding();
  const [presets, setPresets] = useState<Preset[]>([]);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<SupportAttachment[]>([]);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [sending, setSending] = useState(false);
  const [feedbacking, setFeedbacking] = useState<number | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const loadPresets = useCallback(async () => {
    try {
      const r = await api<{ items: Preset[] }>("/support/presets");
      setPresets(r.items || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!visible) return;
    setChecks({});
    setText("");
    setAttachments([]);
    setTicket(null);
    setSending(false);
    loadPresets();
  }, [visible, loadPresets]);

  const toggleCheck = (id: string) => setChecks((p) => ({ ...p, [id]: !p[id] }));

  const addAttachment = async () => {
    try {
      const { asset, error, base64 } = await pickCommonFile({ multiple: false });
      if (error || !asset) {
        if (error) Alert.alert("Errore selezione", error);
        return;
      }
      const name = asset.name || "allegato";
      const mime = asset.mimeType || "application/octet-stream";
      let b64 = base64 || "";
      if (!b64 && asset.uri) {
        if (asset.uri.startsWith("data:")) {
          const c = asset.uri.indexOf(",");
          if (c > 0) b64 = asset.uri.slice(c + 1);
        }
      }
      if (!b64) {
        Alert.alert("Impossibile leggere il file");
        return;
      }
      setAttachments((prev) => [...prev, { name, mime, data_base64: b64 }].slice(0, 3));
    } catch (e: any) {
      Alert.alert("Errore", e?.message || String(e));
    }
  };

  const checkedIds = useMemo(() => Object.keys(checks).filter((k) => checks[k]), [checks]);
  const hasContent = checkedIds.length > 0 || (text || "").trim().length > 0 || attachments.length > 0;

  const submit = async () => {
    if (!hasContent || sending) return;
    setSending(true);
    try {
      const body = {
        checks: checkedIds,
        text: text.trim(),
        attachments: attachments.map((a) => ({ name: a.name, mime: a.mime, data_base64: a.data_base64 })),
      };
      const t = ticket
        ? await api<Ticket>(`/support/tickets/${ticket.ticket_id}/reply`, { method: "POST", body })
        : await api<Ticket>(`/support/tickets`, { method: "POST", body });
      setTicket(t);
      setText("");
      setChecks({});
      setAttachments([]);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 200);
    } catch (e: any) {
      Alert.alert("Errore", e?.message || "Invio segnalazione fallito");
    } finally {
      setSending(false);
    }
  };

  const vote = async (idx: number, v: "up" | "down") => {
    if (!ticket || feedbacking !== null) return;
    setFeedbacking(idx);
    try {
      const t = await api<Ticket>(`/support/tickets/${ticket.ticket_id}/feedback`, {
        method: "POST",
        body: { reply_index: idx, vote: v },
      });
      setTicket(t);
    } catch (e: any) {
      Alert.alert("Errore", e?.message || "Feedback non registrato");
    } finally {
      setFeedbacking(null);
    }
  };

  const escalated = ticket?.status === "escalated";
  const resolved = ticket?.status === "resolved";

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: bottomPad + 8 }]}>
          <View style={styles.handle} />
          <View style={styles.hdrRow}>
            <View style={styles.hdrIcon}><Ionicons name="help-circle" size={20} color="#FFF" /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.hdrLabel}>Assistenza</Text>
              <Text style={styles.hdrSub}>
                {resolved ? "Risolto ✓"
                  : escalated ? "Inoltrato al Master"
                  : ticket ? `Tentativo ${ticket.attempts}/2`
                  : "Descrivi il problema"}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} testID="support-close">
              <Ionicons name="close" size={22} color={C.navy} />
            </Pressable>
          </View>

          <ScrollView
            ref={scrollRef}
            style={{ maxHeight: 500 }}
            contentContainerStyle={{ padding: 14, gap: 10 }}
            keyboardShouldPersistTaps="handled"
          >
            {/* Conversazione */}
            {ticket?.messages.map((m, i) => (
              <View key={i} style={[styles.msg, m.from === "user" ? styles.msgUser : styles.msgAi]}>
                {(m.checks && m.checks.length > 0) ? (
                  <Text style={styles.msgChecks}>
                    {m.checks.map((c) => presets.find((p) => p.id === c)?.label || c).join(" · ")}
                  </Text>
                ) : null}
                {m.text ? <Text style={styles.msgText}>{m.text}</Text> : null}
                {(m.attachments || []).length > 0 ? (
                  <Text style={styles.msgMeta}>📎 {m.attachments!.length} allegato/i</Text>
                ) : null}
                {m.from === "ai" && ticket ? (
                  <View style={styles.voteRow}>
                    <Pressable
                      onPress={() => vote(i, "up")}
                      disabled={feedbacking !== null || m.feedback === "up"}
                      style={[styles.voteBtn, m.feedback === "up" && { backgroundColor: "#DCFCE7" }]}
                      testID={`support-vote-up-${i}`}
                    >
                      <Ionicons name="thumbs-up" size={14} color={m.feedback === "up" ? C.green : C.muted} />
                      <Text style={[styles.voteTxt, m.feedback === "up" && { color: C.green }]}>Risolto</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => vote(i, "down")}
                      disabled={feedbacking !== null || m.feedback === "down"}
                      style={[styles.voteBtn, m.feedback === "down" && { backgroundColor: "#FEE2E2" }]}
                      testID={`support-vote-down-${i}`}
                    >
                      <Ionicons name="thumbs-down" size={14} color={m.feedback === "down" ? C.red : C.muted} />
                      <Text style={[styles.voteTxt, m.feedback === "down" && { color: C.red }]}>Non risolto</Text>
                    </Pressable>
                    {feedbacking === i ? <ActivityIndicator size="small" color={C.muted} /> : null}
                  </View>
                ) : null}
              </View>
            ))}

            {escalated ? (
              <View style={styles.escalatedBox}>
                <Ionicons name="flag" size={16} color={C.purple} />
                <Text style={styles.escalatedTxt}>
                  Ho passato la tua segnalazione al Master. Ti risponderà a breve.
                </Text>
              </View>
            ) : null}

            {resolved ? (
              <View style={[styles.escalatedBox, { backgroundColor: "#DCFCE7" }]}>
                <Ionicons name="checkmark-circle" size={16} color={C.green} />
                <Text style={[styles.escalatedTxt, { color: C.green }]}>
                  Segnalazione risolta. Grazie per il feedback!
                </Text>
              </View>
            ) : null}

            {/* Form nuovo messaggio (nascosto se resolved) */}
            {!resolved ? (
              <>
                <Text style={styles.section}>Problemi ricorrenti</Text>
                {presets.map((p) => (
                  <Pressable
                    key={p.id}
                    onPress={() => toggleCheck(p.id)}
                    style={styles.checkRow}
                    testID={`support-check-${p.id}`}
                  >
                    <Ionicons
                      name={checks[p.id] ? "checkbox" : "square-outline"}
                      size={20}
                      color={checks[p.id] ? C.primary : C.muted}
                    />
                    <Text style={styles.checkLbl}>{p.label}</Text>
                  </Pressable>
                ))}

                <Text style={[styles.section, { marginTop: 10 }]}>Altro (testo libero)</Text>
                <TextInput
                  value={text}
                  onChangeText={setText}
                  placeholder="Descrivi con più dettagli il problema o l'idea…"
                  placeholderTextColor={C.muted}
                  multiline
                  numberOfLines={4}
                  style={styles.textArea}
                  testID="support-text"
                />

                <View style={styles.attachRow}>
                  <Pressable onPress={addAttachment} style={styles.attachBtn} testID="support-attach">
                    <Ionicons name="attach" size={16} color={C.primary} />
                    <Text style={styles.attachTxt}>Allega file / screenshot</Text>
                  </Pressable>
                  {attachments.map((a, i) => (
                    <View key={i} style={styles.attachChip}>
                      <Ionicons name="document" size={12} color={C.navy} />
                      <Text style={styles.attachChipTxt} numberOfLines={1}>{a.name}</Text>
                      <Pressable onPress={() => setAttachments((prev) => prev.filter((_, k) => k !== i))} hitSlop={6}>
                        <Ionicons name="close-circle" size={14} color={C.muted} />
                      </Pressable>
                    </View>
                  ))}
                </View>

                <Pressable
                  onPress={submit}
                  disabled={!hasContent || sending}
                  style={[styles.submitBtn, (!hasContent || sending) && { opacity: 0.5 }]}
                  testID="support-submit"
                >
                  {sending ? <ActivityIndicator color="#FFF" /> : (
                    <>
                      <Ionicons name="send" size={16} color="#FFF" />
                      <Text style={styles.submitTxt}>
                        {ticket ? "Prova ancora" : "Chiedi ad Axon"}
                      </Text>
                    </>
                  )}
                </Pressable>
              </>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    right: 14,
    // Sopra la PersistentBottomNav (60 + inset). Su web/ios centrato.
    bottom: Platform.OS === "web" ? 92 : 88,
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: "#7C3AED",
    alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8,
    elevation: 6,
    zIndex: 99,
  },
  backdrop: { flex: 1, backgroundColor: "rgba(15,23,42,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#FFF", borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 8 },
  handle: { alignSelf: "center", width: 42, height: 4, borderRadius: 2, backgroundColor: "#CBD5E1", marginBottom: 6 },
  hdrRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 16, paddingTop: 6, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: "#EEF0F4",
  },
  hdrIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: C.purple, alignItems: "center", justifyContent: "center" },
  hdrLabel: { fontSize: 15, fontWeight: "800", color: C.navy, letterSpacing: -0.2 },
  hdrSub: { fontSize: 11, color: C.muted, marginTop: 2 },
  section: { fontSize: 12, fontWeight: "800", color: C.navy, letterSpacing: -0.1 },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
  checkLbl: { fontSize: 13, color: C.navy, flex: 1 },
  textArea: {
    borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 12,
    fontSize: 14, color: C.navy, backgroundColor: "#FFF", minHeight: 80, textAlignVertical: "top",
  },
  attachRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  attachBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, backgroundColor: "#FFF1E9" },
  attachTxt: { color: C.primary, fontSize: 12, fontWeight: "800" },
  attachChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: "#F1F5F9", maxWidth: 160 },
  attachChipTxt: { fontSize: 11, color: C.navy, fontWeight: "600" },
  submitBtn: {
    marginTop: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 14, borderRadius: 12, backgroundColor: C.primary,
  },
  submitTxt: { color: "#FFF", fontWeight: "900", fontSize: 14 },
  msg: { padding: 10, borderRadius: 12, gap: 4 },
  msgUser: { backgroundColor: "#F1F5F9", alignSelf: "flex-end", maxWidth: "88%" },
  msgAi: { backgroundColor: "#EDE9FE", alignSelf: "flex-start", maxWidth: "94%" },
  msgChecks: { fontSize: 11, color: C.muted, fontWeight: "800", textTransform: "uppercase" },
  msgText: { fontSize: 14, color: C.navy, lineHeight: 20 },
  msgMeta: { fontSize: 11, color: C.muted },
  voteRow: { flexDirection: "row", gap: 8, marginTop: 6, alignItems: "center" },
  voteBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: "#FFF" },
  voteTxt: { fontSize: 11, fontWeight: "800", color: C.muted },
  escalatedBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#EDE9FE", padding: 10, borderRadius: 12 },
  escalatedTxt: { flex: 1, color: C.purple, fontWeight: "800", fontSize: 13 },
});

// V26.q — Contact appointments tab (upcoming + past with outcome + inline note editing)
import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Platform } from "react-native";
import { ShareAppointmentSheet } from "@/src/ShareAppointmentSheet";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

type Appointment = {
  appointment_id: string;
  title: string;
  area: "energy" | "network";
  start_at: string;
  duration_min?: number;
  is_phone?: boolean;
  location?: string;
  done?: boolean;
  outcome_ids?: string[];
  outcome_notes?: string;
  appointment_type_tags?: string[];
};

type Outcome = { id: string; name: string; color: string; icon?: string };

type Props = { contactId: string };

export function ContactAppointmentsSection({ contactId }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [appts, setAppts] = useState<Appointment[]>([]);
  // V50.z80 — Sheet condivisione appuntamento con cliente
  const [shareApptId, setShareApptId] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, s] = await Promise.all([
        api<{ items: Appointment[] }>("/appointments", { query: { contact_id: contactId } }),
        api<{ appointment_outcomes?: Outcome[] }>("/settings"),
      ]);
      setAppts(r.items || []);
      setOutcomes(s.appointment_outcomes || []);
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => { load(); }, [load]);

  const now = Date.now();
  const upcoming = appts.filter((a) => new Date(a.start_at).getTime() >= now && !a.done);
  const past = appts.filter((a) => a.done || new Date(a.start_at).getTime() < now);

  const saveNote = async (apId: string) => {
    setSavingId(apId);
    try {
      await api(`/appointments/${apId}`, { method: "PUT", body: { outcome_notes: editingNote } });
      await load();
      setEditingNoteId(null);
    } catch (e: any) {
      if (Platform.OS === "web") window.alert("Errore: " + (e?.message || ""));
    } finally {
      setSavingId(null);
    }
  };

  const outcomeName = (id: string) => outcomes.find((o) => o.id === id)?.name || id;
  const outcomeColor = (id: string) => outcomes.find((o) => o.id === id)?.color || HT.muted;

  const fmtDateTime = (iso: string) => {
    const d = new Date(iso);
    return {
      date: d.toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" }),
      time: d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };
  };

  if (loading) return <ActivityIndicator style={{ marginTop: 30 }} color={HT.brand} />;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>In programma ({upcoming.length})</Text>
        <Pressable
          testID="appt-add-btn"
          onPress={() => router.push(`/appointment/new?contactId=${contactId}`)}
          style={styles.addBtn}
        >
          <Ionicons name="add" size={14} color="#FFF" />
          <Text style={styles.addBtnTxt}>Nuovo</Text>
        </Pressable>
      </View>
      {upcoming.length === 0 ? (
        <View style={styles.empty}><Text style={styles.emptyTxt}>Nessun appuntamento in programma</Text></View>
      ) : (
        upcoming.map((a) => {
          const { date, time } = fmtDateTime(a.start_at);
          return (
            <Pressable
              key={a.appointment_id}
              testID={`appt-upcoming-${a.appointment_id}`}
              onPress={() => router.push(`/appointment/${a.appointment_id}`)}
              style={[styles.card, { borderLeftColor: a.area === "energy" ? theme.color.energy : theme.color.network }]}
            >
              <View style={styles.cardRow}>
                <Ionicons name={a.is_phone ? "call" : "location"} size={14} color={a.area === "energy" ? theme.color.energy : theme.color.network} />
                <Text style={styles.cardTitle} numberOfLines={1}>{a.title}</Text>
              </View>
              <View style={styles.metaRow}>
                <Ionicons name="calendar-outline" size={11} color={HT.muted} />
                <Text style={styles.metaTxt}>{date} · {time}</Text>
                {a.appointment_type_tags && a.appointment_type_tags.length > 0 ? (
                  <>
                    <View style={styles.dotSep} />
                    <Text style={styles.metaTxt}>{a.appointment_type_tags[0]}</Text>
                  </>
                ) : null}
                {/* V50.z80 — Bottone condividi con cliente */}
                <Pressable
                  onPress={(e) => { (e as any).stopPropagation?.(); setShareApptId(a.appointment_id); }}
                  hitSlop={8}
                  style={styles.shareInlineBtn}
                  testID={`share-appt-${a.appointment_id}`}
                >
                  <Ionicons name="share-social-outline" size={14} color={HT.brand} />
                </Pressable>
              </View>
            </Pressable>
          );
        })
      )}

      <Text style={[styles.headerTitle, { marginTop: 20 }]}>Effettuati ({past.length})</Text>
      {past.length === 0 ? (
        <View style={styles.empty}><Text style={styles.emptyTxt}>Nessun appuntamento effettuato</Text></View>
      ) : (
        past.map((a) => {
          const { date, time } = fmtDateTime(a.start_at);
          const editing = editingNoteId === a.appointment_id;
          return (
            <View
              key={a.appointment_id}
              testID={`appt-past-${a.appointment_id}`}
              style={[styles.card, { borderLeftColor: a.done ? HT.success : HT.muted, opacity: a.done ? 1 : 0.7 }]}
            >
              <Pressable onPress={() => router.push(`/appointment/${a.appointment_id}`)}>
                <View style={styles.cardRow}>
                  <Ionicons name={a.done ? "checkmark-circle" : "close-circle"} size={14} color={a.done ? HT.success : HT.muted} />
                  <Text style={[styles.cardTitle, { textDecorationLine: a.done ? "none" : "line-through" }]} numberOfLines={1}>{a.title}</Text>
                </View>
                <View style={styles.metaRow}>
                  <Ionicons name="calendar-outline" size={11} color={HT.muted} />
                  <Text style={styles.metaTxt}>{date} · {time}</Text>
                </View>
                {a.outcome_ids && a.outcome_ids.length > 0 ? (
                  <View style={styles.outcomesRow}>
                    {a.outcome_ids.map((oid) => (
                      <View key={oid} style={[styles.outcomeChip, { backgroundColor: outcomeColor(oid) + "22", borderColor: outcomeColor(oid) }]}>
                        <Text style={[styles.outcomeChipTxt, { color: outcomeColor(oid) }]}>{outcomeName(oid)}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </Pressable>

              {editing ? (
                <View style={{ marginTop: 8 }}>
                  <TextInput
                    testID={`appt-note-input-${a.appointment_id}`}
                    value={editingNote}
                    onChangeText={setEditingNote}
                    style={styles.noteInput}
                    multiline
                    autoFocus
                    placeholder="Aggiungi una nota all'esito"
                    placeholderTextColor={HT.muted}
                  />
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
                    <Pressable onPress={() => setEditingNoteId(null)} style={[styles.miniBtn, { backgroundColor: HT.border }]}>
                      <Text style={[styles.miniBtnTxt, { color: HT.text }]}>Annulla</Text>
                    </Pressable>
                    <Pressable
                      testID={`appt-note-save-${a.appointment_id}`}
                      onPress={() => saveNote(a.appointment_id)}
                      disabled={savingId === a.appointment_id}
                      style={styles.miniBtn}
                    >
                      {savingId === a.appointment_id ? (
                        <ActivityIndicator size="small" color="#FFF" />
                      ) : (
                        <Text style={styles.miniBtnTxt}>Salva nota</Text>
                      )}
                    </Pressable>
                  </View>
                </View>
              ) : a.outcome_notes ? (
                <Pressable
                  onPress={() => { setEditingNoteId(a.appointment_id); setEditingNote(a.outcome_notes || ""); }}
                  style={styles.noteView}
                >
                  <Text style={styles.noteViewTxt}>{a.outcome_notes}</Text>
                  <View style={styles.editHint}>
                    <Ionicons name="pencil" size={11} color={HT.brand} />
                    <Text style={styles.editHintTxt}>Modifica</Text>
                  </View>
                </Pressable>
              ) : (
                <Pressable
                  testID={`appt-note-add-${a.appointment_id}`}
                  onPress={() => { setEditingNoteId(a.appointment_id); setEditingNote(""); }}
                  style={styles.addNoteBtn}
                >
                  <Ionicons name="add-circle-outline" size={13} color={HT.brand} />
                  <Text style={styles.addNoteBtnTxt}>Aggiungi nota all&apos;esito</Text>
                </Pressable>
              )}
            </View>
          );
        })
      )}
      {/* V50.z80 — Modal condivisione */}
      {shareApptId ? (
        <ShareAppointmentSheet
          appointmentId={shareApptId}
          visible={!!shareApptId}
          onClose={() => setShareApptId(null)}
        />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  headerTitle: { fontSize: 14, fontWeight: "800", color: HT.text, textTransform: "uppercase", letterSpacing: 0.4 },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: HT.brand, paddingHorizontal: 10, paddingVertical: 6, borderRadius: theme.radius.pill },
  addBtnTxt: { color: "#FFF", fontWeight: "700", fontSize: 12 },
  empty: { padding: 24, alignItems: "center" },
  emptyTxt: { fontSize: 13, color: HT.muted },
  card: { backgroundColor: HT.card, borderRadius: theme.radius.md, borderWidth: 1, borderColor: HT.border, borderLeftWidth: 4, padding: 12, marginBottom: 8 },
  cardRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  cardTitle: { fontSize: 14, fontWeight: "700", color: HT.text, flex: 1 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  metaTxt: { fontSize: 11, color: HT.muted },
  shareInlineBtn: { marginLeft: "auto", padding: 4, borderRadius: 999, backgroundColor: HT.violetTint },
  dotSep: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: HT.muted, marginHorizontal: 4 },
  outcomesRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 8 },
  outcomeChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: theme.radius.pill, borderWidth: 1 },
  outcomeChipTxt: { fontSize: 11, fontWeight: "700" },
  noteInput: { backgroundColor: HT.card2, borderRadius: 8, padding: 10, borderWidth: 1, borderColor: HT.border, minHeight: 60, color: HT.text, textAlignVertical: "top" },
  miniBtn: { flex: 1, backgroundColor: HT.brand, paddingVertical: 8, borderRadius: theme.radius.pill, alignItems: "center" },
  miniBtnTxt: { color: "#FFF", fontWeight: "700", fontSize: 12 },
  noteView: { marginTop: 8, backgroundColor: HT.card2, borderRadius: 8, padding: 10, borderWidth: 1, borderColor: HT.border },
  noteViewTxt: { fontSize: 12, color: HT.text, lineHeight: 17 },
  editHint: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 6, alignSelf: "flex-end" },
  editHintTxt: { fontSize: 10, color: HT.brand, fontWeight: "700" },
  addNoteBtn: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8, paddingVertical: 6, alignSelf: "flex-start" },
  addNoteBtnTxt: { fontSize: 12, color: HT.brand, fontWeight: "700" },
});

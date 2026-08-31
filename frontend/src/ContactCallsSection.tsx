import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Modal, TextInput } from "react-native";
import { useSafeBottom } from "@/src/hooks/useSafeBottom";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { theme } from "@/src/theme";

/**
 * V28.c — Renamed: "Cronologia comunicazioni" (was: telefonate).
 * Renders a unified timeline of ALL communication events with the contact:
 *   • phone (Chiama)   → outgoing/incoming call
 *   • sms              → SMS sent
 *   • whatsapp         → WhatsApp opened / message sent
 *   • email            → Email opened via mailto:
 *   • telegram         → Telegram deep-link opened
 * Backed by the same GET /calls/log?contact_id=... endpoint. Each entry now
 * includes a `channel` field (default "phone" for legacy rows).
 */

type CallLog = {
  log_id: string;
  contact_id?: string | null;
  callback_id?: string | null;
  appointment_id?: string | null;
  phone?: string | null;
  channel?: string | null;
  outcome_id: string;
  note?: string;
  duration_sec?: number;
  created_at: string;
};

type Outcome = { id: string; name: string; color: string; icon: string };

type Props = {
  contactId: string;
  contactName: string;
  contactPhone?: string;
  refreshTick?: number;
  onCallStarted: () => void;
};

const CHANNEL_META: Record<
  string,
  { label: string; color: string; icon: keyof typeof Ionicons.glyphMap }
> = {
  phone:    { label: "Telefonata",  color: "#0F766E", icon: "call" },
  sms:      { label: "SMS",         color: "#6366F1", icon: "chatbubble-ellipses" },
  whatsapp: { label: "WhatsApp",    color: "#25D366", icon: "logo-whatsapp" },
  email:    { label: "Email",       color: "#0F2438", icon: "mail" },
  telegram: { label: "Telegram",    color: "#0088CC", icon: "paper-plane" },
};

function fmtDuration(sec: number): string {
  if (!sec || sec < 1) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s.toString().padStart(2, "0")}s` : `${s}s`;
}

function fmtDateTime(iso: string): { date: string; time: string } {
  try {
    const d = new Date(iso);
    return {
      date: d.toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" }),
      time: d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };
  } catch {
    return { date: iso, time: "" };
  }
}

export function ContactCallsSection({ contactId, contactName, contactPhone, refreshTick, onCallStarted }: Props) {
  const safeBottom = useSafeBottom(); // V29.aq
  const [logs, setLogs] = useState<CallLog[]>([]);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [loading, setLoading] = useState(true);
  // V28.f — Inline edit modal for outcome / duration / note
  const [editing, setEditing] = useState<CallLog | null>(null);
  const [editOutcomeId, setEditOutcomeId] = useState<string>("");
  const [editDurationMin, setEditDurationMin] = useState<string>("");
  const [editDurationSec, setEditDurationSec] = useState<string>("");
  const [editNote, setEditNote] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, s] = await Promise.all([
        api<{ items: CallLog[] }>(`/calls/log`, { query: { contact_id: contactId, limit: 200 } }),
        api<any>("/settings"),
      ]);
      setLogs(r.items || []);
      setOutcomes((s.call_outcomes as Outcome[]) || []);
    } finally { setLoading(false); }
  }, [contactId]);

  useEffect(() => { load(); }, [load, refreshTick]);

  const outcomeById = (id: string): Outcome | null => outcomes.find((o) => o.id === id) || null;

  const openEditor = (log: CallLog) => {
    setEditing(log);
    setEditOutcomeId(log.outcome_id.startsWith("auto_") ? "" : log.outcome_id);
    const total = log.duration_sec || 0;
    setEditDurationMin(String(Math.floor(total / 60)));
    setEditDurationSec(String(total % 60));
    setEditNote(log.note || "");
  };

  const saveEditor = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const min = Math.max(0, parseInt(editDurationMin || "0", 10) || 0);
      const sec = Math.max(0, Math.min(59, parseInt(editDurationSec || "0", 10) || 0));
      await api(`/calls/log/${editing.log_id}`, {
        method: "PATCH",
        body: {
          outcome_id: editOutcomeId || undefined,
          duration_sec: min * 60 + sec,
          note: editNote,
        },
      });
      setEditing(null);
      load();
    } catch {
      /* ignore — form stays open */
    } finally { setSaving(false); }
  };

  const describeLog = (log: CallLog): { channelMeta: (typeof CHANNEL_META)["phone"]; description: string } => {
    const ch = (log.channel || "phone").toLowerCase();
    const meta = CHANNEL_META[ch] || CHANNEL_META.phone;
    // Prefer an explicit outcome name when the master has configured them (phone flow),
    // otherwise fall back to a generic "canale aperto" description.
    const o = outcomeById(log.outcome_id);
    let description = "";
    if (o && !log.outcome_id.startsWith("auto_")) {
      description = o.name;
    } else {
      if (ch === "phone") description = "Chiamata avviata";
      else if (ch === "sms") description = "SMS aperto";
      else if (ch === "whatsapp") description = "WhatsApp aperto";
      else if (ch === "email") description = "Email aperta";
      else if (ch === "telegram") description = "Telegram aperto";
      else description = "Comunicazione";
    }
    return { channelMeta: meta, description };
  };

  return (
    <View style={{ flex: 1 }}>
      {/* Header con azione "Chiama ora" */}
      <View style={styles.headerCard}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Cronologia comunicazioni</Text>
          <Text style={styles.headerSub}>{contactName}{contactPhone ? ` · ${contactPhone}` : ""}</Text>
        </View>
        <Pressable
          testID="calls-tab-dial-btn"
          onPress={onCallStarted}
          disabled={!contactPhone}
          style={[styles.dialBtn, !contactPhone && { opacity: 0.4 }]}
        >
          <Ionicons name="call" size={16} color="#FFF" />
          <Text style={styles.dialBtnTxt}>Chiama</Text>
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator color={theme.color.brandPrimary} style={{ marginTop: 30 }} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 4 }}>
          {logs.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="chatbubbles-outline" size={44} color={theme.color.muted} />
              <Text style={styles.emptyTxt}>Nessuna comunicazione registrata</Text>
              <Text style={styles.emptyHint}>
                Ogni volta che tocchi Chiama, SMS, WhatsApp, Email o Telegram nella scheda, l&apos;evento viene registrato qui con data e ora.
              </Text>
            </View>
          ) : (
            logs.map((log) => {
              const { channelMeta, description } = describeLog(log);
              const { date, time } = fmtDateTime(log.created_at);
              const duration = fmtDuration(log.duration_sec || 0);
              return (
                <View
                  key={log.log_id}
                  testID={`call-log-${log.log_id}`}
                  style={[styles.logCard, { borderLeftColor: channelMeta.color }]}
                >
                  <View style={styles.logRow}>
                    <View style={[styles.channelChip, { backgroundColor: channelMeta.color }]}>
                      <Ionicons name={channelMeta.icon} size={12} color="#FFF" />
                      <Text style={styles.channelChipTxt}>{channelMeta.label}</Text>
                    </View>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      {duration ? <Text style={styles.durationTxt}>{duration}</Text> : null}
                      <Pressable
                        testID={`call-log-edit-${log.log_id}`}
                        onPress={() => openEditor(log)}
                        hitSlop={8}
                        style={styles.editBtn}
                      >
                        <Ionicons name="create-outline" size={16} color={theme.color.brandPrimary} />
                      </Pressable>
                    </View>
                  </View>
                  <Text style={styles.descriptionTxt}>{description}</Text>
                  <View style={styles.metaRow}>
                    <Ionicons name="calendar-outline" size={12} color={theme.color.muted} />
                    <Text style={styles.metaTxt}>{date}</Text>
                    <Ionicons name="time-outline" size={12} color={theme.color.muted} style={{ marginLeft: 10 }} />
                    <Text style={styles.metaTxt}>{time}</Text>
                    {log.phone ? (
                      <>
                        <Ionicons name="call-outline" size={12} color={theme.color.muted} style={{ marginLeft: 10 }} />
                        <Text style={styles.metaTxt}>{log.phone}</Text>
                      </>
                    ) : null}
                  </View>
                  {log.note ? (
                    <Text style={styles.noteTxt} numberOfLines={4}>{log.note}</Text>
                  ) : null}
                </View>
              );
            })
          )}
          <View style={{ height: 60 }} />
        </ScrollView>
      )}

      {/* V28.f — Edit modal: outcome + duration + note */}
      <Modal visible={!!editing} transparent animationType="slide" onRequestClose={() => setEditing(null)}>
        <View style={styles.editBackdrop}>
          <View style={[styles.editCard, { paddingBottom: 16 + safeBottom }]} testID="call-log-edit-modal">
            <View style={styles.editHead}>
              <Text style={styles.editTitle}>Modifica chiamata</Text>
              <Pressable onPress={() => setEditing(null)} hitSlop={8}>
                <Ionicons name="close" size={22} color={theme.color.onSurface} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
              <Text style={styles.editLbl}>Esito chiamata</Text>
              <View style={styles.outcomeGrid}>
                {outcomes.map((o) => {
                  const on = editOutcomeId === o.id;
                  return (
                    <Pressable
                      key={o.id}
                      testID={`edit-outcome-${o.id}`}
                      onPress={() => setEditOutcomeId(on ? "" : o.id)}
                      style={[
                        styles.outcomeBtn,
                        { borderColor: o.color },
                        on && { backgroundColor: o.color },
                      ]}
                    >
                      <Ionicons name={(o.icon as any) || "call"} size={12} color={on ? "#FFF" : o.color} />
                      <Text style={[styles.outcomeBtnTxt, { color: on ? "#FFF" : o.color }]}>{o.name}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.editLbl}>Durata</Text>
              <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
                <TextInput
                  testID="edit-duration-min"
                  value={editDurationMin}
                  onChangeText={(t) => setEditDurationMin(t.replace(/[^\d]/g, "").slice(0, 3))}
                  keyboardType="number-pad"
                  placeholder="0"
                  placeholderTextColor="#94A3B8"
                  style={styles.durInput}
                />
                <Text style={{ fontWeight: "700", color: theme.color.muted }}>min</Text>
                <TextInput
                  testID="edit-duration-sec"
                  value={editDurationSec}
                  onChangeText={(t) => setEditDurationSec(t.replace(/[^\d]/g, "").slice(0, 2))}
                  keyboardType="number-pad"
                  placeholder="0"
                  placeholderTextColor="#94A3B8"
                  style={styles.durInput}
                />
                <Text style={{ fontWeight: "700", color: theme.color.muted }}>sec</Text>
              </View>

              <Text style={styles.editLbl}>Nota</Text>
              <TextInput
                testID="edit-note"
                value={editNote}
                onChangeText={setEditNote}
                multiline
                placeholder="Aggiungi una nota sulla chiamata…"
                placeholderTextColor="#94A3B8"
                style={styles.noteInput}
              />

              <Pressable testID="edit-log-save" onPress={saveEditor} disabled={saving} style={[styles.saveBtn, saving && { opacity: 0.6 }]}>
                {saving ? <ActivityIndicator color="#FFF" /> : (
                  <>
                    <Ionicons name="save" size={16} color="#FFF" />
                    <Text style={styles.saveBtnTxt}>Salva modifiche</Text>
                  </>
                )}
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  headerCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#FFF",
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.border,
  },
  headerTitle: { fontSize: 14, fontWeight: "800", color: theme.color.onSurface },
  headerSub: { fontSize: 11, color: theme.color.muted, marginTop: 1 },
  dialBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#16A34A",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: theme.radius.pill,
  },
  dialBtnTxt: { color: "#FFF", fontWeight: "700", fontSize: 13 },
  empty: { alignItems: "center", padding: 40, gap: 8 },
  emptyTxt: { fontSize: 15, fontWeight: "700", color: theme.color.onSurfaceTertiary },
  emptyHint: { fontSize: 12, color: theme.color.muted, textAlign: "center", marginTop: 4, lineHeight: 17 },
  logCard: {
    backgroundColor: "#FFF",
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderLeftWidth: 4,
    padding: 12,
    marginBottom: 8,
  },
  logRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  channelChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: theme.radius.pill },
  channelChipTxt: { color: "#FFF", fontWeight: "700", fontSize: 11 },
  durationTxt: { fontSize: 12, color: theme.color.muted, fontWeight: "600" },
  descriptionTxt: { fontSize: 13, fontWeight: "700", color: theme.color.onSurface, marginBottom: 4 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2, flexWrap: "wrap" },
  metaTxt: { fontSize: 11, color: theme.color.muted },
  noteTxt: { marginTop: 6, fontSize: 13, color: theme.color.onSurface, lineHeight: 18 },
  editBtn: { padding: 4 },
  // V28.f — edit modal styles
  editBackdrop: { flex: 1, backgroundColor: "rgba(15,23,42,0.55)", justifyContent: "flex-end" },
  editCard: { backgroundColor: "#FFF", borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: "88%" },
  editHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  editTitle: { fontSize: 16, fontWeight: "800", color: theme.color.onSurface },
  editLbl: { fontSize: 12, fontWeight: "800", color: theme.color.muted, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 4 },
  outcomeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  outcomeBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: theme.radius.pill, borderWidth: 1.5, backgroundColor: "#FFF" },
  outcomeBtnTxt: { fontSize: 12, fontWeight: "700" },
  durInput: { width: 68, backgroundColor: "#FFF", borderWidth: 1, borderColor: theme.color.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, textAlign: "center", fontSize: 16, fontWeight: "800", color: theme.color.onSurface },
  noteInput: { backgroundColor: "#FFF", borderWidth: 1, borderColor: theme.color.border, borderRadius: 8, padding: 10, minHeight: 80, textAlignVertical: "top", color: theme.color.onSurface },
  saveBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: theme.color.brandPrimary, paddingVertical: 12, borderRadius: 10, marginTop: 8 },
  saveBtnTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
});

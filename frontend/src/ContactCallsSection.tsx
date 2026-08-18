import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { theme } from "@/src/theme";

type CallLog = {
  log_id: string;
  contact_id?: string | null;
  callback_id?: string | null;
  appointment_id?: string | null;
  phone?: string | null;
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

function fmtDuration(sec: number): string {
  if (!sec || sec < 1) return "—";
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
  const [logs, setLogs] = useState<CallLog[]>([]);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [loading, setLoading] = useState(true);

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

  return (
    <View style={{ flex: 1 }}>
      {/* Header con azione "Chiama ora" */}
      <View style={styles.headerCard}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Cronologia telefonate</Text>
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
              <Ionicons name="call-outline" size={44} color={theme.color.muted} />
              <Text style={styles.emptyTxt}>Nessuna chiamata registrata</Text>
              <Text style={styles.emptyHint}>
                Tocca &quot;Chiama&quot; qui sopra o nella tab Info per avviare una telefonata e registrarne l&apos;esito.
              </Text>
            </View>
          ) : (
            logs.map((log) => {
              const o = outcomeById(log.outcome_id);
              const { date, time } = fmtDateTime(log.created_at);
              return (
                <View
                  key={log.log_id}
                  testID={`call-log-${log.log_id}`}
                  style={[styles.logCard, { borderLeftColor: o?.color || theme.color.muted }]}
                >
                  <View style={styles.logRow}>
                    <View style={[styles.outcomeChip, { backgroundColor: o?.color || theme.color.muted }]}>
                      <Ionicons name={(o?.icon as any) || "call"} size={12} color="#FFF" />
                      <Text style={styles.outcomeChipTxt}>{o?.name || log.outcome_id}</Text>
                    </View>
                    <Text style={styles.durationTxt}>{fmtDuration(log.duration_sec || 0)}</Text>
                  </View>
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
  outcomeChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: theme.radius.pill },
  outcomeChipTxt: { color: "#FFF", fontWeight: "700", fontSize: 11 },
  durationTxt: { fontSize: 12, color: theme.color.muted, fontWeight: "600" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2, flexWrap: "wrap" },
  metaTxt: { fontSize: 11, color: theme.color.muted },
  noteTxt: { marginTop: 6, fontSize: 13, color: theme.color.onSurface, lineHeight: 18 },
});

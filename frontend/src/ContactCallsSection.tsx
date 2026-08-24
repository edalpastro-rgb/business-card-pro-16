import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
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
                    {duration ? <Text style={styles.durationTxt}>{duration}</Text> : null}
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
});

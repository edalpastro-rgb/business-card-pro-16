// V44 — Team Insights. Master-only page: list of collaborators with mini-KPIs
// + tap-to-detail with AI behavioural profile.
//
// Route: /team-insights                  → list
// Route: /team-insights?member=<user_id> → detail
//
// We use a single file to keep it simple: local state selection instead of
// expo-router dynamic routes, but we DO honour ?member= for deep-linking.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";

type TeamMemberMetrics = {
  contacts_total: number;
  contacts_30d: number;
  appts_total: number;
  appts_30d: number;
  appts_upcoming: number;
  callbacks_30d: number;
  callbacks_pending: number;
  chat_msgs_30d: number;
  chat_msgs_7d: number;
  feedback_ups: number;
  feedback_downs: number;
  last_active_at?: string | null;
};

type TeamListItem = {
  user_id: string;
  name: string;
  email: string;
  role?: string;
  areas?: string[];
  picture?: string | null;
  metrics: TeamMemberMetrics;
};

type TeamMemberProfile = {
  communication_style?: string;
  strengths?: string[];
  improvement_areas?: string[];
  overall_summary?: string;
};

type TeamDetail = {
  user_id: string;
  name: string;
  email: string;
  role?: string;
  areas?: string[];
  picture?: string | null;
  metrics: TeamMemberMetrics;
  topics: { topic: string; count: number }[];
  profile: TeamMemberProfile;
  profile_from_cache: boolean;
  profile_generated_at?: string;
};

function initials(name?: string): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  const s = (parts[0] || "").charAt(0) + (parts[1] || "").charAt(0);
  return s.toUpperCase() || "?";
}

function timeAgo(iso?: string | null): string {
  if (!iso) return "mai";
  try {
    const d = new Date(iso);
    const diff = Math.max(0, (Date.now() - d.getTime()) / 1000);
    if (diff < 60) return "ora";
    if (diff < 3600) return `${Math.round(diff / 60)}m fa`;
    if (diff < 86400) return `${Math.round(diff / 3600)}h fa`;
    if (diff < 86400 * 30) return `${Math.round(diff / 86400)}g fa`;
    return d.toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return "?";
  }
}

const KPI_COLORS = {
  contacts: "#0EA5E9",
  appts: "#7C3AED",
  chat: "#EA580C",
  callbacks: "#DC2626",
  ups: "#16A34A",
  downs: "#DC2626",
};

// -------------------------------------------------------------------------
// List view
// -------------------------------------------------------------------------

function TeamListView({
  items,
  loading,
  onSelect,
}: {
  items: TeamListItem[];
  loading: boolean;
  onSelect: (uid: string) => void;
}) {
  if (loading) {
    return (
      <View style={{ padding: 40, alignItems: "center" }}>
        <ActivityIndicator color={theme.color.brandPrimary} />
      </View>
    );
  }
  if (items.length === 0) {
    return (
      <View style={styles.empty}>
        <Ionicons name="people-outline" size={40} color="#94A3B8" />
        <Text style={styles.emptyTitle}>Nessun collaboratore</Text>
        <Text style={styles.emptyTxt}>
          Invita membri della tua rete dal menu ⋯ della pagina Master per vedere qui i loro profili.
        </Text>
      </View>
    );
  }
  return (
    <>
      {items.map((it) => (
        <Pressable
          key={it.user_id}
          onPress={() => onSelect(it.user_id)}
          style={styles.memberCard}
          testID={`team-member-${it.user_id}`}
        >
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarTxt}>{initials(it.name)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={styles.memberName} numberOfLines={1}>{it.name || "Senza nome"}</Text>
              {(it.areas || []).slice(0, 2).map((a) => (
                <View key={a} style={styles.areaPill}>
                  <Text style={styles.areaPillTxt}>{a}</Text>
                </View>
              ))}
            </View>
            <Text style={styles.memberEmail} numberOfLines={1}>{it.email}</Text>
            <View style={styles.miniKpiRow}>
              <View style={styles.miniKpi}>
                <Ionicons name="chatbubbles" size={11} color={KPI_COLORS.chat} />
                <Text style={styles.miniKpiTxt}>{it.metrics.chat_msgs_30d}</Text>
              </View>
              <View style={styles.miniKpi}>
                <Ionicons name="calendar" size={11} color={KPI_COLORS.appts} />
                <Text style={styles.miniKpiTxt}>{it.metrics.appts_30d}</Text>
              </View>
              <View style={styles.miniKpi}>
                <Ionicons name="people" size={11} color={KPI_COLORS.contacts} />
                <Text style={styles.miniKpiTxt}>{it.metrics.contacts_total}</Text>
              </View>
              <Text style={styles.lastActive}>· {timeAgo(it.metrics.last_active_at)}</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={20} color={theme.color.muted} />
        </Pressable>
      ))}
    </>
  );
}

// -------------------------------------------------------------------------
// Detail view
// -------------------------------------------------------------------------

function KpiCard({
  label,
  value,
  sub,
  icon,
  color,
}: {
  label: string;
  value: number | string;
  sub?: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
}) {
  return (
    <View style={[styles.kpiCard, { borderTopColor: color }]}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Ionicons name={icon} size={18} color={color} />
        <Text style={[styles.kpiValue, { color }]}>{value}</Text>
      </View>
      <Text style={styles.kpiLabel}>{label}</Text>
      {sub ? <Text style={styles.kpiSub}>{sub}</Text> : null}
    </View>
  );
}

function TeamDetailView({
  data,
  loading,
  refreshing,
  onRefresh,
  onBack,
}: {
  data: TeamDetail | null;
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onBack: () => void;
}) {
  if (loading) {
    return (
      <View style={{ padding: 40, alignItems: "center", gap: 8 }}>
        <ActivityIndicator color={theme.color.brandPrimary} />
        <Text style={{ color: "#64748B", fontSize: 12 }}>Generazione profilo AI in corso…</Text>
      </View>
    );
  }
  if (!data) {
    return (
      <View style={styles.empty}>
        <Ionicons name="alert-circle-outline" size={40} color="#DC2626" />
        <Text style={styles.emptyTitle}>Impossibile caricare</Text>
      </View>
    );
  }
  const m = data.metrics;
  return (
    <>
      {/* Profile header */}
      <View style={styles.detailHeader}>
        <View style={styles.avatarLg}>
          <Text style={styles.avatarLgTxt}>{initials(data.name)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.detailName}>{data.name}</Text>
          <Text style={styles.detailEmail}>{data.email}</Text>
          <View style={{ flexDirection: "row", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
            {(data.areas || []).map((a) => (
              <View key={a} style={styles.areaPill}>
                <Text style={styles.areaPillTxt}>{a}</Text>
              </View>
            ))}
            <Text style={styles.lastActive}>· ultima attività {timeAgo(m.last_active_at)}</Text>
          </View>
        </View>
      </View>

      {/* KPI grid */}
      <View style={styles.kpiGrid}>
        <KpiCard label="Contatti" value={m.contacts_total} sub={`+${m.contacts_30d} in 30gg`} icon="people" color={KPI_COLORS.contacts} />
        <KpiCard label="Appuntamenti 30gg" value={m.appts_30d} sub={`${m.appts_upcoming} in arrivo`} icon="calendar" color={KPI_COLORS.appts} />
        <KpiCard label="Chat Axon 30gg" value={m.chat_msgs_30d} sub={`${m.chat_msgs_7d} negli ultimi 7g`} icon="chatbubbles" color={KPI_COLORS.chat} />
        <KpiCard label="Chiamate 30gg" value={m.callbacks_30d} sub={`${m.callbacks_pending} pendenti`} icon="call" color={KPI_COLORS.callbacks} />
      </View>

      {/* Feedback breakdown */}
      <View style={styles.feedbackBar}>
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Ionicons name="thumbs-up" size={14} color={KPI_COLORS.ups} />
          <Text style={styles.feedbackTxt}>{m.feedback_ups}</Text>
          <Text style={styles.feedbackLbl}>👍 dati</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Ionicons name="thumbs-down" size={14} color={KPI_COLORS.downs} />
          <Text style={styles.feedbackTxt}>{m.feedback_downs}</Text>
          <Text style={styles.feedbackLbl}>👎 dati</Text>
        </View>
      </View>

      {/* Top topics */}
      {data.topics.length > 0 && (
        <View style={styles.topicsBox}>
          <Text style={styles.sectionTitle}>Argomenti più richiesti ad Axon</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {data.topics.map((t) => (
              <View key={t.topic} style={styles.topicChip}>
                <Text style={styles.topicChipTxt}>{t.topic}</Text>
                <Text style={styles.topicChipCnt}>×{t.count}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* AI Profile */}
      <View style={styles.profileBox}>
        <View style={styles.profileHeader}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Ionicons name="sparkles" size={16} color="#7C3AED" />
            <Text style={styles.sectionTitle}>Profilo comportamentale AI</Text>
          </View>
          <Pressable
            onPress={onRefresh}
            disabled={refreshing}
            style={[styles.refreshBtn, refreshing && { opacity: 0.5 }]}
            testID="refresh-profile"
          >
            {refreshing ? (
              <ActivityIndicator size="small" color="#7C3AED" />
            ) : (
              <>
                <Ionicons name="refresh" size={14} color="#7C3AED" />
                <Text style={styles.refreshTxt}>Rigenera</Text>
              </>
            )}
          </Pressable>
        </View>

        {!data.profile.overall_summary ? (
          <Text style={styles.emptyTxt}>
            Profilo non ancora disponibile. Il collaboratore deve interagire di più con Axon per generare un profilo comportamentale utile.
          </Text>
        ) : (
          <>
            {data.profile.communication_style && (
              <View style={styles.profileRow}>
                <Text style={styles.profileRowLbl}>Stile comunicativo</Text>
                <Text style={styles.profileRowTxt}>{data.profile.communication_style}</Text>
              </View>
            )}

            {(data.profile.strengths || []).length > 0 && (
              <View style={styles.profileRow}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
                  <Ionicons name="checkmark-circle" size={14} color="#16A34A" />
                  <Text style={[styles.profileRowLbl, { color: "#16A34A" }]}>Punti di forza</Text>
                </View>
                {(data.profile.strengths || []).map((s, i) => (
                  <View key={i} style={{ flexDirection: "row", gap: 6, marginBottom: 3 }}>
                    <Text style={{ color: "#16A34A" }}>•</Text>
                    <Text style={{ flex: 1, fontSize: 13, color: "#334155", lineHeight: 18 }}>{s}</Text>
                  </View>
                ))}
              </View>
            )}

            {(data.profile.improvement_areas || []).length > 0 && (
              <View style={styles.profileRow}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
                  <Ionicons name="trending-up" size={14} color="#EA580C" />
                  <Text style={[styles.profileRowLbl, { color: "#EA580C" }]}>Aree di miglioramento</Text>
                </View>
                {(data.profile.improvement_areas || []).map((s, i) => (
                  <View key={i} style={{ flexDirection: "row", gap: 6, marginBottom: 3 }}>
                    <Text style={{ color: "#EA580C" }}>•</Text>
                    <Text style={{ flex: 1, fontSize: 13, color: "#334155", lineHeight: 18 }}>{s}</Text>
                  </View>
                ))}
              </View>
            )}

            {data.profile.overall_summary && (
              <View style={[styles.profileRow, { backgroundColor: "#F8FAFC", borderRadius: 12, padding: 10 }]}>
                <Text style={styles.profileRowLbl}>Sintesi</Text>
                <Text style={{ fontSize: 13, color: "#0F172A", lineHeight: 19, marginTop: 4 }}>
                  {data.profile.overall_summary}
                </Text>
              </View>
            )}
          </>
        )}

        {data.profile_generated_at && (
          <Text style={styles.profileMeta}>
            {data.profile_from_cache ? "Da cache · " : "Generato ora · "}
            {timeAgo(data.profile_generated_at)}
          </Text>
        )}
      </View>
    </>
  );
}

// -------------------------------------------------------------------------
// Screen (list ↔ detail)
// -------------------------------------------------------------------------

export default function TeamInsightsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ member?: string }>();
  const isMaster = !user?.parent_user_id && (user?.role || "member") === "owner";
  const [items, setItems] = useState<TeamListItem[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(
    typeof params.member === "string" ? params.member : null
  );
  const [detail, setDetail] = useState<TeamDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadList = useCallback(async () => {
    if (!isMaster) return;
    setListLoading(true);
    try {
      const r = await api<{ items: TeamListItem[] }>("/team-insights");
      setItems(r.items || []);
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile caricare team");
    } finally {
      setListLoading(false);
    }
  }, [isMaster]);

  const loadDetail = useCallback(async (uid: string) => {
    setDetailLoading(true);
    try {
      const r = await api<TeamDetail>(`/team-insights/${uid}`);
      setDetail(r);
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile caricare profilo");
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isMaster) loadList();
  }, [isMaster, loadList]);

  useEffect(() => {
    if (selected) loadDetail(selected);
  }, [selected, loadDetail]);

  const refreshProfile = useCallback(async () => {
    if (!selected) return;
    setRefreshing(true);
    try {
      const r = await api<{ ok: boolean; profile: TeamMemberProfile; generated_at: string }>(
        `/team-insights/${selected}/refresh-profile`,
        { method: "POST" }
      );
      if (detail) {
        setDetail({ ...detail, profile: r.profile, profile_from_cache: false, profile_generated_at: r.generated_at });
      }
      notify("Profilo aggiornato", "Il profilo AI è stato rigenerato.");
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile rigenerare");
    } finally {
      setRefreshing(false);
    }
  }, [selected, detail]);

  const headerTitle = useMemo(() => {
    if (selected && detail) return detail.name || "Profilo";
    return "Team Insights";
  }, [selected, detail]);

  if (!user) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={{ padding: 40, alignItems: "center" }}>
          <ActivityIndicator color={theme.color.brandPrimary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!isMaster) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={22} color="#FFF" />
          </Pressable>
          <Text style={styles.headerTitle}>Team Insights</Text>
        </View>
        <View style={styles.empty}>
          <Ionicons name="lock-closed-outline" size={40} color="#94A3B8" />
          <Text style={styles.emptyTitle}>Sezione riservata al Master</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable
          onPress={() => (selected ? setSelected(null) : router.back())}
          hitSlop={10}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={22} color="#FFF" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>{headerTitle}</Text>
          <Text style={styles.headerSub}>
            {selected ? "Profilo comportamentale AI" : `${items.length} collaboratori`}
          </Text>
        </View>
        {!selected ? (
          <Pressable
            onPress={() => router.push("/team-compare" as any)}
            hitSlop={10}
            style={[styles.backBtn, { width: "auto", paddingHorizontal: 10, flexDirection: "row", gap: 4 }]}
            testID="insights-compare"
          >
            <Ionicons name="podium" size={16} color="#FFF" />
            <Text style={{ color: "#FFF", fontSize: 12, fontWeight: "800" }}>Confronta</Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 140, gap: 12 }}>
        {/* V50.z273 — AREA CORSI (Corporate Gym v2.0): cartelle corsi, lettura/partecipazione del team */}
        {!selected ? <CoursesCard router={router} /> : null}
        {selected ? (
          <TeamDetailView
            data={detail}
            loading={detailLoading}
            refreshing={refreshing}
            onRefresh={refreshProfile}
            onBack={() => setSelected(null)}
          />
        ) : (
          <TeamListView items={items} loading={listLoading} onSelect={setSelected} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: "#0EA5E9",
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { color: "#FFF", fontSize: 18, fontWeight: "800", letterSpacing: -0.2 },
  headerSub: { color: "rgba(255,255,255,0.85)", fontSize: 12, marginTop: 2 },
  empty: {
    alignItems: "center",
    gap: 6,
    padding: 32,
    backgroundColor: "#FFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderStyle: "dashed",
  },
  emptyTitle: { fontSize: 15, fontWeight: "700", color: "#334155", marginTop: 8 },
  emptyTxt: { fontSize: 12, color: "#64748B", textAlign: "center", maxWidth: 300 },

  // List
  memberCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#FFF",
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: "#EEF2F7",
  },
  avatarCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#0EA5E9",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarTxt: { color: "#FFF", fontSize: 16, fontWeight: "800", letterSpacing: -0.5 },
  memberName: { fontSize: 15, fontWeight: "800", color: "#0F172A", flexShrink: 1 },
  memberEmail: { fontSize: 11, color: "#64748B", marginTop: 1 },
  areaPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: "#E0F2FE",
    borderWidth: 1,
    borderColor: "#7DD3FC",
  },
  areaPillTxt: { fontSize: 9, color: "#075985", fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.3 },
  miniKpiRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 6, flexWrap: "wrap" },
  miniKpi: { flexDirection: "row", alignItems: "center", gap: 3 },
  miniKpiTxt: { fontSize: 11, color: "#0F172A", fontWeight: "700" },
  lastActive: { fontSize: 10, color: "#94A3B8", fontWeight: "600" },

  // Detail
  detailHeader: { flexDirection: "row", gap: 14, alignItems: "center", padding: 4 },
  avatarLg: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#0EA5E9",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarLgTxt: { color: "#FFF", fontSize: 22, fontWeight: "800", letterSpacing: -0.5 },
  detailName: { fontSize: 20, fontWeight: "800", color: "#0F172A" },
  detailEmail: { fontSize: 12, color: "#64748B" },
  kpiGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  kpiCard: {
    flexBasis: "48%",
    flexGrow: 1,
    backgroundColor: "#FFF",
    borderRadius: 12,
    padding: 12,
    borderTopWidth: 3,
    borderColor: "#EEF2F7",
    borderWidth: 1,
  },
  kpiValue: { fontSize: 22, fontWeight: "800", letterSpacing: -0.5 },
  kpiLabel: { fontSize: 11, color: "#64748B", fontWeight: "700", textTransform: "uppercase", marginTop: 4 },
  kpiSub: { fontSize: 10, color: "#94A3B8", marginTop: 2 },
  feedbackBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#FFF",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "#EEF2F7",
  },
  feedbackTxt: { fontSize: 16, fontWeight: "800", color: "#0F172A" },
  feedbackLbl: { fontSize: 11, color: "#64748B" },

  topicsBox: {
    backgroundColor: "#FFF",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "#EEF2F7",
  },
  sectionTitle: { fontSize: 13, fontWeight: "800", color: "#0F172A", marginBottom: 8 },
  topicChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "#F1F5F9",
  },
  topicChipTxt: { fontSize: 11, color: "#334155", fontWeight: "700" },
  topicChipCnt: { fontSize: 10, color: "#94A3B8", fontWeight: "700" },

  profileBox: {
    backgroundColor: "#FFF",
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: "#EDE9FE",
    borderLeftWidth: 4,
    borderLeftColor: "#7C3AED",
    gap: 8,
  },
  profileHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  refreshBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#F3E8FF",
  },
  refreshTxt: { fontSize: 11, color: "#7C3AED", fontWeight: "800" },
  profileRow: { marginTop: 6 },
  profileRowLbl: { fontSize: 11, color: "#64748B", fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.3 },
  profileRowTxt: { fontSize: 14, color: "#0F172A", fontWeight: "600", marginTop: 4 },
  profileMeta: { fontSize: 10, color: "#94A3B8", textAlign: "right", marginTop: 6 },
});

// V50.z273 — Card «Area Corsi» nel blocco Team Insights (badge con i corsi nuovi non ancora aperti)
function CoursesCard({ router }: { router: ReturnType<typeof useRouter> }) {
  const [info, setInfo] = React.useState<{ total: number; newCount: number; canManage: boolean } | null>(null);
  React.useEffect(() => {
    api<{ items: any[]; new_count: number; can_manage: boolean }>("/courses").then((r) => setInfo({ total: (r.items || []).length, newCount: r.new_count || 0, canManage: !!r.can_manage })).catch(() => setInfo({ total: 0, newCount: 0, canManage: false }));
  }, []);
  return (
    <Pressable onPress={() => router.push("/courses" as any)} style={{ flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#FAF5FF", borderWidth: 1, borderColor: "#E9D5FF", borderRadius: 16, padding: 14, minHeight: 72 }} testID="team-courses-card">
      <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: "#7C3AED", alignItems: "center", justifyContent: "center" }}><Ionicons name="school" size={22} color="#FFF" /></View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, fontWeight: "900", color: "#1F1147" }}>Area Corsi</Text>
        <Text style={{ fontSize: 12, color: "#6B21A8", marginTop: 2 }}>{info ? `${info.total} cartelle corso${info.canManage ? " · lettura e partecipazione del team" : ""}` : "Caricamento…"}</Text>
      </View>
      {info && info.newCount > 0 ? <View style={{ backgroundColor: "#DC2626", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 }}><Text style={{ color: "#FFF", fontSize: 11, fontWeight: "900" }}>{info.newCount} nuovi</Text></View> : null}
      <Ionicons name="chevron-forward" size={18} color="#7C3AED" />
    </Pressable>
  );
}

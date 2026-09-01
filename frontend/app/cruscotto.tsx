// V45 — "Cruscotto" — unified Master dashboard.
// Aggrega feedback stats, proposte pending, top collaboratori attivi, KPI
// tenant-wide 30 giorni e stato base di conoscenza (documenti + regole).
// Master-only route.

import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";

type DashboardPayload = {
  feedback: {
    ups: number;
    downs: number;
    total: number;
    satisfaction_rate: number | null;
    window_days: number;
  };
  proposals: { pending: number; accepted_total: number };
  activity: {
    contacts_30d: number;
    contacts_total: number;
    appts_30d: number;
    appts_upcoming: number;
    callbacks_pending: number;
    chat_msgs_30d: number;
  };
  knowledge: {
    docs_count: number;
    rules_count: number;
    urls_count: number;
    semantic_cache_size: number;
  };
  team: {
    collaborators_total: number;
    top_active: {
      user_id: string;
      name: string;
      email: string;
      picture?: string | null;
      areas?: string[];
      chat_msgs_30d: number;
      appts_30d: number;
      contacts_total: number;
      last_active_at?: string | null;
    }[];
  };
  generated_at: string;
};

function initials(name?: string): string {
  if (!name) return "?";
  const p = name.trim().split(/\s+/);
  return ((p[0] || "").charAt(0) + (p[1] || "").charAt(0)).toUpperCase() || "?";
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
    return d.toLocaleDateString("it-IT", { day: "2-digit", month: "short" });
  } catch {
    return "?";
  }
}

export default function CruscottoScreen() {
  const pagePad = usePageBottomPadding();
  const router = useRouter();
  const { user } = useAuth();
  const isMaster = !user?.parent_user_id && (user?.role || "member") === "owner";
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!isMaster) return;
    try {
      const r = await api<DashboardPayload>("/master/dashboard");
      setData(r);
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile caricare il cruscotto");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isMaster]);

  useEffect(() => {
    if (isMaster) {
      setLoading(true);
      load();
    }
  }, [isMaster, load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

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
          <Text style={styles.headerTitle}>Cruscotto</Text>
        </View>
        <View style={styles.empty}>
          <Ionicons name="lock-closed-outline" size={40} color="#94A3B8" />
          <Text style={styles.emptyTitle}>Sezione riservata al Master</Text>
        </View>
      </SafeAreaView>
    );
  }

  const fb = data?.feedback;
  const prop = data?.proposals;
  const act = data?.activity;
  const kb = data?.knowledge;
  const team = data?.team;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color="#FFF" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Cruscotto</Text>
          <Text style={styles.headerSub}>Panoramica completa della tua rete</Text>
        </View>
        <Pressable onPress={onRefresh} disabled={refreshing} hitSlop={10} style={styles.reloadBtn}>
          <Ionicons name={refreshing ? "hourglass" : "refresh"} size={18} color="#FFF" />
        </Pressable>
      </View>

      {loading && !data ? (
        <View style={{ padding: 40, alignItems: "center" }}>
          <ActivityIndicator color={theme.color.brandPrimary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: pagePad, gap: 14 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {/* Alerts row (proposals pending) */}
          {(prop?.pending ?? 0) > 0 && (
            <Pressable
              onPress={() => router.push("/ai-teach")}
              style={styles.alertCard}
              testID="alert-proposals"
            >
              <View style={styles.alertIcon}>
                <Ionicons name="flame" size={20} color="#EA580C" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.alertTitle}>
                  {prop!.pending} {prop!.pending === 1 ? "nuova proposta" : "nuove proposte"} da approvare
                </Text>
                <Text style={styles.alertSub}>
                  Axon ha estratto dei pattern dalle chat. Tocca per rivedere.
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#EA580C" />
            </Pressable>
          )}

          {/* Feedback panel */}
          <View style={[styles.panel, { borderLeftColor: "#7C3AED", borderLeftWidth: 4 }]}>
            <View style={styles.panelHeader}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Ionicons name="thumbs-up" size={16} color="#7C3AED" />
                <Text style={styles.panelTitle}>Come sta imparando Axon</Text>
              </View>
              <Text style={styles.panelSub}>ultimi {fb?.window_days ?? 30}g</Text>
            </View>
            <View style={styles.feedbackGrid}>
              <View style={styles.fbCell}>
                <Text style={[styles.fbBigN, { color: "#16A34A" }]}>{fb?.ups ?? 0}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                  <Ionicons name="thumbs-up" size={11} color="#16A34A" />
                  <Text style={styles.fbLbl}>Utili</Text>
                </View>
              </View>
              <View style={styles.fbCell}>
                <Text style={[styles.fbBigN, { color: "#DC2626" }]}>{fb?.downs ?? 0}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                  <Ionicons name="thumbs-down" size={11} color="#DC2626" />
                  <Text style={styles.fbLbl}>Da migliorare</Text>
                </View>
              </View>
              <View style={styles.fbCell}>
                <Text style={[styles.fbBigN, { color: "#0EA5E9" }]}>
                  {fb?.satisfaction_rate != null ? `${fb.satisfaction_rate}%` : "—"}
                </Text>
                <Text style={styles.fbLbl}>Soddisfazione</Text>
              </View>
            </View>
            {/* Bar */}
            {(fb?.total ?? 0) > 0 && (
              <View style={styles.satBar}>
                <View
                  style={[
                    styles.satBarFill,
                    { width: `${fb?.satisfaction_rate ?? 0}%` },
                  ]}
                />
              </View>
            )}
          </View>

          {/* Activity panel */}
          <View style={[styles.panel, { borderLeftColor: "#0EA5E9", borderLeftWidth: 4 }]}>
            <View style={styles.panelHeader}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Ionicons name="pulse" size={16} color="#0EA5E9" />
                <Text style={styles.panelTitle}>Attività della rete</Text>
              </View>
              <Text style={styles.panelSub}>ultimi 30g</Text>
            </View>
            <View style={styles.kpiRow}>
              <MiniKpi n={act?.contacts_30d ?? 0} lbl="Contatti nuovi" icon="people" color="#0EA5E9" sub={`${act?.contacts_total ?? 0} totali`} />
              <MiniKpi n={act?.appts_30d ?? 0} lbl="Appuntamenti" icon="calendar" color="#7C3AED" sub={`${act?.appts_upcoming ?? 0} in arrivo`} />
            </View>
            <View style={styles.kpiRow}>
              <MiniKpi n={act?.chat_msgs_30d ?? 0} lbl="Chat Axon" icon="chatbubbles" color="#EA580C" />
              <MiniKpi n={act?.callbacks_pending ?? 0} lbl="Chiamate da fare" icon="call" color="#DC2626" />
            </View>
          </View>

          {/* Knowledge panel */}
          <View style={[styles.panel, { borderLeftColor: "#FF6B35", borderLeftWidth: 4 }]}>
            <View style={styles.panelHeader}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Ionicons name="library" size={16} color="#FF6B35" />
                <Text style={styles.panelTitle}>Base di conoscenza Axon</Text>
              </View>
            </View>
            <View style={styles.kpiRow}>
              <MiniKpi n={kb?.docs_count ?? 0} lbl="Documenti" icon="document-text" color="#7C3AED" onPress={() => router.push("/documenti-axon")} />
              <MiniKpi n={kb?.rules_count ?? 0} lbl="Regole" icon="book" color="#0F766E" onPress={() => router.push("/ai-teach")} />
            </View>
            <View style={styles.kpiRow}>
              <MiniKpi n={kb?.urls_count ?? 0} lbl="Fonti URL" icon="globe" color="#0EA5E9" onPress={() => router.push("/ai-teach")} />
              <MiniKpi n={kb?.semantic_cache_size ?? 0} lbl="Cache risposte" icon="flash" color="#F59E0B" />
            </View>
            {(prop?.accepted_total ?? 0) > 0 && (
              <View style={styles.acceptedBanner}>
                <Ionicons name="checkmark-circle" size={14} color="#16A34A" />
                <Text style={styles.acceptedTxt}>
                  {prop!.accepted_total} regole auto-generate accettate
                </Text>
              </View>
            )}
          </View>

          {/* Team panel */}
          <View style={[styles.panel, { borderLeftColor: "#16A34A", borderLeftWidth: 4 }]}>
            <View style={styles.panelHeader}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Ionicons name="people-circle" size={16} color="#16A34A" />
                <Text style={styles.panelTitle}>Top collaboratori</Text>
              </View>
              <Pressable onPress={() => router.push("/team-insights")} hitSlop={8}>
                <Text style={styles.viewAll}>Vedi tutti →</Text>
              </Pressable>
            </View>
            {(team?.top_active || []).length === 0 ? (
              <Text style={{ fontSize: 12, color: "#64748B", padding: 4 }}>
                {team?.collaborators_total === 0
                  ? "Nessun collaboratore invitato. Invita membri dalla pagina Master."
                  : "Nessuna attività recente."}
              </Text>
            ) : (
              (team?.top_active || []).slice(0, 5).map((m) => (
                <Pressable
                  key={m.user_id}
                  onPress={() => router.push(`/team-insights?member=${m.user_id}` as any)}
                  style={styles.collabRow}
                  testID={`top-collab-${m.user_id}`}
                >
                  <View style={styles.collabAvatar}>
                    <Text style={styles.collabAvatarTxt}>{initials(m.name)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.collabName} numberOfLines={1}>{m.name}</Text>
                    <View style={styles.collabKpiRow}>
                      <View style={styles.collabKpi}>
                        <Ionicons name="chatbubbles" size={10} color="#EA580C" />
                        <Text style={styles.collabKpiTxt}>{m.chat_msgs_30d}</Text>
                      </View>
                      <View style={styles.collabKpi}>
                        <Ionicons name="calendar" size={10} color="#7C3AED" />
                        <Text style={styles.collabKpiTxt}>{m.appts_30d}</Text>
                      </View>
                      <View style={styles.collabKpi}>
                        <Ionicons name="people" size={10} color="#0EA5E9" />
                        <Text style={styles.collabKpiTxt}>{m.contacts_total}</Text>
                      </View>
                      <Text style={styles.collabAgo}>· {timeAgo(m.last_active_at)}</Text>
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color="#94A3B8" />
                </Pressable>
              ))
            )}
          </View>

          {data?.generated_at && (
            <Text style={styles.generatedAt}>Aggiornato {timeAgo(data.generated_at)}</Text>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function MiniKpi({
  n,
  lbl,
  icon,
  color,
  sub,
  onPress,
}: {
  n: number;
  lbl: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  sub?: string;
  onPress?: () => void;
}) {
  const inner = (
    <View style={styles.kpiBox}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Ionicons name={icon} size={16} color={color} />
        <Text style={[styles.kpiN, { color }]}>{n}</Text>
      </View>
      <Text style={styles.kpiLbl}>{lbl}</Text>
      {sub ? <Text style={styles.kpiSub}>{sub}</Text> : null}
    </View>
  );
  if (onPress) {
    return <Pressable onPress={onPress} style={{ flex: 1 }}>{inner}</Pressable>;
  }
  return <View style={{ flex: 1 }}>{inner}</View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: "#0F172A",
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  reloadBtn: {
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
    padding: 40,
  },
  emptyTitle: { fontSize: 15, fontWeight: "700", color: "#334155", marginTop: 8 },

  alertCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
    backgroundColor: "#FFF7ED",
    borderColor: "#FED7AA",
    borderWidth: 1,
    borderRadius: 14,
  },
  alertIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#FFEDD5",
    alignItems: "center",
    justifyContent: "center",
  },
  alertTitle: { fontSize: 14, fontWeight: "800", color: "#9A3412" },
  alertSub: { fontSize: 11, color: "#78350F", marginTop: 2 },

  panel: {
    backgroundColor: "#FFF",
    borderRadius: 14,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: "#EEF2F7",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  panelHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  panelTitle: { fontSize: 14, fontWeight: "800", color: "#0F172A" },
  panelSub: { fontSize: 10, color: "#94A3B8", fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.3 },
  viewAll: { fontSize: 11, color: "#0EA5E9", fontWeight: "800" },

  feedbackGrid: { flexDirection: "row", gap: 8 },
  fbCell: {
    flex: 1,
    padding: 10,
    borderRadius: 12,
    backgroundColor: "#F8FAFC",
    alignItems: "center",
    gap: 4,
  },
  fbBigN: { fontSize: 26, fontWeight: "800", letterSpacing: -1 },
  fbLbl: { fontSize: 10, color: "#64748B", fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.3 },
  satBar: {
    height: 6,
    backgroundColor: "#FEE2E2",
    borderRadius: 3,
    overflow: "hidden",
  },
  satBarFill: {
    height: "100%",
    backgroundColor: "#16A34A",
  },

  kpiRow: { flexDirection: "row", gap: 8 },
  kpiBox: {
    padding: 10,
    borderRadius: 12,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#EEF2F7",
    gap: 4,
  },
  kpiN: { fontSize: 20, fontWeight: "800", letterSpacing: -0.5 },
  kpiLbl: { fontSize: 10, color: "#64748B", fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.3 },
  kpiSub: { fontSize: 9, color: "#94A3B8", marginTop: 1 },

  acceptedBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    padding: 8,
    borderRadius: 8,
    backgroundColor: "#DCFCE7",
  },
  acceptedTxt: { fontSize: 11, color: "#166534", fontWeight: "700" },

  collabRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
  },
  collabAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#16A34A",
    alignItems: "center",
    justifyContent: "center",
  },
  collabAvatarTxt: { color: "#FFF", fontWeight: "800", fontSize: 12, letterSpacing: -0.3 },
  collabName: { fontSize: 13, fontWeight: "700", color: "#0F172A" },
  collabKpiRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 3 },
  collabKpi: { flexDirection: "row", alignItems: "center", gap: 2 },
  collabKpiTxt: { fontSize: 10, color: "#0F172A", fontWeight: "700" },
  collabAgo: { fontSize: 9, color: "#94A3B8", fontWeight: "600" },

  generatedAt: { fontSize: 10, color: "#94A3B8", textAlign: "center", marginTop: 4 },
});

// Corporate Gym — Blocco 4: dashboard statistiche (solo Master/Admin).
import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, RefreshControl, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { LineChart, BarChart } from "react-native-chart-kit";
import { useAuth } from "@/src/auth";
import { notify } from "@/src/utils/notify";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { cgymStatsApi, CgymStats, CgymAgentStats, CgymAgentFeedback, CgymWeeklyReport, CgymAiReport, CGYM_ORANGE } from "@/src/corporate-gym/api";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

const RANGES = [7, 30, 90];

function chartConfig(color: string) {
  return {
    backgroundColor: HT.card,
    backgroundGradientFrom: "#FFFFFF",
    backgroundGradientTo: "#FFFFFF",
    decimalPlaces: 0,
    color: (opacity = 1) => `${color}${Math.round(opacity * 255).toString(16).padStart(2, "0")}`,
    labelColor: () => HT.text2,
    propsForBackgroundLines: { stroke: "#E5E7EB", strokeDasharray: "3,4" },
    propsForDots: { r: "4", strokeWidth: "2", stroke: "#FFF" },
    barPercentage: 0.6,
  };
}

function scoreColor(s: number | null) {
  if (s == null) return HT.muted;
  return s >= 75 ? HT.success : s >= 50 ? CGYM_ORANGE : HT.danger;
}

function fmtDate(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function CgymStatsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const pagePad = usePageBottomPadding();
  const { width } = useWindowDimensions();
  const chartW = Math.min(width, 520) - 28 - 24;
  const isAdmin = !!user && (user.role === "admin" || (user.role === "owner" && !user.parent_user_id));

  const [days, setDays] = useState(30);
  const [stats, setStats] = useState<CgymStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selAgent, setSelAgent] = useState<string | null>(null);
  const [weekly, setWeekly] = useState<CgymAiReport<CgymWeeklyReport> | null>(null);
  const [weeklyBusy, setWeeklyBusy] = useState(false);
  const [feedbacks, setFeedbacks] = useState<Record<string, CgymAiReport<CgymAgentFeedback>>>({});
  const [fbBusy, setFbBusy] = useState<string | null>(null);
  const [openAgent, setOpenAgent] = useState<string | null>(null);

  const load = useCallback(async (d = days) => {
    try {
      const s = await cgymStatsApi.stats(d);
      setStats(s);
      cgymStatsApi.weeklyGet().then(setWeekly).catch(() => {});
    } catch (e: any) {
      notify("Statistiche", e?.message || "Errore di caricamento");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [days]);
  useFocusEffect(useCallback(() => { if (isAdmin) load(); else if (user) router.replace("/corporate-gym" as any); }, [load, isAdmin, user, router]));

  const changeRange = (d: number) => { setDays(d); setLoading(true); load(d); };

  const genWeekly = async (force: boolean) => {
    if (weeklyBusy) return;
    setWeeklyBusy(true);
    try { setWeekly(await cgymStatsApi.weekly(force)); }
    catch (e: any) { notify("Report", e?.message || "Errore"); }
    finally { setWeeklyBusy(false); }
  };
  const genFeedback = async (a: CgymAgentStats, force: boolean) => {
    if (fbBusy) return;
    setFbBusy(a.user_id);
    try {
      const r = await cgymStatsApi.agentFeedback(a.user_id, force);
      setFeedbacks((prev) => ({ ...prev, [a.user_id]: r }));
      setOpenAgent(a.user_id);
    } catch (e: any) { notify("Feedback", e?.message || "Errore"); }
    finally { setFbBusy(null); }
  };
  const toggleAgent = async (a: CgymAgentStats) => {
    const next = openAgent === a.user_id ? null : a.user_id;
    setOpenAgent(next);
    if (next && !feedbacks[a.user_id]) {
      cgymStatsApi.agentFeedbackGet(a.user_id).then((r) => { if (r?.content) setFeedbacks((p) => ({ ...p, [a.user_id]: r })); }).catch(() => {});
    }
  };

  const scored = useMemo(() => (stats?.agents || []).filter((a) => a.avg_score != null), [stats]);
  const selected = useMemo(() => scored.find((a) => a.user_id === selAgent) || null, [scored, selAgent]);

  // Serie "score nel tempo": agente selezionato (timeline) oppure media team per settimana
  const lineData = useMemo(() => {
    if (selected && selected.timeline.length) {
      const pts = selected.timeline.slice(-10);
      return { labels: pts.map((p) => p.date), datasets: [{ data: pts.map((p) => p.score) }], title: `Score di ${selected.name}` };
    }
    const w = stats?.team.weekly || [];
    if (!w.length) return null;
    return { labels: w.map((x) => x.week.replace(/^\d{4}-/, "")), datasets: [{ data: w.map((x) => x.avg) }], title: "Media team per settimana" };
  }, [selected, stats]);

  const barData = useMemo(() => {
    if (scored.length < 1) return null;
    const top = scored.slice(0, 6);
    return { labels: top.map((a) => a.name.split(" ")[0].slice(0, 8)), datasets: [{ data: top.map((a) => a.avg_score || 0) }] };
  }, [scored]);

  const t = stats?.team;

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable testID="cgym-stats-back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/corporate-gym" as any))} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={HT.text} />
        </Pressable>
        <Text style={styles.title}>Statistiche team</Text>
        <View style={{ width: 26 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: pagePad }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
        <View style={styles.segment}>
          {RANGES.map((d) => (
            <Pressable key={d} onPress={() => changeRange(d)} style={[styles.segBtn, days === d && styles.segBtnOn]} testID={`cgym-stats-range-${d}`}>
              <Text style={[styles.segTxt, days === d && styles.segTxtOn]}>{d} giorni</Text>
            </Pressable>
          ))}
        </View>

        {loading || !stats || !t ? (
          <ActivityIndicator color={CGYM_ORANGE} style={{ marginVertical: 30 }} />
        ) : (
          <>
            {/* KPI team */}
            <View style={styles.kpiRow} testID="cgym-stats-kpi">
              <View style={styles.kpi}><Text style={[styles.kpiNum, { color: scoreColor(t.avg_score) }]}>{t.avg_score ?? "—"}</Text><Text style={styles.kpiLbl}>Media score</Text></View>
              <View style={styles.kpi}><Text style={styles.kpiNum}>{t.assigned_done}/{t.assigned_total}</Text><Text style={styles.kpiLbl}>Assegnate completate</Text></View>
              <View style={styles.kpi}><Text style={styles.kpiNum}>{t.completed_total}</Text><Text style={styles.kpiLbl}>Sessioni completate</Text></View>
              <View style={styles.kpi}><Text style={[styles.kpiNum, t.overdue > 0 && { color: HT.danger }]}>{t.overdue}</Text><Text style={styles.kpiLbl}>In ritardo</Text></View>
            </View>
            {t.assigned_total > 0 && (
              <View style={styles.barBg}><View style={[styles.barFill, { width: `${Math.round((t.assigned_done / t.assigned_total) * 100)}%` }]} /></View>
            )}

            {/* Score nel tempo */}
            <View style={styles.card} testID="cgym-stats-line">
              <Text style={styles.cardTitle}>{lineData?.title || "Score nel tempo"}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 6 }}>
                <Pressable onPress={() => setSelAgent(null)} style={[styles.chip, !selAgent && styles.chipOn]} testID="cgym-stats-agent-team"><Text style={[styles.chipTxt, !selAgent && { color: "#FFF" }]}>Team</Text></Pressable>
                {scored.map((a) => (
                  <Pressable key={a.user_id} onPress={() => setSelAgent(a.user_id)} style={[styles.chip, selAgent === a.user_id && styles.chipOn]} testID={`cgym-stats-agent-${a.user_id}`}>
                    <Text style={[styles.chipTxt, selAgent === a.user_id && { color: "#FFF" }]}>{a.name.split(" ")[0]}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              {lineData ? (
                <LineChart data={lineData} width={chartW} height={180} chartConfig={chartConfig(HT.brand)} bezier fromZero withInnerLines segments={4} style={{ borderRadius: 12, marginLeft: -8 }} />
              ) : (
                <Text style={styles.emptyTxt}>Ancora nessuno score nel periodo</Text>
              )}
            </View>

            {/* Confronto agenti */}
            <View style={styles.card} testID="cgym-stats-bar">
              <Text style={styles.cardTitle}>Confronto tra agenti (media score)</Text>
              {barData ? (
                <BarChart data={barData} width={chartW} height={180} yAxisLabel="" yAxisSuffix="" chartConfig={chartConfig(CGYM_ORANGE)} fromZero showValuesOnTopOfBars style={{ borderRadius: 12, marginLeft: -8 }} />
              ) : (
                <Text style={styles.emptyTxt}>Nessun agente con sessioni valutate</Text>
              )}
              <View style={{ flexDirection: "row", gap: 12, marginTop: 6, flexWrap: "wrap" }}>
                <View style={{ flex: 1, minWidth: 140 }}>
                  <Text style={[styles.miniHead, { color: HT.success }]}>Forze del team</Text>
                  {t.strengths.length ? t.strengths.map((c) => <Text key={c.key} style={styles.miniTxt}>• {c.label} <Text style={styles.miniN}>×{c.count}</Text></Text>) : <Text style={styles.miniTxt}>—</Text>}
                </View>
                <View style={{ flex: 1, minWidth: 140 }}>
                  <Text style={[styles.miniHead, { color: CGYM_ORANGE }]}>Lacune del team</Text>
                  {t.weaknesses.length ? t.weaknesses.map((c) => <Text key={c.key} style={styles.miniTxt}>• {c.label} <Text style={styles.miniN}>×{c.count}</Text></Text>) : <Text style={styles.miniTxt}>—</Text>}
                </View>
              </View>
            </View>

            {/* Report settimanale AxonOS */}
            <View style={[styles.card, { borderColor: CGYM_ORANGE + "66" }]} testID="cgym-stats-weekly">
              <View style={styles.rowBetween}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                  <Ionicons name="sparkles" size={18} color={CGYM_ORANGE} />
                  <Text style={styles.cardTitle}>Report settimanale AxonOS</Text>
                </View>
                <Pressable onPress={() => genWeekly(!!weekly?.content)} disabled={weeklyBusy} style={styles.genBtn} testID="cgym-stats-weekly-gen">
                  {weeklyBusy ? <ActivityIndicator color="#FFF" size="small" /> : (<><Ionicons name={weekly?.content ? "refresh" : "flash"} size={14} color="#FFF" /><Text style={styles.genTxt}>{weekly?.content ? "Rigenera" : "Genera"}</Text></>)}
                </Pressable>
              </View>
              {weekly?.content ? (
                <View style={{ gap: 10, marginTop: 8 }}>
                  <Text style={styles.headline}>{weekly.content.headline}</Text>
                  <Text style={styles.meta}>Settimana {weekly.week} · {fmtDate(weekly.generated_at)}</Text>
                  <Section title="Lacune del team" icon="alert-circle" color={CGYM_ORANGE} items={weekly.content.team_gaps} />
                  <Section title="Cosa va bene" icon="thumbs-up" color={HT.success} items={weekly.content.highlights} />
                  <Section title="Agenti da seguire" icon="eye" color={HT.brand} items={weekly.content.agents_to_watch} />
                  {!!weekly.content.new_scenarios?.length && (
                    <View>
                      <Text style={[styles.miniHead, { color: HT.brand }]}>Nuovi scenari proposti</Text>
                      {weekly.content.new_scenarios.map((s, i) => (
                        <View key={i} style={styles.scenario}>
                          <Text style={styles.scenarioTitle}>{s.title}</Text>
                          <Text style={styles.miniTxt}>Obiezione: {s.objection}</Text>
                          <Text style={styles.miniTxtMuted}>{s.why}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                  <Section title="Aggiornamenti al manuale vendite" icon="book" color={HT.text} items={weekly.content.manual_updates} />
                  {!!weekly.content.next_week_plan && (
                    <View style={styles.planBox}><Ionicons name="calendar" size={14} color={HT.brand} /><Text style={styles.planTxt}>{weekly.content.next_week_plan}</Text></View>
                  )}
                </View>
              ) : (
                <Text style={styles.emptyTxt}>Genera il report: AxonOS analizza le sessioni della settimana e propone lacune, scenari e aggiornamenti al manuale.</Text>
              )}
            </View>

            {/* Agenti */}
            <Text style={styles.sectionTitle}>Agenti</Text>
            {stats.agents.map((a) => {
              const fb = feedbacks[a.user_id];
              const open = openAgent === a.user_id;
              return (
                <View key={a.user_id} style={styles.agent} testID={`cgym-stats-agentcard-${a.user_id}`}>
                  <Pressable style={styles.rowBetween} onPress={() => toggleAgent(a)} testID={`cgym-stats-agent-toggle-${a.user_id}`}>
                    <View style={[styles.rankBadge, { backgroundColor: a.rank === 1 && a.avg_score != null ? "#EAB308" : HT.card2 }]}>
                      <Text style={[styles.rankTxt, a.rank === 1 && a.avg_score != null && { color: "#FFF" }]}>{a.rank}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.agentName} numberOfLines={1}>{a.name}{a.user_id === user?.user_id ? " (io)" : ""}</Text>
                      <Text style={styles.agentSub}>
                        {a.completed_total} completate · assegnate {a.assigned_done}/{a.assigned_total}{a.overdue ? ` · ${a.overdue} in ritardo` : ""} · {a.roleplays} role-play
                      </Text>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={[styles.agentScore, { color: scoreColor(a.avg_score) }]}>{a.avg_score ?? "—"}</Text>
                      {a.trend != null && (
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                          <Ionicons name={a.trend > 0 ? "trending-up" : a.trend < 0 ? "trending-down" : "remove"} size={12} color={a.trend > 0 ? HT.success : a.trend < 0 ? HT.danger : HT.muted} />
                          <Text style={[styles.trendTxt, { color: a.trend > 0 ? HT.success : a.trend < 0 ? HT.danger : HT.muted }]}>{a.trend > 0 ? "+" : ""}{a.trend}</Text>
                        </View>
                      )}
                    </View>
                    <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color={HT.muted} />
                  </Pressable>
                  {(a.strengths.length > 0 || a.weaknesses.length > 0) && (
                    <View style={styles.tagRow}>
                      {a.strengths.map((c) => <View key={"s" + c.key} style={[styles.tag, { backgroundColor: HT.success + "22" }]}><Ionicons name="arrow-up" size={10} color={HT.success} /><Text style={[styles.tagTxt, { color: HT.success }]}>{c.label}</Text></View>)}
                      {a.weaknesses.map((c) => <View key={"w" + c.key} style={[styles.tag, { backgroundColor: CGYM_ORANGE + "22" }]}><Ionicons name="arrow-down" size={10} color={CGYM_ORANGE} /><Text style={[styles.tagTxt, { color: CGYM_ORANGE }]}>{c.label}</Text></View>)}
                    </View>
                  )}
                  {open && (
                    <View style={{ marginTop: 10, gap: 8 }}>
                      <View style={styles.rowBetween}>
                        <Text style={[styles.miniHead, { color: CGYM_ORANGE }]}>Feedback personale AxonOS</Text>
                        <Pressable onPress={() => genFeedback(a, !!fb?.content)} disabled={fbBusy === a.user_id} style={styles.genBtn} testID={`cgym-stats-fb-gen-${a.user_id}`}>
                          {fbBusy === a.user_id ? <ActivityIndicator color="#FFF" size="small" /> : (<><Ionicons name={fb?.content ? "refresh" : "flash"} size={14} color="#FFF" /><Text style={styles.genTxt}>{fb?.content ? "Rigenera" : "Genera"}</Text></>)}
                        </Pressable>
                      </View>
                      {fb?.content ? (
                        <View style={{ gap: 8 }} testID={`cgym-stats-fb-${a.user_id}`}>
                          <Text style={styles.meta}>{fmtDate(fb.generated_at)}</Text>
                          {!!fb.content.character && (<View style={styles.charBox}><Ionicons name="person" size={14} color={HT.brand} /><Text style={styles.charTxt}>{fb.content.character}</Text></View>)}
                          <Section title="Dove migliorare" icon="arrow-up-circle" color={CGYM_ORANGE} items={fb.content.where_to_improve} />
                          <Section title="Azioni correttive" icon="construct" color={HT.brand} items={fb.content.corrective_actions} />
                          <Section title="Punti di forza" icon="checkmark-circle" color={HT.success} items={fb.content.strengths} />
                          {!!fb.content.encouragement && (<View style={styles.encBox}><Ionicons name="heart" size={14} color={HT.success} /><Text style={styles.encTxt}>{fb.content.encouragement}</Text></View>)}
                        </View>
                      ) : (
                        <Text style={styles.emptyTxt}>{a.completed_total > 0 ? "Genera il feedback personale: dove migliorare, azioni correttive, punti di forza e incoraggiamento." : "Nessuna sessione completata nel periodo: assegna sessioni per ottenere un feedback."}</Text>
                      )}
                    </View>
                  )}
                </View>
              );
            })}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, icon, color, items }: { title: string; icon: any; color: string; items?: string[] }) {
  if (!items || !items.length) return null;
  return (
    <View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <Ionicons name={icon} size={14} color={color} />
        <Text style={[styles.miniHead, { color }]}>{title}</Text>
      </View>
      {items.map((t, i) => <Text key={i} style={styles.miniTxt}>• {t}</Text>)}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: HT.card2 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: HT.border, backgroundColor: HT.card2 },
  title: { fontSize: 18, fontWeight: "800", color: HT.text },
  segment: { flexDirection: "row", backgroundColor: HT.card2, borderRadius: 999, padding: 3, marginBottom: 12 },
  segBtn: { flex: 1, paddingVertical: 8, borderRadius: 999, alignItems: "center", minHeight: 36 },
  segBtnOn: { backgroundColor: HT.card2 },
  segTxt: { fontSize: 12, fontWeight: "700", color: HT.muted },
  segTxtOn: { color: HT.text },
  kpiRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  kpi: { flexBasis: "47%", flexGrow: 1, backgroundColor: HT.card2, borderRadius: 14, borderWidth: 1, borderColor: HT.border, padding: 12, alignItems: "center" },
  kpiNum: { fontSize: 22, fontWeight: "900", color: HT.text },
  kpiLbl: { fontSize: 11, color: HT.muted, fontWeight: "700", marginTop: 2, textAlign: "center" },
  barBg: { height: 6, borderRadius: 3, backgroundColor: HT.card2, marginTop: 8, overflow: "hidden" },
  barFill: { height: 6, borderRadius: 3, backgroundColor: HT.brand },
  card: { backgroundColor: HT.card2, borderRadius: 16, borderWidth: 1, borderColor: HT.border, padding: 12, marginTop: 12 },
  cardTitle: { fontSize: 14, fontWeight: "800", color: HT.text },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: HT.border, backgroundColor: HT.card2, minHeight: 32, justifyContent: "center" },
  chipOn: { backgroundColor: HT.brand, borderColor: HT.brand },
  chipTxt: { fontSize: 12, fontWeight: "700", color: HT.text },
  emptyTxt: { fontSize: 12, color: HT.muted, paddingVertical: 8, lineHeight: 17 },
  miniHead: { fontSize: 12, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 2 },
  miniTxt: { fontSize: 13, color: HT.text, lineHeight: 19 },
  miniTxtMuted: { fontSize: 12, color: HT.muted, lineHeight: 17 },
  miniN: { color: HT.muted, fontWeight: "800" },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  genBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: CGYM_ORANGE, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, minHeight: 36 },
  genTxt: { color: "#FFF", fontWeight: "800", fontSize: 12 },
  headline: { fontSize: 15, fontWeight: "800", color: HT.text, lineHeight: 21 },
  meta: { fontSize: 11, color: HT.muted },
  scenario: { backgroundColor: HT.card2, borderRadius: 10, padding: 10, marginTop: 6, borderWidth: 1, borderColor: HT.border },
  scenarioTitle: { fontSize: 13, fontWeight: "800", color: HT.text },
  planBox: { flexDirection: "row", gap: 8, backgroundColor: HT.brandTint, borderRadius: 10, padding: 10 },
  planTxt: { flex: 1, fontSize: 13, color: HT.brand, fontWeight: "700", lineHeight: 19 },
  sectionTitle: { fontSize: 16, fontWeight: "800", color: HT.text, marginTop: 18, marginBottom: 8 },
  agent: { backgroundColor: HT.card2, borderRadius: 14, borderWidth: 1, borderColor: HT.border, padding: 12, marginBottom: 10 },
  rankBadge: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  rankTxt: { fontSize: 13, fontWeight: "900", color: HT.text },
  agentName: { fontSize: 14, fontWeight: "800", color: HT.text },
  agentSub: { fontSize: 11, color: HT.muted, marginTop: 2 },
  agentScore: { fontSize: 20, fontWeight: "900" },
  trendTxt: { fontSize: 11, fontWeight: "800" },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  tag: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  tagTxt: { fontSize: 11, fontWeight: "800" },
  charBox: { flexDirection: "row", gap: 8, backgroundColor: HT.brandTint, borderRadius: 10, padding: 10 },
  charTxt: { flex: 1, fontSize: 13, color: HT.brand, fontWeight: "600", lineHeight: 19, fontStyle: "italic" },
  encBox: { flexDirection: "row", gap: 8, backgroundColor: HT.success + "18", borderRadius: 10, padding: 10 },
  encTxt: { flex: 1, fontSize: 13, color: HT.text, lineHeight: 19 },
});

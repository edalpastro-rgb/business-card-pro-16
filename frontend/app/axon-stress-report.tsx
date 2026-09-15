// V50.z260 — Report Stress Test Axon (Profilo → Strumenti di sviluppo)
// Avvia/segue lo stress test (200+ domande × N ripetizioni), mostra contatori, lista filtrabile
// (Passati / Falliti / Incoerenti), dettaglio fallimenti con correzione suggerita e «Applica correzione»,
// «Esporta PDF» in alto.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Platform } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { useInsetsSafe } from "@/src/hooks/useSafeBottom";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { theme } from "@/src/theme";

const NAVY = "#1B2B4B"; const VIOLET = "#7C3AED";
type Rep = { rep: number; reply: string; ok: boolean; routes: string[]; actions: string[]; reason: string };
type Item = { id: string; category: string; question: string; expected: string[]; flag: string; reps: Rep[]; outcome: "passed" | "failed" | "inconsistent" | "skipped" | null; correction?: { expected_text: string; rule: string } | null; correction_applied?: boolean };
type Summary = { tested: number; passed: number; failed: number; inconsistent: number; pct_passed: number; pct_failed: number; pct_inconsistent: number };
type RunHead = { run_id: string; status: "running" | "done" | "stopped" | "error"; reps: number; total: number; done: number; created_at: string; summary?: Summary | null; error?: string | null };
type Filter = "all" | "passed" | "failed" | "inconsistent";

const OUT_LABEL: Record<string, { t: string; c: string; bg: string }> = {
  passed: { t: "Passato", c: "#166534", bg: "#DCFCE7" },
  failed: { t: "Fallito", c: "#991B1B", bg: "#FEE2E2" },
  inconsistent: { t: "Incoerente", c: "#92400E", bg: "#FEF3C7" },
  skipped: { t: "Non testato", c: "#374151", bg: "#F3F4F6" },
};

export default function AxonStressReportScreen() {
  const router = useRouter();
  const insets = useInsetsSafe();
  const navPad = usePageBottomPadding(8);
  const [runs, setRuns] = useState<RunHead[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<(RunHead & { items: Item[] }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [totalQuestions, setTotalQuestions] = useState<number>(0);
  const pollRef = useRef<any>(null);

  const loadRuns = useCallback(async () => {
    try {
      const r = await api<{ runs: RunHead[] }>("/axon/stress/runs");
      setRuns(r.runs || []);
      if (!runId && r.runs?.length) setRunId(r.runs[0].run_id);
    } catch (e: any) { notify("Stress test", e?.message || "Errore"); }
    finally { setLoading(false); }
  }, [runId]);

  const loadRun = useCallback(async (id: string) => {
    try { setRun(await api(`/axon/stress/runs/${id}`)); } catch { /* ignore */ }
  }, []);

  useEffect(() => { void loadRuns(); api<{ total: number }>("/axon/stress/questions").then((r) => setTotalQuestions(r.total)).catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (runId) void loadRun(runId); }, [runId, loadRun]);
  // Polling finché il run è in corso
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (run?.status === "running" && runId) {
      pollRef.current = setInterval(() => { void loadRun(runId); void loadRuns(); }, 4000);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [run?.status, runId, loadRun, loadRuns]);

  const start = async (reps: number, limit?: number) => {
    setStarting(true);
    try {
      const r = await api<{ run_id: string }>("/axon/stress/run", { method: "POST", body: { reps, limit } });
      setRunId(r.run_id); setFilter("all"); setOpenId(null);
      await loadRuns();
    } catch (e: any) { notify("Stress test", e?.message || "Impossibile avviare"); }
    finally { setStarting(false); }
  };
  const stop = async () => { if (!runId) return; try { await api(`/axon/stress/runs/${runId}/stop`, { method: "POST" }); await loadRun(runId); await loadRuns(); } catch (e: any) { notify("Stress test", e?.message || "Errore"); } };

  const applyCorrection = async (it: Item) => {
    if (!runId) return;
    setApplying(it.id);
    try {
      await api("/axon/stress/corrections/apply", { method: "POST", body: { run_id: runId, question_id: it.id } });
      setRun((prev) => prev ? { ...prev, items: prev.items.map((x) => x.id === it.id ? { ...x, correction_applied: true } : x) } : prev);
      notify("Correzione applicata", "Axon userà subito questa regola.");
    } catch (e: any) { notify("Correzione", e?.message || "Errore"); }
    finally { setApplying(null); }
  };

  const exportPdf = async () => {
    if (!runId) return;
    setPdfBusy(true);
    try {
      const { html } = await api<{ html: string }>(`/axon/stress/runs/${runId}/report-html`);
      if (Platform.OS === "web") { await Print.printAsync({ html }); return; }
      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: "Report Stress Test Axon" });
      else notify("PDF creato", uri);
    } catch (e: any) { notify("PDF", e?.message || "Impossibile generare il PDF"); }
    finally { setPdfBusy(false); }
  };

  const items = useMemo(() => (run?.items || []).filter((it) => filter === "all" ? true : it.outcome === filter), [run, filter]);
  const s = run?.summary;
  const live = useMemo(() => {
    // contatori provvisori mentre il run è in corso
    const its = run?.items || [];
    const c = { passed: 0, failed: 0, inconsistent: 0 };
    its.forEach((it) => { if (it.outcome && it.outcome in c) (c as any)[it.outcome] += 1; });
    const tested = c.passed + c.failed + c.inconsistent;
    const pct = (n: number) => (tested ? Math.round((1000 * n) / tested) / 10 : 0);
    return { tested, ...c, pct_passed: pct(c.passed), pct_failed: pct(c.failed), pct_inconsistent: pct(c.inconsistent) } as Summary;
  }, [run]);
  const S = s || live;
  const progress = run && run.total ? Math.min(1, (run.done || 0) / run.total) : 0;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="stress-root">
      <View style={styles.header}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/impostazioni" as any))} hitSlop={10} testID="stress-back"><Ionicons name="arrow-back" size={22} color="#FFF" /></Pressable>
        <View style={{ flex: 1 }}><Text style={styles.title}>🧪 Stress Test Axon</Text><Text style={styles.sub}>{totalQuestions} domande · qualità risposte e deep link</Text></View>
        <Pressable onPress={exportPdf} disabled={!run || pdfBusy} hitSlop={8} style={[styles.headBtn, (!run || pdfBusy) && { opacity: 0.5 }]} testID="stress-export-pdf">
          {pdfBusy ? <ActivityIndicator size="small" color="#FFF" /> : <Ionicons name="document-text" size={16} color="#FFF" />}
          <Text style={styles.headBtnTxt}>Esporta PDF</Text>
        </Pressable>
      </View>

      {loading ? <ActivityIndicator style={{ marginTop: 40 }} color={VIOLET} /> : (
        <ScrollView contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: navPad + 70 }}>
          {/* Controlli run */}
          <View style={styles.card} testID="stress-controls">
            {run?.status === "running" ? (
              <>
                <View style={styles.rowBetween}>
                  <Text style={styles.cardTitle}>Test in corso… {run.done}/{run.total}</Text>
                  <Pressable onPress={stop} style={styles.stopBtn} testID="stress-stop"><Ionicons name="stop" size={14} color="#FFF" /><Text style={styles.stopTxt}>Ferma</Text></Pressable>
                </View>
                <View style={styles.barBg}><View style={[styles.barFg, { width: `${Math.round(progress * 100)}%` as any }]} /></View>
                <Text style={styles.hint}>Ripetizione {Math.min(run.reps, Math.floor((run.done || 0) / Math.max(1, run.total / run.reps)) + 1)} di {run.reps} · ogni domanda viene posta in sessioni separate e momenti diversi.</Text>
              </>
            ) : (
              <>
                <Text style={styles.cardTitle}>Avvia uno stress test</Text>
                <Text style={styles.hint}>Il test completo pone {totalQuestions} domande × 5 ripetizioni ad Axon (richiede tempo e crediti LLM). Il test rapido usa 30 domande × 1 ripetizione.</Text>
                <View style={styles.rowWrap}>
                  <Pressable onPress={() => start(5)} disabled={starting} style={styles.primaryBtn} testID="stress-start-full"><Ionicons name="play" size={14} color="#FFF" /><Text style={styles.primaryTxt}>Test completo (×5)</Text></Pressable>
                  <Pressable onPress={() => start(1, 30)} disabled={starting} style={styles.secondaryBtn} testID="stress-start-quick"><Ionicons name="flash" size={14} color={VIOLET} /><Text style={styles.secondaryTxt}>Test rapido</Text></Pressable>
                </View>
                {runs.length > 1 && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingTop: 6 }}>
                    {runs.map((r) => (
                      <Pressable key={r.run_id} onPress={() => { setRunId(r.run_id); setFilter("all"); }} style={[styles.chip, r.run_id === runId && styles.chipOn]} testID={`stress-run-${r.run_id}`}>
                        <Text style={[styles.chipTxt, r.run_id === runId && styles.chipTxtOn]}>{new Date(r.created_at).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · ×{r.reps}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                )}
              </>
            )}
          </View>

          {run && (
            <>
              {/* Contatori */}
              <View style={styles.kpiRow} testID="stress-kpis">
                <View style={styles.kpi}><Text style={styles.kpiN}>{S.tested}</Text><Text style={styles.kpiL}>Domande testate</Text></View>
                <View style={[styles.kpi, { borderColor: "#86EFAC" }]}><Text style={[styles.kpiN, { color: "#166534" }]}>{S.pct_passed}%</Text><Text style={styles.kpiL}>Corrette</Text></View>
                <View style={[styles.kpi, { borderColor: "#FCA5A5" }]}><Text style={[styles.kpiN, { color: "#991B1B" }]}>{S.pct_failed}%</Text><Text style={styles.kpiL}>Fallite</Text></View>
                <View style={[styles.kpi, { borderColor: "#FCD34D" }]}><Text style={[styles.kpiN, { color: "#92400E" }]}>{S.pct_inconsistent}%</Text><Text style={styles.kpiL}>Incoerenti</Text></View>
              </View>

              {/* Filtri */}
              <View style={styles.rowWrap} testID="stress-filters">
                {(["all", "passed", "failed", "inconsistent"] as Filter[]).map((f) => {
                  const n = f === "all" ? S.tested : (S as any)[f];
                  return (
                    <Pressable key={f} onPress={() => setFilter(f)} style={[styles.chip, filter === f && styles.chipOn]} testID={`stress-filter-${f}`}>
                      <Text style={[styles.chipTxt, filter === f && styles.chipTxtOn]}>{f === "all" ? "Tutti" : OUT_LABEL[f].t} ({n})</Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Lista */}
              {items.length === 0 ? <Text style={styles.hint}>Nessuna domanda in questa categoria{run.status === "running" ? " (ancora)" : ""}.</Text> : items.map((it) => {
                const o = it.outcome ? OUT_LABEL[it.outcome] : null;
                const open = openId === it.id;
                const okCount = it.reps.filter((r) => r.ok).length;
                return (
                  <View key={it.id} style={styles.item} testID={`stress-item-${it.id}`}>
                    <Pressable onPress={() => setOpenId(open ? null : it.id)} style={styles.itemHead} testID={`stress-item-toggle-${it.id}`}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.itemQ}>{it.question}</Text>
                        <Text style={styles.itemMeta}>{it.category}{it.flag ? ` · ${it.flag}` : ""} · {okCount}/{it.reps.length} ok</Text>
                      </View>
                      {o && <View style={[styles.badge, { backgroundColor: o.bg }]}><Text style={[styles.badgeTxt, { color: o.c }]}>{o.t}</Text></View>}
                      <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color={theme.color.muted} />
                    </Pressable>
                    {open && (
                      <View style={styles.itemBody}>
                        {it.reps.map((r) => (
                          <View key={r.rep} style={styles.rep}>
                            <Text style={styles.repHead}>{r.ok ? "✅" : "❌"} Ripetizione {r.rep}{r.reason ? ` — ${r.reason}` : ""}</Text>
                            <Text style={styles.repTxt} numberOfLines={8}>{r.reply.replace(/\[\[(NAV|ACTION):[^\]]*\]\]/g, "").trim() || "(vuota)"}</Text>
                            {r.routes.length > 0 && <Text style={styles.repLinks}>Link: {r.routes.join("  ")}</Text>}
                            {r.actions.length > 0 && <Text style={styles.repLinks}>Azioni: {r.actions.join(", ")}</Text>}
                          </View>
                        ))}
                        {it.outcome !== "passed" && it.correction && (
                          <View style={styles.corr} testID={`stress-correction-${it.id}`}>
                            <Text style={styles.corrLab}>Risposta corretta attesa</Text>
                            <Text style={styles.corrTxt}>{it.correction.expected_text}</Text>
                            <Text style={[styles.corrLab, { marginTop: 8 }]}>Correzione suggerita al prompt</Text>
                            <Text style={styles.corrTxt}>{it.correction.rule}</Text>
                            <Pressable
                              onPress={() => applyCorrection(it)}
                              disabled={!!it.correction_applied || applying === it.id}
                              style={[styles.applyBtn, it.correction_applied && { backgroundColor: "#16A34A" }]}
                              testID={`stress-apply-${it.id}`}
                            >
                              {applying === it.id ? <ActivityIndicator size="small" color="#FFF" /> : <Ionicons name={it.correction_applied ? "checkmark-circle" : "sparkles"} size={14} color="#FFF" />}
                              <Text style={styles.applyTxt}>{it.correction_applied ? "Correzione applicata" : "Applica correzione"}</Text>
                            </Pressable>
                          </View>
                        )}
                      </View>
                    )}
                  </View>
                );
              })}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: NAVY, paddingHorizontal: 14, paddingVertical: 12 },
  title: { color: "#FFF", fontWeight: "900", fontSize: 17 }, sub: { color: "#C7D2FE", fontSize: 11, marginTop: 1 },
  headBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: VIOLET, borderRadius: 999, paddingHorizontal: 12, minHeight: 36 },
  headBtnTxt: { color: "#FFF", fontWeight: "800", fontSize: 12 },
  card: { backgroundColor: "#FFF", borderRadius: 14, padding: 12, borderWidth: 1, borderColor: theme.color.border, gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: "900", color: theme.color.onSurface },
  hint: { fontSize: 12, color: theme.color.muted, lineHeight: 17 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  rowWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  primaryBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: VIOLET, borderRadius: 12, paddingHorizontal: 14, minHeight: 44 },
  primaryTxt: { color: "#FFF", fontWeight: "900", fontSize: 13 },
  secondaryBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#F5F3FF", borderWidth: 1, borderColor: "#DDD6FE", borderRadius: 12, paddingHorizontal: 14, minHeight: 44 },
  secondaryTxt: { color: VIOLET, fontWeight: "900", fontSize: 13 },
  stopBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: theme.color.error, borderRadius: 999, paddingHorizontal: 12, minHeight: 36 },
  stopTxt: { color: "#FFF", fontWeight: "800", fontSize: 12 },
  barBg: { height: 8, borderRadius: 4, backgroundColor: "#EDE9FE", overflow: "hidden" }, barFg: { height: 8, backgroundColor: VIOLET },
  kpiRow: { flexDirection: "row", gap: 8 },
  kpi: { flex: 1, backgroundColor: "#FFF", borderRadius: 12, borderWidth: 1, borderColor: theme.color.border, padding: 8, alignItems: "center" },
  kpiN: { fontSize: 18, fontWeight: "900", color: theme.color.onSurface }, kpiL: { fontSize: 9.5, color: theme.color.muted, textAlign: "center", marginTop: 2 },
  chip: { backgroundColor: "#FFF", borderWidth: 1, borderColor: theme.color.border, borderRadius: 999, paddingHorizontal: 12, minHeight: 36, justifyContent: "center" },
  chipOn: { backgroundColor: VIOLET, borderColor: VIOLET }, chipTxt: { fontSize: 12.5, fontWeight: "800", color: theme.color.onSurface }, chipTxtOn: { color: "#FFF" },
  item: { backgroundColor: "#FFF", borderRadius: 12, borderWidth: 1, borderColor: theme.color.border, overflow: "hidden" },
  itemHead: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, minHeight: 56 },
  itemQ: { fontSize: 14, fontWeight: "800", color: theme.color.onSurface }, itemMeta: { fontSize: 11, color: theme.color.muted, marginTop: 2 },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }, badgeTxt: { fontSize: 11, fontWeight: "900" },
  itemBody: { borderTopWidth: 1, borderTopColor: theme.color.divider, padding: 12, gap: 8 },
  rep: { backgroundColor: theme.color.surface, borderRadius: 10, padding: 8, gap: 3 },
  repHead: { fontSize: 12, fontWeight: "800", color: theme.color.onSurface }, repTxt: { fontSize: 12, color: theme.color.onSurfaceTertiary, lineHeight: 17 }, repLinks: { fontSize: 11, color: VIOLET, fontWeight: "700" },
  corr: { backgroundColor: "#F5F3FF", borderRadius: 10, padding: 10, gap: 3, borderWidth: 1, borderColor: "#DDD6FE" },
  corrLab: { fontSize: 10.5, fontWeight: "900", color: VIOLET, letterSpacing: 0.3 }, corrTxt: { fontSize: 12.5, color: theme.color.onSurface, lineHeight: 18 },
  applyBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: VIOLET, borderRadius: 10, minHeight: 44, marginTop: 10 },
  applyTxt: { color: "#FFF", fontWeight: "900", fontSize: 13 },
});

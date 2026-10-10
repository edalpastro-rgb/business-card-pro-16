// V50.z260 — Report Stress Test Axon (Profilo → Strumenti di sviluppo)
// Avvia/segue lo stress test (200+ domande × N ripetizioni), mostra contatori, lista filtrabile
// (Passati / Falliti / Incoerenti), dettaglio fallimenti con correzione suggerita e «Applica correzione»,
// «Esporta PDF» in alto.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Platform } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { StressScheduleCalendar } from "@/src/stress/StressScheduleCalendar"; // V50.z509
import { Ionicons } from "@expo/vector-icons";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { useInsetsSafe } from "@/src/hooks/useSafeBottom";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

const NAVY = HT.text; const VIOLET = "#7C3AED";
type Rep = { rep: number; reply: string; ok: boolean | null; routes: string[]; actions: string[]; reason: string };
type Item = { id: string; category: string; question: string; expected: string[]; flag: string; reps: Rep[]; outcome: "passed" | "failed" | "inconsistent" | "skipped" | "error" | null; correction?: { expected_text: string; rule: string } | null; correction_applied?: boolean; correction_auto?: boolean; autofix_recheck?: { ok: boolean; reason?: string } | null };
type Summary = { tested: number; passed: number; failed: number; inconsistent: number; errors?: number; pct_passed: number; pct_failed: number; pct_inconsistent: number; by_category?: Record<string, { tested: number; passed: number; failed: number; inconsistent: number }> };
type RunHead = { run_id: string; status: "running" | "done" | "stopped" | "error"; reps: number; total: number; done: number; created_at: string; summary?: Summary | null; error?: string | null; autofix?: { applied: number; reverified_ok: number; failed_before: number; pct_before?: number; new_pct: number } | null };
type Filter = "all" | "passed" | "failed" | "inconsistent" | "error";
type NightlyCfg = { enabled: boolean; hour: number; mode: "quick" | "full"; reps: number; threshold_pct: number; drop_pct: number; autofix?: boolean }; // V50.z508 autofix
type NightlyStatus = { settings: NightlyCfg; last: (RunHead & { nightly_verdict?: string; nightly_reasons?: string[]; nightly_prev_pct?: number | null }) | null; previous: RunHead | null; running: boolean };

const OUT_LABEL: Record<string, { t: string; c: string; bg: string }> = {
  passed: { t: "Passato", c: HT.success, bg: HT.successTint },
  failed: { t: "Fallito", c: HT.danger, bg: HT.dangerTint },
  inconsistent: { t: "Incoerente", c: "#FDBA74", bg: HT.warningTint },
  skipped: { t: "Non testato", c: HT.text2, bg: HT.card2 },
  error: { t: "Errore LLM", c: "#6B21A8", bg: "#F3E8FF" },
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
  // V50.z261 — Test notturno
  const { run: runParam } = useLocalSearchParams<{ run?: string }>();
  const [nightly, setNightly] = useState<NightlyStatus | null>(null);
  const [nightlySaving, setNightlySaving] = useState(false);
  const loadNightly = useCallback(async () => { try { setNightly(await api("/axon/stress/nightly")); } catch { /* ignore */ } }, []);
  const saveNightly = async (patch: Partial<NightlyCfg>) => {
    setNightlySaving(true);
    try { setNightly(await api("/axon/stress/nightly", { method: "PUT", body: patch })); }
    catch (e: any) { notify("Test notturno", e?.message || "Errore"); }
    finally { setNightlySaving(false); }
  };
  const nightlyRunNow = async () => {
    try { const r = await api<{ run_id: string }>("/axon/stress/nightly/run-now", { method: "POST" }); setRunId(r.run_id); setFilter("all"); await loadRuns(); }
    catch (e: any) { notify("Test notturno", e?.message || "Impossibile avviare"); }
  };

  const loadRuns = useCallback(async () => {
    try {
      const r = await api<{ runs: RunHead[] }>("/axon/stress/runs");
      setRuns(r.runs || []);
      if (!runId && !runParam && r.runs?.length) setRunId(r.runs[0].run_id); // V50.z508 — ?run=… dalla notifica non viene più sovrascritto dal run più recente
    } catch (e: any) { notify("Stress test", e?.message || "Errore"); }
    finally { setLoading(false); }
  }, [runId]);

  const loadRun = useCallback(async (id: string) => {
    try { setRun(await api(`/axon/stress/runs/${id}`)); } catch { /* ignore */ }
  }, []);

  useEffect(() => { if (runParam) setRunId(String(runParam)); void loadRuns(); void loadNightly(); api<{ total: number }>("/axon/stress/questions").then((r) => setTotalQuestions(r.total)).catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (runId) void loadRun(runId); }, [runId, loadRun]);
  // Polling finché il run è in corso
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (run?.status === "running" && runId) {
      pollRef.current = setInterval(() => { void loadRun(runId); void loadRuns(); void loadNightly(); }, 4000);
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
    const c = { passed: 0, failed: 0, inconsistent: 0, error: 0 };
    its.forEach((it) => { if (it.outcome && it.outcome in c) (c as any)[it.outcome] += 1; });
    const tested = c.passed + c.failed + c.inconsistent;
    const pct = (n: number) => (tested ? Math.round((1000 * n) / tested) / 10 : 0);
    return { tested, passed: c.passed, failed: c.failed, inconsistent: c.inconsistent, errors: c.error, pct_passed: pct(c.passed), pct_failed: pct(c.failed), pct_inconsistent: pct(c.inconsistent) } as Summary;
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

          {/* V50.z509 — Calendario stress test (ricorrenze) al posto della pianificazione notturna fissa */}
          <StressScheduleCalendar onRunStarted={(rid) => { setRunId(rid); setFilter("all"); void loadRuns(); }} />

          {/* V50.z261 — Test notturno automatico quotidiano (legacy: disattivato di default, resta disponibile) */}
          {nightly && (
            <View style={styles.card} testID="stress-nightly">
              <View style={styles.rowBetween}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>🌙 Test notturno quotidiano (fisso)</Text>
                  <Text style={styles.hint}>Disattivato di default: usa il Calendario qui sopra. Se lo attivi, Axon si autotesta ogni notte all'ora scelta. Soglie e autocorrezione valgono anche per i test del calendario.</Text>
                </View>
                <Pressable onPress={() => saveNightly({ enabled: !nightly.settings.enabled })} disabled={nightlySaving} style={[styles.toggle, nightly.settings.enabled && styles.toggleOn]} testID="stress-nightly-toggle" accessibilityRole="switch">
                  <View style={[styles.knob, nightly.settings.enabled && styles.knobOn]} />
                </Pressable>
              </View>
              {nightly.settings.enabled && (
                <>
                  <Text style={styles.optLab}>Ora di avvio</Text>
                  <View style={styles.rowWrap}>{[1, 2, 3, 4, 5].map((h) => <Pressable key={h} onPress={() => saveNightly({ hour: h })} style={[styles.chip, nightly.settings.hour === h && styles.chipOn]} testID={`stress-nightly-hour-${h}`}><Text style={[styles.chipTxt, nightly.settings.hour === h && styles.chipTxtOn]}>{String(h).padStart(2, "0")}:00</Text></Pressable>)}</View>
                  <Text style={styles.optLab}>Campione</Text>
                  <View style={styles.rowWrap}>
                    <Pressable onPress={() => saveNightly({ mode: "quick" })} style={[styles.chip, nightly.settings.mode === "quick" && styles.chipOn]} testID="stress-nightly-mode-quick"><Text style={[styles.chipTxt, nightly.settings.mode === "quick" && styles.chipTxtOn]}>Rapido (~57 domande, ruota)</Text></Pressable>
                    <Pressable onPress={() => saveNightly({ mode: "full" })} style={[styles.chip, nightly.settings.mode === "full" && styles.chipOn]} testID="stress-nightly-mode-full"><Text style={[styles.chipTxt, nightly.settings.mode === "full" && styles.chipTxtOn]}>Completo ({totalQuestions})</Text></Pressable>
                  </View>
                  {/* V50.z508 — Autocorrezione automatica dopo il test notturno */}
                  <Text style={styles.optLab}>Autocorrezione automatica</Text>
                  <View style={styles.rowWrap}>
                    <Pressable onPress={() => saveNightly({ autofix: true } as any)} style={[styles.chip, nightly.settings.autofix !== false && styles.chipOn]} testID="stress-nightly-autofix-on"><Text style={[styles.chipTxt, nightly.settings.autofix !== false && styles.chipTxtOn]}>Attiva: applica da sola tutte le correzioni delle domande fallite</Text></Pressable>
                    <Pressable onPress={() => saveNightly({ autofix: false } as any)} style={[styles.chip, nightly.settings.autofix === false && styles.chipOn]} testID="stress-nightly-autofix-off"><Text style={[styles.chipTxt, nightly.settings.autofix === false && styles.chipTxtOn]}>Manuale</Text></Pressable>
                  </View>
                  <Text style={styles.optLab}>Ripetizioni · Soglia minima corrette · Calo massimo</Text>
                  <View style={styles.rowWrap}>
                    {[1, 3, 5].map((r) => <Pressable key={`r${r}`} onPress={() => saveNightly({ reps: r })} style={[styles.chip, nightly.settings.reps === r && styles.chipOn]} testID={`stress-nightly-reps-${r}`}><Text style={[styles.chipTxt, nightly.settings.reps === r && styles.chipTxtOn]}>×{r}</Text></Pressable>)}
                    <View style={{ width: 8 }} />
                    {[70, 80, 85, 90].map((t) => <Pressable key={`t${t}`} onPress={() => saveNightly({ threshold_pct: t })} style={[styles.chip, nightly.settings.threshold_pct === t && styles.chipOn]} testID={`stress-nightly-thr-${t}`}><Text style={[styles.chipTxt, nightly.settings.threshold_pct === t && styles.chipTxtOn]}>≥{t}%</Text></Pressable>)}
                    <View style={{ width: 8 }} />
                    {[5, 10, 20].map((d) => <Pressable key={`d${d}`} onPress={() => saveNightly({ drop_pct: d })} style={[styles.chip, nightly.settings.drop_pct === d && styles.chipOn]} testID={`stress-nightly-drop-${d}`}><Text style={[styles.chipTxt, nightly.settings.drop_pct === d && styles.chipTxtOn]}>−{d}pt</Text></Pressable>)}
                  </View>
                </>
              )}
              <View style={styles.rowBetween}>
                <View style={{ flex: 1 }}>
                  {nightly.last ? (
                    <Text style={styles.hint} testID="stress-nightly-last">
                      Ultimo test notturno: {new Date(nightly.last.created_at).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" })} · {nightly.last.summary?.pct_passed ?? 0}% corrette
                      {nightly.last.nightly_prev_pct != null ? ` (prima ${nightly.last.nightly_prev_pct}%)` : ""} · {nightly.last.nightly_verdict === "alert" ? "⚠️ avviso inviato" : "✅ ok"}
                    </Text>
                  ) : <Text style={styles.hint}>Nessun test notturno ancora eseguito.</Text>}
                </View>
                <Pressable onPress={nightlyRunNow} disabled={nightly.running || run?.status === "running"} style={[styles.secondaryBtn, (nightly.running || run?.status === "running") && { opacity: 0.5 }]} testID="stress-nightly-run-now">
                  <Ionicons name="moon" size={14} color={VIOLET} /><Text style={styles.secondaryTxt}>Prova ora</Text>
                </Pressable>
              </View>
            </View>
          )}

          {run && (
            <>
              {/* V50.z508 — esito autocorrezione automatica */}
              {run.autofix ? (
                <View style={styles.autofixBox} testID="stress-autofix-box">
                  <Ionicons name="sparkles" size={16} color={HT.success} />
                  <Text style={styles.autofixTxt}>Test notturno completato: <Text style={{ fontWeight: "900" }}>{run.autofix.applied} correzioni applicate</Text>, nuovo punteggio <Text style={{ fontWeight: "900" }}>{run.autofix.new_pct}%</Text>{run.autofix.pct_before != null ? ` (prima ${run.autofix.pct_before}%)` : ""} · {run.autofix.reverified_ok}/{run.autofix.applied} riverificate ok</Text>
                </View>
              ) : null}
              {/* Contatori */}
              <View style={styles.kpiRow} testID="stress-kpis">
                <View style={styles.kpi}><Text style={styles.kpiN}>{S.tested}</Text><Text style={styles.kpiL}>Domande testate</Text></View>
                <View style={[styles.kpi, { borderColor: '#86EFAC' }]}><Text style={[styles.kpiN, { color: HT.success }]}>{S.pct_passed}%</Text><Text style={styles.kpiL}>Corrette</Text></View>
                <View style={[styles.kpi, { borderColor: '#FCA5A5' }]}><Text style={[styles.kpiN, { color: HT.danger }]}>{S.pct_failed}%</Text><Text style={styles.kpiL}>Fallite</Text></View>
                <View style={[styles.kpi, { borderColor: '#FCD34D' }]}><Text style={[styles.kpiN, { color: "#FDBA74" }]}>{S.pct_inconsistent}%</Text><Text style={styles.kpiL}>Incoerenti</Text></View>
              </View>

              {/* V50.z305 — Regole di stile (aspetta → OK!, solo tabella, sì/no, scelte A)/B), motivazioni) */}
              {S.by_category?.stile?.tested ? (
                <View style={[styles.card, { borderColor: S.by_category.stile.passed === S.by_category.stile.tested ? "#86EFAC" : "#FCD34D" }]} testID="stress-stile">
                  <Text style={styles.cardTitle}>⚡ Regole di stile: {S.by_category.stile.passed}/{S.by_category.stile.tested} rispettate</Text>
                  <Text style={styles.cardTxt}>{"«aspetta» → solo «OK!» · «solo tabella» → solo tabella · domande sì/no → prima riga diretta · scelte → «A) / B)» (pulsanti) · domande strane o doppie → risposta motivata. Apri le voci «stile» qui sotto per leggere la motivazione data da Axon."}</Text>
                </View>
              ) : null}

              {(S.errors || 0) > 0 && (
                <View style={[styles.card, { borderColor: '#E9D5FF', backgroundColor: HT.violetTint }]} testID="stress-llm-error">
                  <Text style={[styles.cardTitle, { color: HT.violet }]}>⛔ {S.errors} domande non valutate per errore LLM</Text>
                  <Text style={styles.hint}>{run.error || "Il modello non ha risposto."} Se compare «Daily spend limit reached» il budget giornaliero della chiave LLM è esaurito: ricarica da Profilo → Manage plan → Universal Key → Add Balance (o attiva l'auto top-up) e rilancia il test.</Text>
                </View>
              )}
              {/* Filtri */}
              <View style={styles.rowWrap} testID="stress-filters">
                {(["all", "passed", "failed", "inconsistent", ...((S.errors || 0) > 0 ? ["error"] : [])] as Filter[]).map((f) => {
                  const n = f === "all" ? S.tested : f === "error" ? S.errors || 0 : (S as any)[f];
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
                const okCount = it.reps.filter((r) => r.ok === true).length;
                return (
                  <View key={it.id} style={styles.item} testID={`stress-item-${it.id}`}>
                    <Pressable onPress={() => setOpenId(open ? null : it.id)} style={styles.itemHead} testID={`stress-item-toggle-${it.id}`}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.itemQ}>{it.question}</Text>
                        <Text style={styles.itemMeta}>{it.category}{it.flag ? ` · ${it.flag}` : ""} · {okCount}/{it.reps.length} ok</Text>
                      </View>
                      {o && <View style={[styles.badge, { backgroundColor: o.bg }]}><Text style={[styles.badgeTxt, { color: o.c }]}>{o.t}</Text></View>}
                      <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color={HT.muted} />
                    </Pressable>
                    {open && (
                      <View style={styles.itemBody}>
                        {it.reps.map((r) => (
                          <View key={r.rep} style={styles.rep}>
                            <Text style={styles.repHead}>{r.ok === null ? "⛔" : r.ok ? "✅" : "❌"} Ripetizione {r.rep}{r.reason ? ` — ${r.reason}` : ""}</Text>
                            {it.flag.startsWith("style:") ? <Text style={styles.repLinks}>Risposta / motivazione di Axon:</Text> : null}
                            <Text style={styles.repTxt} numberOfLines={it.flag.startsWith("style:") ? undefined : 8}>{r.reply.replace(/\[\[(NAV|ACTION):[^\]]*\]\]/g, "").trim() || "(vuota)"}</Text>
                            {r.routes.length > 0 && <Text style={styles.repLinks}>Link: {r.routes.join("  ")}</Text>}
                            {r.actions.length > 0 && <Text style={styles.repLinks}>Azioni: {r.actions.join(", ")}</Text>}
                          </View>
                        ))}
                        {it.outcome !== "passed" && it.outcome !== "error" && it.correction && (
                          <View style={styles.corr} testID={`stress-correction-${it.id}`}>
                            <Text style={styles.corrLab}>Risposta corretta attesa</Text>
                            <Text style={styles.corrTxt}>{it.correction.expected_text}</Text>
                            <Text style={[styles.corrLab, { marginTop: 8 }]}>Correzione suggerita al prompt</Text>
                            <Text style={styles.corrTxt}>{it.correction.rule}</Text>
                            <Pressable
                              onPress={() => applyCorrection(it)}
                              disabled={!!it.correction_applied || applying === it.id}
                              style={[styles.applyBtn, it.correction_applied && { backgroundColor: '#16A34A' }]}
                              testID={`stress-apply-${it.id}`}
                            >
                              {applying === it.id ? <ActivityIndicator size="small" color="#FFF" /> : <Ionicons name={it.correction_applied ? "checkmark-circle" : "sparkles"} size={14} color="#FFF" />}
                              <Text style={styles.applyTxt}>{it.correction_applied ? (it.correction_auto ? "Applicata automaticamente" + (it.autofix_recheck ? (it.autofix_recheck.ok ? " · riverificata ✓" : " · da ricontrollare") : "") : "Correzione applicata") : "Applica correzione"}</Text>
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
  autofixBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: HT.successTint, borderWidth: 1, borderColor: HT.success, borderRadius: 12, padding: 10, marginBottom: 10 },
  autofixTxt: { color: HT.text, fontSize: 13, flex: 1, lineHeight: 18 },

  root: { flex: 1, backgroundColor: HT.card2 },
  header: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: NAVY, paddingHorizontal: 14, paddingVertical: 12 },
  title: { color: "#FFF", fontWeight: "900", fontSize: 17 }, sub: { color: "#C7D2FE", fontSize: 11, marginTop: 1 },
  headBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: VIOLET, borderRadius: 999, paddingHorizontal: 12, minHeight: 36 },
  headBtnTxt: { color: "#FFF", fontWeight: "800", fontSize: 12 },
  card: { backgroundColor: HT.card, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: HT.border, gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: "900", color: HT.text },
  cardTxt: { fontSize: 12, color: HT.muted, marginTop: 4, lineHeight: 17 },
  hint: { fontSize: 12, color: HT.muted, lineHeight: 17 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  rowWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  primaryBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: VIOLET, borderRadius: 12, paddingHorizontal: 14, minHeight: 44 },
  primaryTxt: { color: "#FFF", fontWeight: "900", fontSize: 13 },
  secondaryBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: HT.violetTint, borderWidth: 1, borderColor: HT.violet + '66', borderRadius: 12, paddingHorizontal: 14, minHeight: 44 },
  secondaryTxt: { color: VIOLET, fontWeight: "900", fontSize: 13 },
  stopBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: HT.danger, borderRadius: 999, paddingHorizontal: 12, minHeight: 36 },
  stopTxt: { color: "#FFF", fontWeight: "800", fontSize: 12 },
  barBg: { height: 8, borderRadius: 4, backgroundColor: HT.violetTint, overflow: "hidden" }, barFg: { height: 8, backgroundColor: VIOLET },
  kpiRow: { flexDirection: "row", gap: 8 },
  kpi: { flex: 1, backgroundColor: HT.card, borderRadius: 12, borderWidth: 1, borderColor: HT.border, padding: 8, alignItems: "center" },
  kpiN: { fontSize: 18, fontWeight: "900", color: HT.text }, kpiL: { fontSize: 9.5, color: HT.muted, textAlign: "center", marginTop: 2 },
  chip: { backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border, borderRadius: 999, paddingHorizontal: 12, minHeight: 36, justifyContent: "center" },
  chipOn: { backgroundColor: VIOLET, borderColor: VIOLET }, chipTxt: { fontSize: 12.5, fontWeight: "800", color: HT.text }, chipTxtOn: { color: "#FFF" },
  item: { backgroundColor: HT.card, borderRadius: 12, borderWidth: 1, borderColor: HT.border, overflow: "hidden" },
  itemHead: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, minHeight: 56 },
  itemQ: { fontSize: 14, fontWeight: "800", color: HT.text }, itemMeta: { fontSize: 11, color: HT.muted, marginTop: 2 },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }, badgeTxt: { fontSize: 11, fontWeight: "900" },
  itemBody: { borderTopWidth: 1, borderTopColor: HT.border, padding: 12, gap: 8 },
  rep: { backgroundColor: HT.card2, borderRadius: 10, padding: 8, gap: 3 },
  repHead: { fontSize: 12, fontWeight: "800", color: HT.text }, repTxt: { fontSize: 12, color: HT.text2, lineHeight: 17 }, repLinks: { fontSize: 11, color: VIOLET, fontWeight: "700" },
  corr: { backgroundColor: HT.violetTint, borderRadius: 10, padding: 10, gap: 3, borderWidth: 1, borderColor: HT.violet + '66' },
  corrLab: { fontSize: 10.5, fontWeight: "900", color: VIOLET, letterSpacing: 0.3 }, corrTxt: { fontSize: 12.5, color: HT.text, lineHeight: 18 },
  applyBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: VIOLET, borderRadius: 10, minHeight: 44, marginTop: 10 },
  applyTxt: { color: "#FFF", fontWeight: "900", fontSize: 13 },
  toggle: { width: 50, height: 30, borderRadius: 15, backgroundColor: HT.borderStrong, padding: 3, justifyContent: "center" },
  toggleOn: { backgroundColor: VIOLET },
  knob: { width: 24, height: 24, borderRadius: 12, backgroundColor: HT.card }, knobOn: { alignSelf: "flex-end" },
  optLab: { fontSize: 11, fontWeight: "900", color: HT.muted, letterSpacing: 0.3, marginTop: 4 },
});

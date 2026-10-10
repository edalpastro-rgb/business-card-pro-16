// app/admin/beta.tsx — V50.z474 — Pannello Master › «Cruscotto Beta»: le 10 metriche del piano «Beta sul campo» con soglia, stato
// (verde/giallo/rosso/n.d.), dettaglio e verdetto GO/ITERA/RIPENSA; controllo delle ondate del sondaggio NPS; ultimi commenti.
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, RefreshControl, Switch, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { api, BACKEND_URL, getAuthHeader } from "@/src/api";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";

const C = theme.color;
const TEAL = "#0F766E";
type Metric = { key: string; label: string; value: number | null; unit: string; target: number; higher_is_better?: boolean; status: "ok" | "warn" | "ko" | "nd"; detail: string; breakdown?: Record<string, number> };
type ProgramAdmin = { participants: { user_id: string; name?: string; email?: string; week: number; start_date: string; diaries_done: number[]; last_open?: string | null }[]; missions: { week: number; title: string; goal: string; tasks: string[] }[]; diaries: { user_name?: string; user_email?: string; week: number; saved_time?: string; angry?: string; manual?: string; at?: string | null }[]; tenant_start: string | null; current_week: number | null };
type Mis = { days: number; scope: "all" | "tenant"; total: number; user_messages: number; rate_pct: number | null; by_reason: Record<string, number>; clusters: { key: string; example: string; count: number; users: number; reasons: Record<string, number> }[]; items: { at: string; user: string; phrase: string; retry?: string; reply?: string; reason: string }[]; labels: Record<string, string> };
type Payload = { days: number; users: number; metrics: Metric[]; summary: { ok: number; nd: number; total: number; verdict: string }; nps_wave: { wave: number; active: boolean; ask_price: boolean; responses: number }; comments: { user: string; score: number; best?: string; worst?: string; at: string | null }[]; scope: "all" | "tenant" };

const STATUS = { ok: { color: "#16A34A", icon: "checkmark-circle" as const, label: "obiettivo raggiunto" }, warn: { color: "#D97706", icon: "alert-circle" as const, label: "vicino all'obiettivo" }, ko: { color: "#DC2626", icon: "close-circle" as const, label: "sotto l'obiettivo" }, nd: { color: "#64748B", icon: "help-circle" as const, label: "dati insufficienti" } };
const VERDICT: Record<string, { color: string; text: string }> = { GO: { color: "#16A34A", text: "GO — pronto per il rilascio pubblico" }, ITERA: { color: "#D97706", text: "ITERA — altre 3 settimane su affidabilità Axon / Android" }, RIPENSA: { color: "#DC2626", text: "RIPENSA — problema di valore percepito: rivedere onboarding e proposta" }, "IN CORSO": { color: TEAL, text: "IN CORSO — raccolta dati" } };
const fmtVal = (m: Metric) => (m.value === null || m.value === undefined ? "n/d" : `${Number.isInteger(m.value) ? m.value : m.value.toFixed(1)}${m.unit === "%" || m.unit === "% utenti" ? "%" : m.unit ? ` ${m.unit}` : ""}`);

export default function AdminBeta() {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(42);
  const [saving, setSaving] = useState(false);
  const [prog, setProg] = useState<ProgramAdmin | null>(null); // V50.z475
  const [mis, setMis] = useState<Mis | null>(null); // V50.z476 — frasi non capite
  const [misReason, setMisReason] = useState<"all" | "error" | "repeated" | "correction" | "watchdog">("all");
  const [misOpen, setMisOpen] = useState(false);
  // V50.z478 — Segnalazioni (bug/errori/idee) + errori backend + watchdog, in un unico posto
  type Issues = { days: number; scope: "all" | "tenant"; tickets: { counts: Record<string, number>; total: number; items: { ticket_id: string; user: string; status: string; text: string; messages: number; attachments: number; note: string; created_at: string | null; updated_at: string | null }[]; labels: Record<string, string> }; errors: { total: number; groups: { title: string; count: number; users: number; last: string | null; detail: string }[]; last_at: string | null }; watchdog: { total: number; by_kind: Record<string, number> } };
  const [iss, setIss] = useState<Issues | null>(null);
  const [issStatus, setIssStatus] = useState<"all" | "open" | "escalated" | "resolved">("all");
  const [issBusy, setIssBusy] = useState<string | null>(null);
  const loadIss = useCallback(() => { api<Issues>(`/admin/beta/issues?days=${days}${issStatus !== "all" ? `&status=${issStatus}` : ""}`).then(setIss).catch(() => {}); }, [days, issStatus]);
  useEffect(() => { loadIss(); }, [loadIss]);
  const setTicket = async (ticket_id: string, status: "open" | "resolved") => {
    setIssBusy(ticket_id);
    try { await api(`/admin/beta/tickets/${ticket_id}/status`, { method: "POST", body: { status } }); loadIss(); }
    catch (e: any) { notify("Segnalazione", e?.message || "Aggiornamento non riuscito"); }
    finally { setIssBusy(null); }
  };
  const TK_COLOR: Record<string, string> = { open: "#D97706", escalated: "#DC2626", resolved: "#16A34A" };
  useEffect(() => { api<Mis>(`/admin/beta/misunderstood?days=${days}&limit=60${misReason !== "all" ? `&reason=${misReason}` : ""}`).then(setMis).catch(() => {}); }, [days, misReason]);
  const loadProg = useCallback(() => { api<ProgramAdmin>("/admin/beta/program").then(setProg).catch(() => {}); }, []);
  useEffect(() => { loadProg(); }, [loadProg]);
  const startProgram = async () => { setSaving(true); try { await api("/admin/beta/start", { method: "POST", body: {} }); notify("Programma avviato", "Da oggi i consulenti vedono la missione della settimana 1 in Home e il Diario del venerdì."); loadProg(); } catch (e: any) { notify("Avvio non riuscito", e?.message || "Riprova"); } finally { setSaving(false); } };
  const stopProgram = () => notify("Chiudere il programma?", "La card Beta sparisce dalla Home dei consulenti; diari e sondaggi restano.", [{ text: "Annulla", style: "cancel" }, { text: "Chiudi", style: "destructive", onPress: async () => { try { await api("/admin/beta/start", { method: "DELETE" }); loadProg(); } catch (e: any) { notify("Errore", e?.message || "Riprova"); } } }]);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await api<Payload>(`/admin/beta/dashboard?days=${days}`)); }
    catch (e: any) { notify("Cruscotto Beta", e?.message || "Errore di caricamento"); }
    finally { setLoading(false); }
  }, [days]);
  useEffect(() => { load(); }, [load]);

  const setWave = async (patch: Partial<Payload["nps_wave"]>) => {
    if (!data) return;
    const next = { ...data.nps_wave, ...patch };
    setSaving(true);
    try { await api("/admin/beta/nps-wave", { method: "POST", body: { wave: next.wave, active: next.active, ask_price: next.ask_price } }); setData({ ...data, nps_wave: next }); }
    catch (e: any) { notify("Sondaggio", e?.message || "Salvataggio non riuscito"); }
    finally { setSaving(false); }
  };

  const verdict = data ? VERDICT[data.summary.verdict] || VERDICT["IN CORSO"] : null;

  // V50.z477 — Export CSV/PDF del cruscotto (web: download browser · nativo: salva in cache e apre il foglio di condivisione)
  const [exporting, setExporting] = useState<"csv" | "pdf" | null>(null);
  const exportReport = async (kind: "csv" | "pdf") => {
    if (exporting) return;
    setExporting(kind);
    const fname = `AdvisorOS_Beta_${days}gg.${kind}`;
    const url = `${BACKEND_URL}/api/admin/beta/export.${kind}?days=${days}`;
    const mime = kind === "pdf" ? "application/pdf" : "text/csv";
    try {
      const auth = await getAuthHeader();
      if (Platform.OS === "web") {
        const res = await fetch(url, { headers: auth });
        if (!res.ok) throw new Error(`Errore server (${res.status})`);
        const blob = await res.blob();
        const href = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href = href; a.download = fname; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(href), 4000);
        notify("Export pronto", `${fname} scaricato`);
        return;
      }
      const dest = `${FileSystem.cacheDirectory}${fname}`;
      const dl = await FileSystem.downloadAsync(url, dest, { headers: auth });
      if (dl.status !== 200) throw new Error(`Errore server (${dl.status})`);
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(dl.uri, { mimeType: mime, UTI: kind === "pdf" ? "com.adobe.pdf" : "public.comma-separated-values-text", dialogTitle: `Report Beta (${kind.toUpperCase()})` });
      else notify("File salvato", dl.uri);
    } catch (e: any) { notify("Export non riuscito", e?.message || "Riprova"); }
    finally { setExporting(null); }
  };

  return (
    <SafeAreaView style={s.container} edges={["top"]}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.iconBtn} testID="beta-back"><Ionicons name="chevron-back" size={24} color={C.onSurface} /></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.hTitle}>Cruscotto Beta</Text>
          <Text style={s.hSub}>{data ? `${data.users} utenti · ${data.summary.ok}/${data.summary.total} metriche a obiettivo · ${data.scope === "all" ? "tutte le reti" : "la tua rete"}` : "Caricamento…"}</Text>
        </View>
        <Pressable onPress={load} style={s.addBtn} disabled={loading} testID="beta-refresh">
          {loading ? <ActivityIndicator color={C.onSurfaceInverse} /> : <><Ionicons name="refresh" size={16} color={C.onSurfaceInverse} /><Text style={s.addTxt}>Aggiorna</Text></>}
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={s.list} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />} testID="beta-list">
        <View style={s.filters}>
          {[14, 28, 42, 90].map((d) => (
            <Pressable key={d} onPress={() => setDays(d)} style={[s.chip, days === d && s.chipOn]} testID={`beta-days-${d}`}><Text style={[s.chipTxt, days === d && s.chipTxtOn]}>{d} gg</Text></Pressable>
          ))}
        </View>
        {/* V50.z477 — Export per partner/investitori */}
        <View style={s.filters} testID="beta-export-row">
          <Pressable onPress={() => exportReport("pdf")} disabled={!!exporting || !data} style={[s.chip, { borderColor: "#B45309" }]} testID="beta-export-pdf">
            {exporting === "pdf" ? <ActivityIndicator size="small" color="#B45309" /> : <Ionicons name="document-text-outline" size={14} color="#B45309" />}
            <Text style={[s.chipTxt, { color: "#B45309" }]}> Report PDF</Text>
          </Pressable>
          <Pressable onPress={() => exportReport("csv")} disabled={!!exporting || !data} style={s.chip} testID="beta-export-csv">
            {exporting === "csv" ? <ActivityIndicator size="small" color={TEAL} /> : <Ionicons name="grid-outline" size={14} color={TEAL} />}
            <Text style={s.chipTxt}> Dati CSV (Excel)</Text>
          </Pressable>
          <Text style={[s.hint, { flexBasis: "100%" }]}>Il report include verdetto, 10 metriche, frasi non capite, NPS, partecipanti e diari degli ultimi {days} giorni — pronto da inviare a partner e investitori.</Text>
        </View>
        {data && verdict ? (
          <View style={[s.card, { borderColor: verdict.color, borderWidth: 2 }]} testID="beta-verdict">
            <View style={s.rowBetween}>
              <Text style={[s.verdict, { color: verdict.color }]}>{data.summary.verdict}</Text>
              <Text style={s.hint}>{data.summary.ok} ok · {data.summary.total - data.summary.ok - data.summary.nd} sotto · {data.summary.nd} n/d</Text>
            </View>
            <Text style={s.lbl}>{verdict.text}</Text>
            <Text style={s.hint}>Regola: GO se Attivazione, Comandi Axon, Stabilità e NPS sono a obiettivo e almeno 6 metriche su 10 lo sono. Periodo: ultimi {data.days} giorni.</Text>
          </View>
        ) : null}
        {data?.metrics.map((m, i) => {
          const st = STATUS[m.status];
          return (
            <View key={m.key} style={s.card} testID={`beta-metric-${m.key}`}>
              <View style={s.rowBetween}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                  <Ionicons name={st.icon} size={22} color={st.color} />
                  <Text style={s.cardTitle} numberOfLines={2}>{i + 1}. {m.label}</Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={[s.value, { color: st.color }]}>{fmtVal(m)}</Text>
                  <Text style={s.target}>obiettivo {m.higher_is_better === false ? "≤" : "≥"} {m.target}{m.unit === "%" || m.unit === "% utenti" ? "%" : m.unit ? ` ${m.unit}` : ""}</Text>
                </View>
              </View>
              {m.value !== null && m.value !== undefined && (m.unit === "%" || m.unit === "% utenti") ? (
                <View style={s.bar}><View style={[s.barFill, { width: `${Math.min(100, Math.max(0, m.value))}%` as any, backgroundColor: st.color }]} /><View style={[s.barTarget, { left: `${Math.min(100, m.target)}%` as any }]} /></View>
              ) : null}
              <Text style={s.hint}>{m.detail}</Text>
            </View>
          );
        })}
        {/* V50.z476 — Frasi non capite: cluster (dove migliorare) + elenco; Super Master = tutte le reti */}
        {mis ? (
          <View style={[s.card, { borderColor: "#B45309" }]} testID="beta-misunderstood">
            <View style={s.rowBetween}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}><Ionicons name="chatbox-ellipses-outline" size={20} color="#B45309" /><Text style={s.cardTitle}>Frasi non capite da Axon</Text></View>
              <Text style={[s.value, { color: "#B45309", fontSize: 18 }]}>{mis.total}</Text>
            </View>
            <Text style={s.hint}>{mis.rate_pct !== null ? `${mis.rate_pct}% delle ${mis.user_messages} richieste` : "nessuna richiesta"} negli ultimi {mis.days} gg · {mis.scope === "all" ? "tutte le reti (vista AdvisorOS)" : "la tua rete"} · errori {mis.by_reason.error || 0} · ripetute {mis.by_reason.repeated || 0} · corrette {mis.by_reason.correction || 0} · timeout {mis.by_reason.watchdog || 0}</Text>
            {mis.clusters.length ? (
              <>
                <Text style={[s.lbl, { marginTop: 4 }]}>Dove migliorare (richieste ricorrenti)</Text>
                {mis.clusters.slice(0, 8).map((c) => (
                  <View key={c.key} style={[s.rowBetween, { paddingVertical: 5, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.divider }]} testID="beta-mis-cluster">
                    <Text style={[s.hint, { flex: 1, color: C.onSurface }]} numberOfLines={2}>«{c.example}»</Text>
                    <View style={{ alignItems: "flex-end" }}><Text style={[s.lbl, { flex: 0 }]}>{c.count}×</Text><Text style={s.hint}>{c.users} utent{c.users === 1 ? "e" : "i"}</Text></View>
                  </View>
                ))}
              </>
            ) : <Text style={s.hint}>Nessuna frase non capita nel periodo: ottimo segno.</Text>}
            <View style={s.filters}>
              {(["all", "error", "repeated", "correction", "watchdog"] as const).map((f) => (
                <Pressable key={f} onPress={() => { setMisReason(f); setMisOpen(true); }} style={[s.chip, misReason === f && misOpen && s.chipOn]} testID={`beta-mis-${f}`}><Text style={[s.chipTxt, misReason === f && misOpen && s.chipTxtOn]}>{f === "all" ? "Tutte" : f === "error" ? "Errori" : f === "repeated" ? "Ripetute" : f === "correction" ? "Corrette" : "Timeout"}</Text></Pressable>
              ))}
              <Pressable onPress={() => setMisOpen((v) => !v)} style={s.chip} testID="beta-mis-toggle"><Text style={s.chipTxt}>{misOpen ? "Nascondi elenco" : "Mostra elenco"}</Text></Pressable>
            </View>
            {misOpen ? mis.items.slice(0, 40).map((it, i) => (
              <View key={i} style={{ gap: 2, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.divider }} testID={`beta-mis-item-${i}`}>
                <Text style={s.hint}>{new Date(it.at).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · {it.user} · {mis.labels[it.reason] || it.reason}</Text>
                <Text style={[s.lbl, { flex: 0 }]}>«{it.phrase}»</Text>
                {it.retry ? <Text style={s.hint}>↻ riformulata: «{it.retry}»</Text> : null}
                {it.reply ? <Text style={s.hint} numberOfLines={2}>→ {it.reply}</Text> : null}
              </View>
            )) : null}
            <Text style={s.hint}>Come correggere: apri la chat, scrivi la frase e usa «Insegna ad Axon» per la risposta giusta; le frasi ricorrenti vanno aggiunte come comandi deterministici nel rilascio successivo.</Text>
          </View>
        ) : null}
        {/* V50.z478 — Segnalazioni dei tester + errori backend */}
        {iss ? (
          <View style={[s.card, { borderColor: "#DC2626" }]} testID="beta-issues">
            <View style={s.rowBetween}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}><Ionicons name="bug-outline" size={20} color="#DC2626" /><Text style={s.cardTitle}>Segnalazioni ed errori</Text></View>
              <Text style={[s.value, { color: "#DC2626", fontSize: 18 }]}>{(iss.tickets.counts.open || 0) + (iss.tickets.counts.escalated || 0)}</Text>
            </View>
            <Text style={s.hint}>{iss.tickets.total} segnalazioni negli ultimi {iss.days} gg · aperte {iss.tickets.counts.open || 0} · da gestire {iss.tickets.counts.escalated || 0} · risolte {iss.tickets.counts.resolved || 0} · {iss.scope === "all" ? "tutte le reti" : "la tua rete"}</Text>
            <View style={s.rowBetween}>
              <View style={{ flex: 1 }}><Text style={s.lbl}>Errori backend (5xx)</Text><Text style={s.hint}>{iss.errors.total} nel periodo{iss.errors.last_at ? ` · ultimo ${new Date(iss.errors.last_at).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : ""}</Text></View>
              <View style={{ flex: 1 }}><Text style={s.lbl}>Watchdog Axon</Text><Text style={s.hint}>{iss.watchdog.total} eventi{Object.keys(iss.watchdog.by_kind).length ? ` · ${Object.entries(iss.watchdog.by_kind).map(([k, v]) => `${k} ${v}`).join(", ")}` : ""}</Text></View>
            </View>
            {iss.errors.groups.length ? (
              <>
                <Text style={[s.lbl, { marginTop: 4 }]}>Endpoint con più errori</Text>
                {iss.errors.groups.slice(0, 5).map((g) => (
                  <View key={g.title} style={[s.rowBetween, { paddingVertical: 5, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.divider }]} testID="beta-err-group">
                    <View style={{ flex: 1 }}><Text style={[s.hint, { color: C.onSurface }]} numberOfLines={1}>{g.title}</Text>{g.detail ? <Text style={s.hint} numberOfLines={1}>{g.detail}</Text> : null}</View>
                    <View style={{ alignItems: "flex-end" }}><Text style={[s.lbl, { flex: 0 }]}>{g.count}×</Text><Text style={s.hint}>{g.users} utent{g.users === 1 ? "e" : "i"}</Text></View>
                  </View>
                ))}
              </>
            ) : <Text style={s.hint}>Nessun errore backend nel periodo.</Text>}
            <View style={s.filters}>
              {(["all", "open", "escalated", "resolved"] as const).map((f) => (
                <Pressable key={f} onPress={() => setIssStatus(f)} style={[s.chip, issStatus === f && s.chipOn]} testID={`beta-iss-${f}`}><Text style={[s.chipTxt, issStatus === f && s.chipTxtOn]}>{f === "all" ? "Tutte" : iss.tickets.labels[f]}</Text></Pressable>
              ))}
              <Pressable onPress={() => router.push("/bug-report" as any)} style={s.chip} testID="beta-iss-open-triage"><Ionicons name="open-outline" size={14} color={TEAL} /><Text style={s.chipTxt}> Apri conversazioni</Text></Pressable>
            </View>
            {iss.tickets.items.length ? iss.tickets.items.slice(0, 30).map((t) => (
              <View key={t.ticket_id} style={{ gap: 4, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.divider }} testID={`beta-ticket-${t.ticket_id}`}>
                <View style={s.rowBetween}>
                  <Text style={s.hint}>{t.created_at ? new Date(t.created_at).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : ""} · {t.user} · {t.messages} msg{t.attachments ? ` · 📎 ${t.attachments}` : ""}</Text>
                  <View style={[s.chip, { minHeight: 24, paddingHorizontal: 8, borderColor: TK_COLOR[t.status] || TEAL }]}><Text style={[s.chipTxt, { fontSize: 11, color: TK_COLOR[t.status] || TEAL }]}>{iss.tickets.labels[t.status] || t.status}</Text></View>
                </View>
                <Text style={[s.lbl, { flex: 0 }]} numberOfLines={3}>«{t.text || "(solo allegati)"}»</Text>
                {t.note ? <Text style={s.hint}>📝 {t.note}</Text> : null}
                <Pressable onPress={() => setTicket(t.ticket_id, t.status === "resolved" ? "open" : "resolved")} disabled={issBusy === t.ticket_id} style={[s.chip, { alignSelf: "flex-start", minHeight: 32, borderColor: t.status === "resolved" ? "#D97706" : "#16A34A" }]} testID={`beta-ticket-toggle-${t.ticket_id}`}>
                  {issBusy === t.ticket_id ? <ActivityIndicator size="small" color={TEAL} /> : <Ionicons name={t.status === "resolved" ? "refresh-outline" : "checkmark-done-outline"} size={14} color={t.status === "resolved" ? "#D97706" : "#16A34A"} />}
                  <Text style={[s.chipTxt, { color: t.status === "resolved" ? "#D97706" : "#16A34A" }]}> {t.status === "resolved" ? "Riapri" : "Segna risolta"}</Text>
                </Pressable>
              </View>
            )) : <Text style={s.hint}>Nessuna segnalazione {issStatus !== "all" ? `con stato «${iss.tickets.labels[issStatus]}»` : ""} nel periodo.</Text>}
          </View>
        ) : null}
        {/* V50.z475 — Programma 6 settimane: avvio, partecipanti, missioni, diari */}
        <View style={s.card} testID="beta-program">
          <View style={s.rowBetween}>
            <Text style={s.cardTitle}>Programma Beta · 6 settimane</Text>
            {prog?.tenant_start ? <Text style={[s.chipTxt, { fontSize: 12 }]}>sett. {prog.current_week}/6 · dal {prog.tenant_start}</Text> : null}
          </View>
          {!prog?.tenant_start ? (
            <>
              <Text style={s.hint}>Avviando il programma, ogni consulente vede in Home la missione della settimana (3 compiti) e il Diario del venerdì (3 domande, 30 secondi). Le missioni portano i tester a provare le funzioni chiave in ordine.</Text>
              <Pressable onPress={startProgram} disabled={saving} style={[s.addBtn, { alignSelf: "flex-start" }]} testID="beta-start"><Ionicons name="rocket-outline" size={16} color={C.onSurfaceInverse} /><Text style={s.addTxt}> Avvia oggi (settimana 1)</Text></Pressable>
            </>
          ) : (
            <>
              {prog.participants.map((u) => (
                <View key={u.user_id} style={[s.rowBetween, { paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.divider }]} testID={`beta-participant-${u.user_id}`}>
                  <View style={{ flex: 1 }}><Text style={s.lbl}>{u.name || u.email}</Text><Text style={s.hint}>ultimo accesso {u.last_open || "mai"} · diari: {u.diaries_done.length ? u.diaries_done.map((w) => `S${w}`).join(" ") : "nessuno"}</Text></View>
                  <View style={[s.chip, { minHeight: 30 }]}><Text style={s.chipTxt}>S{u.week}</Text></View>
                </View>
              ))}
              {prog.current_week ? <Text style={s.hint}>Missione corrente: <Text style={{ fontWeight: "800", color: C.onSurface }}>{prog.missions[prog.current_week - 1].title}</Text> — {prog.missions[prog.current_week - 1].tasks.join(" · ")}</Text> : null}
              <Pressable onPress={stopProgram} style={[s.chip, { alignSelf: "flex-start", borderColor: "#DC2626" }]} testID="beta-stop"><Text style={[s.chipTxt, { color: "#DC2626" }]}>Chiudi programma</Text></Pressable>
            </>
          )}
        </View>
        {prog?.diaries.length ? (
          <View style={s.card} testID="beta-diaries">
            <Text style={s.cardTitle}>Diario del venerdì · ultime voci</Text>
            {prog.diaries.map((d, i) => (
              <View key={i} style={{ gap: 2, paddingVertical: 6, borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderTopColor: C.divider }}>
                <Text style={s.lbl}>{d.user_name || d.user_email} · settimana {d.week}{d.at ? ` · ${new Date(d.at).toLocaleDateString("it-IT")}` : ""}</Text>
                {d.saved_time ? <Text style={s.hint}>⏱️ {d.saved_time}</Text> : null}
                {d.angry ? <Text style={s.hint}>🔥 {d.angry}</Text> : null}
                {d.manual ? <Text style={s.hint}>✋ {d.manual}</Text> : null}
              </View>
            ))}
          </View>
        ) : null}
        {data ? (
          <View style={s.card} testID="beta-nps-wave">
            <Text style={s.cardTitle}>Sondaggio NPS in-app</Text>
            <Text style={s.hint}>Quando l&apos;ondata è attiva, ogni utente vede l&apos;invito in Home e nel tab Help finché non risponde. Risposte ricevute per questa ondata: {data.nps_wave.responses}.</Text>
            <View style={s.rowBetween}><Text style={s.lbl}>Ondata attiva (n. {data.nps_wave.wave})</Text><Switch value={data.nps_wave.active} disabled={saving} onValueChange={(v) => setWave({ active: v })} trackColor={{ true: TEAL }} /></View>
            <View style={s.rowBetween}><Text style={s.lbl}>Chiedi anche la fascia di prezzo (settimana 6)</Text><Switch value={data.nps_wave.ask_price} disabled={saving} onValueChange={(v) => setWave({ ask_price: v })} trackColor={{ true: TEAL }} /></View>
            <View style={s.filters}>
              <Pressable onPress={() => setWave({ wave: data.nps_wave.wave + 1, active: true })} style={s.chip} disabled={saving} testID="beta-next-wave"><Ionicons name="play-forward" size={14} color={TEAL} /><Text style={s.chipTxt}> Nuova ondata (n. {data.nps_wave.wave + 1})</Text></Pressable>
              <Pressable onPress={() => router.push("/beta-nps" as any)} style={s.chip} testID="beta-preview-nps"><Ionicons name="eye-outline" size={14} color={TEAL} /><Text style={s.chipTxt}> Anteprima sondaggio</Text></Pressable>
            </View>
          </View>
        ) : null}
        {data?.comments.length ? (
          <View style={s.card} testID="beta-comments">
            <Text style={s.cardTitle}>Ultimi commenti</Text>
            {data.comments.map((c, i) => (
              <View key={i} style={{ gap: 2, paddingVertical: 6, borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderTopColor: C.divider }}>
                <Text style={s.lbl}>{c.user} · {c.score}/10</Text>
                {c.best ? <Text style={s.hint}>👍 {c.best}</Text> : null}
                {c.worst ? <Text style={s.hint}>👎 {c.worst}</Text> : null}
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.divider, backgroundColor: C.surfaceSecondary },
  iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  hTitle: { fontSize: 18, fontWeight: "800", color: C.onSurface },
  hSub: { fontSize: 12, color: C.muted },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: TEAL, paddingHorizontal: 14, minHeight: 44, borderRadius: 12 },
  addTxt: { color: C.onSurfaceInverse, fontWeight: "800" },
  list: { padding: 16, gap: 12, paddingBottom: 140 },
  card: { backgroundColor: C.surfaceSecondary, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.divider, gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: "800", color: C.onSurface, flex: 1 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  hint: { fontSize: 12.5, color: C.muted, lineHeight: 18 },
  lbl: { fontSize: 13, fontWeight: "700", color: C.onSurface, flex: 1 },
  value: { fontSize: 20, fontWeight: "900" },
  target: { fontSize: 11, color: C.muted },
  verdict: { fontSize: 22, fontWeight: "900" },
  bar: { height: 8, borderRadius: 4, backgroundColor: C.divider, overflow: "hidden" },
  barFill: { height: 8 },
  barTarget: { position: "absolute", top: -2, width: 2, height: 12, backgroundColor: C.onSurface },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, minHeight: 38, justifyContent: "center", borderRadius: 999, borderWidth: 1, borderColor: TEAL, backgroundColor: C.surfaceSecondary },
  chipOn: { backgroundColor: TEAL },
  chipTxt: { color: TEAL, fontWeight: "700", fontSize: 12.5 },
  chipTxtOn: { color: C.onSurfaceInverse },
});

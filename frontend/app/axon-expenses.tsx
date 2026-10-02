// axon-expenses.tsx — V50.z198 — BLOCCO 8 · Fase 2: Nota spese per sfera + Estratto conto (schermata ISOLATA)
// Sfera 🔵 Business / 🟢 Home (mai mescolate). Fotografa uno scontrino → Axon estrae importo/data/categoria → nota spese del mese.
// PDF esportabile (Master: anche per collaboratore). Estratto conto: PDF/foto → report categorizzato.
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Platform, Alert, Linking } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { useInsetsSafe } from "@/src/hooks/useSafeBottom";
import { api, getToken, BACKEND_URL } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { ExpenseStatsTab, ExpenseArchiveTab } from "@/src/ExpenseHistory"; // V50.z229 — storico spese
import Constants from "expo-constants";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

type Sphere = "business" | "home";
type Expense = { expense_id: string; merchant: string; amount: number; date: string; category: string; payment?: string | null; user_name?: string; file_path?: string | null; status?: "open" | "discarded" | "closed"; needs_review?: boolean };
type ListResp = { sphere: Sphere; month: string; items: Expense[]; total: number; by_category: Record<string, number>; categories: string[]; months: string[]; team: { user_id: string; name?: string; total: number; count: number }[]; can_export_team: boolean };
type Statement = { report_id: string; bank?: string | null; period?: string | null; income: number; outcome: number; net: number; sphere: Sphere; created_at: string; insights?: string[]; anomalies?: string[]; by_category?: { categoria: string; totale: number; n: number }[]; movements?: { data: string; descrizione: string; importo: number; categoria: string }[] };

const COLOR: Record<Sphere, string> = { business: "#2563EB", home: "#059669" };
const ICON: Record<Sphere, string> = { business: "🔵", home: "🟢" };
const backendUrl = () => (BACKEND_URL || (Constants.expoConfig?.extra as any)?.backendUrl || "").replace(/\/$/, "");

async function pickFile(camera: boolean): Promise<{ data_base64: string; mime: string; name: string } | null> {
  if (camera) {
    const perm = await ImagePicker.getCameraPermissionsAsync();
    if (!perm.granted) {
      const r = await (perm.canAskAgain ? ImagePicker.requestCameraPermissionsAsync() : Promise.resolve(perm));
      if (!r.granted) {
        if (!r.canAskAgain) Alert.alert("Fotocamera disattivata", "Per fotografare gli scontrini abilita la fotocamera nelle impostazioni.", [{ text: "Annulla", style: "cancel" }, { text: "Apri impostazioni", onPress: () => Linking.openSettings() }]);
        return null;
      }
    }
    const res = await ImagePicker.launchCameraAsync({ quality: 0.7, base64: true });
    if (res.canceled || !res.assets?.[0]?.base64) return null;
    return { data_base64: res.assets[0].base64, mime: res.assets[0].mimeType || "image/jpeg", name: res.assets[0].fileName || "scontrino.jpg" };
  }
  const res = await DocumentPicker.getDocumentAsync({ type: ["image/*", "application/pdf", "application/vnd.openxmlformats-officedocument.presentationml.presentation"], copyToCacheDirectory: true });
  if (res.canceled || !res.assets?.[0]) return null;
  const a = res.assets[0];
  const blob = await (await fetch(a.uri)).blob();
  const b64: string = await new Promise((resolve) => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result).split(",")[1] || ""); fr.readAsDataURL(blob); });
  return { data_base64: b64, mime: a.mimeType || (a.name?.endsWith(".pdf") ? "application/pdf" : "image/jpeg"), name: a.name || "file" };
}

export default function AxonExpensesScreen() {
  const router = useRouter();
  const insets = useInsetsSafe();
  const params = useLocalSearchParams<{ sphere?: string }>();
  const [sphere, setSphere] = useState<Sphere>(params.sphere === "home" ? "home" : "business");
  const [tab, setTab] = useState<"note" | "stats" | "archive" | "statements">("note");
  // V50.z229 — selezione ricevute per la chiusura mese (default: tutte le aperte) + mostra scartate
  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  const [showDiscarded, setShowDiscarded] = useState(false);
  const [month, setMonth] = useState<string>(new Date().toISOString().slice(0, 7));
  const [data, setData] = useState<ListResp | null>(null);
  const [stmts, setStmts] = useState<Statement[] | null>(null);
  const [open, setOpen] = useState<Statement | null>(null);
  const [busy, setBusy] = useState<string>("");
  const [teamUser, setTeamUser] = useState<string | null>(null);
  const color = COLOR[sphere];

  const load = useCallback(async () => {
    try {
      setData(await api<ListResp>("/axon/expenses", { query: { sphere, month, user_id: teamUser || undefined } }));
      setStmts((await api<{ items: Statement[] }>("/axon/expenses/statements", { query: { sphere } })).items);
    } catch (e: any) { notify("Spese", e?.message || String(e)); }
  }, [sphere, month, teamUser]);
  useEffect(() => { void load(); }, [load]);

  const upload = async (kind: "receipt" | "statement", camera: boolean) => {
    setBusy(kind);
    try {
      const f = await pickFile(camera);
      if (!f) return;
      const r = await api<any>(`/axon/expenses/${kind}`, { method: "POST", body: { sphere, ...f } });
      notify(`${ICON[sphere]} ${kind === "receipt" ? "Scontrino aggiunto" : "Estratto conto analizzato"}`, (r.reply || r.report?.reply || "").replace(/\*\*/g, ""));
      if (kind === "statement" && r.report) { setTab("statements"); setOpen(r.report); }
      await load();
    } catch (e: any) { notify("Axon", e?.message || String(e)); } finally { setBusy(""); }
  };

  const openPdf = async () => {
    const tok = await getToken();
    const url = `${backendUrl()}/api/axon/expenses/pdf?sphere=${sphere}&month=${month}${teamUser ? `&user_id=${teamUser}` : ""}&token=${encodeURIComponent(tok || "")}`;
    if (Platform.OS === "web") (globalThis as any).window.open(url, "_blank");
    else router.push({ pathname: "/(tabs)/webviewer", params: { url, title: `Nota spese ${month}` } } as any);
  };

  const removeExpense = (e: Expense) => {
    const go = async () => { await api(`/axon/expenses/${e.expense_id}`, { method: "DELETE" }); await load(); };
    if (Platform.OS === "web") { if ((globalThis as any).window.confirm(`Cancellare ${e.merchant} · ${e.amount.toFixed(2)} €?`)) void go(); return; }
    Alert.alert("Cancella spesa", `${e.merchant} · ${e.amount.toFixed(2)} €`, [{ text: "Annulla", style: "cancel" }, { text: "Cancella", style: "destructive", onPress: () => void go() }]);
  };
  const toggleSphere = async (e: Expense) => {
    await api(`/axon/expenses/${e.expense_id}`, { method: "PUT", body: { sphere: sphere === "business" ? "home" : "business" } }); await load();
    notify("Riclassificato", `Spostato nella sfera ${sphere === "business" ? "Home (privato)" : "Business"}`);
  };

  // V50.z229 — stato ricevuta (scarta/ripristina) e chiusura mese → PDF in I miei file (cartella spese/anno/mese)
  const setStatus = async (e: Expense, status: "open" | "discarded") => {
    try { await api(`/axon/expenses/${e.expense_id}/status`, { method: "PATCH", body: { status } }); await load(); } catch (err: any) { notify("Spese", err?.message || String(err)); }
  };
  const openItems = (data?.items || []).filter((e) => (e.status || "open") === "open");
  const discardedItems = (data?.items || []).filter((e) => e.status === "discarded");
  const closedItems = (data?.items || []).filter((e) => e.status === "closed");
  const selected = openItems.filter((e) => !deselected.has(e.expense_id));
  const selectedTotal = selected.reduce((a, e) => a + Number(e.amount || 0), 0);
  const toggleSel = (e: Expense) => setDeselected((s) => { const n = new Set(s); if (n.has(e.expense_id)) n.delete(e.expense_id); else n.add(e.expense_id); return n; });
  const closeMonth = () => {
    const go = async () => {
      setBusy("close");
      try {
        const r = await api<{ report: { name: string; total: number; count: number }; file: { file_id: string } }>("/axon/expenses/close-month", { method: "POST", body: { sphere, month, expense_ids: selected.map((e) => e.expense_id) } });
        notify("Mese chiuso ✅", `${r.report.name} · ${r.report.count} spese · ${r.report.total.toFixed(2)} € — salvato in I miei file e in Archivio`);
        setDeselected(new Set()); await load(); setTab("archive");
      } catch (err: any) { notify("Chiusura mese", err?.message || String(err)); } finally { setBusy(""); }
    };
    const msg = `${selected.length} spese · ${selectedTotal.toFixed(2)} € → PDF «Note spese ${monthLabel}». Le spese non selezionate restano aperte, le scartate escluse.`;
    if (Platform.OS === "web") { if ((globalThis as any).window.confirm(msg)) void go(); return; }
    Alert.alert("Chiudi mese", msg, [{ text: "Annulla", style: "cancel" }, { text: "Chiudi e crea PDF", onPress: () => void go() }]);
  };
  const monthLabel = new Date(month + "-01T00:00:00").toLocaleDateString("it-IT", { month: "long", year: "numeric" });

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: color }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} testID="axe-back"><Ionicons name="arrow-back" size={22} color="#FFF" /></Pressable>
        <View style={{ flex: 1 }}><Text style={styles.title}>Nota spese & Estratto conto</Text><Text style={styles.sub}>{ICON[sphere]} Sfera {sphere === "business" ? "Business" : "Home"} — AxonOS opera solo in questa sfera</Text></View>
      </View>

      <View style={styles.sphereRow}>
        {(["business", "home"] as Sphere[]).map((s) => (
          <Pressable key={s} onPress={() => { setSphere(s); setTeamUser(null); setOpen(null); }} style={[styles.sphereBtn, sphere === s && { backgroundColor: COLOR[s], borderColor: COLOR[s] }]} testID={`axe-sphere-${s}`}>
            <Text style={[styles.sphereTxt, sphere === s && { color: "#FFF" }]}>{ICON[s]} {s === "business" ? "Business" : "Home (privato)"}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.tabs}>
        <Pressable onPress={() => setTab("note")} style={[styles.tab, tab === "note" && { borderBottomColor: color }]} testID="axe-tab-note"><Text style={[styles.tabTxt, tab === "note" && { color }]}>Nota spese</Text></Pressable>
        <Pressable onPress={() => setTab("stats")} style={[styles.tab, tab === "stats" && { borderBottomColor: color }]} testID="axe-tab-stats"><Text style={[styles.tabTxt, tab === "stats" && { color }]}>Statistiche</Text></Pressable>
        <Pressable onPress={() => setTab("archive")} style={[styles.tab, tab === "archive" && { borderBottomColor: color }]} testID="axe-tab-archive"><Text style={[styles.tabTxt, tab === "archive" && { color }]}>Archivio</Text></Pressable>
        <Pressable onPress={() => setTab("statements")} style={[styles.tab, tab === "statements" && { borderBottomColor: color }]} testID="axe-tab-statements"><Text style={[styles.tabTxt, tab === "statements" && { color }]}>Estratti</Text></Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: insets.bottom + 120 }}>
        {tab === "stats" ? (
          <>
            <View style={styles.monthRow}>
              <Pressable onPress={() => { const d = new Date(month + "-01T00:00:00"); d.setMonth(d.getMonth() - 1); setMonth(d.toISOString().slice(0, 7)); }} hitSlop={10} style={styles.arrow} testID="axe-month-prev"><Ionicons name="chevron-back" size={20} color={HT.text} /></Pressable>
              <Text style={styles.monthTxt}>{monthLabel}</Text>
              <Pressable onPress={() => { const d = new Date(month + "-01T00:00:00"); d.setMonth(d.getMonth() + 1); setMonth(d.toISOString().slice(0, 7)); }} hitSlop={10} style={styles.arrow} testID="axe-month-next"><Ionicons name="chevron-forward" size={20} color={HT.text} /></Pressable>
            </View>
            <ExpenseStatsTab sphere={sphere} month={month} color={color} />
          </>
        ) : tab === "archive" ? (
          <ExpenseArchiveTab sphere={sphere} color={color} onChanged={() => void load()} />
        ) : tab === "note" ? (
          <>
            <View style={styles.actions}>
              <Pressable onPress={() => upload("receipt", true)} disabled={!!busy} style={[styles.big, { backgroundColor: color }]} testID="axe-receipt-camera">
                {busy === "receipt" ? <ActivityIndicator color="#FFF" /> : <><Ionicons name="camera" size={22} color="#FFF" /><Text style={styles.bigTxt}>Fotografa scontrino</Text></>}
              </Pressable>
              <Pressable onPress={() => upload("receipt", false)} disabled={!!busy} style={[styles.big, styles.ghost, { borderColor: color }]} testID="axe-receipt-file">
                <Ionicons name="attach" size={22} color={color} /><Text style={[styles.bigTxt, { color }]}>Allega foto/PDF</Text>
              </Pressable>
            </View>
            <View style={styles.monthRow}>
              <Pressable onPress={() => { const d = new Date(month + "-01T00:00:00"); d.setMonth(d.getMonth() - 1); setMonth(d.toISOString().slice(0, 7)); }} hitSlop={10} style={styles.arrow} testID="axe-month-prev"><Ionicons name="chevron-back" size={20} color={HT.text} /></Pressable>
              <Text style={styles.monthTxt}>{new Date(month + "-01T00:00:00").toLocaleDateString("it-IT", { month: "long", year: "numeric" })}</Text>
              <Pressable onPress={() => { const d = new Date(month + "-01T00:00:00"); d.setMonth(d.getMonth() + 1); setMonth(d.toISOString().slice(0, 7)); }} hitSlop={10} style={styles.arrow} testID="axe-month-next"><Ionicons name="chevron-forward" size={20} color={HT.text} /></Pressable>
            </View>
            {!data ? <ActivityIndicator color={color} /> : (
              <>
                <View style={[styles.card, { borderColor: color + "66" }]} testID="axe-summary">
                  <Text style={styles.total}>{data.items.filter((e) => e.status !== "discarded").reduce((a, e) => a + Number(e.amount || 0), 0).toFixed(2).replace(".", ",")} €</Text>
                  <Text style={styles.totalSub}>{data.items.filter((e) => e.status !== "discarded").length} spese{discardedItems.length ? ` (+${discardedItems.length} scartate)` : ""} · {ICON[sphere]} {sphere === "business" ? "Business" : "Home"}{teamUser ? ` · ${data.team.find((t) => t.user_id === teamUser)?.name || "collaboratore"}` : ""}</Text>
                  <View style={styles.cats}>{Object.entries(data.by_category).sort((a, b) => b[1] - a[1]).map(([k, v]) => <View key={k} style={[styles.chip, { borderColor: color + "55" }]}><Text style={styles.chipTxt}>{k} · {v.toFixed(2)} €</Text></View>)}</View>
                  <Pressable onPress={openPdf} disabled={!data.items.length} style={[styles.pdfBtn, { backgroundColor: data.items.length ? color : "#CBD5E1" }]} testID="axe-pdf"><Ionicons name="document-text" size={16} color="#FFF" /><Text style={styles.pdfTxt}>Esporta PDF nota spese</Text></Pressable>
                </View>
                {data.can_export_team && data.team.length > 0 && (
                  <View style={styles.card} testID="axe-team">
                    <Text style={styles.secTitle}>Team (Master) — tocca per vedere/esportare</Text>
                    <Pressable onPress={() => setTeamUser(null)} style={[styles.teamRow, !teamUser && { backgroundColor: HT.axonTint }]}><Text style={styles.teamName}>Tutto il team</Text></Pressable>
                    {data.team.map((t) => <Pressable key={t.user_id} onPress={() => setTeamUser(t.user_id)} style={[styles.teamRow, teamUser === t.user_id && { backgroundColor: HT.axonTint }]} testID={`axe-team-${t.user_id}`}><Text style={styles.teamName}>{t.name || t.user_id}</Text><Text style={styles.teamTot}>{t.count} · {t.total.toFixed(2)} €</Text></Pressable>)}
                  </View>
                )}
                {data.items.length === 0 ? <Text style={styles.empty}>Nessuna spesa in questo mese. Fotografa uno scontrino: Axon fa il resto.</Text> : (
                  <>
                    {/* V50.z229 — Chiusura mese: seleziona/scarta, poi PDF «Note spese <mese anno>» in I miei file + Archivio */}
                    {openItems.length > 0 && (
                      <View style={[styles.card, { borderColor: color + "66" }]} testID="axe-close-bar">
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                          <Pressable onPress={() => setDeselected(selected.length === openItems.length ? new Set(openItems.map((e) => e.expense_id)) : new Set())} hitSlop={8} testID="axe-select-all">
                            <Ionicons name={selected.length === openItems.length ? "checkbox" : "square-outline"} size={22} color={color} />
                          </Pressable>
                          <Text style={{ flex: 1, fontWeight: "800", color: HT.text, fontSize: 13 }}>{selected.length}/{openItems.length} ricevute selezionate · {selectedTotal.toFixed(2).replace(".", ",")} €</Text>
                        </View>
                        <Pressable onPress={closeMonth} disabled={!selected.length || busy === "close"} style={[styles.pdfBtn, { backgroundColor: selected.length ? color : "#CBD5E1" }]} testID="axe-close-month">
                          {busy === "close" ? <ActivityIndicator color="#FFF" /> : <><Ionicons name="lock-closed" size={16} color="#FFF" /><Text style={styles.pdfTxt}>Chiudi mese → PDF «Note spese {monthLabel}»</Text></>}
                        </Pressable>
                        <Text style={styles.hintTxt}>Tocca la casella per escludere una ricevuta dal mese; «Scarta» la toglie dai conteggi. Il PDF finisce in I miei file, catalogato per anno e mese.</Text>
                      </View>
                    )}
                    {openItems.map((e) => (
                      <View key={e.expense_id} style={[styles.row, deselected.has(e.expense_id) && { opacity: 0.55 }]} testID={`axe-item-${e.expense_id}`}>
                        <Pressable onPress={() => toggleSel(e)} hitSlop={8} testID={`axe-sel-${e.expense_id}`}><Ionicons name={deselected.has(e.expense_id) ? "square-outline" : "checkbox"} size={22} color={color} /></Pressable>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.rowTitle}>{e.merchant}{e.needs_review ? " ⚠️" : ""}</Text>
                          <Text style={styles.rowMeta}>{e.date} · {e.category}{e.payment ? ` · ${e.payment}` : ""}{e.user_name && data.can_export_team ? ` · ${e.user_name}` : ""}</Text>
                        </View>
                        <Text style={[styles.rowAmt, { color }]}>{e.amount.toFixed(2).replace(".", ",")} €</Text>
                        <Pressable onPress={() => setStatus(e, "discarded")} hitSlop={6} style={styles.iconBtn} testID={`axe-discard-${e.expense_id}`} accessibilityLabel="Scarta"><Ionicons name="close-circle-outline" size={20} color={HT.warning} /></Pressable>
                        <Pressable onPress={() => toggleSphere(e)} hitSlop={6} style={styles.iconBtn} testID={`axe-swap-${e.expense_id}`}><Ionicons name="swap-horizontal" size={18} color={HT.muted} /></Pressable>
                        <Pressable onPress={() => removeExpense(e)} hitSlop={6} style={styles.iconBtn} testID={`axe-del-${e.expense_id}`}><Ionicons name="trash-outline" size={18} color="#DC2626" /></Pressable>
                      </View>
                    ))}
                    {closedItems.length > 0 && <Text style={styles.groupLbl}>🔒 Incluse nel mese chiuso ({closedItems.length}) — riapri dall&apos;Archivio per modificarle</Text>}
                    {closedItems.map((e) => (
                      <View key={e.expense_id} style={[styles.row, { backgroundColor: HT.card2 }]} testID={`axe-item-${e.expense_id}`}>
                        <Ionicons name="lock-closed" size={18} color={HT.muted} />
                        <View style={{ flex: 1 }}><Text style={[styles.rowTitle, { color: HT.muted }]}>{e.merchant}</Text><Text style={styles.rowMeta}>{e.date} · {e.category}</Text></View>
                        <Text style={[styles.rowAmt, { color: HT.muted }]}>{e.amount.toFixed(2).replace(".", ",")} €</Text>
                      </View>
                    ))}
                    {discardedItems.length > 0 && (
                      <Pressable onPress={() => setShowDiscarded((v) => !v)} style={styles.groupBtn} testID="axe-toggle-discarded"><Text style={styles.groupLbl}>{showDiscarded ? "▾" : "▸"} Scartate ({discardedItems.length})</Text></Pressable>
                    )}
                    {showDiscarded && discardedItems.map((e) => (
                      <View key={e.expense_id} style={[styles.row, { opacity: 0.7 }]} testID={`axe-item-${e.expense_id}`}>
                        <Ionicons name="close-circle" size={18} color={HT.warning} />
                        <View style={{ flex: 1 }}><Text style={[styles.rowTitle, { textDecorationLine: "line-through" }]}>{e.merchant}</Text><Text style={styles.rowMeta}>{e.date} · {e.category}</Text></View>
                        <Text style={[styles.rowAmt, { color: HT.muted }]}>{e.amount.toFixed(2).replace(".", ",")} €</Text>
                        <Pressable onPress={() => setStatus(e, "open")} hitSlop={6} style={styles.iconBtn} testID={`axe-restore-${e.expense_id}`}><Ionicons name="refresh" size={18} color="#16A34A" /></Pressable>
                        <Pressable onPress={() => removeExpense(e)} hitSlop={6} style={styles.iconBtn} testID={`axe-del-${e.expense_id}`}><Ionicons name="trash-outline" size={18} color="#DC2626" /></Pressable>
                      </View>
                    ))}
                  </>
                )}
              </>
            )}
          </>
        ) : (
          <>
            <View style={styles.actions}>
              <Pressable onPress={() => upload("statement", false)} disabled={!!busy} style={[styles.big, { backgroundColor: color }]} testID="axe-statement-file">
                {busy === "statement" ? <ActivityIndicator color="#FFF" /> : <><Ionicons name="document-attach" size={22} color="#FFF" /><Text style={styles.bigTxt}>Allega estratto conto (PDF/foto)</Text></>}
              </Pressable>
            </View>
            <Text style={styles.hint}>Nessuna connessione alla banca: Axon legge solo il file che alleghi, categorizza i movimenti e produce il report qui e in Sezione Report.</Text>
            {open && (
              <View style={[styles.card, { borderColor: color + "66" }]} testID="axe-statement-detail">
                <View style={{ flexDirection: "row", alignItems: "center" }}><Text style={[styles.secTitle, { flex: 1 }]}>{open.bank || "Estratto conto"} · {open.period || ""}</Text><Pressable onPress={() => setOpen(null)} hitSlop={8}><Ionicons name="close" size={20} color={HT.muted} /></Pressable></View>
                <View style={styles.kpis}>
                  <View style={styles.kpi}><Text style={styles.kpiL}>Entrate</Text><Text style={[styles.kpiV, { color: "#059669" }]}>{open.income.toFixed(2)} €</Text></View>
                  <View style={styles.kpi}><Text style={styles.kpiL}>Uscite</Text><Text style={[styles.kpiV, { color: "#DC2626" }]}>{open.outcome.toFixed(2)} €</Text></View>
                  <View style={styles.kpi}><Text style={styles.kpiL}>Netto</Text><Text style={styles.kpiV}>{open.net.toFixed(2)} €</Text></View>
                </View>
                {(open.by_category || []).slice(0, 8).map((c, i) => <Text key={i} style={styles.line}>• {c.categoria}: {Number(c.totale).toFixed(2)} € ({c.n})</Text>)}
                {(open.insights || []).map((s, i) => <Text key={`i${i}`} style={styles.insight}>💡 {s}</Text>)}
                {(open.anomalies || []).map((s, i) => <Text key={`a${i}`} style={[styles.insight, { color: HT.warning }]}>⚠️ {s}</Text>)}
                {(open.movements || []).slice(0, 40).map((m, i) => <Text key={`m${i}`} style={styles.mov}>{m.data} · {m.descrizione} · <Text style={{ fontWeight: "800", color: Number(m.importo) < 0 ? "#DC2626" : "#059669" }}>{Number(m.importo).toFixed(2)} €</Text> · {m.categoria}</Text>)}
              </View>
            )}
            {!stmts ? <ActivityIndicator color={color} /> : stmts.length === 0 ? <Text style={styles.empty}>Nessun estratto conto analizzato in questa sfera.</Text> : stmts.map((s) => (
              <Pressable key={s.report_id} onPress={async () => setOpen(await api<Statement>(`/axon/expenses/statements/${s.report_id}`))} style={styles.row} testID={`axe-statement-${s.report_id}`}>
                <Ionicons name="document-text" size={20} color={color} />
                <View style={{ flex: 1 }}><Text style={styles.rowTitle}>{s.bank || "Estratto conto"} · {s.period || ""}</Text><Text style={styles.rowMeta}>Entrate {s.income.toFixed(2)} € · Uscite {s.outcome.toFixed(2)} € · {new Date(s.created_at).toLocaleDateString("it-IT")}</Text></View>
                <Ionicons name="chevron-forward" size={16} color={HT.muted} />
              </Pressable>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: HT.bg },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  title: { color: "#FFF", fontWeight: "800", fontSize: 17 }, sub: { color: "#FFFFFFCC", fontSize: 12 },
  sphereRow: { flexDirection: "row", gap: 8, padding: 12, paddingBottom: 4 },
  sphereBtn: { flex: 1, minHeight: 44, borderRadius: 12, borderWidth: 1.5, borderColor: HT.border, backgroundColor: HT.card, alignItems: "center", justifyContent: "center" },
  sphereTxt: { fontWeight: "800", color: HT.text, fontSize: 13 },
  tabs: { flexDirection: "row", paddingHorizontal: 12 },
  tab: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", borderBottomWidth: 3, borderBottomColor: "transparent" },
  tabTxt: { fontWeight: "800", color: HT.muted, fontSize: 13.5 },
  actions: { flexDirection: "row", gap: 8 },
  big: { flex: 1, minHeight: 64, borderRadius: 16, alignItems: "center", justifyContent: "center", gap: 4, paddingHorizontal: 8 },
  ghost: { backgroundColor: HT.card, borderWidth: 1.5 },
  bigTxt: { color: "#FFF", fontWeight: "800", fontSize: 12.5, textAlign: "center" },
  monthRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12 },
  arrow: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 20, backgroundColor: HT.card },
  monthTxt: { fontSize: 15, fontWeight: "800", color: HT.text, textTransform: "capitalize", minWidth: 150, textAlign: "center" },
  card: { backgroundColor: HT.card, borderRadius: 16, borderWidth: 1.5, borderColor: '#EEF0F6', padding: 14, gap: 8 },
  total: { fontSize: 32, fontWeight: "900", color: HT.text }, totalSub: { fontSize: 12.5, color: HT.muted },
  cats: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5 }, chipTxt: { fontSize: 12, fontWeight: "700", color: HT.text },
  pdfBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 46, borderRadius: 12, marginTop: 4 }, pdfTxt: { color: "#FFF", fontWeight: "800", fontSize: 13.5 },
  secTitle: { fontSize: 12.5, fontWeight: "800", color: HT.muted, textTransform: "uppercase", letterSpacing: 0.4 },
  teamRow: { flexDirection: "row", alignItems: "center", minHeight: 44, paddingHorizontal: 10, borderRadius: 10 }, teamName: { flex: 1, fontWeight: "700", color: HT.text, fontSize: 13.5 }, teamTot: { fontWeight: "800", color: HT.text, fontSize: 13 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: HT.card, borderRadius: 12, borderWidth: 1, borderColor: '#EEF0F6', padding: 10, minHeight: 56 },
  catDot: { width: 8, height: 8, borderRadius: 4 }, rowTitle: { fontSize: 14, fontWeight: "700", color: HT.text }, rowMeta: { fontSize: 11.5, color: HT.muted, marginTop: 1 }, rowAmt: { fontSize: 15, fontWeight: "900" },
  iconBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  hintTxt: { fontSize: 11.5, color: HT.muted, marginTop: 8, lineHeight: 15 }, // V50.z229
  groupLbl: { fontSize: 12.5, fontWeight: "800", color: HT.muted, marginTop: 6 },
  groupBtn: { minHeight: 40, justifyContent: "center" },
  empty: { fontSize: 13, color: HT.muted, fontStyle: "italic", textAlign: "center", paddingVertical: 12 },
  hint: { fontSize: 12, color: HT.muted, lineHeight: 17 },
  kpis: { flexDirection: "row", gap: 8 }, kpi: { flex: 1, backgroundColor: HT.card2, borderRadius: 10, padding: 8, alignItems: "center" }, kpiL: { fontSize: 11, color: HT.muted }, kpiV: { fontSize: 15, fontWeight: "900", color: HT.text },
  line: { fontSize: 13, color: HT.text }, insight: { fontSize: 12.5, color: HT.axon, lineHeight: 17 }, mov: { fontSize: 11.5, color: HT.text2, borderTopWidth: 1, borderTopColor: HT.card2, paddingTop: 4 },
});

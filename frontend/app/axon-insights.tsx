// V50.z188 — Blocco 7: Autoapprendimento AxonOS — dashboard Master (modulo isolato)
// Knowledge base interno (`axon_knowledge_base`): insight anonimizzati estratti in background dalle
// conversazioni concluse. Il Master vede statistiche, filtra per categoria/tipo, revisiona, modifica,
// disattiva (non usato da Axon) o cancella i record; "Analizza ora" processa subito le sessioni concluse.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, RefreshControl, Alert, Platform } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useInsetsSafe } from "@/src/hooks/useSafeBottom";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

const PURPLE = "#7C3AED";
type Insight = { id: string; category: string; kind: "faq" | "topic" | "gap"; insight: string; frequency: number; updated_at: string; enabled: boolean; reviewed: boolean; source_sessions?: number };
type Stats = { total: number; disabled: number; sessions_analyzed: number; sessions_pending: number; last_run_at: string | null; by_category: { category: string; count: number; frequency: number }[]; by_kind: Record<string, number>; global_shared: number };
const KIND_LABEL: Record<string, string> = { faq: "Domanda frequente", topic: "Argomento", gap: "Lacuna" };
const KIND_COLOR: Record<string, string> = { faq: "#2563EB", topic: "#059669", gap: "#DC2626" };

export default function AxonInsightsScreen() {
  const router = useRouter();
  const insets = useInsetsSafe();
  const [items, setItems] = useState<Insight[]>([]);
  const [cats, setCats] = useState<string[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [cat, setCat] = useState<string | null>(null);
  const [kind, setKind] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editTxt, setEditTxt] = useState("");

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams();
      if (cat) p.set("category", cat);
      if (kind) p.set("kind", kind);
      if (q.trim()) p.set("q", q.trim());
      const [l, s] = await Promise.all([
        api<{ items: Insight[]; categories: string[] }>(`/axon/kb-insights?${p.toString()}`),
        api<Stats>("/axon/kb-insights/stats"),
      ]);
      setItems(l.items); setCats(l.categories); setStats(s);
    } catch (e: any) {
      notify("Errore", e?.message || String(e));
    } finally { setLoading(false); }
  }, [cat, kind, q]);
  useEffect(() => { void load(); }, [load]);

  const runNow = async () => {
    setRunning(true);
    try {
      const r = await api<{ sessions: number; insights: number; added: number; merged: number }>("/axon/kb-insights/run?idle_min=0", { method: "POST" });
      notify("Analisi completata", r.sessions ? `${r.sessions} conversazioni analizzate · ${r.added} nuovi insight · ${r.merged} rafforzati` : "Nessuna nuova conversazione conclusa da analizzare.");
      await load();
    } catch (e: any) { notify("Errore", e?.message || String(e)); } finally { setRunning(false); }
  };

  const patch = async (id: string, body: Partial<Insight>) => {
    try {
      const u = await api<Insight>(`/axon/kb-insights/${id}`, { method: "PUT", body });
      setItems((prev) => prev.map((i) => (i.id === id ? u : i)));
    } catch (e: any) { notify("Errore", e?.message || String(e)); }
  };
  const remove = (id: string) => {
    const doIt = async () => { try { await api(`/axon/kb-insights/${id}`, { method: "DELETE" }); setItems((p) => p.filter((i) => i.id !== id)); void load(); } catch (e: any) { notify("Errore", e?.message || String(e)); } };
    if (Platform.OS === "web") { if (typeof window !== "undefined" && window.confirm("Eliminare questo insight?")) void doIt(); return; }
    Alert.alert("Elimina insight", "Il record sarà rimosso definitivamente dal knowledge base.", [{ text: "Annulla", style: "cancel" }, { text: "Elimina", style: "destructive", onPress: () => { void doIt(); } }]);
  };
  const removeAll = () => {
    const doIt = async () => { try { await api("/axon/kb-insights", { method: "DELETE" }); await load(); } catch (e: any) { notify("Errore", e?.message || String(e)); } };
    if (Platform.OS === "web") { if (typeof window !== "undefined" && window.confirm("Svuotare TUTTO il knowledge base appreso?")) void doIt(); return; }
    Alert.alert("Svuota knowledge base", "Tutti gli insight appresi del tuo team saranno cancellati. Continuare?", [{ text: "Annulla", style: "cancel" }, { text: "Svuota", style: "destructive", onPress: () => { void doIt(); } }]);
  };

  const catCount = useMemo(() => Object.fromEntries((stats?.by_category || []).map((c) => [c.category, c.count])), [stats]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} testID="insights-back"><Ionicons name="arrow-back" size={22} color="#FFF" /></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Autoapprendimento Axon</Text>
          <Text style={styles.sub}>Insight anonimizzati dalle conversazioni · knowledge base interno</Text>
        </View>
        <Pressable onPress={runNow} disabled={running} style={styles.runBtn} testID="insights-run">
          {running ? <ActivityIndicator size="small" color={HT.violet} /> : <Ionicons name="flash" size={16} color={HT.violet} />}
          <Text style={styles.runTxt}>Analizza ora</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: insets.bottom + 120, gap: 12 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />} keyboardShouldPersistTaps="handled">
        {stats && (
          <View style={styles.statsRow}>
            {[["Insight", stats.total], ["Conversazioni", stats.sessions_analyzed], ["In coda", stats.sessions_pending], ["Disattivati", stats.disabled]].map(([l, v]) => (
              <View key={String(l)} style={styles.statBox}><Text style={styles.statNum}>{v as number}</Text><Text style={styles.statLbl}>{l as string}</Text></View>
            ))}
          </View>
        )}
        <View style={styles.privacyBox}>
          <Ionicons name="shield-checkmark" size={16} color={HT.success} />
          <Text style={styles.privacyTxt}>Ogni conversazione conclusa viene analizzata in background: nomi, cifre, date, contatti, contratti e riferimenti personali vengono rimossi automaticamente (doppio filtro) prima del salvataggio. Axon usa questi insight come contesto per rispondere meglio nel tempo.{stats?.last_run_at ? ` Ultima analisi: ${new Date(stats.last_run_at).toLocaleString("it-IT")}.` : ""}</Text>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          <Pressable onPress={() => setCat(null)} style={[styles.chip, !cat && styles.chipOn]}><Text style={[styles.chipTxt, !cat && { color: "#FFF" }]}>Tutte</Text></Pressable>
          {cats.map((c) => (
            <Pressable key={c} onPress={() => setCat(cat === c ? null : c)} style={[styles.chip, cat === c && styles.chipOn]} testID={`insights-cat-${c}`}>
              <Text style={[styles.chipTxt, cat === c && { color: "#FFF" }]}>{c}{catCount[c] ? ` · ${catCount[c]}` : ""}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <View style={{ flexDirection: "row", gap: 6 }}>
          {(["faq", "topic", "gap"] as const).map((k) => (
            <Pressable key={k} onPress={() => setKind(kind === k ? null : k)} style={[styles.kindChip, { borderColor: KIND_COLOR[k] }, kind === k && { backgroundColor: KIND_COLOR[k] }]} testID={`insights-kind-${k}`}>
              <Text style={[styles.kindTxt, { color: kind === k ? "#FFF" : KIND_COLOR[k] }]}>{KIND_LABEL[k]}{stats?.by_kind?.[k] ? ` ${stats.by_kind[k]}` : ""}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.search}>
          <Ionicons name="search" size={16} color={HT.muted} />
          <TextInput value={q} onChangeText={setQ} placeholder="Cerca negli insight…" placeholderTextColor={HT.muted} style={styles.searchInput} testID="insights-search" />
        </View>

        {loading && items.length === 0 ? <ActivityIndicator color={HT.violet} style={{ marginTop: 30 }} /> : items.length === 0 ? (
          <View style={styles.empty}><Ionicons name="school-outline" size={36} color="#C4B5FD" /><Text style={styles.emptyTxt}>Nessun insight ancora. Le conversazioni concluse vengono analizzate ogni 10 minuti, oppure premi «Analizza ora».</Text></View>
        ) : items.map((it) => (
          <View key={it.id} style={[styles.card, !it.enabled && { opacity: 0.55 }]} testID={`insight-${it.id}`}>
            <View style={styles.cardTop}>
              <View style={[styles.kindDot, { backgroundColor: KIND_COLOR[it.kind] }]} />
              <Text style={styles.cardCat}>{it.category} · {KIND_LABEL[it.kind]}</Text>
              <View style={styles.freq}><Ionicons name="repeat" size={12} color={HT.violet} /><Text style={styles.freqTxt}>×{it.frequency}</Text></View>
            </View>
            {editId === it.id ? (
              <View style={{ gap: 8 }}>
                <TextInput value={editTxt} onChangeText={setEditTxt} multiline style={styles.editInput} testID="insight-edit-input" />
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Pressable onPress={() => setEditId(null)} style={styles.smallBtn}><Text style={styles.smallBtnTxt}>Annulla</Text></Pressable>
                  <Pressable onPress={async () => { await patch(it.id, { insight: editTxt, reviewed: true } as any); setEditId(null); }} style={[styles.smallBtn, { backgroundColor: PURPLE }]} testID="insight-edit-save"><Text style={[styles.smallBtnTxt, { color: "#FFF" }]}>Salva</Text></Pressable>
                </View>
              </View>
            ) : (
              <Text style={styles.cardTxt}>{it.insight}</Text>
            )}
            <View style={styles.cardFoot}>
              <Text style={styles.cardMeta}>{it.reviewed ? "✓ revisionato" : "da revisionare"} · {new Date(it.updated_at).toLocaleDateString("it-IT")}</Text>
              <View style={{ flexDirection: "row", gap: 4 }}>
                {!it.reviewed && <Pressable onPress={() => patch(it.id, { reviewed: true } as any)} hitSlop={6} style={styles.iconBtn} testID={`insight-review-${it.id}`}><Ionicons name="checkmark-done" size={18} color="#059669" /></Pressable>}
                <Pressable onPress={() => { setEditId(it.id); setEditTxt(it.insight); }} hitSlop={6} style={styles.iconBtn} testID={`insight-edit-${it.id}`}><Ionicons name="create-outline" size={18} color={HT.text} /></Pressable>
                <Pressable onPress={() => patch(it.id, { enabled: !it.enabled } as any)} hitSlop={6} style={styles.iconBtn} testID={`insight-toggle-${it.id}`}><Ionicons name={it.enabled ? "eye" : "eye-off"} size={18} color={it.enabled ? PURPLE : HT.muted} /></Pressable>
                <Pressable onPress={() => remove(it.id)} hitSlop={6} style={styles.iconBtn} testID={`insight-delete-${it.id}`}><Ionicons name="trash-outline" size={18} color="#DC2626" /></Pressable>
              </View>
            </View>
          </View>
        ))}

        {items.length > 0 && (
          <Pressable onPress={removeAll} style={styles.dangerBtn} testID="insights-delete-all">
            <Ionicons name="trash" size={16} color={HT.danger} /><Text style={styles.dangerTxt}>Svuota tutto il knowledge base appreso</Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: HT.bg },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: PURPLE },
  title: { color: "#FFF", fontWeight: "800", fontSize: 17 },
  sub: { color: "#E9D5FF", fontSize: 11, marginTop: 1 },
  runBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: HT.card, paddingHorizontal: 12, minHeight: 40, borderRadius: 12 },
  runTxt: { color: HT.violet, fontWeight: "800", fontSize: 12 },
  statsRow: { flexDirection: "row", gap: 8 },
  statBox: { flex: 1, backgroundColor: HT.card, borderRadius: 12, padding: 10, alignItems: "center", borderWidth: 1, borderColor: '#E9D5FF' },
  statNum: { fontSize: 20, fontWeight: "800", color: HT.violet },
  statLbl: { fontSize: 10, color: HT.muted, marginTop: 2, fontWeight: "700" },
  privacyBox: { flexDirection: "row", gap: 8, backgroundColor: HT.successTint, borderRadius: 12, padding: 10, borderWidth: 1, borderColor: '#A7F3D0' },
  privacyTxt: { flex: 1, fontSize: 11.5, color: HT.success, lineHeight: 16 },
  chip: { paddingHorizontal: 12, minHeight: 34, borderRadius: 17, backgroundColor: HT.card, borderWidth: 1, borderColor: HT.violet + '66', justifyContent: "center" },
  chipOn: { backgroundColor: PURPLE, borderColor: HT.violet },
  chipTxt: { fontSize: 12, fontWeight: "700", color: HT.violet },
  kindChip: { flex: 1, minHeight: 36, borderRadius: 10, borderWidth: 1.5, alignItems: "center", justifyContent: "center", backgroundColor: HT.card },
  kindTxt: { fontSize: 12, fontWeight: "800" },
  search: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: HT.card, borderRadius: 12, paddingHorizontal: 12, minHeight: 44, borderWidth: 1, borderColor: HT.border },
  searchInput: { flex: 1, fontSize: 14, color: HT.text, paddingVertical: 8 },
  empty: { alignItems: "center", gap: 10, padding: 30 },
  emptyTxt: { textAlign: "center", color: HT.muted, fontSize: 13, lineHeight: 19 },
  card: { backgroundColor: HT.card, borderRadius: 14, padding: 12, gap: 8, borderWidth: 1, borderColor: HT.violetTint },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  kindDot: { width: 8, height: 8, borderRadius: 4 },
  cardCat: { flex: 1, fontSize: 11, fontWeight: "800", color: HT.muted, textTransform: "uppercase", letterSpacing: 0.4 },
  freq: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: HT.violetTint, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  freqTxt: { fontSize: 11, fontWeight: "800", color: HT.violet },
  cardTxt: { fontSize: 14, lineHeight: 20, color: HT.text },
  cardFoot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardMeta: { fontSize: 11, color: HT.muted },
  iconBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 10 },
  editInput: { backgroundColor: HT.card2, borderRadius: 10, borderWidth: 1, borderColor: HT.border, padding: 10, minHeight: 70, fontSize: 14, color: HT.text, textAlignVertical: "top" },
  smallBtn: { flex: 1, minHeight: 40, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: HT.card2 },
  smallBtnTxt: { fontWeight: "800", color: HT.text, fontSize: 13 },
  dangerBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: '#FCA5A5', backgroundColor: HT.dangerTint, marginTop: 8 },
  dangerTxt: { color: HT.danger, fontWeight: "800", fontSize: 13 },
});

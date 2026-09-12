// V50.z192 — BLOCCO 9b: "Cosa sa Axon di me" (Profilo → Memoria AxonOS) — schermata isolata.
// Linguaggio semplice e rassicurante: Axon ti conosce, ma il controllo è tuo (modifica, cancella, ri-analizza).
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, RefreshControl, Alert, Platform } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useInsetsSafe } from "@/src/hooks/useSafeBottom";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";

const PURPLE = "#7C3AED";
type Item = { id: string; section: string; text: string; source: "auto" | "manual"; confidence: number; evidence?: string | null; updated_at: string };
type Section = { key: string; label: string; icon: string; intro: string; items: Item[] };
type Data = { sections: Section[]; stats: { total: number; manual: number; forgotten: number }; last_analyzed_at: string | null };

function confirmAsync(title: string, msg: string, okLabel: string, onOk: () => void) {
  if (Platform.OS === "web") { if (typeof window !== "undefined" && window.confirm(`${title}\n\n${msg}`)) onOk(); return; }
  Alert.alert(title, msg, [{ text: "Annulla", style: "cancel" }, { text: okLabel, style: "destructive", onPress: onOk }]);
}

export default function AxonMemoryScreen() {
  const router = useRouter();
  const insets = useInsetsSafe();
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editTxt, setEditTxt] = useState("");
  const [addSec, setAddSec] = useState<string | null>(null);
  const [addTxt, setAddTxt] = useState("");

  const load = useCallback(async () => {
    try { setData(await api<Data>("/axon/memory")); } catch (e: any) { notify("Errore", e?.message || String(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const analyze = async () => {
    setAnalyzing(true);
    try { const r = await api<{ items: number }>("/axon/memory/analyze", { method: "POST" }); await load(); notify("Profilo aggiornato", `Axon ha rivisto ${r.items} cose che sa di te, dalle conversazioni e attività recenti.`); }
    catch (e: any) { notify("Errore", e?.message || String(e)); } finally { setAnalyzing(false); }
  };
  const saveEdit = async (it: Item) => {
    if (editTxt.trim().length < 3) return;
    try { await api(`/axon/memory/${it.id}`, { method: "PUT", body: { text: editTxt.trim() } }); setEditId(null); await load(); }
    catch (e: any) { notify("Errore", e?.message || String(e)); }
  };
  const remove = (it: Item) => confirmAsync("Dimentica questa voce", `Axon non terrà più conto di:\n«${it.text}»`, "Dimentica", async () => {
    try { await api(`/axon/memory/${it.id}`, { method: "DELETE" }); await load(); } catch (e: any) { notify("Errore", e?.message || String(e)); }
  });
  const removeAll = () => confirmAsync("Cancella tutta la memoria", "Axon dimenticherà tutto quello che ha imparato su di te (preferenze, clienti chiave, stile di lavoro, argomenti). I tuoi contatti e i tuoi dati CRM NON vengono toccati. Continuare?", "Cancella tutto", async () => {
    try { await api("/axon/memory", { method: "DELETE" }); await load(); notify("Memoria cancellata", "Axon ricomincia da zero: imparerà di nuovo solo da ciò che farai da ora in avanti."); }
    catch (e: any) { notify("Errore", e?.message || String(e)); }
  });
  const add = async () => {
    if (!addSec || addTxt.trim().length < 3) return;
    try { await api("/axon/memory", { method: "POST", body: { section: addSec, text: addTxt.trim() } }); setAddSec(null); setAddTxt(""); await load(); }
    catch (e: any) { notify("Errore", e?.message || String(e)); }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} testID="memory-back"><Ionicons name="arrow-back" size={22} color="#FFF" /></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Cosa sa Axon di me</Text>
          <Text style={styles.sub}>Memoria AxonOS · tu hai il controllo</Text>
        </View>
        <Pressable onPress={analyze} disabled={analyzing} style={styles.runBtn} testID="memory-analyze">
          {analyzing ? <ActivityIndicator size="small" color={PURPLE} /> : <Ionicons name="refresh" size={16} color={PURPLE} />}
          <Text style={styles.runTxt}>Analizza di nuovo</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: insets.bottom + 120, gap: 12 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />} keyboardShouldPersistTaps="handled">
        <View style={styles.trust}>
          <Ionicons name="shield-checkmark" size={20} color="#065F46" />
          <Text style={styles.trustTxt}>
            Qui vedi, in parole semplici, tutto quello che Axon ha imparato su di te per aiutarti meglio. Ogni voce è tua: puoi correggerla, cancellarla o far dimenticare tutto. Nulla di questo esce dal tuo spazio.
            {data?.last_analyzed_at ? `\nUltima analisi: ${new Date(data.last_analyzed_at).toLocaleString("it-IT")}.` : ""}
          </Text>
        </View>
        {data && (
          <View style={styles.statsRow}>
            {[["Cose che sa", data.stats.total], ["Scritte da te", data.stats.manual], ["Dimenticate", data.stats.forgotten]].map(([l, v]) => (
              <View key={String(l)} style={styles.statBox}><Text style={styles.statNum}>{v as number}</Text><Text style={styles.statLbl}>{l as string}</Text></View>
            ))}
          </View>
        )}

        {loading && !data ? <ActivityIndicator color={PURPLE} style={{ marginTop: 30 }} /> : data?.sections.map((s) => (
          <View key={s.key} style={styles.card} testID={`memory-sec-${s.key}`}>
            <View style={styles.cardHead}>
              <View style={styles.secIcon}><Ionicons name={s.icon as any} size={16} color={PURPLE} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.secTitle}>{s.label}</Text>
                <Text style={styles.secIntro}>{s.intro}</Text>
              </View>
              <Pressable onPress={() => { setAddSec(addSec === s.key ? null : s.key); setAddTxt(""); }} hitSlop={8} style={styles.iconBtn} testID={`memory-add-${s.key}`}>
                <Ionicons name="add-circle-outline" size={22} color={PURPLE} />
              </Pressable>
            </View>
            {addSec === s.key && (
              <View style={styles.editRow}>
                <TextInput value={addTxt} onChangeText={setAddTxt} placeholder="Scrivi qualcosa che Axon deve sapere…" placeholderTextColor="#94A3B8" style={styles.input} multiline testID="memory-add-input" />
                <Pressable onPress={add} disabled={addTxt.trim().length < 3} style={[styles.saveBtn, addTxt.trim().length < 3 && { opacity: 0.5 }]} testID="memory-add-save"><Ionicons name="checkmark" size={18} color="#FFF" /></Pressable>
              </View>
            )}
            {s.items.length === 0 ? (
              <Text style={styles.emptyTxt}>Axon non ha ancora notato nulla qui. Puoi aggiungere tu una voce con «+».</Text>
            ) : s.items.map((it) => (
              <View key={it.id} style={styles.item} testID={`memory-item-${it.id}`}>
                {editId === it.id ? (
                  <View style={styles.editRow}>
                    <TextInput value={editTxt} onChangeText={setEditTxt} style={styles.input} multiline autoFocus testID="memory-edit-input" />
                    <Pressable onPress={() => saveEdit(it)} style={styles.saveBtn} testID="memory-edit-save"><Ionicons name="checkmark" size={18} color="#FFF" /></Pressable>
                    <Pressable onPress={() => setEditId(null)} style={[styles.saveBtn, { backgroundColor: "#E5E7EB" }]}><Ionicons name="close" size={18} color="#1B2B4B" /></Pressable>
                  </View>
                ) : (
                  <>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.itemTxt}>{it.text}</Text>
                      <Text style={styles.itemMeta}>{it.source === "manual" ? "✎ scritto da te" : `dedotto da Axon${it.evidence ? ` · ${it.evidence}` : ""}`}</Text>
                    </View>
                    <Pressable onPress={() => { setEditId(it.id); setEditTxt(it.text); }} hitSlop={6} style={styles.iconBtn} testID={`memory-edit-${it.id}`}><Ionicons name="create-outline" size={18} color="#1B2B4B" /></Pressable>
                    <Pressable onPress={() => remove(it)} hitSlop={6} style={styles.iconBtn} testID={`memory-delete-${it.id}`}><Ionicons name="trash-outline" size={18} color="#DC2626" /></Pressable>
                  </>
                )}
              </View>
            ))}
          </View>
        ))}

        <Pressable onPress={removeAll} style={styles.dangerBtn} testID="memory-delete-all">
          <Ionicons name="trash" size={16} color="#B91C1C" /><Text style={styles.dangerTxt}>Cancella tutta la memoria</Text>
        </Pressable>
        <Text style={styles.foot}>I tuoi contatti, appuntamenti e documenti non vengono mai toccati da queste azioni: qui gestisci solo ciò che Axon ha imparato su di te.</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#F5F3FF" },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: PURPLE },
  title: { color: "#FFF", fontWeight: "800", fontSize: 17 },
  sub: { color: "#E9D5FF", fontSize: 11, marginTop: 1 },
  runBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#FFF", paddingHorizontal: 10, minHeight: 40, borderRadius: 12 },
  runTxt: { color: PURPLE, fontWeight: "800", fontSize: 11 },
  trust: { flexDirection: "row", gap: 10, backgroundColor: "#ECFDF5", borderRadius: 14, padding: 12, borderWidth: 1, borderColor: "#A7F3D0" },
  trustTxt: { flex: 1, fontSize: 12.5, color: "#065F46", lineHeight: 18 },
  statsRow: { flexDirection: "row", gap: 8 },
  statBox: { flex: 1, backgroundColor: "#FFF", borderRadius: 12, padding: 10, alignItems: "center", borderWidth: 1, borderColor: "#E9D5FF" },
  statNum: { fontSize: 20, fontWeight: "800", color: PURPLE },
  statLbl: { fontSize: 10, color: "#64748B", marginTop: 2, fontWeight: "700" },
  card: { backgroundColor: "#FFF", borderRadius: 14, padding: 12, gap: 8, borderWidth: 1, borderColor: "#EDE9FE" },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  secIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: "#F5F3FF", alignItems: "center", justifyContent: "center" },
  secTitle: { fontSize: 15, fontWeight: "800", color: "#1B2B4B" },
  secIntro: { fontSize: 11.5, color: "#64748B", marginTop: 1 },
  emptyTxt: { fontSize: 12.5, color: "#94A3B8", fontStyle: "italic", paddingVertical: 4 },
  item: { flexDirection: "row", alignItems: "center", gap: 4, borderTopWidth: 1, borderTopColor: "#F1F5F9", paddingTop: 8 },
  itemTxt: { fontSize: 14, lineHeight: 20, color: "#1B2B4B" },
  itemMeta: { fontSize: 11, color: "#94A3B8", marginTop: 2 },
  iconBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 10 },
  editRow: { flexDirection: "row", alignItems: "center", gap: 6, flex: 1 },
  input: { flex: 1, backgroundColor: "#F8FAFC", borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB", padding: 10, minHeight: 44, fontSize: 14, color: "#1B2B4B" },
  saveBtn: { width: 44, height: 44, borderRadius: 10, backgroundColor: PURPLE, alignItems: "center", justifyContent: "center" },
  dangerBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: "#FCA5A5", backgroundColor: "#FEF2F2", marginTop: 8 },
  dangerTxt: { color: "#B91C1C", fontWeight: "800", fontSize: 14 },
  foot: { fontSize: 11.5, color: "#64748B", textAlign: "center", lineHeight: 16, paddingHorizontal: 8 },
});

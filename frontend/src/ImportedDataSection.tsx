// ImportedDataSection.tsx — V50.z194 — «Dati importati» in Profilo → Memoria AxonOS (modulo ISOLATO)
// Valori memorizzati da PDF/Excel/CSV su conferma dell'utente, condivisi con il team: per categoria → righe
// {etichetta · data · valore unità · fonte}. Modifica inline (valore/data/unità), cancella riga o intera categoria.
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, Alert, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";

const PURPLE = "#7C3AED";

export type ImportedItem = { item_id: string; categoria: string; etichetta: string; valore: number; unita?: string | null; data?: string | null; fonte?: string | null; user_id: string; updated_at?: string };
type Cat = { categoria: string; count: number; fonti: string[]; last?: string | null };
type Resp = { items: ImportedItem[]; categories: Cat[]; total: number; can_edit_all: boolean; pending: { pending_id: string; status: string; fonte?: string } | null };

function confirmAsync(title: string, msg: string, okLabel: string, onOk: () => void) {
  if (Platform.OS === "web") { if (typeof window !== "undefined" && window.confirm(`${title}\n\n${msg}`)) onOk(); return; }
  Alert.alert(title, msg, [{ text: "Annulla", style: "cancel" }, { text: okLabel, style: "destructive", onPress: onOk }]);
}

export function fmtValore(v: number) {
  if (!Number.isFinite(v)) return String(v);
  return Math.abs(v) < 1000 ? String(Number(v.toFixed(4))).replace(".", ",") : v.toLocaleString("it-IT", { maximumFractionDigits: 2 });
}

export function ImportedDataSection() {
  const [data, setData] = useState<Resp | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState({ valore: "", data: "", unita: "" });

  const load = useCallback(async () => {
    try { setData(await api<Resp>("/axon/imported-data")); } catch { /* offline */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const startEdit = (it: ImportedItem) => { setEditId(it.item_id); setEdit({ valore: String(it.valore), data: it.data || "", unita: it.unita || "" }); };
  const saveEdit = async (it: ImportedItem) => {
    const val = parseFloat(edit.valore.replace(",", "."));
    if (!Number.isFinite(val)) { notify("Valore non valido", "Inserisci un numero (es. 0,1123)."); return; }
    try {
      await api(`/axon/imported-data/${it.item_id}`, { method: "PUT", body: { valore: val, data: edit.data.trim() || null, unita: edit.unita.trim() || null } });
      setEditId(null); await load();
    } catch (e: any) { notify("Errore", e?.message || String(e)); }
  };
  const removeItem = (it: ImportedItem) => confirmAsync("Cancella dato", `${it.etichetta}${it.data ? ` (${it.data})` : ""} = ${fmtValore(it.valore)} ${it.unita || ""}`, "Cancella", async () => {
    try { await api(`/axon/imported-data/${it.item_id}`, { method: "DELETE" }); await load(); } catch (e: any) { notify("Errore", e?.message || String(e)); }
  });
  const removeCat = (c: Cat) => confirmAsync("Cancella categoria", `Axon dimenticherà tutti i ${c.count} valori della categoria «${c.categoria}». I file originali non vengono toccati.`, "Cancella tutto", async () => {
    try { await api("/axon/imported-data", { method: "DELETE", query: { categoria: c.categoria } }); await load(); } catch (e: any) { notify("Errore", e?.message || String(e)); }
  });

  return (
    <View style={styles.card} testID="memory-sec-imported">
      <View style={styles.head}>
        <View style={styles.icon}><Ionicons name="server-outline" size={16} color={PURPLE} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Dati importati</Text>
          <Text style={styles.intro}>Valori che hai fatto memorizzare da PDF/Excel (PUN, tariffe, futures…). Condivisi con il team, disponibili in ogni chat senza ricaricare il file.</Text>
        </View>
        <Pressable onPress={load} hitSlop={8} style={styles.iconBtn} testID="imported-refresh"><Ionicons name="refresh" size={20} color={PURPLE} /></Pressable>
      </View>

      {!data ? <ActivityIndicator color={PURPLE} style={{ marginVertical: 8 }} /> : data.total === 0 ? (
        <Text style={styles.empty}>Nessun dato memorizzato. Carica in chat un file con valori e, quando Axon chiede «Vuoi che memorizzi questi dati per uso futuro?», rispondi «Sì».</Text>
      ) : data.categories.map((c) => {
        const items = data.items.filter((i) => i.categoria === c.categoria);
        const isOpen = open === c.categoria;
        return (
          <View key={c.categoria} style={styles.cat} testID={`imported-cat-${c.categoria}`}>
            <Pressable onPress={() => setOpen(isOpen ? null : c.categoria)} style={styles.catHead} testID={`imported-cat-toggle-${c.categoria}`}>
              <Ionicons name={isOpen ? "chevron-down" : "chevron-forward"} size={18} color={PURPLE} />
              <View style={{ flex: 1 }}>
                <Text style={styles.catTitle}>{c.categoria} <Text style={styles.catCount}>· {c.count} valor{c.count === 1 ? "e" : "i"}</Text></Text>
                <Text style={styles.catMeta}>Fonte: {c.fonti.join(", ") || "n/d"}{c.last ? ` · aggiornato ${new Date(c.last).toLocaleDateString("it-IT")}` : ""}</Text>
              </View>
              <Pressable onPress={() => removeCat(c)} hitSlop={6} style={styles.iconBtn} testID={`imported-cat-delete-${c.categoria}`}><Ionicons name="trash-outline" size={18} color="#DC2626" /></Pressable>
            </Pressable>
            {isOpen && items.map((it) => (
              <View key={it.item_id} style={styles.item} testID={`imported-item-${it.item_id}`}>
                {editId === it.item_id ? (
                  <View style={styles.editRow}>
                    <TextInput value={edit.valore} onChangeText={(v) => setEdit((p) => ({ ...p, valore: v }))} keyboardType="decimal-pad" placeholder="Valore" placeholderTextColor="#94A3B8" style={[styles.input, { flex: 1.2 }]} testID="imported-edit-valore" />
                    <TextInput value={edit.unita} onChangeText={(v) => setEdit((p) => ({ ...p, unita: v }))} placeholder="Unità" placeholderTextColor="#94A3B8" style={styles.input} testID="imported-edit-unita" />
                    <TextInput value={edit.data} onChangeText={(v) => setEdit((p) => ({ ...p, data: v }))} placeholder="AAAA-MM" placeholderTextColor="#94A3B8" style={styles.input} testID="imported-edit-data" />
                    <Pressable onPress={() => saveEdit(it)} style={styles.saveBtn} testID="imported-edit-save"><Ionicons name="checkmark" size={18} color="#FFF" /></Pressable>
                    <Pressable onPress={() => setEditId(null)} style={[styles.saveBtn, { backgroundColor: "#E5E7EB" }]}><Ionicons name="close" size={18} color="#1B2B4B" /></Pressable>
                  </View>
                ) : (
                  <>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.itemTxt}>{it.etichetta}{it.data ? <Text style={styles.itemData}>  {it.data}</Text> : null}</Text>
                      <Text style={styles.itemVal}>{fmtValore(it.valore)} {it.unita || ""}</Text>
                    </View>
                    <Pressable onPress={() => startEdit(it)} hitSlop={6} style={styles.iconBtn} testID={`imported-edit-${it.item_id}`}><Ionicons name="create-outline" size={18} color="#1B2B4B" /></Pressable>
                    <Pressable onPress={() => removeItem(it)} hitSlop={6} style={styles.iconBtn} testID={`imported-delete-${it.item_id}`}><Ionicons name="trash-outline" size={18} color="#DC2626" /></Pressable>
                  </>
                )}
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#FFF", borderRadius: 14, padding: 12, gap: 8, borderWidth: 1, borderColor: "#EDE9FE" },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  icon: { width: 32, height: 32, borderRadius: 10, backgroundColor: "#F5F3FF", alignItems: "center", justifyContent: "center" },
  title: { fontSize: 15, fontWeight: "800", color: "#1B2B4B" },
  intro: { fontSize: 11.5, color: "#64748B", marginTop: 1 },
  empty: { fontSize: 12.5, color: "#94A3B8", fontStyle: "italic", paddingVertical: 4, lineHeight: 18 },
  cat: { borderTopWidth: 1, borderTopColor: "#F1F5F9", paddingTop: 8, gap: 4 },
  catHead: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 },
  catTitle: { fontSize: 14, fontWeight: "800", color: "#1B2B4B" },
  catCount: { fontWeight: "600", color: "#64748B", fontSize: 12 },
  catMeta: { fontSize: 11, color: "#94A3B8", marginTop: 1 },
  item: { flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 26, paddingVertical: 4, borderTopWidth: 1, borderTopColor: "#F8FAFC" },
  itemTxt: { fontSize: 13, color: "#1B2B4B" },
  itemData: { fontSize: 12, color: "#64748B" },
  itemVal: { fontSize: 14, fontWeight: "800", color: PURPLE, marginTop: 1 },
  iconBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 10 },
  editRow: { flexDirection: "row", alignItems: "center", gap: 6, flex: 1, flexWrap: "wrap" },
  input: { flex: 1, minWidth: 70, backgroundColor: "#F8FAFC", borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB", padding: 8, minHeight: 44, fontSize: 13, color: "#1B2B4B" },
  saveBtn: { width: 44, height: 44, borderRadius: 10, backgroundColor: PURPLE, alignItems: "center", justifyContent: "center" },
});

// src/market/AreraPanel.tsx — V50.z346 — MERCATO · Dati ufficiali ARERA/GME: inserimento manuale mensile (Master) + confronto automatico concorrenti vs riferimento.
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { HT } from "@/src/homeTheme";
import { labStyles as L } from "@/src/axonlab/LabHeader";

type Field = { key: string; label: string; unit: string; enabled: boolean };
type Index = { id: string; label: string; hint: string };
type OffRec = { record_id: string; official_index: string; supplier: string; period: string; values: Record<string, number>; notes?: string };
type OffList = { indices: Index[]; fields: Field[]; periods: { period: string; records: OffRec[] }[] };
type Cell = { value: number; ref: number | null; delta: number | null; pct: number | null };
type Compare = {
  index: Index; reference: { period: string; values: Record<string, number>; supplier: string } | null; fields: Field[];
  summary: Record<string, { ref: number | null; avg: number | null; min: number | null; max: number | null; n: number; below: number; above: number; delta_avg: number | null }>;
  rows: { supplier: string; n: number; last_date?: string | null; cells: Record<string, Cell> }[]; competitors: number;
};

const MONTHS = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];
const nowPeriod = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const shiftPeriod = (p: string, n: number) => { const [y, m] = p.split("-").map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
export const periodLabel = (p: string) => { const [y, m] = p.split("-").map(Number); return m >= 1 && m <= 12 ? `${MONTHS[m - 1]} ${y}` : p; };
const fmt = (v: number | null | undefined) => (v == null ? "—" : Math.abs(v) >= 10 ? v.toFixed(2) : v.toFixed(4).replace(/0+$/, "").replace(/\.$/, ""));
const sgn = (v: number) => (v > 0 ? "+" : "") + fmt(v);

export function AreraPanel({ commodity, isMaster }: { commodity: "luce" | "gas" | "telco"; isMaster: boolean }) {
  const [period, setPeriod] = useState(nowPeriod());
  const [indexId, setIndexId] = useState<string | null>(null);
  const [list, setList] = useState<OffList | null>(null);
  const [cmp, setCmp] = useState<Compare | null>(null);
  const [loading, setLoading] = useState(true);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const load = useCallback(async () => {
    try {
      const l = await api<OffList>(`/market/official?commodity=${commodity}`);
      const idx = indexId && l.indices.some((i) => i.id === indexId) ? indexId : l.indices[0]?.id || null;
      if (idx !== indexId) setIndexId(idx);
      const c = idx ? await api<Compare>(`/market/official/compare?commodity=${commodity}&index_id=${idx}&period=${period}`) : null;
      setList(l); setCmp(c);
      const existing = l.periods.find((p) => p.period === period)?.records.find((r) => r.official_index === idx);
      setVals(existing ? Object.fromEntries(Object.entries(existing.values).map(([k, v]) => [k, String(v)])) : {});
      setNotes(existing?.notes || "");
    } catch (e: any) { notify("ARERA/GME", e?.message || ""); }
    finally { setLoading(false); }
  }, [commodity, indexId, period]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!indexId) return;
    setSaving(true);
    try {
      await api("/market/official", { method: "POST", body: { commodity, index_id: indexId, period, values: vals, notes } });
      notify("Dato ufficiale salvato", `${list?.indices.find((i) => i.id === indexId)?.label} · ${periodLabel(period)}`);
      load();
    } catch (e: any) { notify("Errore", e?.message || ""); }
    finally { setSaving(false); }
  };
  const remove = async (r: OffRec) => {
    try { await api(`/market/records/${r.record_id}`, { method: "DELETE" }); notify("Eliminato", `${r.supplier} · ${periodLabel(r.period)}`); load(); }
    catch (e: any) { notify("Errore", e?.message || ""); }
  };

  const fields = list?.fields || [];
  const curIndex = list?.indices.find((i) => i.id === indexId);
  const hasAnyVal = Object.values(vals).some((v) => v.trim());
  const isFuture = period > nowPeriod();

  return (
    <View style={{ gap: 12 }} testID="market-arera">
      {/* Periodo */}
      <View style={s.periodBar}>
        <Pressable onPress={() => setPeriod((p) => shiftPeriod(p, -1))} style={s.periodBtn} testID="arera-prev"><Ionicons name="chevron-back" size={20} color={HT.text} /></Pressable>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={s.periodTxt} testID="arera-period">{periodLabel(period)}</Text>
          <Text style={L.muted}>{isFuture ? "mese futuro" : period === nowPeriod() ? "mese corrente" : "storico"}</Text>
        </View>
        <Pressable onPress={() => setPeriod((p) => shiftPeriod(p, 1))} style={s.periodBtn} testID="arera-next"><Ionicons name="chevron-forward" size={20} color={HT.text} /></Pressable>
      </View>

      {/* Indice */}
      <View style={s.chips}>
        {(list?.indices || []).map((i) => (
          <Pressable key={i.id} onPress={() => setIndexId(i.id)} style={[s.chip, indexId === i.id && s.chipOn]} testID={`arera-index-${i.id}`}>
            <Text style={[s.chipTxt, indexId === i.id && { color: HT.white }]}>{i.label}</Text>
          </Pressable>
        ))}
      </View>
      {curIndex ? <Text style={L.cardSub}>{curIndex.hint}</Text> : null}
      {loading && !list ? <ActivityIndicator color={HT.brand} style={{ marginTop: 20 }} /> : null}

      {/* Inserimento (Master) / lettura */}
      {list ? (
        <View style={L.card} testID="arera-form">
          <Text style={L.cardTitle}>{isMaster ? "Valori ufficiali del mese" : "Valori ufficiali inseriti"}</Text>
          {fields.map((f) => (
            <View key={f.key} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={[s.lbl, { flex: 1 }]}>{f.label} <Text style={L.muted}>({f.unit})</Text></Text>
              {isMaster
                ? <TextInput value={vals[f.key] ?? ""} onChangeText={(t) => setVals((v) => ({ ...v, [f.key]: t }))} placeholder="—" placeholderTextColor={HT.muted} style={[L.input, { width: 120, textAlign: "right" }]} keyboardType="decimal-pad" testID={`arera-val-${f.key}`} />
                : <Text style={s.num}>{vals[f.key] ? fmt(Number(vals[f.key])) : "—"}</Text>}
            </View>
          ))}
          {isMaster ? (
            <>
              <TextInput value={notes} onChangeText={setNotes} placeholder="Nota / fonte (es. delibera ARERA, link GME)" placeholderTextColor={HT.muted} style={L.input} testID="arera-notes" />
              <Pressable onPress={save} disabled={saving || !hasAnyVal} style={[L.btn, L.btnBrand, (saving || !hasAnyVal) && { opacity: 0.5 }]} testID="arera-save">
                {saving ? <ActivityIndicator size="small" color={HT.white} /> : <Ionicons name="save" size={16} color={HT.white} />}
                <Text style={L.btnTxt}>Salva {curIndex?.label} · {periodLabel(period)}</Text>
              </Pressable>
            </>
          ) : !hasAnyVal ? <Text style={L.cardSub}>Nessun valore inserito dal Master per questo mese.</Text> : null}
        </View>
      ) : null}

      {/* Confronto automatico */}
      {cmp ? (
        <>
          <Text style={L.sectionTitle}>Concorrenti vs {cmp.index?.label || "riferimento"}</Text>
          {!cmp.reference ? (
            <Text style={L.cardSub}>Nessun riferimento ufficiale disponibile fino a {periodLabel(period)}: inserisci i valori qui sopra per attivare il confronto.</Text>
          ) : (
            <>
              <Text style={L.cardSub}>Riferimento usato: {periodLabel(cmp.reference.period)}{cmp.reference.period !== period ? " (ultimo disponibile)" : ""} · {cmp.competitors} {cmp.competitors === 1 ? "concorrente" : "concorrenti"} rilevati dalle bollette.</Text>
              <View style={L.card} testID="arera-summary">
                <Text style={L.cardTitle}>Quadro di sintesi</Text>
                {cmp.fields.filter((f) => cmp.summary[f.key]?.ref != null).map((f) => {
                  const sm = cmp.summary[f.key];
                  const tone = sm.delta_avg == null ? HT.muted : sm.delta_avg > 0 ? HT.danger : HT.success;
                  return (
                    <View key={f.key} style={s.sumRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.lbl}>{f.label}</Text>
                        <Text style={L.muted}>riferimento {fmt(sm.ref)} {f.unit}{sm.n ? ` · media mercato ${fmt(sm.avg)}` : " · nessun concorrente"}</Text>
                      </View>
                      {sm.n ? (
                        <View style={{ alignItems: "flex-end" }}>
                          <Text style={[s.num, { color: tone }]}>{sm.delta_avg == null ? "—" : sgn(sm.delta_avg)}</Text>
                          <Text style={L.muted}>{sm.below} sotto · {sm.above} sopra</Text>
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
              {cmp.rows.map((r) => (
                <View key={r.supplier} style={s.row} testID={`arera-row-${r.supplier.replace(/\W/g, "_")}`}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={s.sup} numberOfLines={1}>{r.supplier}</Text>
                    <Text style={L.muted}>· {r.n} {r.n === 1 ? "rilevazione" : "rilevazioni"}</Text>
                  </View>
                  <View style={s.grid}>
                    {cmp.fields.filter((f) => r.cells[f.key]).map((f) => {
                      const c = r.cells[f.key];
                      const tone = c.delta == null ? HT.muted : c.delta > 0 ? HT.danger : c.delta < 0 ? HT.success : HT.text2;
                      const bg = c.delta == null ? HT.card2 : c.delta > 0 ? HT.dangerTint : c.delta < 0 ? HT.successTint : HT.card2;
                      return (
                        <View key={f.key} style={[s.cell, { backgroundColor: bg }]}>
                          <Text style={s.cellLbl} numberOfLines={1}>{f.label}</Text>
                          <Text style={s.cellNum}>{fmt(c.value)} <Text style={s.cellUnit}>{f.unit}</Text></Text>
                          <Text style={[s.cellDelta, { color: tone }]}>{c.delta == null ? "n.d. riferimento" : `${sgn(c.delta)}${c.pct != null ? ` (${c.pct > 0 ? "+" : ""}${c.pct}%)` : ""}`}</Text>
                        </View>
                      );
                    })}
                  </View>
                </View>
              ))}
              {!cmp.rows.length ? <Text style={L.cardSub}>Nessuna bolletta concorrente analizzata per questa commodity.</Text> : null}
            </>
          )}
        </>
      ) : null}

      {/* Storico */}
      {list?.periods.length ? (
        <View style={L.card} testID="arera-history">
          <Pressable onPress={() => setShowHistory((v) => !v)} style={{ flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44 }} testID="arera-history-toggle">
            <Text style={[L.cardTitle, { flex: 1 }]}>Storico dati ufficiali ({list.periods.reduce((n, p) => n + p.records.length, 0)})</Text>
            <Ionicons name={showHistory ? "chevron-up" : "chevron-down"} size={18} color={HT.muted} />
          </Pressable>
          {showHistory ? list.periods.map((p) => (
            <View key={p.period} style={{ gap: 6 }}>
              <Pressable onPress={() => setPeriod(p.period)}><Text style={[s.lbl, { color: HT.brand }]}>{periodLabel(p.period)}</Text></Pressable>
              {p.records.map((r) => (
                <View key={r.record_id} style={s.histRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.sup}>{r.supplier}</Text>
                    <Text style={L.muted} numberOfLines={2}>{fields.filter((f) => r.values[f.key] != null).map((f) => `${f.label} ${fmt(r.values[f.key])} ${f.unit}`).join(" · ") || "—"}</Text>
                  </View>
                  {isMaster ? <Pressable onPress={() => remove(r)} hitSlop={10} style={s.trash} testID={`arera-del-${r.record_id}`}><Ionicons name="trash-outline" size={18} color={HT.danger} /></Pressable> : null}
                </View>
              ))}
            </View>
          )) : null}
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  periodBar: { flexDirection: "row", alignItems: "center", backgroundColor: HT.card, borderRadius: 14, borderWidth: 1, borderColor: HT.border, paddingHorizontal: 4, paddingVertical: 6 },
  periodBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  periodTxt: { color: HT.text, fontWeight: "900", fontSize: 16 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { paddingHorizontal: 12, minHeight: 34, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border },
  chipOn: { backgroundColor: HT.axon, borderColor: HT.axon },
  chipTxt: { color: HT.text2, fontWeight: "800", fontSize: 12 },
  lbl: { color: HT.text2, fontSize: 12.5, fontWeight: "700" },
  num: { color: HT.text, fontWeight: "900", fontSize: 14, minWidth: 80, textAlign: "right" },
  sumRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: HT.border },
  row: { backgroundColor: HT.card, borderRadius: 14, borderWidth: 1, borderColor: HT.border, borderLeftWidth: 4, borderLeftColor: HT.warning, padding: 12, gap: 8 },
  sup: { color: HT.text, fontWeight: "900", fontSize: 14 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  cell: { minWidth: "30%", flexGrow: 1, borderRadius: 10, padding: 8 },
  cellLbl: { color: HT.muted, fontSize: 10.5, fontWeight: "700" },
  cellNum: { color: HT.text, fontWeight: "900", fontSize: 14, marginTop: 2 },
  cellUnit: { color: HT.muted, fontSize: 10, fontWeight: "600" },
  cellDelta: { fontSize: 11, fontWeight: "800", marginTop: 2 },
  histRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: HT.border },
  trash: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
});

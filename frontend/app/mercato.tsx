// app/mercato.tsx — V50.z345 — MERCATO · DB condizioni economiche (concorrenti · ARERA/GME · la mia ditta) + benchmark per voce.
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Switch, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { HT } from "@/src/homeTheme";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { useAuth } from "@/src/auth";
import { LabHeader, labStyles as L } from "@/src/axonlab/LabHeader";
import { AreraPanel } from "@/src/market/AreraPanel";

type Field = { key: string; label: string; unit: string; enabled: boolean; lower_is_better?: boolean };
type Row = { source: string; supplier: string; n: number; offers: string[]; last_date?: string | null; values: Record<string, { min: number | null; avg: number | null; last: number | null; n: number }> };
type Bench = { fields: Field[]; competitors: Row[]; own: Row[]; official: Row[]; best: Record<string, { value: number; supplier: string }>; records: number; bands: string[] };

const COMM = [{ id: "luce", label: "Luce", icon: "flash" }, { id: "gas", label: "Gas", icon: "flame" }, { id: "telco", label: "Telco", icon: "wifi" }] as const;
const SRC_LABEL: Record<string, string> = { competitor: "Concorrente", own: "La mia ditta", official: "Ufficiale (ARERA/GME)" };
const fmt = (v: number | null | undefined) => (v == null ? "—" : v >= 10 ? v.toFixed(2) : v.toFixed(4).replace(/0+$/, "").replace(/\.$/, ""));

export default function Mercato() {
  const { user } = useAuth();
  const isMaster = (user as any)?.role === "owner";
  const pagePad = usePageBottomPadding();
  const [commodity, setCommodity] = useState<"luce" | "gas" | "telco">("luce");
  const [segment, setSegment] = useState<string | null>(null);
  const [voltage, setVoltage] = useState<string | null>(null);
  const [band, setBand] = useState<string | null>(null);
  const [bench, setBench] = useState<Bench | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"bench" | "arera" | "add" | "fields">("bench");
  const [fields, setFields] = useState<Record<string, Field[]>>({});
  // form nuovo record
  const [src, setSrc] = useState<"competitor" | "own">("competitor");
  const [supplier, setSupplier] = useState(""); const [offer, setOffer] = useState(""); const [fSeg, setFSeg] = useState<string | null>(null); const [fVolt, setFVolt] = useState<string | null>(null);
  const [annual, setAnnual] = useState(""); const [power, setPower] = useState(""); const [vals, setVals] = useState<Record<string, string>>({}); const [saving, setSaving] = useState(false);
  const [newKey, setNewKey] = useState(""); const [newUnit, setNewUnit] = useState("");

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams({ commodity, ...(segment ? { segment } : {}), ...(voltage ? { voltage } : {}), ...(band ? { band } : {}) }).toString();
      const [b, s] = await Promise.all([api<Bench>(`/market/benchmark?${q}`), api<{ fields: Record<string, Field[]> }>("/market/settings")]);
      setBench(b); setFields(s.fields);
    } catch (e: any) { notify("Mercato", e?.message || ""); }
    finally { setLoading(false); }
  }, [commodity, segment, voltage, band]);
  useEffect(() => { load(); }, [load]);

  const saveRecord = async () => {
    if (!supplier.trim() && src === "competitor") { notify("Fornitore", "Indica il nome del fornitore."); return; }
    setSaving(true);
    try {
      await api("/market/records", { method: "POST", body: { source: src, commodity, supplier: supplier.trim() || (src === "own" ? "La mia ditta" : "ARERA/GME"), offer_name: offer, segment: fSeg, voltage: commodity === "luce" ? fVolt : null, annual_consumption: annual ? Number(annual.replace(",", ".")) : null, power_kw: power ? Number(power.replace(",", ".")) : null, values: vals } });
      notify("Condizione salvata", `${SRC_LABEL[src]} · ${supplier || ""}`.trim());
      setSupplier(""); setOffer(""); setVals({}); setAnnual(""); setPower(""); setTab("bench"); load();
    } catch (e: any) { notify("Errore", e?.message || ""); }
    finally { setSaving(false); }
  };
  const saveFields = async (next: Field[]) => {
    const all = { ...fields, [commodity]: next }; setFields(all);
    try { await api("/market/settings", { method: "PUT", body: { fields: all } }); load(); } catch (e: any) { notify("Errore", e?.message || ""); }
  };
  const addField = () => {
    if (!newKey.trim()) return;
    const key = newKey.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_");
    saveFields([...(fields[commodity] || []), { key, label: newKey.trim(), unit: newUnit.trim(), enabled: true, lower_is_better: true }]);
    setNewKey(""); setNewUnit("");
  };

  const Chip = ({ on, label, onPress, testID }: { on: boolean; label: string; onPress: () => void; testID?: string }) => (
    <Pressable onPress={onPress} style={[s.chip, on && s.chipOn]} testID={testID}><Text style={[s.chipTxt, on && { color: HT.white }]}>{label}</Text></Pressable>
  );
  const RowLine = ({ r, tone }: { r: Row; tone: string }) => (
    <View style={[s.row, { borderLeftColor: tone }]} testID={`market-row-${r.source}-${r.supplier.replace(/\W/g, "_")}`}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Text style={s.rowSup} numberOfLines={1}>{r.supplier}</Text>
        <Text style={L.muted}>· {r.n} {r.n === 1 ? "rilevazione" : "rilevazioni"}{r.offers.length ? ` · ${r.offers.slice(0, 2).join(", ")}` : ""}</Text>
      </View>
      <View style={s.valGrid}>
        {(bench?.fields || []).map((f) => {
          const v = r.values[f.key]; const best = bench?.best[f.key];
          const isBest = !!best && r.source === "competitor" && v?.last === best.value;
          return (
            <View key={f.key} style={s.valCell}>
              <Text style={s.valLbl} numberOfLines={1}>{f.label}</Text>
              <Text style={[s.valNum, isBest && { color: HT.success }]}>{fmt(v?.last)} <Text style={s.valUnit}>{f.unit}</Text></Text>
              {v?.n > 1 ? <Text style={s.valSub}>min {fmt(v.min)} · med {fmt(v.avg)}</Text> : null}
            </View>
          );
        })}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: HT.card2 }} edges={["top"]}>
      <LabHeader title="Mercato" sub="Condizioni economiche · concorrenti, ARERA/GME, la mia ditta" testID="market" />
      <View style={s.tabs}>
        {([["bench", "Benchmark"], ["arera", "ARERA/GME"], ["add", "Aggiungi"], ["fields", "Voci"]] as const).map(([id, lbl]) => (
          <Pressable key={id} onPress={() => setTab(id)} style={[s.tab, tab === id && s.tabOn]} testID={`market-tab-${id}`}><Text style={[s.tabTxt, tab === id && { color: HT.white }]}>{lbl}</Text></Pressable>
        ))}
      </View>
      <ScrollView contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: pagePad + 24 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />} keyboardShouldPersistTaps="handled">
        <View style={s.chips}>{COMM.map((c) => <Chip key={c.id} on={commodity === c.id} label={c.label} onPress={() => { setCommodity(c.id); setBand(null); setVoltage(null); }} testID={`market-comm-${c.id}`} />)}</View>

        {tab === "bench" ? (
          <>
            <View style={s.chips}>
              <Chip on={!segment} label="Tutti" onPress={() => setSegment(null)} />
              <Chip on={segment === "privato"} label="Privato" onPress={() => setSegment("privato")} />
              <Chip on={segment === "business"} label="Business" onPress={() => setSegment("business")} />
              {commodity === "luce" ? <><Chip on={voltage === "BT"} label="BT" onPress={() => setVoltage(voltage === "BT" ? null : "BT")} /><Chip on={voltage === "MT"} label="MT" onPress={() => setVoltage(voltage === "MT" ? null : "MT")} /></> : null}
            </View>
            {commodity !== "telco" && bench?.bands?.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                <Chip on={!band} label="Ogni fascia" onPress={() => setBand(null)} />
                {bench.bands.map((b) => <Chip key={b} on={band === b} label={b} onPress={() => setBand(band === b ? null : b)} />)}
              </ScrollView>
            ) : null}
            {loading && !bench ? <ActivityIndicator color={HT.brand} style={{ marginTop: 30 }} /> : null}
            {bench ? (
              <>
                {Object.keys(bench.best).length ? (
                  <View style={[L.card, { borderColor: HT.successTint }]} testID="market-best">
                    <Text style={L.cardTitle}>Migliore sul mercato (ultima rilevazione)</Text>
                    {bench.fields.filter((f) => bench.best[f.key]).map((f) => <Text key={f.key} style={s.bestLine}>• {f.label}: <Text style={{ color: HT.success, fontWeight: "900" }}>{fmt(bench.best[f.key].value)} {f.unit}</Text> · {bench.best[f.key].supplier}</Text>)}
                  </View>
                ) : null}
                <Text style={L.sectionTitle}>La mia ditta</Text>
                {bench.own.length ? bench.own.map((r) => <RowLine key={r.supplier} r={r} tone={HT.brand} />) : <Text style={L.cardSub}>Nessun listino inserito. Vai su «Aggiungi condizione» → La mia ditta.</Text>}
                <Text style={L.sectionTitle}>Dati ufficiali ARERA / GME</Text>
                {bench.official.length ? bench.official.map((r) => <RowLine key={r.supplier} r={r} tone={HT.axon} />) : <Text style={L.cardSub}>Nessun dato ufficiale inserito (PUN, PSV, tutela…).</Text>}
                <Pressable onPress={() => setTab("arera")} style={[L.btn, L.btnGhost]} testID="market-goto-arera">
                  <Ionicons name="analytics" size={16} color={HT.axon} /><Text style={[L.btnTxt, { color: HT.text }]}>Inserisci / confronta dati ARERA-GME</Text>
                </Pressable>
                <Text style={L.sectionTitle}>Concorrenti ({bench.competitors.length})</Text>
                {bench.competitors.length ? bench.competitors.map((r) => <RowLine key={r.supplier} r={r} tone={HT.warning} />) : <Text style={L.cardSub}>Ancora nessuna rilevazione: ogni bolletta concorrente analizzata alimenta automaticamente questo archivio.</Text>}
                <Pressable onPress={async () => { try { const r = await api<{ ingested: number }>("/market/ingest-all", { method: "POST" }); notify("Archivio aggiornato", `${r.ingested} bollette importate.`); load(); } catch (e: any) { notify("Errore", e?.message || ""); } }} style={[L.btn, L.btnGhost]} testID="market-ingest-all">
                  <Ionicons name="refresh" size={16} color={HT.text} /><Text style={[L.btnTxt, { color: HT.text }]}>Importa dalle bollette già analizzate</Text>
                </Pressable>
              </>
            ) : null}
          </>
        ) : null}

        {tab === "arera" ? <AreraPanel commodity={commodity} isMaster={isMaster} /> : null}

        {tab === "add" ? (
          <View style={L.card} testID="market-add">
            <View style={s.chips}>
              <Chip on={src === "competitor"} label="Concorrente" onPress={() => setSrc("competitor")} testID="market-src-competitor" />
              {isMaster ? <Chip on={src === "own"} label="La mia ditta" onPress={() => setSrc("own")} testID="market-src-own" /> : null}
              {isMaster ? <Chip on={false} label="ARERA / GME →" onPress={() => setTab("arera")} testID="market-src-official" /> : null}
            </View>
            <TextInput value={supplier} onChangeText={setSupplier} placeholder={src === "own" ? "Nome ditta / marchio" : "Fornitore concorrente"} placeholderTextColor={HT.muted} style={L.input} testID="market-supplier" />
            <TextInput value={offer} onChangeText={setOffer} placeholder="Nome offerta / listino (facoltativo)" placeholderTextColor={HT.muted} style={L.input} />
            <View style={s.chips}>
              <Chip on={fSeg === "privato"} label="Privato" onPress={() => setFSeg(fSeg === "privato" ? null : "privato")} />
              <Chip on={fSeg === "business"} label="Business" onPress={() => setFSeg(fSeg === "business" ? null : "business")} />
              {commodity === "luce" ? <><Chip on={fVolt === "BT"} label="BT" onPress={() => setFVolt(fVolt === "BT" ? null : "BT")} /><Chip on={fVolt === "MT"} label="MT" onPress={() => setFVolt(fVolt === "MT" ? null : "MT")} /></> : null}
            </View>
            {commodity !== "telco" ? (
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TextInput value={annual} onChangeText={setAnnual} placeholder={commodity === "gas" ? "Consumo annuo Smc" : "Consumo annuo kWh"} placeholderTextColor={HT.muted} style={[L.input, { flex: 1 }]} keyboardType="decimal-pad" />
                {commodity === "luce" ? <TextInput value={power} onChangeText={setPower} placeholder="Potenza kW" placeholderTextColor={HT.muted} style={[L.input, { flex: 1 }]} keyboardType="decimal-pad" /> : null}
              </View>
            ) : null}
            <Text style={L.cardSub}>Voci economiche</Text>
            {(fields[commodity] || []).filter((f) => f.enabled).map((f) => (
              <View key={f.key} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={[s.valLbl, { flex: 1, fontSize: 12.5 }]}>{f.label} <Text style={L.muted}>({f.unit})</Text></Text>
                <TextInput value={vals[f.key] ?? ""} onChangeText={(t) => setVals((v) => ({ ...v, [f.key]: t }))} placeholder="0,000" placeholderTextColor={HT.muted} style={[L.input, { width: 120, textAlign: "right" }]} keyboardType="decimal-pad" testID={`market-val-${f.key}`} />
              </View>
            ))}
            <Pressable onPress={saveRecord} disabled={saving} style={[L.btn, L.btnBrand, saving && { opacity: 0.5 }]} testID="market-save">
              {saving ? <ActivityIndicator size="small" color={HT.white} /> : <Ionicons name="save" size={16} color={HT.white} />}<Text style={L.btnTxt}>Salva condizione</Text>
            </Pressable>
          </View>
        ) : null}

        {tab === "fields" ? (
          <View style={L.card} testID="market-fields">
            <Text style={L.cardTitle}>Voci da estrarre e confrontare · {COMM.find((c) => c.id === commodity)?.label}</Text>
            <Text style={L.cardSub}>Queste voci vengono lette dalle bollette, chieste nei listini e messe a confronto nel benchmark.</Text>
            {(fields[commodity] || []).map((f, i) => (
              <View key={f.key} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: HT.border }}>
                <View style={{ flex: 1 }}><Text style={s.rowSup}>{f.label}</Text><Text style={L.muted}>{f.key} · {f.unit || "—"}</Text></View>
                {isMaster ? <Switch value={f.enabled} onValueChange={(v) => saveFields(fields[commodity].map((x, j) => (j === i ? { ...x, enabled: v } : x)))} trackColor={{ true: HT.brand, false: HT.border }} thumbColor={HT.white} /> : <Text style={L.muted}>{f.enabled ? "attiva" : "off"}</Text>}
                {isMaster ? <Pressable onPress={() => saveFields(fields[commodity].filter((_, j) => j !== i))} hitSlop={8}><Ionicons name="trash-outline" size={18} color={HT.danger} /></Pressable> : null}
              </View>
            ))}
            {isMaster ? (
              <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                <TextInput value={newKey} onChangeText={setNewKey} placeholder="Nuova voce (es. Oneri di sistema)" placeholderTextColor={HT.muted} style={[L.input, { flex: 1.5 }]} testID="market-newfield" />
                <TextInput value={newUnit} onChangeText={setNewUnit} placeholder="Unità" placeholderTextColor={HT.muted} style={[L.input, { flex: 0.7 }]} />
                <Pressable onPress={addField} style={s.addBtn} testID="market-newfield-add"><Ionicons name="add" size={20} color={HT.white} /></Pressable>
              </View>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  tabs: { flexDirection: "row", gap: 6, paddingHorizontal: 14, paddingTop: 10 },
  tab: { flex: 1, minHeight: 38, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border },
  tabOn: { backgroundColor: HT.brand, borderColor: HT.brand },
  tabTxt: { color: HT.text2, fontWeight: "800", fontSize: 12 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { paddingHorizontal: 12, minHeight: 34, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border },
  chipOn: { backgroundColor: HT.axon, borderColor: HT.axon },
  chipTxt: { color: HT.text2, fontWeight: "800", fontSize: 12 },
  row: { backgroundColor: HT.card, borderRadius: 14, borderWidth: 1, borderColor: HT.border, borderLeftWidth: 4, padding: 12, gap: 8 },
  rowSup: { color: HT.text, fontWeight: "900", fontSize: 14 },
  valGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  valCell: { minWidth: "30%", flexGrow: 1, backgroundColor: HT.card2, borderRadius: 10, padding: 8 },
  valLbl: { color: HT.muted, fontSize: 10.5, fontWeight: "700" },
  valNum: { color: HT.text, fontWeight: "900", fontSize: 14, marginTop: 2 },
  valUnit: { color: HT.muted, fontSize: 10, fontWeight: "600" },
  valSub: { color: HT.muted, fontSize: 10 },
  bestLine: { color: HT.text2, fontSize: 12.5, lineHeight: 18 },
  addBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: HT.brand, alignItems: "center", justifyContent: "center" },
});

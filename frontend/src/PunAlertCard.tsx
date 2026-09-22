// V50.z325 — Avviso soglia PUN: Axon avvisa (card proattiva + chat) quando la media parziale del mese supera la soglia scelta.
// Impostazioni › AI & Axon. Salva in /user-settings {pun_alert_threshold (€/kWh, 0 = off), pun_alert_band}.
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TextInput, Pressable, ActivityIndicator, Switch } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";

const C = theme.color;
const AMBER = "#F59E0B"; // colore energia/PUN (uguale in chiaro e scuro)
type Band = "monorario" | "F1" | "F2" | "F3";
const BANDS: Band[] = ["monorario", "F1", "F2", "F3"];

const fmt = (v?: number | null) => (v == null ? "—" : v.toFixed(4).replace(".", ","));

export function PunAlertCard() {
  const [enabled, setEnabled] = useState(false);
  const [threshold, setThreshold] = useState("0,2500");
  const [band, setBand] = useState<Band>("monorario");
  const [partial, setPartial] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([api<any>("/user-settings").catch(() => ({})), api<any>("/quick-action/pun/partial").catch(() => null)]).then(([s, p]) => {
      const thr = Number(s?.pun_alert_threshold || 0);
      setEnabled(thr > 0);
      if (thr > 0) setThreshold(thr.toFixed(4).replace(".", ","));
      if (BANDS.includes(s?.pun_alert_band)) setBand(s.pun_alert_band);
      setPartial(p);
      setLoaded(true);
    });
  }, []);

  const thrNum = parseFloat(threshold.replace(",", "."));
  const current = partial?.days ? Number(partial[band]) / 1000 : null;
  const over = enabled && current != null && Number.isFinite(thrNum) && current > thrNum;

  const save = async () => {
    if (saving) return;
    if (enabled && !(Number.isFinite(thrNum) && thrNum > 0)) { notify("Soglia non valida", "Inserisci un valore in €/kWh, es. 0,2500"); return; }
    setSaving(true);
    try {
      await api("/user-settings", { method: "PUT", body: { pun_alert_threshold: enabled ? thrNum : 0, pun_alert_band: band } });
      notify(enabled ? "Avviso PUN attivo ✅" : "Avviso PUN disattivato", enabled ? `Ti avviso se la media ${band} del mese supera ${fmt(thrNum)} €/kWh.` : undefined);
    } catch (e: any) { notify("Errore", e?.message); } finally { setSaving(false); }
  };

  if (!loaded) return <View style={s.card}><ActivityIndicator color={AMBER} /></View>;
  return (
    <View style={s.card} testID="pun-alert-card">
      <View style={s.head}>
        <View style={s.orb}><Ionicons name="flash" size={18} color="#FFFFFF" /></View>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Avviso soglia PUN</Text>
          <Text style={s.sub}>Axon ti avvisa quando la media parziale del mese supera la soglia.</Text>
        </View>
        <Switch value={enabled} onValueChange={setEnabled} trackColor={{ true: AMBER }} testID="pun-alert-enabled" />
      </View>
      {enabled ? (
        <>
          <View style={s.chips}>
            {BANDS.map((b) => (
              <Pressable key={b} onPress={() => setBand(b)} style={[s.chip, band === b && s.chipOn]} testID={`pun-alert-band-${b}`}>
                <Text style={[s.chipTxt, band === b && s.chipTxtOn]}>{b === "monorario" ? "Monorario" : b}</Text>
              </Pressable>
            ))}
          </View>
          <View style={s.row}>
            <Text style={s.lbl}>Soglia €/kWh</Text>
            <TextInput value={threshold} onChangeText={setThreshold} keyboardType="decimal-pad" placeholder="0,2500" placeholderTextColor={C.muted} style={s.input} testID="pun-alert-threshold" />
          </View>
        </>
      ) : null}
      {partial?.days ? (
        <Text style={[s.now, over && { color: C.error }]} testID="pun-alert-current">
          {over ? "⚠️ " : ""}Oggi {band === "monorario" ? "monorario" : band} {partial.month_key?.slice(5)}/{partial.month_key?.slice(0, 4)} giorni 1–{partial.days}: <Text style={s.bold}>{fmt(current)} €/kWh</Text>{over ? " — sopra soglia" : ""}
        </Text>
      ) : null}
      <Pressable onPress={save} disabled={saving} style={[s.btn, saving && { opacity: 0.5 }]} testID="pun-alert-save">
        {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={s.btnTxt}>Salva</Text>}
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: C.surfaceSecondary, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: C.divider, gap: 12, marginBottom: 12 },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  orb: { width: 40, height: 40, borderRadius: 20, backgroundColor: AMBER, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 15, fontWeight: "800", color: C.onSurface },
  sub: { fontSize: 12, color: C.muted, marginTop: 2 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 12, minHeight: 38, justifyContent: "center", borderRadius: 999, borderWidth: 1, borderColor: AMBER, backgroundColor: C.surfaceSecondary },
  chipOn: { backgroundColor: AMBER },
  chipTxt: { color: AMBER, fontWeight: "700", fontSize: 12.5 },
  chipTxtOn: { color: "#FFFFFF" },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  lbl: { fontSize: 13, color: C.muted, fontWeight: "600" },
  input: { flex: 1, minHeight: 44, borderWidth: 1, borderColor: C.divider, borderRadius: 10, paddingHorizontal: 12, color: C.onSurface, backgroundColor: C.surface, fontSize: 16, fontWeight: "700" },
  now: { fontSize: 12.5, color: C.muted },
  bold: { fontWeight: "800", color: C.onSurface },
  btn: { minHeight: 44, borderRadius: 12, backgroundColor: AMBER, alignItems: "center", justifyContent: "center" },
  btnTxt: { color: "#FFFFFF", fontWeight: "800" },
});

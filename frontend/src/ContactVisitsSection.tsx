// ContactVisitsSection.tsx — V50.z256 — Scheda cliente → tab «Visite»: Frequenza ripasso + Storico visite confermate
// (data, ora, km, note, origine: Giro Ottimale / GPS / manuale) + registrazione manuale di una visita.
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { notify, confirmAsync } from "@/src/utils/notify";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

const SKY = "#0EA5E9";
type Visit = { visit_id: string; date: string; at: string; km: number; notes?: string; source: "route" | "gps" | "manual"; stay_minutes?: number | null };
type Resp = { items: Visit[]; total_km: number; revisit_every_days?: number | null; last_visit_at?: string | null };
const FREQ = [{ d: 0, label: "Nessuna" }, { d: 30, label: "Ogni mese" }, { d: 60, label: "Ogni 2 mesi" }, { d: 90, label: "Ogni 3 mesi" }, { d: 120, label: "Ogni 4 mesi" }];
const SRC: Record<string, { label: string; icon: any; color: string }> = {
  route: { label: "Giro Ottimale", icon: "car-sport", color: "#FF6B35" }, gps: { label: "Rilevata GPS", icon: "location", color: SKY }, manual: { label: "Manuale", icon: "create", color: "#7C3AED" },
};
const fmtKm = (n: number) => (Number(n) || 0).toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtDT = (iso: string) => { try { const d = new Date(iso); return `${d.toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" })} · ${d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}`; } catch { return iso; } };

export function ContactVisitsSection({ contactId, initialEvery }: { contactId: string; initialEvery?: number | null }) {
  const [data, setData] = useState<Resp | null>(null);
  const [every, setEvery] = useState<number>(initialEvery || 0);
  const [custom, setCustom] = useState("");
  const [customOpen, setCustomOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualKm, setManualKm] = useState("");
  const [manualNotes, setManualNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { const r = await api<Resp>(`/visits/contact/${contactId}`); setData(r); if (r.revisit_every_days != null) setEvery(r.revisit_every_days); }
    catch { setData({ items: [], total_km: 0 }); }
  }, [contactId]);
  useEffect(() => { load(); }, [load]);

  const saveEvery = async (d: number) => {
    setEvery(d); setSaving(true);
    try { await api(`/contacts/${contactId}`, { method: "PUT", body: { revisit_every_days: d } }); }
    catch (e: any) { notify("Frequenza ripasso", e?.message || "Salvataggio non riuscito"); } finally { setSaving(false); }
  };
  const isCustom = every > 0 && !FREQ.some((f) => f.d === every);

  const addManual = async () => {
    setBusy(true);
    try {
      const km = manualKm.trim() ? Number(manualKm.replace(",", ".")) : undefined;
      await api("/visits/confirm", { method: "POST", body: { contact_id: contactId, notes: manualNotes, km: km != null && !isNaN(km) ? km : undefined, source: "manual", at: new Date().toISOString(), date: new Date().toISOString().slice(0, 10) } });
      setManualOpen(false); setManualKm(""); setManualNotes(""); await load();
    } catch (e: any) { notify("Visita", e?.message || "Operazione non riuscita"); } finally { setBusy(false); }
  };
  const remove = async (v: Visit) => {
    if (!(await confirmAsync("Eliminare la visita?", `${fmtDT(v.at)} · ${fmtKm(v.km)} km — verranno tolti anche dal Resoconto Km.`))) return;
    try { await api(`/visits/${v.visit_id}`, { method: "DELETE" }); await load(); } catch (e: any) { notify("Errore", e?.message || ""); }
  };

  const daysSince = data?.last_visit_at ? Math.floor((Date.now() - new Date(data.last_visit_at).getTime()) / 86400000) : null;
  const overdue = every > 0 && (daysSince == null || daysSince >= every);

  return (
    <View style={{ gap: 12 }} testID="contact-visits-section">
      {/* Frequenza ripasso */}
      <View style={styles.card}>
        <Text style={styles.title}>🔁 Frequenza ripasso</Text>
        <Text style={styles.hint}>AxonOS ti avvisa in chat quando è ora di tornare da questo cliente.</Text>
        <View style={styles.pills}>
          {FREQ.map((f) => (
            <Pressable key={f.d} onPress={() => { setCustomOpen(false); saveEvery(f.d); }} style={[styles.pill, every === f.d && !customOpen && styles.pillOn]} testID={`visit-freq-${f.d}`}>
              <Text style={[styles.pillTxt, every === f.d && !customOpen && { color: "#FFF" }]}>{f.label}</Text>
            </Pressable>
          ))}
          <Pressable onPress={() => { setCustomOpen(true); setCustom(isCustom ? String(every) : ""); }} style={[styles.pill, (customOpen || isCustom) && styles.pillOn]} testID="visit-freq-custom">
            <Text style={[styles.pillTxt, (customOpen || isCustom) && { color: "#FFF" }]}>{isCustom && !customOpen ? `Ogni ${every} gg` : "Personalizzata"}</Text>
          </Pressable>
        </View>
        {customOpen && (
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center", marginTop: 8 }}>
            <TextInput value={custom} onChangeText={setCustom} placeholder="giorni" keyboardType="number-pad" placeholderTextColor={HT.muted} style={styles.input} testID="visit-freq-custom-input" />
            <Pressable onPress={() => { const n = parseInt(custom, 10); if (n > 0) { saveEvery(n); setCustomOpen(false); } }} style={styles.btnSm} testID="visit-freq-custom-save"><Text style={styles.btnSmTxt}>Salva</Text></Pressable>
          </View>
        )}
        {every > 0 && (
          <View style={[styles.status, overdue && { backgroundColor: HT.warningTint }]} testID="visit-freq-status">
            <Ionicons name={overdue ? "alert-circle" : "checkmark-circle"} size={16} color={overdue ? HT.warning : "#16A34A"} />
            <Text style={[styles.statusTxt, overdue && { color: "#FDBA74" }]}>
              {daysSince == null ? "Mai visitato: ripasso da pianificare" : overdue ? `Ultima visita ${daysSince} gg fa · ripasso in ritardo di ${daysSince - every} gg` : `Ultima visita ${daysSince} gg fa · prossimo ripasso tra ${every - daysSince} gg`}
            </Text>
          </View>
        )}
        {saving ? <Text style={styles.hint}>salvataggio…</Text> : null}
      </View>

      {/* Storico visite */}
      <View style={styles.card}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={styles.title}>📍 Storico visite</Text>
          {data ? <Text style={styles.total}>{data.items.length} visite · {fmtKm(data.total_km)} km</Text> : null}
        </View>
        <Pressable onPress={() => setManualOpen((v) => !v)} style={styles.addBtn} testID="visit-manual-toggle">
          <Ionicons name={manualOpen ? "chevron-up" : "add-circle"} size={16} color={SKY} /><Text style={styles.addTxt}>{manualOpen ? "Chiudi" : "Registra visita adesso"}</Text>
        </Pressable>
        {manualOpen && (
          <View style={{ gap: 8, marginBottom: 8 }}>
            <TextInput value={manualKm} onChangeText={setManualKm} placeholder="Km percorsi (opzionale, es. 12,5)" keyboardType="decimal-pad" placeholderTextColor={HT.muted} style={[styles.input, { width: "100%" }]} testID="visit-manual-km" />
            <TextInput value={manualNotes} onChangeText={setManualNotes} placeholder="Note visita (opzionale)" placeholderTextColor={HT.muted} style={[styles.input, { width: "100%", minHeight: 60 }]} multiline testID="visit-manual-notes" />
            <Pressable onPress={addManual} disabled={busy} style={[styles.btnSm, { alignSelf: "flex-end" }]} testID="visit-manual-save">{busy ? <ActivityIndicator color="#FFF" size="small" /> : <Text style={styles.btnSmTxt}>Salva visita</Text>}</Pressable>
          </View>
        )}
        {!data ? <ActivityIndicator color={SKY} /> : data.items.length === 0 ? (
          <Text style={styles.hint}>Nessuna visita confermata. Le visite arrivano dal Giro Ottimale («Visita completata»), dal Rilevamento GPS o da qui.</Text>
        ) : data.items.map((v) => {
          const src = SRC[v.source] || SRC.manual;
          return (
            <View key={v.visit_id} style={styles.row} testID={`visit-row-${v.visit_id}`}>
              <View style={[styles.dot, { backgroundColor: src.color }]}><Ionicons name={src.icon} size={14} color="#FFF" /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{fmtDT(v.at)}</Text>
                <Text style={styles.rowMeta}>{src.label}{v.stay_minutes ? ` · ~${v.stay_minutes} min` : ""}{v.notes ? ` · ${v.notes}` : ""}</Text>
              </View>
              <Text style={styles.km}>{fmtKm(v.km)} km</Text>
              <Pressable onPress={() => remove(v)} hitSlop={8} style={styles.del} testID={`visit-del-${v.visit_id}`}><Ionicons name="trash-outline" size={15} color="#DC2626" /></Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: HT.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: HT.border, gap: 6 },
  title: { fontSize: 15, fontWeight: "800", color: HT.text },
  hint: { fontSize: 11, color: HT.muted, lineHeight: 15 },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  pill: { paddingHorizontal: 12, minHeight: 36, justifyContent: "center", borderRadius: 18, borderWidth: 1, borderColor: HT.border, backgroundColor: HT.card2 },
  pillOn: { backgroundColor: '#7C3AED', borderColor: '#7C3AED' }, pillTxt: { fontSize: 12, fontWeight: "700", color: HT.text },
  input: { width: 110, backgroundColor: HT.card2, borderRadius: 10, borderWidth: 1, borderColor: HT.border, paddingHorizontal: 10, minHeight: 42, color: HT.text, fontSize: 13 },
  btnSm: { backgroundColor: SKY, borderRadius: 10, paddingHorizontal: 14, minHeight: 42, justifyContent: "center", alignItems: "center" }, btnSmTxt: { color: "#FFF", fontWeight: "800", fontSize: 13 },
  status: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: HT.successTint, borderRadius: 10, padding: 8, marginTop: 8 }, statusTxt: { flex: 1, fontSize: 12, fontWeight: "700", color: HT.success },
  total: { fontSize: 12, fontWeight: "800", color: SKY },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", minHeight: 36, paddingHorizontal: 4 }, addTxt: { fontSize: 13, fontWeight: "800", color: SKY },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: HT.border, minHeight: 48 },
  dot: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  rowTitle: { fontSize: 13, fontWeight: "700", color: HT.text, textTransform: "capitalize" }, rowMeta: { fontSize: 11, color: HT.muted, marginTop: 1 },
  km: { fontSize: 13, fontWeight: "900", color: HT.text }, del: { width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 8, backgroundColor: HT.dangerTint },
});

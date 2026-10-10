// StressScheduleCalendar.tsx — V50.z509 — CALENDARIO STRESS TEST: i test di Axon si programmano come appuntamenti ricorrenti.
// Vista mese (giorni con test evidenziati, tap su un giorno → occorrenze del giorno + «Programma qui»), elenco programmazioni
// (attiva/disattiva, esegui ora, elimina) e form con ricorrenza: Una volta sola · Settimanale · Mensile · Personalizzata.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, Modal, TextInput, ActivityIndicator, Platform, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { HT } from "@/src/homeTheme";
import { notify } from "@/src/utils/notify";

const VIOLET = "#7C3AED";
type Kind = "once" | "weekly" | "monthly" | "custom";
type Schedule = { schedule_id: string; title: string; kind: Kind; time: string; once_date?: string | null; weekdays?: number[] | null; month_day?: number | null; interval_days?: number | null; mode: "quick" | "full"; reps: number; enabled: boolean; next_run_at?: string | null; last_run_at?: string | null; last_run_id?: string | null; label: string };
type Occ = { date: string; time: string; schedule_id: string; title: string; kind: Kind; label: string };
const KINDS: { k: Kind; l: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { k: "once", l: "Una volta sola", icon: "calendar-outline" }, { k: "weekly", l: "Settimanale", icon: "repeat" },
  { k: "monthly", l: "Mensile", icon: "calendar-number-outline" }, { k: "custom", l: "Personalizzata", icon: "options-outline" }];
const WD = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function StressScheduleCalendar({ onRunStarted }: { onRunStarted?: (runId: string) => void }) {
  const [items, setItems] = useState<Schedule[]>([]);
  const [occ, setOcc] = useState<Occ[]>([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [selDay, setSelDay] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Schedule> | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([api<{ items: Schedule[] }>("/axon/stress/schedules"), api<{ items: Occ[] }>("/axon/stress/schedules/upcoming?days=90")]);
      setItems(a.items || []); setOcc(b.items || []);
    } catch (e: any) { notify("Calendario test", e?.message || "Errore"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const occByDay = useMemo(() => { const m: Record<string, Occ[]> = {}; for (const o of occ) (m[o.date] ||= []).push(o); return m; }, [occ]);
  const cells = useMemo(() => {
    const lead = (new Date(cursor.getFullYear(), cursor.getMonth(), 1).getDay() + 6) % 7;
    const days = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const out: (Date | null)[] = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= days; d++) out.push(new Date(cursor.getFullYear(), cursor.getMonth(), d));
    while (out.length % 7) out.push(null);
    return out;
  }, [cursor]);
  const todayKey = ymd(new Date());
  const monthLabel = cursor.toLocaleDateString("it-IT", { month: "long", year: "numeric" });

  const save = async () => {
    if (!form || saving) return;
    setSaving(true);
    try {
      const body: any = { title: form.title, kind: form.kind, time: form.time, once_date: form.once_date, weekdays: form.weekdays, month_day: form.month_day, interval_days: form.interval_days, mode: form.mode, reps: form.reps, enabled: form.enabled ?? true };
      if (form.schedule_id) await api(`/axon/stress/schedules/${form.schedule_id}`, { method: "PUT", body });
      else await api("/axon/stress/schedules", { method: "POST", body });
      setForm(null); await load();
    } catch (e: any) { notify("Calendario test", e?.message || "Impossibile salvare"); }
    finally { setSaving(false); }
  };
  const toggle = async (s: Schedule) => { try { await api(`/axon/stress/schedules/${s.schedule_id}`, { method: "PUT", body: { enabled: !s.enabled } }); await load(); } catch (e: any) { notify("Calendario test", e?.message || "Errore"); } };
  const remove = async (s: Schedule) => { try { await api(`/axon/stress/schedules/${s.schedule_id}`, { method: "DELETE" }); await load(); } catch (e: any) { notify("Calendario test", e?.message || "Errore"); } };
  const runNow = async (s: Schedule) => { try { const r = await api<{ run_id: string }>(`/axon/stress/schedules/${s.schedule_id}/run-now`, { method: "POST" }); notify("Stress test", "Test avviato ora"); onRunStarted?.(r.run_id); await load(); } catch (e: any) { notify("Calendario test", e?.message || "Errore"); } };
  const newForm = (date?: string) => setForm({ title: "Stress test Axon", kind: date ? "once" : "weekly", time: "03:00", once_date: date || todayKey, weekdays: [0], month_day: 1, interval_days: 2, mode: "quick", reps: 3, enabled: true });

  return (
    <View style={s.card} testID="stress-schedule-calendar">
      <View style={s.rowBetween}>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>📅 Calendario stress test</Text>
          <Text style={s.hint}>Programma i test come appuntamenti ricorrenti: una volta sola, ogni settimana, ogni mese o personalizzati. Il test notturno quotidiano fisso è disattivato di default.</Text>
        </View>
        <Pressable onPress={() => newForm()} style={s.addBtn} testID="stress-schedule-add"><Ionicons name="add" size={16} color="#FFF" /><Text style={s.addTxt}>Programma</Text></Pressable>
      </View>

      {/* Vista mese */}
      <View style={s.calHead}>
        <Pressable onPress={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} style={s.navBtn} testID="stress-cal-prev"><Ionicons name="chevron-back" size={18} color={HT.text} /></Pressable>
        <Text style={s.month}>{monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1)}</Text>
        <Pressable onPress={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} style={s.navBtn} testID="stress-cal-next"><Ionicons name="chevron-forward" size={18} color={HT.text} /></Pressable>
      </View>
      <View style={s.week}>{WD.map((d) => <Text key={d} style={s.dow}>{d.charAt(0)}</Text>)}</View>
      <View style={s.grid}>
        {cells.map((d, i) => {
          if (!d) return <View key={`e${i}`} style={s.cell} />;
          const k = ymd(d); const n = occByDay[k]?.length || 0; const sel = selDay === k;
          return (
            <Pressable key={k} onPress={() => setSelDay(sel ? null : k)} style={s.cell} testID={`stress-cal-day-${k}`}>
              <View style={[s.day, n > 0 && s.dayBusy, k === todayKey && s.dayToday, sel && s.daySel]}>
                <Text style={[s.dayTxt, n > 0 && { color: "#FFF", fontWeight: "900" }, sel && !n && { color: VIOLET }]}>{d.getDate()}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      {selDay ? (
        <View style={s.dayBox} testID="stress-cal-daybox">
          <Text style={s.dayBoxTitle}>{new Date(selDay + "T12:00:00").toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" })}</Text>
          {(occByDay[selDay] || []).map((o, i) => <Text key={i} style={s.occTxt}>• {o.time} · {o.title} <Text style={{ color: HT.muted }}>({o.label})</Text></Text>)}
          {!(occByDay[selDay] || []).length ? <Text style={s.occTxt}>Nessun test programmato</Text> : null}
          <Pressable onPress={() => newForm(selDay)} style={s.linkBtn} testID="stress-cal-schedule-here"><Ionicons name="add-circle-outline" size={16} color={VIOLET} /><Text style={s.linkTxt}>Programma un test questo giorno</Text></Pressable>
        </View>
      ) : null}

      {/* Elenco programmazioni */}
      {loading ? <ActivityIndicator color={VIOLET} /> : items.length === 0 ? <Text style={s.hint}>Nessuna programmazione: premi «Programma» o tocca un giorno del calendario.</Text> : items.map((it) => (
        <View key={it.schedule_id} style={[s.schedRow, !it.enabled && { opacity: 0.6 }]} testID={`stress-schedule-${it.schedule_id}`}>
          <Pressable onPress={() => toggle(it)} style={s.eye} testID={`stress-schedule-toggle-${it.schedule_id}`}><Ionicons name={it.enabled ? "checkmark-circle" : "ellipse-outline"} size={24} color={it.enabled ? HT.success : HT.muted} /></Pressable>
          <Pressable style={{ flex: 1, minWidth: 0 }} onPress={() => setForm({ ...it })} testID={`stress-schedule-edit-${it.schedule_id}`}>
            <Text style={s.schedTitle} numberOfLines={1}>{it.title}</Text>
            <Text style={s.schedSub} numberOfLines={2}>{it.label} · {it.mode === "full" ? "completo" : "rapido"} ×{it.reps}{it.next_run_at ? ` · prossimo: ${new Date(it.next_run_at).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : it.enabled ? "" : " · disattivata"}</Text>
          </Pressable>
          <Pressable onPress={() => runNow(it)} style={s.iconBtn} testID={`stress-schedule-run-${it.schedule_id}`} accessibilityLabel="Esegui ora"><Ionicons name="play" size={16} color={VIOLET} /></Pressable>
          <Pressable onPress={() => remove(it)} style={s.iconBtn} testID={`stress-schedule-del-${it.schedule_id}`} accessibilityLabel="Elimina"><Ionicons name="trash-outline" size={16} color={HT.danger} /></Pressable>
        </View>
      ))}

      {/* Form ricorrenza */}
      {form ? (
        <Modal transparent animationType="fade" visible onRequestClose={() => setForm(null)}>
          <Pressable style={s.backdrop} onPress={() => setForm(null)}>
            <Pressable style={s.sheet} onPress={() => {}} testID="stress-schedule-form">
              <ScrollView contentContainerStyle={{ gap: 10 }}>
                <Text style={s.title}>{form.schedule_id ? "Modifica programmazione" : "Nuova programmazione"}</Text>
                <TextInput value={form.title || ""} onChangeText={(t) => setForm({ ...form, title: t })} placeholder="Titolo" placeholderTextColor={HT.muted} style={s.input} testID="stress-schedule-title" />
                <Text style={s.lab}>Ricorrenza</Text>
                <View style={s.rowWrap}>{KINDS.map((k) => <Pressable key={k.k} onPress={() => setForm({ ...form, kind: k.k })} style={[s.chip, form.kind === k.k && s.chipOn]} testID={`stress-schedule-kind-${k.k}`}><Ionicons name={k.icon} size={13} color={form.kind === k.k ? "#FFF" : HT.text} /><Text style={[s.chipTxt, form.kind === k.k && s.chipTxtOn]}>{k.l}</Text></Pressable>)}</View>
                {form.kind === "once" ? (<>
                  <Text style={s.lab}>Data</Text>
                  {Platform.OS === "web" ? React.createElement("input", { type: "date", value: form.once_date || todayKey, "data-testid": "stress-schedule-date", onChange: (e: any) => setForm({ ...form, once_date: e.target.value }), style: webInput })
                    : <TextInput value={form.once_date || ""} onChangeText={(t) => setForm({ ...form, once_date: t })} placeholder="AAAA-MM-GG" placeholderTextColor={HT.muted} style={s.input} />}
                </>) : null}
                {form.kind === "weekly" || form.kind === "custom" ? (<>
                  <Text style={s.lab}>{form.kind === "weekly" ? "Giorni della settimana" : "Giorni della settimana (oppure lascia vuoto e usa l'intervallo)"}</Text>
                  <View style={s.rowWrap}>{WD.map((d, i) => { const on = (form.weekdays || []).includes(i); return <Pressable key={d} onPress={() => setForm({ ...form, weekdays: on ? (form.weekdays || []).filter((x) => x !== i) : [...(form.weekdays || []), i].sort() })} style={[s.chip, on && s.chipOn]} testID={`stress-schedule-wd-${i}`}><Text style={[s.chipTxt, on && s.chipTxtOn]}>{d}</Text></Pressable>; })}</View>
                </>) : null}
                {form.kind === "monthly" ? (<>
                  <Text style={s.lab}>Giorno del mese</Text>
                  <View style={s.rowWrap}>{[1, 5, 10, 15, 20, 25, 31].map((n) => <Pressable key={n} onPress={() => setForm({ ...form, month_day: n })} style={[s.chip, form.month_day === n && s.chipOn]} testID={`stress-schedule-md-${n}`}><Text style={[s.chipTxt, form.month_day === n && s.chipTxtOn]}>{n === 31 ? "Ultimo" : n === 1 ? "Primo" : String(n)}</Text></Pressable>)}
                    <TextInput value={String(form.month_day || 1)} onChangeText={(t) => setForm({ ...form, month_day: Math.max(1, Math.min(31, parseInt(t || "1", 10) || 1)) })} keyboardType="number-pad" style={[s.input, { width: 70, textAlign: "center" }]} testID="stress-schedule-md-input" /></View>
                </>) : null}
                {form.kind === "custom" ? (<>
                  <Text style={s.lab}>Ogni N giorni (se nessun giorno della settimana è selezionato)</Text>
                  <View style={s.rowWrap}>{[2, 3, 7, 14, 30].map((n) => <Pressable key={n} onPress={() => setForm({ ...form, interval_days: n, weekdays: [] })} style={[s.chip, form.interval_days === n && !(form.weekdays || []).length && s.chipOn]} testID={`stress-schedule-int-${n}`}><Text style={[s.chipTxt, form.interval_days === n && !(form.weekdays || []).length && s.chipTxtOn]}>{n} gg</Text></Pressable>)}</View>
                </>) : null}
                <Text style={s.lab}>Ora di avvio (Italia)</Text>
                {Platform.OS === "web" ? React.createElement("input", { type: "time", value: form.time || "03:00", "data-testid": "stress-schedule-time", onChange: (e: any) => setForm({ ...form, time: e.target.value }), style: webInput })
                  : <TextInput value={form.time || ""} onChangeText={(t) => setForm({ ...form, time: t })} placeholder="HH:MM" placeholderTextColor={HT.muted} style={s.input} />}
                <Text style={s.lab}>Campione · Ripetizioni</Text>
                <View style={s.rowWrap}>
                  {(["quick", "full"] as const).map((m) => <Pressable key={m} onPress={() => setForm({ ...form, mode: m })} style={[s.chip, form.mode === m && s.chipOn]} testID={`stress-schedule-mode-${m}`}><Text style={[s.chipTxt, form.mode === m && s.chipTxtOn]}>{m === "quick" ? "Rapido (~60 domande)" : "Completo (tutte)"}</Text></Pressable>)}
                  {[1, 2, 3, 5].map((r) => <Pressable key={r} onPress={() => setForm({ ...form, reps: r })} style={[s.chip, form.reps === r && s.chipOn]} testID={`stress-schedule-reps-${r}`}><Text style={[s.chipTxt, form.reps === r && s.chipTxtOn]}>×{r}</Text></Pressable>)}
                </View>
                <View style={[s.rowWrap, { justifyContent: "flex-end", marginTop: 6 }]}>
                  <Pressable onPress={() => setForm(null)} style={[s.btn, s.btnGhost]} testID="stress-schedule-cancel"><Text style={s.btnGhostTxt}>Annulla</Text></Pressable>
                  <Pressable onPress={save} style={[s.btn, saving && { opacity: 0.6 }]} disabled={saving} testID="stress-schedule-save">{saving ? <ActivityIndicator color="#FFF" size="small" /> : <Ionicons name="save-outline" size={16} color="#FFF" />}<Text style={s.btnTxt}>Salva</Text></Pressable>
                </View>
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
    </View>
  );
}

const webInput: any = { width: "100%", backgroundColor: HT.card2, border: `1px solid ${HT.border}`, borderRadius: 10, padding: "10px 12px", fontSize: 14, color: HT.text, fontFamily: "inherit", outline: "none", boxSizing: "border-box" };

const s = StyleSheet.create({
  card: { backgroundColor: HT.card, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: HT.border, gap: 8 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  rowWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  title: { fontSize: 15, fontWeight: "900", color: HT.text },
  hint: { fontSize: 12, color: HT.muted, lineHeight: 17 },
  lab: { fontSize: 11, fontWeight: "900", color: HT.muted, letterSpacing: 0.3, marginTop: 4 },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: VIOLET, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, minHeight: 36 },
  addTxt: { color: "#FFF", fontWeight: "800", fontSize: 12.5 },
  calHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  navBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: HT.card2 },
  month: { color: HT.text, fontWeight: "800", fontSize: 14 },
  week: { flexDirection: "row" }, dow: { flex: 1, textAlign: "center", color: HT.text2, fontSize: 11, fontWeight: "800" },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: `${100 / 7}%`, alignItems: "center", paddingVertical: 2, minHeight: 40, justifyContent: "center" },
  day: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  dayBusy: { backgroundColor: VIOLET }, dayToday: { borderWidth: 2, borderColor: HT.axon }, daySel: { borderWidth: 2, borderColor: VIOLET },
  dayTxt: { color: HT.text, fontSize: 13, fontWeight: "600" },
  dayBox: { backgroundColor: HT.card2, borderRadius: 12, padding: 10, gap: 4, borderWidth: 1, borderColor: HT.border },
  dayBoxTitle: { color: HT.text, fontWeight: "800", textTransform: "capitalize" },
  occTxt: { color: HT.text, fontSize: 12.5 },
  linkBtn: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 40, paddingTop: 4 },
  linkTxt: { color: VIOLET, fontWeight: "800", fontSize: 13 },
  schedRow: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: HT.border, borderRadius: 12, padding: 8, backgroundColor: HT.card2 },
  eye: { width: 36, height: 40, alignItems: "center", justifyContent: "center" },
  schedTitle: { color: HT.text, fontWeight: "800", fontSize: 13.5 }, schedSub: { color: HT.muted, fontSize: 11.5, marginTop: 1 },
  iconBtn: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", padding: 16 },
  sheet: { backgroundColor: HT.card, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: HT.border, maxWidth: 560, width: "100%", alignSelf: "center", maxHeight: "90%" },
  input: { backgroundColor: HT.card2, borderWidth: 1, borderColor: HT.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: HT.text, fontSize: 14, minHeight: 44 },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border, borderRadius: 999, paddingHorizontal: 12, minHeight: 36, justifyContent: "center" },
  chipOn: { backgroundColor: VIOLET, borderColor: VIOLET }, chipTxt: { fontSize: 12.5, fontWeight: "800", color: HT.text }, chipTxtOn: { color: "#FFF" },
  btn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: VIOLET, paddingHorizontal: 16, paddingVertical: 12, minHeight: 44, borderRadius: 12 },
  btnTxt: { color: "#FFF", fontWeight: "800" }, btnGhost: { backgroundColor: HT.card2, borderWidth: 1, borderColor: HT.border }, btnGhostTxt: { color: HT.text, fontWeight: "800" },
});

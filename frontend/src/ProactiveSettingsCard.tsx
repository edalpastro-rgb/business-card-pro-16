// ProactiveSettingsCard.tsx — V50.z196 — Impostazioni proattività (Notifiche AxonOS → Preferenze). Modulo ISOLATO.
// Orario/giorni briefing, report lunedì, max suggerimenti/giorno (+ tetto team per il Master), ore silenzio,
// soglie (inattività, scadenza critica, richiamata non evasa, contratti, anomalia %, obiettivo %), toggle per tipo di alert,
// obiettivi settimanali. Salvataggio immediato per campo.
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Switch, TextInput, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";
import { proactiveApi, ProactiveConfig } from "@/src/axonProactive";

const AXON = "#7C3AED";
const DAYS = ["L", "M", "M", "G", "V", "S", "D"];
const ALERTS: [string, string, string][] = [
  ["inactive", "Cliente inattivo da N giorni", "inactive_days"],
  ["appointment_tomorrow", "Appuntamento domani (briefing cliente)", ""],
  ["contract_expiry", "Contratto in scadenza entro N giorni", "contract_days"],
  ["goal_progress", "Obiettivo settimanale sotto soglia a metà settimana", "goal_alert_pct"],
  ["deadline", "Scadenza critica entro N ore", "deadline_hours"],
  ["callback_overdue", "Richiamata urgente non evasa da N ore", "callback_overdue_hours"],
  ["imported_anomaly", "Anomalia su dati importati (variazione > N %)", "anomaly_pct"],
  ["custom_reminder", "Promemoria impostati da AxonOS in chat", ""],
];
const TARGETS: [string, string][] = [["calls", "Telefonate"], ["appointments", "Appuntamenti"], ["contracts", "Contratti"], ["new_contacts", "Nuovi contatti"]];

function NumField({ value, onCommit, width = 64, suffix, testID }: { value: number | string; onCommit: (v: string) => void; width?: number; suffix?: string; testID?: string }) {
  const [v, setV] = useState(String(value));
  useEffect(() => { setV(String(value)); }, [value]);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <TextInput value={v} onChangeText={setV} onBlur={() => v !== String(value) && onCommit(v)} onSubmitEditing={() => onCommit(v)} keyboardType="numbers-and-punctuation"
        style={[styles.input, { width }]} testID={testID} />
      {suffix ? <Text style={styles.suffix}>{suffix}</Text> : null}
    </View>
  );
}

function TimeField({ value, onCommit, testID }: { value: string; onCommit: (v: string) => void; testID?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);
  const commit = () => { if (v !== value && /^\d{1,2}[:.]\d{2}$/.test(v.trim())) onCommit(v.trim().replace(".", ":")); else setV(value); };
  return <TextInput value={v} onChangeText={setV} onBlur={commit} onSubmitEditing={commit} placeholder="HH:MM" placeholderTextColor="#94A3B8" style={[styles.input, { width: 64 }]} testID={testID} />;
}

export function ProactiveSettingsCard() {
  const router = useRouter();
  const [cfg, setCfg] = useState<ProactiveConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => { try { setCfg(await proactiveApi.config()); } catch { /* offline */ } }, []);
  useEffect(() => { void load(); }, [load]);

  const save = async (patch: Record<string, any>) => {
    setSaving(true);
    try { setCfg(await proactiveApi.saveConfig(patch)); } catch (e: any) { notify("Proattività", e?.message || String(e)); } finally { setSaving(false); }
  };
  const num = (k: string) => (v: string) => { const n = parseInt(v.replace(/\D/g, ""), 10); if (Number.isFinite(n)) void save({ [k]: n }); };

  if (!cfg) return <View style={styles.card}><ActivityIndicator color={AXON} /></View>;

  return (
    <View style={styles.card} testID="proactive-settings-card">
      <View style={styles.head}>
        <Ionicons name="sparkles" size={18} color={AXON} />
        <Text style={styles.headTxt}>Proattività AxonOS</Text>
        {saving ? <ActivityIndicator size="small" color={AXON} /> : <Pressable onPress={() => router.push("/axon-proactive" as any)} hitSlop={8}><Text style={styles.link}>Apri</Text></Pressable>}
      </View>
      <Text style={styles.intro}>AxonOS parla per primo: briefing, suggerimenti e alert arrivano come notifica push, come bubble in Home e già scritti in chat.</Text>

      {/* Briefing */}
      <View style={styles.row}>
        <Ionicons name="sunny" size={18} color="#F59E0B" style={{ width: 26 }} />
        <Text style={styles.label}>Briefing mattutino alle</Text>
        <TimeField value={cfg.briefing_time} onCommit={(v) => save({ briefing_time: v })} testID="proactive-briefing-time" />
        <Switch value={cfg.briefing_enabled} onValueChange={(v) => save({ briefing_enabled: v })} trackColor={{ true: AXON }} testID="proactive-briefing-enabled" />
      </View>
      <View style={styles.daysRow}>
        {DAYS.map((d, i) => {
          const on = cfg.briefing_days.includes(i);
          return (
            <Pressable key={i} onPress={() => save({ briefing_days: on ? cfg.briefing_days.filter((x) => x !== i) : [...cfg.briefing_days, i] })} style={[styles.day, on && { backgroundColor: AXON }]} testID={`proactive-day-${i}`}>
              <Text style={[styles.dayTxt, on && { color: "#FFF" }]}>{d}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* Report settimanale */}
      <View style={styles.row}>
        <Ionicons name="calendar" size={18} color="#0EA5E9" style={{ width: 26 }} />
        <Text style={styles.label}>Report del lunedì alle</Text>
        <TimeField value={cfg.weekly_report_time} onCommit={(v) => save({ weekly_report_time: v })} testID="proactive-weekly-time" />
        <Switch value={cfg.weekly_report_enabled} onValueChange={(v) => save({ weekly_report_enabled: v })} trackColor={{ true: AXON }} testID="proactive-weekly-enabled" />
      </View>

      {/* Frequenza + silenzio */}
      <View style={styles.row}>
        <Ionicons name="bulb" size={18} color={AXON} style={{ width: 26 }} />
        <Text style={styles.label}>Max suggerimenti al giorno</Text>
        <NumField value={cfg.max_suggestions_per_day} onCommit={num("max_suggestions_per_day")} width={52} testID="proactive-max-sugg" />
      </View>
      {cfg.is_master ? (
        <View style={styles.row}>
          <Ionicons name="people" size={18} color={AXON} style={{ width: 26 }} />
          <Text style={styles.label}>Tetto per tutto il team (Master)</Text>
          <NumField value={cfg.team_max_suggestions_per_day} onCommit={num("team_max_suggestions_per_day")} width={52} testID="proactive-team-max" />
        </View>
      ) : (
        <Text style={styles.hint}>Il Master ha fissato un tetto di {cfg.effective_max_suggestions_per_day} suggerimenti al giorno per il team.</Text>
      )}
      <View style={styles.row}>
        <Ionicons name="moon" size={18} color="#64748B" style={{ width: 26 }} />
        <Text style={styles.label}>Silenzio dalle</Text>
        <TimeField value={cfg.quiet_start} onCommit={(v) => save({ quiet_start: v })} testID="proactive-quiet-start" />
        <Text style={styles.label}>alle</Text>
        <TimeField value={cfg.quiet_end} onCommit={(v) => save({ quiet_end: v })} testID="proactive-quiet-end" />
      </View>

      {/* Alert + soglie */}
      <Text style={styles.secTitle}>Suggerimenti e alert</Text>
      {ALERTS.map(([k, label, thrKey]) => (
        <View key={k} style={styles.row} testID={`proactive-alert-${k}`}>
          <Text style={[styles.label, { flex: 1 }]}>{label}</Text>
          {thrKey ? <NumField value={(cfg as any)[thrKey]} onCommit={num(thrKey)} width={56} suffix={thrKey.endsWith("pct") ? "%" : thrKey.endsWith("hours") ? "h" : "gg"} testID={`proactive-thr-${thrKey}`} /> : null}
          <Switch value={cfg.alerts[k] !== false} onValueChange={(v) => save({ alerts: { [k]: v } })} trackColor={{ true: AXON }} testID={`proactive-toggle-${k}`} />
        </View>
      ))}

      {/* Obiettivi settimanali */}
      <Text style={styles.secTitle}>Obiettivi settimanali (target)</Text>
      <View style={styles.targets}>
        {TARGETS.map(([k, label]) => (
          <View key={k} style={styles.target}>
            <Text style={styles.targetLbl}>{label}</Text>
            <NumField value={cfg.weekly_targets[k] ?? 0} onCommit={(v) => { const n = parseInt(v, 10); if (Number.isFinite(n)) void save({ weekly_targets: { [k]: n } }); }} width={60} testID={`proactive-target-${k}`} />
          </View>
        ))}
      </View>
      <Text style={styles.hint}>Per attivare/disattivare le notifiche push per tipo (briefing, suggerimenti, alert, report) usa gli interruttori qui sotto.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: theme.color.surfaceSecondary, borderRadius: 14, borderWidth: 1, borderColor: "#C4B5FD", padding: 14, gap: 10 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  headTxt: { flex: 1, fontSize: 13, fontWeight: "900", color: theme.color.muted, textTransform: "uppercase", letterSpacing: 0.5 },
  link: { color: AXON, fontWeight: "800", fontSize: 13 },
  intro: { fontSize: 12.5, color: theme.color.muted, lineHeight: 17 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 },
  label: { fontSize: 13.5, color: theme.color.onSurface, fontWeight: "600", flexShrink: 1 },
  input: { backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border, borderRadius: 10, paddingHorizontal: 8, minHeight: 40, fontSize: 13.5, color: theme.color.onSurface, textAlign: "center" },
  suffix: { fontSize: 12, color: theme.color.muted },
  daysRow: { flexDirection: "row", gap: 6, paddingLeft: 26 },
  day: { width: 34, height: 34, borderRadius: 17, backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border, alignItems: "center", justifyContent: "center" },
  dayTxt: { fontSize: 12, fontWeight: "800", color: theme.color.muted },
  secTitle: { fontSize: 12, fontWeight: "800", color: theme.color.muted, textTransform: "uppercase", letterSpacing: 0.4, marginTop: 6 },
  hint: { fontSize: 11.5, color: theme.color.muted, fontStyle: "italic" },
  targets: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  target: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: theme.color.surface, borderRadius: 10, borderWidth: 1, borderColor: theme.color.border, paddingHorizontal: 10, minHeight: 44, flexGrow: 1 },
  targetLbl: { fontSize: 12.5, fontWeight: "700", color: theme.color.onSurface, flex: 1 },
});

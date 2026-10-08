// app/admin/beta.tsx — V50.z474 — Pannello Master › «Cruscotto Beta»: le 10 metriche del piano «Beta sul campo» con soglia, stato
// (verde/giallo/rosso/n.d.), dettaglio e verdetto GO/ITERA/RIPENSA; controllo delle ondate del sondaggio NPS; ultimi commenti.
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, RefreshControl, Switch } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";

const C = theme.color;
const TEAL = "#0F766E";
type Metric = { key: string; label: string; value: number | null; unit: string; target: number; higher_is_better?: boolean; status: "ok" | "warn" | "ko" | "nd"; detail: string; breakdown?: Record<string, number> };
type Payload = { days: number; users: number; metrics: Metric[]; summary: { ok: number; nd: number; total: number; verdict: string }; nps_wave: { wave: number; active: boolean; ask_price: boolean; responses: number }; comments: { user: string; score: number; best?: string; worst?: string; at: string | null }[]; scope: "all" | "tenant" };

const STATUS = { ok: { color: "#16A34A", icon: "checkmark-circle" as const, label: "obiettivo raggiunto" }, warn: { color: "#D97706", icon: "alert-circle" as const, label: "vicino all'obiettivo" }, ko: { color: "#DC2626", icon: "close-circle" as const, label: "sotto l'obiettivo" }, nd: { color: "#64748B", icon: "help-circle" as const, label: "dati insufficienti" } };
const VERDICT: Record<string, { color: string; text: string }> = { GO: { color: "#16A34A", text: "GO — pronto per il rilascio pubblico" }, ITERA: { color: "#D97706", text: "ITERA — altre 3 settimane su affidabilità Axon / Android" }, RIPENSA: { color: "#DC2626", text: "RIPENSA — problema di valore percepito: rivedere onboarding e proposta" }, "IN CORSO": { color: TEAL, text: "IN CORSO — raccolta dati" } };
const fmtVal = (m: Metric) => (m.value === null || m.value === undefined ? "n/d" : `${Number.isInteger(m.value) ? m.value : m.value.toFixed(1)}${m.unit === "%" || m.unit === "% utenti" ? "%" : m.unit ? ` ${m.unit}` : ""}`);

export default function AdminBeta() {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(42);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await api<Payload>(`/admin/beta/dashboard?days=${days}`)); }
    catch (e: any) { notify("Cruscotto Beta", e?.message || "Errore di caricamento"); }
    finally { setLoading(false); }
  }, [days]);
  useEffect(() => { load(); }, [load]);

  const setWave = async (patch: Partial<Payload["nps_wave"]>) => {
    if (!data) return;
    const next = { ...data.nps_wave, ...patch };
    setSaving(true);
    try { await api("/admin/beta/nps-wave", { method: "POST", body: { wave: next.wave, active: next.active, ask_price: next.ask_price } }); setData({ ...data, nps_wave: next }); }
    catch (e: any) { notify("Sondaggio", e?.message || "Salvataggio non riuscito"); }
    finally { setSaving(false); }
  };

  const verdict = data ? VERDICT[data.summary.verdict] || VERDICT["IN CORSO"] : null;

  return (
    <SafeAreaView style={s.container} edges={["top"]}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.iconBtn} testID="beta-back"><Ionicons name="chevron-back" size={24} color={C.onSurface} /></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.hTitle}>Cruscotto Beta</Text>
          <Text style={s.hSub}>{data ? `${data.users} utenti · ${data.summary.ok}/${data.summary.total} metriche a obiettivo · ${data.scope === "all" ? "tutte le reti" : "la tua rete"}` : "Caricamento…"}</Text>
        </View>
        <Pressable onPress={load} style={s.addBtn} disabled={loading} testID="beta-refresh">
          {loading ? <ActivityIndicator color={C.onSurfaceInverse} /> : <><Ionicons name="refresh" size={16} color={C.onSurfaceInverse} /><Text style={s.addTxt}>Aggiorna</Text></>}
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={s.list} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />} testID="beta-list">
        <View style={s.filters}>
          {[14, 28, 42, 90].map((d) => (
            <Pressable key={d} onPress={() => setDays(d)} style={[s.chip, days === d && s.chipOn]} testID={`beta-days-${d}`}><Text style={[s.chipTxt, days === d && s.chipTxtOn]}>{d} gg</Text></Pressable>
          ))}
        </View>
        {data && verdict ? (
          <View style={[s.card, { borderColor: verdict.color, borderWidth: 2 }]} testID="beta-verdict">
            <View style={s.rowBetween}>
              <Text style={[s.verdict, { color: verdict.color }]}>{data.summary.verdict}</Text>
              <Text style={s.hint}>{data.summary.ok} ok · {data.summary.total - data.summary.ok - data.summary.nd} sotto · {data.summary.nd} n/d</Text>
            </View>
            <Text style={s.lbl}>{verdict.text}</Text>
            <Text style={s.hint}>Regola: GO se Attivazione, Comandi Axon, Stabilità e NPS sono a obiettivo e almeno 6 metriche su 10 lo sono. Periodo: ultimi {data.days} giorni.</Text>
          </View>
        ) : null}
        {data?.metrics.map((m, i) => {
          const st = STATUS[m.status];
          return (
            <View key={m.key} style={s.card} testID={`beta-metric-${m.key}`}>
              <View style={s.rowBetween}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                  <Ionicons name={st.icon} size={22} color={st.color} />
                  <Text style={s.cardTitle} numberOfLines={2}>{i + 1}. {m.label}</Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={[s.value, { color: st.color }]}>{fmtVal(m)}</Text>
                  <Text style={s.target}>obiettivo {m.higher_is_better === false ? "≤" : "≥"} {m.target}{m.unit === "%" || m.unit === "% utenti" ? "%" : m.unit ? ` ${m.unit}` : ""}</Text>
                </View>
              </View>
              {m.value !== null && m.value !== undefined && (m.unit === "%" || m.unit === "% utenti") ? (
                <View style={s.bar}><View style={[s.barFill, { width: `${Math.min(100, Math.max(0, m.value))}%` as any, backgroundColor: st.color }]} /><View style={[s.barTarget, { left: `${Math.min(100, m.target)}%` as any }]} /></View>
              ) : null}
              <Text style={s.hint}>{m.detail}</Text>
            </View>
          );
        })}
        {data ? (
          <View style={s.card} testID="beta-nps-wave">
            <Text style={s.cardTitle}>Sondaggio NPS in-app</Text>
            <Text style={s.hint}>Quando l&apos;ondata è attiva, ogni utente vede l&apos;invito in Home e nel tab Help finché non risponde. Risposte ricevute per questa ondata: {data.nps_wave.responses}.</Text>
            <View style={s.rowBetween}><Text style={s.lbl}>Ondata attiva (n. {data.nps_wave.wave})</Text><Switch value={data.nps_wave.active} disabled={saving} onValueChange={(v) => setWave({ active: v })} trackColor={{ true: TEAL }} /></View>
            <View style={s.rowBetween}><Text style={s.lbl}>Chiedi anche la fascia di prezzo (settimana 6)</Text><Switch value={data.nps_wave.ask_price} disabled={saving} onValueChange={(v) => setWave({ ask_price: v })} trackColor={{ true: TEAL }} /></View>
            <View style={s.filters}>
              <Pressable onPress={() => setWave({ wave: data.nps_wave.wave + 1, active: true })} style={s.chip} disabled={saving} testID="beta-next-wave"><Ionicons name="play-forward" size={14} color={TEAL} /><Text style={s.chipTxt}> Nuova ondata (n. {data.nps_wave.wave + 1})</Text></Pressable>
              <Pressable onPress={() => router.push("/beta-nps" as any)} style={s.chip} testID="beta-preview-nps"><Ionicons name="eye-outline" size={14} color={TEAL} /><Text style={s.chipTxt}> Anteprima sondaggio</Text></Pressable>
            </View>
          </View>
        ) : null}
        {data?.comments.length ? (
          <View style={s.card} testID="beta-comments">
            <Text style={s.cardTitle}>Ultimi commenti</Text>
            {data.comments.map((c, i) => (
              <View key={i} style={{ gap: 2, paddingVertical: 6, borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderTopColor: C.divider }}>
                <Text style={s.lbl}>{c.user} · {c.score}/10</Text>
                {c.best ? <Text style={s.hint}>👍 {c.best}</Text> : null}
                {c.worst ? <Text style={s.hint}>👎 {c.worst}</Text> : null}
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.divider, backgroundColor: C.surfaceSecondary },
  iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  hTitle: { fontSize: 18, fontWeight: "800", color: C.onSurface },
  hSub: { fontSize: 12, color: C.muted },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: TEAL, paddingHorizontal: 14, minHeight: 44, borderRadius: 12 },
  addTxt: { color: C.onSurfaceInverse, fontWeight: "800" },
  list: { padding: 16, gap: 12, paddingBottom: 140 },
  card: { backgroundColor: C.surfaceSecondary, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.divider, gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: "800", color: C.onSurface, flex: 1 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  hint: { fontSize: 12.5, color: C.muted, lineHeight: 18 },
  lbl: { fontSize: 13, fontWeight: "700", color: C.onSurface, flex: 1 },
  value: { fontSize: 20, fontWeight: "900" },
  target: { fontSize: 11, color: C.muted },
  verdict: { fontSize: 22, fontWeight: "900" },
  bar: { height: 8, borderRadius: 4, backgroundColor: C.divider, overflow: "hidden" },
  barFill: { height: 8 },
  barTarget: { position: "absolute", top: -2, width: 2, height: 12, backgroundColor: C.onSurface },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, minHeight: 38, justifyContent: "center", borderRadius: 999, borderWidth: 1, borderColor: TEAL, backgroundColor: C.surfaceSecondary },
  chipOn: { backgroundColor: TEAL },
  chipTxt: { color: TEAL, fontWeight: "700", fontSize: 12.5 },
  chipTxtOn: { color: C.onSurfaceInverse },
});

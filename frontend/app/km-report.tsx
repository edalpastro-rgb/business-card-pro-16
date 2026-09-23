// km-report.tsx — V50.z253 — «Resoconto Km»: km delle visite completate nel Giro Ottimale (calcolati dal percorso, non GPS).
// Totali oggi / settimana / mese, dettaglio per giorno con eliminazione voce, navigazione tra mesi, export PDF per note spese.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, RefreshControl } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useInsetsSafe } from "@/src/hooks/useSafeBottom";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { api } from "@/src/api";
import { notify, confirmAsync } from "@/src/utils/notify";
import { useAuth } from "@/src/auth";
import { KmEntry, KmDay, exportKmReportPdf, fmtKm, monthLabel } from "@/src/utils/kmReportPdf";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

const SKY = "#0EA5E9"; const NAVY = HT.text;
type Totals = { today_km: number; today_visits: number; week_km: number; week_visits: number; month_km: number; month_visits: number; selected_month_km: number; selected_month_visits: number; week_start: string; week_end: string; today: string };
type Resp = { month: string; items: KmEntry[]; by_day: KmDay[]; totals: Totals };

const ymNow = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const todayLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const shiftMonth = (ym: string, delta: number) => { const [y, m] = ym.split("-").map(Number); const d = new Date(y, m - 1 + delta, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const dayLabel = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });
const ddmm = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" });

export default function KmReportScreen() {
  const router = useRouter();
  const insets = useInsetsSafe();
  const navPad = usePageBottomPadding(8);
  const { user } = useAuth();
  const [month, setMonth] = useState(ymNow());
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try { setData(await api<Resp>(`/geo/km-log?month=${month}&today=${todayLocal()}`)); }
    catch (e: any) { notify("Resoconto Km", e?.message || "Impossibile caricare i dati"); }
    finally { setLoading(false); setRefreshing(false); }
  }, [month]);
  useEffect(() => { load(); }, [load]);

  const t = data?.totals;
  const isCurrent = month === ymNow();
  const grouped = useMemo(() => (data?.by_day || []).map((d) => ({ ...d, entries: (data?.items || []).filter((e) => e.date === d.date) })), [data]);

  const removeEntry = async (e: KmEntry) => {
    if (!(await confirmAsync("Eliminare la voce?", `${e.contact_name} · ${fmtKm(e.km)} km del ${ddmm(e.date)}`))) return;
    setBusyId(e.entry_id);
    try { await api(`/geo/km-log/${e.entry_id}`, { method: "DELETE" }); await load(true); }
    catch (err: any) { notify("Errore", err?.message || ""); } finally { setBusyId(null); }
  };

  const doPdf = async () => {
    if (!data) return;
    setPdfBusy(true);
    try { await exportKmReportPdf(month, data.items, data.by_day, user?.name); } finally { setPdfBusy(false); }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} testID="km-back"><Ionicons name="arrow-back" size={22} color="#FFF" /></Pressable>
        <View style={{ flex: 1 }}><Text style={styles.title}>🚗 Resoconto Km</Text><Text style={styles.sub}>Km dalle visite completate nel Giro Ottimale</Text></View>
        <Pressable onPress={() => router.push("/optimal-route" as any)} hitSlop={8} style={styles.headBtn} testID="km-goto-route"><Ionicons name="car-sport" size={18} color="#FFF" /></Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: navPad + 70 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(true); }} tintColor={SKY} />}>
        {/* Totali oggi / settimana / mese (sempre riferiti a oggi) */}
        <View style={styles.cards} testID="km-totals">
          <TotalCard label="Oggi" km={t?.today_km ?? 0} visits={t?.today_visits ?? 0} sub={t ? ddmm(t.today) : ""} testID="km-total-today" />
          <TotalCard label="Settimana" km={t?.week_km ?? 0} visits={t?.week_visits ?? 0} sub={t ? `${ddmm(t.week_start)} – ${ddmm(t.week_end)}` : ""} testID="km-total-week" />
          <TotalCard label="Mese" km={t?.month_km ?? 0} visits={t?.month_visits ?? 0} sub={monthLabel(ymNow()).split(" ")[0]} testID="km-total-month" />
        </View>

        {/* Selettore mese + export */}
        <View style={styles.monthRow} testID="km-month-row">
          <Pressable onPress={() => setMonth((m) => shiftMonth(m, -1))} style={styles.mBtn} hitSlop={6} testID="km-month-prev"><Ionicons name="chevron-back" size={20} color={NAVY} /></Pressable>
          <View style={{ flex: 1, alignItems: "center" }}>
            <Text style={styles.mTitle}>{monthLabel(month)}</Text>
            <Text style={styles.mMeta}>{t ? `${fmtKm(t.selected_month_km)} km · ${t.selected_month_visits} visite` : "…"}</Text>
          </View>
          <Pressable onPress={() => setMonth((m) => shiftMonth(m, 1))} disabled={isCurrent} style={[styles.mBtn, isCurrent && { opacity: 0.35 }]} hitSlop={6} testID="km-month-next"><Ionicons name="chevron-forward" size={20} color={NAVY} /></Pressable>
        </View>
        <Pressable onPress={doPdf} disabled={pdfBusy || !data} style={[styles.cta, (pdfBusy || !data) && { opacity: 0.6 }]} testID="km-export-pdf">
          {pdfBusy ? <ActivityIndicator color="#FFF" /> : <><Ionicons name="document-text" size={18} color="#FFF" /><Text style={styles.ctaTxt}>Esporta PDF note spese · {monthLabel(month)}</Text></>}
        </Pressable>

        {loading && !data ? <ActivityIndicator color={SKY} style={{ marginTop: 30 }} /> : null}

        {data && !grouped.length ? (
          <View style={styles.empty} testID="km-empty">
            <Ionicons name="speedometer-outline" size={42} color={HT.muted} />
            <Text style={styles.emptyTitle}>Nessun km registrato in {monthLabel(month)}</Text>
            <Text style={styles.emptyTxt}>Calcola un Giro Ottimale e, dopo ogni visita, tocca «Visita completata»: i km della tratta finiranno qui automaticamente.</Text>
            <Pressable onPress={() => router.push("/optimal-route" as any)} style={[styles.cta, { alignSelf: "center", paddingHorizontal: 18 }]} testID="km-empty-cta"><Ionicons name="car-sport" size={16} color="#FFF" /><Text style={styles.ctaTxt}>Apri Giro Ottimale</Text></Pressable>
          </View>
        ) : null}

        {grouped.map((d) => (
          <View key={d.date} style={styles.day} testID={`km-day-${d.date}`}>
            <View style={styles.dayHead}>
              <Text style={styles.dayTitle}>{dayLabel(d.date)}</Text>
              <Text style={styles.dayKm}>{fmtKm(d.km)} km · {d.visits} {d.visits === 1 ? "visita" : "visite"}</Text>
            </View>
            {d.entries.map((e) => (
              <View key={e.entry_id} style={styles.entry} testID={`km-entry-${e.entry_id}`}>
                <View style={[styles.dot, e.seq === 0 && { backgroundColor: '#16A34A' }]}><Text style={styles.dotTxt}>{e.seq === 0 ? "🏁" : e.seq}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.eName}>{e.contact_name}{e.seq === 0 ? " (rientro)" : ""}</Text>
                  {!!(e.address || e.origin_label) && <Text style={styles.eMeta} numberOfLines={1}>📍 {e.address || e.origin_label}</Text>}
                </View>
                <Text style={styles.eKm}>{fmtKm(e.km)} km</Text>
                <Pressable onPress={() => removeEntry(e)} disabled={busyId === e.entry_id} hitSlop={8} style={styles.del} testID={`km-del-${e.entry_id}`}>
                  {busyId === e.entry_id ? <ActivityIndicator size="small" color="#DC2626" /> : <Ionicons name="trash-outline" size={16} color="#DC2626" />}
                </Pressable>
              </View>
            ))}
          </View>
        ))}

        <Text style={styles.note}>ℹ️ I km sono quelli stimati dal percorso del Giro Ottimale (linea d&apos;aria × 1,3), registrati quando spunti «Visita completata». Non provengono dal GPS reale.</Text>
      </ScrollView>
    </View>
  );
}

function TotalCard({ label, km, visits, sub, testID }: { label: string; km: number; visits: number; sub: string; testID: string }) {
  return (
    <View style={styles.card} testID={testID}>
      <Text style={styles.cardLabel}>{label}</Text>
      <Text style={styles.cardKm}>{fmtKm(km)}<Text style={styles.cardUnit}> km</Text></Text>
      <Text style={styles.cardSub}>{visits} {visits === 1 ? "visita" : "visite"}{sub ? ` · ${sub}` : ""}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: HT.card2 },
  header: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: NAVY, paddingHorizontal: 14, paddingVertical: 12 },
  title: { color: "#FFF", fontSize: 18, fontWeight: "900" }, sub: { color: "#CBD5E1", fontSize: 11, marginTop: 1 },
  headBtn: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.15)" },
  cards: { flexDirection: "row", gap: 8 },
  card: { flex: 1, backgroundColor: HT.card, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: HT.border, minHeight: 92 },
  cardLabel: { fontSize: 11, fontWeight: "800", color: SKY, textTransform: "uppercase", letterSpacing: 0.4 },
  cardKm: { fontSize: 22, fontWeight: "900", color: NAVY, marginTop: 4 }, cardUnit: { fontSize: 12, fontWeight: "700", color: HT.muted },
  cardSub: { fontSize: 10, color: HT.muted, marginTop: 2 },
  monthRow: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: HT.card, borderRadius: 14, padding: 8, borderWidth: 1, borderColor: HT.border },
  mBtn: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: HT.card2 },
  mTitle: { fontSize: 15, fontWeight: "900", color: NAVY, textTransform: "capitalize" }, mMeta: { fontSize: 11, color: HT.muted, marginTop: 1 },
  cta: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: SKY, borderRadius: 12, minHeight: 48, paddingHorizontal: 14 },
  ctaTxt: { color: "#FFF", fontWeight: "800", fontSize: 13 },
  empty: { alignItems: "center", gap: 10, padding: 24, backgroundColor: HT.card, borderRadius: 14, borderWidth: 1, borderColor: HT.border, marginTop: 8 },
  emptyTitle: { fontSize: 15, fontWeight: "800", color: NAVY, textAlign: "center" }, emptyTxt: { fontSize: 12, color: HT.muted, textAlign: "center", lineHeight: 17 },
  day: { backgroundColor: HT.card, borderRadius: 14, borderWidth: 1, borderColor: HT.border, overflow: "hidden" },
  dayHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 10, backgroundColor: HT.card2, borderBottomWidth: 1, borderBottomColor: HT.border },
  dayTitle: { fontSize: 13, fontWeight: "800", color: NAVY, textTransform: "capitalize" }, dayKm: { fontSize: 12, fontWeight: "900", color: SKY },
  entry: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: HT.border, minHeight: 52 },
  dot: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#FF6B35', alignItems: "center", justifyContent: "center" }, dotTxt: { color: "#FFF", fontWeight: "900", fontSize: 12 },
  eName: { fontSize: 13, fontWeight: "700", color: NAVY }, eMeta: { fontSize: 11, color: HT.muted, marginTop: 1 },
  eKm: { fontSize: 13, fontWeight: "900", color: NAVY }, del: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: HT.dangerTint },
  note: { fontSize: 11, color: HT.muted, lineHeight: 16, marginTop: 4 },
});

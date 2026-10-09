// MonthCalendarCompact.tsx — V50.z505 — Calendario mensile compatto per la Home: evidenzia i giorni con appuntamenti
// (GET /appointments?start&end del mese visibile), «oggi» cerchiato, frecce mese prec/succ, tap su un giorno → /calendario?date=YYYY-MM-DD.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { api } from "@/src/api";
import { HT } from "@/src/homeTheme";

type Appt = { appointment_id: string; start_at: string; done?: boolean; area?: "energy" | "network" };
const DOW = ["L", "M", "M", "G", "V", "S", "D"];

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function MonthCalendarCompact() {
  const router = useRouter();
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const end = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 59);
    try {
      const r = await api<{ items: Appt[] }>("/appointments", { query: { start: start.toISOString(), end: end.toISOString() } });
      const next: Record<string, number> = {};
      for (const a of r?.items || []) { const k = ymd(new Date(a.start_at)); next[k] = (next[k] || 0) + 1; }
      setCounts(next);
    } catch { /* offline: lascia l'ultimo stato */ }
    finally { setLoading(false); }
  }, [cursor]);
  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const cells = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const lead = (first.getDay() + 6) % 7; // lunedì = 0
    const days = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const out: (Date | null)[] = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= days; d++) out.push(new Date(cursor.getFullYear(), cursor.getMonth(), d));
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [cursor]);

  const todayKey = ymd(new Date());
  const monthLabel = cursor.toLocaleDateString("it-IT", { month: "long", year: "numeric" });
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <View style={styles.card} testID="home-month-calendar">
      <View style={styles.head}>
        <Pressable onPress={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} style={styles.navBtn} hitSlop={6} testID="cal-prev" accessibilityLabel="Mese precedente">
          <Ionicons name="chevron-back" size={18} color={HT.text} />
        </Pressable>
        <Pressable onPress={() => router.push("/(tabs)/calendario" as any)} style={{ flex: 1, alignItems: "center" }} testID="cal-open">
          <Text style={styles.month}>{monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1)}</Text>
          <Text style={styles.sub}>{loading ? "…" : total === 0 ? "Nessun appuntamento nel mese" : `${total} appuntament${total === 1 ? "o" : "i"} nel mese`}</Text>
        </Pressable>
        <Pressable onPress={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} style={styles.navBtn} hitSlop={6} testID="cal-next" accessibilityLabel="Mese successivo">
          <Ionicons name="chevron-forward" size={18} color={HT.text} />
        </Pressable>
      </View>
      <View style={styles.week}>
        {DOW.map((d, i) => <Text key={i} style={[styles.dow, i >= 5 && { color: HT.muted }]}>{d}</Text>)}
      </View>
      <View style={styles.grid}>
        {cells.map((d, i) => {
          if (!d) return <View key={`e${i}`} style={styles.cell} />;
          const k = ymd(d);
          const n = counts[k] || 0;
          const isToday = k === todayKey;
          return (
            <Pressable
              key={k}
              testID={`cal-day-${k}`}
              onPress={() => router.push({ pathname: "/(tabs)/calendario", params: { date: k } } as any)}
              style={({ pressed }) => [styles.cell, pressed && { opacity: 0.7 }]}
              accessibilityLabel={`${d.getDate()} ${monthLabel}${n ? `, ${n} appuntamenti` : ""}`}
            >
              <View style={[styles.day, n > 0 && styles.dayBusy, isToday && styles.dayToday]}>
                <Text style={[styles.dayTxt, n > 0 && styles.dayTxtBusy, isToday && styles.dayTxtToday]}>{d.getDate()}</Text>
              </View>
              {n > 0 ? <View style={styles.dot} /> : <View style={styles.dotPlaceholder} />}
            </Pressable>
          );
        })}
      </View>
      {loading && total === 0 ? <ActivityIndicator color={HT.brand} style={{ position: "absolute", right: 14, bottom: 12 }} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { ...HT.cardShadow, flex: 1, backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border, borderRadius: 16, padding: 12, gap: 6 },
  head: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  navBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: HT.card2 },
  month: { color: HT.text, fontWeight: "800", fontSize: 15 },
  sub: { color: HT.muted, fontSize: 11, fontWeight: "600", marginTop: 1 },
  week: { flexDirection: "row" },
  dow: { flex: 1, textAlign: "center", color: HT.text2, fontSize: 11, fontWeight: "800" },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: `${100 / 7}%`, alignItems: "center", paddingVertical: 3, minHeight: 44, justifyContent: "center" },
  day: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  dayBusy: { backgroundColor: HT.brandTint },
  dayToday: { borderWidth: 2, borderColor: HT.axon },
  dayTxt: { color: HT.text, fontSize: 13, fontWeight: "600" },
  dayTxtBusy: { color: HT.brand, fontWeight: "900" },
  dayTxtToday: { color: HT.axon, fontWeight: "900" },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: HT.brand, marginTop: 2 },
  dotPlaceholder: { width: 5, height: 5, marginTop: 2 },
});

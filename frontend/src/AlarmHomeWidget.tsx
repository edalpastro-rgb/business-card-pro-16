// V50.z10 — Widget "Prossima sveglia" nella Home.
// Card compatta sotto l'header che mostra la sveglia/timer/promemoria
// più imminente entro le prossime 12 ore. Se non ci sono → nascosto.
//
// Tap → apre la schermata /axon-alarms con la tab corrispondente.

import { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, Animated } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { api } from "@/src/api";
import { useTimeFormat, formatHM, formatDateTime } from "@/src/utils/timeFormat";
import type { Alarm } from "@/src/alarmNotifs";

const HORIZON_MS = 12 * 60 * 60 * 1000; // 12 ore

// ── Data extraction ──
function nextOccurrenceForAlarm(a: Alarm, now: Date = new Date()): Date | null {
  if (!a.enabled) return null;
  if (a.kind === "timer" || a.kind === "reminder") {
    if (!a.trigger_at) return null;
    const d = new Date(a.trigger_at);
    return d.getTime() > now.getTime() ? d : null;
  }
  if (a.kind === "alarm") {
    if (!a.time) return null;
    const [hStr, mStr] = a.time.split(":");
    const H = parseInt(hStr, 10);
    const M = parseInt(mStr, 10);
    if (isNaN(H) || isNaN(M)) return null;
    const weekdays = a.weekdays || [];
    if (weekdays.length === 0) {
      const cand = new Date(now);
      cand.setHours(H, M, 0, 0);
      if (cand.getTime() <= now.getTime() + 1000) cand.setDate(cand.getDate() + 1);
      return cand;
    }
    for (let i = 0; i < 8; i++) {
      const cand = new Date(now);
      cand.setDate(cand.getDate() + i);
      cand.setHours(H, M, 0, 0);
      if (cand.getTime() <= now.getTime() + 1000) continue;
      if (weekdays.includes(cand.getDay())) return cand;
    }
  }
  return null;
}

function iconFor(kind: string): keyof typeof Ionicons.glyphMap {
  if (kind === "timer") return "timer-outline";
  if (kind === "alarm") return "alarm-outline";
  return "notifications-outline";
}

function labelKind(kind: string): string {
  if (kind === "timer") return "Timer";
  if (kind === "alarm") return "Sveglia";
  return "Promemoria";
}

function relativeShort(target: Date, now: Date = new Date()): string {
  const diff = Math.max(0, Math.floor((target.getTime() - now.getTime()) / 1000));
  if (diff < 60) return `tra ${diff}s`;
  const m = Math.floor(diff / 60);
  if (m < 60) return `tra ${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  if (h < 24) return remM > 0 ? `tra ${h}h ${remM}m` : `tra ${h}h`;
  const d = Math.floor(h / 24);
  return `tra ${d}g`;
}

function isToday(d: Date, now: Date = new Date()): boolean {
  return d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
}

function isTomorrow(d: Date, now: Date = new Date()): boolean {
  const t = new Date(now);
  t.setDate(t.getDate() + 1);
  return d.getFullYear() === t.getFullYear() &&
    d.getMonth() === t.getMonth() &&
    d.getDate() === t.getDate();
}

// ── Component ──
export function AlarmHomeWidget() {
  const router = useRouter();
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [tick, setTick] = useState(0);
  const [timeFmt] = useTimeFormat();
  const [pulseAnim] = useState(new Animated.Value(1));

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: Alarm[] }>("/axon/alarms");
      setAlarms(r.items || []);
    } catch { /* silent */ }
  }, []);

  useFocusEffect(useCallback(() => {
    load();
  }, [load]));

  // Re-render ogni 30s per aggiornare il "tra Xm"
  useEffect(() => {
    const iv = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(iv);
  }, []);

  const next = useMemo(() => {
    const now = new Date();
    const horizon = new Date(now.getTime() + HORIZON_MS);
    let best: { alarm: Alarm; when: Date } | null = null;
    for (const a of alarms) {
      const when = nextOccurrenceForAlarm(a, now);
      if (!when) continue;
      if (when.getTime() > horizon.getTime()) continue;
      if (!best || when.getTime() < best.when.getTime()) {
        best = { alarm: a, when };
      }
    }
    return best;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alarms, tick]);

  // Pulse ravvicinato se manca meno di 5 min
  useEffect(() => {
    if (!next) return;
    const diff = next.when.getTime() - Date.now();
    if (diff > 5 * 60 * 1000) {
      pulseAnim.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.06, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [next, pulseAnim]);

  if (!next) return null;

  const { alarm, when } = next;
  const relative = relativeShort(when);
  const absolute = (() => {
    const timeStr = formatHM(when.getHours(), when.getMinutes(), timeFmt);
    if (isToday(when)) return `Oggi alle ${timeStr}`;
    if (isTomorrow(when)) return `Domani alle ${timeStr}`;
    return formatDateTime(when, timeFmt);
  })();

  return (
    <Animated.View style={[styles.wrap, { transform: [{ scale: pulseAnim }] }]}>
      <Pressable
        onPress={() => router.push({ pathname: "/axon-alarms" } as any)}
        style={styles.card}
        testID="home-alarm-widget"
      >
        <View style={styles.iconBox}>
          <Ionicons name={iconFor(alarm.kind)} size={22} color="#FFF" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.kindTxt}>{labelKind(alarm.kind)} · {absolute}</Text>
          <Text style={styles.labelTxt} numberOfLines={1}>{alarm.label}</Text>
        </View>
        <View style={styles.badgeBox}>
          <Text style={styles.badgeTxt}>{relative}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#B45309" style={{ marginLeft: 4 }} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 6, marginBottom: 6 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 14,
    backgroundColor: "#FFF9EC",
    borderWidth: 1.5,
    borderColor: "#FBBF24",
    shadowColor: "#F59E0B",
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  iconBox: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "#FBBF24",
  },
  kindTxt: { color: "#B45309", fontSize: 11, fontWeight: "800", letterSpacing: 0.3, textTransform: "uppercase" },
  labelTxt: { color: "#0F172A", fontSize: 14, fontWeight: "800", marginTop: 2 },
  badgeBox: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
    backgroundColor: "#F59E0B",
  },
  badgeTxt: { color: "#FFF", fontSize: 11, fontWeight: "900" },
});

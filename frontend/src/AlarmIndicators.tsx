// V50.z334 — Indicatori sveglia/timer FUORI dalla Home:
// • `useNextAlarm()`  → prossima sveglia/timer/promemoria attivo (entro 24h)
// • `AlarmHeaderIcon` → piccola icona ⏰/timer nella barra superiore della Home (solo se c'è qualcosa impostato)
// • `AlarmDrawerBadge`→ «tra 25m» accanto a «Timer & Sveglie» nel menu laterale
// Sostituisce il vecchio widget invasivo `AlarmHomeWidget` (V50.z10).

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, Animated, DeviceEventEmitter, AppState } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { api } from "@/src/api";
import type { Alarm } from "@/src/alarmNotifs";
import { HT } from "@/src/homeTheme";

const HORIZON_MS = 24 * 60 * 60 * 1000;

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

export function relativeShort(target: Date, now: Date = new Date()): string {
  const diff = Math.max(0, Math.floor((target.getTime() - now.getTime()) / 1000));
  if (diff < 60) return `tra ${diff}s`;
  const m = Math.floor(diff / 60);
  if (m < 60) return `tra ${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  if (h < 24) return remM > 0 ? `tra ${h}h ${remM}m` : `tra ${h}h`;
  return `tra ${Math.floor(h / 24)}g`;
}

/** Evento globale: la lista allarmi è cambiata (crea/modifica/elimina/toggle) → header e menu si aggiornano subito. */
export const ALARMS_CHANGED_EVENT = "axon:alarms-changed";
export function emitAlarmsChanged() { DeviceEventEmitter.emit(ALARMS_CHANGED_EVENT); }

export function useNextAlarm(): { alarm: Alarm; when: Date } | null {
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [tick, setTick] = useState(0);
  const load = useCallback(async () => {
    try {
      const r = await api<{ items: Alarm[] }>("/axon/alarms");
      setAlarms(r.items || []);
    } catch { /* silent */ }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => {
    const iv = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(iv);
  }, []);
  // V50.z501 — BUG: header/menu laterale mostravano «Timer tra 16h» anche dopo l'eliminazione (il componente vive nel layout:
  // il focus non scatta più). Ora: evento globale `axon:alarms-changed` (emesso da Timer & Sveglie a ogni crea/modifica/elimina/toggle)
  // + ricarica ogni 60 s + al rientro in foreground.
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(ALARMS_CHANGED_EVENT, load);
    const app = AppState.addEventListener("change", (st) => { if (st === "active") void load(); });
    const iv = setInterval(load, 60_000);
    return () => { sub.remove(); app.remove(); clearInterval(iv); };
  }, [load]);
  return useMemo(() => {
    const now = new Date();
    const horizon = now.getTime() + HORIZON_MS;
    let best: { alarm: Alarm; when: Date } | null = null;
    for (const a of alarms) {
      const when = nextOccurrenceForAlarm(a, now);
      if (!when || when.getTime() > horizon) continue;
      if (!best || when.getTime() < best.when.getTime()) best = { alarm: a, when };
    }
    return best;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alarms, tick]);
}

function iconFor(kind: string): keyof typeof Ionicons.glyphMap {
  if (kind === "timer") return "timer-outline";
  if (kind === "alarm") return "alarm-outline";
  return "notifications-outline";
}

/** Icona discreta nella barra superiore: visibile SOLO se c'è una sveglia/timer/promemoria attivo. Tap → /axon-alarms. */
export function AlarmHeaderIcon() {
  const router = useRouter();
  const next = useNextAlarm();
  const [pulse] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (!next) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.35, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [next, pulse]);
  if (!next) return null;
  return (
    <Pressable
      onPress={() => router.push("/axon-alarms" as any)}
      hitSlop={8}
      style={styles.iconBtn}
      testID="home-alarm-indicator"
      accessibilityLabel={`${next.alarm.kind === "timer" ? "Timer" : next.alarm.kind === "alarm" ? "Sveglia" : "Promemoria"} ${relativeShort(next.when)}`}
    >
      <Ionicons name={iconFor(next.alarm.kind)} size={18} color={HT.warning} />
      <Animated.View style={[styles.dot, { opacity: pulse }]} />
    </Pressable>
  );
}

/** Badge «tra 25m» accanto a «Timer & Sveglie» nel menu laterale. */
const KIND_LABEL: Record<string, string> = { timer: "Timer", alarm: "Sveglia", reminder: "Promemoria" };

export function AlarmDrawerBadge() {
  const next = useNextAlarm();
  if (!next) return null;
  return (
    <View style={styles.badge} testID="drawer-alarm-badge">
      <Ionicons name={iconFor(next.alarm.kind)} size={12} color={HT.warning} />
      <Text style={styles.badgeTxt}>{KIND_LABEL[next.alarm.kind] || ""} {relativeShort(next.when)}</Text>{/* V50.z503 — «Promemoria tra 15h»: chiaro che NON è un timer */}
    </View>
  );
}

const styles = StyleSheet.create({
  iconBtn: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: HT.glass, position: "relative" },
  dot: { position: "absolute", top: 6, right: 6, width: 7, height: 7, borderRadius: 4, backgroundColor: HT.warning },
  badge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: HT.warningTint, marginRight: 6 },
  badgeTxt: { fontSize: 11, fontWeight: "800", color: HT.warning },
});

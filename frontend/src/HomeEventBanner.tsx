import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Image, Platform } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";

type ActiveEvent = {
  event_id: string;
  title: string;
  event_at: string;
  cover_base64: string;
  cover_mime: string;
  visibility_kind?: string;
};

function pad(n: number): string { return String(n).padStart(2, "0"); }

function computeCountdown(target: number, now: number): { days: number; hours: number; minutes: number; seconds: number; passed: boolean } {
  let d = Math.max(0, target - now);
  const days = Math.floor(d / 86400000); d -= days * 86400000;
  const hours = Math.floor(d / 3600000); d -= hours * 3600000;
  const minutes = Math.floor(d / 60000); d -= minutes * 60000;
  const seconds = Math.floor(d / 1000);
  return { days, hours, minutes, seconds, passed: (target - now) <= 0 };
}

export function HomeEventBanner() {
  const router = useRouter();
  const [events, setEvents] = useState<ActiveEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: ActiveEvent[] }>("/event-banners/active");
      setEvents(r.items || []);
    } catch (e) {
      // silent
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Countdown tick every 1s
  useEffect(() => {
    if (events.length === 0) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [events.length]);

  if (loading || events.length === 0) return null;

  // Show only the nearest event
  const evt = events[0];
  const target = new Date(evt.event_at).getTime();
  const cd = computeCountdown(target, now);
  const cover = evt.cover_base64 ? `data:${evt.cover_mime || "image/jpeg"};base64,${evt.cover_base64}` : null;
  const dateFmt = new Date(evt.event_at).toLocaleString("it-IT", {
    day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

  return (
    <Pressable
      testID={`home-event-banner-${evt.event_id}`}
      onPress={() => router.push(`/event/${evt.event_id}` as any)}
      style={styles.wrap}
    >
      {cover ? (
        <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: "#1E3A5F" }]} />
      )}
      <LinearGradient
        colors={["rgba(0,0,0,0.15)", "rgba(0,0,0,0.85)"]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.inner}>
        <View style={styles.badge}>
          <Ionicons name="calendar" size={12} color="#F59E0B" />
          <Text style={styles.badgeTxt}>Evento in arrivo</Text>
        </View>
        <Text style={styles.title} numberOfLines={2}>{evt.title}</Text>
        <Text style={styles.when} numberOfLines={1}>{dateFmt}</Text>
        {cd.passed ? (
          <View style={[styles.badge, { alignSelf: "flex-start", backgroundColor: "rgba(220,38,38,0.9)", marginTop: 8 }]}>
            <Text style={[styles.badgeTxt, { color: "#FFF" }]}>Evento in corso</Text>
          </View>
        ) : (
          <View style={styles.cdRow}>
            <CdBox n={cd.days} label="giorni" />
            <CdBox n={cd.hours} label="ore" />
            <CdBox n={cd.minutes} label="min" />
            <CdBox n={cd.seconds} label="sec" />
          </View>
        )}
        <View style={styles.cta}>
          <Ionicons name="document-text" size={14} color="#F59E0B" />
          <Text style={styles.ctaTxt}>Apri il programma</Text>
          <Ionicons name="chevron-forward" size={14} color="#F59E0B" />
        </View>
      </View>
    </Pressable>
  );
}

function CdBox({ n, label }: { n: number; label: string }) {
  return (
    <View style={styles.cdBox}>
      <Text style={styles.cdN}>{pad(n)}</Text>
      <Text style={styles.cdL}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    minHeight: 220,
    borderRadius: 16,
    overflow: "hidden",
    marginBottom: 12,
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 10 },
      android: { elevation: 6 },
      default: {},
    }),
  },
  inner: { flex: 1, padding: 16, justifyContent: "flex-end" },
  badge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    alignSelf: "flex-start",
    backgroundColor: "rgba(245,158,11,0.18)",
    borderWidth: 1, borderColor: "rgba(245,158,11,0.6)",
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6,
    marginBottom: 8,
  },
  badgeTxt: { fontSize: 10, fontWeight: "800", color: "#F59E0B", textTransform: "uppercase", letterSpacing: 0.4 },
  title: { fontSize: 22, fontWeight: "900", color: "#FFF", lineHeight: 26, textShadowColor: "rgba(0,0,0,0.5)", textShadowRadius: 4 },
  when: { fontSize: 12, color: "rgba(255,255,255,0.85)", marginTop: 2 },
  cdRow: { flexDirection: "row", gap: 6, marginTop: 12 },
  cdBox: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.14)",
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: "center",
  },
  cdN: { fontSize: 20, fontWeight: "900", color: "#FFF", lineHeight: 22 },
  cdL: { fontSize: 9, color: "rgba(255,255,255,0.75)", textTransform: "uppercase", letterSpacing: 0.4, marginTop: 2 },
  cta: {
    marginTop: 12,
    flexDirection: "row", alignItems: "center", gap: 6,
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  ctaTxt: { fontSize: 12, fontWeight: "800", color: "#F59E0B", letterSpacing: 0.3 },
});

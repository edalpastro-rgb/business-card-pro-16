// src/BetaProgramCard.tsx — V50.z475 — Card «Programma Beta» in Home: settimana corrente (1-6), missione con 3 compiti,
// bottone «Diario del venerdì» (evidenziato da venerdì a domenica finché non compilato) e invito al sondaggio se pendente.
// Visibile solo se il Master ha avviato il programma (GET /beta/program → enrolled).
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { api } from "@/src/api";
import { HT } from "@/src/homeTheme";

type Program = { enrolled: boolean; week?: number; days_left?: number; mission?: { title: string; goal: string; tasks: string[] }; diary_due?: boolean; diary_done?: boolean; nps_pending?: boolean };
const TEAL = "#0F766E";

export function BetaProgramCard() {
  const router = useRouter();
  const [p, setP] = useState<Program | null>(null);
  const [open, setOpen] = useState(false);
  const load = useCallback(() => { api<Program>("/beta/program").then(setP).catch(() => setP({ enrolled: false })); }, []);
  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  if (!p?.enrolled || !p.mission) return null;
  return (
    <View style={s.card} testID="beta-program-card">
      <Pressable onPress={() => setOpen((v) => !v)} style={s.head} testID="beta-program-toggle">
        <View style={s.badge}><Text style={s.badgeTxt}>BETA · SETT. {p.week}/6</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={s.title} numberOfLines={1}>Missione: {p.mission.title}</Text>
          <Text style={s.sub} numberOfLines={1}>{p.mission.goal} · {p.days_left} giorni al bilancio</Text>
        </View>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={HT.muted} />
      </Pressable>
      {open ? (
        <View style={{ gap: 6, marginTop: 8 }}>
          {p.mission.tasks.map((t, i) => (
            <View key={i} style={s.task}><Ionicons name="ellipse-outline" size={14} color={TEAL} /><Text style={s.taskTxt}>{t}</Text></View>
          ))}
        </View>
      ) : null}
      <View style={s.actions}>
        <Pressable onPress={() => router.push({ pathname: "/beta-diary", params: { week: String(p.week) } } as any)} style={[s.btn, p.diary_due && s.btnHot, p.diary_done && s.btnDone]} testID="beta-diary-btn">
          <Ionicons name={p.diary_done ? "checkmark-circle" : "book-outline"} size={16} color={p.diary_due ? "#FFF" : TEAL} />
          <Text style={[s.btnTxt, p.diary_due && { color: "#FFF" }]}>{p.diary_done ? "Diario compilato" : p.diary_due ? "Diario del venerdì (2 min)" : "Diario della settimana"}</Text>
        </Pressable>
        {p.nps_pending ? (
          <Pressable onPress={() => router.push("/beta-nps" as any)} style={[s.btn, s.btnHot]} testID="beta-nps-btn"><Ionicons name="heart-half" size={16} color="#FFF" /><Text style={[s.btnTxt, { color: "#FFF" }]}>Sondaggio</Text></Pressable>
        ) : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { marginHorizontal: 16, marginBottom: 12, backgroundColor: HT.card, borderRadius: 14, borderWidth: 1, borderColor: TEAL, padding: 12 },
  head: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 },
  badge: { backgroundColor: TEAL, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  badgeTxt: { color: "#FFF", fontSize: 10, fontWeight: "900", letterSpacing: 0.5 },
  title: { fontSize: 14, fontWeight: "800", color: HT.text },
  sub: { fontSize: 11.5, color: HT.muted, fontWeight: "600" },
  task: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  taskTxt: { flex: 1, fontSize: 13, color: HT.text, lineHeight: 18 },
  actions: { flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap" },
  btn: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: TEAL, borderRadius: 10, paddingHorizontal: 12, minHeight: 40, backgroundColor: HT.card },
  btnHot: { backgroundColor: TEAL },
  btnDone: { borderColor: HT.border },
  btnTxt: { fontSize: 12.5, fontWeight: "800", color: TEAL },
});

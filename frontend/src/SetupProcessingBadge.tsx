// src/SetupProcessingBadge.tsx — V50.z216 — BLOCCO 5: indicatore discreto «AxonOS sta leggendo i tuoi file…» (file/audio del wizard
// elaborati in background). Polling ogni 4 s su GET /axon/setup/talk/status finché ci sono job attivi; sparisce da solo al termine
// (mostra per 6 s «Fatto: N dati da confermare» con link a Profilo → La mia configurazione Set Up). Montato in Home e Profilo.
import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

type St = { running: number; running_names: string[]; errors: { name: string; error: string }[]; pending_review: number };

export function SetupProcessingBadge({ compact = false, onDone }: { compact?: boolean; onDone?: () => void }) {
  const router = useRouter();
  const [st, setSt] = useState<St | null>(null);
  const [justDone, setJustDone] = useState(false);
  const wasRunning = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    let timer: any = null;
    const tick = async () => {
      try {
        const s = await api<St>("/axon/setup/talk/status");
        if (!alive.current) return;
        setSt(s);
        if (s.running > 0) { wasRunning.current = true; timer = setTimeout(tick, 4000); }
        else if (wasRunning.current) { wasRunning.current = false; setJustDone(true); onDone?.(); timer = setTimeout(() => alive.current && setJustDone(false), 6000); }
      } catch { /* silenzioso: è un indicatore */ }
    };
    void tick();
    return () => { alive.current = false; if (timer) clearTimeout(timer); };
  }, [onDone]);

  if (!st) return null;
  if (st.running > 0) {
    return (
      <View style={[styles.pill, compact && styles.pillCompact]} testID="setup-processing-badge">
        <ActivityIndicator size="small" color="#7C3AED" />
        <Text style={styles.txt} numberOfLines={1}>AxonOS sta leggendo i tuoi file…{!compact && st.running_names[0] ? ` (${st.running_names[0]})` : ""}</Text>
      </View>
    );
  }
  if (justDone) {
    return (
      <Pressable onPress={() => router.push("/setup-config" as any)} style={[styles.pill, styles.pillDone, compact && styles.pillCompact]} testID="setup-processing-done">
        <Ionicons name="checkmark-circle" size={16} color="#059669" />
        <Text style={[styles.txt, { color: HT.success }]} numberOfLines={1}>Fatto{st.pending_review ? ` · ${st.pending_review} dati da confermare` : ""}</Text>
        {!compact && <Ionicons name="chevron-forward" size={14} color="#059669" />}
      </Pressable>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  pill: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start", backgroundColor: HT.violetTint, borderRadius: 999, paddingHorizontal: 12, minHeight: 34, borderWidth: 1, borderColor: HT.violet + '66', maxWidth: "100%" },
  pillCompact: { minHeight: 30, paddingHorizontal: 10 },
  pillDone: { backgroundColor: HT.successTint, borderColor: '#A7F3D0' },
  txt: { fontSize: 12.5, fontWeight: "700", color: HT.violet, flexShrink: 1 },
});

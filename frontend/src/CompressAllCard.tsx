// CompressAllCard.tsx — V50.z364 — Impostazioni (solo Master): «Comprimi tutto» → job in background che ricomprime tutto il
// materiale già nel DB (PDF, immagini, audio, video). Mostra memoria prima → dopo · liberati. Ripetibile.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { HT } from "@/src/homeTheme";

type Job = { job_id: string; status: "running" | "done" | "error"; before_bytes: number; after_bytes: number | null; saved_bytes: number; items: number; scanned: number; current: string | null; finished_at: string | null; error?: string };
type Status = { running: boolean; db_bytes: number; ffmpeg: boolean; last: Job | null };

export const fmtBytes = (n: number | null | undefined): string => {
  const v = Math.max(0, n || 0);
  if (v >= 1024 ** 3) return `${(v / 1024 ** 3).toFixed(2)} GB`;
  if (v >= 1024 ** 2) return `${Math.round(v / 1024 ** 2)} MB`;
  return `${Math.round(v / 1024)} KB`;
};

export function CompressAllCard() {
  const [st, setSt] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try { setSt(await api<Status>("/admin/compress-all/status")); } catch { /* silenzioso */ }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const running = !!st?.running || st?.last?.status === "running";
    if (running && !timer.current) timer.current = setInterval(load, 3000);
    if (!running && timer.current) { clearInterval(timer.current); timer.current = null; }
    return () => { if (timer.current) { clearInterval(timer.current); timer.current = null; } };
  }, [st, load]);

  const start = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api("/admin/compress-all", { method: "POST" });
      notify("Compressione avviata in background");
      await load();
    } catch (e: any) {
      notify(e?.message || "Impossibile avviare la compressione");
    } finally { setBusy(false); }
  };

  const j = st?.last;
  const running = !!st?.running || j?.status === "running";
  const result = j && j.status === "done"
    ? `Prima: ${fmtBytes(j.before_bytes)} → Dopo: ${fmtBytes(j.after_bytes)} · Liberati ${fmtBytes(j.saved_bytes)} (${j.items} file)`
    : null;

  return (
    <View style={styles.card} testID="compress-all-card">
      <View style={styles.row}>
        <View style={styles.icon}><Ionicons name="archive" size={18} color={HT.success} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Comprimi tutto</Text>
          <Text style={styles.sub}>Ricomprime in background PDF, immagini, audio e video già salvati (CRT, clienti, Corporate Gym…). Memoria attuale: {fmtBytes(st?.db_bytes)}</Text>
        </View>
      </View>
      {running ? (
        <View style={styles.progress} testID="compress-all-progress">
          <ActivityIndicator color={HT.success} size="small" />
          <Text style={styles.progressTxt}>In corso… {j?.items ?? 0} file ricompressi · liberati {fmtBytes(j?.saved_bytes)}{j?.current ? ` · ${j.current}` : ""}</Text>
        </View>
      ) : (
        <Pressable onPress={start} disabled={busy} style={[styles.btn, busy && { opacity: 0.6 }]} testID="compress-all-btn">
          {busy ? <ActivityIndicator color="#FFF" size="small" /> : <Ionicons name="flash" size={16} color="#FFF" />}
          <Text style={styles.btnTxt}>{j?.status === "done" ? "Comprimi di nuovo" : "Comprimi tutto"}</Text>
        </Pressable>
      )}
      {result ? <Text style={styles.result} testID="compress-all-result">{result}</Text> : null}
      {j?.status === "error" ? <Text style={[styles.result, { color: HT.danger }]}>Errore: {j.error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: HT.card2, borderRadius: 14, borderWidth: 1, borderColor: HT.border, padding: 14, gap: 10, marginTop: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  icon: { width: 36, height: 36, borderRadius: 10, backgroundColor: HT.successTint, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 15, fontWeight: "800", color: HT.text },
  sub: { fontSize: 12, color: HT.muted, marginTop: 2, lineHeight: 17 },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: HT.success, borderRadius: 12, minHeight: 44, paddingHorizontal: 16 },
  btnTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
  progress: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 },
  progressTxt: { flex: 1, fontSize: 12, color: HT.text2, fontWeight: "700" },
  result: { fontSize: 13, fontWeight: "800", color: HT.success, textAlign: "center" },
});

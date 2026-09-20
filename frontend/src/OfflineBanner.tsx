// OfflineBanner.tsx — V50.z279 — Banner globale «Modalità offline» / «Sincronizzazione» + precaricamento sezioni.
// Montato in _layout quando l'utente è loggato. Tocca il banner → /offline-sync.
import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, AppState } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { getOfflineState, subscribeOffline, syncQueue, initOffline, OfflineState, PREFETCH_PATHS } from "@/src/offline";

export function useOffline(): OfflineState {
  const [s, setS] = useState(getOfflineState());
  useEffect(() => subscribeOffline(setS), []);
  return s;
}

/** V50.z281 — ⏳ accanto agli elementi creati/modificati offline finché non sono sincronizzati (`_pending`). */
export function PendingBadge({ pending, compact }: { pending?: boolean; compact?: boolean }) {
  if (!pending) return null;
  return (
    <View style={s.pend} testID="pending-badge">
      <Text style={s.pendTxt}>⏳{compact ? "" : " in attesa"}</Text>
    </View>
  );
}

let lastPrefetch = 0;
/** Scarica le sezioni principali (silenzioso) così offline l'app è navigabile anche nelle pagine mai aperte. */
export async function prefetchForOffline(force = false): Promise<number> {
  if (!force && Date.now() - lastPrefetch < 15 * 60 * 1000) return 0;
  lastPrefetch = Date.now();
  let n = 0;
  for (const p of PREFETCH_PATHS) {
    if (getOfflineState().offline) break;
    try { await api(p); n++; } catch { /* sezione non disponibile per questo ruolo */ }
  }
  return n;
}

export function OfflineBanner({ userId }: { userId?: string | null }) {
  const st = useOffline();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [hideOk, setHideOk] = useState(false);
  const lastRes = useRef<string | null>(null);

  useEffect(() => { void initOffline(); }, []);
  useEffect(() => {
    if (!userId) return;
    void prefetchForOffline();
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") { void syncQueue(); void prefetchForOffline(); } });
    return () => sub.remove();
  }, [userId]);
  useEffect(() => { if (st.lastResult && st.lastResult !== lastRes.current) { lastRes.current = st.lastResult; setHideOk(false); const t = setTimeout(() => setHideOk(true), 6000); return () => clearTimeout(t); } }, [st.lastResult]);

  if (!userId) return null;
  const pendingTotal = st.pending + st.failed;
  let bg = "#0F172A"; let icon: any = "airplane"; let text = "";
  if (st.offline) { text = `Modalità offline · navighi con gli ultimi dati${pendingTotal ? ` · ${pendingTotal} modifiche in attesa` : ""}`; }
  else if (st.syncing) { bg = theme.color.brandPrimary; icon = "sync"; text = "Sincronizzazione in corso…"; }
  else if (st.failed) { bg = "#B45309"; icon = "alert-circle"; text = `${st.failed} modifiche da controllare${st.pending ? ` · ${st.pending} in attesa` : ""}`; }
  else if (st.pending) { bg = theme.color.brandPrimary; icon = "cloud-upload"; text = `${st.pending} modifiche in attesa · tocca per sincronizzare`; }
  else if (st.lastResult && !hideOk) { bg = "#15803D"; icon = "checkmark-circle"; text = `Sincronizzato: ${st.lastResult}`; }
  else return null;
  return (
    <Pressable onPress={() => router.push("/offline-sync" as any)} style={[s.wrap, { backgroundColor: bg, paddingTop: Math.max(insets.top, 6) }]} testID="offline-banner">
      {st.syncing ? <ActivityIndicator size="small" color="#FFF" /> : <Ionicons name={icon} size={16} color="#FFF" />}
      <Text style={s.txt} numberOfLines={1}>{text}</Text>
      <Ionicons name="chevron-forward" size={14} color="#FFF" />
    </Pressable>
  );
}

const s = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingBottom: 8, minHeight: 36 },
  txt: { flex: 1, color: "#FFF", fontWeight: "800", fontSize: 12 },
  pend: { alignSelf: "flex-start", backgroundColor: "#FEF3C7", borderColor: "#FCD34D", borderWidth: 1, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1, marginLeft: 6 },
  pendTxt: { fontSize: 10, fontWeight: "800", color: "#92400E" },
});

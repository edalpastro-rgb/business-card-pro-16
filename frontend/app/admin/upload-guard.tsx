// app/admin/upload-guard.tsx — V50.z472 — Pannello Master › «Report antivirus»: file rifiutati dall'upload guard
// (formato non consentito, troppo grande, virus, antivirus non disponibile) con data, utente, file, endpoint e motivo;
// stato ClamAV e conteggi ultimi 30 giorni. Dati da GET /admin/upload-guard/rejections (Master → proprio tenant; Super Master → tutti).
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";

const C = theme.color;
const SLATE = "#475569";
type Reason = "format" | "size" | "virus" | "av_unavailable";
type Row = { at: string; reason_code: Reason; reason: string; detail?: string; file_name?: string; declared_mime?: string; sniffed_mime?: string | null; size: number; user_email?: string | null; user_name?: string | null; endpoint?: string | null; ip?: string | null };
type Payload = { items: Row[]; stats_30d: { total: number; by_reason: Record<string, number> }; antivirus: { enabled: boolean; required: boolean; status: string; detail: string; host: string }; limits_mb: Record<string, number>; allowed: string[]; labels: Record<Reason, string> };

const fmt = (iso?: string | null) => { if (!iso) return "—"; const d = new Date(iso); return isNaN(d.getTime()) ? "—" : d.toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }); };
const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const REASON_ICON: Record<Reason, { icon: keyof typeof Ionicons.glyphMap; color: string }> = { format: { icon: "document-lock-outline", color: "#D97706" }, size: { icon: "resize-outline", color: "#2563EB" }, virus: { icon: "bug-outline", color: "#DC2626" }, av_unavailable: { icon: "cloud-offline-outline", color: SLATE } };

export default function AdminUploadGuard() {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<"all" | Reason>("all");

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await api<Payload>(`/admin/upload-guard/rejections?limit=200${filter !== "all" ? `&reason=${filter}` : ""}`)); }
    catch (e: any) { notify("Report antivirus", e?.message || "Errore di caricamento"); }
    finally { setLoading(false); }
  }, [filter]);
  useEffect(() => { load(); }, [load]);

  const av = data?.antivirus;
  const avOk = av?.status === "OK";
  const avColor = !av ? C.muted : av.status === "disabled" ? C.muted : avOk ? C.success : C.error;
  const avLabel = !av ? "…" : av.status === "disabled" ? "Antivirus disattivato" : avOk ? "ClamAV attivo" : av.status === "FOUND" ? "ClamAV attivo" : "ClamAV non raggiungibile";

  return (
    <SafeAreaView style={s.container} edges={["top"]}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.iconBtn} testID="upload-guard-back"><Ionicons name="chevron-back" size={24} color={C.onSurface} /></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.hTitle}>Report antivirus</Text>
          <Text style={s.hSub}>{data ? `${data.stats_30d.total} file rifiutati negli ultimi 30 giorni` : "Caricamento…"}</Text>
        </View>
        <Pressable onPress={load} style={s.addBtn} disabled={loading} testID="upload-guard-refresh">
          {loading ? <ActivityIndicator color={C.onSurfaceInverse} /> : <><Ionicons name="refresh" size={16} color={C.onSurfaceInverse} /><Text style={s.addTxt}>Aggiorna</Text></>}
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={s.list} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />} testID="upload-guard-list">
        {data ? (
          <View style={s.card} testID="upload-guard-status">
            <View style={s.rowBetween}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                <Ionicons name={avOk ? "shield-checkmark" : "shield-outline"} size={22} color={avColor} />
                <View style={{ flex: 1 }}>
                  <Text style={s.cardTitle}>{avLabel}</Text>
                  <Text style={s.hint} numberOfLines={2}>{av?.host}{av?.required ? " · fail-closed (upload bloccati se l'AV non risponde)" : " · fail-open (file accettati con avviso se l'AV non risponde)"}{!avOk && av?.detail ? ` · ${av.detail}` : ""}</Text>
                </View>
              </View>
            </View>
            <Text style={s.hint}>Consentiti: {data.allowed.join(", ")} · Limiti: immagini {data.limits_mb.image} MB · PDF {data.limits_mb.pdf} MB · audio {data.limits_mb.audio} MB. Il controllo è sui byte reali del file, non sull&apos;estensione.</Text>
            <View style={s.statsRow}>
              {(Object.keys(data.labels) as Reason[]).map((k) => (
                <View key={k} style={s.stat}>
                  <Ionicons name={REASON_ICON[k].icon} size={16} color={REASON_ICON[k].color} />
                  <Text style={s.statN}>{data.stats_30d.by_reason[k] || 0}</Text>
                  <Text style={s.statL} numberOfLines={2}>{data.labels[k]}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}
        <View style={s.filters}>
          {(["all", "virus", "format", "size", "av_unavailable"] as const).map((f) => (
            <Pressable key={f} onPress={() => setFilter(f)} style={[s.chip, filter === f && s.chipOn]} testID={`upload-guard-filter-${f}`}>
              <Text style={[s.chipTxt, filter === f && s.chipTxtOn]}>{f === "all" ? "Tutti" : f === "virus" ? "Virus" : f === "format" ? "Formato" : f === "size" ? "Dimensione" : "AV offline"}</Text>
            </Pressable>
          ))}
        </View>
        {(data?.items || []).map((r, i) => {
          const ri = REASON_ICON[r.reason_code] || REASON_ICON.format;
          return (
            <View key={`${r.at}-${i}`} style={s.card} testID={`upload-guard-row-${i}`}>
              <View style={s.rowBetween}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
                  <View style={[s.badgeIcon, { backgroundColor: `${ri.color}22` }]}><Ionicons name={ri.icon} size={18} color={ri.color} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.cardTitle} numberOfLines={1}>{r.file_name || "(senza nome)"}</Text>
                    <Text style={s.hint} numberOfLines={1}>{fmt(r.at)} · {r.user_name || r.user_email || "utente sconosciuto"}{r.user_name && r.user_email ? ` (${r.user_email})` : ""}</Text>
                  </View>
                </View>
                <View style={[s.badge, { backgroundColor: ri.color }]}><Text style={s.badgeTxt}>{data?.labels[r.reason_code] || r.reason_code}</Text></View>
              </View>
              <Text style={s.reason}>{r.reason}</Text>
              <Text style={s.hint} numberOfLines={2}>
                {r.detail ? `${r.detail} · ` : ""}{kb(r.size)}{r.declared_mime ? ` · dichiarato ${r.declared_mime}` : ""}{r.sniffed_mime ? ` · reale ${r.sniffed_mime}` : ""}{r.endpoint ? ` · ${r.endpoint.replace(/^\/api/, "")}` : ""}
              </Text>
            </View>
          );
        })}
        {data && data.items.length === 0 ? (
          <View style={[s.card, { alignItems: "center", gap: 6 }]} testID="upload-guard-empty">
            <Ionicons name="shield-checkmark-outline" size={28} color={C.success} />
            <Text style={s.cardTitle}>Nessun file rifiutato</Text>
            <Text style={[s.hint, { textAlign: "center" }]}>Tutti i caricamenti hanno superato i controlli di formato, dimensione e antivirus.</Text>
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
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: SLATE, paddingHorizontal: 14, minHeight: 44, borderRadius: 12 },
  addTxt: { color: C.onSurfaceInverse, fontWeight: "800" },
  list: { padding: 16, gap: 12, paddingBottom: 140 },
  card: { backgroundColor: C.surfaceSecondary, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.divider, gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: "800", color: C.onSurface },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  hint: { fontSize: 12.5, color: C.muted, lineHeight: 18 },
  reason: { fontSize: 13, fontWeight: "700", color: C.onSurface },
  statsRow: { flexDirection: "row", gap: 8 },
  stat: { flex: 1, alignItems: "center", gap: 2, backgroundColor: C.surface, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 4 },
  statN: { fontSize: 18, fontWeight: "900", color: C.onSurface },
  statL: { fontSize: 10.5, color: C.muted, textAlign: "center", lineHeight: 13 },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 14, minHeight: 38, justifyContent: "center", borderRadius: 999, borderWidth: 1, borderColor: SLATE, backgroundColor: C.surfaceSecondary },
  chipOn: { backgroundColor: SLATE },
  chipTxt: { color: SLATE, fontWeight: "700", fontSize: 12.5 },
  chipTxtOn: { color: C.onSurfaceInverse },
  badge: { paddingHorizontal: 10, minHeight: 28, borderRadius: 999, justifyContent: "center", maxWidth: 130 },
  badgeTxt: { color: "#FFFFFF", fontWeight: "800", fontSize: 11 },
  badgeIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
});

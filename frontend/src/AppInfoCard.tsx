// AppInfoCard.tsx — V50.z208 — Profilo (in cima, sempre visibile): «Piano attivo · vX.Y.Z» → tap per espandere:
// data installazione, ultimo aggiornamento, stato «Aggiornata ✓» / «Disponibile vX». Versione installata letta dal dispositivo
// (expo-application); versione disponibile = quella del codice pubblicato (backend GET /axon/app-info). Su web/Expo Go mostra la versione JS.
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Platform, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Application from "expo-application";
import Constants from "expo-constants";
import { api } from "@/src/api";
import { deviceKey } from "@/src/systemHeartbeat";

const PURPLE = "#7C3AED";
type Info = {
  plan_name: string; plan_scope: "master" | "team"; latest_version: string | null; latest_version_date: string | null; backend_version: string | null;
  device: { installed_version: string | null; build_number: string | null; first_seen: string | null; updated_at: string | null; previous_version: string | null; app_env: string | null } | null;
  whats_new?: Array<{ version: string; date: string; desc: string }>;
};

function cmpVersion(a: string, b: string): number {
  const pa = a.split(".").map((x) => parseInt(x, 10) || 0), pb = b.split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
}
function fmt(iso?: string | null): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" }) + " " + new Date(iso).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }); } catch { return iso; }
}

export function AppInfoCard() {
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<Info | null>(null);
  const [installedAt, setInstalledAt] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [err, setErr] = useState(false);

  const isNative = Platform.OS !== "web" && (Constants as any).appOwnership !== "expo" && (Constants as any).executionEnvironment !== "storeClient";
  const installedVersion = (isNative ? Application.nativeApplicationVersion : null) || Constants.expoConfig?.version || "—";
  const buildNumber = isNative ? Application.nativeBuildVersion : null;

  const load = useCallback(async () => {
    try {
      const k = await deviceKey();
      setInfo(await api<Info>("/axon/app-info", { query: { device_key: k } }));
      if (isNative) {
        try { const t = await Application.getInstallationTimeAsync(); setInstalledAt(t.toISOString()); } catch { /* n/a */ }
        try { const u = await (Application as any).getLastUpdateTimeAsync?.(); if (u) setUpdatedAt(new Date(u).toISOString()); } catch { /* iOS non lo espone */ }
      }
    } catch { setErr(true); }
  }, [isNative]);
  useEffect(() => { void load(); }, [load]);

  const latest = info?.latest_version || null;
  const status: "ok" | "update" | "unknown" = !latest || installedVersion === "—" ? "unknown" : cmpVersion(installedVersion, latest) >= 0 ? "ok" : "update";
  const firstSeen = installedAt || info?.device?.first_seen || null;
  const lastUpdate = updatedAt || info?.device?.updated_at || (isNative ? installedAt : info?.latest_version_date) || null;

  return (
    <Pressable onPress={() => setOpen((o) => !o)} style={styles.card} testID="app-info-card" accessibilityRole="button">
      <View style={styles.row}>
        <View style={styles.icon}><Ionicons name="shield-checkmark" size={18} color={PURPLE} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.plan} testID="app-info-plan">{info ? info.plan_name : err ? "Piano attivo" : "Piano…"}</Text>
          <Text style={styles.ver} testID="app-info-version">
            {isNative ? "APK installata" : Platform.OS === "web" ? "Versione app (web)" : "Versione app (Expo Go)"} · v{installedVersion}{buildNumber ? ` (build ${buildNumber})` : ""}
          </Text>
        </View>
        {!info && !err ? <ActivityIndicator size="small" color={PURPLE} /> : (
          <View style={[styles.badge, status === "ok" ? styles.badgeOk : status === "update" ? styles.badgeUpd : styles.badgeNeutral]} testID="app-info-status">
            <Text style={[styles.badgeTxt, status === "ok" ? { color: "#065F46" } : status === "update" ? { color: "#9A3412" } : { color: "#475569" }]}>
              {status === "ok" ? "Aggiornata ✓" : status === "update" ? `Nuova v${latest}` : "—"}
            </Text>
          </View>
        )}
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color="#94A3B8" />
      </View>

      {open && (
        <View style={styles.details} testID="app-info-details">
          <Row label="Data installazione" value={fmt(firstSeen)} />
          <Row label="Ultimo aggiornamento" value={fmt(lastUpdate)} />
          <Row label="Versione disponibile" value={latest ? `v${latest}${info?.latest_version_date ? ` · ${fmt(info.latest_version_date).slice(0, 10)}` : ""}` : "—"} />
          {info?.device?.previous_version ? <Row label="Versione precedente" value={`v${info.device.previous_version}`} /> : null}
          {info?.backend_version ? <Row label="Backend / novità" value={info.backend_version} /> : null}
          {info?.whats_new && info.whats_new.length > 0 && (
            <View style={styles.newsBox} testID="app-info-news">
              <Text style={styles.newsTitle}>{status === "update" ? `Novità che ti aspettano nella v${latest}` : "Ultime novità di questa versione"}</Text>
              {info.whats_new.map((n) => (
                <View key={n.version} style={styles.newsRow}>
                  <Text style={styles.newsVer}>{n.version}</Text>
                  <Text style={styles.newsTxt} numberOfLines={3}>{n.desc}</Text>
                </View>
              ))}
            </View>
          )}
          <Text style={[styles.hint, status === "update" && { color: "#9A3412", fontWeight: "700" }]}>
            {status === "ok" ? "Hai l'ultima versione disponibile." : status === "update" ? `È disponibile la versione v${latest}: scarica la nuova build dell'app per aggiornare.` : isNative ? "Stato aggiornamento non determinabile." : "In anteprima web/Expo Go la versione APK non è disponibile: qui vedi la versione del codice."}
          </Text>
          {info?.plan_scope === "team" ? <Text style={styles.hint}>Piano gestito dal Master del tuo team.</Text> : null}
        </View>
      )}
    </Pressable>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}><Text style={styles.detailLbl}>{label}</Text><Text style={styles.detailVal}>{value}</Text></View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#FFF", borderRadius: 14, borderWidth: 1, borderColor: "#EDE9FE", padding: 12, gap: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 },
  icon: { width: 36, height: 36, borderRadius: 12, backgroundColor: "#F5F3FF", alignItems: "center", justifyContent: "center" },
  plan: { fontSize: 15, fontWeight: "800", color: "#1B2B4B" },
  ver: { fontSize: 12, color: "#64748B", marginTop: 2 },
  badge: { borderRadius: 999, paddingHorizontal: 10, minHeight: 28, justifyContent: "center", borderWidth: 1 },
  badgeOk: { backgroundColor: "#ECFDF5", borderColor: "#A7F3D0" },
  badgeUpd: { backgroundColor: "#FFF7ED", borderColor: "#FDBA74" },
  badgeNeutral: { backgroundColor: "#F8FAFC", borderColor: "#E2E8F0" },
  badgeTxt: { fontSize: 11, fontWeight: "800" },
  details: { borderTopWidth: 1, borderTopColor: "#F1F5F9", paddingTop: 10, gap: 8 },
  detailRow: { flexDirection: "row", justifyContent: "space-between", gap: 10 },
  detailLbl: { fontSize: 12.5, color: "#64748B" },
  detailVal: { fontSize: 12.5, color: "#1B2B4B", fontWeight: "700", textAlign: "right", flexShrink: 1 },
  hint: { fontSize: 11.5, color: "#64748B", lineHeight: 16 },
  newsBox: { backgroundColor: "#F8FAFC", borderRadius: 10, padding: 10, gap: 6 },
  newsTitle: { fontSize: 12, fontWeight: "800", color: "#1B2B4B" },
  newsRow: { flexDirection: "row", gap: 8 },
  newsVer: { fontSize: 11, fontWeight: "800", color: PURPLE, width: 62 },
  newsTxt: { flex: 1, fontSize: 11.5, color: "#475569", lineHeight: 15 },
});

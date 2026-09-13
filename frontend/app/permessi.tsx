// permessi.tsx — V50.z211 — BLOCCO 1: schermata permessi (posizione, microfono, fotocamera, contatti) tra il Tour e il popup «Set Up and Go».
// Ogni card spiega il beneficio e chiede il permesso SOLO al tap su «Consenti» (contratto permessi: check → request → canAskAgain → Impostazioni).
// Tutto saltabile: negare non blocca nulla. Alla fine → /setup?welcome=1.
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Platform, Linking } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useInsetsSafe } from "@/src/hooks/useSafeBottom";
import { api } from "@/src/api";

const PURPLE = "#7C3AED";
type PermKey = "location" | "microphone" | "camera" | "contacts";
type PermStatus = "unknown" | "granted" | "denied" | "blocked" | "unavailable";
type Card = { key: PermKey; icon: keyof typeof Ionicons.glyphMap; title: string; benefit: string };

const CARDS: Card[] = [
  { key: "location", icon: "location", title: "Posizione", benefit: "Meteo e allerte sulla tua zona, percorsi verso i clienti e appuntamenti vicini." },
  { key: "microphone", icon: "mic", title: "Microfono", benefit: "Parla con AxonOS, detta note vocali e registra i role-play della Corporate Gym." },
  { key: "camera", icon: "camera", title: "Fotocamera", benefit: "Scansiona bollette, documenti e biglietti da visita direttamente dall'app." },
  { key: "contacts", icon: "people", title: "Contatti", benefit: "Importa i clienti dalla rubrica e riconosci chi ti chiama." },
];

async function checkPerm(key: PermKey): Promise<PermStatus> {
  if (Platform.OS === "web") return "unavailable";
  try {
    if (key === "location") { const L = await import("expo-location"); const r = await L.getForegroundPermissionsAsync(); return r.granted ? "granted" : r.canAskAgain ? "unknown" : "blocked"; }
    if (key === "camera") { const C = await import("expo-camera"); const r = await C.Camera.getCameraPermissionsAsync(); return r.granted ? "granted" : r.canAskAgain ? "unknown" : "blocked"; }
    if (key === "microphone") { const A = await import("expo-audio"); const r = await A.getRecordingPermissionsAsync(); return r.granted ? "granted" : r.canAskAgain ? "unknown" : "blocked"; }
    const Ct = await import("expo-contacts"); const r = await Ct.getPermissionsAsync(); return r.granted ? "granted" : r.canAskAgain ? "unknown" : "blocked";
  } catch { return "unavailable"; }
}

async function requestPerm(key: PermKey): Promise<PermStatus> {
  if (Platform.OS === "web") return "unavailable";
  try {
    let r: { granted: boolean; canAskAgain?: boolean };
    if (key === "location") { const L = await import("expo-location"); r = await L.requestForegroundPermissionsAsync(); }
    else if (key === "camera") { const C = await import("expo-camera"); r = await C.Camera.requestCameraPermissionsAsync(); }
    else if (key === "microphone") { const A = await import("expo-audio"); r = await A.requestRecordingPermissionsAsync(); }
    else { const Ct = await import("expo-contacts"); r = await Ct.requestPermissionsAsync(); }
    return r.granted ? "granted" : r.canAskAgain === false ? "blocked" : "denied";
  } catch { return "unavailable"; }
}

export default function PermessiScreen() {
  const router = useRouter();
  const insets = useInsetsSafe();
  const [status, setStatus] = useState<Record<PermKey, PermStatus>>({ location: "unknown", microphone: "unknown", camera: "unknown", contacts: "unknown" });

  useEffect(() => { (async () => { const s = { ...status }; for (const c of CARDS) s[c.key] = await checkPerm(c.key); setStatus(s); })(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const ask = useCallback(async (key: PermKey) => {
    const cur = status[key];
    if (cur === "blocked") { Linking.openSettings().catch(() => {}); return; }
    const r = await requestPerm(key);
    setStatus((s) => ({ ...s, [key]: r }));
  }, [status]);

  const finish = useCallback(async (skippedAll: boolean) => {
    const perms: Record<string, string> = {};
    for (const c of CARDS) perms[c.key] = skippedAll && status[c.key] === "unknown" ? "skipped" : status[c.key];
    api("/axon/setup/state", { method: "PUT", body: { permissions: perms, permissions_done: true } }).catch(() => {});
    router.replace("/setup?welcome=1" as any);
  }, [router, status]);

  const granted = CARDS.filter((c) => status[c.key] === "granted").length;

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 140, gap: 14 }}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}><Ionicons name="shield-checkmark" size={30} color={PURPLE} /></View>
          <Text style={styles.title}>Permessi utili</Text>
          <Text style={styles.sub}>Servono solo per le funzioni indicate. Puoi concederli ora o quando ti serviranno: nulla si blocca.</Text>
        </View>

        {CARDS.map((c) => {
          const st = status[c.key];
          return (
            <View key={c.key} style={styles.card} testID={`perm-card-${c.key}`}>
              <View style={styles.cardIcon}><Ionicons name={c.icon} size={20} color={PURPLE} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{c.title}</Text>
                <Text style={styles.cardBenefit}>{c.benefit}</Text>
              </View>
              {st === "granted" ? (
                <View style={styles.okBadge} testID={`perm-ok-${c.key}`}><Ionicons name="checkmark" size={14} color="#065F46" /><Text style={styles.okTxt}>Attivo</Text></View>
              ) : st === "unavailable" ? (
                <Text style={styles.naTxt}>Solo su app</Text>
              ) : (
                <Pressable onPress={() => ask(c.key)} style={[styles.allowBtn, st === "blocked" && styles.allowBtnAlt]} testID={`perm-allow-${c.key}`}>
                  <Text style={[styles.allowTxt, st === "blocked" && { color: PURPLE }]}>{st === "blocked" ? "Impostazioni" : st === "denied" ? "Riprova" : "Consenti"}</Text>
                </Pressable>
              )}
            </View>
          );
        })}
        <Text style={styles.foot}>{granted}/{CARDS.length} attivi · potrai cambiarli in ogni momento dalle impostazioni del telefono.</Text>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Pressable onPress={() => finish(false)} style={styles.primary} testID="perm-continue"><Text style={styles.primaryTxt}>Continua</Text><Ionicons name="arrow-forward" size={18} color="#FFF" /></Pressable>
        <Pressable onPress={() => finish(true)} style={styles.skip} testID="perm-skip"><Text style={styles.skipTxt}>Salta per ora</Text></Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#FAF5FF" },
  hero: { alignItems: "center", gap: 8, marginBottom: 6 },
  heroIcon: { width: 64, height: 64, borderRadius: 22, backgroundColor: "#EDE9FE", alignItems: "center", justifyContent: "center" },
  title: { fontSize: 24, fontWeight: "900", color: "#1B2B4B" },
  sub: { fontSize: 13.5, color: "#64748B", textAlign: "center", lineHeight: 19, paddingHorizontal: 8 },
  card: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#FFF", borderRadius: 16, padding: 14, borderWidth: 1, borderColor: "#EDE9FE", minHeight: 76 },
  cardIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: "#F5F3FF", alignItems: "center", justifyContent: "center" },
  cardTitle: { fontSize: 15, fontWeight: "800", color: "#1B2B4B" },
  cardBenefit: { fontSize: 12, color: "#64748B", marginTop: 2, lineHeight: 16 },
  allowBtn: { backgroundColor: PURPLE, borderRadius: 999, paddingHorizontal: 14, minHeight: 40, justifyContent: "center" },
  allowBtnAlt: { backgroundColor: "#F5F3FF", borderWidth: 1, borderColor: "#DDD6FE" },
  allowTxt: { color: "#FFF", fontWeight: "800", fontSize: 12.5 },
  okBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#ECFDF5", borderRadius: 999, paddingHorizontal: 10, minHeight: 32 },
  okTxt: { color: "#065F46", fontWeight: "800", fontSize: 12 },
  naTxt: { fontSize: 11.5, color: "#94A3B8", fontWeight: "700" },
  foot: { fontSize: 11.5, color: "#94A3B8", textAlign: "center", marginTop: 4 },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, padding: 16, gap: 8, backgroundColor: "#FAF5FF" },
  primary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: PURPLE, borderRadius: 16, minHeight: 52 },
  primaryTxt: { color: "#FFF", fontWeight: "900", fontSize: 16 },
  skip: { alignItems: "center", justifyContent: "center", minHeight: 44 },
  skipTxt: { color: "#64748B", fontWeight: "700", fontSize: 14 },
});

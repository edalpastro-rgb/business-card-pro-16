// spazio-personale.tsx — V50.z205 — BLOCCO 8 · Fase 4: «Spazio Personale» = hub della Sfera 🟢 Home (schermata ISOLATA)
// Unifica My Thing, My Web, I miei audio (con trascrizione), archivio media Home, spese personali e memoria Home.
// Ogni card mostra un conteggio reale (GET /axon/personal-space/summary) e apre la pagina esistente.
// V50.z237 — Accesso protetto da PIN 6 cifre (+ impronta/Face ID): il cancello `PersonalLockGate` copre i contenuti
// ad ogni apertura della schermata e quando l'app torna dal background. «Cambia PIN» dall'icona lucchetto nell'header.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl, AppState, Modal } from "react-native";
import { PersonalLockGate, ChangePinPanel } from "@/src/PersonalLockGate";
import { LockKeyIcon } from "@/src/LockKeyIcon";
import { notify } from "@/src/utils/notify";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useInsetsSafe } from "@/src/hooks/useSafeBottom";
import { api } from "@/src/api";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

const GREEN = "#059669";
type Summary = {
  my_thing: { message: number; image: number; event: number; anniversary: number; total: number };
  web_links: number;
  audios: { total: number; business: number; home: number; unclassified: number; transcribed: number; processing: number };
  media_home: number; expenses_home: number;
  memory: { total: number; home: number; business: number };
  google_home: { connected: boolean; account?: string | null };
  homeassistant: boolean;
};

type Card = { key: string; icon: string; label: string; desc: string; count: string; hint?: string; route: string; testID: string };

export default function SpazioPersonaleScreen() {
  const router = useRouter();
  const insets = useInsetsSafe();
  const [s, setS] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  // V50.z237 — cancello PIN: bloccato ad ogni apertura (mount) e al rientro dal background
  const [unlocked, setUnlocked] = useState(false);
  const [changePinOpen, setChangePinOpen] = useState(false);
  const appState = useRef(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (appState.current === "active" && (next === "background" || next === "inactive")) setUnlocked(false);
      appState.current = next;
    });
    return () => sub.remove();
  }, []);

  const load = useCallback(async () => {
    try { setS(await api<Summary>("/axon/personal-space/summary")); setErr(null); }
    catch (e: any) { setErr(e?.message || String(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { if (unlocked) void load(); }, [load, unlocked]);
  useFocusEffect(useCallback(() => { if (unlocked) void load(); }, [load, unlocked]));

  if (!unlocked) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={10} testID="ps-back"><Ionicons name="arrow-back" size={22} color="#FFF" /></Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Spazio Personale</Text>
            <Text style={styles.sub}>🔒 Area protetta — solo tu puoi entrare</Text>
          </View>
        </View>
        <PersonalLockGate onUnlocked={() => setUnlocked(true)} />
      </View>
    );
  }

  const cards: Card[] = s ? [
    // V50.z469 — Feature 13/14: anagrafica personale cifrata SOLO sul dispositivo (Super Master)
    { key: "anagrafica", icon: "lock-closed", label: "Anagrafica personale", desc: "Famiglia, case, contatti d'emergenza, documenti. Cifrati sul dispositivo, mai sul server.", count: "🔐", hint: "solo su questo dispositivo · condivisione con Axon a scelta", route: "/spazio-personale-anagrafica", testID: "ps-card-anagrafica" },
    { key: "my-thing", icon: "sparkles", label: "My Thing", desc: "Messaggi, immagini, eventi e anniversari che compaiono sul tuo banner personale.",
      count: `${s.my_thing.total}`, hint: `${s.my_thing.message} messaggi · ${s.my_thing.image} immagini · ${s.my_thing.event + s.my_thing.anniversary} ricorrenze`, route: "/my-thing", testID: "ps-card-my-thing" },
    { key: "my-web", icon: "globe", label: "My Web", desc: "I tuoi siti preferiti, ad accesso rapido dentro l'app.", count: `${s.web_links}`, hint: "link salvati", route: "/my-web", testID: "ps-card-my-web" },
    { key: "my-audios", icon: "mic", label: "I miei audio", desc: "Note vocali personali: Axon le trascrive e le classifica Privata / Aziendale.", count: `${s.audios.total}`,
      hint: `${s.audios.transcribed} trascritte${s.audios.processing ? ` · ${s.audios.processing} in corso` : ""}${s.audios.unclassified ? ` · ${s.audios.unclassified} da classificare` : ""}`, route: "/my-audios", testID: "ps-card-my-audios" },
    { key: "media", icon: "images", label: "Foto, audio e video Home", desc: "Ricordi e note private: trascritti, descritti e ricercabili, separati dal Business.", count: `${s.media_home}`, hint: "elementi nella sfera Home", route: "/axon-media?sphere=home", testID: "ps-card-media" },
    { key: "expenses", icon: "wallet", label: "Spese personali", desc: "Scontrini con categorie personali: spesa, casa, svago, salute.", count: `${s.expenses_home}`, hint: "scontrini personali", route: "/axon-expenses?sphere=home", testID: "ps-card-expenses" },
    { key: "memory", icon: "eye", label: "Memoria Axon · Home", desc: "Cosa Axon sa di te nella vita privata: ogni voce ha il suo tag sfera, tu puoi cambiarlo.", count: `${s.memory.home}`, hint: `su ${s.memory.total} voci totali`, route: "/axon-memory?sphere=home", testID: "ps-card-memory" },
  ] : [];

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} testID="ps-back"><Ionicons name="arrow-back" size={22} color="#FFF" /></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Spazio Personale</Text>
          <Text style={styles.sub}>🟢 Sfera Home — dati personali, mai mescolati col CRM</Text>
        </View>
        <Pressable onPress={() => setChangePinOpen(true)} hitSlop={8} style={styles.headBtn} testID="ps-change-pin" accessibilityLabel="Sicurezza: cambia PIN">
          <LockKeyIcon size={18} color="#FFF" />
        </Pressable>
        <Pressable onPress={() => router.push("/axon-integrations" as any)} hitSlop={8} style={styles.headBtn} testID="ps-integrations">
          <Ionicons name="link" size={18} color="#FFF" />
        </Pressable>
      </View>

      <Modal visible={changePinOpen} transparent animationType="fade" onRequestClose={() => setChangePinOpen(false)}>
        <Pressable style={styles.modalBg} onPress={() => setChangePinOpen(false)}>
          <Pressable style={{ width: "100%", maxWidth: 420 }} onPress={() => {}}>
            <ChangePinPanel onCancel={() => setChangePinOpen(false)} onDone={() => { setChangePinOpen(false); notify("PIN aggiornato ✅", "Il nuovo PIN è attivo su tutti i tuoi dispositivi"); }} />
          </Pressable>
        </Pressable>
      </Modal>

      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: insets.bottom + 120, gap: 12 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
        <View style={styles.trust}>
          <Ionicons name="shield-checkmark" size={20} color={HT.success} />
          <Text style={styles.trustTxt}>
            Qui trovi tutto ciò che è tuo e non dell'azienda: My Thing, My Web, le tue note vocali, i ricordi e le spese personali.
            Axon opera in questa sfera solo su tua richiesta e non incrocia mai questi dati con quelli Business.
          </Text>
        </View>

        {loading && !s ? <ActivityIndicator color={GREEN} style={{ marginTop: 30 }} /> : !s && err ? (
          <Pressable onPress={() => { setLoading(true); void load(); }} style={styles.card} testID="ps-retry">
            <View style={styles.icon}><Ionicons name="cloud-offline-outline" size={20} color="#DC2626" /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Impossibile caricare</Text>
              <Text style={styles.desc}>{err}</Text>
              <Text style={styles.hint}>Tocca per riprovare</Text>
            </View>
          </Pressable>
        ) : cards.map((c) => (
          <Pressable key={c.key} onPress={() => router.push(c.route as any)} style={styles.card} testID={c.testID}>
            <View style={styles.icon}><Ionicons name={c.icon as any} size={20} color={GREEN} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>{c.label}</Text>
              <Text style={styles.desc}>{c.desc}</Text>
              {c.hint ? <Text style={styles.hint}>{c.hint}</Text> : null}
            </View>
            <View style={styles.countBox}>
              <Text style={styles.count}>{c.count}</Text>
              <Ionicons name="chevron-forward" size={16} color={HT.muted} />
            </View>
          </Pressable>
        ))}

        {s && (
          <View style={styles.linksRow}>
            <View style={[styles.pill, s.google_home.connected && styles.pillOn]}>
              <Ionicons name="logo-google" size={13} color={s.google_home.connected ? GREEN : HT.muted} />
              <Text style={[styles.pillTxt, s.google_home.connected && { color: GREEN }]}>{s.google_home.connected ? `Google Home · ${s.google_home.account || "collegato"}` : "Google Home non collegato"}</Text>
            </View>
            <View style={[styles.pill, s.homeassistant && styles.pillOn]}>
              <Ionicons name="home" size={13} color={s.homeassistant ? GREEN : HT.muted} />
              <Text style={[styles.pillTxt, s.homeassistant && { color: GREEN }]}>{s.homeassistant ? "Domotica attiva" : "Domotica non collegata"}</Text>
            </View>
          </View>
        )}
        <Text style={styles.foot}>Le integrazioni della sfera Home (Google Calendar/Contatti Home, Drive Home, Domotica) si gestiscono da «Integrazioni AxonOS».</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: HT.successTint },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: GREEN },
  title: { color: "#FFF", fontWeight: "800", fontSize: 17 },
  sub: { color: "#D1FAE5", fontSize: 11.5, marginTop: 1 },
  headBtn: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.18)" },
  trust: { flexDirection: "row", gap: 10, backgroundColor: HT.successTint, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: '#A7F3D0' },
  trustTxt: { flex: 1, fontSize: 12.5, color: HT.success, lineHeight: 18 },
  card: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: HT.card, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: HT.successTint, minHeight: 76 },
  icon: { width: 42, height: 42, borderRadius: 14, backgroundColor: HT.successTint, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 15, fontWeight: "800", color: HT.text },
  desc: { fontSize: 12, color: HT.muted, marginTop: 2, lineHeight: 16 },
  hint: { fontSize: 11, color: GREEN, marginTop: 4, fontWeight: "700" },
  countBox: { alignItems: "center", gap: 2, minWidth: 44 },
  count: { fontSize: 20, fontWeight: "900", color: GREEN },
  linksRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: HT.card, borderRadius: 999, paddingHorizontal: 12, minHeight: 36, borderWidth: 1, borderColor: HT.border },
  pillOn: { borderColor: '#A7F3D0', backgroundColor: HT.successTint },
  pillTxt: { fontSize: 12, fontWeight: "700", color: HT.muted },
  foot: { fontSize: 11.5, color: HT.muted, textAlign: "center", lineHeight: 16, paddingHorizontal: 8 },
  modalBg: { flex: 1, backgroundColor: "rgba(15,23,42,0.55)", alignItems: "center", justifyContent: "center", padding: 20 },
});

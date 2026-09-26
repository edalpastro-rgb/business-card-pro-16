// V50.z336 — Email di sistema (Master): stato configurazione Resend advisoros.it, mittenti, test invio, ultimi eventi.
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, RefreshControl } from "react-native";
import { KScrollView } from "@/src/ui/keyboard"; // V50.z374 — tastiera: campo attivo sempre visibile
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { notify } from "@/src/utils/notify";
import { HT } from "@/src/homeTheme";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";

type Sender = { kind: "info" | "help" | "master"; env: string; address: string; display_name: string; purpose: string; configured: boolean; using_default: boolean };
type Config = { domain: string; provider: "resend" | "emergent" | "smtp_only"; resend_key_configured: boolean; resend_key_masked: string; emergent_fallback: boolean; master_notify_email: string; senders: Sender[]; dns_hint: string };
type Ev = { event_id: string; kind: string; sender: string; to: string; subject: string; tag: string; created_at: string; status: string; provider: string | null; error: string | null };

const PROVIDER_LABEL: Record<Config["provider"], { label: string; color: string; hint: string }> = {
  resend: { label: "Resend · dominio advisoros.it", color: HT.success, hint: "Le email partono dalle caselle @advisoros.it con la tua chiave Resend." },
  emergent: { label: "Fallback Emergent (temporaneo)", color: HT.warning, hint: "RESEND_API_KEY non ancora impostata: le email partono dal servizio gestito Emergent. Inserisci la chiave nei Secrets per usare le caselle @advisoros.it." },
  smtp_only: { label: "Solo SMTP tenant", color: HT.danger, hint: "Nessun provider email configurato: vengono usati solo gli SMTP configurati dai singoli Master." },
};

export default function EmailConfigScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const pagePad = usePageBottomPadding();
  const [cfg, setCfg] = useState<Config | null>(null);
  const [events, setEvents] = useState<Ev[]>([]);
  const [loading, setLoading] = useState(true);
  const [testTo, setTestTo] = useState(user?.email || "");
  const [testKind, setTestKind] = useState<Sender["kind"]>("info");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, e] = await Promise.all([api<Config>("/email/config"), api<{ items: Ev[] }>("/email/events?limit=30")]);
      setCfg(c);
      setEvents(e.items || []);
    } catch (err: any) {
      notify("Accesso riservato al Master", String(err?.message || ""));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const sendTest = async () => {
    if (!testTo.trim()) return;
    setSending(true);
    try {
      const r = await api<{ ok: boolean; provider: string }>("/email/test", { method: "POST", body: { kind: testKind, to: testTo.trim() } });
      notify("Email di prova inviata", `Provider: ${r.provider}. Controlla la casella ${testTo.trim()}.`);
      load();
    } catch (err: any) {
      notify("Invio non riuscito", String(err?.message || ""));
    } finally {
      setSending(false);
    }
  };

  const prov = cfg ? PROVIDER_LABEL[cfg.provider] : null;

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.iconBtn} testID="email-config-back"><Ionicons name="chevron-back" size={22} color={HT.text} /></Pressable>
        <Text style={styles.title}>Email di sistema</Text>
      </View>
      {loading ? <ActivityIndicator style={{ marginTop: 40 }} color={HT.brand} /> : !cfg ? null : (
        <KScrollView contentContainerStyle={{ padding: 16, paddingBottom: pagePad, gap: 12 }} refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={HT.brand} />}>
          {/* Stato provider */}
          <View style={[styles.card, { borderColor: (prov?.color || HT.border) + "66" }]} testID="email-provider-card">
            <View style={styles.rowBetween}>
              <Text style={styles.cardTitle}>Provider attivo</Text>
              <View style={[styles.pill, { backgroundColor: (prov?.color || HT.muted) + "22", borderColor: (prov?.color || HT.muted) + "66" }]}>
                <View style={[styles.dot, { backgroundColor: prov?.color || HT.muted }]} />
                <Text style={[styles.pillTxt, { color: prov?.color || HT.muted }]}>{prov?.label}</Text>
              </View>
            </View>
            <Text style={styles.hint}>{prov?.hint}</Text>
            <View style={styles.kv}><Text style={styles.k}>Dominio mittente</Text><Text style={styles.v}>{cfg.domain}</Text></View>
            <View style={styles.kv}><Text style={styles.k}>RESEND_API_KEY</Text><Text style={[styles.v, { color: cfg.resend_key_configured ? HT.success : HT.warning }]}>{cfg.resend_key_configured ? `impostata (${cfg.resend_key_masked})` : "placeholder — da inserire nei Secrets"}</Text></View>
            <View style={styles.kv}><Text style={styles.k}>Notifiche interne a</Text><Text style={styles.v}>{cfg.master_notify_email}</Text></View>
          </View>

          {/* Mittenti */}
          <Text style={styles.section}>Caselle mittente</Text>
          {cfg.senders.map((s) => (
            <View key={s.kind} style={styles.card} testID={`email-sender-${s.kind}`}>
              <View style={styles.rowBetween}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
                  <View style={[styles.iconBox, { backgroundColor: s.kind === "info" ? HT.axonTint : s.kind === "help" ? HT.brandTint : HT.violetTint }]}>
                    <Ionicons name={s.kind === "info" ? "globe-outline" : s.kind === "help" ? "help-buoy-outline" : "person-circle-outline"} size={18} color={s.kind === "info" ? HT.axon : s.kind === "help" ? HT.brand : HT.violet} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.senderAddr}>{s.address}</Text>
                    <Text style={styles.hint}>{s.purpose}</Text>
                  </View>
                </View>
                <Text style={styles.envTag}>{s.env}</Text>
              </View>
            </View>
          ))}

          {/* Test */}
          <Text style={styles.section}>Invio di prova</Text>
          <View style={styles.card}>
            <View style={styles.kindRow}>
              {(["info", "help", "master"] as const).map((k) => (
                <Pressable key={k} onPress={() => setTestKind(k)} style={[styles.kindChip, testKind === k && styles.kindChipOn]} testID={`email-test-kind-${k}`}>
                  <Text style={[styles.kindTxt, testKind === k && { color: HT.brand }]}>{k === "master" ? "emanuele@" : `${k}@`}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput value={testTo} onChangeText={setTestTo} placeholder="destinatario@esempio.it" placeholderTextColor={HT.muted} autoCapitalize="none" keyboardType="email-address" style={styles.input} testID="email-test-to" />
            <Pressable onPress={sendTest} disabled={sending} style={[styles.primaryBtn, sending && { opacity: 0.6 }]} testID="email-test-send">
              {sending ? <ActivityIndicator color="#FFF" /> : <Ionicons name="paper-plane" size={16} color="#FFF" />}
              <Text style={styles.primaryBtnTxt}>Invia email di prova</Text>
            </Pressable>
          </View>

          {/* DNS */}
          <View style={[styles.card, { borderColor: HT.axonLine }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><Ionicons name="shield-checkmark-outline" size={16} color={HT.axon} /><Text style={styles.cardTitle}>Verifica dominio su Resend</Text></View>
            <Text style={styles.hint}>{cfg.dns_hint}</Text>
          </View>

          {/* Eventi */}
          <Text style={styles.section}>Ultimi invii</Text>
          {events.length === 0 ? <Text style={styles.hint}>Nessun invio registrato.</Text> : events.map((e) => (
            <View key={e.event_id} style={styles.evRow} testID={`email-event-${e.event_id}`}>
              <View style={[styles.dot, { backgroundColor: e.status === "sent" ? HT.success : e.status === "failed" ? HT.danger : HT.warning }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.evSubject} numberOfLines={1}>{e.subject}</Text>
                <Text style={styles.hint} numberOfLines={1}>{e.sender} → {e.to} · {e.provider || "—"} · {new Date(e.created_at).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</Text>
                {e.error ? <Text style={[styles.hint, { color: HT.danger }]} numberOfLines={2}>{e.error}</Text> : null}
              </View>
            </View>
          ))}
        </KScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: HT.bg },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: HT.border },
  iconBtn: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: HT.glass },
  title: { fontSize: 20, fontWeight: "900", color: HT.text, letterSpacing: -0.4 },
  section: { fontSize: 12, fontWeight: "800", color: HT.muted, textTransform: "uppercase", letterSpacing: 0.8, marginTop: 6 },
  card: { backgroundColor: HT.card, borderRadius: 16, borderWidth: 1, borderColor: HT.border, padding: 14, gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: "800", color: HT.text },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  pillTxt: { fontSize: 11, fontWeight: "800" },
  dot: { width: 7, height: 7, borderRadius: 4 },
  hint: { fontSize: 12, color: HT.muted, lineHeight: 17 },
  kv: { flexDirection: "row", justifyContent: "space-between", gap: 10, paddingTop: 6, borderTopWidth: 1, borderTopColor: HT.border },
  k: { fontSize: 12, color: HT.text2, fontWeight: "700" },
  v: { fontSize: 12, color: HT.text, fontWeight: "700", flexShrink: 1, textAlign: "right" },
  iconBox: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  senderAddr: { fontSize: 14.5, fontWeight: "800", color: HT.text },
  envTag: { fontSize: 10, fontWeight: "800", color: HT.text2, backgroundColor: HT.glassStrong, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  kindRow: { flexDirection: "row", gap: 8 },
  kindChip: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: HT.border, backgroundColor: HT.glass },
  kindChipOn: { borderColor: HT.brand, backgroundColor: HT.brandTint },
  kindTxt: { fontSize: 12, fontWeight: "800", color: HT.text2 },
  input: { borderWidth: 1, borderColor: HT.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, color: HT.text, backgroundColor: HT.card2, fontSize: 15 },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: HT.brand, paddingVertical: 12, borderRadius: 12, minHeight: 46 },
  primaryBtnTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
  evRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border, borderRadius: 12, padding: 12 },
  evSubject: { fontSize: 13, fontWeight: "700", color: HT.text },
});

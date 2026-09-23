// PushStatusCard.tsx — V50.z193 — Card "Stato canale push" (Notifiche AxonOS → Preferenze). Modulo ISOLATO.
// Mostra in linguaggio semplice se il telefono riceve i push, l'esito dell'ultimo test programmato e le azioni:
// "Test push tra 2 minuti" (spara il server, anche ad app chiusa), "Apri impostazioni" (permesso negato), "Ricollega".
import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Platform, Linking } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { notify } from "@/src/utils/notify";
import { useAuth } from "@/src/auth";
import { pushApi, PushStatus, syncPushDevice } from "@/src/pushBridge";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

const AXON = "#7C3AED";

function fmtWhen(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function PushStatusCard() {
  const { user } = useAuth();
  const [st, setSt] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState<"" | "test" | "sync" | "urg">("");
  const poll = useRef<any>(null);

  const load = useCallback(async () => {
    try { setSt(await pushApi.status()); } catch { /* offline */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Polling ogni 15s finché c'è un test in attesa/consegna
  useEffect(() => {
    const pending = st?.last_test && ["scheduled", "firing", "queued"].includes(st.last_test.status);
    if (pending && !poll.current) poll.current = setInterval(load, 15000);
    if (!pending && poll.current) { clearInterval(poll.current); poll.current = null; }
    return () => { if (poll.current) { clearInterval(poll.current); poll.current = null; } };
  }, [st?.last_test?.status, st?.last_test?.test_id, load]);

  const testUrgency = async (u: "CRITICAL" | "HIGH") => {
    setBusy("urg");
    try {
      const r = await pushApi.testUrgency(u);
      notify(u === "CRITICAL" ? "Test urgente inviato" : "Test standard inviato", r.push_configured ? `Canale ${r.channel_id}: sul telefono con l'app pubblicata arriva ${u === "CRITICAL" ? "con LED rosso e vibrazione lunga" : "con LED blu"}.` : "In questo ambiente il servizio push non è attivo: la push è registrata nel log e partirà sull'app pubblicata.");
      await load();
    } catch (e: any) { notify("Test non inviato", String(e?.message || e)); } finally { setBusy(""); }
  };
  const scheduleTest = async () => {
    setBusy("test");
    try {
      const r = await pushApi.scheduleTest(2);
      notify("Test programmato", r.push_configured
        ? "Tra 2 minuti riceverai una notifica push. Puoi chiudere l'app: l'esito comparirà qui."
        : "Tra 2 minuti il server invierà il test. In anteprima il push reale non parte: esito completo sull'app pubblicata.");
      await load();
    } catch (e: any) { notify("Test push", e?.message || "Impossibile programmare il test"); } finally { setBusy(""); }
  };

  const resync = async () => {
    setBusy("sync");
    try {
      if (Platform.OS === "web") { notify("Stato canale push", "Il collegamento al servizio push si fa dal telefono (app installata)."); await load(); return; }
      const r = await syncPushDevice(user?.user_id || "");
      if (r) setSt(r); else await load();
    } finally { setBusy(""); }
  };

  const dev = st?.devices?.[0];
  const denied = dev?.permission === "denied";
  const color = st?.level === "ok" ? HT.success : st?.level === "warn" ? HT.warning : HT.danger;
  const icon = st?.level === "ok" ? "checkmark-circle" : st?.level === "warn" ? "alert-circle" : "close-circle";
  const testPending = st?.last_test && ["scheduled", "firing", "queued"].includes(st.last_test.status);

  return (
    <View style={styles.card} testID="push-status-card">
      <View style={styles.head}>
        <Ionicons name="radio" size={18} color={AXON} />
        <Text style={styles.headTxt}>Stato canale push</Text>
        <Pressable onPress={load} hitSlop={10} testID="push-status-refresh" accessibilityLabel="Aggiorna stato">
          <Ionicons name="refresh" size={18} color={HT.muted} />
        </Pressable>
      </View>

      {!st ? <ActivityIndicator color={AXON} style={{ marginVertical: 8 }} /> : (
        <>
          <View style={styles.summaryRow}>
            <Ionicons name={icon as any} size={22} color={color} />
            <Text style={[styles.summary, { color: HT.text }]} testID="push-status-summary">{st.summary}</Text>
          </View>

          {dev && (
            <View style={styles.meta}>
              <Text style={styles.metaTxt}>
                {dev.platform === "ios" ? "iPhone" : "Android"} · {dev.registered ? "collegato" : "non collegato"} · permesso {dev.permission === "granted" ? "concesso" : dev.permission === "denied" ? "negato" : "da chiedere"}
              </Text>
              {dev.last_delivered_at ? <Text style={styles.metaTxt}>Ultima consegna: {fmtWhen(dev.last_delivered_at)}</Text> : null}
              {dev.last_failed_at ? <Text style={styles.metaTxt}>Ultimo problema: {fmtWhen(dev.last_failed_at)}</Text> : null}
              {st.outbox_pending > 0 ? <Text style={styles.metaTxt}>In riconsegna automatica: {st.outbox_pending}</Text> : null}
            </View>
          )}

          {st.last_test_label ? (
            <View style={[styles.testBox, { borderColor: st.last_test?.status === "delivered" || st.last_test?.status === "sent" ? HT.success : HT.border }]} testID="push-last-test">
              {testPending ? <ActivityIndicator size="small" color={AXON} /> : <Ionicons name="flask" size={16} color={AXON} />}
              <Text style={styles.testTxt}>{st.last_test_label}</Text>
            </View>
          ) : null}

          {/* V50.z220 — test dei livelli di urgenza (canali Android urgent_alerts / standard_alerts) */}
          <View style={styles.actions}>
            <Pressable onPress={() => testUrgency("CRITICAL")} disabled={busy !== ""} style={[styles.btn, { backgroundColor: '#DC2626', opacity: busy ? 0.6 : 1 }]} testID="push-test-critical">
              {busy === "urg" ? <ActivityIndicator color="#FFF" /> : <><Ionicons name="warning-outline" size={16} color="#FFF" /><Text style={styles.btnTxt}>Test URGENTE (LED rosso)</Text></>}
            </Pressable>
            <Pressable onPress={() => testUrgency("HIGH")} disabled={busy !== ""} style={[styles.btn, styles.btnGhost]} testID="push-test-high">
              <Ionicons name="notifications-outline" size={16} color={AXON} /><Text style={[styles.btnTxt, { color: AXON }]}>Test standard</Text>
            </Pressable>
          </View>
          <View style={styles.actions}>
            <Pressable onPress={scheduleTest} disabled={busy !== "" || !!testPending} style={[styles.btn, { backgroundColor: AXON, opacity: busy || testPending ? 0.6 : 1 }]} testID="push-test-2min">
              {busy === "test" ? <ActivityIndicator color="#FFF" /> : <><Ionicons name="timer-outline" size={16} color="#FFF" /><Text style={styles.btnTxt}>Test push tra 2 minuti</Text></>}
            </Pressable>
            {denied ? (
              <Pressable onPress={() => Linking.openSettings().catch(() => {})} style={[styles.btn, { backgroundColor: HT.danger }]} testID="push-open-settings">
                <Ionicons name="settings-outline" size={16} color="#FFF" /><Text style={styles.btnTxt}>Apri impostazioni</Text>
              </Pressable>
            ) : (
              <Pressable onPress={resync} disabled={busy !== ""} style={[styles.btn, styles.btnGhost]} testID="push-resync">
                {busy === "sync" ? <ActivityIndicator color={AXON} /> : <><Ionicons name="link-outline" size={16} color={AXON} /><Text style={[styles.btnTxt, { color: AXON }]}>Ricollega</Text></>}
              </Pressable>
            )}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: HT.card2, borderRadius: 14, borderWidth: 1, borderColor: '#C4B5FD', padding: 14, gap: 10 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  headTxt: { flex: 1, fontSize: 13, fontWeight: "900", color: HT.muted, textTransform: "uppercase", letterSpacing: 0.5 },
  summaryRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  summary: { flex: 1, fontSize: 14, fontWeight: "700", lineHeight: 20 },
  meta: { gap: 2, paddingLeft: 30 },
  metaTxt: { fontSize: 12, color: HT.muted },
  testBox: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 10, padding: 10, backgroundColor: HT.card2 },
  testTxt: { flex: 1, fontSize: 13, fontWeight: "700", color: HT.text },
  actions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  btn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, minHeight: 46, minWidth: 140 },
  btnGhost: { backgroundColor: HT.card2, borderWidth: 1, borderColor: '#C4B5FD' },
  btnTxt: { color: "#FFF", fontWeight: "800", fontSize: 13 },
});

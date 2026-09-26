// paywall.tsx — V50.z330 — Schermata di blocco a fine prova / abbonamento scaduto.
// Piani (Stripe Checkout ospitato), codice promo/amico, richiesta di attivazione al Super Admin, contatto, logout.
// Ritorno da Stripe: /paywall?session_id=… → polling GET /billing/checkout-status → se pagato → Home.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Linking, Platform, TextInput } from "react-native";
import { KScrollView } from "@/src/ui/keyboard"; // V50.z374 — tastiera: campo attivo sempre visibile
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";
import { PromoCodeField } from "@/src/PromoCodeField";
import type { SubscriptionState } from "@/src/paywall";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

type Plan = { id: "mensile" | "annuale"; label: string; amount: number; currency: string; days: number; desc: string; badge?: string };
type PlansResp = { plans: Plan[]; state: SubscriptionState; is_owner: boolean; support_email: string; stripe_enabled: boolean };

function originUrl(): string {
  if (Platform.OS === "web" && typeof window !== "undefined") return window.location.origin;
  return (process.env.EXPO_PUBLIC_BACKEND_URL || "").replace(/\/$/, "");
}

export default function PaywallScreen() {
  const router = useRouter();
  const { logout, user } = useAuth();
  const { session_id, cancelled } = useLocalSearchParams<{ session_id?: string; cancelled?: string }>();
  const [data, setData] = useState<PlansResp | null>(null);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [reqBusy, setReqBusy] = useState(false);
  const [reqDone, setReqDone] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(() => api<PlansResp>("/billing/plans").then(setData).catch(() => setData(null)), []);
  useEffect(() => { void load(); }, [load]);

  const goHome = useCallback(() => router.replace("/(tabs)/home" as any), [router]);

  // Ritorno da Stripe: verifica pagamento (max ~10 tentativi)
  useEffect(() => {
    if (!session_id) return;
    let attempts = 0;
    const tick = async () => {
      attempts += 1;
      try {
        const r = await api<{ payment_status: string; status: string; state: SubscriptionState }>(`/billing/checkout-status/${session_id}`);
        if (r.payment_status === "paid") {
          setChecking(null);
          notify("Pagamento confermato ✅", `Abbonamento attivo fino al ${r.state?.expires_at ? new Date(r.state.expires_at).toLocaleDateString("it-IT") : "—"}. Bentornato!`);
          goHome();
          return;
        }
        if (r.status === "expired") { setChecking(null); notify("Sessione di pagamento scaduta", "Riprova a scegliere un piano."); return; }
      } catch {}
      if (attempts < 10) { setChecking("Confermo il pagamento…"); pollRef.current = setTimeout(tick, 2000); }
      else { setChecking(null); notify("Pagamento in elaborazione", "Se hai completato il pagamento, l'accesso si sblocca entro pochi minuti. Tocca «Ricontrolla»."); }
    };
    setChecking("Confermo il pagamento…");
    void tick();
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, [session_id, goHome]);

  useEffect(() => { if (cancelled) notify("Pagamento annullato", "Nessun addebito effettuato."); }, [cancelled]);

  const buy = async (plan: Plan) => {
    setBusyPlan(plan.id);
    try {
      const r = await api<{ url: string; session_id: string }>("/billing/checkout", { method: "POST", body: { plan: plan.id, origin_url: originUrl() } });
      if (Platform.OS === "web" && typeof window !== "undefined") window.location.href = r.url; // stessa scheda → torna su /paywall?session_id=…
      else await Linking.openURL(r.url);
    } catch (e: any) {
      notify("Pagamento non avviato", e?.message || "Riprova tra poco");
    } finally { setBusyPlan(null); }
  };

  const recheck = async () => {
    const s = await api<SubscriptionState>("/subscription/status").catch(() => null);
    if (s && s.status !== "expired") { notify("Accesso riattivato ✅"); goHome(); }
    else { notify("Ancora scaduto", "Nessuna attivazione trovata. Scegli un piano o inserisci un codice."); void load(); }
  };

  const sendRequest = async () => {
    setReqBusy(true);
    try {
      const r = await api<{ ok: boolean; message: string; already?: boolean }>("/billing/activation-request", { method: "POST", body: { note: note.trim() || null } });
      setReqDone(r.message);
    } catch (e: any) { notify("Invio non riuscito", e?.message); } finally { setReqBusy(false); }
  };

  const st = data?.state;
  const expired = !st || st.status === "expired";
  const money = (p: Plan) => `${p.amount.toLocaleString("it-IT", { minimumFractionDigits: 0 })} €`;

  return (
    <SafeAreaView style={s.root} edges={["top", "bottom"]}>
      <KScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled" testID="paywall-screen">
        <View style={s.hero}>
          <View style={s.heroIcon}><Ionicons name={expired ? "lock-closed" : "time"} size={30} color={theme.color.onBrandPrimary} /></View>
          <Text style={s.h1} testID="paywall-title">{expired ? "La tua prova gratuita è terminata" : "Il tuo abbonamento"}</Text>
          <Text style={s.sub}>
            {expired
              ? "AdvisorOS resta in pausa: i tuoi dati sono al sicuro e ti aspettano. Attiva un piano, usa un codice oppure chiedi l'attivazione."
              : st?.days_left != null ? `${st.days_left} giorni rimanenti · scade il ${st.expires_at ? new Date(st.expires_at).toLocaleDateString("it-IT") : "—"}` : "Accesso attivo"}
          </Text>
          {checking ? <View style={s.checking}><ActivityIndicator color={theme.color.onBrandPrimary} /><Text style={s.checkingTxt}>{checking}</Text></View> : null}
        </View>

        {!data ? <ActivityIndicator style={{ marginTop: 24 }} color={HT.brand} /> : (
          <>
            <Text style={s.section}>Scegli un piano</Text>
            {!data.is_owner ? <Text style={s.hint}>L&apos;abbonamento è gestito dal titolare dell&apos;account ({user?.email ? "chiedi a chi ti ha invitato" : ""}). Puoi comunque inviare la richiesta qui sotto.</Text> : null}
            <View style={s.plans}>
              {data.plans.map((p) => (
                <Pressable key={p.id} onPress={() => buy(p)} disabled={!!busyPlan || !data.stripe_enabled} style={({ pressed }) => [s.plan, p.id === "annuale" && s.planBest, pressed && { opacity: 0.9 }]} testID={`paywall-plan-${p.id}`}>
                  {p.badge ? <View style={s.badge}><Text style={s.badgeTxt}>{p.badge}</Text></View> : null}
                  <Text style={[s.planLabel, p.id === "annuale" && { color: theme.color.onBrandPrimary }]}>{p.label}</Text>
                  <Text style={[s.planPrice, p.id === "annuale" && { color: theme.color.onBrandPrimary }]}>{money(p)}</Text>
                  <Text style={[s.planDesc, p.id === "annuale" && { color: theme.color.onBrandPrimary, opacity: 0.9 }]}>{p.desc}</Text>
                  <View style={[s.planBtn, p.id === "annuale" && { backgroundColor: theme.color.onBrandPrimary }]}>
                    {busyPlan === p.id ? <ActivityIndicator color={p.id === "annuale" ? HT.brand : theme.color.onBrandPrimary} /> : (
                      <Text style={[s.planBtnTxt, p.id === "annuale" && { color: HT.brand }]}>Paga con carta</Text>
                    )}
                  </View>
                </Pressable>
              ))}
            </View>
            <Text style={s.hint}>Pagamento sicuro con Stripe · ricevuta via email · nessun rinnovo automatico</Text>

            <Text style={s.section}>Hai un codice promozionale o un codice amico?</Text>
            <View style={s.card} testID="paywall-promo"><PromoCodeField compact onApplied={() => { void recheck(); }} /></View>

            <Text style={s.section}>Preferisci essere attivato da noi?</Text>
            <View style={s.card} testID="paywall-request">
              {reqDone ? (
                <View style={s.okRow}><Ionicons name="checkmark-circle" size={20} color={HT.success} /><Text style={s.okTxt}>{reqDone}</Text></View>
              ) : (
                <>
                  <Text style={s.cardTxt}>Inviamo una richiesta al team AdvisorOS: ti ricontattiamo e attiviamo l&apos;account per te.</Text>
                  <TextInput value={note} onChangeText={setNote} placeholder="Nota (facoltativa): azienda, piano desiderato, telefono…" placeholderTextColor={HT.muted} style={s.input} multiline testID="paywall-request-note" />
                  <Pressable onPress={sendRequest} disabled={reqBusy} style={s.secondaryBtn} testID="paywall-request-send">
                    {reqBusy ? <ActivityIndicator color={HT.brand} /> : <><Ionicons name="paper-plane-outline" size={18} color={HT.brand} /><Text style={s.secondaryTxt}>Richiedi attivazione</Text></>}
                  </Pressable>
                </>
              )}
              <Pressable onPress={() => void Linking.openURL(`mailto:${data.support_email}?subject=Attivazione AdvisorOS`)} style={s.linkRow} testID="paywall-mail">
                <Ionicons name="mail-outline" size={16} color={theme.color.brandSecondary} /><Text style={s.link}>{data.support_email}</Text>
              </Pressable>
            </View>

            <View style={s.footerRow}>
              <Pressable onPress={recheck} style={s.ghostBtn} testID="paywall-recheck"><Ionicons name="refresh" size={16} color={HT.text2} /><Text style={s.ghostTxt}>Ricontrolla</Text></Pressable>
              <Pressable onPress={() => { void logout().then(() => router.replace("/login" as any)); }} style={s.ghostBtn} testID="paywall-logout"><Ionicons name="log-out-outline" size={16} color={HT.text2} /><Text style={s.ghostTxt}>Esci</Text></Pressable>
            </View>
          </>
        )}
      </KScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: HT.card2 },
  body: { padding: 16, paddingBottom: 40, gap: 10 },
  hero: { backgroundColor: HT.brand, borderRadius: 20, padding: 22, alignItems: "center", gap: 10 },
  heroIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: "rgba(255,255,255,0.16)", alignItems: "center", justifyContent: "center" },
  h1: { color: theme.color.onBrandPrimary, fontSize: 22, fontWeight: "800", textAlign: "center" },
  sub: { color: theme.color.onBrandPrimary, opacity: 0.9, fontSize: 14, lineHeight: 20, textAlign: "center" },
  checking: { flexDirection: "row", gap: 8, alignItems: "center", marginTop: 4 },
  checkingTxt: { color: theme.color.onBrandPrimary, fontWeight: "700" },
  section: { fontSize: 15, fontWeight: "800", color: HT.text, marginTop: 10 },
  hint: { fontSize: 12, color: HT.muted, textAlign: "center" },
  plans: { flexDirection: "row", gap: 10 },
  plan: { flex: 1, backgroundColor: HT.card2, borderRadius: 16, borderWidth: 1, borderColor: HT.border, padding: 14, gap: 6, minHeight: 190, justifyContent: "space-between" },
  planBest: { backgroundColor: HT.brand, borderColor: HT.brand },
  badge: { alignSelf: "flex-start", backgroundColor: HT.warning, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  badgeTxt: { color: theme.color.onBrandPrimary, fontSize: 11, fontWeight: "800" },
  planLabel: { fontSize: 14, fontWeight: "700", color: HT.text2 },
  planPrice: { fontSize: 28, fontWeight: "800", color: HT.text },
  planDesc: { fontSize: 12, color: HT.muted, lineHeight: 16 },
  planBtn: { backgroundColor: HT.brand, borderRadius: 12, minHeight: 44, alignItems: "center", justifyContent: "center", marginTop: 6 },
  planBtnTxt: { color: theme.color.onBrandPrimary, fontWeight: "800" },
  card: { backgroundColor: HT.card2, borderRadius: 16, borderWidth: 1, borderColor: HT.border, padding: 14, gap: 10 },
  cardTxt: { fontSize: 13, color: HT.text2, lineHeight: 19 },
  input: { borderWidth: 1, borderColor: HT.border, borderRadius: 12, padding: 12, minHeight: 64, color: HT.text, backgroundColor: HT.card2, textAlignVertical: "top" },
  secondaryBtn: { flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", minHeight: 46, borderRadius: 12, borderWidth: 1.5, borderColor: HT.brand },
  secondaryTxt: { color: HT.brand, fontWeight: "800" },
  okRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  okTxt: { flex: 1, color: HT.success, fontWeight: "700" },
  linkRow: { flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", minHeight: 36 },
  link: { color: theme.color.brandSecondary, fontWeight: "700" },
  footerRow: { flexDirection: "row", justifyContent: "center", gap: 18, marginTop: 8 },
  ghostBtn: { flexDirection: "row", gap: 6, alignItems: "center", minHeight: 44, paddingHorizontal: 12 },
  ghostTxt: { color: HT.text2, fontWeight: "700" },
});

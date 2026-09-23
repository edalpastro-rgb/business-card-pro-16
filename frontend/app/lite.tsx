// lite.tsx — V50.z334 — Pagina pubblica di AXONOS LITE: Axon è il diamante, Lite la porta d'ingresso per tutti.
// Dark palette marketing (LP). CTA «Richiedi accesso anticipato» → POST /api/public/demo-request (company "AxonOS Lite").
import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput, ActivityIndicator, Animated, Easing, useWindowDimensions, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LP } from "@/src/landing/palette";
import { api } from "@/src/api";

const LITE_APP_URL = process.env.EXPO_PUBLIC_LITE_URL || ""; // quando l'app Lite sarà pubblicata: link diretto

const DIALOGS = [
  { q: "Axon, dov'ero il 9 settembre sera?", a: "Da Costantino, con Laura: era il vostro anniversario. Hai lasciato una nota: «tornare per la tagliata»." },
  { q: "Tra una settimana è di nuovo l'anniversario: dove mi consigli a Verona?", a: "Che budget hai in mente? Ti propongo tre posti con vista, poi prenoto io: tavolo per due, e chiamo il ristorante come tuo assistente." },
  { q: "Ok, la 1. Prenota.", a: "Fatto: sabato 20:30, tavolo per due da Locanda 4 Cuochi. Ti ho messo il promemoria e il tragitto in agenda." },
];

const WHO = [
  { icon: "medkit-outline", t: "Medici", d: "Turni, pazienti da richiamare, congressi: Axon ricorda, tu curi." },
  { icon: "briefcase-outline", t: "Avvocati e notai", d: "Udienze, scadenze, note vocali che diventano appunti ordinati." },
  { icon: "construct-outline", t: "Geometri e architetti", d: "Cantieri, sopralluoghi, documenti da portare: tutto in una domanda." },
  { icon: "home-outline", t: "Famiglie", d: "Scuola, sport, visite, compleanni: un cervello condiviso che non dimentica." },
  { icon: "school-outline", t: "Studenti", d: "Esami, consegne, appunti: Axon organizza e ti interroga." },
  { icon: "globe-outline", t: "Chiunque", d: "Ogni lingua, ogni fuso, ogni giorno. Basta chiedere." },
];

const POWERS = [
  { icon: "sparkles", t: "Ricorda tutto", d: "Persone, luoghi, promesse, preferenze. Memoria privata, solo tua." },
  { icon: "time-outline", t: "Organizza il tuo tempo", d: "Agenda, promemoria, tragitti. Ti anticipa, non ti insegue." },
  { icon: "flash-outline", t: "Agisce per te", d: "Cerca, propone, prenota, scrive. Con il tuo ok, ogni volta." },
  { icon: "mic-outline", t: "Voce, sempre", d: "Parla e ascolta, anche a mani libere. Ti risponde con la sua voce." },
  { icon: "lock-closed-outline", t: "Non replicabile", d: "Un cervello che cresce con te. Le app passano, Axon resta." },
  { icon: "trending-up-outline", t: "Cresce con te", d: "Quando gestisci clienti e contratti, lo stesso Axon vive in AdvisorOS." },
];

function Diamond({ size = 84 }: { size?: number }) {
  const spin = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(Animated.timing(spin, { toValue: 1, duration: 9000, easing: Easing.linear, useNativeDriver: true })).start();
    Animated.loop(Animated.sequence([Animated.timing(glow, { toValue: 1, duration: 1400, useNativeDriver: true }), Animated.timing(glow, { toValue: 0, duration: 1400, useNativeDriver: true })])).start();
  }, [spin, glow]);
  const rotateY = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const opacity = glow.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] });
  return (
    <View style={{ alignItems: "center", justifyContent: "center", width: size * 1.6, height: size * 1.6 }}>
      <Animated.View style={{ position: "absolute", width: size * 1.6, height: size * 1.6, borderRadius: size, backgroundColor: LP.axonGlow, opacity }} />
      <Animated.View style={{ transform: [{ perspective: 600 }, { rotateY }] }}>
        <Ionicons name="diamond" size={size} color={LP.axon} />
      </Animated.View>
      <Animated.View style={{ position: "absolute", top: 6, right: 10, opacity }}><Ionicons name="sparkles" size={18} color="#FFFFFF" /></Animated.View>
    </View>
  );
}

export default function LiteLanding() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const compact = width < 720;
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false); const [done, setDone] = useState(false); const [err, setErr] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const tryLite = () => { if (LITE_APP_URL) void Linking.openURL(LITE_APP_URL); else scrollRef.current?.scrollToEnd({ animated: true }); };

  const submit = async () => {
    if (name.trim().length < 2 || phone.trim().length < 6) { setErr("Inserisci nome e telefono (o email)"); return; }
    setBusy(true); setErr(null);
    try {
      await api("/public/demo-request", { method: "POST", body: { full_name: name.trim(), company: "AxonOS Lite", phone: phone.trim(), email: email.trim() || undefined, consent_privacy: true, website: "" } });
      setDone(true);
    } catch (e: any) { setErr(e?.message || "Invio non riuscito, riprova"); } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={s.root} edges={["top"]}>
      <ScrollView ref={scrollRef} contentContainerStyle={{ paddingBottom: 48 }} keyboardShouldPersistTaps="handled" testID="lite-landing">
        <View style={s.nav}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={s.navBtn} testID="lite-back"><Ionicons name="chevron-back" size={24} color={LP.onSurface} /></Pressable>
          <Text style={s.navBrand}>Axon<Text style={{ color: LP.axon }}>OS</Text> <Text style={{ color: LP.onSurface2, fontWeight: "600" }}>Lite</Text></Text>
          <View style={{ width: 44 }} />
        </View>

        {/* HERO */}
        <View style={[s.hero, compact && { paddingVertical: 32 }]}>
          <Diamond size={compact ? 72 : 96} />
          <Text style={s.kicker}>IL DIAMANTE · AXON</Text>
          <Text style={[s.h1, compact && { fontSize: 34, lineHeight: 40 }]}>Un assistente che <Text style={{ color: LP.axon }}>ricorda tutto</Text>,{"\n"}organizza il tuo tempo{"\n"}e agisce per te.</Text>
          <Text style={s.lead}>AxonOS Lite è Axon per tutti: medici, avvocati, geometri, famiglie, studenti. Nessun CRM, nessuna impostazione. Basta chiedere.</Text>
          <View style={[s.ctaRow, compact && { flexDirection: "column", alignItems: "stretch" }]}>
            <Pressable onPress={tryLite} style={({ pressed }) => [s.cta, pressed && s.pressed]} testID="lite-cta-try">
              <Ionicons name="sparkles" size={18} color={LP.onBrand} /><Text style={s.ctaTxt}>{LITE_APP_URL ? "PROVA AXONOS LITE" : "RICHIEDI ACCESSO ANTICIPATO"}</Text>
            </Pressable>
            <Pressable onPress={() => router.push("/landing" as any)} style={({ pressed }) => [s.ghost, pressed && s.pressed]} testID="lite-cta-advisor">
              <Text style={s.ghostTxt}>Gestisci clienti e contratti? AdvisorOS →</Text>
            </Pressable>
          </View>
        </View>

        {/* DIALOGO */}
        <View style={s.section}>
          <View style={s.container}>
            <Text style={s.kicker}>BASTA CHIEDERE</Text>
            <Text style={s.h2}>Non un&apos;app in più. Una memoria in più.</Text>
            <View style={{ gap: 12, marginTop: 20 }}>
              {DIALOGS.map((d, i) => (
                <View key={i} style={{ gap: 8 }} testID={`lite-dialog-${i}`}>
                  <View style={[s.bubble, s.bubbleQ]}><Text style={s.bubbleQTxt}>{d.q}</Text></View>
                  <View style={[s.bubble, s.bubbleA]}><View style={s.axonDot} /><Text style={s.bubbleATxt}>{d.a}</Text></View>
                </View>
              ))}
            </View>
            <Text style={s.note}>Prenotazioni, caparre e chiamate solo con il tuo consenso esplicito, ogni volta.</Text>
          </View>
        </View>

        {/* POTENZA */}
        <View style={[s.section, { backgroundColor: LP.surface2 }]}>
          <View style={s.container}>
            <Text style={s.kicker}>PERCHÉ NON È REPLICABILE</Text>
            <Text style={s.h2}>Mille app senza controllo valgono zero.{"\n"}Un cervello che ti conosce vale tutto.</Text>
            <View style={[s.grid, compact && { flexDirection: "column" }]}>
              {POWERS.map((p) => (
                <View key={p.t} style={[s.tile, !compact && { width: "31%" }]}>
                  <View style={s.tileIcon}><Ionicons name={p.icon as any} size={20} color={LP.axon} /></View>
                  <Text style={s.tileT}>{p.t}</Text><Text style={s.tileD}>{p.d}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>

        {/* PER CHI */}
        <View style={s.section}>
          <View style={s.container}>
            <Text style={s.kicker}>PER CHI</Text>
            <Text style={s.h2}>Per chi ha una segretaria. E per chi non l&apos;ha.</Text>
            <Text style={s.lead}>Non tutti gestiscono reti vendita o contratti. Tutti hanno un tempo da difendere e cose da non dimenticare.</Text>
            <View style={[s.grid, compact && { flexDirection: "column" }]}>
              {WHO.map((w) => (
                <View key={w.t} style={[s.tile, !compact && { width: "31%" }]}>
                  <View style={s.tileIcon}><Ionicons name={w.icon as any} size={20} color={LP.brand} /></View>
                  <Text style={s.tileT}>{w.t}</Text><Text style={s.tileD}>{w.d}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>

        {/* ACCESSO */}
        <View style={[s.section, { backgroundColor: LP.surface2 }]}>
          <View style={[s.container, { maxWidth: 560 }]}>
            <Text style={s.kicker}>ACCESSO ANTICIPATO</Text>
            <Text style={s.h2}>Entra tra i primi.</Text>
            {done ? (
              <View style={s.okBox} testID="lite-form-done"><Ionicons name="checkmark-circle" size={22} color={LP.axon} /><Text style={s.okTxt}>Grazie! Ti scriviamo noi appena AxonOS Lite è pronto per te.</Text></View>
            ) : (
              <View style={{ gap: 10, marginTop: 16 }} testID="lite-form">
                <TextInput value={name} onChangeText={setName} placeholder="Nome e cognome" placeholderTextColor={LP.muted} style={s.input} testID="lite-name" />
                <TextInput value={phone} onChangeText={setPhone} placeholder="Telefono" placeholderTextColor={LP.muted} keyboardType="phone-pad" style={s.input} testID="lite-phone" />
                <TextInput value={email} onChangeText={setEmail} placeholder="Email (facoltativa)" placeholderTextColor={LP.muted} keyboardType="email-address" autoCapitalize="none" style={s.input} testID="lite-email" />
                {err ? <Text style={s.err}>{err}</Text> : null}
                <Pressable onPress={submit} disabled={busy} style={({ pressed }) => [s.cta, { alignSelf: "stretch", justifyContent: "center" }, pressed && s.pressed]} testID="lite-form-submit">
                  {busy ? <ActivityIndicator color={LP.onBrand} /> : <><Text style={s.ctaTxt}>VOGLIO AXON</Text><Ionicons name="arrow-forward" size={18} color={LP.onBrand} /></>}
                </Pressable>
                <Text style={s.note}>Nessuna newsletter: solo l&apos;invito. I dati restano in AdvisorOS.</Text>
              </View>
            )}
          </View>
        </View>

        <View style={s.footer}>
          <Text style={s.footTxt}>Axon è il cervello. AxonOS Lite lo porta a tutti. AdvisorOS lo mette al lavoro nelle reti vendita.</Text>
          <Pressable onPress={() => router.push("/landing" as any)} style={{ minHeight: 44, justifyContent: "center" }} testID="lite-foot-advisor"><Text style={s.footLink}>Scopri AdvisorOS →</Text></Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: LP.surface },
  nav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 8, paddingVertical: 6 },
  navBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  navBrand: { color: LP.onSurface, fontSize: 18, fontWeight: "900", letterSpacing: -0.5 },
  hero: { alignItems: "center", paddingVertical: 48, paddingHorizontal: 20, gap: 14 },
  kicker: { color: LP.axon, fontSize: 12, fontWeight: "800", letterSpacing: 2.4 },
  h1: { color: LP.onSurface, fontSize: 44, fontWeight: "900", letterSpacing: -1.4, lineHeight: 50, textAlign: "center" },
  h2: { color: LP.onSurface, fontSize: 28, fontWeight: "900", letterSpacing: -0.8, lineHeight: 34, marginTop: 10 },
  lead: { color: LP.onSurface2, fontSize: 17, lineHeight: 26, textAlign: "center", maxWidth: 680, marginTop: 4 },
  ctaRow: { flexDirection: "row", gap: 12, alignItems: "center", marginTop: 12 },
  cta: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 28, paddingVertical: 16, borderRadius: 999, backgroundColor: LP.brand, minHeight: 52 },
  ctaTxt: { color: LP.onBrand, fontSize: 15, fontWeight: "900", letterSpacing: 1.6 },
  ghost: { paddingHorizontal: 18, paddingVertical: 14, borderRadius: 999, borderWidth: 1, borderColor: LP.border, minHeight: 52, justifyContent: "center", alignItems: "center" },
  ghostTxt: { color: LP.onSurface2, fontWeight: "700" },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  section: { paddingVertical: 56 },
  container: { width: "100%", maxWidth: 1000, alignSelf: "center", paddingHorizontal: 20 },
  bubble: { borderRadius: 18, padding: 14, maxWidth: "92%" },
  bubbleQ: { alignSelf: "flex-end", backgroundColor: LP.surface3, borderWidth: 1, borderColor: LP.border },
  bubbleQTxt: { color: LP.onSurface, fontSize: 15, lineHeight: 21 },
  bubbleA: { alignSelf: "flex-start", backgroundColor: LP.axonTint, borderWidth: 1, borderColor: LP.axonLineSoft, flexDirection: "row", gap: 10, alignItems: "flex-start" },
  axonDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: LP.axon, marginTop: 6 },
  bubbleATxt: { flex: 1, color: LP.onSurface, fontSize: 15, lineHeight: 21 },
  note: { color: LP.muted, fontSize: 12, marginTop: 16, textAlign: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 22 },
  tile: { backgroundColor: LP.surface, borderRadius: 16, borderWidth: 1, borderColor: LP.border, padding: 16, gap: 6 },
  tileIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: LP.axonGlow, alignItems: "center", justifyContent: "center" },
  tileT: { color: LP.onSurface, fontSize: 15, fontWeight: "800" },
  tileD: { color: LP.onSurface2, fontSize: 13, lineHeight: 19 },
  input: { backgroundColor: LP.surface, borderWidth: 1, borderColor: LP.border, borderRadius: 12, paddingHorizontal: 14, minHeight: 48, color: LP.onSurface, fontSize: 15 },
  err: { color: LP.errorText, fontSize: 13 },
  okBox: { flexDirection: "row", gap: 10, alignItems: "center", backgroundColor: LP.axonTint, borderRadius: 14, padding: 16, marginTop: 16 },
  okTxt: { flex: 1, color: LP.onSurface, fontWeight: "700" },
  footer: { alignItems: "center", gap: 6, paddingVertical: 28, paddingHorizontal: 20, borderTopWidth: 1, borderTopColor: LP.border },
  footTxt: { color: LP.onSurface2, fontSize: 13, textAlign: "center", lineHeight: 19 },
  footLink: { color: LP.axon, fontWeight: "800" },
});

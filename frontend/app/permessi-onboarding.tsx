// permessi-onboarding.tsx — V50.z485 — PERMESSI AL PRIMO AVVIO: i 4 permessi di sistema (GPS, microfono, fotocamera, contatti)
// chiesti UNO ALLA VOLTA, con il messaggio chiave: i dati restano privati, ma per avere Axon al 100% servono tutte le
// autorizzazioni — «Axon è la tua estensione, non una cosa in più da gestire. Tu chiedi e Axon fa: ma devi permetterglielo».
// Mostrato una sola volta per utente (AsyncStorage `perm_onboarding_done_{user_id}`), solo su app nativa.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "@/src/auth";
import { HT } from "@/src/homeTheme";
import { PERM_META, PERM_ONBOARDING_KEY, type PermKey, type PermInfo, ensureDevicePermission, getDevicePermissions, openSystemSettings } from "@/src/permissions/devicePermissions";
import { playActivationEffect } from "@/src/activation/events";
import { openAxonChat } from "@/src/axonProactive";
import { api } from "@/src/api";
import { playAudioBase64, type AudioStopper } from "@/src/utils/audioPlayback";

// V50.z486 — VOCE DI AXON nell'onboarding (come nel Tour): una frase alla volta, pausa/riprendi/stop/muto SEMPRE visibili.
// Il muto è condiviso con il Tour (chiave `tour_voice_muted`) e viene ricordato.
const MUTE_KEY = "tour_voice_muted";
const voice = { gen: 0, stop: (() => {}) as () => void, pauser: null as AudioStopper | null, muted: false };
const voiceStop = () => { voice.gen += 1; try { voice.stop(); } catch { /* noop */ } voice.stop = () => {}; voice.pauser = null; };
async function speak(text: string, onState: (st: "loading" | "speaking" | "idle") => void) {
  voiceStop();
  if (voice.muted) { onState("idle"); return; }
  const my = voice.gen; onState("loading");
  let audio: { b64: string; mime: string } | null = null;
  try { const r = await api<{ audio_base64: string; mime: string }>("/assistant/tts", { method: "POST", body: { text } }); if (r?.audio_base64) audio = { b64: r.audio_base64, mime: r.mime || "audio/mpeg" }; } catch { /* silenzio */ }
  if (voice.gen !== my) return;
  if (!audio) { onState("idle"); return; }
  try {
    const stopper = await playAudioBase64(audio.b64, audio.mime, () => { if (voice.gen === my) onState("idle"); });
    if (voice.gen !== my) { try { stopper(); } catch { /* noop */ } return; }
    voice.stop = stopper; voice.pauser = stopper; onState("speaking");
  } catch { onState("idle"); }
}
const VOICE_INTRO = "Ciao. Io sono Axon, la tua estensione: non una cosa in più da gestire, ma il collega che lavora al posto tuo. Tu chiedi, e io faccio. Ma devi permettermelo. I tuoi dati restano privati: posizione, voce, foto e rubrica li uso solo io, solo quando me lo chiedi tu, e non li condivido con nessuno. Per darti il cento per cento servono tutte e quattro le autorizzazioni. Te le chiedo una alla volta, spiegandoti a cosa servono.";
const VOICE_STEP: Record<PermKey, string> = {
  location: "Primo permesso: la posizione. Con il GPS posso dirti chi hai vicino adesso, costruire il percorso migliore della giornata partendo da dove sei, e segnare da solo le visite fatte. La uso solo mentre usi l'app.",
  microphone: "Secondo permesso: il microfono. È la mia voce preferita: tu parli e io scrivo note, relazioni, appuntamenti e contatti. Serve anche per chiamarmi a mani libere in auto. L'audio serve solo per la trascrizione, e resta tuo.",
  camera: "Terzo permesso: la fotocamera. Fotografi una bolletta o un biglietto da visita e io leggo i dati e creo tutto in un attimo. Le foto restano nel tuo archivio.",
  contacts: "Ultimo permesso: la rubrica. Così importi i clienti in un tap e, se mi dici chiama Mario, lo trovo anche se non è ancora nel CRM. Non copio e non invio la rubrica: la leggo solo quando me lo chiedi.",
};

const STEPS: { key: PermKey; title: string; axon: string[]; privacy: string }[] = [
  { key: "location", title: "Posizione (GPS)", axon: ["«Axon, chi ho vicino a me adesso?» → clienti nel raggio di pochi km", "Percorso ottimizzato della giornata partendo da dove sei", "Meteo e rilevamento automatico delle visite fatte"], privacy: "Usata solo mentre usi l'app. Non viene mai condivisa con nessuno." },
  { key: "microphone", title: "Microfono", axon: ["Parli e Axon scrive: note, relazioni, appuntamenti, contatti", "«Ehi Axon» a mani libere, anche in auto (Axon Drive)", "Note vocali su clienti e corsi, trascritte in automatico"], privacy: "L'audio serve solo per la trascrizione: resta tuo, non viene usato per altro." },
  { key: "camera", title: "Fotocamera", axon: ["Fotografi una bolletta e Axon ne legge i dati", "Biglietti da visita → contatto creato in un attimo", "Documenti e foto allegati a clienti e appuntamenti"], privacy: "Le foto restano nel tuo archivio: le scatti tu, quando vuoi." },
  { key: "contacts", title: "Contatti (rubrica)", axon: ["Importi i clienti dalla rubrica in un tap", "«Chiama Mario» funziona anche se Mario non è ancora nel CRM", "Salvi i nuovi clienti nella rubrica del telefono"], privacy: "La rubrica non viene copiata né inviata: Axon la legge solo quando glielo chiedi." },
];

export default function PermessiOnboarding() {
  const router = useRouter();
  const { user } = useAuth();
  // Arrivo dal Tour (attivazione «nome + voce»): l'effetto di attivazione (chat + «Ciao, sono X») parte DOPO i permessi, in Home
  const params = useLocalSearchParams<{ activate?: string; name?: string; voice?: string }>();
  const [step, setStep] = useState(0); // 0 = intro · 1..4 = permessi · 5 = riepilogo
  const [busy, setBusy] = useState(false);
  const [perms, setPerms] = useState<PermInfo[] | null>(null);
  const [vState, setVState] = useState<"loading" | "speaking" | "idle">("idle");
  const [vPaused, setVPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem(MUTE_KEY).then((v) => { const m = v === "1"; voice.muted = m; setMuted(m); }).catch(() => {});
    return () => voiceStop();
  }, []);
  const toggleMute = () => { const m = !muted; voice.muted = m; setMuted(m); AsyncStorage.setItem(MUTE_KEY, m ? "1" : "0").catch(() => {}); if (m) { voiceStop(); setVState("idle"); setVPaused(false); } else void speak(textForStep(step), setVState); };
  const pauseResume = () => { if (!voice.pauser) return; if (vPaused) { voice.pauser.resume?.(); setVPaused(false); } else { voice.pauser.pause?.(); setVPaused(true); } };
  const stopVoice = () => { voiceStop(); setVState("idle"); setVPaused(false); };
  const refresh = useCallback(async () => setPerms(await getDevicePermissions(true).catch(() => null)), []);
  useEffect(() => { void refresh(); }, [refresh]);

  const textForStep = (st: number) => (st === 0 ? VOICE_INTRO : st <= STEPS.length ? VOICE_STEP[STEPS[st - 1].key] : (grantedCountRef.current === STEPS.length ? "Perfetto: tutte le autorizzazioni sono attive. Da adesso chiedi, e io faccio." : "Alcune autorizzazioni mancano: farò quello che posso, il resto toccherà a te. Puoi completarle quando vuoi dalle Impostazioni."));
  const grantedCountRef = useRef(0);
  // parla a ogni cambio schermata (intro, ogni permesso, riepilogo)
  useEffect(() => { setVPaused(false); void speak(textForStep(step), setVState); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);
  const statusOf = (k: PermKey) => perms?.find((p) => p.key === k)?.status || "undetermined";
  const grantedCount = useMemo(() => (perms || []).filter((p) => p.status === "granted").length, [perms]);
  grantedCountRef.current = grantedCount;
  const total = STEPS.length;

  const markDone = useCallback(async () => { if (user?.user_id) await AsyncStorage.setItem(PERM_ONBOARDING_KEY(user.user_id), "1").catch(() => {}); }, [user?.user_id]);
  const goHome = useCallback(async () => {
    voiceStop();
    await markDone();
    router.replace("/(tabs)/home" as any);
    if (params.activate === "1" && params.name) setTimeout(() => { openAxonChat(); playActivationEffect({ name: String(params.name), voice: String(params.voice || ""), greet: true }); }, 700);
  }, [markDone, router, params.activate, params.name, params.voice]);

  const next = () => setStep((s) => Math.min(total + 1, s + 1));
  const allow = async (k: PermKey) => {
    setBusy(true);
    try { await ensureDevicePermission(k, { silent: true }); await refresh(); }
    finally { setBusy(false); }
    next();
  };

  // salta automaticamente i permessi già concessi
  useEffect(() => {
    if (step >= 1 && step <= total && perms && statusOf(STEPS[step - 1].key) === "granted") next();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, perms]);

  const Intro = (
    <View style={s.card} testID="perm-onb-intro">
      <View style={s.heroIcon}><Ionicons name="sparkles" size={34} color="#FFF" /></View>
      <Text style={s.h1}>Axon è la tua estensione</Text>
      <Text style={s.lead}>Non è una cosa in più da gestire: è il collega che lavora al posto tuo.{"\n"}<Text style={s.bold}>Tu chiedi, Axon fa.</Text> Ma devi permetterglielo.</Text>
      <View style={s.pointBox}>
        <View style={s.pointRow}><Ionicons name="lock-closed" size={18} color={HT.brand} /><Text style={s.point}><Text style={s.bold}>I tuoi dati restano privati.</Text> Posizione, voce, foto e rubrica non vengono condivisi con nessuno: li usa solo Axon, solo quando glielo chiedi tu.</Text></View>
        <View style={s.pointRow}><Ionicons name="flash" size={18} color={HT.brand} /><Text style={s.point}><Text style={s.bold}>Per avere Axon al 100% servono tutte e 4 le autorizzazioni.</Text> Senza, alcune cose dovrai farle a mano: cercare un cliente vicino, scrivere invece di dettare, inserire una bolletta a mano.</Text></View>
        <View style={s.pointRow}><Ionicons name="hand-right" size={18} color={HT.brand} /><Text style={s.point}>Ora te le chiediamo <Text style={s.bold}>una alla volta</Text>, spiegandoti cosa potrà fare Axon con ciascuna. Puoi cambiare idea quando vuoi dalle Impostazioni del telefono.</Text></View>
      </View>
      <Pressable onPress={next} style={s.primary} testID="perm-onb-start"><Text style={s.primaryTxt}>Iniziamo: dai ad Axon i consensi</Text><Ionicons name="arrow-forward" size={18} color="#FFF" /></Pressable>
      <Pressable onPress={goHome} style={s.ghost} testID="perm-onb-later"><Text style={s.ghostTxt}>Più tardi (Axon lavorerà a capacità ridotta)</Text></Pressable>
    </View>
  );

  const Step = (i: number) => {
    const st = STEPS[i - 1]; const meta = PERM_META[st.key]; const cur = statusOf(st.key);
    return (
      <View style={s.card} testID={`perm-onb-step-${st.key}`}>
        <Text style={s.counter}>Permesso {i} di {total}</Text>
        <View style={s.heroIcon}><Ionicons name={meta.icon as any} size={32} color="#FFF" /></View>
        <Text style={s.h1}>{st.title}</Text>
        <Text style={s.sub}>Con questo permesso Axon può:</Text>
        {st.axon.map((t, j) => (<View key={j} style={s.bullet}><Ionicons name="checkmark-circle" size={18} color="#16A34A" /><Text style={s.bulletTxt}>{t}</Text></View>))}
        <View style={s.privacyBox}><Ionicons name="lock-closed" size={15} color={HT.text2} /><Text style={s.privacyTxt}>{st.privacy}</Text></View>
        {cur === "blocked" ? (
          <>
            <Text style={s.blocked}>Il telefono ha bloccato questo permesso: si attiva solo dalle Impostazioni.</Text>
            <Pressable onPress={openSystemSettings} style={s.primary} testID="perm-onb-settings"><Ionicons name="settings" size={18} color="#FFF" /><Text style={s.primaryTxt}>Apri Impostazioni</Text></Pressable>
          </>
        ) : (
          <Pressable onPress={() => allow(st.key)} disabled={busy} style={[s.primary, busy && { opacity: 0.6 }]} testID="perm-onb-allow">
            {busy ? <ActivityIndicator color="#FFF" /> : <Ionicons name="shield-checkmark" size={18} color="#FFF" />}
            <Text style={s.primaryTxt}>Consenti «{st.title}»</Text>
          </Pressable>
        )}
        <Pressable onPress={next} style={s.ghost} testID="perm-onb-skip"><Text style={s.ghostTxt}>Salta per ora</Text></Pressable>
      </View>
    );
  };

  const Summary = (
    <View style={s.card} testID="perm-onb-summary">
      <View style={[s.heroIcon, grantedCount === total ? { backgroundColor: "#16A34A" } : { backgroundColor: "#F59E0B" }]}><Ionicons name={grantedCount === total ? "rocket" : "battery-half"} size={32} color="#FFF" /></View>
      <Text style={s.h1}>{grantedCount === total ? "Axon al 100%" : `Axon al ${Math.round((100 * grantedCount) / total)}%`}</Text>
      <Text style={s.lead}>{grantedCount === total ? "Tutte le autorizzazioni sono attive: chiedi, e Axon fa." : "Alcune autorizzazioni mancano: Axon farà quello che può, il resto toccherà a te. Puoi completarle quando vuoi."}</Text>
      {STEPS.map((st) => { const ok = statusOf(st.key) === "granted"; return (
        <View key={st.key} style={s.sumRow} testID={`perm-onb-sum-${st.key}`}>
          <Ionicons name={ok ? "checkmark-circle" : "close-circle"} size={20} color={ok ? "#16A34A" : "#DC2626"} />
          <Text style={s.sumTxt}>{st.title}</Text>
          <Text style={[s.sumSt, { color: ok ? "#16A34A" : "#DC2626" }]}>{ok ? "attivo" : "non attivo"}</Text>
        </View>); })}
      {grantedCount < total ? <Pressable onPress={openSystemSettings} style={[s.primary, { backgroundColor: "#F59E0B" }]} testID="perm-onb-open-settings"><Ionicons name="settings" size={18} color="#FFF" /><Text style={s.primaryTxt}>Completa dalle Impostazioni</Text></Pressable> : null}
      <Pressable onPress={goHome} style={grantedCount < total ? s.ghost : s.primary} testID="perm-onb-done"><Text style={grantedCount < total ? s.ghostTxt : s.primaryTxt}>Vai alla Home</Text></Pressable>
    </View>
  );

  return (
    <SafeAreaView style={s.root} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        {/* V50.z486 — barra voce di Axon: sempre visibile, pausa/riprendi · stop · muto */}
        <View style={s.voiceBar} testID="perm-onb-voicebar">
          <Ionicons name={muted ? "volume-mute" : vState === "speaking" && !vPaused ? "volume-high" : "volume-medium"} size={18} color={muted ? HT.muted : HT.brand} />
          <Text style={s.voiceTxt} numberOfLines={1}>{muted ? "Voce di Axon disattivata" : vState === "loading" ? "Axon sta per parlare…" : vState === "speaking" ? (vPaused ? "Voce in pausa" : "Axon sta parlando…") : "Voce di Axon attiva"}</Text>
          {!muted && vState === "speaking" ? (
            <>
              <Pressable onPress={pauseResume} hitSlop={8} style={s.voiceBtn} testID="perm-onb-voice-pause" accessibilityLabel={vPaused ? "Riprendi la voce" : "Metti in pausa la voce"}><Ionicons name={vPaused ? "play" : "pause"} size={16} color={HT.text} /></Pressable>
              <Pressable onPress={stopVoice} hitSlop={8} style={s.voiceBtn} testID="perm-onb-voice-stop" accessibilityLabel="Ferma la voce"><Ionicons name="stop" size={16} color={HT.text} /></Pressable>
            </>
          ) : null}
          <Pressable onPress={toggleMute} hitSlop={8} style={[s.voiceBtn, muted && { backgroundColor: "#FEE2E2" }]} testID="perm-onb-voice-mute" accessibilityLabel={muted ? "Riattiva la voce di Axon" : "Disattiva la voce di Axon"}><Ionicons name={muted ? "volume-mute" : "volume-high"} size={16} color={muted ? "#DC2626" : HT.text} /></Pressable>
        </View>
        <View style={s.progress}>{Array.from({ length: total + 2 }).map((_, i) => <View key={i} style={[s.dot, i <= step && s.dotOn]} />)}</View>
        {step === 0 ? Intro : step <= total ? Step(step) : Summary}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: HT.bg },
  scroll: { padding: 20, paddingBottom: 40, flexGrow: 1, justifyContent: "center", maxWidth: 560, width: "100%", alignSelf: "center" },
  voiceBar: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, marginBottom: 12 },
  voiceTxt: { flex: 1, fontSize: 12.5, fontWeight: "700", color: HT.text2 },
  voiceBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: HT.card2, borderWidth: 1, borderColor: HT.border },
  progress: { flexDirection: "row", gap: 6, justifyContent: "center", marginBottom: 14 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: HT.border },
  dotOn: { backgroundColor: HT.brand, width: 18 },
  card: { backgroundColor: HT.card, borderRadius: 20, padding: 20, gap: 12, borderWidth: 1, borderColor: HT.border },
  heroIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: HT.brand, alignItems: "center", justifyContent: "center", alignSelf: "center" },
  counter: { textAlign: "center", color: HT.muted, fontWeight: "700", fontSize: 12.5, textTransform: "uppercase", letterSpacing: 0.6 },
  h1: { fontSize: 24, fontWeight: "900", color: HT.text, textAlign: "center" },
  lead: { fontSize: 15.5, lineHeight: 23, color: HT.text2, textAlign: "center" },
  bold: { fontWeight: "900", color: HT.text },
  pointBox: { gap: 12, marginTop: 4 },
  pointRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  point: { flex: 1, fontSize: 14, lineHeight: 21, color: HT.text2 },
  sub: { fontSize: 14, fontWeight: "800", color: HT.text, marginTop: 2 },
  bullet: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  bulletTxt: { flex: 1, fontSize: 14, lineHeight: 21, color: HT.text },
  privacyBox: { flexDirection: "row", gap: 8, alignItems: "center", backgroundColor: HT.card2, borderRadius: 12, padding: 10 },
  privacyTxt: { flex: 1, fontSize: 12.5, lineHeight: 18, color: HT.text2 },
  blocked: { fontSize: 13, color: "#B45309", fontWeight: "700", textAlign: "center" },
  primary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 52, borderRadius: 14, backgroundColor: HT.brand, paddingHorizontal: 16, marginTop: 4 },
  primaryTxt: { color: "#FFF", fontWeight: "900", fontSize: 15.5 },
  ghost: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  ghostTxt: { color: HT.muted, fontWeight: "700", fontSize: 13.5 },
  sumRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HT.border },
  sumTxt: { flex: 1, fontSize: 15, fontWeight: "700", color: HT.text },
  sumSt: { fontSize: 13, fontWeight: "800" },
});

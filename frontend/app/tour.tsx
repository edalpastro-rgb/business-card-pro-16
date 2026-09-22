// tour.tsx — V50.z266 — Tour Guidato conversazionale (4 schermate, nessuna lista funzioni)
// 1 Benvenuto · 2 Prima conversazione con Axon (voce → /tour/profile → funzioni che «si accendono») ·
// 3 Anagrafica master obbligatoria (PUT /master/profile) → prima azione reale (biglietto da visita OCR o voce → POST /contacts) · 4 Chiusura → Home.
// Mostrato solo al primo accesso (user-settings.onboarding_done + cache locale); replay da Help / Master.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, Animated, ActivityIndicator, Platform, ScrollView, TextInput } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { notify } from "@/src/utils/notify";
import { VoiceDictationButton } from "@/src/VoiceDictationButton";
import { launchCameraUniversal } from "@/src/utils/imagePickerCompat";
import { uriToBase64DataUrl } from "@/src/utils/media";
import { playAudioBase64, AudioStopper } from "@/src/utils/audioPlayback";
import { InterestForm } from "@/src/TourInterestForm"; // V50.z284 — form spuntabile 20 domande Sì/No
import { IdentityDocsSection } from "@/src/IdentityDocsSection"; // V50.z267
import { ContactPreviewForm, flattenChannels, ExtractedContact } from "@/src/ContactPreviewForm"; // V50.z278
import { ManualCropEditor, CropResult } from "@/src/ManualCropEditor"; // V50.z278
import { AssistantSetupStep } from "@/src/activation/AssistantSetupStep"; // V50.z318 — step obbligatorio nome+voce
import { PromoCodeField } from "@/src/PromoCodeField"; // V50.z320 — codice promozionale opzionale
import { playActivationEffect } from "@/src/activation/events";
import { openAxonChat } from "@/src/axonProactive";

const NAVY = "#0B1B33"; const SKY = "#38BDF8"; const MUTED = "#94A3B8"; const WHITE = "#FFFFFF"; const AMBER = "#FBBF24";
const FEATURE_ICON: Record<string, any> = { bills: "document-text", compare: "git-compare", route: "car-sport", calendar: "calendar", deadlines: "alarm", notes: "mic", scanner: "scan", email: "mail", whatsapp: "logo-whatsapp", referrals: "share-social", contacts: "people", voice: "mic-circle", team: "people-circle", kpi: "stats-chart", chat: "chatbubbles", proactive: "notifications", km: "speedometer", visits: "location", map: "map", files: "folder", pdf: "document", offers: "pricetags", pun: "flash", courses: "school", courses_dashboard: "bar-chart", forms: "document-attach", iddocs: "id-card", axon_voice: "volume-high", offline: "airplane", crt: "document-text" };

// V50.z270 — Motore voce del tour: UNA sola voce alla volta.
// • generazione: ogni nuova frase invalida quelle precedenti (anche se il loro audio TTS arriva dopo → viene scartato/fermato)
// • prefetch: l'audio viene richiesto subito, ma la riproduzione parte solo dopo il countdown di lettura (se richiesto)
// • stop globale: cambio schermata / uscita dal tour / mute → silenzio immediato
const voice = {
  gen: 0, stop: (() => {}) as () => void, listeners: new Set<(remaining: number | null) => void>(),
  // V50.z284 — pausa/riprendi/stop della frase in corso (Stop = salta la frase ma il flusso prosegue)
  pauser: null as AudioStopper | null, paused: false, pausedListeners: new Set<(p: boolean) => void>(), finish: (() => {}) as () => void,
};
const setPausedState = (p: boolean) => { voice.paused = p; voice.pausedListeners.forEach((l) => l(p)); };
const voiceStop = () => { voice.gen += 1; try { voice.stop(); } catch {} voice.stop = () => {}; voice.pauser = null; setPausedState(false); voice.listeners.forEach((l) => l(null)); };
const voicePause = () => { if (voice.pauser?.pause) { voice.pauser.pause(); setPausedState(true); } };
const voiceResume = () => { if (voice.pauser?.resume) { voice.pauser.resume(); setPausedState(false); } };
/** Stop: ferma la voce della frase corrente e fa proseguire il flusso (come se avesse finito di parlare). */
const voiceSkip = () => { try { voice.finish(); } catch {} };
const tourMuted = { value: false }; // stato condiviso (aggiornato dal toggle in TourScreen)
const MUTE_KEY = "tour_voice_muted";

async function fetchTts(text: string): Promise<{ b64: string; mime: string } | null> {
  try { const r = await api<{ audio_base64: string; mime: string }>("/assistant/tts", { method: "POST", body: { text } }); return r?.audio_base64 ? { b64: r.audio_base64, mime: r.mime || "audio/mpeg" } : null; } catch { return null; }
}

/** Pronuncia `text`; `readSeconds` = countdown visibile prima della voce (tempo di lettura). onEnded è chiamato UNA volta, quando la voce finisce (o subito se muta/errore). */
async function speak(text: string, onEnded?: () => void, readSeconds = 0): Promise<void> {
  voiceStop();
  const myGen = voice.gen;
  const alive = () => voice.gen === myGen;
  let ended = false;
  const end = () => { if (ended || !alive()) return; ended = true; try { voice.stop(); } catch {} voice.stop = () => {}; voice.pauser = null; setPausedState(false); voice.listeners.forEach((l) => l(null)); onEnded?.(); };
  voice.finish = end;
  if (tourMuted.value) { const t = setTimeout(end, Math.max(1500, readSeconds * 1000)); voice.stop = () => clearTimeout(t); return; }
  const audioP = fetchTts(text);
  if (readSeconds > 0) {
    await new Promise<void>((resolve) => {
      let left = readSeconds; voice.listeners.forEach((l) => l(left));
      const iv = setInterval(() => { left -= 1; if (!alive()) { clearInterval(iv); resolve(); return; } voice.listeners.forEach((l) => l(left)); if (left <= 0) { clearInterval(iv); resolve(); } }, 1000);
      voice.stop = () => { clearInterval(iv); resolve(); };
    });
    if (!alive()) return;
  }
  const audio = await audioP;
  if (!alive()) return;
  voice.listeners.forEach((l) => l(0)); // 0 = "sto per parlare / sto parlando"
  if (!audio) { end(); return; }
  try {
    const stopper = await playAudioBase64(audio.b64, audio.mime, end);
    if (!alive()) { try { stopper(); } catch {} return; } // nel frattempo è arrivata un'altra frase o un cambio pagina
    voice.stop = stopper;
    voice.pauser = stopper;
  } catch { end(); }
}

/** Countdown/stato voce condiviso: null = silenzio, n>0 = secondi alla voce, 0 = Axon parla */
function useVoiceState() {
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => { voice.listeners.add(setRemaining); return () => { voice.listeners.delete(setRemaining); }; }, []);
  return remaining;
}
function useVoicePaused() {
  const [paused, setPaused] = useState(voice.paused);
  useEffect(() => { voice.pausedListeners.add(setPaused); return () => { voice.pausedListeners.delete(setPaused); }; }, []);
  return paused;
}

export default function TourScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const fade = useRef(new Animated.Value(1)).current;
  // V50.z266 — silenzia/riattiva la voce di Axon (persistito in cache locale + user-settings)
  const [muted, setMuted] = useState(false);
  const voiceState = useVoiceState();
  const voicePaused = useVoicePaused();
  const speaking = voiceState === 0 && !muted;
  // V50.z266 — schermata 3: finché l'anagrafica master non è completa il tour non si può saltare
  const [masterLocked, setMasterLocked] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem(MUTE_KEY).then((v) => { if (v === "1") { tourMuted.value = true; setMuted(true); } }).catch(() => {});
    api<{ tour_voice_muted?: boolean }>("/user-settings").then((s) => { const m = !!s?.tour_voice_muted; tourMuted.value = m; setMuted(m); AsyncStorage.setItem(MUTE_KEY, m ? "1" : "0").catch(() => {}); }).catch(() => {});
  }, []);
  const toggleMute = useCallback(() => {
    const m = !tourMuted.value; tourMuted.value = m; setMuted(m);
    if (m) voiceStop();
    AsyncStorage.setItem(MUTE_KEY, m ? "1" : "0").catch(() => {});
    api("/user-settings", { method: "PUT", body: { tour_voice_muted: m } }).catch(() => {});
  }, []);

  // Mostrato → marchia subito il device (se l'utente esce con back non ricompare a ogni apertura)
  useEffect(() => { if (user?.user_id) AsyncStorage.setItem(`onboarding_done_${user.user_id}`, "1").catch(() => {}); }, [user?.user_id]);
  // V50.z270 — la voce è un testo "performativo": se l'utente lascia la schermata (altra pagina, back, uscita) Axon si ferma subito
  useEffect(() => () => voiceStop(), []);
  useFocusEffect(useCallback(() => () => voiceStop(), []));

  const go = useCallback((n: 1 | 2 | 3 | 4) => {
    voiceStop();
    Animated.timing(fade, { toValue: 0, duration: 180, useNativeDriver: Platform.OS !== "web" }).start(() => {
      setStep(n);
      Animated.timing(fade, { toValue: 1, duration: 320, useNativeDriver: Platform.OS !== "web" }).start();
    });
  }, [fade]);

  // V50.z318 — Step 0 OBBLIGATORIO: nome + voce dell'assistente, se non ancora configurati nel profilo
  const [setup, setSetup] = useState<{ needed: boolean; name?: string; voice?: string } | null>(null);
  useEffect(() => {
    api<{ assistant_setup_done?: boolean; assistant_name?: string; assistant_voice?: string }>("/user-settings")
      .then((s) => setSetup({ needed: !s?.assistant_setup_done, name: s?.assistant_name, voice: s?.assistant_voice }))
      .catch(() => setSetup({ needed: false }));
  }, []);
  const activate = useCallback(async (name: string, voiceKey: string) => {
    voiceStop();
    await api("/user-settings", { method: "PUT", body: { assistant_name: name, assistant_voice: voiceKey, assistant_setup_done: true, activation_done: true, onboarding_done: true } }).catch(() => {});
    if (user?.user_id) await AsyncStorage.setItem(`onboarding_done_${user.user_id}`, "1").catch(() => {});
    router.replace("/(tabs)/home" as any);
    // apre la chat e lancia l'effetto (vibrazione doppia → onda 3 s → «Ciao, sono {nome}. Sono pronto.»)
    setTimeout(() => { openAxonChat(); playActivationEffect({ name, voice: voiceKey, greet: true }); }, 700);
  }, [router, user?.user_id]);
  // V50.z320 — dopo nome+voce: campo opzionale «Hai un codice promozionale?» (saltabile) → poi attivazione
  const [pendingSetup, setPendingSetup] = useState<{ name: string; voice: string } | null>(null);
  const onSetupDone = useCallback((name: string, voiceKey: string) => { voiceStop(); setPendingSetup({ name, voice: voiceKey }); }, []);
  const onPromoDone = useCallback(async () => { if (pendingSetup) await activate(pendingSetup.name, pendingSetup.voice); }, [pendingSetup, activate]);

  const finish = useCallback(async () => {
    voiceStop();
    if (user?.user_id) await AsyncStorage.setItem(`onboarding_done_${user.user_id}`, "1").catch(() => {});
    await AsyncStorage.setItem("libretto_seen_v1", "1").catch(() => {});
    api("/user-settings", { method: "PUT", body: { onboarding_done: true } }).catch(() => {});
    router.replace("/(tabs)/home" as any);
  }, [router, user?.user_id]);

  const say = useCallback((text: string, onEnded?: () => void, readSeconds = 0) => speak(text, onEnded, readSeconds), []);

  // V50.z265 — Ricomincia dal principio: torna alla schermata 1 e azzera lo stato interno delle schermate 2/3 (key)
  const [tourRun, setTourRun] = useState(0);
  const restart = useCallback(() => { setTourRun((n) => n + 1); go(1); }, [go]);

  return (
    <View style={[styles.root, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]} testID="tour-root">
      {/* progress */}
      <View style={styles.dots} testID={`tour-step-${step}`}>{[1, 2, 3, 4].map((i) => <View key={i} style={[styles.dot, i === step && styles.dotOn, i < step && styles.dotDone]} />)}</View>
      {/* V50.z270 — stato voce (countdown di lettura / Axon parla) centrato sotto i punti, per non coprire header e status bar */}
      <View style={styles.voiceRow}>
        {voiceState !== null && voiceState > 0 ? <View style={styles.countdown} testID="tour-voice-countdown"><Ionicons name="time-outline" size={13} color={SKY} /><Text style={styles.countdownTxt}>Axon parla tra {voiceState}s</Text></View> : null}
        {speaking ? <View style={styles.countdown} testID="tour-voice-speaking"><Ionicons name={voicePaused ? "pause" : "volume-high"} size={13} color={SKY} /><Text style={styles.countdownTxt}>{voicePaused ? "Axon in pausa" : "Axon parla…"}</Text></View> : null}
      </View>
      {/* V50.z284 — header: Pausa/Riprendi · Stop (mentre Axon parla) · Silenzia (pill ben visibile) · Salta */}
      <View style={[styles.topRight, { top: insets.top + 2 }]}>
        {speaking ? (
          <>
            <Pressable onPress={voicePaused ? voiceResume : voicePause} hitSlop={6} style={styles.ctrlBtn} testID="tour-voice-pause" accessibilityLabel={voicePaused ? "Riprendi la voce di Axon" : "Metti in pausa la voce di Axon"}>
              <Ionicons name={voicePaused ? "play" : "pause"} size={18} color={SKY} />
            </Pressable>
            <Pressable onPress={voiceSkip} hitSlop={6} style={styles.ctrlBtn} testID="tour-voice-stop" accessibilityLabel="Ferma la voce di Axon">
              <Ionicons name="stop" size={18} color={SKY} />
            </Pressable>
          </>
        ) : null}
        <Pressable onPress={toggleMute} hitSlop={6} style={[styles.muteBtn, muted && styles.muteBtnOn]} testID="tour-mute" accessibilityLabel={muted ? "Riattiva la voce di Axon" : "Silenzia la voce di Axon"}>
          <Ionicons name={muted ? "volume-mute" : "volume-high"} size={18} color={muted ? NAVY : SKY} />
          <Text style={[styles.muteTxt, muted && { color: NAVY }]}>{muted ? "Riattiva" : "Silenzia"}</Text>
        </Pressable>
        {!(step === 3 && masterLocked) && !setup?.needed ? <Pressable onPress={finish} hitSlop={10} style={styles.skip} testID="tour-skip"><Text style={styles.skipTxt}>Salta</Text></Pressable> : null}
      </View>
      {setup === null ? null : setup.needed ? (
        pendingSetup ? (
          <ScrollView contentContainerStyle={styles.promoStep} keyboardShouldPersistTaps="handled" testID="promo-step">
            <View style={styles.promoOrb}><Ionicons name="gift" size={32} color="#FFFFFF" /></View>
            <Text style={styles.promoTitle}>Quasi pronto, {pendingSetup.name} ti aspetta</Text>
            <PromoCodeField onDone={onPromoDone} />
          </ScrollView>
        ) : (
        <AssistantSetupStep initialName={setup.name} initialVoice={setup.voice} onDone={onSetupDone} />
        )
      ) : (
      <Animated.View style={{ flex: 1, opacity: fade }}>
        {step === 1 && <Welcome onNext={() => go(2)} onFeatures={() => router.push("/tour-features" as any)} />}
        {step === 2 && <TalkToAxon key={tourRun} say={say} onNext={() => go(3)} onVoiceSettings={() => { voiceStop(); router.push("/axon-voice" as any); }} />}
        {step === 3 && <MasterThenFirstContact key={tourRun} say={say} onNext={() => go(4)} onLockChange={setMasterLocked} />}
        {step === 4 && <Closing onFinish={finish} onFeatures={() => router.push("/tour-features" as any)} />}
      </Animated.View>
      )}
      {/* V50.z265 — «Ricomincia dal principio»: su ogni schermata, riporta alla 1 (e riavvia lo stato delle schermate 2/3) */}
      <Pressable onPress={restart} hitSlop={8} style={styles.restart} testID="tour-restart">
        <Ionicons name="refresh" size={13} color={MUTED} /><Text style={styles.restartTxt}>Ricomincia dal principio</Text>
      </Pressable>
    </View>
  );
}

function AxonOrb({ busy }: { busy?: boolean }) {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([Animated.timing(pulse, { toValue: 1.12, duration: 900, useNativeDriver: Platform.OS !== "web" }), Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: Platform.OS !== "web" })]));
    loop.start(); return () => loop.stop();
  }, [pulse]);
  return (
    <Animated.View style={[styles.orb, { transform: [{ scale: pulse }] }]}>
      {busy ? <ActivityIndicator color={WHITE} /> : <Ionicons name="sparkles" size={30} color={WHITE} />}
    </Animated.View>
  );
}

// ---------- 1 · Benvenuto ----------
function Welcome({ onNext, onFeatures }: { onNext: () => void; onFeatures: () => void }) {
  return (
    <View style={styles.screen}>
      <View style={{ flex: 1, justifyContent: "center", gap: 18 }}>
        <AxonOrb />
        <Text style={styles.h1}>Benvenuto in AdvisorOS.</Text>
        <Text style={styles.h2}>Il primo CRM che si adatta a te.</Text>
        <Text style={styles.p}>Non imparerai un software.{"\n"}Parlerai con Axon.</Text>
      </View>
      <Pressable onPress={onNext} style={styles.cta} testID="tour-start"><Text style={styles.ctaTxt}>Inizia</Text><Ionicons name="arrow-forward" size={18} color={NAVY} /></Pressable>
      <Pressable onPress={onFeatures} style={styles.link} testID="tour-features-link"><Text style={styles.linkTxt}>Scopri tutte le funzioni</Text></Pressable>
    </View>
  );
}

// ---------- 2 · Primo avvio in 3 domande (tap) ----------
// V50.z308 — prima erano 3 domande aperte a voce («raccontami tutto») + form da 20: troppo per il primo giorno.
// Ora: intro breve → 3 domande a scelta rapida (ruolo · cosa vendi · quanti clienti) → Home già configurata.
// Il form completo (20 domande Sì/No, round illimitati) resta opzionale («Profilo completo»). Nessun suggerimento «durante l'uso».
const INTRO = "Ciao, sono Axon, il tuo assistente. Tre domande veloci e preparo AdvisorOS su misura per te.";
type QuickQ = { id: "role" | "sells" | "clients"; text: string; multi?: boolean; options: { id: string; label: string; icon: keyof typeof Ionicons.glyphMap }[] };
const QUICK_QUESTIONS: QuickQ[] = [
  { id: "role", text: "Che ruolo hai?", options: [{ id: "master", label: "Titolare / Master", icon: "ribbon" }, { id: "consulente", label: "Consulente / Agente", icon: "briefcase" }, { id: "backoffice", label: "Back office", icon: "desktop" }] },
  { id: "sells", text: "Cosa vendi principalmente?", multi: true, options: [{ id: "luce_gas", label: "Luce e gas", icon: "flash" }, { id: "telefonia", label: "Telefonia / Internet", icon: "wifi" }, { id: "fotovoltaico", label: "Fotovoltaico / Efficienza", icon: "sunny" }, { id: "altro", label: "Altro", icon: "ellipsis-horizontal" }] },
  { id: "clients", text: "Quanti clienti gestisci?", options: [{ id: "lt50", label: "Sto iniziando (meno di 50)", icon: "leaf" }, { id: "50_300", label: "Tra 50 e 300", icon: "people" }, { id: "gt300", label: "Più di 300", icon: "business" }] },
];
function TalkToAxon({ say, onNext, onVoiceSettings }: { say: (t: string, onEnded?: () => void, readSeconds?: number) => Promise<void>; onNext: () => void; onVoiceSettings: () => void }) {
  const [phase, setPhase] = useState<"intro" | "questions">("intro");
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<string | null>(null);
  const [features, setFeatures] = useState<{ id: string; name: string }[]>([]);
  const [lit, setLit] = useState(0);
  const [formMode, setFormMode] = useState(false); // profilo completo (20 domande) — opzionale
  const qIdx = QUICK_QUESTIONS.findIndex((q) => !(picked[q.id] || []).length); // -1 = tutte risposte
  const scrollRef = useRef<ScrollView>(null);
  const voiceState = useVoiceState();
  const reading = (p: "intro" | "questions") => phase === p && voiceState === 0;

  useEffect(() => {
    let done = false;
    if (phase === "intro") void say(INTRO, () => { if (!done) { done = true; setPhase("questions"); } }, 2);
    return () => { done = true; };
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (phase === "questions" && qIdx >= 0 && !formMode) void say(QUICK_QUESTIONS[qIdx].text); }, [qIdx, say, phase, formMode]);
  useEffect(() => {
    if (!features.length) return;
    setLit(0);
    const ivs = features.map((_, i) => setTimeout(() => { setLit(i + 1); scrollRef.current?.scrollToEnd({ animated: true }); }, 500 + i * 650));
    return () => ivs.forEach(clearTimeout);
  }, [features]);
  useEffect(() => { if (reply !== null) setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80); }, [reply]);

  const finishQuick = async (p: Record<string, string[]>) => {
    setBusy(true);
    try {
      const r = await api<{ features: { id: string; name: string }[]; reply: string }>("/tour/quick-start", { method: "POST", body: { role: p.role?.[0], sells: p.sells || [], clients: p.clients?.[0] } });
      setReply(r.reply || ""); setFeatures(r.features || []);
      void say(`Ho capito. Ecco cosa attivo per te. ${r.reply || ""}`);
    } catch (e: any) { notify("Axon", e?.message || "Riprova"); setPicked({}); } finally { setBusy(false); }
  };
  const choose = (q: QuickQ, optId: string) => {
    if (busy) return;
    const cur = picked[q.id] || [];
    if (q.multi) { setPicked({ ...picked, [q.id]: cur.includes(optId) ? cur.filter((x) => x !== optId) : [...cur, optId] }); return; }
    const next = { ...picked, [q.id]: [optId] };
    setPicked(next);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    if (QUICK_QUESTIONS.every((qq) => (next[qq.id] || []).length)) void finishQuick(next);
  };
  const confirmMulti = (q: QuickQ) => {
    if (!(picked[q.id] || []).length) return;
    const next = { ...picked, [q.id]: [...picked[q.id], "__ok"] };
    setPicked(next);
    if (QUICK_QUESTIONS.every((qq) => (next[qq.id] || []).length)) void finishQuick(next);
  };
  const onFormDone = (r: { features: { id: string; name: string }[]; reply: string }) => {
    setFormMode(false); setReply(r.reply || ""); setFeatures(r.features || []);
    void say(`Ho capito. Ecco cosa attivo per te. ${r.reply || ""}`);
  };

  if (formMode) {
    return (
      <View style={styles.screen}>
        <ScrollView ref={scrollRef} contentContainerStyle={{ gap: 12, paddingBottom: 16 }} keyboardShouldPersistTaps="handled">
          <AxonOrb />
          <InterestForm freeAnswers={[]} onDone={onFormDone} onBack={() => setFormMode(false)} />
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView ref={scrollRef} contentContainerStyle={{ flexGrow: 1, justifyContent: "center", gap: 12 }} keyboardShouldPersistTaps="handled">
        <AxonOrb busy={busy} />
        <View style={[styles.bubble, reading("intro") && styles.bubbleReading]} testID="tour-intro"><Text style={styles.bubbleTxt}>{INTRO}</Text></View>
        <Pressable onPress={onVoiceSettings} hitSlop={6} style={styles.voiceLink} testID="tour-voice-settings-link">
          <Ionicons name="options-outline" size={14} color={SKY} />
          <Text style={styles.voiceLinkTxt}>Vuoi cambiare la mia voce o la lingua? <Text style={{ textDecorationLine: "underline" }}>Tocca qui</Text></Text>
        </Pressable>
        {phase === "questions" ? QUICK_QUESTIONS.map((q, i) => {
          const answered = (picked[q.id] || []).filter((x) => x !== "__ok");
          const done = q.multi ? (picked[q.id] || []).includes("__ok") : answered.length > 0;
          if (i > qIdx && qIdx >= 0 && !done) return null;
          return (
            <React.Fragment key={q.id}>
              <View style={[styles.bubble, reading("questions") && i === qIdx && styles.bubbleReading]} testID={`tour-q-${i + 1}`}><Text style={styles.bubbleTxt}>{q.text}</Text>{q.multi && !done ? <Text style={[styles.bubbleTxt, { color: MUTED, fontSize: 13, marginTop: 4 }]}>Puoi sceglierne più di uno.</Text> : null}</View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }} testID={`tour-opts-${q.id}`}>
                {q.options.filter((o) => !done || answered.includes(o.id)).map((o) => { const on = answered.includes(o.id); return (
                  <Pressable key={o.id} onPress={() => !done && choose(q, o.id)} disabled={done} style={[styles.quickOpt, on && styles.quickOptOn]} testID={`tour-opt-${q.id}-${o.id}`}>
                    <Ionicons name={o.icon} size={16} color={on ? NAVY : SKY} /><Text style={[styles.quickOptTxt, on && { color: NAVY }]}>{o.label}</Text>
                  </Pressable>); })}
                {q.multi && !done && answered.length ? <Pressable onPress={() => confirmMulti(q)} style={[styles.quickOpt, styles.quickOptOn]} testID={`tour-opt-${q.id}-ok`}><Ionicons name="checkmark" size={16} color={NAVY} /><Text style={[styles.quickOptTxt, { color: NAVY }]}>Avanti</Text></Pressable> : null}
              </View>
            </React.Fragment>
          );
        }) : (
          <Pressable onPress={() => setPhase("questions")} style={{ alignSelf: "center" }} testID="tour-intro-skip"><Text style={styles.linkTxt}>Vai alle domande</Text></Pressable>
        )}
        {reply !== null ? (
          <>
            <View style={styles.bubble} testID="tour-reply"><Text style={styles.bubbleTxt}>Ho capito. Ecco cosa attivo per te.</Text>{reply ? <Text style={[styles.bubbleTxt, { color: MUTED, marginTop: 6, fontSize: 14 }]}>{reply}</Text> : null}</View>
            <View style={{ gap: 8 }} testID="tour-features-lit">
              {features.map((f, i) => {
                const on = i < lit;
                return (
                  <View key={f.id} style={[styles.feat, on && styles.featOn]} testID={`tour-feat-${f.id}`}>
                    <View style={[styles.featIcon, on && { backgroundColor: SKY }]}><Ionicons name={FEATURE_ICON[f.id] || "checkmark"} size={18} color={on ? NAVY : MUTED} /></View>
                    <Text style={[styles.featTxt, on && { color: WHITE }]}>{f.name}</Text>
                    {on ? <Ionicons name="checkmark-circle" size={18} color={SKY} /> : null}
                  </View>
                );
              })}
            </View>
            <Pressable onPress={() => { voiceStop(); setFormMode(true); }} style={styles.formBtn} testID="tour-form-toggle">
              <Ionicons name="checkbox-outline" size={20} color={SKY} />
              <View style={{ flex: 1 }}><Text style={styles.formBtnTxt}>Profilo completo (opzionale)</Text><Text style={styles.choiceSub}>20 domande Sì/No con note: Axon si adatta ancora meglio. Puoi farlo anche dopo da Impostazioni → Tour.</Text></View>
              <Ionicons name="chevron-forward" size={18} color={MUTED} />
            </Pressable>
          </>
        ) : busy ? <Text style={[styles.p, { fontSize: 14 }]}>Axon sta preparando la tua Home…</Text> : null}
      </ScrollView>
      {features.length > 0 && lit >= features.length ? (
        <Pressable onPress={onNext} style={styles.cta} testID="tour-next-2"><Text style={styles.ctaTxt}>Continua</Text><Ionicons name="arrow-forward" size={18} color={NAVY} /></Pressable>
      ) : <Pressable onPress={onNext} style={styles.link} testID="tour-skip-2"><Text style={styles.linkTxt}>Salta le domande</Text></Pressable>}
    </View>
  );
}

// ---------- 3 · Anagrafica master (obbligatoria) → prima azione reale ----------
// V50.z266 — la schermata parte dall'anagrafica del titolare/collaboratore: senza di essa non si prosegue.
const Q3_MASTER = "Prima di tutto, configuriamo la tua anagrafica. È il punto di partenza di tutto — senza di essa non si può procedere. Poi passeremo al tuo primo cliente.";
const Q3_MASTER_DONE = "Perfetto, la tua anagrafica è pronta. Ora aggiungiamo il tuo primo cliente.";
type MasterForm = { first_name: string; last_name: string; phone: string; primary_email: string; tax_id: string };
const MASTER_REQUIRED: [keyof MasterForm, string][] = [["first_name", "Nome"], ["last_name", "Cognome"], ["phone", "Telefono"], ["primary_email", "Email"]];
const masterComplete = (p: Partial<MasterForm> | null | undefined) => !!p && MASTER_REQUIRED.every(([k]) => String(p[k] || "").trim().length > 0);

function MasterThenFirstContact({ say, onNext, onLockChange }: { say: (t: string) => Promise<void>; onNext: () => void; onLockChange: (locked: boolean) => void }) {
  const { user } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<MasterForm>({ first_name: "", last_name: "", phone: "", primary_email: "", tax_id: "" });
  const [existingEmails, setExistingEmails] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { onLockChange(!saved); return () => onLockChange(false); }, [saved, onLockChange]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const p = await api<any>("/master/profile");
        if (!alive) return;
        const nm = String(user?.name || "").trim().split(/\s+/);
        const f: MasterForm = {
          first_name: p?.first_name || nm[0] || "", last_name: p?.last_name || nm.slice(1).join(" ") || "",
          phone: p?.phone || "", primary_email: p?.primary_email || (Array.isArray(p?.emails) && p.emails[0]) || user?.email || "", tax_id: p?.tax_id || "",
        };
        setForm(f); setExistingEmails(Array.isArray(p?.emails) ? p.emails : []);
        const done = masterComplete(p);
        setSaved(done); setEditing(!done);
        void say(done ? Q3_MASTER_DONE : Q3_MASTER);
      } catch { void say(Q3_MASTER); } finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const missing = MASTER_REQUIRED.filter(([k]) => !form[k].trim()).map(([, l]) => l);
  const [docCount, setDocCount] = useState(0);
  const [ocrExtra, setOcrExtra] = useState<Record<string, string>>({});
  const saveMaster = async () => {
    if (missing.length) { setError(`Campi obbligatori mancanti: ${missing.join(", ")}`); return; }
    if (docCount < 1) { setError("Fotografa e salva almeno un documento di riconoscimento"); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.primary_email.trim())) { setError("Inserisci un'email valida"); return; }
    setError(null); setSaving(true);
    try {
      const email = form.primary_email.trim().toLowerCase();
      const emails = Array.from(new Set([email, ...existingEmails.map((e) => String(e).toLowerCase())])).slice(0, 5);
      await api("/master/profile", { method: "PUT", body: { ...ocrExtra, first_name: form.first_name.trim(), last_name: form.last_name.trim(), phone: form.phone.trim(), primary_email: email, emails, tax_id: form.tax_id.trim().toUpperCase() } });
      setSaved(true); setEditing(false);
      void say(Q3_MASTER_DONE);
    } catch (e: any) { notify("Anagrafica", e?.message || "Salvataggio non riuscito"); } finally { setSaving(false); }
  };

  if (saved && !editing) return <FirstContact say={say} onNext={onNext} intro={Q3_MASTER_DONE} masterName={`${form.first_name} ${form.last_name}`.trim()} onEditMaster={() => setEditing(true)} />;

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", gap: 14 }} keyboardShouldPersistTaps="handled">
        <AxonOrb busy={loading || saving} />
        <View style={styles.bubble} testID="tour-master-intro"><Text style={styles.bubbleTxt}>{Q3_MASTER}</Text></View>
        <View style={styles.mandatory} testID="tour-master-mandatory">
          <Ionicons name="lock-closed" size={14} color={AMBER} />
          <Text style={styles.mandatoryTxt}>Anagrafica {user?.role === "owner" ? "master" : "collaboratore"} obbligatoria: senza di essa non si prosegue.</Text>
        </View>
        {loading ? <ActivityIndicator color={SKY} /> : (
          <View style={styles.card} testID="tour-master-form">
            {/* V50.z267 — foto documento (CI/patente/passaporto/CF): Axon legge e precompila; almeno un documento è richiesto */}
            <IdentityDocsSection dark subjectType="user" title="Fotografa il tuo documento (fronte e retro)" onDocsChange={(d) => setDocCount(d.length)}
              onExtracted={(d) => { setOcrExtra((o) => ({ ...o, ...(d.birth_date ? { birth_date: d.birth_date } : {}), ...(d.address ? { address: [d.address, d.city].filter(Boolean).join(", ") } : {}) })); setForm((f) => ({
                first_name: f.first_name || d.first_name || "", last_name: f.last_name || d.last_name || "", phone: f.phone, primary_email: f.primary_email,
                tax_id: f.tax_id || d.tax_id || "",
              })); }} />
            <Text style={[styles.p, { fontSize: 12, textAlign: "left" }]}>{docCount > 0 ? `✅ ${docCount} documento/i salvato/i` : "Serve almeno un documento (carta d'identità, patente, passaporto o tessera sanitaria). Axon legge i dati e compila i campi qui sotto."}</Text>
            {MASTER_REQUIRED.map(([k, l]) => (
              <View key={k} style={styles.fieldRow}>
                <Text style={styles.fieldLbl}>{l} <Text style={{ color: AMBER }}>*</Text></Text>
                <TextInput value={form[k]} onChangeText={(v) => setForm((f) => ({ ...f, [k]: v }))} style={[styles.fieldVal, !form[k].trim() && error ? { borderWidth: 1, borderColor: AMBER } : null]} placeholder={l} placeholderTextColor={MUTED}
                  keyboardType={k === "phone" ? "phone-pad" : k === "primary_email" ? "email-address" : "default"} autoCapitalize={k === "primary_email" ? "none" : "words"} testID={`tour-master-${k}`} />
              </View>
            ))}
            <View style={styles.fieldRow}>
              <Text style={styles.fieldLbl}>Cod. fiscale</Text>
              <TextInput value={form.tax_id} onChangeText={(v) => setForm((f) => ({ ...f, tax_id: v }))} style={styles.fieldVal} placeholder="Facoltativo" placeholderTextColor={MUTED} autoCapitalize="characters" testID="tour-master-tax_id" />
            </View>
            {error ? <Text style={styles.errTxt} testID="tour-master-error">{error}</Text> : null}
            <Pressable onPress={saveMaster} disabled={saving} style={[styles.cta, saving && { opacity: 0.6 }]} testID="tour-master-save"><Text style={styles.ctaTxt}>{saving ? "Salvo…" : "Salva la mia anagrafica"}</Text><Ionicons name="checkmark" size={18} color={NAVY} /></Pressable>
            <Pressable onPress={() => router.push("/anagrafica-master" as any)} style={{ alignSelf: "center", minHeight: 40, justifyContent: "center" }} testID="tour-master-full"><Text style={styles.linkTxt}>Anagrafica completa (indirizzo, IBAN, P.IVA…) ›</Text></Pressable>
          </View>
        )}
      </ScrollView>
      {saved ? <Pressable onPress={() => setEditing(false)} style={styles.link} testID="tour-master-back"><Text style={styles.linkTxt}>Torna al primo cliente</Text></Pressable> : null}
    </View>
  );
}

// ---------- 3b · Prima azione reale (sbloccata dopo l'anagrafica master) ----------
const Q3 = "Aggiungiamo il tuo primo cliente. Hai un biglietto da visita o preferisci dirmelo a voce?";
function FirstContact({ say, onNext, intro, masterName, onEditMaster }: { say: (t: string) => Promise<void>; onNext: () => void; intro?: string; masterName?: string; onEditMaster?: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<ExtractedContact | null>(null);
  const [created, setCreated] = useState<{ id: string; name: string } | null>(null);
  const [typed, setTyped] = useState(false);
  const [text, setText] = useState("");
  // V50.z278 — biglietto: foto originale → ritaglio contorni (angoli pre-rilevati) → OCR adattivo; l'immagine ritagliata viene salvata in scheda
  const [rawShot, setRawShot] = useState<string | null>(null);
  const [cropCorners, setCropCorners] = useState<{ x: number; y: number }[] | undefined>(undefined);
  const [cardImage, setCardImage] = useState<string | null>(null);
  // V50.z280 — retro del biglietto (lato B: servizi, orari, social)
  const [cardBack, setCardBack] = useState<string | null>(null);
  const [side, setSide] = useState<"front" | "back">("front");
  const [askBack, setAskBack] = useState(false);
  const router = useRouter();
  useEffect(() => { if (!intro) void say(Q3); }, [say, intro]);

  const fromCard = async (which: "front" | "back" = "front") => {
    setSide(which);
    try {
      const res = await launchCameraUniversal({ quality: 0.7, base64: Platform.OS !== "web" });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      const dataUrl = a.uri?.startsWith("data:") ? a.uri : a.base64 ? `data:${a.mimeType || "image/jpeg"};base64,${a.base64}` : await uriToBase64DataUrl(a.uri!, a.mimeType || "image/jpeg");
      setBusy("Cerco i contorni del biglietto…");
      try {
        const d = await api<{ detected: boolean; corners: number[][] | null }>("/scanner/detect-corners", { method: "POST", body: { data_base64: dataUrl.split(",")[1] || dataUrl, mime: a.mimeType || "image/jpeg" } });
        // accetta gli angoli rilevati solo se plausibili per un biglietto (area 8-90%, proporzioni ~1.2-2.2 in una delle due direzioni)
        const cs = d.detected && d.corners?.length === 4 ? d.corners.map(([x, y]) => ({ x, y })) : null;
        let ok = false;
        if (cs) {
          const w = (Math.hypot(cs[1].x - cs[0].x, cs[1].y - cs[0].y) + Math.hypot(cs[2].x - cs[3].x, cs[2].y - cs[3].y)) / 2;
          const hh = (Math.hypot(cs[3].x - cs[0].x, cs[3].y - cs[0].y) + Math.hypot(cs[2].x - cs[1].x, cs[2].y - cs[1].y)) / 2;
          const iw = a.width || 4, ih = a.height || 3; const ratio = (w * iw) / Math.max(1e-6, hh * ih); const area = w * hh;
          ok = area > 0.08 && area < 0.9 && ((ratio > 1.2 && ratio < 2.2) || (ratio > 0.45 && ratio < 0.85));
        }
        setCropCorners(ok && cs ? cs : undefined);
      } catch { setCropCorners(undefined); }
      setRawShot(dataUrl); // apre l'editor di ritaglio
    } catch (e: any) { notify("Biglietto", e?.message || "Impossibile acquisire il biglietto"); } finally { setBusy(null); }
  };
  const readCard = async (front: string, back: string | null) => {
    setBusy(back ? "Leggo fronte e retro…" : "Leggo il biglietto…");
    try { const res = await api<{ contact: ExtractedContact }>("/ai/contact-from-card", { method: "POST", body: { image_base64: front, back_image_base64: back || undefined } }); setPreview(res.contact || {}); }
    catch (e: any) { notify("Biglietto", e?.message || "Impossibile leggere il biglietto"); } finally { setBusy(null); }
  };
  const onCropped = async (r: CropResult) => {
    setRawShot(null);
    const cropped = `data:${r.mime || "image/jpeg"};base64,${r.data_base64}`;
    if (side === "back") {
      setCardBack(cropped); setAskBack(false);
      if (!preview && cardImage) await readCard(cardImage, cropped);   // prima lettura con entrambi i lati
      else if (preview && cardImage) await readCard(cardImage, cropped); // retro aggiunto dopo: rilegge unendo i dati
      return;
    }
    setCardImage(cropped);
    if (preview) return; // ri-ritaglio del fronte: aggiorna solo l'immagine
    setAskBack(true);    // chiedi se fotografare anche il retro prima di leggere
  };
  const fromText = async (t: string) => {
    if (!t.trim()) return;
    setBusy("Ascolto…");
    try { const r = await api<{ contact: ExtractedContact }>("/tour/contact-from-text", { method: "POST", body: { text: t } }); setPreview(r.contact || {}); }
    catch (e: any) { notify("Axon", e?.message || "Non ho capito, riprova"); } finally { setBusy(null); }
  };
  const save = async () => {
    if (!preview) return;
    setBusy("Salvo in anagrafica…");
    try {
      const flat = flattenChannels(preview);
      const body: any = { ...flat, first_name: flat.first_name || flat.company || "Nuovo", last_name: flat.last_name || "" };
      if (body.note_ai) { body.notes = body.note_ai; delete body.note_ai; }
      if (body.notes) { body.general_note = body.notes; delete body.notes; }
      if (cardImage) body.business_card = { data_base64: cardImage.split(",")[1] || cardImage, back_data_base64: cardBack ? cardBack.split(",")[1] || cardBack : undefined, mime: "image/jpeg", created_at: new Date().toISOString() };
      const c = await api<any>("/contacts", { method: "POST", body });
      const name = `${c.first_name || ""} ${c.last_name || ""}`.trim() || c.company || "Cliente";
      setCreated({ id: c.contact_id, name }); void say(`Fatto. ${name} è in anagrafica${cardImage ? " con il biglietto da visita" : ""}.`);
    } catch (e: any) { notify("Anagrafica", e?.message || "Salvataggio non riuscito"); } finally { setBusy(null); }
  };
  const patch = (p: Partial<ExtractedContact>) => setPreview((prev) => ({ ...(prev || {}), ...p }));

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", gap: 16 }} keyboardShouldPersistTaps="handled">
        <AxonOrb busy={!!busy} />
        {masterName ? (
          <View style={[styles.bubble, { borderColor: "rgba(56,189,248,0.5)" }]} testID="tour-master-done">
            <Text style={styles.bubbleTxt}>✅ Anagrafica di <Text style={{ fontWeight: "900" }}>{masterName}</Text> configurata.</Text>
            {onEditMaster ? <Pressable onPress={onEditMaster} hitSlop={6} testID="tour-master-edit"><Text style={[styles.linkTxt, { marginTop: 6 }]}>Modifica ›</Text></Pressable> : null}
          </View>
        ) : null}
        <View style={styles.bubble}><Text style={styles.bubbleTxt}>{Q3}</Text></View>
        {busy ? <Text style={[styles.p, { fontSize: 14 }]}>{busy}</Text> : null}
        {created ? (
          <View style={[styles.bubble, { borderColor: SKY }]} testID="tour-contact-created">
            <Text style={styles.bubbleTxt}>✅ Fatto: <Text style={{ fontWeight: "900" }}>{created.name}</Text> è in anagrafica.</Text>
            <Pressable onPress={() => router.push(`/contact/${created.id}` as any)} testID="tour-open-contact"><Text style={[styles.linkTxt, { marginTop: 8 }]}>Apri la scheda ›</Text></Pressable>
          </View>
        ) : preview ? (
          <View style={styles.card} testID="tour-contact-preview">
            <Text style={[styles.p, { fontSize: 13, textAlign: "left" }]}>Controlla i dati: tocca ★ per indicare telefono ed email principali e scegli come preferisce essere contattato.</Text>
            <ContactPreviewForm value={preview} onChange={patch} dark cardImage={cardImage} cardBack={cardBack} onRecrop={cardImage ? () => { setSide("front"); setRawShot(cardImage); } : undefined} onAddBack={cardImage && !cardBack ? () => void fromCard("back") : undefined} />
            <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
              <Pressable onPress={() => { setPreview(null); setCardImage(null); setCardBack(null); }} style={[styles.choice, { flex: 1 }]} testID="tour-contact-retry"><Text style={styles.choiceTxt}>Riprova</Text></Pressable>
              <Pressable onPress={save} disabled={!!busy} style={[styles.cta, { flex: 2, marginTop: 0 }]} testID="tour-contact-save"><Text style={styles.ctaTxt}>Salva in anagrafica</Text></Pressable>
            </View>
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            <Pressable onPress={() => void fromCard("front")} disabled={!!busy} style={styles.choice} testID="tour-choice-card"><Ionicons name="scan" size={22} color={SKY} /><View style={{ flex: 1 }}><Text style={styles.choiceTxt}>Scansiona il biglietto da visita</Text><Text style={styles.choiceSub}>Fotografalo e ritaglialo: leggo tutti i numeri, email, P.IVA e referenti</Text></View></Pressable>
            <View style={[styles.choice, { flexDirection: "column", alignItems: "stretch", gap: 10 }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}><Ionicons name="mic" size={22} color={SKY} /><View style={{ flex: 1 }}><Text style={styles.choiceTxt}>Dimmelo a voce</Text><Text style={styles.choiceSub}>«Mario Rossi, elettricista di Treviso, 333 1234567»</Text></View></View>
              <View style={styles.micWrap}><VoiceDictationButton label="Detta il cliente" testID="tour-contact-voice" onTranscript={(t) => void fromText(t)} /></View>
              {!typed ? <Pressable onPress={() => setTyped(true)} style={{ alignSelf: "center" }} testID="tour-contact-type-toggle"><Text style={styles.linkTxt}>Preferisco scrivere</Text></Pressable> : (
                <View style={{ gap: 8 }}>
                  <TextInput placeholder="Nome, azienda, telefono, email…" placeholderTextColor={MUTED} style={styles.input} multiline value={text} onChangeText={setText} testID="tour-contact-type-input" />
                  <Pressable onPress={() => fromText(text)} style={[styles.cta, { alignSelf: "flex-end", paddingHorizontal: 18, marginTop: 0 }]} testID="tour-contact-type-send"><Text style={styles.ctaTxt}>Invia</Text></Pressable>
                </View>
              )}
            </View>
          </View>
        )}
      </ScrollView>
      {askBack && cardImage && !preview && !busy ? (
        <View style={styles.card} testID="tour-card-back-ask">
          <Text style={[styles.p, { fontSize: 14, textAlign: "left" }]}>Fronte acquisito ✅ Vuoi fotografare anche il retro? Axon legge servizi, orari e altri recapiti sul lato B.</Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
            <Pressable onPress={() => void fromCard("back")} style={[styles.choice, { flex: 1 }]} testID="tour-card-back-yes"><Text style={styles.choiceTxt}>📷 Fotografa il retro</Text></Pressable>
            <Pressable onPress={() => { setAskBack(false); void readCard(cardImage, null); }} style={[styles.choice, { flex: 1 }]} testID="tour-card-back-no"><Text style={styles.choiceTxt}>Continua senza</Text></Pressable>
          </View>
        </View>
      ) : null}
      {rawShot ? <ManualCropEditor visible imageBase64={rawShot} initialCorners={cropCorners} enhance={false} title={side === "back" ? "Ritaglia il retro del biglietto" : "Ritaglia il biglietto"} onCancel={() => setRawShot(null)} onDone={(r) => void onCropped(r)} /> : null}
      {created ? <Pressable onPress={onNext} style={styles.cta} testID="tour-next-3"><Text style={styles.ctaTxt}>Continua</Text><Ionicons name="arrow-forward" size={18} color={NAVY} /></Pressable>
        : <Pressable onPress={onNext} style={styles.link} testID="tour-skip-3"><Text style={styles.linkTxt}>Il primo cliente lo aggiungo dopo</Text></Pressable>}
    </View>
  );
}

// ---------- 4 · Chiusura ----------
function Closing({ onFinish, onFeatures }: { onFinish: () => void; onFeatures: () => void }) {
  return (
    <View style={styles.screen}>
      <View style={{ flex: 1, justifyContent: "center", gap: 18 }}>
        <AxonOrb />
        <Text style={styles.h1}>AdvisorOS è pronto.</Text>
        <Text style={styles.h2}>Quello che non trovi, chiedi ad Axon.</Text>
        <Text style={styles.p}>Non aggiungi un&apos;app alla tua vita.{"\n"}Togli il caos.</Text>
      </View>
      <Pressable onPress={onFinish} style={styles.cta} testID="tour-finish"><Text style={styles.ctaTxt}>Entra in AdvisorOS</Text><Ionicons name="arrow-forward" size={18} color={NAVY} /></Pressable>
      <Pressable onPress={onFeatures} style={styles.link} testID="tour-features-link-4"><Text style={styles.linkTxt}>Scopri tutte le funzioni</Text></Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  // V50.z320 — step codice promozionale
  promoStep: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 20, paddingVertical: 24, gap: 16 },
  promoOrb: { alignSelf: "center", width: 72, height: 72, borderRadius: 36, backgroundColor: "#8B5CF6", alignItems: "center", justifyContent: "center" },
  promoTitle: { fontSize: 22, fontWeight: "800", color: WHITE, textAlign: "center" },
  root: { flex: 1, backgroundColor: NAVY, paddingHorizontal: 24 },
  dots: { flexDirection: "row", gap: 6, alignSelf: "flex-start", marginBottom: 8, height: 40, alignItems: "center" },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.18)" }, dotOn: { backgroundColor: SKY, width: 22 }, dotDone: { backgroundColor: "rgba(56,189,248,0.6)" },
  skip: { paddingVertical: 10, paddingHorizontal: 8, minHeight: 44, justifyContent: "center" }, skipTxt: { color: MUTED, fontWeight: "700", fontSize: 13 },
  topRight: { position: "absolute", right: 16, top: 0, flexDirection: "row", alignItems: "center", gap: 6, zIndex: 2 },
  countdown: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(56,189,248,0.12)", borderColor: "rgba(56,189,248,0.4)", borderWidth: 1, borderRadius: 12, paddingHorizontal: 8, height: 26 },
  voiceRow: { height: 28, alignItems: "center", justifyContent: "center", marginBottom: 2 },
  countdownTxt: { color: SKY, fontSize: 11, fontWeight: "800" },
  muteBtn: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 40, paddingHorizontal: 12, borderRadius: 20, borderWidth: 1.5, borderColor: SKY, backgroundColor: "rgba(56,189,248,0.14)" },
  muteBtnOn: { backgroundColor: AMBER, borderColor: AMBER }, muteTxt: { color: SKY, fontWeight: "900", fontSize: 13 },
  ctrlBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(56,189,248,0.5)", backgroundColor: "rgba(255,255,255,0.06)" },
  mandatory: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(251,191,36,0.10)", borderColor: "rgba(251,191,36,0.45)", borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  mandatoryTxt: { flex: 1, color: AMBER, fontSize: 13, fontWeight: "800", lineHeight: 18 },
  errTxt: { color: AMBER, fontSize: 13, fontWeight: "700", textAlign: "center" },
  restart: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, alignSelf: "center", minHeight: 44, paddingHorizontal: 12 }, restartTxt: { color: MUTED, fontSize: 12, fontWeight: "700" },
  voiceLink: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, alignSelf: "center", minHeight: 44, paddingHorizontal: 12, flexWrap: "wrap" }, voiceLinkTxt: { color: SKY, fontSize: 13, fontWeight: "700", textAlign: "center" },
  screen: { flex: 1 },
  orb: { width: 72, height: 72, borderRadius: 36, backgroundColor: "#1C4869", alignItems: "center", justifyContent: "center", alignSelf: "center", borderWidth: 2, borderColor: SKY, shadowColor: SKY, shadowOpacity: 0.6, shadowRadius: 18, elevation: 8 },
  h1: { color: WHITE, fontSize: 30, fontWeight: "900", textAlign: "center", letterSpacing: -0.5 },
  h2: { color: SKY, fontSize: 20, fontWeight: "800", textAlign: "center" },
  p: { color: MUTED, fontSize: 16, textAlign: "center", lineHeight: 24 },
  cta: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: SKY, borderRadius: 16, minHeight: 54, marginTop: 8 }, ctaTxt: { color: NAVY, fontWeight: "900", fontSize: 16 },
  link: { alignItems: "center", paddingVertical: 14, minHeight: 44, justifyContent: "center" }, linkTxt: { color: MUTED, fontSize: 13, fontWeight: "700" },
  bubbleReading: { borderColor: SKY, borderWidth: 1.5, backgroundColor: "rgba(56,189,248,0.14)", shadowColor: SKY, shadowOpacity: 0.5, shadowRadius: 10, elevation: 4 },
  bubble: { backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 18, padding: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)" }, bubbleUser: { backgroundColor: SKY, alignSelf: "flex-end", maxWidth: "90%" },
  bubbleTxt: { color: WHITE, fontSize: 16, lineHeight: 23 },
  micWrap: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 16, padding: 8 },
  quickOpt: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, paddingHorizontal: 14, borderRadius: 22, borderWidth: 1.5, borderColor: SKY, backgroundColor: "rgba(56,189,248,0.10)" },
  quickOptOn: { backgroundColor: SKY, borderColor: SKY },
  quickOptTxt: { color: SKY, fontWeight: "800", fontSize: 14 },
  formBtn: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 16, backgroundColor: "rgba(56,189,248,0.10)", borderWidth: 1.5, borderColor: "rgba(56,189,248,0.55)", minHeight: 56, width: "100%" },
  formBtnTxt: { color: WHITE, fontSize: 15, fontWeight: "900" },
  input: { backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 14, padding: 14, color: WHITE, fontSize: 15, minHeight: 80, textAlignVertical: "top", borderWidth: 1, borderColor: "rgba(255,255,255,0.15)" },
  feat: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", minHeight: 52 },
  featOn: { backgroundColor: "rgba(56,189,248,0.14)", borderColor: SKY },
  featIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" }, featTxt: { flex: 1, color: MUTED, fontSize: 15, fontWeight: "800" },
  choice: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", minHeight: 56 },
  choiceTxt: { color: WHITE, fontSize: 15, fontWeight: "800" }, choiceSub: { color: MUTED, fontSize: 12, marginTop: 2 },
  card: { backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 16, padding: 14, gap: 8, borderWidth: 1, borderColor: "rgba(255,255,255,0.12)" },
  fieldRow: { flexDirection: "row", alignItems: "center", gap: 10 }, fieldLbl: { width: 78, color: MUTED, fontSize: 12, fontWeight: "700" },
  fieldVal: { flex: 1, color: WHITE, fontSize: 14, fontWeight: "700", backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 10, paddingHorizontal: 10, minHeight: 40 },
});

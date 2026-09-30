// wake-training.tsx — V50.z390 — PAGINA PUBBLICA (nessun login, nessun dato personale) per la raccolta di campioni audio
// per il training della wake-word «Axon»: hero → pronuncia → istruzioni → Sezione 1 «Axon» per ambiente (min 10, max 50)
// → Sezione 2 parole simili (campioni negativi) → pagina finale. Ogni campione: parola, ambiente, progressivo, timestamp.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Animated, Easing, Platform, Image, ActivityIndicator, Linking, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useAudioRecorder, RecordingPresets } from "expo-audio";
import { api } from "@/src/api";
import { getMicPermission, requestMicPermission, openAppSettings, startRecording, stopRecording, playBase64, stopPlayback, getLiveLevelDb, type MicPermissionState } from "@/src/corporate-gym/voice";
import { notify } from "@/src/utils/notify";
import AsyncStorage from "@react-native-async-storage/async-storage";

const LOGO = require("@/assets/images/advisoros-logo-transparent.png");
// Palette ufficiale AdvisorOS (pagina pubblica: identica in chiaro/scuro)
const WT = { navy: "#0F2438", navy2: "#16324A", violet: "#7C3AED", violetSoft: "#A78BFA", warm: "#F59E0B", cream: "#FFF7ED", white: "#FFFFFF", text: "#F8FAFC", muted: "rgba(248,250,252,0.72)", faint: "rgba(255,255,255,0.12)", green: "#22C55E", red: "#EF4444" };

type Env = { id: string; name: string; desc: string; icon: React.ComponentProps<typeof Ionicons>["name"] };
const ENVS: Env[] = [
  { id: "casa", name: "Casa", desc: "Il silenzio della cucina o la TV accesa in sottofondo: la voce di tutti i giorni.", icon: "home" },
  { id: "macchina", name: "In macchina", desc: "Parcheggiata o a motore spento: l'abitacolo chiuso cambia il suono della voce.", icon: "car-sport" },
  { id: "aperto", name: "All'aperto", desc: "Strada, parco, una passeggiata: vento, passi, la città che respira.", icon: "leaf" },
  { id: "bar", name: "Bar o aperitivo", desc: "Voci di fondo, tazzine, risate: Axon deve sentirti anche qui.", icon: "cafe" },
  { id: "sport", name: "Campo sportivo o palestra", desc: "Fiato corto, eco, musica: la voce sotto sforzo.", icon: "barbell" },
  { id: "autostrada", name: "Autostrada o treno", desc: "Rumore continuo e costante: il test più duro per un microfono.", icon: "train" },
  { id: "discoteca", name: "Discoteca o locale", desc: "Musica alta e bassi profondi: se Axon ti sente qui, ti sente ovunque.", icon: "musical-notes" },
];
// V50.z398 — parole/frasi da raccogliere CONFIGURABILI dal Super Master (/admin/wake-samples): più wake-word attive insieme,
// il visitatore le registra tutte. Default = «Axon» + 10 parole simili finché il server non risponde.
type WtWord = { word: string; label: string };
type WtConfig = { positive: WtWord[]; negative: WtWord[]; min_per_env: number; max_per_env: number };
const DEFAULT_CFG: WtConfig = {
  positive: [{ word: "axon", label: "Axon" }],
  negative: [["action", "Action (EK-shon)"], ["axel", "Axel (AK-sel)"], ["accent", "Accent (AK-sent)"], ["axia", "Axia (AK-sia)"], ["auction", "Auction (OK-shon)"], ["acton", "Acton (AK-ton)"], ["saxon", "Saxon (SAK-son)"], ["faction", "Faction (FAK-shon)"], ["oxygen", "Oxygen (OK-si-gen)"], ["flaxen", "Flaxen (FLAK-sen)"]].map(([word, label]) => ({ word, label })),
  min_per_env: 10, max_per_env: 50,
};
type Step = "hero" | "resume" | "consent" | "pron" | "intro" | "pos" | "negIntro" | "neg" | "done";
const PRIVACY_HERO = "Nessun dato personale viene raccolto. Registriamo esclusivamente la pronuncia della parola “Axon” e delle parole simili indicate. Non sappiamo chi sei, dove sei, né da dove stai registrando. I file audio vengono usati solo per addestrare il riconoscimento vocale di Axon. Nient'altro.";
const PRIVACY_FOOTER = "Audio raccolto: solo la pronuncia di “Axon” e parole simili. Nessun dato personale. Nessuna registrazione ambientale.";

// V50.z411 — RIPRESA: session_id e posizione (step/sezione/ambiente/parola/campioni) persistiti in AsyncStorage (web: localStorage).
// Alla riapertura del link: «Bentornato: hai già registrato N campioni — Riprendi / Ricomincia». Il Super Master vede UNA sessione
// (Parziale → Completato) invece di due visite separate. I campioni erano già salvati sul server uno per uno: qui si riprende solo lo step.
const WT_RESUME_KEY = "wake_training_resume_v1";
type WtSnapshot = { sessionId: string; step: Step; envIdx: number; wordIdx: number; counts: Record<string, number>; totalSaved: number; savedAt: number };
const newSessionId = () => `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
let sessionId = newSessionId();
const loadSnapshot = async (): Promise<WtSnapshot | null> => {
  try { const raw = await AsyncStorage.getItem(WT_RESUME_KEY); if (!raw) return null; const s = JSON.parse(raw) as WtSnapshot;
    if (!s?.sessionId || !s.step || Date.now() - (s.savedAt || 0) > 30 * 24 * 3600 * 1000) return null; return s; } catch { return null; }
};
const saveSnapshot = (s: Omit<WtSnapshot, "savedAt">) => AsyncStorage.setItem(WT_RESUME_KEY, JSON.stringify({ ...s, savedAt: Date.now() })).catch(() => {});
const clearSnapshot = () => AsyncStorage.removeItem(WT_RESUME_KEY).catch(() => {});
// V50.z398 — tracciamento ANONIMO dell'apertura/consenso/fine (solo id sessione casuale + piattaforma): serve al pannello Super Master
// per lo stato «Solo visualizzato / Parziale / Completato». Nessun dato personale.
const trackVisit = (event: "open" | "consent" | "done") => { api("/public/wake-samples/visit", { method: "POST", body: { session_id: sessionId, event, platform: Platform.OS } }).catch(() => {}); };

/** Onda sonora animata: 14 barre che seguono il livello del microfono (o un respiro sintetico se il livello non è disponibile). */
function Wave({ active, level }: { active: boolean; level: number }) {
  const bars = useRef(Array.from({ length: 14 }, () => new Animated.Value(0.15))).current;
  useEffect(() => {
    if (!active) { bars.forEach((b) => Animated.timing(b, { toValue: 0.15, duration: 250, useNativeDriver: false }).start()); return; }
    const amp = Math.min(1, Math.max(0.12, (level + 60) / 55));
    bars.forEach((b, i) => Animated.timing(b, { toValue: Math.max(0.12, amp * (0.45 + Math.abs(Math.sin(i * 0.9 + level)) * 0.55)), duration: 120, easing: Easing.out(Easing.quad), useNativeDriver: false }).start());
  }, [active, level, bars]);
  return (
    <View style={s.wave} testID="wt-wave">
      {bars.map((b, i) => <Animated.View key={i} style={[s.bar, { height: Animated.multiply(b, 64), backgroundColor: active ? WT.warm : WT.faint }]} />)}
    </View>
  );
}

export default function WakeTrainingScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const wide = width > 720;
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [step, setStep] = useState<Step>("hero");
  const [mic, setMic] = useState<MicPermissionState>("undetermined");
  const [cfg, setCfg] = useState<WtConfig>(DEFAULT_CFG);
  useEffect(() => {
    // V50.z411 — se c'è una sessione interrotta con campioni/consenso, riusa il suo session_id (stessa sessione per il Super Master) e proponi la ripresa
    loadSnapshot().then((snap) => {
      if (snap && snap.step !== "done" && (snap.totalSaved > 0 || ["pron", "intro", "pos", "negIntro", "neg"].includes(snap.step))) { sessionId = snap.sessionId; setResume(snap); setStep("resume"); }
      else { if (snap) void clearSnapshot(); trackVisit("open"); }
    });
  }, []);
  useEffect(() => { api<WtConfig>("/public/wake-samples/config").then((c) => { if (c?.positive?.length) setCfg({ ...DEFAULT_CFG, ...c }); }).catch(() => {}); }, []);
  const POS_WORDS = cfg.positive; const NEG_WORDS = cfg.negative; const MIN_PER_ENV = cfg.min_per_env; const MAX_PER_ENV = cfg.max_per_env;
  const [envIdx, setEnvIdx] = useState(0);
  const [wordIdx, setWordIdx] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({}); // key `${kind}:${word}:${env}`
  const [totalSaved, setTotalSaved] = useState(0);
  const [resume, setResume] = useState<WtSnapshot | null>(null); // V50.z411 — sessione interrotta trovata in storage
  const [recording, setRecording] = useState(false);
  const [level, setLevel] = useState(-60);
  const [pending, setPending] = useState<{ b64: string; mime: string; ms: number } | null>(null);
  useEffect(() => {
    // V50.z411 — snapshot progressivo della posizione (dopo il consenso, fino al completamento)
    if (step === "hero" || step === "resume" || step === "consent") return;
    if (step === "done") { void clearSnapshot(); return; }
    void saveSnapshot({ sessionId, step, envIdx, wordIdx, counts, totalSaved });
  }, [step, envIdx, wordIdx, counts, totalSaved]);
  const [saving, setSaving] = useState(false);
  const [playingPron, setPlayingPron] = useState(false);
  const startedAt = useRef(0);
  const fade = useRef(new Animated.Value(0)).current;
  const ctaPulse = useRef(new Animated.Value(1)).current;
  const holdScale = useRef(new Animated.Value(1)).current;

  useEffect(() => { fade.setValue(0); Animated.timing(fade, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start(); stopPlayback(); setPending(null); }, [step, envIdx, wordIdx, fade]);
  useEffect(() => { const loop = Animated.loop(Animated.sequence([Animated.timing(ctaPulse, { toValue: 1.04, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: false }), Animated.timing(ctaPulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: false })])); loop.start(); return () => loop.stop(); }, [ctaPulse]);
  useEffect(() => { getMicPermission().then(setMic); }, []);
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => { const db = getLiveLevelDb(Platform.OS === "web" ? null : recorder); setLevel(db ?? -30 + Math.random() * 20); }, 120);
    return () => clearInterval(t);
  }, [recording, recorder]);

  const kind = step === "neg" ? "negative" : "positive";
  const env = ENVS[envIdx];
  const WORDS = step === "neg" ? NEG_WORDS : POS_WORDS;
  const cur = WORDS[Math.min(wordIdx, WORDS.length - 1)] || POS_WORDS[0];
  const word = cur.word;
  const wordLabel = cur.label;
  const mainLabel = (POS_WORDS[0]?.label || "Axon").split(" (")[0];
  const key = `${kind}:${word}:${env?.id}`;
  const n = counts[key] || 0;
  const envTotal = useMemo(() => Object.entries(counts).filter(([k]) => k.startsWith(`${kind}:`) && k.endsWith(`:${env?.id}`)).reduce((a, [, v]) => a + v, 0), [counts, kind, env]);

  const ensureMic = async () => {
    if (mic === "granted") return true;
    const p = await requestMicPermission(); setMic(p);
    if (p !== "granted") { notify(p === "blocked" ? "Microfono bloccato: consenti l'accesso dalle impostazioni del browser/telefono" : "Serve il microfono per registrare la tua voce"); return false; }
    return true;
  };
  const onHoldStart = async () => {
    if (recording || saving) return;
    if (!(await ensureMic())) return;
    if (n >= MAX_PER_ENV) { notify(`Hai già ${MAX_PER_ENV} registrazioni qui: passa al prossimo ambiente`); return; }
    try { stopPlayback(); await startRecording(Platform.OS === "web" ? null : recorder); startedAt.current = Date.now(); setRecording(true); Animated.spring(holdScale, { toValue: 1.08, useNativeDriver: false }).start(); }
    catch { notify("Registrazione non disponibile su questo dispositivo"); }
  };
  const onHoldEnd = async () => {
    if (!recording) return;
    Animated.spring(holdScale, { toValue: 1, useNativeDriver: false }).start();
    setRecording(false);
    const ms = Date.now() - startedAt.current;
    try {
      const rec = await stopRecording(Platform.OS === "web" ? null : recorder);
      if (!rec || ms < 350) { notify("Troppo breve: tieni premuto e di' la parola con calma"); return; }
      setPending({ ...rec, ms });
    } catch { notify("Registrazione non riuscita, riprova"); }
  };
  const replay = () => { if (pending) void playBase64(pending.b64, pending.mime).catch(() => {}); };
  const save = async () => {
    if (!pending || saving) return;
    setSaving(true);
    try {
      await api("/public/wake-samples/b64", { method: "POST", body: { data_base64: pending.b64, mime: pending.mime, word, environment: env.id, kind, seq: n + 1, session_id: sessionId, duration_ms: pending.ms } });
      setCounts((c) => ({ ...c, [key]: (c[key] || 0) + 1 })); setTotalSaved((t) => t + 1); setPending(null);
    } catch (e: any) { notify(e?.message || "Salvataggio non riuscito: controlla la connessione e riprova"); }
    finally { setSaving(false); }
  };
  const nextEnv = () => { if (envIdx + 1 < ENVS.length) { setEnvIdx(envIdx + 1); setWordIdx(0); } else if (step === "pos" && NEG_WORDS.length) { setStep("negIntro"); setEnvIdx(0); setWordIdx(0); } else { setStep("done"); trackVisit("done"); } };
  const nextWord = () => { if (wordIdx + 1 < WORDS.length) setWordIdx(wordIdx + 1); else nextEnv(); };
  const playPron = async () => {
    setPlayingPron(true);
    try { const r = await fetch(`${process.env.EXPO_PUBLIC_BACKEND_URL}/api/public/wake-samples/pronunciation`); const buf = await r.arrayBuffer(); let bin = ""; const bytes = new Uint8Array(buf); for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]); await playBase64(btoa(bin), "audio/mpeg"); }
    catch { notify("Audio pronuncia non disponibile in questo momento"); } finally { setPlayingPron(false); }
  };

  const Header = (
    <View style={s.header}>
      <Image source={LOGO} style={{ width: 132, height: 34 }} resizeMode="contain" accessibilityLabel="AdvisorOS" />
      <View style={s.pill}><View style={s.pillDot} /><Text style={s.pillTxt}>Axon · Wake-word training</Text></View>
    </View>
  );
  const Progress = (step === "pos" || step === "neg") ? (
    <View style={s.progressRow} testID="wt-progress">
      {ENVS.map((e, i) => <View key={e.id} style={[s.progressSeg, i < envIdx && { backgroundColor: WT.green }, i === envIdx && { backgroundColor: WT.warm }]} />)}
      <Text style={s.progressTxt}>{step === "pos" ? `Sezione 1 · ${mainLabel}` : "Sezione 2 · Parole simili"} · ambiente {envIdx + 1}/{ENVS.length} · {totalSaved} campioni salvati</Text>
    </View>
  ) : null;

  const body = () => {
    if (step === "hero") return (
      <View style={[s.center, wide && { paddingHorizontal: 80 }]} testID="wt-hero">
        <View style={s.orb}><Ionicons name="mic" size={44} color={WT.white} /></View>
        <Text style={s.h1}>Stai addestrando Axon.</Text>
        <Text style={s.lead}>La tua voce è unica. Ogni registrazione aiuta Axon a riconoscerti meglio, ovunque tu sia. Bastano 5 minuti e il tuo contributo farà la differenza.</Text>
        <Animated.View style={{ transform: [{ scale: ctaPulse }], alignSelf: "stretch", maxWidth: 420, width: "100%" }}>
          <Pressable onPress={() => setStep("consent")} style={s.cta} testID="wt-cta-start"><Text style={s.ctaTxt}>Inizia ora</Text><Ionicons name="arrow-forward" size={20} color={WT.white} /></Pressable>
        </Animated.View>
        <View style={s.privacyBox} testID="wt-privacy-hero"><Ionicons name="shield-checkmark" size={20} color={WT.green} /><Text style={s.privacyTxt}>{PRIVACY_HERO}</Text></View>
      </View>
    );
    if (step === "resume" && resume) return (
      <View style={s.card} testID="wt-resume">
        <Text style={s.h2}>Bentornato 👋</Text>
        <Text style={s.p}>{resume.totalSaved > 0 ? `Hai già registrato ${resume.totalSaved} ${resume.totalSaved === 1 ? "campione" : "campioni"}: sono salvati, non serve rifarli.` : "Avevi iniziato l'addestramento ma non hai ancora registrato campioni."}</Text>
        <Text style={s.p}>Vuoi riprendere da dove ti eri fermato{resume.step === "pos" || resume.step === "neg" ? ` (${resume.step === "pos" ? "Sezione 1" : "Sezione 2"} · ambiente ${resume.envIdx + 1}/${ENVS.length})` : ""}?</Text>
        <Pressable onPress={() => { setCounts(resume.counts || {}); setTotalSaved(resume.totalSaved || 0); setEnvIdx(resume.envIdx || 0); setWordIdx(resume.wordIdx || 0); setStep(resume.step); }} style={[s.cta, { backgroundColor: WT.green }]} testID="wt-resume-continue"><Ionicons name="play" size={20} color={WT.white} /><Text style={s.ctaTxt}>Riprendi da dove ero</Text></Pressable>
        <Pressable onPress={() => { void clearSnapshot(); sessionId = newSessionId(); trackVisit("open"); setResume(null); setCounts({}); setTotalSaved(0); setEnvIdx(0); setWordIdx(0); setStep("hero"); }} style={s.ghost} testID="wt-resume-restart"><Text style={s.ghostTxt}>Ricomincia da capo</Text></Pressable>
      </View>
    );
    if (step === "consent") return (
      <View style={s.card} testID="wt-consent">
        <View style={s.envHead}><View style={[s.envIcon, { backgroundColor: WT.green }]}><Ionicons name="shield-checkmark" size={30} color={WT.white} /></View><Text style={s.h2}>Prima di iniziare</Text></View>
        <Text style={s.p}>Cliccando <Text style={s.strong}>“Accetto e continuo”</Text> confermi di aver letto e accettato quanto segue: i campioni audio che registrerai contengono esclusivamente la tua pronuncia delle parole indicate. Non vengono registrati suoni ambientali, conversazioni o dati personali. I campioni vengono salvati in forma anonima e usati esclusivamente per migliorare il riconoscimento vocale di Axon. Puoi interrompere in qualsiasi momento.</Text>
        <Pressable onPress={() => { trackVisit("consent"); setStep("pron"); }} style={[s.cta, { backgroundColor: WT.green }]} testID="wt-consent-ok"><Ionicons name="checkmark-circle" size={20} color={WT.white} /><Text style={s.ctaTxt}>Accetto e continuo</Text></Pressable>
        <Pressable onPress={() => setStep("hero")} style={s.ghost} testID="wt-consent-back"><Text style={s.ghostTxt}>Torna indietro</Text></Pressable>
      </View>
    );
    if (step === "pron") return (
      <View style={s.card} testID="wt-pron">
        <Text style={s.h2}>Come si dice Axon?</Text>
        <Text style={s.p}>Axon si pronuncia <Text style={s.strong}>AK-son</Text>. Come se chiamassi qualcuno vicino a te: naturale, diretto, senza esagerare. Non devi parlare in modo formale, non devi articolare ogni lettera. Dillo come ti viene, come lo diresti a un amico. Axon funziona meglio quando impara la tua voce vera, non la tua voce “da registrazione”.</Text>
        <Pressable onPress={playPron} disabled={playingPron} style={s.secondary} testID="wt-pron-play">{playingPron ? <ActivityIndicator color={WT.violetSoft} /> : <Ionicons name="volume-high" size={20} color={WT.violetSoft} />}<Text style={s.secondaryTxt}>Ascolta come si pronuncia</Text></Pressable>
        <View style={{ gap: 10, marginTop: 6 }}>
          {[["speedometer-outline", "Non serve parlare lentamente", "“A... X... O... N...”"], ["volume-mute-outline", "Non serve urlare", "“AXON!!!”"], ["happy-outline", "Non serve l'accento perfetto", "dillo come ti viene naturalmente"]].map(([ic, t, ex]) => (
            <View key={t} style={s.dont}><Ionicons name={ic as any} size={20} color={WT.warm} /><View style={{ flex: 1 }}><Text style={s.dontT}>{t}</Text><Text style={s.dontEx}>{ex}</Text></View></View>
          ))}
        </View>
        <Pressable onPress={() => setStep("intro")} style={s.cta} testID="wt-pron-ok"><Text style={s.ctaTxt}>Ho capito, iniziamo</Text><Ionicons name="checkmark" size={20} color={WT.white} /></Pressable>
      </View>
    );
    if (step === "intro" || step === "negIntro") return (
      <View style={s.card} testID={step === "intro" ? "wt-intro" : "wt-neg-intro"}>
        <Text style={s.h2}>{step === "intro" ? "Cosa farai adesso" : "Ora le parole simili. Axon deve imparare a non confondersi."}</Text>
        {step === "intro" ? (<>
          <Text style={s.p}>Registrerai {POS_WORDS.length > 1 ? "le parole" : "la parola"} <Text style={s.strong}>{POS_WORDS.map((w) => `“${w.label.split(" (")[0]}”`).join(", ")}</Text> in ambienti diversi — casa, macchina, strada, bar… — poi una serie di <Text style={s.strong}>parole simili</Text>. Il sistema di intelligenza artificiale userà questi campioni per distinguere la tua voce dal rumore del mondo reale.</Text>
          <View style={s.tipBox}><Ionicons name="information-circle" size={20} color={WT.violetSoft} /><Text style={s.tip}>Per ogni ambiente servono almeno {MIN_PER_ENV} registrazioni (massimo {MAX_PER_ENV}). Se un ambiente non è disponibile in questo momento, puoi saltarlo.</Text></View>
        </>) : (
          <Text style={s.p}>Stessa struttura di prima, stessi ambienti: questa volta pronuncerai parole che <Text style={s.strong}>assomigliano</Text> ad Axon. Così Axon imparerà che “Action” o “Axel” non sono lui. Tra parentesi trovi la pronuncia suggerita.</Text>
        )}
        <Pressable onPress={() => { setEnvIdx(0); setWordIdx(0); setStep(step === "intro" ? "pos" : "neg"); }} style={s.cta} testID="wt-intro-go"><Text style={s.ctaTxt}>{step === "intro" ? "Vai alla Sezione 1" : "Vai alla Sezione 2"}</Text><Ionicons name="arrow-forward" size={20} color={WT.white} /></Pressable>
      </View>
    );
    if (step === "pos" || step === "neg") return (
      <View style={s.card} testID={`wt-env-${env.id}`}>
        <View style={s.envHead}>
          <View style={s.envIcon}><Ionicons name={env.icon} size={30} color={WT.white} /></View>
          <View style={{ flex: 1 }}><Text style={s.h2}>{env.name}</Text><Text style={s.envDesc}>{env.desc}</Text></View>
        </View>
        <View style={s.wordBox} testID="wt-word"><Text style={s.wordLbl}>{WORDS.length > 1 ? `Parola ${wordIdx + 1}/${WORDS.length} · di'` : "Di'"}</Text><Text style={s.word}>{wordLabel}</Text></View>
        <Wave active={recording} level={level} />
        <Animated.View style={{ transform: [{ scale: holdScale }], alignSelf: "center" }}>
          <Pressable onPressIn={onHoldStart} onPressOut={onHoldEnd} disabled={saving} style={[s.hold, recording && s.holdOn]} testID="wt-hold" accessibilityLabel="Tieni premuto per registrare">
            <Ionicons name={recording ? "radio-button-on" : "mic"} size={34} color={WT.white} />
            <Text style={s.holdTxt}>{recording ? "Sto registrando… rilascia quando hai finito" : "Tieni premuto per registrare"}</Text>
          </Pressable>
        </Animated.View>
        {mic === "blocked" ? <Pressable onPress={openAppSettings} style={s.link}><Text style={s.linkTxt}>Microfono bloccato · apri le impostazioni</Text></Pressable> : null}
        <Text style={s.counter} testID="wt-counter">{n} {n === 1 ? "registrazione" : "registrazioni"} {WORDS.length > 1 ? "per questa parola" : "in questo ambiente"}{WORDS.length > 1 ? ` · ${envTotal} nell'ambiente` : ""}{n < MIN_PER_ENV && step === "pos" ? ` · ancora ${MIN_PER_ENV - n} per il minimo` : ""}</Text>
        {pending ? (
          <View style={s.pendingRow} testID="wt-pending">
            <Pressable onPress={replay} style={s.secondary} testID="wt-replay"><Ionicons name="play" size={18} color={WT.violetSoft} /><Text style={s.secondaryTxt}>Riascolta</Text></Pressable>
            <Pressable onPress={save} disabled={saving} style={[s.cta, { flex: 1, minHeight: 50 }]} testID="wt-save">{saving ? <ActivityIndicator color={WT.white} /> : <><Ionicons name="save" size={18} color={WT.white} /><Text style={s.ctaTxt}>Salva e registra ancora</Text></>}</Pressable>
          </View>
        ) : null}
        <View style={s.navRow}>
          <Pressable onPress={WORDS.length > 1 ? nextWord : nextEnv} style={s.ghost} testID="wt-skip"><Text style={s.ghostTxt}>{WORDS.length > 1 ? "Salta parola" : "Salta ambiente"}</Text></Pressable>
          {WORDS.length > 1 ? <Pressable onPress={nextWord} style={[s.cta, { flex: 1, minHeight: 50, backgroundColor: WT.navy2, borderWidth: 1, borderColor: WT.violetSoft }]} testID="wt-next-word"><Text style={s.ctaTxt}>Prossima parola</Text><Ionicons name="arrow-forward" size={18} color={WT.white} /></Pressable> : null}
          <Pressable onPress={nextEnv} disabled={step === "pos" && n < MIN_PER_ENV} style={[s.cta, { flex: 1, minHeight: 50 }, step === "pos" && n < MIN_PER_ENV && { opacity: 0.45 }]} testID="wt-next-env"><Text style={s.ctaTxt}>Prossimo ambiente</Text><Ionicons name="arrow-forward" size={18} color={WT.white} /></Pressable>
        </View>
      </View>
    );
    return (
      <View style={s.center} testID="wt-done">
        <Animated.View style={[s.orb, { backgroundColor: WT.green, transform: [{ scale: ctaPulse }] }]}><Ionicons name="checkmark" size={54} color={WT.white} /></Animated.View>
        <Text style={s.h1}>Grazie. Hai appena reso Axon più intelligente.</Text>
        <Text style={s.lead}>Il tuo contributo è parte di qualcosa di grande. Axon impara da ogni voce, in ogni ambiente, ogni giorno.</Text>
        <Text style={s.fine}>{totalSaved} campioni salvati in questa sessione</Text>
        <Image source={LOGO} style={{ width: 180, height: 46, marginTop: 10 }} resizeMode="contain" />
        <Pressable onPress={() => (Platform.OS === "web" ? Linking.openURL("/landing") : router.replace("/landing" as any))} style={[s.cta, { maxWidth: 420, alignSelf: "stretch" }]} testID="wt-discover"><Text style={s.ctaTxt}>Scopri AdvisorOS</Text><Ionicons name="open-outline" size={20} color={WT.white} /></Pressable>
      </View>
    );
  };

  return (
    <SafeAreaView style={s.root}>
      <ScrollView contentContainerStyle={[s.scroll, wide && { maxWidth: 820, alignSelf: "center", width: "100%" }]} keyboardShouldPersistTaps="handled">
        {Header}
        {Progress}
        <Animated.View style={{ opacity: fade, flex: 1 }}>{body()}</Animated.View>
      </ScrollView>
      <View style={s.footerBar} testID="wt-privacy-footer"><Ionicons name="lock-closed" size={14} color={WT.green} /><Text style={s.footer}>{PRIVACY_FOOTER}</Text></View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: WT.navy },
  scroll: { padding: 18, gap: 16, paddingBottom: 40, flexGrow: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, paddingVertical: 6 },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: WT.faint, borderRadius: 999, paddingHorizontal: 12, minHeight: 32 }, pillDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: WT.warm }, pillTxt: { color: WT.text, fontSize: 12, fontWeight: "800" },
  progressRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }, progressSeg: { height: 6, flexGrow: 1, minWidth: 30, borderRadius: 3, backgroundColor: WT.faint }, progressTxt: { width: "100%", color: WT.muted, fontSize: 12, fontWeight: "700", marginTop: 2 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 18, paddingVertical: 30 },
  orb: { width: 108, height: 108, borderRadius: 54, backgroundColor: WT.violet, alignItems: "center", justifyContent: "center", shadowColor: WT.violet, shadowOpacity: 0.55, shadowRadius: 30, shadowOffset: { width: 0, height: 10 }, elevation: 12 },
  h1: { color: WT.text, fontSize: 36, fontWeight: "900", textAlign: "center", letterSpacing: -0.5, lineHeight: 42 },
  h2: { color: WT.text, fontSize: 24, fontWeight: "900", lineHeight: 30 },
  lead: { color: WT.muted, fontSize: 17, lineHeight: 26, textAlign: "center", maxWidth: 560 },
  p: { color: WT.muted, fontSize: 15.5, lineHeight: 24 }, strong: { color: WT.text, fontWeight: "900" },
  fine: { color: WT.muted, fontSize: 12, textAlign: "center" },
  card: { backgroundColor: WT.navy2, borderRadius: 24, padding: 20, gap: 16, borderWidth: 1, borderColor: WT.faint },
  cta: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, minHeight: 56, borderRadius: 16, backgroundColor: WT.violet, paddingHorizontal: 20 }, ctaTxt: { color: WT.white, fontWeight: "900", fontSize: 16 },
  secondary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 50, borderRadius: 14, borderWidth: 1.5, borderColor: WT.violetSoft, paddingHorizontal: 16 }, secondaryTxt: { color: WT.violetSoft, fontWeight: "800", fontSize: 14 },
  ghost: { minHeight: 50, borderRadius: 14, alignItems: "center", justifyContent: "center", paddingHorizontal: 14, borderWidth: 1, borderColor: WT.faint }, ghostTxt: { color: WT.muted, fontWeight: "800", fontSize: 13 },
  dont: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "rgba(245,158,11,0.10)", borderRadius: 14, padding: 12 }, dontT: { color: WT.text, fontWeight: "800", fontSize: 14 }, dontEx: { color: WT.muted, fontSize: 13, fontStyle: "italic" },
  tipBox: { flexDirection: "row", gap: 10, alignItems: "flex-start", backgroundColor: "rgba(167,139,250,0.12)", borderRadius: 14, padding: 12 }, tip: { flex: 1, color: WT.text, fontSize: 13.5, lineHeight: 20 },
  envHead: { flexDirection: "row", alignItems: "center", gap: 14 }, envIcon: { width: 58, height: 58, borderRadius: 18, backgroundColor: WT.violet, alignItems: "center", justifyContent: "center" }, envDesc: { color: WT.muted, fontSize: 13.5, lineHeight: 19, marginTop: 2 },
  wordBox: { alignItems: "center", gap: 2, backgroundColor: WT.navy, borderRadius: 18, paddingVertical: 14 }, wordLbl: { color: WT.muted, fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1 }, word: { color: WT.warm, fontSize: 34, fontWeight: "900", letterSpacing: 0.5 },
  wave: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, height: 70 }, bar: { width: 6, borderRadius: 3 },
  hold: { alignItems: "center", justifyContent: "center", gap: 6, width: 220, height: 220, borderRadius: 110, backgroundColor: WT.violet, borderWidth: 6, borderColor: "rgba(167,139,250,0.35)", paddingHorizontal: 16 },
  holdOn: { backgroundColor: WT.red, borderColor: "rgba(239,68,68,0.35)" }, holdTxt: { color: WT.white, fontWeight: "800", fontSize: 13, textAlign: "center" },
  counter: { color: WT.text, fontSize: 14, fontWeight: "800", textAlign: "center" },
  pendingRow: { flexDirection: "row", gap: 10, alignItems: "center" },
  navRow: { flexDirection: "row", gap: 10, alignItems: "center", flexWrap: "wrap" },
  link: { minHeight: 40, justifyContent: "center", alignItems: "center" }, linkTxt: { color: WT.warm, fontWeight: "800", fontSize: 13 },
  footerBar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: WT.faint, backgroundColor: WT.navy2 },
  footer: { flex: 1, color: WT.muted, fontSize: 11.5, lineHeight: 16 },
  privacyBox: { flexDirection: "row", alignItems: "flex-start", gap: 10, backgroundColor: "rgba(34,197,94,0.10)", borderRadius: 16, padding: 14, borderWidth: 1, borderColor: "rgba(34,197,94,0.35)", maxWidth: 560, alignSelf: "stretch" },
  privacyTxt: { flex: 1, color: WT.text, fontSize: 13.5, lineHeight: 20 },
});

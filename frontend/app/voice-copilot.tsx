/**
 * V50.o — Axon Drive (ex "Copilot Vocale · Modalità Auto") — hands-free in auto
 * V50.z177 — solo UI: sfondo interno auto, volante centrale, esempi in primo piano (logica invariata)
 * V50.z495 — modalità audio «Tocca per parlare» (silenzio 1-2 s → invio automatico) / «Sempre attivo» (ascolto continuo),
 *            display dinamico contestuale (ritelefonate, ultima nota, navigazione verso il cliente), schermo intero (monitor auto/CarPlay),
 *            apertura con wake word «Axon, modalità drive».
 *
 * Modalità full-screen con grande pulsante microfono per uso hands-free
 * (mentre l'utente guida). Flusso:
 *  1. Utente tocca il mic (o attiva Axon Drive con auto-stop dopo silenzio)
 *  2. Registra audio → invia a /api/ai/transcribe (whisper)
 *  3. Trascritto → invia a /api/voice/copilot/execute (intent parsing + esecuzione)
 *  4. Legge ad alta voce la confermatext via TTS emergent
 *  5. Torna in ascolto per il prossimo comando
 *
 * Progettato per essere USATO GUIDANDO: bottoni enormi, feedback visivo grande,
 * niente tastiera, niente scorrimento fine.
 */
import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Platform, Animated, Image, Linking } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { AudioModule } from "expo-audio";
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition"; // V50.z486 — trascrizione LIVE
import { confirmCritical } from "@/src/violawake/guard"; // V50.z371
import * as FileSystem from "expo-file-system/legacy";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
// V50.z186 — stop vocale (barge-in nativo) + audio in background (moduli isolati)
import { useNativeBargeIn } from "@/src/voice/useNativeBargeIn";
import { ensureVoiceAudioMode } from "@/src/voice/voiceAudioMode";
import { acquireMicLease } from "@/src/utils/micLease"; // V50.z483 — pausa wake-word mentre si registra
import { ensureDevicePermission } from "@/src/permissions/devicePermissions"; // V50.z484 — alert permesso di sistema mancante
// V50.z495 — modalità audio (Tocca per parlare / Sempre attivo), display dinamico, navigazione verso il cliente
import { DriveModeButtons } from "@/src/drive/DriveModeButtons";
import { DriveDisplay, type DriveDisplayData, type DriveAddressOption } from "@/src/drive/DriveDisplay";
import { loadDriveMode, saveDriveMode, loadSuggestionsHidden, saveSuggestionsHidden, DRIVE_SILENCE_MS, DRIVE_NO_SPEECH_MS, DRIVE_IDLE_RESET_MS, type DriveAudioMode } from "@/src/drive/driveSettings";
let _micRelease: null | (() => void) = null;

type Phase = "idle" | "recording" | "transcribing" | "executing" | "speaking" | "error";
type HistoryItem = {
  id: string;
  transcript: string;
  intent?: string;
  confirmation?: string;
  error?: string;
};

export default function VoiceCopilotScreen() {
  const router = useRouter();
  // V50.z486 — TRASCRIZIONE LIVE: il riconoscitore di sistema mostra il testo mentre parli (interim) e salva l'audio su file
  // (recordingOptions.persist) che a fine comando va a Deepgram per il testo definitivo (fallback: testo del riconoscitore).
  // «INTERROMPI» detto a voce → cancella il messaggio in corso e riparte l'ascolto per quello nuovo.
  const [liveText, setLiveText] = useState("");
  const liveRef = useRef("");
  const finalRef = useRef("");
  const recUriRef = useRef<string | null>(null);
  const endWaitersRef = useRef<Array<() => void>>([]);
  const endedRef = useRef(false);      // il riconoscitore ha già emesso "end"
  const restartingRef = useRef(false); // abort volontario (INTERROMPI) → non processare
  const phaseRef = useRef<Phase>("idle");
  const [cancelledFlash, setCancelledFlash] = useState(false);

  const [phase, setPhaseState] = useState<Phase>("idle");
  const setPhase = (p: Phase) => { phaseRef.current = p; setPhaseState(p); };
  const [currentTranscript, setCurrentTranscript] = useState("");
  const [currentConfirm, setCurrentConfirm] = useState("");
  const pendingRef = useRef<{ contact_id: string; question: string } | null>(null); // V50.z368 — «Intendi il tuo cliente X?»
  const pendingNavRef = useRef<string | null>(null); // V50.z495 — scelta indirizzo in sospeso («casa o lavoro?»)
  // V50.z495 — modalità audio + display dinamico
  const [mode, setMode] = useState<DriveAudioMode>("tap");
  const modeRef = useRef<DriveAudioMode>("tap");
  const [alwaysOn, setAlwaysOnState] = useState(false);
  const alwaysOnRef = useRef(false);
  const setAlwaysOn = (v: boolean) => { alwaysOnRef.current = v; setAlwaysOnState(v); };
  const [display, setDisplay] = useState<DriveDisplayData | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noSpeechTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearListenTimers = () => {
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
    if (noSpeechTimerRef.current) { clearTimeout(noSpeechTimerRef.current); noSpeechTimerRef.current = null; }
  };
  const changeMode = (m: DriveAudioMode) => {
    modeRef.current = m; setMode(m); void saveDriveMode(m);
    if (m === "tap" && alwaysOnRef.current) { setAlwaysOn(false); if (phaseRef.current === "recording") void stopAndProcess(); }
  };
  useEffect(() => { void loadDriveMode().then((m) => { modeRef.current = m; setMode(m); }); }, []);
  // V50.z500 — X su «Cosa puoi dirmi»: suggerimenti nascosti per sempre (preferenza memorizzata)
  const [suggestionsHidden, setSuggestionsHidden] = useState(false);
  useEffect(() => { void loadSuggestionsHidden().then(setSuggestionsHidden); }, []);
  const hideSuggestions = () => { setSuggestionsHidden(true); void saveSuggestionsHidden(true); };
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [permission, setPermission] = useState<boolean | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  // V50.z186 — player TTS corrente + testo pronunciato (per lo stop vocale)
  const ttsPlayerRef = useRef<any>(null);
  const ttsTextRef = useRef("");
  const ttsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopSpeaking = () => {
    if (ttsTimerRef.current) { clearTimeout(ttsTimerRef.current); ttsTimerRef.current = null; }
    const p = ttsPlayerRef.current; ttsPlayerRef.current = null;
    try { p?.pause?.(); } catch { /* ignore */ }
    try { p?.release?.(); } catch { /* ignore */ }
    ttsTextRef.current = "";
    setPhase("idle");
  };
  useNativeBargeIn({
    active: phase === "speaking",
    onInterrupt: () => { try { ttsPlayerRef.current?.pause?.(); } catch { /* ignore */ } },
    onStop: stopSpeaking,
    onFalseAlarm: () => { try { ttsPlayerRef.current?.play?.(); } catch { /* ignore */ } },
    speakingText: () => ttsTextRef.current,
  });

  useEffect(() => {
    (async () => {
      try {
        const p = await AudioModule.requestRecordingPermissionsAsync();
        setPermission(p.granted);
      } catch {
        setPermission(false);
      }
    })();
  }, []);

  // Pulse animation while recording
  useEffect(() => {
    if (phase === "recording") {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.15, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    }
  }, [phase, pulseAnim]);

  const speak = async (text: string, preB64?: string | null) => {
    if (!text) return;
    setPhase("speaking");
    try {
      // V50.z368 — audio già incluso nella risposta di /voice/copilot/execute (voce del PROFILO Axon); fallback /ai/tts senza voce fissa
      let b64 = preB64 || null;
      if (!b64) {
        const res = await api("/ai/tts", { method: "POST", body: { text: text.slice(0, 320) } });
        b64 = (res as any)?.data?.audio_base64 || (res as any)?.audio_base64;
      }
      if (b64) {
        if (Platform.OS === "web") {
          const audio = new (globalThis as any).Audio(`data:audio/mp3;base64,${b64}`);
          audio.play();
          audio.onended = () => setPhase("idle");
        } else {
          const AudioMod: any = await import("expo-audio");
          const path = FileSystem.cacheDirectory + `tts-${Date.now()}.mp3`;
          await FileSystem.writeAsStringAsync(path, b64, { encoding: FileSystem.EncodingType.Base64 });
          await ensureVoiceAudioMode({ recording: true }); // V50.z186 — voce anche a schermo bloccato
          const player = AudioMod.createAudioPlayer({ uri: path });
          ttsPlayerRef.current = player;
          ttsTextRef.current = text;
          player.play();
          ttsTimerRef.current = setTimeout(() => { if (ttsPlayerRef.current === player) stopSpeaking(); }, Math.max(2000, text.length * 60));
        }
      } else {
        setPhase("idle");
      }
    } catch {
      setPhase("idle");
    }
  };

  const startListening = async () => {
    await ensureVoiceAudioMode({ recording: true }); // V50.z186 — registrazione continua in background
    liveRef.current = ""; finalRef.current = ""; recUriRef.current = null; setLiveText(""); endedRef.current = false;
    ExpoSpeechRecognitionModule.start({
      lang: "it-IT", interimResults: true, continuous: true, maxAlternatives: 1,
      recordingOptions: { persist: true, outputFileName: `drive_${Date.now()}.wav` },
      // V50.z495 — 1-2 s di silenzio → il comando parte da solo (il timer JS qui sotto copre anche iOS/web)
      androidIntentOptions: { EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: DRIVE_SILENCE_MS, EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS: DRIVE_SILENCE_MS },
    });
    _micRelease?.(); _micRelease = acquireMicLease(); // V50.z483
    clearListenTimers();
    // nessuna parola entro N secondi → chiudo l'ascolto senza inviare (in «Sempre attivo» riparte da solo)
    noSpeechTimerRef.current = setTimeout(() => {
      if (phaseRef.current !== "recording" || liveRef.current.trim()) return;
      try { ExpoSpeechRecognitionModule.abort(); } catch { /* noop */ }
      _micRelease?.(); _micRelease = null;
      setPhase("idle");
    }, DRIVE_NO_SPEECH_MS);
  };
  const armSilenceTimer = () => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = setTimeout(() => {
      silenceTimerRef.current = null;
      if (phaseRef.current === "recording" && (finalRef.current || liveRef.current).trim()) void stopAndProcess();
    }, DRIVE_SILENCE_MS);
  };

  // «INTERROMPI» → butta via quello detto finora e riparte subito l'ascolto per il nuovo comando
  const cancelAndRestart = async () => {
    restartingRef.current = true;
    try { ExpoSpeechRecognitionModule.abort(); } catch { /* noop */ }
    liveRef.current = ""; finalRef.current = ""; recUriRef.current = null; setLiveText(""); setCurrentTranscript("");
    setCancelledFlash(true); setTimeout(() => setCancelledFlash(false), 1800);
    await new Promise((r) => setTimeout(r, 450));
    if (phaseRef.current === "recording") { try { await startListening(); } catch { /* noop */ } }
    restartingRef.current = false;
  };

  useSpeechRecognitionEvent("result", (ev) => {
    if (phaseRef.current !== "recording") return;
    const t = (ev.results?.[0]?.transcript || "").trim();
    if (/\binterromp\w*\b/i.test(t) || /\bcancella (il )?messaggio\b/i.test(t)) { void cancelAndRestart(); return; }
    liveRef.current = t; setLiveText(t);
    if (ev.isFinal && t) finalRef.current = t;
    if (t) armSilenceTimer(); // V50.z495 — ogni parola nuova riarma il timer: 1-2 s di silenzio → invio automatico
  });
  useSpeechRecognitionEvent("audiostart", (ev) => { if (ev.uri) recUriRef.current = ev.uri; });
  useSpeechRecognitionEvent("audioend", (ev) => { if (ev.uri) recUriRef.current = ev.uri; });
  useSpeechRecognitionEvent("end", () => {
    endedRef.current = true;
    const w = endWaitersRef.current; endWaitersRef.current = []; w.forEach((f) => f());
    // il sistema ha chiuso l'ascolto da solo (silenzio/limite): se l'utente stava ancora parlando, processiamo quanto detto
    if (!w.length && !restartingRef.current && phaseRef.current === "recording") void stopAndProcess();
  });
  useSpeechRecognitionEvent("error", (ev) => {
    if (ev.error === "aborted") return;
    if (ev.error === "no-speech") { // V50.z495 — nessuna parola: torno in attesa (in «Sempre attivo» riparte da solo)
      if (phaseRef.current === "recording" && !liveRef.current.trim()) { clearListenTimers(); _micRelease?.(); _micRelease = null; setPhase("idle"); }
      return;
    }
    if (phaseRef.current === "recording") { setPhase("error"); notify("Axon Drive", `Ascolto interrotto: ${ev.message || ev.error}`); _micRelease?.(); _micRelease = null; }
  });
  const waitEnd = (ms: number) => new Promise<void>((resolve) => { if (endedRef.current) { resolve(); return; } const t = setTimeout(resolve, ms); endWaitersRef.current.push(() => { clearTimeout(t); resolve(); }); });

  const startRecording = async () => {
    if (permission === false) {
      notify("Microfono", "Permesso microfono negato. Vai in Impostazioni per abilitarlo.");
      return;
    }
    if (phaseRef.current !== "idle" && phaseRef.current !== "error") return;
    if (idleResetRef.current) { clearTimeout(idleResetRef.current); idleResetRef.current = null; }
    setCurrentTranscript("");
    setCurrentConfirm("");
    setPhase("recording");
    try {
      if (!(await ensureDevicePermission("microphone"))) { setPhase("idle"); return; } // V50.z484
      const sp = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!sp.granted) { setPhase("idle"); notify("Riconoscimento vocale", "Consenti il riconoscimento vocale nelle Impostazioni per vedere il testo mentre parli."); return; }
      await startListening();
    } catch (e: any) {
      setPhase("error");
      notify("Errore", `Registrazione fallita: ${e?.message || e}`);
    }
  };

  const stopAndProcess = async () => {
    if (phaseRef.current !== "recording") return;
    clearListenTimers();
    setPhase("transcribing");
    try {
      const endP = waitEnd(4000);
      try { ExpoSpeechRecognitionModule.stop(); } catch { /* noop */ }
      await endP; // il file audio è pronto solo dopo l'evento "end"
      _micRelease?.(); _micRelease = null; // V50.z483
      const uri = recUriRef.current;
      const liveFinal = (finalRef.current || liveRef.current).trim();
      let transcript = liveFinal;
      let tRes: any = null;
      if (uri) {
        try {
          const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
          const mime = uri.endsWith(".caf") ? "audio/x-caf" : "audio/wav";
          tRes = await api("/ai/transcribe", { method: "POST", body: { audio_base64: b64, mime, verify_speaker: true } }); // V50.z372 — impronta vocale · V50.z483 Deepgram
          if (tRes?.reason === "unknown_voice") { setPhase("idle"); return; } // voce NON riconosciuta → silenzio totale
          const dg = (tRes?.data?.transcript || tRes?.transcript || "").trim();
          if (dg) transcript = dg;
        } catch { /* fallback: testo live del riconoscitore */ }
      }
      if (!transcript) { setPhase("idle"); return; } // V50.z495 — silenzio/rumore: niente errore parlato, si torna in attesa (in «Sempre attivo» riparte)
      setCurrentTranscript(transcript); setLiveText("");

      // Execute intent
      setPhase("executing");
      const pend = pendingRef.current;
      const pendNav = pendingNavRef.current;
      const execBody = { transcript, want_audio: true, ...(tRes?.speaker?.profile_id ? { speaker_profile_id: tRes.speaker.profile_id } : {}), ...(pend ? { pending_contact_id: pend.contact_id, pending_question: pend.question } : {}), ...(pendNav ? { pending_nav_contact_id: pendNav } : {}) };
      let eRes: any = await api("/voice/copilot/execute", { method: "POST", body: execBody });
      let j = eRes?.data || eRes;
      if (j?.intent === "guard_required") { // V50.z371 — comando critico: impronta/Face ID o PIN, poi riesecuzione
        await speak(j.spoken || "Comando critico: confermalo con impronta o PIN.", j.audio_base64);
        const tok = await confirmCritical(j.category);
        if (!tok) throw new Error("Comando critico annullato");
        eRes = await api("/voice/copilot/execute", { method: "POST", body: { ...execBody, guard_token: tok } });
        j = eRes?.data || eRes;
      }
      const confirmation = j?.spoken || j?.extra?.answer || j?.confirmation || "Fatto.";
      const intent = j?.intent || "";
      pendingRef.current = intent === "confirm_contact" && j?.extra?.pending_contact_id ? { contact_id: j.extra.pending_contact_id, question: j.extra.pending_question || transcript } : null;
      // V50.z495 — display dinamico: ritelefonate / nota / navigazione al posto dei suggerimenti
      const disp: DriveDisplayData | null = j?.extra?.display || null;
      pendingNavRef.current = disp?.type === "navigate_choice" ? (j?.extra?.pending_nav_contact_id || disp.contact_id || null) : null;
      setDisplay(disp);
      if (disp?.type === "call" && disp.tel) void Linking.openURL(`tel:${disp.tel}`).catch(() => {}); // V50.z502 — «chiama Rossi» → compone subito
      setCurrentConfirm(confirmation);
      setHistory(prev => [{
        id: `h-${Date.now()}`,
        transcript,
        intent,
        confirmation,
      }, ...prev].slice(0, 20));

      // TTS (audio già pronto → nessun secondo round-trip)
      await speak(confirmation, j?.audio_base64);
    } catch (e: any) {
      const err = e?.response?.data?.detail || e?.message || String(e);
      setPhase("error");
      notify("Axon Drive", err); // V50.z483 — prima l'errore era solo «parlato»: con TTS muto sembrava che non succedesse nulla
      setHistory(prev => [{
        id: `h-${Date.now()}`,
        transcript: currentTranscript,
        error: err,
      }, ...prev].slice(0, 20));
      await speak(`Errore: ${err}`);
    }
  };

  const phaseLabel: Record<Phase, string> = {
    idle: mode === "always" ? (alwaysOn ? "Riprendo l'ascolto…" : "Tocca «Sempre attivo» per l'ascolto continuo") : "Tocca «Tocca per parlare» e parla",
    recording: mode === "always" ? "Ti ascolto — parla pure" : "Sto ascoltando… (invio dopo una pausa)",
    transcribing: "Sto trascrivendo…",
    executing: "Sto eseguendo…",
    speaking: "Conferma vocale…",
    error: "Errore — riprova",
  };

  // V50.z495 — «Sempre attivo»: finita la risposta (o dopo un errore) il microfono si riapre da solo
  useEffect(() => {
    if (resumeTimerRef.current) { clearTimeout(resumeTimerRef.current); resumeTimerRef.current = null; }
    if ((phase === "idle" || phase === "error") && modeRef.current === "always" && alwaysOnRef.current) {
      resumeTimerRef.current = setTimeout(() => { if (alwaysOnRef.current && (phaseRef.current === "idle" || phaseRef.current === "error")) void startRecording(); }, phase === "error" ? 2500 : 600);
    }
    return () => { if (resumeTimerRef.current) { clearTimeout(resumeTimerRef.current); resumeTimerRef.current = null; } };
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // V50.z495 — dopo 5 s di inattività (risposta finita) si torna ai comandi suggeriti
  useEffect(() => {
    if (idleResetRef.current) { clearTimeout(idleResetRef.current); idleResetRef.current = null; }
    if (phase === "idle" && (display || currentConfirm || currentTranscript) && display?.type !== "navigate" && !pendingNavRef.current && !pendingRef.current) { // V50.z497 — la mappa resta attiva finché guidi (nuovo comando la sostituisce)
      idleResetRef.current = setTimeout(() => { setDisplay(null); setCurrentConfirm(""); setCurrentTranscript(""); }, DRIVE_IDLE_RESET_MS);
    }
    return () => { if (idleResetRef.current) { clearTimeout(idleResetRef.current); idleResetRef.current = null; } };
  }, [phase, display, currentConfirm, currentTranscript]);

  // uscita dalla schermata: fermo tutto
  useEffect(() => () => {
    alwaysOnRef.current = false;
    clearListenTimers();
    try { ExpoSpeechRecognitionModule.abort(); } catch { /* noop */ }
    _micRelease?.(); _micRelease = null;
    const p = ttsPlayerRef.current; ttsPlayerRef.current = null;
    try { p?.pause?.(); p?.release?.(); } catch { /* noop */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pickAddress = (opt: DriveAddressOption) => {
    const d = display?.type === "navigate_choice" ? display : null;
    if (!d) return;
    pendingNavRef.current = null;
    const next: DriveDisplayData = { type: "navigate", contact_name: d.contact_name, contact_id: d.contact_id, address: opt.address, address_label: opt.label, nav_app: d.nav_app };
    setDisplay(next);
    void speak(`Ti porto da ${d.contact_name}: ${opt.address}.`);
  };

  // V50.z497 — i due bottoni in basso sono ANCHE il comando: «Tocca per parlare» = tocca → parli → invio dopo la pausa (ri-tocco = invia subito);
  // «Sempre attivo» = avvia/ferma l'ascolto continuo. Nessun microfono centrale.
  const onModePress = (m: DriveAudioMode) => {
    if (m !== modeRef.current) changeMode(m);
    if (m === "tap") {
      if (phaseRef.current === "recording") void stopAndProcess();
      else if (phaseRef.current === "speaking") stopSpeaking();
      else void startRecording();
      return;
    }
    if (alwaysOnRef.current) { setAlwaysOn(false); if (phaseRef.current === "recording") void stopAndProcess(); else if (phaseRef.current === "speaking") stopSpeaking(); }
    else { setAlwaysOn(true); void startRecording(); }
  };

  const phaseColor: Record<Phase, string> = {
    idle: "#38BDF8",
    recording: "#DC2626",
    transcribing: "#F59E0B",
    executing: "#7C3AED",
    speaking: "#10B981",
    error: "#EF4444",
  };
  const listening = phase === "recording";
  const statusLine = listening ? (liveText || "Ti ascolto…") : phase === "idle" ? currentConfirm : (currentConfirm && phase === "speaking" ? currentConfirm : phaseLabel[phase]);

  return (
    <View style={styles.root}>
      {/* Sfondo: interno auto notturno (scuro, atmosferico) + velo per leggibilità */}
      <Image source={require("../assets/images/axon-drive-bg.jpg")} style={styles.bg} resizeMode="cover" />
      <LinearGradient colors={["rgba(6,14,26,0.42)", "rgba(6,14,26,0.30)", "rgba(6,14,26,0.86)", "#060E1A"]} locations={[0, 0.35, 0.72, 1]} style={styles.bg} />

      <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.headerBtn} testID="voice-back">
            <Ionicons name="chevron-back" size={24} color="#FFF" />
          </Pressable>
          <View style={styles.headerTitleRow}>
            <Ionicons name="car-sport" size={18} color="#A78BFA" />
            <Text style={styles.headerTitle}>Axon Drive</Text>
          </View>
          <Animated.View style={[styles.wheelMini, { transform: [{ scale: listening ? pulseAnim : 1 }], borderColor: phaseColor[phase] }]} testID="drive-wheel">
            <MaterialCommunityIcons name="steering" size={22} color="rgba(255,255,255,0.92)" />
          </Animated.View>
        </View>

        {/* Stato / trascrizione live / risposta di Axon — V50.z500: in attesa NESSUN testo (niente «Tocca … e parla») */}
        {phase !== "idle" || currentConfirm || cancelledFlash ? (
          <View style={styles.statusRow} testID="drive-status">
            <View style={[styles.statusDot, { backgroundColor: phaseColor[phase] }]} />
            <Text style={[styles.statusText, { color: listening ? "#FFF" : phaseColor[phase] }]} numberOfLines={2}>
              {cancelledFlash ? "Messaggio cancellato — dimmi il nuovo comando" : statusLine}
            </Text>
            {phase === "transcribing" || phase === "executing" ? <ActivityIndicator size="small" color={phaseColor[phase]} /> : null}
          </View>
        ) : null}

        {/* DISPLAY DINAMICO CENTRALE: suggerimenti → mappa / foto / elenco / nota → (5 s) suggerimenti */}
        <View style={styles.display}>
          <DriveDisplay data={display} onPickAddress={pickAddress} suggestionsHidden={suggestionsHidden} onHideSuggestions={hideSuggestions} />
        </View>

        {/* In basso SOLO i due bottoni, grandi e affiancati */}
        <View style={styles.footer}>
          <DriveModeButtons mode={mode} onPress={onModePress} listening={listening} alwaysOn={alwaysOn} busy={phase === "transcribing" || phase === "executing"} />
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#060E1A" },
  bg: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 10 },
  headerBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.14)", alignItems: "center", justifyContent: "center" },
  headerTitleRow: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(6,14,26,0.55)", paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999 },
  headerTitle: { color: "#FFF", fontSize: 17, fontWeight: "900", letterSpacing: 0.3 },
  wheelMini: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(6,14,26,0.55)", borderWidth: 2 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 16, marginBottom: 10, backgroundColor: "rgba(6,14,26,0.66)", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, minHeight: 48 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { flex: 1, fontSize: 15, fontWeight: "800", lineHeight: 20 },
  display: { flex: 1, marginHorizontal: 16, marginBottom: 12 },
  footer: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 12 },
});

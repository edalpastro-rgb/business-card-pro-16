/**
 * V50.o — Axon Drive (ex "Copilot Vocale · Modalità Auto") — hands-free in auto
 * V50.z177 — solo UI: sfondo interno auto, volante centrale, esempi in primo piano (logica invariata)
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
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Platform, Animated, Image, ScrollView } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useAudioRecorder, AudioModule, RecordingPresets } from "expo-audio";
import { confirmCritical } from "@/src/violawake/guard"; // V50.z371
import * as FileSystem from "expo-file-system/legacy";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
// V50.z186 — stop vocale (barge-in nativo) + audio in background (moduli isolati)
import { useNativeBargeIn } from "@/src/voice/useNativeBargeIn";
import { ensureVoiceAudioMode } from "@/src/voice/voiceAudioMode";

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
  // V50.z368 — preset voce (file ~4× più piccolo → upload e Whisper più rapidi)
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, sampleRate: 16000, numberOfChannels: 1, bitRate: 48000 });

  const [phase, setPhase] = useState<Phase>("idle");
  const [currentTranscript, setCurrentTranscript] = useState("");
  const [currentConfirm, setCurrentConfirm] = useState("");
  const pendingRef = useRef<{ contact_id: string; question: string } | null>(null); // V50.z368 — «Intendi il tuo cliente X?»
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

  const startRecording = async () => {
    if (permission === false) {
      notify("Microfono", "Permesso microfono negato. Vai in Impostazioni per abilitarlo.");
      return;
    }
    if (phase !== "idle") return;
    setCurrentTranscript("");
    setCurrentConfirm("");
    setPhase("recording");
    try {
      await ensureVoiceAudioMode({ recording: true }); // V50.z186 — registrazione continua in background
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch (e: any) {
      setPhase("error");
      notify("Errore", `Registrazione fallita: ${e?.message || e}`);
    }
  };

  const stopAndProcess = async () => {
    if (phase !== "recording") return;
    setPhase("transcribing");
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) throw new Error("Nessun audio registrato");
      // Read as base64 and send to /api/ai/transcribe
      const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      const tRes: any = await api("/ai/transcribe", { method: "POST", body: { audio_base64: b64, mime: "audio/m4a", verify_speaker: true } }); // V50.z372 — impronta vocale
      if (tRes?.reason === "unknown_voice") { setPhase("idle"); return; } // voce NON riconosciuta → silenzio totale
      const transcript = (tRes?.data?.transcript || tRes?.transcript || "").trim();
      if (!transcript) throw new Error("Trascrizione vuota");
      setCurrentTranscript(transcript);

      // Execute intent
      setPhase("executing");
      const pend = pendingRef.current;
      const execBody = { transcript, want_audio: true, ...(tRes?.speaker?.profile_id ? { speaker_profile_id: tRes.speaker.profile_id } : {}), ...(pend ? { pending_contact_id: pend.contact_id, pending_question: pend.question } : {}) };
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
      setHistory(prev => [{
        id: `h-${Date.now()}`,
        transcript: currentTranscript,
        error: err,
      }, ...prev].slice(0, 20));
      await speak(`Errore: ${err}`);
    }
  };

  const phaseLabel: Record<Phase, string> = {
    idle: "Tocca il microfono e parla",
    recording: "Sto ascoltando…",
    transcribing: "Sto trascrivendo…",
    executing: "Sto eseguendo…",
    speaking: "Conferma vocale…",
    error: "Errore — riprova",
  };

  const phaseColor: Record<Phase, string> = {
    idle: "#38BDF8",
    recording: "#DC2626",
    transcribing: "#F59E0B",
    executing: "#7C3AED",
    speaking: "#10B981",
    error: "#EF4444",
  };

  const busy = phase === "transcribing" || phase === "executing" || phase === "speaking";
  const listening = phase === "recording";

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
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false} bounces={false}>
          {/* Volante grande al centro */}
          <View style={styles.wheelWrap} testID="drive-wheel">
            <View style={[styles.wheelGlow, { shadowColor: phaseColor[phase] }]} />
            <MaterialCommunityIcons name="steering" size={112} color="rgba(255,255,255,0.92)" />
          </View>

          <Text style={styles.headline} testID="drive-headline">Parla con Axon mentre guidi</Text>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: phaseColor[phase] }]} />
            <Text style={[styles.statusText, { color: phaseColor[phase] }]}>{phaseLabel[phase]}</Text>
          </View>

          {currentTranscript ? (
            <View style={styles.bubble}>
              <Text style={styles.bubbleLabel}>Tu hai detto</Text>
              <Text style={styles.bubbleText}>{currentTranscript}</Text>
            </View>
          ) : null}

          {currentConfirm ? (
            <View style={[styles.bubble, { borderColor: "#10B981", backgroundColor: "rgba(16,185,129,0.16)" }]}>
              <Text style={[styles.bubbleLabel, { color: "#10B981" }]}>Fatto ✓</Text>
              <Text style={styles.bubbleText}>{currentConfirm}</Text>
            </View>
          ) : null}

          {/* Esempi in primo piano: testo grande, icona a fianco */}
          <View style={styles.examples} testID="drive-examples">
            {EXAMPLES.map((ex) => (
              <View key={ex.title} style={styles.exRow}>
                <Text style={styles.exEmoji}>{ex.emoji}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.exTitle}>{ex.title}</Text>
                  <Text style={styles.exSample} numberOfLines={2}>&ldquo;{ex.sample}&rdquo;</Text>
                </View>
              </View>
            ))}
          </View>
        </ScrollView>

        {/* Microfono centrale e prominente */}
        <View style={styles.footer}>
          <Animated.View style={{ transform: [{ scale: listening ? pulseAnim : 1 }] }}>
            <Pressable
              onPress={listening ? stopAndProcess : startRecording}
              disabled={busy}
              style={[styles.mic, { backgroundColor: listening ? "#DC2626" : "#38BDF8", shadowColor: listening ? "#DC2626" : "#38BDF8" }, busy && { opacity: 0.55 }]}
              testID="voice-mic-button"
            >
              {busy ? (
                <ActivityIndicator size="large" color="#FFF" />
              ) : (
                <Ionicons name={listening ? "stop" : "mic"} size={64} color="#FFF" />
              )}
            </Pressable>
          </Animated.View>
          <Text style={styles.footerHint}>{listening ? "Tocca per fermare e inviare" : "Tocca per parlare"}</Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

const EXAMPLES = [
  { emoji: "🧑", title: "Crea un contatto", sample: "Crea contatto Mario Rossi 333 1234567 Milano energia" },
  { emoji: "📝", title: "Aggiungi una nota", sample: "Aggiungi nota su Rossi: proposta gas entro venerdì" },
  { emoji: "📞", title: "Programma una richiamata", sample: "Programma richiamata a Rossi domani alle 15" },
  { emoji: "💬", title: "Chiedi qualcosa ad Axon", sample: "Che appuntamenti ho oggi? Che tempo fa a Padova?" },
];

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#060E1A" },
  bg: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12 },
  headerBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.14)", alignItems: "center", justifyContent: "center" },
  headerTitleRow: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(6,14,26,0.55)", paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999 },
  headerTitle: { color: "#FFF", fontSize: 17, fontWeight: "900", letterSpacing: 0.3 },
  body: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, gap: 14, alignItems: "center" },
  wheelWrap: { width: 146, height: 146, borderRadius: 73, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(6,14,26,0.45)", borderWidth: 1, borderColor: "rgba(255,255,255,0.18)", marginTop: 4 },
  wheelGlow: { position: "absolute", width: 128, height: 128, borderRadius: 64, backgroundColor: "rgba(56,189,248,0.10)", shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.9, shadowRadius: 30, elevation: 0 },
  headline: { color: "#FFF", fontSize: 24, fontWeight: "900", textAlign: "center", lineHeight: 32, textShadowColor: "rgba(0,0,0,0.6)", textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 8 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(6,14,26,0.6)", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { fontSize: 14, fontWeight: "800" },
  bubble: { alignSelf: "stretch", borderWidth: 1.5, borderColor: "#38BDF8", backgroundColor: "rgba(56,189,248,0.16)", borderRadius: 14, padding: 14 },
  bubbleLabel: { color: "#38BDF8", fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 },
  bubbleText: { color: "#FFF", fontSize: 17, lineHeight: 23, fontWeight: "600" },
  examples: { alignSelf: "stretch", backgroundColor: "rgba(6,14,26,0.66)", borderRadius: 18, padding: 12, gap: 6, borderWidth: 1, borderColor: "rgba(255,255,255,0.12)" },
  exRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8, paddingHorizontal: 6, minHeight: 56 },
  exEmoji: { fontSize: 30, width: 40, textAlign: "center" },
  exTitle: { color: "#FFF", fontSize: 18, fontWeight: "800" },
  exSample: { color: "rgba(255,255,255,0.72)", fontSize: 13, lineHeight: 18, marginTop: 2 },
  footer: { alignItems: "center", paddingTop: 10, paddingBottom: 16, gap: 10 },
  mic: { width: 140, height: 140, borderRadius: 70, alignItems: "center", justifyContent: "center", borderWidth: 4, borderColor: "rgba(255,255,255,0.35)", shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.6, shadowRadius: 30, elevation: 20 },
  footerHint: { color: "rgba(255,255,255,0.85)", fontSize: 14, fontWeight: "700" },
});

/**
 * V50.o — Copilot Vocale in Auto (hands-free)
 *
 * Modalità full-screen con grande pulsante microfono per uso hands-free
 * (mentre l'utente guida). Flusso:
 *  1. Utente tocca il mic (o attiva "modalità auto" con auto-stop dopo silenzio)
 *  2. Registra audio → invia a /api/ai/transcribe (whisper)
 *  3. Trascritto → invia a /api/voice/copilot/execute (intent parsing + esecuzione)
 *  4. Legge ad alta voce la confermatext via TTS emergent
 *  5. Torna in ascolto per il prossimo comando
 *
 * Progettato per essere USATO GUIDANDO: bottoni enormi, feedback visivo grande,
 * niente tastiera, niente scorrimento fine.
 */
import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Platform, Animated } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useAudioRecorder, AudioModule, RecordingPresets } from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";

const C = theme.color;

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
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const [phase, setPhase] = useState<Phase>("idle");
  const [currentTranscript, setCurrentTranscript] = useState("");
  const [currentConfirm, setCurrentConfirm] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [permission, setPermission] = useState<boolean | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

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

  const speak = async (text: string) => {
    if (!text) return;
    setPhase("speaking");
    try {
      // Emergent OpenAI TTS via backend
      const res = await api.post("/ai/tts", { text: text.slice(0, 500), voice: "nova" });
      const b64 = (res as any)?.data?.audio_base64 || (res as any)?.audio_base64;
      if (b64) {
        if (Platform.OS === "web") {
          const audio = new (globalThis as any).Audio(`data:audio/mp3;base64,${b64}`);
          audio.play();
          audio.onended = () => setPhase("idle");
        } else {
          const AudioMod: any = await import("expo-audio");
          const path = FileSystem.cacheDirectory + `tts-${Date.now()}.mp3`;
          await FileSystem.writeAsStringAsync(path, b64, { encoding: FileSystem.EncodingType.Base64 });
          const player = AudioMod.createAudioPlayer({ uri: path });
          player.play();
          setTimeout(() => setPhase("idle"), Math.max(2000, text.length * 60));
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
      notify.warning("Permesso microfono negato. Vai in Impostazioni per abilitarlo.");
      return;
    }
    if (phase !== "idle") return;
    setCurrentTranscript("");
    setCurrentConfirm("");
    setPhase("recording");
    try {
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch (e: any) {
      setPhase("error");
      notify.error(`Registrazione fallita: ${e?.message || e}`);
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
      const tRes: any = await api.post("/ai/transcribe", { audio_base64: b64, mime: "audio/m4a" });
      const transcript = (tRes?.data?.transcript || tRes?.transcript || "").trim();
      if (!transcript) throw new Error("Trascrizione vuota");
      setCurrentTranscript(transcript);

      // Execute intent
      setPhase("executing");
      const eRes: any = await api.post("/voice/copilot/execute", { transcript });
      const j = eRes?.data || eRes;
      const confirmation = j?.confirmation || "Fatto.";
      const intent = j?.intent || "";
      setCurrentConfirm(confirmation);
      setHistory(prev => [{
        id: `h-${Date.now()}`,
        transcript,
        intent,
        confirmation,
      }, ...prev].slice(0, 20));

      // TTS
      await speak(confirmation);
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

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.headerBtn} testID="voice-back">
          <Ionicons name="chevron-back" size={24} color="#FFF" />
        </Pressable>
        <Text style={styles.headerTitle}>Copilot Vocale · Modalità Auto</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.body}>
        <View style={styles.statusBox}>
          <View style={[styles.statusDot, { backgroundColor: phaseColor[phase] }]} />
          <Text style={styles.statusText}>{phaseLabel[phase]}</Text>
        </View>

        {currentTranscript ? (
          <View style={styles.bubble}>
            <Text style={styles.bubbleLabel}>Tu hai detto</Text>
            <Text style={styles.bubbleText}>{currentTranscript}</Text>
          </View>
        ) : null}

        {currentConfirm ? (
          <View style={[styles.bubble, { borderColor: "#10B981", backgroundColor: "rgba(16,185,129,0.12)" }]}>
            <Text style={[styles.bubbleLabel, { color: "#10B981" }]}>Fatto ✓</Text>
            <Text style={styles.bubbleText}>{currentConfirm}</Text>
          </View>
        ) : null}

        <View style={styles.hints}>
          <Text style={styles.hintTitle}>Esempi:</Text>
          <Text style={styles.hint}>• &quot;Crea contatto Mario Rossi 333 1234567 Milano energia&quot;</Text>
          <Text style={styles.hint}>• &quot;Aggiungi nota su Rossi: proposta gas entro venerdì&quot;</Text>
          <Text style={styles.hint}>• &quot;Programma richiamata a Rossi domani alle 15&quot;</Text>
        </View>
      </View>

      <View style={styles.footer}>
        <Animated.View style={{ transform: [{ scale: phase === "recording" ? pulseAnim : 1 }] }}>
          <Pressable
            onPress={phase === "recording" ? stopAndProcess : startRecording}
            disabled={phase !== "idle" && phase !== "recording"}
            style={[
              styles.mic,
              { backgroundColor: phase === "recording" ? "#DC2626" : "#38BDF8" },
              (phase !== "idle" && phase !== "recording") && { opacity: 0.5 },
            ]}
            testID="voice-mic-button"
          >
            {phase === "transcribing" || phase === "executing" || phase === "speaking" ? (
              <ActivityIndicator size="large" color="#FFF" />
            ) : (
              <Ionicons
                name={phase === "recording" ? "stop" : "mic"}
                size={64}
                color="#FFF"
              />
            )}
          </Pressable>
        </Animated.View>
        <Text style={styles.footerHint}>
          {phase === "recording" ? "Tocca per fermare e inviare" : "Tocca per parlare"}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0F2438" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center", justifyContent: "center",
  },
  headerTitle: { color: "#FFF", fontSize: 15, fontWeight: "800" },
  body: { flex: 1, padding: 20, gap: 16 },
  statusBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
  },
  statusDot: { width: 12, height: 12, borderRadius: 6 },
  statusText: { color: "#FFF", fontSize: 15, fontWeight: "700" },
  bubble: {
    borderWidth: 1.5,
    borderColor: "#38BDF8",
    backgroundColor: "rgba(56,189,248,0.12)",
    borderRadius: 14,
    padding: 14,
  },
  bubbleLabel: { color: "#38BDF8", fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 },
  bubbleText: { color: "#FFF", fontSize: 16, lineHeight: 22 },
  hints: {
    marginTop: "auto",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  hintTitle: { color: "rgba(255,255,255,0.85)", fontSize: 12, fontWeight: "800", marginBottom: 4 },
  hint: { color: "rgba(255,255,255,0.65)", fontSize: 12, lineHeight: 18 },
  footer: {
    alignItems: "center",
    paddingBottom: 32,
    gap: 12,
  },
  mic: {
    width: 140, height: 140, borderRadius: 70,
    alignItems: "center", justifyContent: "center",
    shadowColor: "#38BDF8", shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.5, shadowRadius: 30,
    elevation: 20,
  },
  footerHint: { color: "rgba(255,255,255,0.7)", fontSize: 13, fontWeight: "600" },
});

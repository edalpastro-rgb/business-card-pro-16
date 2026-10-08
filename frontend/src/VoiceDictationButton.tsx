import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Platform, Animated, Linking } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { transcribeUpload } from "@/src/utils/upload";
import { notify } from "@/src/utils/notify";
import { useAudioRecorder, AudioModule, RecordingPresets } from "expo-audio"; // V50.z247 — dettatura anche su iOS/Android nativi
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium
import { acquireMicLease } from "@/src/utils/micLease"; // V50.z483 — pausa wake-word mentre si registra
import { ensureDevicePermission } from "@/src/permissions/devicePermissions"; // V50.z484 — alert permesso di sistema mancante
let _micRelease: null | (() => void) = null;

type Props = {
  onTranscript: (text: string) => void;
  label?: string;
  compact?: boolean;
  testID?: string;
};

/**
 * Voice dictation button that records audio via MediaRecorder (web) or expo-audio (iOS/Android, V50.z247 — prima mostrava
 * «Non supportato» sull'app nativa) and sends it to the backend Whisper endpoint for Italian transcription.
 */
export function VoiceDictationButton({ onTranscript, label = "Dettatura", compact = false, testID }: Props) {
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<any>(null);
  const durationRef = useRef(0);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!recording) {
      pulseAnim.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.35, duration: 700, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1.0, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [recording, pulseAnim]);

  useEffect(() => {
    return () => {
      // Cleanup on unmount
      if (timerRef.current) clearInterval(timerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        try { mediaRecorderRef.current.stop(); } catch {}
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop()); _micRelease?.(); _micRelease = null; // V50.z483
      }
    };
  }, []);

  const isNative = Platform.OS !== "web";
  const supported = isNative || (typeof navigator !== "undefined" &&
    !!navigator.mediaDevices && typeof (globalThis as any).MediaRecorder !== "undefined");

  // V50.z247 — Nativo: expo-audio recorder (m4a) → Whisper via multipart (stesso endpoint del web)
  const nativeRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const nativeRecordingRef = useRef(false);

  const startNativeRecording = async () => {
    try {
      const perm = await AudioModule.getRecordingPermissionsAsync();
      let granted = perm.granted;
      if (!granted) {
        if (!perm.canAskAgain) {
          notify("Microfono disattivato", "Abilita il microfono nelle impostazioni per usare la dettatura.", [{ text: "Apri impostazioni", onPress: () => Linking.openSettings() }, { text: "Ok" }]);
          return;
        }
        granted = (await AudioModule.requestRecordingPermissionsAsync()).granted;
        if (!granted) return;
      }
      if (!(await ensureDevicePermission("microphone"))) return; // V50.z484
      await nativeRecorder.prepareToRecordAsync();
      nativeRecorder.record(); _micRelease?.(); _micRelease = acquireMicLease(); // V50.z483
      nativeRecordingRef.current = true;
      setRecording(true);
      durationRef.current = 0;
      setDuration(0);
      timerRef.current = setInterval(() => {
        durationRef.current += 1;
        setDuration(durationRef.current);
        if (durationRef.current >= 600) stopRecording(); // V50.z483 — 10 min (relazioni lunghe)
      }, 1000);
    } catch (e: any) {
      const msg = e?.message || "Errore microfono";
      setError(msg);
      notify("Microfono", msg);
    }
  };

  const stopNativeRecording = async () => {
    if (!nativeRecordingRef.current) return;
    nativeRecordingRef.current = false;
    setProcessing(true);
    try {
      await nativeRecorder.stop(); _micRelease?.(); _micRelease = null; // V50.z483
      const uri = nativeRecorder.uri;
      if (!uri) { setProcessing(false); return; }
      if (durationRef.current < 1) { notify("Registrazione troppo corta", "Parla per almeno 1 secondo."); setProcessing(false); return; }
      const txt = await transcribeUpload({ uri, name: "dettato.m4a", mime: "audio/m4a" });
      if (!txt) notify("Trascrizione vuota", "Non è stato possibile riconoscere il parlato. Riprova.");
      else onTranscript(txt);
    } catch (e: any) {
      const msg = e?.message || "Errore trascrizione";
      setError(msg);
      notify("Errore trascrizione", msg);
    } finally {
      setProcessing(false);
    }
  };

  const startRecording = async () => {
    setError(null);
    if (isNative) { await startNativeRecording(); return; }
    if (!supported) {
      notify("Non supportato", "La dettatura vocale funziona solo dai browser. Su iOS usa Safari 14.5+ o Chrome.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      // Choose mimeType compatible with Whisper (webm/opus works everywhere except Safari old)
      let mimeType = "audio/webm;codecs=opus";
      const MR: any = (globalThis as any).MediaRecorder;
      if (MR?.isTypeSupported && !MR.isTypeSupported(mimeType)) {
        if (MR.isTypeSupported("audio/webm")) mimeType = "audio/webm";
        else if (MR.isTypeSupported("audio/mp4")) mimeType = "audio/mp4";
        else if (MR.isTypeSupported("audio/mpeg")) mimeType = "audio/mpeg";
        else mimeType = ""; // let browser decide
      }
      const rec = mimeType ? new MR(stream, { mimeType }) : new MR(stream);
      mediaRecorderRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (ev: BlobEvent) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      rec.onstop = () => {
        void handleStop(rec.mimeType);
      };
      rec.start(); _micRelease?.(); _micRelease = acquireMicLease(); // V50.z483
      setRecording(true);
      durationRef.current = 0;
      setDuration(0);
      timerRef.current = setInterval(() => {
        durationRef.current += 1;
        setDuration(durationRef.current);
        // Auto-stop after 600 seconds (V50.z483 — 10 min)
        if (durationRef.current >= 600) {
          stopRecording();
        }
      }, 1000);
    } catch (e: any) {
      console.warn("mic err", e);
      const msg = e?.name === "NotAllowedError"
        ? "Permesso microfono negato. Attivalo nelle impostazioni del browser."
        : e?.name === "NotFoundError"
        ? "Nessun microfono trovato sul dispositivo."
        : e?.message || "Errore microfono";
      setError(msg);
      notify("Microfono", msg);
    }
  };

  const stopRecording = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setRecording(false);
    if (isNative) { void stopNativeRecording(); return; }
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
    } catch (e) {
      console.warn("stop err", e);
    }
  };

  const handleStop = async (recMime: string) => {
    setProcessing(true);
    try {
      // Free the mic
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop()); _micRelease?.(); _micRelease = null; // V50.z483
        streamRef.current = null;
      }
      const parts = chunksRef.current;
      chunksRef.current = [];
      if (parts.length === 0) {
        setProcessing(false);
        return;
      }
      const blob = new Blob(parts, { type: recMime || parts[0].type || "audio/webm" });
      if (blob.size < 1024) {
        notify("Registrazione troppo corta", "Parla per almeno 1 secondo.");
        setProcessing(false);
        return;
      }
      // V50.z202 — multipart a chunk (niente base64 in RAM/JSON)
      const txt = await transcribeUpload({ blob, name: `dettato.${(blob.type || "audio/webm").includes("mp4") ? "m4a" : "webm"}`, mime: blob.type || "audio/webm" });
      if (!txt) {
        notify("Trascrizione vuota", "Non è stato possibile riconoscere il parlato. Riprova.");
      } else {
        onTranscript(txt);
      }
    } catch (e: any) {
      console.warn("transcribe err", e);
      const msg = e?.message || "Errore trascrizione";
      setError(msg);
      notify("Errore trascrizione", msg);
    } finally {
      setProcessing(false);
    }
  };

  const onPress = () => {
    if (processing) return;
    if (recording) stopRecording();
    else startRecording();
  };

  const btnColor = recording ? "#DC2626" : processing ? HT.muted : "#7C3AED";
  const iconName = recording ? "stop" : processing ? "ellipsis-horizontal" : "mic";

  return (
    <View style={compact ? styles.wrapCompact : styles.wrap}>
      <Pressable
        testID={testID || "voice-dictation-btn"}
        onPress={onPress}
        disabled={processing || (!supported && Platform.OS === "web")}
        style={[styles.btn, { backgroundColor: btnColor, opacity: (!supported && Platform.OS === "web") ? 0.5 : 1 }]}
        accessibilityLabel={recording ? "Ferma dettatura" : "Avvia dettatura vocale"}
      >
        {processing ? (
          <ActivityIndicator color="#FFF" size="small" />
        ) : (
          <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
            <Ionicons name={iconName as any} size={compact ? 18 : 22} color="#FFF" />
          </Animated.View>
        )}
      </Pressable>
      {!compact && (
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={styles.label}>
            {recording ? `In ascolto… ${duration}s`
              : processing ? "Trascrizione in corso…"
              : (!supported ? "Non supportato" : (label || "Premi per dettare"))}
          </Text>
          {recording && <Text style={styles.hint}>Premi di nuovo per fermare e trascrivere</Text>}
          {!recording && !processing && supported && <Text style={styles.hint}>La voce sarà trascritta in italiano</Text>}
          {error && !recording && !processing && <Text style={styles.err}>{error}</Text>}
        </View>
      )}
    </View>
  );
}


const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: HT.violetTint,
    borderRadius: 10,
    padding: 10,
    marginTop: 8,
    borderWidth: 1,
    borderColor: HT.violet + '66',
  },
  wrapCompact: { flexDirection: "row", alignItems: "center" },
  btn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 3,
    elevation: 3,
  },
  label: { fontSize: 13, fontWeight: "700", color: HT.text },
  hint: { fontSize: 11, color: HT.muted, marginTop: 2 },
  err: { fontSize: 11, color: "#DC2626", marginTop: 2 },
});

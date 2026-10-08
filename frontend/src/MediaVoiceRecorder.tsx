// MediaVoiceRecorder.tsx — V50.z199 — Registratore compatto per l'Archivio media (Fase 3).
// Un solo bottone «Audio» → registra (web MediaRecorder / nativo expo-audio) → «Stop» → onDone(base64, mime, durata).
// Permessi microfono gestiti: undetermined → richiesta contestuale; negato definitivo → «Apri impostazioni».
import React, { useEffect, useRef, useState } from "react";
import { Pressable, Text, StyleSheet, Platform, Alert, Linking } from "react-native";
import { useAudioRecorder, RecordingPresets } from "expo-audio"; // V50.z255 — hook ufficiale (createAudioRecorder non esiste in expo-audio)
import { Ionicons } from "@expo/vector-icons";
import { notify } from "@/src/utils/notify";
import { acquireMicLease } from "@/src/utils/micLease"; // V50.z483 — pausa wake-word mentre si registra
let _micRelease: null | (() => void) = null;

type Props = { color: string; disabled?: boolean; onDone: (b64: string, mime: string, durationSec: number) => void; onRecordingChange?: (r: boolean) => void };

export function MediaVoiceRecorder({ color, disabled, onDone, onRecordingChange }: Props) {
  const [rec, setRec] = useState(false);
  const [sec, setSec] = useState(0);
  const timer = useRef<any>(null);
  const webRec = useRef<any>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const native = useRef<any>(null);
  const secRef = useRef(0);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); try { stream.current?.getTracks().forEach((t) => t.stop()); } catch {} }, []);
  useEffect(() => { onRecordingChange?.(rec); }, [rec, onRecordingChange]);

  const tick = () => { secRef.current = 0; setSec(0); timer.current = setInterval(() => { secRef.current += 1; setSec(secRef.current); if (secRef.current >= 600) void stop(); }, 1000); };
  const nativeRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY); // V50.z255

  const start = async () => {
    if (Platform.OS !== "web") {
      try {
        const AudioMod: any = await import("expo-audio");
        let perm = await AudioMod.AudioModule.getRecordingPermissionsAsync();
        if (!perm?.granted) {
          if (perm?.canAskAgain === false) {
            Alert.alert("Microfono disattivato", "Per registrare note vocali abilita il microfono nelle impostazioni.", [{ text: "Annulla", style: "cancel" }, { text: "Apri impostazioni", onPress: () => Linking.openSettings() }]);
            return;
          }
          perm = await AudioMod.AudioModule.requestRecordingPermissionsAsync();
          if (!perm?.granted) { notify("Microfono", "Senza microfono non posso registrare la nota vocale."); return; }
        }
        await AudioMod.setAudioModeAsync?.({ allowsRecording: true, playsInSilentMode: true });
        const r = nativeRecorder; // V50.z255 — prima: AudioMod.createAudioRecorder(...) → «undefined is not a function»
        await r.prepareToRecordAsync(); r.record(); native.current = r; _micRelease?.(); _micRelease = acquireMicLease(); // V50.z483
        tick(); setRec(true);
      } catch (e: any) { notify("Microfono", e?.message || String(e)); }
      return;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.current = s;
      const MR: any = (globalThis as any).MediaRecorder;
      let mime = "audio/webm;codecs=opus";
      if (MR?.isTypeSupported && !MR.isTypeSupported(mime)) mime = MR.isTypeSupported("audio/webm") ? "audio/webm" : MR.isTypeSupported("audio/mp4") ? "audio/mp4" : "";
      const r = mime ? new MR(s, { mimeType: mime }) : new MR(s); webRec.current = r; chunks.current = [];
      r.ondataavailable = (ev: BlobEvent) => { if (ev.data?.size) chunks.current.push(ev.data); };
      r.onstop = async () => {
        s.getTracks().forEach((t) => t.stop()); stream.current = null; _micRelease?.(); _micRelease = null; // V50.z483
        const blob = new Blob(chunks.current, { type: r.mimeType || "audio/webm" });
        if (blob.size < 512) { notify("Registrazione troppo corta"); return; }
        const b64: string = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1] || ""); fr.readAsDataURL(blob); });
        onDone(b64, blob.type || "audio/webm", secRef.current);
      };
      r.start(); tick(); setRec(true); _micRelease?.(); _micRelease = acquireMicLease(); // V50.z483
    } catch (e: any) { notify("Microfono", e?.name === "NotAllowedError" ? "Permesso microfono negato dal browser" : (e?.message || String(e))); }
  };

  const stop = async () => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    setRec(false);
    if (Platform.OS !== "web") {
      try {
        const r = native.current; native.current = null;
        if (!r) return;
        await r.stop(); _micRelease?.(); _micRelease = null; // V50.z483
        const FS: any = await import("expo-file-system/legacy");
        const uri: string | undefined = r.uri;
        if (!uri) return;
        const b64 = await FS.readAsStringAsync(uri, { encoding: FS.EncodingType.Base64 });
        if (b64.length < 700) { notify("Registrazione troppo corta"); return; }
        onDone(b64, "audio/m4a", secRef.current);
      } catch (e: any) { notify("Errore stop", e?.message || String(e)); }
      return;
    }
    try { if (webRec.current && webRec.current.state !== "inactive") webRec.current.stop(); } catch {}
  };

  return (
    <Pressable onPress={() => (rec ? void stop() : void start())} disabled={disabled && !rec} style={[styles.big, { backgroundColor: rec ? "#DC2626" : color }]} testID="axm-record-audio">
      <Ionicons name={rec ? "stop" : "mic"} size={22} color="#FFF" />
      <Text style={styles.txt}>{rec ? `Stop ${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}` : "Audio"}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  big: { flex: 1, minHeight: 64, borderRadius: 16, alignItems: "center", justifyContent: "center", gap: 4, paddingHorizontal: 4 },
  txt: { color: "#FFF", fontWeight: "800", fontSize: 12, textAlign: "center" },
});

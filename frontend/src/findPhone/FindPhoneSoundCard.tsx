// FindPhoneSoundCard.tsx — V50.z493 — Impostazioni → AI & Axon: suono dello squillo «Trova il mio telefono».
// 4 preset sintetici (anteprima ▶) oppure registrazione personale (max 6 s) salvata sul server: il dispositivo bersaglio
// la riproduce in loop quando squilla. (Il suono della notifica Android resta quello di sistema del canale.)
import React, { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAudioRecorder, RecordingPresets } from "expo-audio";
import { HT } from "@/src/homeTheme";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { playAudioBase64 } from "@/src/utils/audioPlayback";
import { ensureDevicePermission } from "@/src/permissions/devicePermissions";
import { startRecording, stopRecording } from "@/src/corporate-gym/voice";
import { FIND_PHONE_PRESETS, presetBase64, getFindPhoneSound, invalidateFindPhoneSound, type FindPhonePreset, type FindPhoneSoundSetting } from "@/src/findPhone/findPhoneSound";

const MAX_REC_MS = 6000;

export function FindPhoneSoundCard() {
  const [setting, setSetting] = useState<FindPhoneSoundSetting | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [rec, setRec] = useState(false);
  const [secs, setSecs] = useState(0);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const timer = useRef<any>(null);

  useEffect(() => { getFindPhoneSound(true).then(setSetting).catch(() => setSetting({ kind: "preset", preset: "axon" })); }, []);

  const save = async (body: FindPhoneSoundSetting, label: string) => {
    setSaving(label);
    try {
      await api("/axon/find-phone-sound", { method: "PUT", body });
      invalidateFindPhoneSound();
      setSetting(body.kind === "custom" ? { kind: "custom", mime: body.mime } : body);
      notify("Suono salvato", `«${label}» sarà lo squillo di «Trova il mio telefono».`);
    } catch (e: any) { notify("Errore", e?.message || "Impossibile salvare"); }
    finally { setSaving(null); }
  };

  const preview = (id: FindPhonePreset) => { void playAudioBase64(presetBase64(id), "audio/wav").catch(() => {}); };
  const previewCustom = async () => {
    const s = await getFindPhoneSound(true);
    if (s.kind === "custom" && s.b64) void playAudioBase64(s.b64, s.mime || "audio/m4a").catch(() => {});
  };

  const stopRec = async () => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    setRec(false);
    try {
      const a = await stopRecording(Platform.OS === "web" ? null : recorder);
      if (!a) { notify("Registrazione", "Troppo breve: tieni premuto almeno un secondo."); return; }
      await save({ kind: "custom", mime: a.mime, b64: a.b64 }, "La tua registrazione");
    } catch (e: any) { notify("Registrazione", e?.message || "Non riuscita"); }
  };
  const startRec = async () => {
    if (!(await ensureDevicePermission("microphone"))) return;
    try {
      await startRecording(Platform.OS === "web" ? null : recorder);
      setRec(true); setSecs(0);
      const t0 = Date.now();
      timer.current = setInterval(() => { const s = Math.floor((Date.now() - t0) / 1000); setSecs(s); if (Date.now() - t0 >= MAX_REC_MS) void stopRec(); }, 250);
    } catch (e: any) { notify("Microfono", e?.message || "Impossibile registrare"); }
  };

  const cur = setting || { kind: "preset", preset: "axon" };
  return (
    <View style={st.card} testID="find-phone-sound-card">
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Ionicons name="musical-notes" size={20} color={HT.brand} />
        <View style={{ flex: 1 }}>
          <Text style={st.title}>Suono «Trova il mio telefono»</Text>
          <Text style={st.hint}>Lo squillo che parte sul dispositivo quando chiedi ad Axon «dove sei?» da un altro dispositivo.</Text>
        </View>
      </View>
      <View style={st.grid}>
        {FIND_PHONE_PRESETS.map((p) => {
          const on = cur.kind === "preset" && (cur.preset || "axon") === p.id;
          return (
            <View key={p.id} style={[st.opt, on && st.optOn]} testID={`fp-sound-${p.id}`}>
              <Pressable onPress={() => save({ kind: "preset", preset: p.id }, p.label)} style={{ flex: 1, minHeight: 44, justifyContent: "center" }} accessibilityRole="button">
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={18} color={on ? HT.brand : HT.muted} />
                  <Text style={[st.optTxt, on && { color: HT.brand }]}>{p.label}</Text>
                </View>
                <Text style={st.optHint}>{p.hint}</Text>
              </Pressable>
              <Pressable onPress={() => preview(p.id)} hitSlop={8} style={st.play} accessibilityLabel={`Ascolta ${p.label}`} testID={`fp-sound-play-${p.id}`}>
                {saving === p.label ? <ActivityIndicator size="small" color={HT.brand} /> : <Ionicons name="play-circle" size={28} color={HT.brand} />}
              </Pressable>
            </View>
          );
        })}
        <View style={[st.opt, cur.kind === "custom" && st.optOn]} testID="fp-sound-custom">
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Ionicons name={cur.kind === "custom" ? "radio-button-on" : "radio-button-off"} size={18} color={cur.kind === "custom" ? HT.brand : HT.muted} />
              <Text style={[st.optTxt, cur.kind === "custom" && { color: HT.brand }]}>Registra il tuo</Text>
            </View>
            <Text style={st.optHint}>{rec ? `Registrazione… ${secs}s (max 6 s) — tocca per fermare` : cur.kind === "custom" ? "Registrazione personale attiva" : "Tieni il telefono vicino e parla o fischia: max 6 secondi"}</Text>
          </View>
          {cur.kind === "custom" && !rec ? <Pressable onPress={previewCustom} hitSlop={8} style={st.play} accessibilityLabel="Ascolta la registrazione"><Ionicons name="play-circle" size={28} color={HT.brand} /></Pressable> : null}
          <Pressable onPress={rec ? stopRec : startRec} style={[st.recBtn, rec && { backgroundColor: HT.danger }]} accessibilityRole="button" testID="fp-sound-record">
            {saving === "La tua registrazione" ? <ActivityIndicator size="small" color="#FFF" /> : <Ionicons name={rec ? "stop" : "mic"} size={18} color="#FFF" />}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  card: { backgroundColor: HT.card, borderRadius: 16, borderWidth: 1, borderColor: HT.border, padding: 14, gap: 12 },
  title: { color: HT.text, fontWeight: "800", fontSize: 15 },
  hint: { color: HT.muted, fontSize: 12.5, marginTop: 2 },
  grid: { gap: 8 },
  opt: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: HT.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, minHeight: 56 },
  optOn: { borderColor: HT.brand, backgroundColor: HT.brandTint },
  optTxt: { color: HT.text, fontWeight: "800", fontSize: 14 },
  optHint: { color: HT.muted, fontSize: 11.5, marginLeft: 24 },
  play: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  recBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: HT.brand, alignItems: "center", justifyContent: "center" },
});

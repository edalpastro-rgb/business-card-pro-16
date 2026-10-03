// TtsEngineCard.tsx — V50.z414 — Selettore motore vocale di Axon dentro Impostazioni › Assistente (sempre visibile).
// «Dispositivo · Google TTS» = voce di sistema del browser (su Android Chrome: Google TTS italiano, qualità più alta disponibile);
// «Server» = sintesi sul server AdvisorOS (Kokoro locale / OpenAI, streaming frase per frase). Anteprima ascolto per entrambi.
import React, { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { HT } from "@/src/homeTheme";
import { notify } from "@/src/utils/notify";
import { deviceTtsAvailable, deviceTtsSpeak, deviceTtsStop, pickBestItalianVoice } from "@/src/utils/deviceTts";
import { playAudioBase64 } from "@/src/utils/audioPlayback";

type Engine = "device" | "server";
const SAMPLE = "Ciao, sono Axon. Questa è la voce con cui ti parlerò.";

export function TtsEngineCard() {
  const router = useRouter();
  const [engine, setEngine] = useState<Engine>("server");
  const [serverEngine, setServerEngine] = useState<"local" | "cloud">("local");
  const [voiceName, setVoiceName] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<Engine | null>(null);
  const [loading, setLoading] = useState(true);
  const stopRef = useRef<(() => void) | null>(null);
  const canDevice = deviceTtsAvailable();

  useEffect(() => {
    api<{ assistant_tts_engine?: string; assistant_speech_rate?: number }>("/user-settings")
      .then((s) => {
        const e = s?.assistant_tts_engine;
        if (e === "device") setEngine("device"); else { setEngine("server"); if (e === "cloud") setServerEngine("cloud"); }
      })
      .catch(() => {}).finally(() => setLoading(false));
    if (canDevice) void pickBestItalianVoice().then((v) => setVoiceName(v?.name || null));
    return () => { try { stopRef.current?.(); } catch {} deviceTtsStop(); };
  }, [canDevice]);

  const choose = async (e: Engine) => {
    setEngine(e);
    try { await api("/user-settings", { method: "PUT", body: { assistant_tts_engine: e === "device" ? "device" : serverEngine } }); }
    catch (err: any) { notify("Axon", err?.message || "Salvataggio non riuscito"); }
    if (e === "device" && !canDevice) notify("Axon", "Nell'app installata la voce di sistema non è disponibile: Axon userà la voce del server.");
  };

  const preview = async (e: Engine) => {
    try { stopRef.current?.(); } catch {}
    deviceTtsStop();
    setPreviewing(e);
    try {
      if (e === "device") {
        if (!canDevice) { notify("Axon", "Voce di sistema non disponibile su questo dispositivo."); return; }
        await new Promise<void>((res) => { stopRef.current = deviceTtsSpeak(SAMPLE, { onDone: res, force: true }); });
      } else {
        const r = await api<{ audio_base64: string; mime: string }>("/assistant/tts", { method: "POST", body: { text: SAMPLE } });
        if (!r?.audio_base64) return;
        if (Platform.OS === "web") {
          await new Promise<void>((res) => {
            const el = new (window as any).Audio(`data:${r.mime || "audio/mpeg"};base64,${r.audio_base64}`);
            el.onended = () => res(); el.onerror = () => res();
            stopRef.current = () => { try { el.pause(); } catch {} res(); };
            void el.play().catch(() => res());
          });
        } else {
          await new Promise<void>((res) => { void playAudioBase64(r.audio_base64, r.mime || "audio/mpeg", res, { force: true }).then((st: any) => { stopRef.current = () => { try { (typeof st === "function" ? st : st?.stop)?.(); } catch {} res(); }; }).catch(() => res()); });
        }
      }
    } catch (err: any) { notify("Axon", err?.message || "Anteprima non riuscita"); }
    finally { setPreviewing(null); }
  };

  return (
    <View style={s.card} testID="tts-engine-card">
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Ionicons name="volume-high-outline" size={18} color={HT.violet} />
        <Text style={s.title}>Motore vocale di Axon</Text>
        {loading ? <ActivityIndicator size="small" color={HT.violet} /> : null}
      </View>
      <Text style={s.hint}>Con quale voce Axon legge le risposte. Tocca ▶ per ascoltare un'anteprima.</Text>
      {([
        ["device", "Dispositivo · Google TTS", canDevice ? (voiceName ? `Voce di sistema: ${voiceName}` : "Voce italiana di sistema (qualità più alta disponibile)") : "Disponibile su web e Android Chrome; nell'app usa il server", "phone-portrait-outline"],
        ["server", "Server AdvisorOS", serverEngine === "cloud" ? "Sintesi cloud OpenAI, streaming frase per frase" : "Sintesi locale gratuita (Kokoro), streaming frase per frase", "cloud-outline"],
      ] as const).map(([k, lbl, sub, ic]) => {
        const on = engine === k;
        return (
          <View key={k} style={[s.row, on && s.rowOn]}>
            <Pressable onPress={() => choose(k)} style={s.rowMain} testID={`tts-engine-${k}`} accessibilityRole="radio" accessibilityState={{ selected: on }}>
              <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={20} color={on ? HT.violet : HT.muted} />
              <Ionicons name={ic} size={18} color={on ? HT.violet : HT.text2} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[s.lbl, on && { color: HT.violet }]}>{lbl}</Text>
                <Text style={s.sub} numberOfLines={2}>{sub}</Text>
              </View>
            </Pressable>
            <Pressable onPress={() => preview(k)} style={s.play} hitSlop={6} testID={`tts-engine-preview-${k}`} accessibilityLabel={`Ascolta anteprima ${lbl}`}>
              {previewing === k ? <ActivityIndicator size="small" color={HT.violet} /> : <Ionicons name="play" size={18} color={HT.violet} />}
            </Pressable>
          </View>
        );
      })}
      <Pressable onPress={() => router.push("/axon-voice" as any)} style={s.more} testID="tts-engine-more">
        <Text style={s.moreTxt}>Voce, lingua e velocità avanzate</Text>
        <Ionicons name="chevron-forward" size={16} color={HT.violet} />
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: HT.card, borderRadius: 14, borderWidth: 1, borderColor: HT.border, padding: 14, gap: 10, marginTop: 14 },
  title: { fontSize: 15, fontWeight: "900", color: HT.text, flex: 1 },
  hint: { fontSize: 12.5, color: HT.muted, lineHeight: 18 },
  row: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 12, borderWidth: 1, borderColor: HT.border, backgroundColor: HT.card2, paddingRight: 6 },
  rowOn: { borderColor: HT.violet, backgroundColor: HT.violetTint },
  rowMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: 12, minHeight: 56 },
  lbl: { fontSize: 14, fontWeight: "800", color: HT.text },
  sub: { fontSize: 11.5, color: HT.muted, marginTop: 2 },
  play: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: HT.card },
  more: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 40, paddingHorizontal: 4 },
  moreTxt: { fontSize: 13, fontWeight: "700", color: HT.violet },
});

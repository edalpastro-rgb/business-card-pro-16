// axon-voice.tsx — V50.z271 — «Voce e lingua di Axon»: scelta della voce TTS (con anteprima) e della lingua delle risposte.
// Salva in /user-settings {assistant_voice, assistant_language}. Raggiungibile dal Tour (schermata 2) e da Impostazioni › AxonOS.
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { playAudioBase64 } from "@/src/utils/audioPlayback";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

export const AXON_VOICES: { key: string; label: string; desc: string; gender: "F" | "M" | "N"; local?: boolean }[] = [
  // V50.z347 — voci locali Kokoro (sul server, gratis, nessun limite)
  { key: "sara", label: "Sara", desc: "Femminile, naturale · voce locale gratuita", gender: "F", local: true },
  { key: "nicola", label: "Nicola", desc: "Maschile, posato · voce locale gratuita", gender: "M", local: true },
  { key: "nova", label: "Nova", desc: "Femminile, chiara e brillante", gender: "F" },
  { key: "shimmer", label: "Shimmer", desc: "Femminile, calda e morbida", gender: "F" },
  { key: "coral", label: "Coral", desc: "Femminile, vivace", gender: "F" },
  { key: "sage", label: "Sage", desc: "Femminile, calma e posata", gender: "F" },
  { key: "alloy", label: "Alloy", desc: "Neutra, equilibrata", gender: "N" },
  { key: "fable", label: "Fable", desc: "Narrativa, espressiva", gender: "N" },
  { key: "onyx", label: "Onyx", desc: "Maschile, grave e autorevole", gender: "M" },
  { key: "echo", label: "Echo", desc: "Maschile, morbida", gender: "M" },
  { key: "ash", label: "Ash", desc: "Maschile, decisa", gender: "M" },
];
export const SPEECH_RATES = [0.75, 1, 1.25, 1.5, 2];
export const AXON_LANGUAGES: { key: string; label: string; flag: string; sample: string }[] = [
  { key: "it", label: "Italiano", flag: "🇮🇹", sample: "Ciao, sono Axon, il tuo assistente. Questa è la mia voce." },
  { key: "en", label: "English", flag: "🇬🇧", sample: "Hi, I'm Axon, your assistant. This is my voice." },
  { key: "es", label: "Español", flag: "🇪🇸", sample: "Hola, soy Axon, tu asistente. Esta es mi voz." },
  { key: "fr", label: "Français", flag: "🇫🇷", sample: "Bonjour, je suis Axon, votre assistant. Voici ma voix." },
  { key: "de", label: "Deutsch", flag: "🇩🇪", sample: "Hallo, ich bin Axon, dein Assistent. Das ist meine Stimme." },
  { key: "pt", label: "Português", flag: "🇵🇹", sample: "Olá, sou o Axon, o seu assistente. Esta é a minha voz." },
  { key: "ro", label: "Română", flag: "🇷🇴", sample: "Bună, sunt Axon, asistentul tău. Aceasta este vocea mea." },
  { key: "uk", label: "Українська", flag: "🇺🇦", sample: "Привіт, я Axon, твій помічник. Це мій голос." },
  { key: "ar", label: "العربية", flag: "🇸🇦", sample: "مرحباً، أنا أكسون، مساعدك. هذا هو صوتي." },
  { key: "zh", label: "中文", flag: "🇨🇳", sample: "你好，我是 Axon，你的助手。这是我的声音。" },
];

export default function AxonVoiceScreen() {
  const router = useRouter();
  const pagePad = usePageBottomPadding();
  const [voice, setVoice] = useState("sara");
  const [engine, setEngine] = useState<"local" | "cloud">("local"); // V50.z347
  const [engStatus, setEngStatus] = useState<{ local_ready: boolean; local_loading: boolean; local_error?: string | null; avg_ms?: number | null; generations?: number } | null>(null);
  const [lang, setLang] = useState("it");
  const [rate, setRate] = useState(1); // V50.z284 — velocità di lettura (0.75–2×)
  const [loading, setLoading] = useState(true);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [stop, setStop] = useState<(() => void) | null>(null);

  useEffect(() => {
    api<{ assistant_voice?: string; assistant_language?: string; assistant_speech_rate?: number; assistant_tts_engine?: "local" | "cloud" }>("/user-settings")
      .then((s) => { if (s?.assistant_voice) setVoice(s.assistant_voice); if (s?.assistant_language) setLang(s.assistant_language); if (s?.assistant_speech_rate) setRate(Number(s.assistant_speech_rate)); if (s?.assistant_tts_engine) setEngine(s.assistant_tts_engine); })
      .catch(() => {}).finally(() => setLoading(false));
    loadEngine();
    return () => { try { stop?.(); } catch {} };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadEngine = () => { api<typeof engStatus>("/tts/engine").then((r) => setEngStatus(r)).catch(() => {}); };
  const chooseEngine = async (e: "local" | "cloud") => {
    setEngine(e); await save({ assistant_tts_engine: e });
    if (e === "local" && engStatus && !engStatus.local_ready) { try { await api("/tts/engine/warmup", { method: "POST" }); } catch {} setTimeout(loadEngine, 4000); }
    void preview(voice, lang);
  };
  const save = async (patch: { assistant_voice?: string; assistant_language?: string; assistant_speech_rate?: number; assistant_tts_engine?: "local" | "cloud" }) => {
    try { await api("/user-settings", { method: "PUT", body: patch }); } catch (e: any) { notify("Axon", e?.message || "Salvataggio non riuscito"); }
  };
  const chooseVoice = async (v: string) => { setVoice(v); await save({ assistant_voice: v }); void preview(v, lang); };
  const chooseLang = async (l: string) => { setLang(l); await save({ assistant_language: l }); void preview(voice, l); };
  const chooseRate = async (r: number) => { setRate(r); await save({ assistant_speech_rate: r }); };
  const preview = async (v: string, l: string, r: number = rate, who: string = v) => {
    try { stop?.(); } catch {}
    setPreviewing(who);
    try {
      const sample = AXON_LANGUAGES.find((x) => x.key === l)?.sample || AXON_LANGUAGES[0].sample;
      const res = await api<{ audio_base64: string; mime: string }>("/assistant/tts", { method: "POST", body: { text: sample, voice: v, speed: r } });
      const s = await playAudioBase64(res.audio_base64, res.mime || "audio/mpeg", () => setPreviewing(null));
      setStop(() => s);
    } catch (e: any) { setPreviewing(null); notify("Anteprima voce", e?.message || "Audio non disponibile"); }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: HT.card2 }}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={s.hBtn} testID="axon-voice-back"><Ionicons name="chevron-back" size={24} color={HT.text} /></Pressable>
        <View style={{ flex: 1 }}><Text style={s.title}>Voce e lingua di Axon</Text><Text style={s.sub}>Scegli come Axon ti parla e in che lingua risponde</Text></View>
      </View>
      {loading ? <ActivityIndicator color="#7C3AED" style={{ marginTop: 40 }} /> : (
        <ScrollView contentContainerStyle={{ padding: 14, gap: 16, paddingBottom: pagePad }}>
          {/* V50.z347 — motore vocale: locale (Kokoro sul server) o cloud (OpenAI) */}
          <Text style={s.section}>🎛️ Motore vocale</Text>
          <Text style={s.hint}>«Locale» genera la voce sul server AdvisorOS: gratis, senza limiti e senza inviare testo a terzi. «Cloud» usa OpenAI.</Text>
          <View style={{ flexDirection: "row", gap: 8 }} testID="axon-engine-row">
            {([["local", "Locale · gratis", "hardware-chip-outline"], ["cloud", "Cloud OpenAI", "cloud-outline"]] as const).map(([k, lbl, ic]) => {
              const on = engine === k;
              return (
                <Pressable key={k} onPress={() => chooseEngine(k)} style={[s.chip, { flex: 1, justifyContent: "center" }, on && s.chipOn]} testID={`axon-engine-${k}`}>
                  <Ionicons name={ic} size={16} color={on ? "#FFF" : HT.text} /><Text style={[s.chipTxt, on && { color: "#FFF" }]}>{lbl}</Text>
                </Pressable>
              );
            })}
          </View>
          {engStatus ? (
            <View style={[s.note, !engStatus.local_ready && { backgroundColor: HT.warningTint }]} testID="axon-engine-status">
              <Ionicons name={engStatus.local_ready ? "checkmark-circle" : engStatus.local_loading ? "hourglass-outline" : "alert-circle"} size={16} color={engStatus.local_ready ? HT.success : HT.warning} />
              <Text style={[s.noteTxt, !engStatus.local_ready && { color: HT.warning }]}>
                {engStatus.local_ready ? `Voce locale pronta${engStatus.avg_ms ? ` · ~${(engStatus.avg_ms / 1000).toFixed(1)} s per frase` : ""}${engStatus.generations ? ` · ${engStatus.generations} frasi generate` : ""}` : engStatus.local_loading ? "Voce locale in preparazione (primo avvio: download modello)… nel frattempo si usa il cloud." : `Voce locale non disponibile${engStatus.local_error ? `: ${engStatus.local_error}` : ""} · in uso il cloud.`}
              </Text>
            </View>
          ) : null}

          <Text style={s.section}>🔊 Voce</Text>
          <Text style={s.hint}>Tocca una voce per selezionarla e ascoltare subito un'anteprima. Con il motore locale le voci cloud vengono rese con Sara (femminili) o Nicola (maschili).</Text>
          <View style={{ gap: 8 }}>
            {AXON_VOICES.map((v) => {
              const on = v.key === voice;
              return (
                <Pressable key={v.key} onPress={() => chooseVoice(v.key)} style={[s.row, on && s.rowOn]} testID={`axon-voice-${v.key}`}>
                  <View style={[s.avatar, { backgroundColor: v.gender === "F" ? "#FCE7F3" : v.gender === "M" ? "#DBEAFE" : "#EDE9FE" }]}><Ionicons name={v.gender === "F" ? "woman" : v.gender === "M" ? "man" : "person"} size={18} color={v.gender === "F" ? "#DB2777" : v.gender === "M" ? "#2563EB" : "#7C3AED"} /></View>
                  <View style={{ flex: 1 }}><View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><Text style={s.rowTitle}>{v.label}</Text>{v.local ? <View style={s.badge}><Text style={s.badgeTxt}>LOCALE</Text></View> : null}</View><Text style={s.rowMeta}>{v.desc}</Text></View>
                  {previewing === v.key ? <ActivityIndicator color="#7C3AED" /> : <Pressable onPress={() => preview(v.key, lang)} hitSlop={8} style={s.play} testID={`axon-voice-play-${v.key}`}><Ionicons name="play" size={16} color="#7C3AED" /></Pressable>}
                  <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={20} color={on ? "#7C3AED" : HT.muted} />
                </Pressable>
              );
            })}
          </View>

          {/* V50.z284 — velocità di lettura + test */}
          <Text style={s.section}>⏩ Velocità di lettura</Text>
          <Text style={s.hint}>Quanto veloce parla Axon (tour, chat e conversazione continua). Tocca «Prova velocità» per ascoltare.</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }} testID="axon-rate-row">
            {SPEECH_RATES.map((r) => {
              const on = Math.abs(r - rate) < 0.01;
              return (
                <Pressable key={r} onPress={() => chooseRate(r)} style={[s.chip, on && s.chipOn]} testID={`axon-rate-${String(r).replace(".", "_")}`}>
                  <Text style={[s.chipTxt, on && { color: "#FFF" }]}>{r}×{r === 1 ? " normale" : ""}</Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable onPress={() => preview(voice, lang, rate, "rate")} disabled={previewing === "rate"} style={s.testBtn} testID="axon-rate-test">
            {previewing === "rate" ? <ActivityIndicator color="#FFF" /> : <><Ionicons name="play-circle" size={20} color="#FFF" /><Text style={s.testBtnTxt}>Prova velocità ({rate}×)</Text></>}
          </Pressable>

          <Text style={s.section}>🌍 Lingua delle risposte</Text>
          <Text style={s.hint}>Axon risponderà (testo e voce) nella lingua scelta. L'interfaccia dell'app resta in italiano.</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {AXON_LANGUAGES.map((l) => {
              const on = l.key === lang;
              return (
                <Pressable key={l.key} onPress={() => chooseLang(l.key)} style={[s.chip, on && s.chipOn]} testID={`axon-lang-${l.key}`}>
                  <Text style={{ fontSize: 16 }}>{l.flag}</Text><Text style={[s.chipTxt, on && { color: "#FFF" }]}>{l.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={s.note}><Ionicons name="checkmark-circle" size={16} color="#059669" /><Text style={s.noteTxt}>Salvataggio automatico. Voce attuale: <Text style={{ fontWeight: "900" }}>{AXON_VOICES.find((v) => v.key === voice)?.label || voice}</Text> · Lingua: <Text style={{ fontWeight: "900" }}>{AXON_LANGUAGES.find((l) => l.key === lang)?.label || lang}</Text></Text></View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderBottomWidth: 1, borderBottomColor: HT.border },
  hBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 18, fontWeight: "900", color: HT.text }, sub: { fontSize: 12, color: HT.muted },
  section: { fontSize: 15, fontWeight: "900", color: HT.text }, hint: { fontSize: 12, color: HT.muted, lineHeight: 17, marginTop: -8 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 14, backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border, minHeight: 60 },
  rowOn: { borderColor: '#7C3AED', backgroundColor: HT.violetTint },
  avatar: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  rowTitle: { fontSize: 15, fontWeight: "800", color: HT.text }, rowMeta: { fontSize: 12, color: HT.muted },
  play: { width: 36, height: 36, borderRadius: 18, backgroundColor: HT.violetTint, alignItems: "center", justifyContent: "center" },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, minHeight: 42, borderRadius: 21, borderWidth: 1, borderColor: HT.border, backgroundColor: HT.card },
  chipOn: { backgroundColor: '#7C3AED', borderColor: '#7C3AED' }, chipTxt: { fontSize: 13, fontWeight: "800", color: HT.text },
  testBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 48, borderRadius: 14, backgroundColor: '#7C3AED' }, testBtnTxt: { color: "#FFF", fontWeight: "900", fontSize: 14 },
  badge: { backgroundColor: HT.successTint, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }, badgeTxt: { color: HT.success, fontSize: 9.5, fontWeight: "900", letterSpacing: 0.5 },
  note: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: HT.successTint, borderRadius: 12, padding: 12 }, noteTxt: { flex: 1, fontSize: 12, color: HT.success, lineHeight: 17 },
});

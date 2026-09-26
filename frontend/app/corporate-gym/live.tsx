// corporate-gym/live.tsx — V50.z365 — Sessione LIVE viso a viso con Axon-cliente: fotocamera frontale del consulente (come in
// videochiamata) + Axon che parla (Kokoro) e ascolta (Whisper) a turni, avatar animato, GRAFICO TONO sotto la voce
// (verde = rapport/obiezione · blu = spiegazione · rosso = distacco/incalzare), blocco corrente; su esitazione Axon ferma e fa
// ripetere il blocco finché è fluido. Fine → feedback consulente + report Manager + valutazione OSCENO→ECCELLENTE.
// ?session=ID apre direttamente il risultato di una sessione già valutata (es. analisi di una registrazione).
import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Platform, Animated, Easing } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useAudioRecorder, RecordingPresets } from "expo-audio";
import { notify } from "@/src/utils/notify";
import { getMicPermission, requestMicPermission, openAppSettings, startRecording, stopRecording, playBase64, stopPlayback, MicPermissionState } from "@/src/corporate-gym/voice";
import { api } from "@/src/api";
import { cgaApi, CgaSession, CgaTurnOut, Tone, TONE_COLOR, TONE_LABEL, RATING_COLOR } from "@/src/corporate-gym/areasApi";
import { HT } from "@/src/homeTheme";

type Phase = "idle" | "listening" | "thinking" | "speaking";

function ToneBar({ segments, height = 14 }: { segments: { tone: Tone; pct: number }[]; height?: number }) {
  return (
    <View style={{ flexDirection: "row", height, borderRadius: height / 2, overflow: "hidden", backgroundColor: HT.card2 }}>
      {segments.map((s, i) => <View key={i} style={{ flex: Math.max(1, s.pct), backgroundColor: TONE_COLOR[s.tone] }} />)}
    </View>
  );
}

export default function CgymLiveScreen() {
  const router = useRouter();
  const { area, session } = useLocalSearchParams<{ area?: string; session?: string }>();
  const [camPerm, requestCam] = useCameraPermissions();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [mic, setMic] = useState<MicPermissionState>("undetermined");
  const [s, setS] = useState<CgaSession | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [last, setLast] = useState<CgaTurnOut | null>(null);
  const [timeline, setTimeline] = useState<{ tone: Tone; pct: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => { getMicPermission().then(setMic); if (!camPerm?.granted) requestCam(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([Animated.timing(pulse, { toValue: 1.12, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }), Animated.timing(pulse, { toValue: 1, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true })]));
    if (phase === "speaking" || phase === "listening") loop.start(); else pulse.setValue(1);
    return () => loop.stop();
  }, [phase, pulse]);

  const speak = useCallback(async (b64?: string | null) => { if (!b64) return; setPhase("speaking"); try { await playBase64(b64, "audio/mpeg"); } catch { /* muto */ } setPhase("idle"); }, []);

  useEffect(() => {
    (async () => {
      try {
        if (session) { setS(await api<CgaSession>(`/cgym/live/${session}`)); return; }
        if (!area) return;
        setBusy(true);
        const st = await cgaApi.liveStart(String(area));
        setS(st); await speak(st.audio_base64);
      } catch (e: any) { notify(e?.message || "Impossibile avviare la sessione"); } finally { setBusy(false); }
    })();
  }, [area, session, speak]);

  const toggleRecord = async () => {
    if (!s || busy) return;
    if (phase === "listening") {
      setPhase("thinking"); setBusy(true);
      try {
        const rec = await stopRecording(Platform.OS === "web" ? null : recorder);
        if (!rec) { setPhase("idle"); return; }
        const r = await cgaApi.liveTurn(s.session_id, { audio_base64: rec.b64, mime: rec.mime, tts: true });
        if (!r.ok) { notify(r.message || "Non ho sentito nulla"); setPhase("idle"); return; }
        setLast(r);
        setTimeline((t) => [...t, ...(r.tone_segments || [])]);
        setS((prev) => prev && { ...prev, block_idx: r.block_idx ?? prev.block_idx, turns: [...prev.turns, { role: "consultant", text: r.transcript || "", tone: r.tone, tone_segments: r.tone_segments, hesitation: r.hesitation, block_idx: prev.block_idx }, { role: "client", text: r.reply || "", block_idx: r.block_idx ?? prev.block_idx }] });
        await speak(r.audio_base64);
      } catch (e: any) { notify(e?.message || "Errore turno"); setPhase("idle"); } finally { setBusy(false); }
      return;
    }
    if (mic !== "granted") {
      const p = await requestMicPermission(); setMic(p);
      if (p !== "granted") { notify(p === "blocked" ? "Microfono bloccato: apri le impostazioni" : "Serve il microfono per parlare con Axon"); return; }
    }
    stopPlayback();
    try { await startRecording(Platform.OS === "web" ? null : recorder); setPhase("listening"); } catch { notify("Registrazione non disponibile"); }
  };

  const finish = async () => {
    if (!s || busy) return;
    setBusy(true); stopPlayback();
    try { setS(await cgaApi.liveFinish(s.session_id)); setPhase("idle"); } catch (e: any) { notify(e?.message || "Chiusura non riuscita"); } finally { setBusy(false); }
  };

  const done = s?.status === "done";
  const blockName = s ? s.blocks[s.block_idx] : "";
  const liveTone: Tone | null = last?.tone || null;

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => { stopPlayback(); router.back(); }} hitSlop={10} testID="cgym-live-back"><Ionicons name="chevron-back" size={24} color={HT.text} /></Pressable>
        <View style={{ flex: 1 }}><Text style={styles.title} numberOfLines={1}>{s?.area_name || "Sessione live"}</Text><Text style={styles.sub} numberOfLines={1}>{done ? "Sessione valutata" : s ? `Blocco ${s.block_idx + 1}/${s.blocks.length} · ${blockName}` : "Avvio…"}</Text></View>
        {!done && s ? <Pressable onPress={finish} disabled={busy} style={styles.finishBtn} testID="cgym-live-finish"><Text style={styles.finishTxt}>Chiudi e valuta</Text></Pressable> : null}
      </View>

      {!done ? (
        <>
          <View style={styles.stage}>
            {camPerm?.granted ? <CameraView style={StyleSheet.absoluteFill} facing="front" /> : <View style={[StyleSheet.absoluteFill, { backgroundColor: "#0F2438" }]} />}
            {!camPerm?.granted ? <Pressable onPress={() => (camPerm?.canAskAgain === false ? openAppSettings() : requestCam())} style={styles.camHint} testID="cgym-live-cam-perm"><Ionicons name="videocam-off" size={16} color="#FFF" /><Text style={styles.camHintTxt}>{camPerm?.canAskAgain === false ? "Fotocamera bloccata · Apri impostazioni" : "Attiva la fotocamera per la sessione viso a viso"}</Text></Pressable> : null}
            <View style={styles.avatarWrap}>
              <Animated.View style={[styles.avatar, { transform: [{ scale: pulse }], borderColor: phase === "listening" ? (liveTone ? TONE_COLOR[liveTone] : "#16A34A") : phase === "speaking" ? HT.violet : "rgba(255,255,255,0.5)" }]}>
                <Ionicons name={phase === "listening" ? "mic" : phase === "thinking" ? "hourglass" : "sparkles"} size={30} color="#FFF" />
              </Animated.View>
              <Text style={styles.avatarLbl}>{phase === "speaking" ? "Axon (cliente) parla…" : phase === "listening" ? "Ti ascolto…" : phase === "thinking" ? "Analizzo…" : "Axon · cliente"}</Text>
            </View>
            <View style={styles.toneOverlay}>
              <ToneBar segments={timeline.length ? timeline.slice(-24) : [{ tone: "blue", pct: 100 }]} />
              <View style={styles.legend}>{(Object.keys(TONE_LABEL) as Tone[]).map((t) => <View key={t} style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: TONE_COLOR[t] }]} /><Text style={styles.legendTxt}>{TONE_LABEL[t]}</Text></View>)}</View>
            </View>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 10 }}>
            {last?.action === "repeat" ? <View style={[styles.banner, { borderColor: "#DC2626", backgroundColor: HT.dangerTint }]} testID="cgym-live-repeat"><Ionicons name="repeat" size={18} color="#DC2626" /><Text style={styles.bannerTxt}>Esitazione su «{blockName}»: {last.hesitation_reason || "poco fluido"}. Ripeti il blocco.</Text></View> : null}
            {last?.action === "next_block" ? <View style={[styles.banner, { borderColor: "#16A34A", backgroundColor: HT.successTint }]}><Ionicons name="checkmark-circle" size={18} color="#16A34A" /><Text style={styles.bannerTxt}>Blocco fluido · si passa a «{blockName}»</Text></View> : null}
            {last?.action === "all_done" ? <View style={[styles.banner, { borderColor: HT.violet, backgroundColor: HT.violetTint }]}><Ionicons name="flag" size={18} color={HT.violet} /><Text style={styles.bannerTxt}>Tutti i blocchi completati: chiudi la sessione per il feedback.</Text></View> : null}
            {last?.hint ? <Text style={styles.hint}>💡 {last.hint}</Text> : null}
            {(s?.turns || []).slice(-6).map((t, i) => (
              <View key={i} style={[styles.bubble, t.role === "consultant" ? styles.me : styles.them]}>
                {t.role === "consultant" && t.tone_segments ? <ToneBar segments={t.tone_segments} height={6} /> : null}
                <Text style={styles.bubbleTxt}>{t.text.replace("[AXON]", "🤖")}</Text>
              </View>
            ))}
          </ScrollView>

          <View style={styles.controls}>
            <Pressable onPress={toggleRecord} disabled={busy && phase !== "listening"} style={[styles.micBtn, phase === "listening" && { backgroundColor: "#DC2626" }, busy && phase !== "listening" && { opacity: 0.5 }]} testID="cgym-live-mic">
              {phase === "thinking" ? <ActivityIndicator color="#FFF" /> : <Ionicons name={phase === "listening" ? "stop" : "mic"} size={30} color="#FFF" />}
            </Pressable>
            <Text style={styles.ctrlTxt}>{phase === "listening" ? "Tocca per inviare la risposta" : "Tocca e parla al cliente"}</Text>
            {mic === "blocked" ? <Pressable onPress={openAppSettings} style={styles.settingsLink}><Text style={styles.settingsTxt}>Apri impostazioni microfono</Text></Pressable> : null}
          </View>
        </>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }} testID="cgym-live-result">
          <View style={[styles.scoreCard, { borderColor: RATING_COLOR[s!.rating || ""] || HT.border }]}>
            <Text style={[styles.rating, { color: RATING_COLOR[s!.rating || ""] || HT.text }]}>{s!.rating}</Text>
            <Text style={styles.score}>{s!.score}/100</Text>
            {s!.feedback?.summary ? <Text style={styles.summary}>{s!.feedback.summary}</Text> : null}
            {s!.tone_mix ? <View style={{ gap: 6, width: "100%" }}><ToneBar segments={(Object.keys(s!.tone_mix) as Tone[]).map((t) => ({ tone: t, pct: s!.tone_mix![t] }))} /><Text style={styles.meta}>Mix toni: {(Object.keys(s!.tone_mix) as Tone[]).map((t) => `${TONE_LABEL[t]} ${s!.tone_mix![t]}%`).join(" · ")}</Text></View> : null}
          </View>
          <View style={styles.card}><Text style={[styles.cardHead, { color: "#16A34A" }]}>Cosa è andato bene</Text>{(s!.feedback?.good || []).map((x, i) => <Text key={i} style={styles.li}>✓ {x}</Text>)}</View>
          <View style={styles.card}><Text style={[styles.cardHead, { color: "#DC2626" }]}>Cosa rifare</Text>{(s!.feedback?.redo || []).map((x, i) => <Text key={i} style={styles.li}>↻ {x}</Text>)}</View>
          {s!.feedback?.per_block?.length ? <View style={styles.card}><Text style={styles.cardHead}>Per blocco</Text>{s!.feedback.per_block.map((b, i) => <View key={i} style={{ gap: 2 }}><Text style={styles.li}>{b.block} · <Text style={{ fontWeight: "900" }}>{b.score}</Text></Text><Text style={styles.meta}>{b.note}</Text></View>)}</View> : null}
          {s!.manager_report ? <View style={[styles.card, { borderColor: HT.violet + "66" }]}><Text style={[styles.cardHead, { color: HT.violet }]}>Report per il Manager</Text><Text style={styles.li}>{s!.manager_report}</Text></View> : null}
          <Pressable onPress={() => router.replace(`/corporate-gym/live?area=${s!.area_id}` as any)} style={styles.again} testID="cgym-live-again"><Ionicons name="refresh" size={18} color="#FFF" /><Text style={styles.finishTxt}>Nuova sessione</Text></Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: HT.bg },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: HT.border, backgroundColor: HT.card },
  title: { fontSize: 16, fontWeight: "900", color: HT.text }, sub: { fontSize: 12, color: HT.muted },
  finishBtn: { backgroundColor: HT.violet, borderRadius: 10, paddingHorizontal: 12, minHeight: 36, justifyContent: "center" }, finishTxt: { color: "#FFF", fontWeight: "800", fontSize: 12 },
  stage: { height: 300, backgroundColor: "#0F2438", position: "relative" },
  camHint: { position: "absolute", top: 10, left: 10, right: 10, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 10, padding: 8 }, camHintTxt: { color: "#FFF", fontSize: 12, fontWeight: "700", flex: 1 },
  avatarWrap: { position: "absolute", right: 12, top: 44, alignItems: "center", gap: 4 },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: "rgba(124,58,237,0.85)", borderWidth: 3, alignItems: "center", justifyContent: "center" },
  avatarLbl: { color: "#FFF", fontSize: 11, fontWeight: "800", backgroundColor: "rgba(0,0,0,0.45)", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  toneOverlay: { position: "absolute", left: 12, right: 12, bottom: 10, gap: 6, backgroundColor: "rgba(0,0,0,0.45)", borderRadius: 12, padding: 8 },
  legend: { flexDirection: "row", justifyContent: "space-between" }, legendItem: { flexDirection: "row", alignItems: "center", gap: 4 }, legendDot: { width: 8, height: 8, borderRadius: 4 }, legendTxt: { color: "#FFF", fontSize: 10, fontWeight: "700" },
  banner: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 12, padding: 10 }, bannerTxt: { flex: 1, fontSize: 13, color: HT.text, fontWeight: "700" },
  hint: { fontSize: 12, color: HT.text2, fontStyle: "italic" },
  bubble: { maxWidth: "88%", borderRadius: 14, padding: 10, gap: 6 }, me: { alignSelf: "flex-end", backgroundColor: HT.brandTint }, them: { alignSelf: "flex-start", backgroundColor: HT.card2 },
  bubbleTxt: { fontSize: 14, color: HT.text, lineHeight: 20 },
  controls: { alignItems: "center", gap: 6, paddingVertical: 12, borderTopWidth: 1, borderTopColor: HT.border, backgroundColor: HT.card },
  micBtn: { width: 68, height: 68, borderRadius: 34, backgroundColor: HT.violet, alignItems: "center", justifyContent: "center" }, ctrlTxt: { fontSize: 12, color: HT.muted, fontWeight: "700" },
  settingsLink: { minHeight: 32, justifyContent: "center" }, settingsTxt: { color: HT.violet, fontWeight: "800", fontSize: 12 },
  scoreCard: { alignItems: "center", gap: 6, backgroundColor: HT.card, borderRadius: 18, borderWidth: 2, padding: 18 },
  rating: { fontSize: 28, fontWeight: "900", letterSpacing: 1 }, score: { fontSize: 16, fontWeight: "800", color: HT.text2 }, summary: { fontSize: 14, color: HT.text, textAlign: "center", lineHeight: 20 },
  card: { backgroundColor: HT.card, borderRadius: 16, borderWidth: 1, borderColor: HT.border, padding: 14, gap: 6 },
  cardHead: { fontSize: 13, fontWeight: "900", color: HT.muted, textTransform: "uppercase", letterSpacing: 0.4 }, li: { fontSize: 14, color: HT.text, lineHeight: 20 }, meta: { fontSize: 11, color: HT.muted },
  again: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 48, borderRadius: 14, backgroundColor: HT.violet },
});

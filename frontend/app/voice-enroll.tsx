// voice-enroll.tsx — V50.z372 — Registrazione guidata dell'IMPRONTA VOCALE (Blocco 2 proprietario · Blocco 3 voci secondarie).
// L'utente legge un testo a schermo (frasi normali, domande, comandi, toni diversi ≈ 2-3 minuti). L'audio va al server a spezzoni
// di ~20 s (/voiceprint/enroll/chunk → embedding ECAPA + qualità in tempo reale: parlato, rumore, coerenza). Quando il parlato
// supera il minimo e la coerenza è buona, «Completa» crea il profilo: Axon da quel momento risponde solo alle voci registrate.
// Parametri: role=owner|secondary, name (secondaria), profile_id (ri-registrazione).
import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Platform, Linking } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomSheetPadding } from "@/src/utils/bottomSheetInsets"; // V50.z410 — fallback gesture bar Android
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { AudioModule } from "expo-audio";
import { HT } from "@/src/homeTheme";
import { notify } from "@/src/utils/notify";
import { vpApi, type VpQuality } from "@/src/violawake/voiceprintApi";
import { createChunkRecorder, CHUNK_RECORDER_SUPPORTED, type ChunkRecorder } from "@/src/violawake/chunkRecorder";

const CHUNK_MS = 20000;
type Step = "intro" | "reading" | "uploading" | "done";

export default function VoiceEnrollScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const footerPad = useBottomSheetPadding(28); // safe-area reale (insets o initialWindowMetrics) + 12, minimo 28
  const pagePad = Math.max(insets.bottom, 16) + 24; // V50.z407 — nav e FAB nascosti su questa rotta (schermo intero)
  const params = useLocalSearchParams<{ role?: string; name?: string; profile_id?: string }>();
  const role: "owner" | "secondary" = params.role === "secondary" ? "secondary" : "owner";
  const [name, setName] = useState((params.name as string) || "");
  const [step, setStep] = useState<Step>("intro");
  const [paragraphs, setParagraphs] = useState<string[]>([]);
  const [minFromServer, setMinFromServer] = useState(120);
  const [idx, setIdx] = useState(0);
  const [quality, setQuality] = useState<VpQuality | null>(null);
  const [level, setLevel] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [perm, setPerm] = useState<"unknown" | "granted" | "denied" | "blocked">("unknown");
  const [doneMsg, setDoneMsg] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const recRef = useRef<ChunkRecorder | null>(null);
  const sessionRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cutRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const uploadsRef = useRef(0);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    vpApi.enrollText().then((r) => { setParagraphs(r.paragraphs); if (r.min_speech_sec) setMinFromServer(r.min_speech_sec); }).catch(() => {});
    vpApi.warmup().catch(() => {});
    return () => { void teardown(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const teardown = async () => {
    if (timerRef.current) clearInterval(timerRef.current); timerRef.current = null;
    if (cutRef.current) clearInterval(cutRef.current); cutRef.current = null;
    const r = recRef.current; recRef.current = null;
    try { await r?.stop(); } catch { /* noop */ }
  };

  const checkPerm = async (): Promise<boolean> => {
    if (Platform.OS === "web") return true; // il browser chiede al primo getUserMedia
    try {
      let p = await AudioModule.getRecordingPermissionsAsync();
      if (!p.granted && p.canAskAgain) p = await AudioModule.requestRecordingPermissionsAsync();
      setPerm(p.granted ? "granted" : p.canAskAgain ? "denied" : "blocked");
      return p.granted;
    } catch { setPerm("denied"); return false; }
  };

  const sendChunk = useCallback(async (audio: { base64: string; mime: string } | null) => {
    if (!audio || !sessionRef.current) return;
    uploadsRef.current += 1;
    try {
      const q = await vpApi.enrollChunk(sessionRef.current, audio.base64, audio.mime);
      setQuality(q);
    } catch (e: any) { notify("Impronta vocale", e?.message || "Invio audio non riuscito"); }
    finally { uploadsRef.current -= 1; }
  }, []);

  const start = async () => {
    if (busy) return;
    if (role === "secondary" && name.trim().length < 2) { notify("Impronta vocale", "Scrivi il nome della persona"); return; }
    if (!CHUNK_RECORDER_SUPPORTED) { notify("Impronta vocale", "Registrazione non disponibile su questo dispositivo"); return; }
    setBusy(true);
    try {
      if (!(await checkPerm())) { notify("Microfono", "Serve il microfono per registrare la voce"); return; }
      const s = await vpApi.enrollStart({ role, name: name.trim() || undefined, profile_id: (params.profile_id as string) || undefined });
      sessionRef.current = s.session_id;
      if (s.paragraphs?.length) setParagraphs(s.paragraphs);
      const rec = createChunkRecorder();
      await rec.start();
      recRef.current = rec;
      setIdx(0); setQuality(null); setElapsed(0); setStep("reading");
      timerRef.current = setInterval(() => { setElapsed((e) => e + 1); setLevel(rec.level()); }, 1000);
      cutRef.current = setInterval(() => { rec.cut().then(sendChunk).catch(() => {}); }, CHUNK_MS);
    } catch (e: any) {
      if (Platform.OS === "web") setPerm("blocked");
      notify("Impronta vocale", e?.message || "Avvio non riuscito");
    } finally { setBusy(false); }
  };

  const next = () => {
    const n = idx + 1 >= paragraphs.length ? 0 : idx + 1;
    setIdx(n);
    scrollRef.current?.scrollTo({ y: Math.max(0, n * 120 - 60), animated: true });
  };

  const finish = async () => {
    if (busy) return;
    setBusy(true); setStep("uploading");
    try {
      if (timerRef.current) clearInterval(timerRef.current); timerRef.current = null;
      if (cutRef.current) clearInterval(cutRef.current); cutRef.current = null;
      const r = recRef.current; recRef.current = null;
      const last = await r?.stop();
      await sendChunk(last || null);
      while (uploadsRef.current > 0) await new Promise((res) => setTimeout(res, 200));
      const out = await vpApi.enrollFinish(sessionRef.current!);
      setDoneMsg(out.message); setQuality(out.quality); setStep("done");
    } catch (e: any) {
      notify("Impronta vocale", e?.message || "Completamento non riuscito");
      setStep("intro");
    } finally { setBusy(false); }
  };

  const cancel = async () => { await teardown(); router.back(); };

  const minSec = quality?.min_speech_sec ?? minFromServer;
  const speech = quality?.speech_sec ?? 0;
  const pct = Math.min(100, Math.round((speech / minSec) * 100));
  const snrOk = quality ? quality.snr_db >= 12 : null;
  const consOk = quality ? quality.consistency >= (quality.min_consistency ?? 0.6) : null;
  const lvlPct = level == null ? 0 : Math.min(100, Math.max(0, ((level + 60) / 60) * 100));
  const title = role === "owner" ? "Registra la tua voce" : `Registra la voce di ${name.trim() || "…"}`;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: HT.card2 }} edges={["top"]}>
      <View style={s.header}>
        <Pressable onPress={cancel} hitSlop={10} style={s.hBtn} testID="voice-enroll-back"><Ionicons name="chevron-back" size={24} color={HT.text} /></Pressable>
        <View style={{ flex: 1 }}><Text style={s.title}>{title}</Text><Text style={s.sub}>Impronta vocale · Axon risponderà solo alle voci registrate</Text></View>
        {step === "reading" ? <View style={s.recDot} /> : null}
      </View>

      {step === "intro" ? (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: pagePad }}>
          <View style={s.card}>
            <View style={s.iconBig}><Ionicons name="finger-print" size={30} color={HT.violet} /></View>
            <Text style={s.cardTitle}>Come funziona</Text>
            <Text style={s.p}>1. Tocca «Inizia» e leggi a voce normale il testo che compare, paragrafo dopo paragrafo.</Text>
            <Text style={s.p}>2. Servono circa <Text style={s.b}>{Math.ceil(minSec / 60)} minuti di parlato</Text>: la barra si riempie man mano. Varia il tono come indicato (calmo, deciso, sottovoce).</Text>
            <Text style={s.p}>3. Quando la barra è piena e la qualità è buona, tocca «Completa». Da quel momento {role === "owner" ? "Axon risponde solo alla tua voce; le voci sconosciute vengono ignorate in silenzio." : "questa persona potrà usare Axon con i permessi che imposti tu."}</Text>
            <Text style={[s.p, { color: HT.muted }]}>Consigli: ambiente tranquillo, telefono a 20-30 cm dalla bocca, non leggere in modo monotono.</Text>
          </View>
          {role === "secondary" ? (
            <View style={s.card}>
              <Text style={s.cardTitle}>Nome della persona</Text>
              <TextInput value={name} onChangeText={setName} placeholder="Es. Laura (collaboratrice)" placeholderTextColor={HT.muted} style={s.input} testID="voice-enroll-name" />
            </View>
          ) : null}
          {perm === "blocked" ? (
            <Pressable onPress={() => Linking.openSettings()} style={[s.btn, { backgroundColor: HT.warning }]} testID="voice-enroll-settings"><Ionicons name="settings" size={18} color="#FFF" /><Text style={s.btnTxt}>Microfono bloccato · Apri impostazioni</Text></Pressable>
          ) : null}
          <Pressable onPress={start} disabled={busy} style={[s.btn, busy && { opacity: 0.6 }]} testID="voice-enroll-start">
            {busy ? <ActivityIndicator color="#FFF" /> : <><Ionicons name="mic" size={20} color="#FFF" /><Text style={s.btnTxt}>Inizia a leggere</Text></>}
          </Pressable>
        </ScrollView>
      ) : null}

      {step === "reading" || step === "uploading" ? (
        <View style={{ flex: 1 }}>
          <View style={s.qualityBox} testID="voice-enroll-quality">
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
              <Text style={s.qTitle}>Parlato raccolto</Text>
              <Text style={[s.qVal, quality?.ready && { color: HT.success }]} testID="voice-enroll-progress">{Math.round(speech)} s / {Math.round(minSec)} s</Text>
            </View>
            <View style={s.bar}><View style={[s.fill, { width: `${pct}%`, backgroundColor: quality?.ready ? HT.success : HT.violet }]} /></View>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
              <Chip icon="volume-high" label={quality ? `Rumore ${snrOk ? "OK" : "alto"}` : "Rumore —"} ok={snrOk} />
              <Chip icon="git-compare" label={quality ? `Coerenza ${Math.round((quality.consistency || 0) * 100)}%` : "Coerenza —"} ok={consOk} />
              <Chip icon="time" label={`${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`} ok={null} />
            </View>
            <View style={s.vu}><View style={[s.vuFill, { width: `${lvlPct}%` }]} /></View>
            {quality?.hint ? <Text style={s.hint} testID="voice-enroll-hint">{quality.hint}</Text> : <Text style={s.hint}>Leggi a voce normale il paragrafo evidenziato, poi tocca «Avanti».</Text>}
          </View>
          <ScrollView ref={scrollRef} contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 20 }} style={{ flex: 1 }}>
            {paragraphs.map((p, i) => (
              <Pressable key={i} onPress={() => setIdx(i)} style={[s.para, i === idx && s.paraOn]} testID={`voice-enroll-para-${i}`}>
                <Text style={[s.paraTxt, i === idx && s.paraTxtOn]}>{p}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <View style={[s.footer, { paddingBottom: footerPad + 8 }]} testID="voice-enroll-footer">
            <Pressable onPress={cancel} style={[s.btnSm, s.ghost, { flex: 0.8 }]} testID="voice-enroll-cancel"><Text style={[s.btnSmTxt, { color: HT.text }]}>Annulla</Text></Pressable>
            <Pressable onPress={next} style={[s.btnSm, { backgroundColor: HT.violet }]} testID="voice-enroll-next"><Ionicons name="arrow-down" size={18} color="#FFF" /><Text style={s.btnSmTxt}>Avanti</Text></Pressable>
            <Pressable onPress={finish} disabled={!quality?.ready || busy} style={[s.btnSm, { flex: 1.4, backgroundColor: quality?.ready ? HT.success : HT.card, borderWidth: quality?.ready ? 0 : 1, borderColor: HT.border }]} testID="voice-enroll-finish">
              {step === "uploading" ? <ActivityIndicator color="#FFF" /> : <><Ionicons name="checkmark-circle" size={18} color={quality?.ready ? "#FFF" : HT.muted} /><Text style={[s.btnSmTxt, !quality?.ready && { color: HT.muted }]}>{quality?.ready ? "Completa" : "Continua a leggere…"}</Text></>}
            </Pressable>
          </View>
        </View>
      ) : null}

      {step === "done" ? (
        <View style={{ flex: 1, padding: 16, gap: 14, justifyContent: "center" }}>
          <View style={[s.card, { alignItems: "center" }]} testID="voice-enroll-done">
            <View style={[s.iconBig, { backgroundColor: HT.successTint }]}><Ionicons name="checkmark-done" size={32} color={HT.success} /></View>
            <Text style={[s.cardTitle, { textAlign: "center" }]}>{doneMsg || "Impronta vocale salvata"}</Text>
            {quality ? <Text style={[s.p, { textAlign: "center", color: HT.muted }]}>{Math.round(quality.speech_sec)} s di parlato · coerenza {Math.round(quality.consistency * 100)}% · rumore {quality.snr_db >= 12 ? "basso" : "presente"}</Text> : null}
          </View>
          <Pressable onPress={() => router.replace("/voice-profiles" as any)} style={s.btn} testID="voice-enroll-goto-profiles"><Ionicons name="people" size={18} color="#FFF" /><Text style={s.btnTxt}>Voci autorizzate</Text></Pressable>
          <Pressable onPress={() => router.back()} style={[s.btn, s.ghost]} testID="voice-enroll-close"><Text style={[s.btnTxt, { color: HT.text }]}>Chiudi</Text></Pressable>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function Chip({ icon, label, ok }: { icon: any; label: string; ok: boolean | null }) {
  const color = ok == null ? HT.text2 : ok ? HT.success : HT.warning;
  return (
    <View style={[s.chip, { borderColor: color }]}><Ionicons name={icon} size={13} color={color} /><Text style={[s.chipTxt, { color }]}>{label}</Text></View>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderBottomWidth: 1, borderBottomColor: HT.border },
  hBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 18, fontWeight: "900", color: HT.text }, sub: { fontSize: 12, color: HT.muted },
  recDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: HT.danger, marginRight: 6 },
  card: { backgroundColor: HT.card, borderRadius: 16, borderWidth: 1, borderColor: HT.border, padding: 16, gap: 8 },
  iconBig: { width: 60, height: 60, borderRadius: 18, backgroundColor: HT.violetTint, alignItems: "center", justifyContent: "center", alignSelf: "center", marginBottom: 4 },
  cardTitle: { fontSize: 16, fontWeight: "900", color: HT.text }, p: { fontSize: 13.5, color: HT.text2, lineHeight: 20 }, b: { fontWeight: "900", color: HT.text },
  input: { borderWidth: 1, borderColor: HT.border, borderRadius: 12, paddingHorizontal: 14, minHeight: 48, fontSize: 16, color: HT.text, backgroundColor: HT.card2 },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 52, borderRadius: 14, backgroundColor: HT.violet, paddingHorizontal: 16 },
  btnTxt: { color: "#FFF", fontWeight: "900", fontSize: 15 },
  ghost: { backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border },
  qualityBox: { margin: 12, marginBottom: 0, padding: 12, borderRadius: 16, backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border, gap: 6 },
  qTitle: { fontSize: 12, fontWeight: "800", color: HT.muted, textTransform: "uppercase", letterSpacing: 0.5 }, qVal: { fontSize: 18, fontWeight: "900", color: HT.text },
  bar: { height: 12, borderRadius: 6, backgroundColor: HT.card2, overflow: "hidden" }, fill: { height: 12, borderRadius: 6 },
  vu: { height: 4, borderRadius: 2, backgroundColor: HT.card2, overflow: "hidden", marginTop: 4 }, vuFill: { height: 4, backgroundColor: HT.violet },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 }, chipTxt: { fontSize: 11, fontWeight: "800" },
  hint: { fontSize: 12, color: HT.text2, fontStyle: "italic", marginTop: 2 },
  para: { padding: 14, borderRadius: 14, backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border, opacity: 0.55 },
  paraOn: { opacity: 1, borderColor: HT.violet, backgroundColor: HT.violetTint },
  paraTxt: { fontSize: 15, color: HT.text2, lineHeight: 23 }, paraTxtOn: { fontSize: 19, color: HT.text, fontWeight: "700", lineHeight: 29 },
  footer: { flexDirection: "row", gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: HT.border, backgroundColor: HT.card },
  btnSm: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 52, borderRadius: 14, paddingHorizontal: 10, backgroundColor: HT.violet },
  btnSmTxt: { color: "#FFF", fontWeight: "900", fontSize: 14 },
});

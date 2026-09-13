// Corporate Gym — Blocco 2: role-play vocale, obiezione TEMPO.
// Fasi: intro (permesso microfono contestuale) → live (cliente parla via TTS, consulente risponde a voce) → risultati.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Platform, TextInput, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useAudioRecorder, RecordingPresets } from "expo-audio";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";
import { useNavBarBottomInset } from "@/src/hooks/useSafeBottom";
import { CgymTileIcon } from "@/src/corporate-gym/CgymTileIcon";
import { cgymRoleplayApi, CgymRoleplay, CgymMood, CGYM_MOOD_META, CGYM_ORANGE, CGYM_SCENARIO_META, CgymScenarioKey } from "@/src/corporate-gym/api";
import { getMicPermission, requestMicPermission, openAppSettings, startRecording, stopRecording, playBase64, stopPlayback, MicPermissionState } from "@/src/corporate-gym/voice";
import { api } from "@/src/api";
import { CgymManualButton } from "@/src/corporate-gym/CgymManualButton";
import type { CgymManualRef } from "@/src/corporate-gym/manualsApi";

// V50.z203 — scenario EFFETTIVO (default + personalizzazioni Master Coach)
type ScenarioCfg = { label: string; description: string; image_url: string | null; duration_min: number; max_turns: number; tips: string[]; customer: { name?: string; role?: string; company?: string }; manual_ref: CgymManualRef | null; phases: { id?: string; name: string; minutes_to: number; manual_ref?: CgymManualRef | null }[] };

type Phase = "intro" | "live" | "evaluating" | "results";
type LiveState = "idle" | "speaking" | "recording" | "sending" | "thinking";
type Bubble = { id: string; role: "cliente" | "consulente"; text: string; mood?: CgymMood };

const MAX_REC_SECONDS = 60;

export default function CgymRoleplayScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ session_id?: string; scenario?: string }>();
  const sessionId = typeof params.session_id === "string" && params.session_id ? params.session_id : undefined;
  const rawKey = String(params.scenario || "tempo");
  const isCustomKey = rawKey.startsWith("custom_");   // V50.z204 — role-play creato dal Master Coach
  const scenarioKey = (isCustomKey ? rawKey : ((["tempo", "costo", "decisore", "winwin"] as string[]).includes(rawKey) ? rawKey : "tempo")) as CgymScenarioKey;
  const baseMeta = CGYM_SCENARIO_META[scenarioKey] || { ...CGYM_SCENARIO_META.tempo, label: "Role-play", customer: "cliente simulato", description: "", tips: [] as string[] };
  const [cfg, setCfg] = useState<ScenarioCfg | null>(null);
  useEffect(() => { api<ScenarioCfg>(`/cgym/config/scenarios/${scenarioKey}`).then(setCfg).catch(() => setCfg(null)); }, [scenarioKey]);
  const custLine = cfg ? [cfg.customer?.name, cfg.customer?.role && cfg.customer?.company ? `${cfg.customer.role} di ${cfg.customer.company}` : (cfg.customer?.role || cfg.customer?.company)].filter(Boolean).join(", ") : baseMeta.customer;
  const meta = cfg ? { ...baseMeta, area: (cfg as any).area || baseMeta.area, label: cfg.label, description: cfg.description || baseMeta.description, duration_min: cfg.duration_min, max_turns: cfg.max_turns, tips: cfg.tips.length ? cfg.tips : baseMeta.tips, customer: custLine || baseMeta.customer } : baseMeta;
  const phases = cfg?.phases || [];
  const isWinWin = meta.area === "winwin";
  // La PersistentBottomNav (60 + inset) copre il fondo pagina: i controlli stanno sopra di essa.
  const navPad = 60 + useNavBarBottomInset() + 8;
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const [phase, setPhase] = useState<Phase>("intro");
  const [mic, setMic] = useState<MicPermissionState>("undetermined");
  const [starting, setStarting] = useState(false);
  const [rpId, setRpId] = useState<string | null>(null);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [live, setLive] = useState<LiveState>("idle");
  const [turn, setTurn] = useState(0);
  const [maxTurns, setMaxTurns] = useState(baseMeta.max_turns);
  useEffect(() => { if (cfg) setMaxTurns(cfg.max_turns); }, [cfg]);
  const [wwPhase, setWwPhase] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const startedAtRef = useRef<number | null>(null);
  startedAtRef.current = startedAt;
  const [elapsedSec, setElapsedSec] = useState(0);
  const curPhase = phases.length && startedAt ? (phases.find((p) => elapsedSec / 60 < p.minutes_to) || phases[phases.length - 1]) : null;
  const [mood, setMood] = useState<CgymMood>("chiuso");
  const [ended, setEnded] = useState(false);
  const [recSec, setRecSec] = useState(0);
  const [typed, setTyped] = useState("");
  const [useText, setUseText] = useState(false);
  const [result, setResult] = useState<CgymRoleplay | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);
  const recTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveRef = useRef<LiveState>("idle");
  liveRef.current = live;

  useEffect(() => { getMicPermission().then(setMic); }, []);
  // Timer sessione (WIN-WIN 45 min): conto alla rovescia nella barra live
  useEffect(() => {
    if (!startedAt || !(isWinWin || phases.length > 0)) return;
    const id = setInterval(() => setElapsedSec(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, [startedAt, isWinWin, phases.length]);
  useEffect(() => () => { stopPlayback(); if (recTimer.current) clearInterval(recTimer.current); }, []);

  const pushBubble = (b: Bubble) => {
    setBubbles((prev) => [...prev, b]);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
  };

  const speak = useCallback(async (b64: string | null, mime: string) => {
    if (!b64) return;
    setLive("speaking");
    try { await playBase64(b64, mime); } catch {}
    setLive("idle");
  }, []);

  const begin = async () => {
    if (starting) return;
    // Permesso microfono contestuale (solo dopo intento esplicito)
    if (!useText && mic !== "granted") {
      const r = await requestMicPermission();
      setMic(r);
      if (r !== "granted") return; // la UI mostra la spiegazione / Apri impostazioni / modalità testo
    }
    setStarting(true);
    try {
      const r = await cgymRoleplayApi.start({ session_id: sessionId, scenario: scenarioKey, tts: true });
      setRpId(r.roleplay_id);
      setMaxTurns(r.max_turns);
      setStartedAt(Date.now());
      setWwPhase(phases.length ? phases[0].name : (isWinWin ? "1 · Apertura e clima" : null));
      setTurn(0);
      setMood(r.mood);
      setBubbles([{ id: "c0", role: "cliente", text: r.reply, mood: r.mood }]);
      setPhase("live");
      speak(r.audio_base64, r.audio_mime);
    } catch (e: any) {
      notify("Role-play", e?.message || "Impossibile avviare la sessione");
    } finally {
      setStarting(false);
    }
  };

  const onRecordPress = async () => {
    if (!rpId || ended) return;
    if (liveRef.current === "recording") { await finishRecording(); return; }
    if (liveRef.current !== "idle" && liveRef.current !== "speaking") return;
    stopPlayback();
    try {
      await startRecording(Platform.OS === "web" ? null : recorder);
      setLive("recording");
      setRecSec(0);
      recTimer.current = setInterval(() => {
        setRecSec((s) => {
          if (s + 1 >= MAX_REC_SECONDS) { finishRecording(); return s + 1; }
          return s + 1;
        });
      }, 1000);
    } catch (e: any) {
      notify("Microfono", e?.message || "Impossibile registrare");
      setLive("idle");
    }
  };

  const finishRecording = async () => {
    if (recTimer.current) { clearInterval(recTimer.current); recTimer.current = null; }
    if (liveRef.current !== "recording") return;
    setLive("sending");
    try {
      const rec = await stopRecording(Platform.OS === "web" ? null : recorder);
      if (!rec) { notify("Role-play", "Registrazione troppo breve: riprova."); setLive("idle"); return; }
      await sendTurn({ audio_base64: rec.b64, mime: rec.mime });
    } catch (e: any) {
      notify("Role-play", e?.message || "Errore registrazione");
      setLive("idle");
    }
  };

  const sendTurn = async (body: { audio_base64?: string; mime?: string; text?: string }) => {
    if (!rpId) return;
    setLive("thinking");
    try {
      const r = await cgymRoleplayApi.turn(rpId, { ...body, tts: true });
      pushBubble({ id: `u${r.turn}`, role: "consulente", text: r.transcript || body.text || "" });
      pushBubble({ id: `c${r.turn}`, role: "cliente", text: r.reply, mood: r.mood });
      setTurn(r.turn);
      setMood(r.mood);
      setEnded(r.ended);
      if (r.phase) setWwPhase(r.phase);
      await speak(r.audio_base64, r.audio_mime);
    } catch (e: any) {
      notify("Role-play", e?.message || "Errore");
      setLive("idle");
    }
  };

  const sendTyped = async () => {
    const t = typed.trim();
    if (!t || live === "thinking" || live === "sending") return;
    setTyped("");
    stopPlayback();
    await sendTurn({ text: t });
  };

  const finish = async () => {
    if (!rpId) return;
    stopPlayback();
    setPhase("evaluating");
    try {
      const r = await cgymRoleplayApi.finish(rpId);
      setResult(r);
      setPhase("results");
    } catch (e: any) {
      notify("Valutazione", e?.message || "Errore nella valutazione");
      setPhase("live");
    }
  };

  const restart = () => {
    stopPlayback();
    setRpId(null); setBubbles([]); setTurn(0); setEnded(false); setResult(null); setLive("idle"); setStartedAt(null); setWwPhase(null); setElapsedSec(0);
    setPhase("intro");
  };

  const goBack = () => {
    stopPlayback();
    if (router.canGoBack()) router.back(); else router.replace("/corporate-gym" as any);
  };

  const statusLabel =
    live === "speaking" ? "Il cliente sta parlando…" :
    live === "recording" ? `Sto ascoltando… ${recSec}s (tocca per inviare)` :
    live === "sending" ? "Trascrivo la tua risposta…" :
    live === "thinking" ? "Il cliente sta pensando…" :
    ended ? "Conversazione conclusa" : "Tocca il microfono e rispondi al cliente";

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable testID="cgym-rp-back" onPress={goBack} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>Role-play · {meta.label}</Text>
        <View style={{ width: 26 }} />
      </View>

      {phase === "intro" && (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: navPad + 16 }} testID="cgym-rp-intro">
          <View style={styles.card}>
            {cfg?.image_url ? <Image source={{ uri: cfg.image_url }} style={{ width: 120, height: 120, borderRadius: 16 }} resizeMode="cover" testID="cgym-rp-custom-image" /> : <CgymTileIcon type={meta.area} size={90} fill />}
            <Text style={styles.cardTitle}>{meta.label}</Text>
            <Text style={styles.cardSub}>{`AxonOS interpreta ${meta.customer}. ${meta.description}`}</Text>
            <View style={styles.durRow} testID="cgym-rp-duration">
              <Ionicons name="time-outline" size={14} color={CGYM_ORANGE} />
              <Text style={styles.durTxt}>{isWinWin ? `Sessione completa: ${meta.duration_min} minuti · fino a ${maxTurns} interventi` : `Circa ${meta.duration_min} minuti · fino a ${maxTurns} risposte`}</Text>
            </View>
            {cfg?.manual_ref && <CgymManualButton type={meta.area} manualRef={cfg.manual_ref} label="Manuale del role-play" />}
            {phases.length > 0 && (
              <View style={styles.tips} testID="cgym-rp-phases">
                <Text style={[styles.tipTxt, { fontWeight: "800" }]}>Fasi della sessione</Text>
                {phases.map((p, i) => (
                  <View key={p.id || i} style={{ gap: 4 }}>
                    <View style={styles.tipRow}><Ionicons name="flag" size={14} color={CGYM_ORANGE} /><Text style={styles.tipTxt}>{p.name} · fino al minuto {p.minutes_to}</Text></View>
                    {p.manual_ref && <CgymManualButton type={meta.area} manualRef={p.manual_ref} label={`Manuale · ${p.name}`} />}
                  </View>
                ))}
              </View>
            )}
            <View style={styles.tips}>
              {[...meta.tips, isWinWin ? "Puoi chiudere quando raggiungi l'accordo: la valutazione considera anche il tempo" : `Hai fino a ${maxTurns} risposte: chiudi quando vuoi`].map((t) => (
                <View key={t} style={styles.tipRow}><Ionicons name="checkmark-circle" size={16} color={CGYM_ORANGE} /><Text style={styles.tipTxt}>{t}</Text></View>
              ))}
            </View>
          </View>

          {/* Permesso microfono — spiegazione prima del popup di sistema */}
          {!useText && mic !== "granted" && (
            <View style={styles.permCard} testID="cgym-rp-mic-perm">
              <Ionicons name="mic-outline" size={22} color={CGYM_ORANGE} />
              <View style={{ flex: 1 }}>
                <Text style={styles.permTitle}>{mic === "blocked" ? "Microfono non consentito" : "Serve il microfono"}</Text>
                <Text style={styles.permSub}>
                  {mic === "blocked"
                    ? "Abilita il microfono nelle impostazioni dell'app per rispondere a voce, oppure allenati scrivendo le risposte."
                    : "Per rispondere a voce al cliente l'app registra solo mentre tieni attivo il microfono."}
                </Text>
                <View style={{ flexDirection: "row", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  {mic === "blocked" && Platform.OS !== "web" && (
                    <Pressable onPress={openAppSettings} style={styles.smallBtn} testID="cgym-rp-open-settings"><Text style={styles.smallBtnTxt}>Apri impostazioni</Text></Pressable>
                  )}
                  <Pressable onPress={() => setUseText(true)} style={[styles.smallBtn, { backgroundColor: theme.color.surfaceTertiary }]} testID="cgym-rp-use-text">
                    <Text style={[styles.smallBtnTxt, { color: theme.color.onSurface }]}>Rispondo scrivendo</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          )}

          <Pressable onPress={begin} disabled={starting} style={[styles.primaryBtn, starting && { opacity: 0.6 }]} testID="cgym-rp-start">
            {starting ? <ActivityIndicator color="#FFF" /> : (<><Ionicons name={useText ? "chatbox-ellipses" : "mic"} size={20} color="#FFF" /><Text style={styles.primaryTxt}>{useText ? "Inizia (modalità testo)" : "Inizia il role-play"}</Text></>)}
          </Pressable>
          {useText && (
            <Pressable onPress={() => setUseText(false)} style={{ alignSelf: "center", marginTop: 10, minHeight: 44, justifyContent: "center" }} testID="cgym-rp-use-voice">
              <Text style={{ color: theme.color.brandPrimary, fontWeight: "700" }}>Preferisco rispondere a voce</Text>
            </Pressable>
          )}
        </ScrollView>
      )}

      {(phase === "live" || phase === "evaluating") && (
        <View style={{ flex: 1 }} testID="cgym-rp-live">
          <View style={styles.liveBar}>
            <View>
              <Text style={styles.liveTurn}>{isWinWin ? "Intervento" : "Risposta"} {Math.min(turn + 1, maxTurns)}/{maxTurns}</Text>
              {(isWinWin || phases.length > 0) && startedAt && (
                <Text style={[styles.liveTimer, elapsedSec >= meta.duration_min * 60 && { color: theme.color.error }]} testID="cgym-rp-timer">
                  {(() => { const rem = Math.max(0, meta.duration_min * 60 - elapsedSec); return `${String(Math.floor(rem / 60)).padStart(2, "0")}:${String(rem % 60).padStart(2, "0")}`; })()} · {curPhase?.name || wwPhase || "1 · Apertura e clima"}
                </Text>
              )}
            </View>
            <View style={[styles.moodPill, { backgroundColor: CGYM_MOOD_META[mood].color + "22" }]} testID="cgym-rp-mood">
              <View style={[styles.moodDot, { backgroundColor: CGYM_MOOD_META[mood].color }]} />
              <Text style={[styles.moodTxt, { color: CGYM_MOOD_META[mood].color }]}>Cliente: {CGYM_MOOD_META[mood].label}</Text>
            </View>
          </View>
          <ScrollView ref={(r) => { scrollRef.current = r; }} contentContainerStyle={{ padding: 14, gap: 10 }} style={{ flex: 1 }}>
            {bubbles.map((b) => (
              <View key={b.id} style={[styles.bubble, b.role === "cliente" ? styles.bubbleClient : styles.bubbleMe]} testID={`cgym-rp-bubble-${b.role}`}>
                <Text style={styles.bubbleWho}>{b.role === "cliente" ? `${meta.customer.split(",")[0]} (cliente)` : "Tu"}</Text>
                <Text style={[styles.bubbleTxt, b.role !== "cliente" && { color: "#FFF" }]}>{b.text}</Text>
              </View>
            ))}
            {phase === "evaluating" && (
              <View style={{ alignItems: "center", padding: 20, gap: 8 }} testID="cgym-rp-evaluating">
                <ActivityIndicator color={CGYM_ORANGE} />
                <Text style={styles.cardSub}>Sto valutando la conversazione…</Text>
              </View>
            )}
          </ScrollView>

          {phase === "live" && (
            <View style={[styles.controls, { paddingBottom: navPad }]}>
              <Text style={styles.status} testID="cgym-rp-status">{statusLabel}</Text>
              {useText ? (
                <View style={{ flexDirection: "row", gap: 8, alignItems: "center", marginRight: 76 }}>
                  <TextInput value={typed} onChangeText={setTyped} placeholder="Scrivi la tua risposta…" placeholderTextColor={theme.color.muted} style={styles.input} editable={!ended && live !== "thinking"} onSubmitEditing={sendTyped} testID="cgym-rp-text-input" />
                  <Pressable onPress={sendTyped} disabled={ended || !typed.trim() || live === "thinking"} style={[styles.sendBtn, (ended || !typed.trim() || live === "thinking") && { opacity: 0.5 }]} testID="cgym-rp-text-send">
                    {live === "thinking" ? <ActivityIndicator color="#FFF" size="small" /> : <Ionicons name="send" size={18} color="#FFF" />}
                  </Pressable>
                </View>
              ) : (
                <View style={styles.micRow}>
                  <Pressable
                    onPress={() => { if (bubbles.length) { const last = [...bubbles].reverse().find((b) => b.role === "cliente"); if (last) notify("Cliente", last.text); } }}
                    style={styles.sideBtn}
                    hitSlop={8}
                    testID="cgym-rp-show-last"
                    accessibilityLabel="Rileggi l'ultima battuta"
                  >
                    <Ionicons name="text" size={20} color={theme.color.onSurface} />
                  </Pressable>
                  <Pressable
                    onPress={onRecordPress}
                    disabled={ended || live === "sending" || live === "thinking"}
                    style={[styles.micBtn, live === "recording" && styles.micBtnRec, (ended || live === "sending" || live === "thinking") && { opacity: 0.5 }]}
                    testID="cgym-rp-mic"
                    accessibilityLabel={live === "recording" ? "Ferma e invia" : "Rispondi a voce"}
                  >
                    {live === "sending" || live === "thinking" ? <ActivityIndicator color="#FFF" /> : <Ionicons name={live === "recording" ? "stop" : "mic"} size={30} color="#FFF" />}
                  </Pressable>
                  <Pressable onPress={() => setUseText(true)} style={styles.sideBtn} hitSlop={8} testID="cgym-rp-switch-text" accessibilityLabel="Rispondi scrivendo">
                    <Ionicons name="keypad-outline" size={20} color={theme.color.onSurface} />
                  </Pressable>
                </View>
              )}
              <Pressable onPress={finish} disabled={live === "sending" || live === "thinking"} style={[styles.finishBtn, ended && { backgroundColor: theme.color.success }]} testID="cgym-rp-finish">
                <Ionicons name="flag" size={16} color="#FFF" />
                <Text style={styles.finishTxt}>{ended ? "Vedi il risultato" : "Termina e valuta"}</Text>
              </Pressable>
            </View>
          )}
        </View>
      )}

      {phase === "results" && result && (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: navPad + 16, gap: 12 }} testID="cgym-rp-results">
          <View style={[styles.card, { alignItems: "center" }]}>
            <Text style={styles.resLbl}>Punteggio</Text>
            <View style={[styles.scoreRing, { borderColor: scoreColor(result.score || 0) }]} testID="cgym-rp-score">
              <Text style={[styles.scoreTxt, { color: scoreColor(result.score || 0) }]}>{result.score ?? 0}</Text>
              <Text style={styles.scoreOf}>/100</Text>
            </View>
            <Text style={styles.cardSub}>{result.feedback?.summary}</Text>
          </View>
          {!!result.feedback?.what_worked?.length && (
            <View style={styles.card}>
              <Text style={[styles.resHead, { color: theme.color.success }]}>Cosa ha funzionato</Text>
              {result.feedback.what_worked.map((t, i) => (<View key={i} style={styles.tipRow}><Ionicons name="checkmark-circle" size={16} color={theme.color.success} /><Text style={styles.tipTxt}>{t}</Text></View>))}
            </View>
          )}
          {!!result.feedback?.to_improve?.length && (
            <View style={styles.card}>
              <Text style={[styles.resHead, { color: CGYM_ORANGE }]}>Da migliorare</Text>
              {result.feedback.to_improve.map((t, i) => (<View key={i} style={styles.tipRow}><Ionicons name="arrow-up-circle" size={16} color={CGYM_ORANGE} /><Text style={styles.tipTxt}>{t}</Text></View>))}
            </View>
          )}
          {!!result.feedback?.suggested_answer && (
            <View style={[styles.card, { backgroundColor: theme.color.brandTertiary, borderColor: theme.color.brandTertiary }]}>
              <Text style={[styles.resHead, { color: theme.color.brandPrimary }]}>Risposta ideale (esempio)</Text>
              <Text style={styles.quote}>“{result.feedback.suggested_answer}”</Text>
            </View>
          )}
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Pressable onPress={restart} style={[styles.primaryBtn, { flex: 1, backgroundColor: theme.color.surfaceTertiary }]} testID="cgym-rp-retry">
              <Ionicons name="refresh" size={18} color={theme.color.onSurface} /><Text style={[styles.primaryTxt, { color: theme.color.onSurface }]}>Rifai</Text>
            </Pressable>
            <Pressable onPress={() => router.replace("/corporate-gym" as any)} style={[styles.primaryBtn, { flex: 1 }]} testID="cgym-rp-done">
              <Ionicons name="barbell" size={18} color="#FFF" /><Text style={styles.primaryTxt}>Torna al Gym</Text>
            </Pressable>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function scoreColor(s: number) {
  return s >= 75 ? theme.color.success : s >= 50 ? CGYM_ORANGE : theme.color.error;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.color.border, backgroundColor: theme.color.surfaceSecondary },
  title: { fontSize: 16, fontWeight: "800", color: theme.color.onSurface },
  card: { backgroundColor: theme.color.surfaceSecondary, borderRadius: 16, borderWidth: 1, borderColor: theme.color.border, padding: 16, gap: 8, marginBottom: 12 },
  cardTitle: { fontSize: 18, fontWeight: "900", color: theme.color.onSurface, textAlign: "center" },
  cardSub: { fontSize: 13, color: theme.color.muted, lineHeight: 19, textAlign: "center" },
  tips: { gap: 8, marginTop: 6 },
  tipRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  tipTxt: { flex: 1, fontSize: 13, color: theme.color.onSurface, lineHeight: 19 },
  permCard: { flexDirection: "row", gap: 10, backgroundColor: CGYM_ORANGE + "14", borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: CGYM_ORANGE + "44" },
  permTitle: { fontSize: 14, fontWeight: "800", color: theme.color.onSurface },
  permSub: { fontSize: 12, color: theme.color.muted, marginTop: 2, lineHeight: 17 },
  smallBtn: { backgroundColor: CGYM_ORANGE, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 999, minHeight: 36, justifyContent: "center" },
  smallBtnTxt: { color: "#FFF", fontWeight: "800", fontSize: 12 },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: CGYM_ORANGE, borderRadius: 14, paddingVertical: 15, minHeight: 50 },
  primaryTxt: { color: "#FFF", fontWeight: "800", fontSize: 15 },
  liveBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 8, backgroundColor: theme.color.surfaceSecondary, borderBottomWidth: 1, borderBottomColor: theme.color.divider },
  liveTurn: { fontSize: 12, fontWeight: "800", color: theme.color.muted },
  liveTimer: { fontSize: 11, fontWeight: "800", color: CGYM_ORANGE, marginTop: 1 },
  durRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 2 },
  durTxt: { fontSize: 12, color: CGYM_ORANGE, fontWeight: "800" },
  moodPill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  moodDot: { width: 8, height: 8, borderRadius: 4 },
  moodTxt: { fontSize: 12, fontWeight: "800" },
  bubble: { maxWidth: "86%", borderRadius: 16, padding: 12 },
  bubbleClient: { alignSelf: "flex-start", backgroundColor: theme.color.surfaceSecondary, borderWidth: 1, borderColor: theme.color.border, borderTopLeftRadius: 4 },
  bubbleMe: { alignSelf: "flex-end", backgroundColor: theme.color.brandPrimary, borderTopRightRadius: 4 },
  bubbleWho: { fontSize: 10, fontWeight: "800", color: theme.color.muted, marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.4 },
  bubbleTxt: { fontSize: 14, lineHeight: 20, color: theme.color.onSurface },
  controls: { backgroundColor: theme.color.surfaceSecondary, borderTopWidth: 1, borderTopColor: theme.color.border, paddingHorizontal: 16, paddingTop: 10, gap: 10 },
  status: { textAlign: "center", fontSize: 12, fontWeight: "700", color: theme.color.muted },
  micRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 26, marginRight: 76 },
  micBtn: { width: 76, height: 76, borderRadius: 38, backgroundColor: CGYM_ORANGE, alignItems: "center", justifyContent: "center" },
  micBtnRec: { backgroundColor: theme.color.error },
  sideBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.color.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  input: { flex: 1, borderWidth: 1, borderColor: theme.color.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: theme.color.onSurface, backgroundColor: theme.color.surface, minHeight: 44 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.color.brandPrimary, alignItems: "center", justifyContent: "center" },
  finishBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: theme.color.onSurfaceTertiary, borderRadius: 12, paddingVertical: 11, minHeight: 44, marginRight: 76 },
  finishTxt: { color: "#FFF", fontWeight: "800", fontSize: 13 },
  resLbl: { fontSize: 12, fontWeight: "800", color: theme.color.muted, textTransform: "uppercase", letterSpacing: 0.4 },
  scoreRing: { width: 120, height: 120, borderRadius: 60, borderWidth: 8, alignItems: "center", justifyContent: "center", marginVertical: 6 },
  scoreTxt: { fontSize: 40, fontWeight: "900", lineHeight: 44 },
  scoreOf: { fontSize: 12, color: theme.color.muted, fontWeight: "700" },
  resHead: { fontSize: 14, fontWeight: "900", marginBottom: 2 },
  quote: { fontSize: 14, fontStyle: "italic", color: theme.color.onSurface, lineHeight: 21 },
});

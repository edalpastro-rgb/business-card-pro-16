// V50.z315 — ViolaWake SDK: orchestratore (context + hook).
// wake-word «Axon» (modello ONNX offline, V50.z378) → cattura comando (riconoscimento on-device, gratis)
// → routing deterministico backend → trigger proattivo (source=wake_word) con risposta parlata
//   oppure chat Axon in modalità voce (comandi liberi: agenda, ricerche web, tutto ciò che sa fare Axon).
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { isMicLeased, onMicLease } from "@/src/utils/micLease"; // V50.z483 — pausa wake-word mentre l'app registra
import { loadTtsMuted } from "@/src/utils/ttsGate"; // V50.z453
import { AppState, Platform, Linking } from "react-native";
import * as Haptics from "expo-haptics";
import { useAuth } from "@/src/auth";
import { api } from "@/src/api";
import { openAxonChat } from "@/src/axonProactive";
import { playActivationEffect } from "@/src/activation/events";
import { triggerFindPhone, stopFindPhoneEverywhere } from "@/src/findPhone/findPhoneClient"; // V50.z492 // V50.z318
import { playAudioBase64 } from "@/src/utils/audioPlayback";
import { violaApi } from "./api";
import { createWakeEngine, WAKE_ENGINE_SUPPORTED } from "./wakeEngine";
import { startForegroundService, stopForegroundService, FOREGROUND_SERVICE_AVAILABLE } from "./foregroundService";
import { captureCommand, abortCapture, getMicPermission, requestMicPermission, requestRecognizerPermission, recognitionAvailable, supportsOnDevice, CAPTURE_SUPPORTED } from "./commandCapture";
import { captureCommandWhisper, abortWhisperCapture, WHISPER_CAPTURE_SUPPORTED } from "./whisperCapture"; // V50.z348 — cattura robusta al rumore
import type { ViolaState, ViolaSettings, ViolaModule, WakeEngine, PermissionStatus } from "./types";
import { VIOLA_KEYWORD_LABEL } from "./types";
import { vdApi, isSwitchCommand } from "./devices";
import { confirmCritical } from "./guard";
import { WakeWord } from "./wakeWord"; // V50.z377 — motore Axon custom (start/stop/onWake) // V50.z371 — Blocco 4: comandi critici → PIN/impronta // V50.z370 — Blocco 1: selezione dispositivo
import { vpApi, takeLastSpeaker, setLastSpeaker, type SpeakerInfo } from "./voiceprintApi"; // V50.z372 — Blocchi 2-3: impronta vocale


type Ctx = {
  state: ViolaState;
  error: string | null;
  lastTranscript: string;
  lastReply: string;
  keywordLabel: string;
  settings: ViolaSettings | null;
  module: ViolaModule | null;
  isMaster: boolean;
  supported: boolean;
  /** V50.z378 — motore Axon ONNX nativo disponibile (build Android); altrimenti riconoscitore di sistema. */
  axonEngine: boolean;
  backgroundService: boolean; // Android: servizio in primo piano disponibile nella build
  onDeviceStt: boolean;
  permission: PermissionStatus | null;
  /** V50.z372 — impronta vocale attiva: Axon risponde solo alle voci registrate (voce sconosciuta → silenzio). */
  voiceprintEnforced: boolean;
  /** Ultima voce riconosciuta (nome) — per la UI. */
  lastSpeaker: string | null;
  refresh: () => Promise<void>;
  updateSettings: (patch: Partial<ViolaSettings>) => Promise<void>;
  setModule: (enabled: boolean, note?: string) => Promise<void>;
  askPermission: () => Promise<boolean>;
  openSettings: () => void;
  /** Simula la wake-word (test dalla schermata «Viola», anche senza dire la parola). */
  simulateWake: () => void;
  /** Invia un comando testuale nello stesso flusso della voce (test su web). */
  runCommand: (transcript: string, speaker?: SpeakerInfo | null) => Promise<void>;
};

const ViolaCtx = createContext<Ctx | null>(null);

export function useViolaWake(): Ctx {
  const c = useContext(ViolaCtx);
  if (!c) throw new Error("useViolaWake deve stare dentro <ViolaWakeProvider>");
  return c;
}

/** V50.z367 — variante senza throw (header Home): null se il provider non è montato. */
export function useViolaWakeOptional(): Ctx | null {
  return useContext(ViolaCtx);
}

export function ViolaWakeProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [state, setState] = useState<ViolaState>("off");
  const [error, setError] = useState<string | null>(null);
  const [lastTranscript, setLastTranscript] = useState("");
  const [lastReply, setLastReply] = useState("");
  const [settings, setSettings] = useState<ViolaSettings | null>(null);
  const [module, setModuleState] = useState<ViolaModule | null>(null);
  const [isMaster, setIsMaster] = useState(false);
  const [permission, setPermission] = useState<PermissionStatus | null>(null);
  const [keywordLabel, setKeywordLabel] = useState(VIOLA_KEYWORD_LABEL);
  const [voiceprintEnforced, setVoiceprintEnforced] = useState(false); // V50.z372
  const [lastSpeaker, setLastSpeakerName] = useState<string | null>(null);
  const vpRef = useRef(false);
  vpRef.current = voiceprintEnforced;
  const engineRef = useRef<WakeEngine | null>(null);
  const busyRef = useRef(false);
  const settingsRef = useRef<ViolaSettings | null>(null);
  settingsRef.current = settings;
  const moduleRef = useRef<ViolaModule | null>(null);
  moduleRef.current = module;
  // V50.z385 — anti-loop: trascrizioni vuote consecutive → nessun annuncio, riarmo ritardato (cooldown) e tetto massimo
  const emptyStreakRef = useRef(0);
  const rearmDelayRef = useRef(0);
  const cooldownUntilRef = useRef(0);
  const rearmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const EMPTY_MAX_ATTEMPTS = 3;          // dopo 3 vuoti di fila → pausa lunga
  const EMPTY_COOLDOWN_MS = 8000;        // pausa breve dopo un vuoto
  const EMPTY_LONG_COOLDOWN_MS = 60000;  // pausa lunga dopo il tetto massimo

  const supported = WAKE_ENGINE_SUPPORTED && CAPTURE_SUPPORTED;
  const axonEngine = WakeWord.isAvailable();
  const onDeviceStt = useMemo(() => (supported ? supportsOnDevice() : false), [supported]);

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const r = await violaApi.getSettings();
      setSettings(r.settings);
      setModuleState(r.module);
      setIsMaster(r.is_master);
    } catch { /* offline: manteniamo lo stato precedente */ }
    try { setVoiceprintEnforced(!!(await vpApi.status()).enforced); } catch { /* noop */ } // V50.z372
    if (supported) {
      try { setPermission(await getMicPermission()); } catch { /* noop */ }
    }
  }, [user, supported]);

  useEffect(() => { void refresh(); }, [refresh]);

  const stopEngine = useCallback(async () => {
    const e = engineRef.current;
    engineRef.current = null;
    if (e) await e.stop();
  }, []);

  const speak = useCallback(async (text: string) => {
    if (!text) return;
    setState("speaking");
    setLastReply(text);
    try {
      const r = await violaApi.tts(text.slice(0, 600));
      if (r?.audio_base64) {
        await new Promise<void>((resolve) => {
          (async () => { await loadTtsMuted(); return playAudioBase64(r.audio_base64, r.mime || "audio/mpeg", () => resolve()); })().catch(() => resolve());  // V50.z453 — rispetta «Solo testo»
        });
      }
    } catch { /* senza audio: resta il testo nella pill */ }
  }, []);

  /** Stato di riposo dopo un comando: in ascolto se il motore gira, altrimenti spento/non supportato. */
  const settle = useCallback(() => {
    setState(engineRef.current ? "listening" : supported ? "off" : "unsupported");
  }, [supported]);

  /** Esegue il comando (già trascritto). Condiviso da voce e test. */
  const runCommand = useCallback(async (transcript: string, speaker: SpeakerInfo | null = null) => {
    const st = settingsRef.current;
    const t0 = Date.now();
    setLastTranscript(transcript);
    setLastSpeakerName(speaker?.name || null);
    if (!transcript.trim()) {
      // V50.z385 — STT vuoto (silenzio/rumore): NIENTE voce, NIENTE riarmo immediato → niente loop «Non ho capito»
      emptyStreakRef.current += 1;
      const capped = emptyStreakRef.current >= EMPTY_MAX_ATTEMPTS;
      rearmDelayRef.current = capped ? EMPTY_LONG_COOLDOWN_MS : EMPTY_COOLDOWN_MS;
      cooldownUntilRef.current = Date.now() + rearmDelayRef.current;
      if (capped) emptyStreakRef.current = 0;
      void violaApi.logEvent("command", { detail: `vuoto (${capped ? "pausa lunga" : "pausa breve"})`, engine: "device" });
      setState("listening");
      return;
    }
    emptyStreakRef.current = 0;
    rearmDelayRef.current = 0;
    setState("thinking");
    void violaApi.logEvent("command", { transcript, engine: st?.stt_engine || "device", latency_ms: Date.now() - t0, detail: speaker ? `voce: ${speaker.name}` : undefined });
    const spk = speaker?.profile_id || null;
    let route: Awaited<ReturnType<typeof violaApi.route>>;
    try {
      route = await violaApi.route(transcript, undefined, spk);
    } catch {
      route = { mode: "chat", prompt: transcript };
    }
    if (route.mode === "denied") { // V50.z372 — voce secondaria senza permesso per questa sezione
      await speak(route.reply || "Non sei autorizzato a questa sezione.");
      settle();
      return;
    }
    if (route.mode === "guard") { // V50.z371 — mai eseguire comandi critici solo a voce
      void violaApi.logEvent("guard", { transcript, detail: route.category });
      await speak(route.message || "Comando critico: confermalo con impronta o PIN.");
      const tok = await confirmCritical(route.category);
      if (!tok) { await speak("Comando annullato."); settle(); return; }
      try { route = await violaApi.route(transcript, tok, spk); } catch { route = { mode: "chat", prompt: transcript }; }
      if (route.mode === "guard" || route.mode === "denied") { await speak("Conferma non valida, comando annullato."); settle(); return; }
    }
    if (route.mode === "cancel") {
      void violaApi.logEvent("cancelled", { transcript });
      void stopFindPhoneEverywhere(); // «stop» ferma anche «trova il mio telefono» (locale + remoto, V50.z492)
      await speak("OK!");
      settle();
      return;
    }
    if (route.mode === "effect") {
      void violaApi.logEvent("effect", { transcript });
      const us = await api<{ assistant_name?: string; assistant_voice?: string }>("/user-settings").catch(() => ({} as any));
      playActivationEffect({ name: us?.assistant_name || "Axon", voice: us?.assistant_voice, greet: true });
      settle();
      return;
    }
    if (route.mode === "find_phone") {
      void violaApi.logEvent("find_phone", { transcript });
      // V50.z492 — mai squillare se stesso: il backend sceglie l'altro dispositivo (telefono → tablet, tablet/pc/CarPlay → telefono)
      const r = await triggerFindPhone(transcript, { mode: (route as any).ring_mode === "vibrate" ? "vibrate" : undefined });
      await speak(r.ok ? (r.result?.mode === "vibrate" ? `Faccio vibrare ${r.result.target.name}.` : `Faccio squillare ${r.result?.target.name || "il telefono"}.`) : "Non trovo un altro dispositivo da far squillare.");
      settle();
      return;
    }
    if (route.mode === "trigger") {
      try {
        const r = await violaApi.trigger(route.action);
        void violaApi.logEvent("trigger", { transcript, detail: route.action, latency_ms: Date.now() - t0 });
        const reply = (r?.reply || "Fatto.").replace(/\[\[NAV:[^\]]*\]\]/g, "").replace(/[*_#`]/g, "").trim();
        if (st?.speak_reply !== false) await speak(reply); else setLastReply(reply);
      } catch (e: any) {
        void violaApi.logEvent("error", { transcript, detail: String(e?.message || e).slice(0, 200) });
        await speak("Non sono riuscita a completare il comando.");
      }
      settle();
      return;
    }
    // comandi liberi → chat Axon (omniscienza CRM, ricerche web, azioni) con risposta parlata
    void violaApi.logEvent("chat", { transcript, latency_ms: Date.now() - t0 });
    setLastReply("");
    openAxonChat(route.prompt, { voice: st?.speak_reply !== false });
    settle();
  }, [speak, settle]);

  const handleWake = useCallback(async () => {
    if (busyRef.current) return;
    if (Date.now() < cooldownUntilRef.current) return; // V50.z385 — in cooldown dopo trascrizioni vuote: ignora
    busyRef.current = true;
    rearmDelayRef.current = 0;
    const st = settingsRef.current;
    try {
      void violaApi.logEvent("wake", { engine: "axon-onnx" });
      if (st?.confirm_sound !== false && Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      }
      await stopEngine(); // libera il microfono per il riconoscimento
      // V50.z370 — più dispositivi in ascolto? chiedi al server chi deve rispondere (Desktop / Telefono / Tablet)
      let gate: Awaited<ReturnType<typeof vdApi.wake>> | null = null;
      try { gate = await vdApi.wake(); } catch { gate = null; }
      if (gate?.mode === "silent") { setState("listening"); return; }
      setState("capturing");
      setLastTranscript("");
      setLastReply("");
      const useWhisper = (st?.stt_engine === "whisper" || vpRef.current) && WHISPER_CAPTURE_SUPPORTED; // V50.z372 — impronta attiva → serve l'audio (Whisper), non il riconoscitore del telefono
      if (gate?.mode === "ask") {
        await speak(gate.prompt || "Da dove vuoi che risponda? Desktop, Telefono o Tablet?");
        setState("capturing");
        setLastSpeaker(null, false);
        const choice = useWhisper
          ? (await captureCommandWhisper({ maxSeconds: 5, onPartial: setLastTranscript })).text
          : await captureCommand({ maxSeconds: 5, onPartial: setLastTranscript });
        if (takeLastSpeaker().unknown) { setState("listening"); return; } // voce sconosciuta → silenzio
        if (choice) {
          try { const sel = await vdApi.select(choice); setLastReply(sel.message); if (sel.ok && sel.is_me) await speak(sel.message); else if (sel.ok) setState("listening"); else await speak(sel.message); }
          catch { /* un altro dispositivo ha già risposto */ }
        }
        return;
      }
      // V50.z348 — motore comandi: «whisper» = registrazione con soglia adattiva al rumore + Whisper server (traffico/metro);
      // «device» = riconoscitore del telefono (gratis, on-device). Se Whisper non ottiene nulla si riprova con il telefono.
      let text = "";
      setLastSpeaker(null, false);
      if (useWhisper) {
        const r = await captureCommandWhisper({ maxSeconds: st?.listen_seconds || 6, onPartial: setLastTranscript });
        text = r.text;
        void violaApi.logEvent("capture", { engine: "whisper", detail: `ambiente ${r.ambientDb == null ? "n.d." : r.ambientDb} dB (${r.band || "auto"}) · noise ${r.noiseDb == null ? "n.d." : Math.round(r.noiseDb)} dBFS · ${r.durationMs} ms`, latency_ms: r.durationMs });
        if (!text && !vpRef.current && r.durationMs > 0 && r.durationMs < 1500) text = await captureCommand({ maxSeconds: st?.listen_seconds || 6, onPartial: setLastTranscript });
      } else {
        text = await captureCommand({ maxSeconds: st?.listen_seconds || 6, onPartial: setLastTranscript });
      }
      // V50.z372 — impronta vocale: voce NON riconosciuta → SILENZIO TOTALE (nessuna risposta), torna in ascolto
      const who = takeLastSpeaker();
      if (who.unknown) { setLastTranscript(""); setLastSpeakerName(null); setState("listening"); return; }
      if (text && isSwitchCommand(text)) { // V50.z370 — «passa al telefono»
        try { const sel = await vdApi.select(text); setLastReply(sel.message); await speak(sel.message); } catch { await speak("Non sono riuscita a cambiare dispositivo."); }
        return;
      }
      await runCommand(text, who.speaker);
    } catch (e: any) {
      setError(String(e?.message || e));
      void violaApi.logEvent("error", { detail: String(e?.message || e).slice(0, 200) });
    } finally {
      busyRef.current = false;
      // torna in ascolto della wake-word se ancora attivo — V50.z385: dopo un STT vuoto il riarmo è RITARDATO (cooldown)
      if (settingsRef.current?.enabled && moduleRef.current?.enabled && !isMicLeased()) {
        const delay = rearmDelayRef.current;
        if (delay > 0) {
          if (rearmTimerRef.current) clearTimeout(rearmTimerRef.current);
          rearmTimerRef.current = setTimeout(() => { rearmTimerRef.current = null; if (settingsRef.current?.enabled && moduleRef.current?.enabled) void startEngine(); }, delay);
        } else void startEngine();
      } else setState("off");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopEngine, runCommand]);

  const startEngine = useCallback(async () => {
    if (!supported) { setState("unsupported"); return; }
    // V50.z378 — motore Axon ONNX (modulo nativo) oppure riconoscitore di sistema: nessuna chiave esterna
    const perm = await getMicPermission();
    setPermission(perm);
    if (!perm.granted) { setState("no_permission"); return; }
    if (isMicLeased()) { setState("off"); return; } // V50.z483 — un registratore dell'app ha il microfono: riparte al rilascio
    if (engineRef.current) { setState("listening"); return; }
    setState("starting");
    setError(null);
    const st = settingsRef.current;
    const engine = createWakeEngine({
      keywordMode: st?.keyword_mode || "custom",
      sensitivity: st?.sensitivity ?? 0.6,
      onWake: () => { void handleWake(); },
      onError: (m) => setError(m),
    });
    engineRef.current = engine;
    try {
      await engine.start();
      setKeywordLabel(engine.keywordLabel);
      setState("listening");
      // Android: servizio in primo piano con notifica «Viola in ascolto» → microfono attivo anche a schermo bloccato
      if (Platform.OS === "android" && !WakeWord.isAvailable()) void startForegroundService(engine.keywordLabel);
    } catch (e: any) {
      engineRef.current = null;
      setError(String(e?.message || e));
      setState("error");
      void violaApi.logEvent("error", { detail: `start: ${String(e?.message || e).slice(0, 200)}` });
    }
  }, [supported, handleWake]);

  // Avvio/arresto automatico in base a modulo azienda + impostazione utente
  const shouldRun = !!user && !!settings?.enabled && !!module?.enabled;
  useEffect(() => {
    if (shouldRun) void startEngine();
    else { if (rearmTimerRef.current) { clearTimeout(rearmTimerRef.current); rearmTimerRef.current = null; } void stopEngine(); void stopForegroundService(); abortCapture(); abortWhisperCapture(); setState(supported ? "off" : "unsupported"); }
    return () => { if (rearmTimerRef.current) { clearTimeout(rearmTimerRef.current); rearmTimerRef.current = null; } void stopEngine(); void stopForegroundService(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldRun, settings?.sensitivity, settings?.keyword_mode]);

  // V50.z483 — lease microfono: quando un registratore dell'app parte fermiamo il motore (e il riarmo); al rilascio ripartiamo
  const shouldRunRef = useRef(shouldRun); shouldRunRef.current = shouldRun;
  useEffect(() => onMicLease((busy) => {
    if (busy) {
      if (rearmTimerRef.current) { clearTimeout(rearmTimerRef.current); rearmTimerRef.current = null; }
      if (engineRef.current) { void stopEngine(); setState("off"); }
    } else if (shouldRunRef.current) void startEngine();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  // V50.z370 — presenza dispositivo: heartbeat ogni 30 s mentre ascolta; release quando l'ascolto si spegne / l'app si chiude
  useEffect(() => {
    if (state !== "listening" && state !== "capturing" && state !== "thinking" && state !== "speaking") return;
    void vdApi.heartbeat(true).catch(() => {});
    const t = setInterval(() => { void vdApi.heartbeat(true).catch(() => {}); }, 30000);
    return () => clearInterval(t);
  }, [state]);
  useEffect(() => {
    if (!shouldRun) { void vdApi.release().catch(() => {}); return; }
    return () => { void vdApi.release().catch(() => {}); };
  }, [shouldRun]);

  // iOS: con «audio» in background il motore continua; Android senza servizio in primo piano
  // il sistema può sospendere il microfono → al ritorno in primo piano riavviamo l'ascolto.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active" && shouldRun && !busyRef.current) void startEngine();
    });
    return () => sub.remove();
  }, [shouldRun, startEngine]);

  const updateSettings = useCallback(async (patch: Partial<ViolaSettings>) => {
    const r = await violaApi.updateSettings(patch);
    setSettings(r.settings);
    setModuleState(r.module);
  }, []);

  const setModule = useCallback(async (enabled: boolean, note?: string) => {
    await violaApi.setModule(enabled, note);
    await refresh();
  }, [refresh]);

  const askPermission = useCallback(async () => {
    if (!supported) return false;
    const cur = await getMicPermission();
    if (cur.granted) { setPermission(cur); return true; }
    if (!cur.canAskAgain) { setPermission(cur); return false; }
    const p = await requestMicPermission();
    if (p.granted && Platform.OS === "ios") await requestRecognizerPermission();
    setPermission(p);
    if (p.granted && shouldRun) void startEngine();
    return p.granted;
  }, [supported, shouldRun, startEngine]);

  const openSettings = useCallback(() => { Linking.openSettings().catch(() => {}); }, []);

  // V50.z377 — «Simula rilevamento Axon»: stesso percorso di una wake-word reale (callback onWake del motore) + apre la chat con Axon.
  const simulateWake = useCallback(() => {
    openAxonChat(); // apre la chat con Axon
    if (!supported || !recognitionAvailable()) { setError("Cattura vocale non disponibile su questo dispositivo/anteprima: usa il comando scritto."); return; }
    if (engineRef.current && WakeWord.isAvailable() && WakeWord.isRunning()) { WakeWord.simulate(); return; } // → onWake → handleWake
    void handleWake();
  }, [supported, handleWake]);

  const value = useMemo<Ctx>(() => ({
    state, error, lastTranscript, lastReply, keywordLabel, settings, module, isMaster, supported, axonEngine, backgroundService: FOREGROUND_SERVICE_AVAILABLE, onDeviceStt, permission, voiceprintEnforced, lastSpeaker,
    refresh, updateSettings, setModule, askPermission, openSettings, simulateWake, runCommand,
  }), [state, error, lastTranscript, lastReply, keywordLabel, settings, module, isMaster, supported, axonEngine, onDeviceStt, permission, voiceprintEnforced, lastSpeaker, refresh, updateSettings, setModule, askPermission, openSettings, simulateWake, runCommand]);

  return <ViolaCtx.Provider value={value}>{children}</ViolaCtx.Provider>;
}

// V50.z315 — ViolaWake SDK: orchestratore (context + hook).
// wake-word «Viola» (Porcupine, offline) → cattura comando (riconoscimento on-device, gratis)
// → routing deterministico backend → trigger proattivo (source=wake_word) con risposta parlata
//   oppure chat Axon in modalità voce (comandi liberi: agenda, ricerche web, tutto ciò che sa fare Axon).
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform, Linking } from "react-native";
import * as Haptics from "expo-haptics";
import { useAuth } from "@/src/auth";
import { openAxonChat } from "@/src/axonProactive";
import { playAudioBase64 } from "@/src/utils/audioPlayback";
import { violaApi } from "./api";
import { createWakeEngine, WAKE_ENGINE_SUPPORTED } from "./wakeEngine";
import { startForegroundService, stopForegroundService, FOREGROUND_SERVICE_AVAILABLE } from "./foregroundService";
import { captureCommand, abortCapture, getMicPermission, requestMicPermission, requestRecognizerPermission, recognitionAvailable, supportsOnDevice, CAPTURE_SUPPORTED } from "./commandCapture";
import type { ViolaState, ViolaSettings, ViolaModule, WakeEngine, PermissionStatus } from "./types";
import { VIOLA_KEYWORD_LABEL } from "./types";

const ACCESS_KEY = (process.env.EXPO_PUBLIC_PICOVOICE_ACCESS_KEY || "").trim();

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
  hasKey: boolean;
  backgroundService: boolean; // Android: servizio in primo piano disponibile nella build
  onDeviceStt: boolean;
  permission: PermissionStatus | null;
  refresh: () => Promise<void>;
  updateSettings: (patch: Partial<ViolaSettings>) => Promise<void>;
  setModule: (enabled: boolean, note?: string) => Promise<void>;
  askPermission: () => Promise<boolean>;
  openSettings: () => void;
  /** Simula la wake-word (test dalla schermata «Viola», anche senza dire la parola). */
  simulateWake: () => void;
  /** Invia un comando testuale nello stesso flusso della voce (test su web). */
  runCommand: (transcript: string) => Promise<void>;
};

const ViolaCtx = createContext<Ctx | null>(null);

export function useViolaWake(): Ctx {
  const c = useContext(ViolaCtx);
  if (!c) throw new Error("useViolaWake deve stare dentro <ViolaWakeProvider>");
  return c;
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
  const engineRef = useRef<WakeEngine | null>(null);
  const busyRef = useRef(false);
  const settingsRef = useRef<ViolaSettings | null>(null);
  settingsRef.current = settings;
  const moduleRef = useRef<ViolaModule | null>(null);
  moduleRef.current = module;

  const supported = WAKE_ENGINE_SUPPORTED && CAPTURE_SUPPORTED;
  const hasKey = !!ACCESS_KEY;
  const onDeviceStt = useMemo(() => (supported ? supportsOnDevice() : false), [supported]);

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const r = await violaApi.getSettings();
      setSettings(r.settings);
      setModuleState(r.module);
      setIsMaster(r.is_master);
    } catch { /* offline: manteniamo lo stato precedente */ }
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
          playAudioBase64(r.audio_base64, r.mime || "audio/mpeg", () => resolve()).catch(() => resolve());
        });
      }
    } catch { /* senza audio: resta il testo nella pill */ }
  }, []);

  /** Stato di riposo dopo un comando: in ascolto se il motore gira, altrimenti spento/non supportato. */
  const settle = useCallback(() => {
    setState(engineRef.current ? "listening" : supported ? "off" : "unsupported");
  }, [supported]);

  /** Esegue il comando (già trascritto). Condiviso da voce e test. */
  const runCommand = useCallback(async (transcript: string) => {
    const st = settingsRef.current;
    const t0 = Date.now();
    setLastTranscript(transcript);
    if (!transcript.trim()) {
      void violaApi.logEvent("command", { detail: "vuoto", engine: "device" });
      await speak("Non ho capito, ripeti dopo la parola.");
      settle();
      return;
    }
    setState("thinking");
    void violaApi.logEvent("command", { transcript, engine: st?.stt_engine || "device", latency_ms: Date.now() - t0 });
    let route: Awaited<ReturnType<typeof violaApi.route>>;
    try {
      route = await violaApi.route(transcript);
    } catch {
      route = { mode: "chat", prompt: transcript };
    }
    if (route.mode === "cancel") {
      void violaApi.logEvent("cancelled", { transcript });
      await speak("OK!");
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
    busyRef.current = true;
    const st = settingsRef.current;
    try {
      void violaApi.logEvent("wake", { engine: "porcupine" });
      if (st?.confirm_sound !== false && Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      }
      await stopEngine(); // libera il microfono per il riconoscimento
      setState("capturing");
      setLastTranscript("");
      setLastReply("");
      const text = await captureCommand({ maxSeconds: st?.listen_seconds || 6, onPartial: setLastTranscript });
      await runCommand(text);
    } catch (e: any) {
      setError(String(e?.message || e));
      void violaApi.logEvent("error", { detail: String(e?.message || e).slice(0, 200) });
    } finally {
      busyRef.current = false;
      // torna in ascolto della wake-word se ancora attivo
      if (settingsRef.current?.enabled && moduleRef.current?.enabled) void startEngine();
      else setState("off");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopEngine, runCommand]);

  const startEngine = useCallback(async () => {
    if (!supported) { setState("unsupported"); return; }
    if (!hasKey) { setState("needs_key"); return; }
    const perm = await getMicPermission();
    setPermission(perm);
    if (!perm.granted) { setState("no_permission"); return; }
    if (engineRef.current) { setState("listening"); return; }
    setState("starting");
    setError(null);
    const st = settingsRef.current;
    const engine = createWakeEngine({
      accessKey: ACCESS_KEY,
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
      if (Platform.OS === "android") void startForegroundService(engine.keywordLabel);
    } catch (e: any) {
      engineRef.current = null;
      setError(String(e?.message || e));
      setState("error");
      void violaApi.logEvent("error", { detail: `start: ${String(e?.message || e).slice(0, 200)}` });
    }
  }, [supported, hasKey, handleWake]);

  // Avvio/arresto automatico in base a modulo azienda + impostazione utente
  const shouldRun = !!user && !!settings?.enabled && !!module?.enabled;
  useEffect(() => {
    if (shouldRun) void startEngine();
    else { void stopEngine(); void stopForegroundService(); abortCapture(); setState(supported ? "off" : "unsupported"); }
    return () => { void stopEngine(); void stopForegroundService(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldRun, settings?.sensitivity, settings?.keyword_mode]);

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

  const simulateWake = useCallback(() => {
    if (!supported || !recognitionAvailable()) { setError("Cattura vocale non disponibile su questo dispositivo/anteprima: usa il comando scritto."); return; }
    void handleWake();
  }, [supported, handleWake]);

  const value = useMemo<Ctx>(() => ({
    state, error, lastTranscript, lastReply, keywordLabel, settings, module, isMaster, supported, hasKey, backgroundService: FOREGROUND_SERVICE_AVAILABLE, onDeviceStt, permission,
    refresh, updateSettings, setModule, askPermission, openSettings, simulateWake, runCommand,
  }), [state, error, lastTranscript, lastReply, keywordLabel, settings, module, isMaster, supported, hasKey, onDeviceStt, permission, refresh, updateSettings, setModule, askPermission, openSettings, simulateWake, runCommand]);

  return <ViolaCtx.Provider value={value}>{children}</ViolaCtx.Provider>;
}

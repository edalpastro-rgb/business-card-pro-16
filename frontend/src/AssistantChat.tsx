import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  DeviceEventEmitter, // V50.z315 — prompt vocale ViolaWake a chat già aperta
  View,
  Text,
  Pressable,
  Modal,
  TextInput,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  Image,
  Alert,
} from "react-native";
import { useInsetsSafe } from "@/src/hooks/useSafeBottom";
// V29.au — Import expo-audio per il pulsante microfono su native (APK Android/iOS).
// Prima era solo web (MediaRecorder), quindi su APK i pulsanti mic + ascolto
// continuo sparivano. Ora usiamo useAudioRecorder di expo-audio in modo nativo.
import { useAudioRecorder, useAudioRecorderState, AudioModule, RecordingPresets } from "expo-audio";
// V50.z186 — stop vocale nativo (barge-in) + sessione audio in background (moduli isolati)
import { useNativeBargeIn } from "@/src/voice/useNativeBargeIn";
import { ensureVoiceAudioMode, releaseVoiceAudioMode } from "@/src/voice/voiceAudioMode";
import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter, usePathname, useGlobalSearchParams } from "expo-router";
import { api } from "@/src/api";
import { SentenceSpeaker } from "@/src/utils/sentenceSpeaker";
import { useAuth } from "@/src/auth";
import { SaveConfirmModal, suggestFileName } from "@/src/SaveConfirmModal";
import { pickCommonFile } from "@/src/utils/filePicker";
import { GoogleDrivePickerModal } from "@/src/GoogleDrivePickerModal";
import { DocumentScannerModal } from "@/src/DocumentScannerModal";
import { DropboxPickerModal } from "@/src/DropboxPickerModal";
import { streamAssistantChat } from "@/src/utils/assistantStream";
import { useAxonProgress, AxonProgressBubble } from "@/src/axonProgress"; // V50.z194 — stato visibile >3s
import { ImportConfirmChips, hasImportQuestion } from "@/src/ImportConfirmChips"; // V50.z194 — «Vuoi che memorizzi…?»
import { QuickReplyButtons, QuickReplyToast, QUICK_REPLY_TOAST_MS, isClosedQuestion } from "@/src/axon-quick-reply"; // V50.z207 — Sì/No/Forse su domande chiuse
import { SetupNudgeCard, hasSetupNudge } from "@/src/SetupNudgeCard"; // V50.z211 — avviso configurazione incompleta → wizard
import { NavProactiveCard } from "@/src/NavChips"; // V50.z259 — deep link [[NAV]] / azioni [[ACTION]] / suggerimenti proattivi
import { FutureInterestsAlert } from "@/src/FutureInterestsAlert"; // V50.z219 — avviso interessi futuri (CarPlay…) dal wizard
import { ChatQueuePanel, type QueueItem } from "@/src/ChatQueuePanel"; // V50.z223 — coda messaggi non bloccante + chat parallele
import { ChatQueueInline } from "@/src/ChatQueueInline"; // V50.z301 — bozze in coda visibili dentro la chat
import { ChoiceButtons, extractChoices } from "@/src/axon-choice-buttons"; // V50.z304 — pulsanti A)/B) e azioni «ORA»
import { consumePendingPrompt, consumePendingVoice, AXON_OPEN_CHAT_EVENT } from "@/src/axonProactive";
import { matchLocalCommand, playActivationEffect, startFindPhone, stopFindPhone } from "@/src/activation/events"; // V50.z318
import { ActivationOverlay } from "@/src/activation/ActivationOverlay"; // V50.z318 — mirror dentro il Modal chat // V50.z196 — Blocco 9 apertura chat proattiva
import { syncAlarmNotifs } from "@/src/alarmNotifs";
import { notify } from "@/src/utils/notify";
import { conversationToText, copyText, shareText, exportConversationPdf } from "@/src/utils/chatExport";
import { useDraft } from "@/src/utils/appStatePersist"; // V50.z242 — BUG-STATE-001
// V50.z311 — moduli estratti dal refactor: FAB (src/AssistantFAB.tsx), bolle/pannello voce, stili, tipi, player audio
import { playAudioBase64 } from "@/src/utils/audioPlayback";
import { styles, ASSISTANT_COLOR, ASSISTANT_COLOR_DARK } from "@/src/assistant/chatStyles";
import { CT } from "@/src/assistant/chatTheme"; // V50.z337 — chat dark/premium
import { ConversationPanel, MessageBubble, TypingDots } from "@/src/assistant/ChatBubbles";
import type { ChatMsg } from "@/src/assistant/chatTypes";

// V29.l — Logo AxonOS orizzontale trasparente per l'empty state chat (senza card scura, compatto).
const AXONOS_LOGO_HORIZONTAL = require("@/assets/images/axonos-logo-light.png"); // V50.z228 — nuovo logo (sfondo chiaro)
const AXONOS_LOGO_HORIZONTAL_ASPECT = 825 / 302;


type ResponseMode = "text" | "voice" | "both";


type AssistantChatProps = {
  visible: boolean;
  onClose: () => void;
};

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const res = fr.result as string;
      const i = res.indexOf(",");
      resolve(i >= 0 ? res.slice(i + 1) : res);
    };
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

const MODE_ORDER: ResponseMode[] = ["text", "voice", "both"];
const MODE_LABEL: Record<ResponseMode, string> = {
  text: "Solo testo",
  voice: "Solo voce",
  both: "Voce e testo",
};
const MODE_ICON: Record<ResponseMode, keyof typeof Ionicons.glyphMap> = {
  text: "chatbox-ellipses",
  voice: "volume-high",
  both: "megaphone",
};


export function AssistantChatModal({ visible, onClose }: AssistantChatProps) {
  const { user } = useAuth();
  const router = useRouter();
  // V50.z291 — posizione attuale dell'utente (route + parametri) inviata a ogni messaggio: Axon sa esattamente dove si trova
  const pathname = usePathname();
  const globalParams = useGlobalSearchParams<Record<string, string>>();
  const clientContextRef = useRef<{ route: string; params?: Record<string, string> } | undefined>(undefined);
  useEffect(() => {
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(globalParams || {})) if (typeof v === "string" && v) params[k] = v.slice(0, 80);
    clientContextRef.current = pathname ? { route: pathname, params: Object.keys(params).length ? params : undefined } : undefined;
  }, [pathname, globalParams]);
  const insets = useInsetsSafe(); // V50.z165 — fallback bottom dentro Modal // V29.ao — safe area insets per non finire sotto la gesture bar
  // V28.y — Only the Master can save rules/URLs to Insegna ad Axon
  const isMaster = !user?.parent_user_id && (user?.role || "member") === "owner";
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  // V50.z39 — Fix ricorrente: TextInput coperto dalla tastiera Android nel Modal.
  // KeyboardAvoidingView non funziona correttamente dentro Modal transparent
  // su Android: aggiungiamo un listener manuale che spinge il footer sopra
  // la tastiera con paddingBottom dinamico.
  const [kbHeight, setKbHeight] = useState(0);
  useEffect(() => {
    const showEv = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEv = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const s = Keyboard.addListener(showEv, (e) => setKbHeight(e.endCoordinates?.height || 0));
    const h = Keyboard.addListener(hideEv, () => setKbHeight(0));
    return () => { s.remove(); h.remove(); };
  }, []);
  // V50.z11 — bottomPad rimosso: il paddingBottom del sheet ora usa solo
  // insets.bottom (il KeyboardAvoidingView spinge autonomamente sopra la tastiera).
  const [assistantName, setAssistantName] = useState("Neo");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  // V50.z242 — BUG-STATE-001: bozza del messaggio salvata (debounce 600 ms) e ripristinata al rientro/riavvio
  useDraft("draft_axon_chat_v1", input, setInput);
  // V28.l — Allegati caricati dall'utente per la prossima /assistant/chat
  const [pendingAttachments, setPendingAttachments] = useState<{ name: string; mime: string; data_base64: string }[]>([]);
  const [attaching, setAttaching] = useState(false);
  // V50.z85 — Scanner jscanify (WebView cross-platform)
  const [scannerOpen, setScannerOpen] = useState(false);
  const [sending, setSending] = useState(false);
  // V50.z301 — guardia sincrona anti-doppio invio: `sending` (state) nella closure di sendRef può essere stantio
  // quando processQueue chiama send() subito dopo la fine dello stream → la bozza veniva scartata in silenzio.
  const sendingRef = useRef(false);
  // V29.n — Riferimento all'AbortController della chiamata in corso, per il pulsante "Stop".
  const abortRef = useRef<AbortController | null>(null);
  const [loadingHist, setLoadingHist] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  // V50.z126 — Testo di stato del preflight streaming ("Sto raccogliendo il contesto…")
  const [progressText, setProgressText] = useState<string | null>(null);
  const prog = useAxonProgress(); // V50.z194 — bolla intermedia contestuale dopo 3 s senza risposta
  const [recDuration, setRecDuration] = useState(0);
  const [responseMode, setResponseMode] = useState<ResponseMode>("text");
  // V28.o — Quick actions personalizzabili (mostrate nell'empty state della chat).
  // `null` = non ancora caricate; array vuoto = utente ha esplicitamente rimosso tutte le azioni.
  const [quickActions, setQuickActions] = useState<{ id: string; label: string; prompt: string }[] | null>(null);  const [assistantVoice, setAssistantVoice] = useState<string>("nova");
  const [playingIdx, setPlayingIdx] = useState<number | null>(null);
  const [showModeMenu, setShowModeMenu] = useState(false);
  // V50.z160 — Menu ⋯ "Altro": condividi / PDF / copia intera conversazione
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  // V50.z223 — coda messaggi (input sempre attivo) + tab chat parallele (sessioni)
  const [showQueue, setShowQueue] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [queueDone, setQueueDone] = useState<QueueItem[]>([]);
  const [queueFailed, setQueueFailed] = useState<QueueItem[]>([]); // V50.z225 — bozze fallite (Riprova)
  const queueBusyRef = useRef(false);
  // V38T — Save-to-master modal state (opens with default filename)
  const [saveTarget, setSaveTarget] = useState<{ content: string; defaultName: string } | null>(null);
  const [paused, setPaused] = useState(false);
  // ---- Continuous conversation mode ----
  const [convMode, setConvMode] = useState(false); // true = session active
  const [convPhase, setConvPhase] = useState<
    "idle" | "listening" | "transcribing" | "thinking" | "speaking"
  >("idle");
  const [convMuted, setConvMuted] = useState(false);
  const convModeRef = useRef(false);
  const convMutedRef = useRef(false);
  const convStreamRef = useRef<MediaStream | null>(null);
  const convRecorderRef = useRef<MediaRecorder | null>(null);
  const convChunksRef = useRef<Blob[]>([]);
  const convMimeRef = useRef<string>("");
  const convAudioCtxRef = useRef<AudioContext | null>(null);
  const convAnalyserRef = useRef<AnalyserNode | null>(null);
  const convRafRef = useRef<number | null>(null);
  const convSpeechDetectedRef = useRef(false);
  const convLastVoiceMsRef = useRef<number>(0);
  const convCycleStartRef = useRef<number>(0);
  const scrollRef = useRef<ScrollView | null>(null);
  const mrRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<any>(null);
  const durRef = useRef(0);
  const cleanupAudioRef = useRef<(() => void) | null>(null);
  // V50.z186 — SentenceSpeaker corrente (pausa/riprendi dal barge-in nativo)
  const speakerRef = useRef<SentenceSpeaker | null>(null);
  // V38T — Reference to current HTMLAudioElement for pause/resume
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  // V28.v — Drag-and-drop desktop: ref al contenitore + state per evidenziare la drop zone
  const sheetContainerRef = useRef<View | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  // V28.w — Google Drive picker modal
  const [drivePickerOpen, setDrivePickerOpen] = useState(false);
  const [dropboxPickerOpen, setDropboxPickerOpen] = useState(false);

  const loadHistory = useCallback(async () => {
    setLoadingHist(true);
    try {
      // V50.y — Al riavvio della chat, RIPRISTINA l'ultima sessione (persistenza).
      // "Chiudi" NON resetta più: la conversazione precedente rimane disponibile.
      // Solo "Nuova chat" (resetSession) svuota la conversazione.
      const us = await api<{ assistant_name?: string; assistant_response_mode?: string; assistant_voice?: string; assistant_quick_actions?: { id: string; label: string; prompt: string }[] }>("/user-settings").catch(() => ({} as any));
      setAssistantName(us?.assistant_name || "Neo");
      const m = (us?.assistant_response_mode || "text") as ResponseMode;
      setResponseMode(MODE_ORDER.includes(m) ? m : "text");
      if (us?.assistant_voice) setAssistantVoice(us.assistant_voice);
      if (Array.isArray(us?.assistant_quick_actions)) {
        setQuickActions(us.assistant_quick_actions);
      }
      // Carica la conversazione precedente (se esiste)
      try {
        const h = await api<{ session_id?: string | null; messages?: { role: string; content: string }[] }>("/assistant/history");
        if (h?.session_id && Array.isArray(h.messages) && h.messages.length > 0) {
          setSessionId(h.session_id);
          setMessages(h.messages.map((m) => ({ role: m.role as any, content: m.content })));
        } else {
          setSessionId(null);
          setMessages([]);
        }
      } catch {
        setSessionId(null);
        setMessages([]);
      }
    } catch {
      // ignore
    } finally {
      setLoadingHist(false);
    }
  }, []);

  useEffect(() => {
    if (visible) {
      loadHistory();
      // V50.z196 — Blocco 9: prompt in attesa (tap su bubble/notifica proattiva o voce) → inviato appena la chat è aperta
      const pending = consumePendingPrompt();
      const pendingVoice = consumePendingVoice(); // V50.z315 — ViolaWake → risposta parlata
      if (pending) setTimeout(() => { void sendRef.current?.(pending, pendingVoice ? { forceSpeak: true } : undefined); }, 900);
      // V50.z17 — Al primo avvio dell'assistente AxonOS, apri l'HELP CENTER
      // (termini d'uso + richiesta cancellazione dati). Flag salvato su
      // AsyncStorage: `helpcenter_seen_v1`.
      (async () => {
        try {
          const seen = await AsyncStorage.getItem("helpcenter_seen_v1");
          if (!seen) {
            // Chiudi la chat e reindirizza al Help Center in modalità onboarding
            onClose();
            setTimeout(() => router.push("/help-center?onboarding=1" as any), 200);
          }
        } catch { /* ignore */ }
      })();
    } else {
      // stop any recording on close
      if (mrRef.current && mrRef.current.state !== "inactive") {
        try { mrRef.current.stop(); } catch {}
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      setRecording(false);
      // V29.ao — Ferma SEMPRE l'audio TTS in corso alla chiusura della chat,
      // indipendentemente dalla modalità conversation. In precedenza il cleanup
      // era eseguito solo se `convModeRef.current` era true → audio residuo.
      if (cleanupAudioRef.current) { try { cleanupAudioRef.current(); } catch {} cleanupAudioRef.current = null; }
      setPlayingIdx(null);
      void releaseVoiceAudioMode(); // V50.z186 — niente microfono in background dopo la chiusura
      // Also end continuous conversation (se attiva)
      if (convModeRef.current) {
        cleanupConversation();
        setConvMode(false);
        setConvMuted(false);
      }
    }
  }, [visible, loadHistory]);

  useEffect(() => {
    // Auto-scroll to bottom on new message
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(t);
  }, [messages.length, sending]);


  // V28.v — Helper condiviso: aggiunge un file (già letto come base64) alla lista
  // degli allegati pending. Ritorna true se OK, false se scartato (oversize / vuoto).
  const addPendingAttachment = useCallback((info: { name: string; mime: string; base64: string }) => {
    const { name, mime, base64 } = info;
    if (!base64) return false;
    if (base64.length > 14_000_000) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `⚠️ File "${name}" troppo grande (>10MB). Riducilo prima di allegarlo.`, created_at: new Date().toISOString() },
      ]);
      return false;
    }
    setPendingAttachments((arr) => [
      ...arr,
      { name, mime: mime || "application/octet-stream", data_base64: base64 },
    ]);
    return true;
  }, []);

  // V28.l — Attach a file (PDF, Excel, image, txt/csv, …) to the next message
  const attachFile = async () => {
    if (attaching || sending) return;
    setAttaching(true);
    try {
      const { asset, error, base64 } = await pickCommonFile({ multiple: false });
      if (error || !asset) { if (error) console.warn("attach err:", error); return; }
      let b64 = base64 || (asset as { _base64?: string })._base64 || "";
      if (!b64 && asset.uri) {
        try {
          if (asset.uri.startsWith("data:")) {
            const comma = asset.uri.indexOf(",");
            if (comma > 0) b64 = asset.uri.slice(comma + 1);
          } else if (Platform.OS === "web") {
            const resp = await fetch(asset.uri);
            const blob = await resp.blob();
            b64 = await new Promise<string>((res, rej) => {
              const r = new FileReader();
              r.onerror = () => rej(new Error("FileReader error"));
              r.onload = () => {
                const s = String(r.result || "");
                const c = s.indexOf(",");
                res(c >= 0 ? s.slice(c + 1) : s);
              };
              r.readAsDataURL(blob);
            });
          } else {
            b64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
          }
        } catch (e) {
          console.warn("read err:", e);
          return;
        }
      }
      if (!b64) return;
      addPendingAttachment({ name: asset.name, mime: asset.mimeType || "application/octet-stream", base64: b64 });
    } finally { setAttaching(false); }
  };

  // V50.z292 — Screenshot della schermata corrente con un tocco: il modal si nasconde un istante, cattura lo schermo
  // (react-native-view-shot captureScreen) e allega l'immagine con il nome della schermata (route) per segnalare problemi ad Axon.
  const [hideForShot, setHideForShot] = useState(false);
  const attachScreenshot = async () => {
    if (attaching || sending) return;
    if (Platform.OS === "web") { notify("Screenshot", "Su web usa lo screenshot del browser e allegalo con il pulsante Foto; sul telefono basta un tocco."); return; }
    setAttaching(true);
    setHideForShot(true);
    try {
      await new Promise((r) => setTimeout(r, 450)); // attende la chiusura animata del modal
      const { captureScreen } = await import("react-native-view-shot");
      const b64 = await captureScreen({ format: "jpg", quality: 0.75, result: "base64" });
      const route = (clientContextRef.current?.route || "schermata").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "schermata";
      addPendingAttachment({ name: `screenshot_${route}_${new Date().toTimeString().slice(0, 5).replace(":", "")}.jpg`, mime: "image/jpeg", base64: b64 });
      if (!input.trim()) setInput(`Ho un problema in questa schermata (${clientContextRef.current?.route || "app"}): `);
    } catch (e: any) {
      notify("Screenshot", e?.message || "Cattura non riuscita");
    } finally {
      setHideForShot(false);
      setAttaching(false);
    }
  };

  // V50.z85 — Cattura foto (camera o galleria) come attachment
  const attachPhoto = async (source: "camera" | "gallery") => {
    if (attaching || sending) return;
    setAttaching(true);
    try {
      const ImagePicker = await import("expo-image-picker");
      if (source === "camera") {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) { setAttaching(false); return; }
        const r = await ImagePicker.launchCameraAsync({ quality: 0.85, base64: true });
        if (r.canceled || !r.assets?.[0]) { setAttaching(false); return; }
        const a = r.assets[0];
        let b64 = a.base64 || "";
        if (!b64 && a.uri) {
          if (Platform.OS === "web") {
            const resp = await fetch(a.uri); const blob = await resp.blob();
            b64 = await new Promise<string>((res) => { const rd = new FileReader(); rd.onload = () => { const s = String(rd.result || ""); const c = s.indexOf(","); res(c >= 0 ? s.slice(c + 1) : s); }; rd.readAsDataURL(blob); });
          } else {
            b64 = await FileSystem.readAsStringAsync(a.uri, { encoding: FileSystem.EncodingType.Base64 });
          }
        }
        if (b64) addPendingAttachment({ name: a.fileName || `foto_${Date.now()}.jpg`, mime: a.mimeType || "image/jpeg", base64: b64 });
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) { setAttaching(false); return; }
        const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images" as any], quality: 0.85, base64: true });
        if (r.canceled || !r.assets?.[0]) { setAttaching(false); return; }
        const a = r.assets[0];
        let b64 = a.base64 || "";
        if (!b64 && a.uri) {
          if (Platform.OS === "web") {
            const resp = await fetch(a.uri); const blob = await resp.blob();
            b64 = await new Promise<string>((res) => { const rd = new FileReader(); rd.onload = () => { const s = String(rd.result || ""); const c = s.indexOf(","); res(c >= 0 ? s.slice(c + 1) : s); }; rd.readAsDataURL(blob); });
          } else {
            b64 = await FileSystem.readAsStringAsync(a.uri, { encoding: FileSystem.EncodingType.Base64 });
          }
        }
        if (b64) addPendingAttachment({ name: a.fileName || `img_${Date.now()}.jpg`, mime: a.mimeType || "image/jpeg", base64: b64 });
      }
    } catch (e) {
      console.warn("attachPhoto err:", e);
    } finally { setAttaching(false); }
  };

  // V50.z85 — Callback dal DocumentScanner (jscanify) → allega dataURL come immagine
  const onScannerResult = useCallback((f: { name: string; dataUrl: string; mime: string }) => {
    const comma = f.dataUrl.indexOf(",");
    const b64 = comma > 0 ? f.dataUrl.slice(comma + 1) : f.dataUrl;
    addPendingAttachment({ name: f.name, mime: f.mime || "image/png", base64: b64 });
  }, [addPendingAttachment]);

  // V28.v — Drag-and-drop desktop: legge un DOM File come base64 e lo aggiunge come attachment.
  // Chiamato dagli event handler drop attaccati direttamente al DOM (solo su web).
  const handleDroppedFile = useCallback(async (file: File): Promise<void> => {
    try {
      const b64 = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onerror = () => rej(new Error("FileReader error"));
        r.onload = () => {
          const s = String(r.result || "");
          const c = s.indexOf(",");
          res(c >= 0 ? s.slice(c + 1) : s);
        };
        r.readAsDataURL(file);
      });
      addPendingAttachment({ name: file.name || "file", mime: file.type || "application/octet-stream", base64: b64 });
    } catch (e) {
      console.warn("drop read err:", e);
    }
  }, [addPendingAttachment]);

  // V28.v — Drag-and-drop desktop: attach DOM listeners al contenitore quando la
  // modal è visibile e siamo su web. Non tocca il picker esistente né gli altri handler.
  useEffect(() => {
    if (Platform.OS !== "web" || !visible) return;
    const node: any = sheetContainerRef.current;
    if (!node) return;
    let dragCounter = 0;
    const onDragEnter = (e: DragEvent) => {
      // Consideriamo solo drag che portano file (ignora drag di testo/link interni)
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes("Files")) return;
      e.preventDefault();
      e.stopPropagation();
      dragCounter += 1;
      setIsDragging(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes("Files")) return;
      e.preventDefault();
      e.stopPropagation();
      try { e.dataTransfer.dropEffect = "copy"; } catch {}
    };
    const onDragLeave = (e: DragEvent) => {
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes("Files")) return;
      e.preventDefault();
      e.stopPropagation();
      dragCounter = Math.max(0, dragCounter - 1);
      if (dragCounter === 0) setIsDragging(false);
    };
    const onDrop = async (e: DragEvent) => {
      if (!e.dataTransfer) return;
      e.preventDefault();
      e.stopPropagation();
      dragCounter = 0;
      setIsDragging(false);
      const files: File[] = Array.from(e.dataTransfer.files || []);
      if (!files.length) return;
      for (const f of files) {
        // Filtro tipo: PDF, Excel, immagini, CSV, TXT — coerente con il picker esistente.
        const mime = (f.type || "").toLowerCase();
        const name = (f.name || "").toLowerCase();
        const isAllowed =
          mime.startsWith("image/") ||
          mime.includes("pdf") || name.endsWith(".pdf") ||
          mime.includes("spreadsheet") || mime.includes("excel") ||
          name.endsWith(".xlsx") || name.endsWith(".xls") ||
          mime.includes("csv") || name.endsWith(".csv") ||
          mime.startsWith("text/") || name.endsWith(".txt");
        if (!isAllowed) {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: `⚠️ Formato non supportato per "${f.name}". Allega PDF, Excel, immagini o testo.`, created_at: new Date().toISOString() },
          ]);
          continue;
        }
        await handleDroppedFile(f);
      }
    };
    node.addEventListener("dragenter", onDragEnter);
    node.addEventListener("dragover", onDragOver);
    node.addEventListener("dragleave", onDragLeave);
    node.addEventListener("drop", onDrop);
    return () => {
      node.removeEventListener("dragenter", onDragEnter);
      node.removeEventListener("dragover", onDragOver);
      node.removeEventListener("dragleave", onDragLeave);
      node.removeEventListener("drop", onDrop);
    };
  }, [visible, handleDroppedFile]);

  // V41 — Feedback thumbs 👍/👎 state + handler.
  // On 👎 opens a modal with a quick reason chooser + optional free-text comment.
  const [feedbackDown, setFeedbackDown] = useState<{ msgIndex: number; message_id: string } | null>(null);
  const [feedbackReason, setFeedbackReason] = useState<string>("");
  const [feedbackComment, setFeedbackComment] = useState<string>("");
  const [feedbackSaving, setFeedbackSaving] = useState(false);

  const applyFeedbackLocally = useCallback(
    (idx: number, rating: "up" | "down" | null) => {
      setMessages((prev) => {
        if (idx < 0 || idx >= prev.length) return prev;
        const next = [...prev];
        next[idx] = { ...next[idx], feedback_rating: rating };
        return next;
      });
    },
    []
  );

  const handleFeedback = useCallback(
    async (idx: number, rating: "up" | "down") => {
      const m = messages[idx];
      if (!m || !m.message_id) return;
      // Toggle off if same rating already set (silent local update; server-side we still POST — idempotent)
      const wasSameRating = m.feedback_rating === rating;
      if (rating === "up") {
        // Optimistic UI
        applyFeedbackLocally(idx, wasSameRating ? null : "up");
        if (wasSameRating) return; // don't spam server on toggle-off
        try {
          await api("/assistant/feedback", {
            method: "POST",
            body: { message_id: m.message_id, rating: "up" },
          });
        } catch {
          applyFeedbackLocally(idx, null); // revert
        }
        return;
      }
      // rating === "down" → open modal to collect reason + comment
      setFeedbackReason("");
      setFeedbackComment("");
      setFeedbackDown({ msgIndex: idx, message_id: m.message_id });
    },
    [messages, applyFeedbackLocally]
  );

  const submitDownFeedback = useCallback(async () => {
    if (!feedbackDown) return;
    setFeedbackSaving(true);
    try {
      await api("/assistant/feedback", {
        method: "POST",
        body: {
          message_id: feedbackDown.message_id,
          rating: "down",
          reason: feedbackReason || undefined,
          comment: feedbackComment || undefined,
        },
      });
      applyFeedbackLocally(feedbackDown.msgIndex, "down");
      setFeedbackDown(null);
    } catch { /* keep modal open on error */ }
    finally {
      setFeedbackSaving(false);
    }
  }, [feedbackDown, feedbackReason, feedbackComment, applyFeedbackLocally]);

  // V50.z207 — Pulsanti Sì/No/Forse: la risposta parte da sola + toast «Risposta registrata ✓» per 1,8 s
  const [quickReplyToast, setQuickReplyToast] = useState(false);
  const [inputFocused, setInputFocused] = useState(false); // V50.z337 — bordo blu elettrico al focus
  const onQuickReply = (t: string) => {
    setQuickReplyToast(true);
    setTimeout(() => setQuickReplyToast(false), QUICK_REPLY_TOAST_MS);
    void send(t);
  };


  const send = async (text?: string, opts?: { forceSpeak?: boolean; onSpoken?: () => void; quickLabel?: string }) => {
    const msg = (text ?? input).trim();
    // V28.l — Consenti l'invio se c'è ALMENO un allegato, anche senza testo
    if ((!msg && pendingAttachments.length === 0) || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setInput("");
    // Optimistic add — include attachment names in the shown message
    const attSummary = pendingAttachments.length
      ? `\n\n📎 ${pendingAttachments.map((a) => a.name).join(", ")}`
      : "";
    const displayMsg = (msg || "(analizza gli allegati)") + attSummary;
    const optimistic: ChatMsg = {
      role: "user",
      content: displayMsg,
      created_at: new Date().toISOString(),
      quick_label: opts?.quickLabel,
    };
    setMessages((prev) => [...prev, optimistic]);
    const attachmentsPayload = pendingAttachments;
    setPendingAttachments([]);

    // V50.z318 — Comandi LOCALI del telefono (nessun LLM): «{nome}, fai l'effetto» · «dove sei» / «trova il mio telefono» · «stop»
    const stripName = (s: string) => (s.toLowerCase().startsWith(assistantName.toLowerCase()) ? s.slice(assistantName.length).replace(/^[,!\s]+/, "") : s);
    const local = !attachmentsPayload.length ? matchLocalCommand(stripName(msg)) : null;
    if (local) {
      const reply =
        local === "effect" ? (playActivationEffect({ name: assistantName, voice: assistantVoice, greet: true }), `✨ Ecco l'effetto di attivazione.`) :
        local === "find_phone" ? (startFindPhone(assistantName), `📍 Sono qui! Vibro e suono finché non tocchi lo schermo o dici «stop».`) :
        (stopFindPhone(), "OK!");
      setMessages((prev) => [...prev, { role: "assistant", content: reply, created_at: new Date().toISOString() }]);
      sendingRef.current = false;
      setSending(false);
      return;
    }

    // V29.ag — Azioni rapide: usa endpoint server-side con cache + auto-refresh.
    // V50.z126 — Solo lookup cache (istantaneo). Su miss NON attendiamo la POST
    // bloccante (60s+ senza output, oltre il timeout ingress): si passa allo
    // streaming SSE sotto con `quick_label`, che mostra i token man mano e
    // salva la risposta finale nella stessa cache.
    if (opts?.quickLabel && !attachmentsPayload.length) {
      try {
        const qa = await api<{ reply: string | null; updated_at: string | null; from_cache: boolean; cache_age_days?: number; miss?: boolean }>(
          "/axon/quick-action",
          {
            method: "POST",
            body: { label: opts.quickLabel, prompt: msg, cache_only: true },
          }
        );
        if (qa && qa.reply) {
          const cachedReply: string = qa.reply;
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant" as const,
              content: cachedReply,
              created_at: new Date().toISOString(),
              qa_updated_at: qa.updated_at || undefined,
              qa_from_cache: !!qa.from_cache,
            },
          ]);
          const shouldSpeak = opts?.forceSpeak || responseMode === "voice" || responseMode === "both";
          if (shouldSpeak) {
            void speakReply(qa.reply, undefined, opts?.onSpoken);
          } else if (opts?.onSpoken) {
            opts.onSpoken();
          }
          sendingRef.current = false;
          setSending(false);
          return;
        }
      } catch { /* fall through al chat normale */ }
    }

    // V29.n — Nuovo AbortController per questa chiamata (Stop button lo aborta).
    const controller = new AbortController();
    abortRef.current = controller;
    // V50.z121 — Watchdog: se il backend non invia nulla per 90s (timeout ingress,
    // ricerca web bloccata, ecc.) interrompiamo e mostriamo un errore visibile.
    let watchdogFired = false;
    let watchdog: ReturnType<typeof setTimeout> | null = setTimeout(() => { watchdogFired = true; controller.abort(); }, 90000);
    const armWatchdog = () => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => { watchdogFired = true; controller.abort(); }, 90000);
    };
    // V50.z112 — Voce in streaming: le frasi vengono sintetizzate e riprodotte
    // man mano che arrivano i delta (prima frase entro pochi secondi), senza
    // attendere la fine della risposta. Testo e voce procedono in parallelo.
    const wantSpeech = !!(opts?.forceSpeak || responseMode === "voice" || responseMode === "both");
    let speaker: SentenceSpeaker | null = null;
    if (wantSpeech) {
      if (cleanupAudioRef.current) { cleanupAudioRef.current(); cleanupAudioRef.current = null; }
      speaker = new SentenceSpeaker(assistantVoice, {
        onStart: () => { setPlayingIdx(-1); setPaused(false); },
        onAudioElement: (el) => { currentAudioRef.current = el; },
        onEnd: () => {
          currentAudioRef.current = null;
          speakerRef.current = null;
          setPlayingIdx((v) => (v === -1 ? null : v));
          setPaused(false);
          cleanupAudioRef.current = null;
          if (opts?.onSpoken) opts.onSpoken();
        },
      });
      const sp = speaker;
      speakerRef.current = sp;
      cleanupAudioRef.current = () => sp.stop();
    }
    try {
      // V50.z142 — Feedback immediato locale: mostra subito "Sto ragionando…" nella bolla
      // di typing; il server invia lo stesso ack come primo evento SSE (stage "ack").
      setProgressText("Sto ragionando…");
      prog.start({ message: msg, attachmentNames: attachmentsPayload.map((a) => a.name) });
      // V40 — Streaming path via SSE. Append delta chunks to the last message
      // in real time. Falls back to a regular POST if streaming fails.
      const streamResult = await streamAssistantChat({
        message: msg || "Analizza gli allegati.",
        session_id: sessionId || undefined,
        attachments: attachmentsPayload,
        quick_label: opts?.quickLabel && !attachmentsPayload.length ? opts.quickLabel : undefined,
        client_context: { ...(clientContextRef.current || { route: "" }), voice: wantSpeech || undefined }, // V50.z291 — dove si trova l'utente · V50.z305 voice=true → risposta breve parlata
        signal: controller.signal,
        onProgress: (p) => {
          // V50.z126 — Stato del preflight visibile ("Sto raccogliendo il contesto…")
          armWatchdog();
          if (p?.text) setProgressText(p.text);
          prog.onServer(p || {});
        },
        onMeta: (meta) => {
          setProgressText(null);
          if (meta.session_id) setSessionId(meta.session_id);
          if (meta.assistant_name) setAssistantName(meta.assistant_name);
          // Insert an empty assistant bubble that will be filled by deltas
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant" as const,
              content: "",
              created_at: new Date().toISOString(),
              streaming: true,
              from_cache: !!meta.from_cache,
              message_id: meta.message_id,
            },
          ]);
        },
        onDelta: (chunk) => {
          armWatchdog();
          prog.onFirstDelta();
          speaker?.feed(chunk);
          setMessages((prev) => {
            if (!prev.length) return prev;
            const last = prev[prev.length - 1];
            if (last.role !== "assistant" || !last.streaming) return prev;
            const next = prev.slice(0, -1);
            next.push({ ...last, content: (last.content || "") + chunk });
            return next;
          });
        },
        onDone: (done) => {
          // V50.z125 — Comando timer/sveglia/promemoria: schedula la notifica locale
          if (done.alarm) { void syncAlarmNotifs(done.alarm).catch(() => {}); }
          setMessages((prev) => {
            if (!prev.length) return prev;
            const last = prev[prev.length - 1];
            if (last.role !== "assistant") return prev;
            const next = prev.slice(0, -1);
            next.push({
              ...last,
              streaming: false,
              used_web_search: !!done.used_web_search,
              web_sources: done.web_sources || [],
              from_cache: !!done.from_cache,
              message_id: done.message_id || last.message_id,
              qa_updated_at: done.qa_updated_at || last.qa_updated_at,
              qa_from_cache: done.qa_updated_at ? false : last.qa_from_cache,
            });
            return next;
          });
        },
      });

      // V50.z112 — Voce: chiudi la coda (residuo + eventuale fallback se lo
      // stream non ha prodotto delta, es. risposta non-stream). onSpoken viene
      // chiamato dal SentenceSpeaker alla fine dell'ultimo audio.
      const finalReply = streamResult.reply;
      if (speaker) {
        if (finalReply) speaker.finishWith(finalReply);
        else speaker.stop();
      } else if (opts?.onSpoken) {
        opts.onSpoken();
      }
    } catch (e: any) {
      // V50.z112 — Interrompi anche la voce in streaming
      if (speaker) { speaker.stop(); speaker = null; }
      if (watchdogFired) {
        // V50.z121 — Timeout: messaggio chiaro nella chat invece di schermata vuota
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          const errTxt = "⏱️ Axon non ha risposto entro 90 secondi. Il server potrebbe essere lento o non raggiungibile: riprova tra qualche istante.";
          if (last && last.role === "assistant" && last.streaming) return [...prev.slice(0, -1), { ...last, content: last.content || errTxt, streaming: false }];
          return [...prev, { role: "assistant", content: errTxt }];
        });
        notify("Timeout", "Nessuna risposta dal server entro 90 secondi.");
        return;
      }
      // V40 — Remove any partially-streamed empty bubble
      setMessages((prev) => {
        if (!prev.length) return prev;
        const last = prev[prev.length - 1];
        if (last.role === "assistant" && last.streaming && !last.content) {
          return prev.slice(0, -1);
        }
        return prev;
      });
      // V29.n — Silenzia l'errore quando l'utente ha premuto "Stop" (AbortError)
      if (e?.name === "AbortError" || /abort/i.test(String(e?.message || ""))) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "⏹️ Risposta interrotta dall'utente.", created_at: new Date().toISOString() },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `⚠️ Errore: ${e?.message || "Impossibile contattare l'assistente"}`, created_at: new Date().toISOString() },
        ]);
      }
      if (opts?.onSpoken && !wantSpeech) opts.onSpoken();
    } finally {
      if (watchdog) clearTimeout(watchdog);
      abortRef.current = null;
      setProgressText(null);
      prog.stop();
      sendingRef.current = false;
      setSending(false);
      // V50.z245 — BUG «bottoni assenti»: se lo stream si chiude senza evento `done` (proxy, rete, stop, errore)
      // la bolla restava `streaming: true` per sempre → niente Copia/Condividi/PDF. Ora viene sempre finalizzata.
      setMessages((prev) => (prev.some((m) => m.streaming) ? prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)) : prev));
    }
  };
  // V50.z196 — ref stabile a send() per il prompt proattivo in attesa (evita chiusure stantie nell'effect di apertura)
  const sendRef = useRef(send);
  useEffect(() => { sendRef.current = send; });

  // V50.z315 — ViolaWake / bubble: se la chat è GIÀ aperta quando arriva un prompt, lo inviamo subito
  // (l'effetto su `visible` scatta solo all'apertura).
  useEffect(() => {
    if (!visible) return;
    const sub = DeviceEventEmitter.addListener(AXON_OPEN_CHAT_EVENT, () => {
      const p = consumePendingPrompt();
      const v = consumePendingVoice();
      if (p) void sendRef.current?.(p, v ? { forceSpeak: true } : undefined);
    });
    return () => sub.remove();
  }, [visible]);

  // V50.z223 — CODA: refresh, enqueue, elaborazione sequenziale (URGENT > HIGH > NORMAL, poi FIFO), toast «Bozza elaborata»
  const refreshQueue = useCallback(async () => {
    try { const q = await api<{ items: QueueItem[]; recent_done: QueueItem[]; failed?: QueueItem[] }>("/chat/queue?include_done=true"); setQueue(q.items || []); setQueueDone(q.recent_done || []); setQueueFailed(q.failed || []); } catch {}
  }, []);
  const enqueue = async (content: string, priority: "URGENT" | "HIGH" | "NORMAL" = "NORMAL") => {
    try {
      const r = await api<{ draft_id: string; position_in_queue: number; estimated_time: string }>("/chat/messages", { method: "POST", body: { content, priority, session_id: sessionId || undefined } });
      notify("⏳ In coda", `${r.position_in_queue}° in coda · parte tra ~${r.estimated_time}. Puoi continuare a scrivere.`);
      await refreshQueue();
    } catch (e: any) {
      // V50.z301 — mai perdere il testo: se la coda non risponde, il messaggio torna nell'input
      setInput((cur) => (cur.trim() ? cur : content));
      notify("Non in coda", String(e?.message || e));
    }
  };
  const processQueue = useCallback(async () => {
    if (queueBusyRef.current) return;
    queueBusyRef.current = true;
    try {
      // una bozza alla volta, finché la coda non è vuota
      for (let guard = 0; guard < 20; guard++) {
        const r = await api<{ item: QueueItem | null; reason?: string }>("/chat/queue/next", { method: "POST" });
        if (!r.item) break;
        await refreshQueue();
        try {
          await sendRef.current(r.item.content);
          await api(`/chat/queue/${r.item.draft_id}`, { method: "PATCH", body: { status: "done" } });
          notify("✅ Bozza elaborata", r.item.content.slice(0, 60));
        } catch (e: any) {
          await api(`/chat/queue/${r.item.draft_id}`, { method: "PATCH", body: { status: "failed", error: String(e?.message || e) } }).catch(() => {});
        }
        await refreshQueue();
      }
    } finally { queueBusyRef.current = false; }
  }, [refreshQueue]);
  // quando Axon finisce una risposta → parte la prossima bozza in coda
  useEffect(() => { if (!sending && queue.some((q) => q.status === "pending")) void processQueue(); }, [sending, queue, processQueue]);
  useEffect(() => { void refreshQueue(); }, [refreshQueue]);
  const sendNow = async (it: QueueItem) => {
    // «Invia ora»: priorità URGENT → è la prossima a partire (se Axon è libero parte subito)
    await api(`/chat/queue/${it.draft_id}`, { method: "PATCH", body: { priority: "URGENT" } }).catch(() => {});
    await refreshQueue();
    if (!sending) void processQueue();
  };

  // V29.n — Interrompe immediatamente la risposta in corso.
  const stopGeneration = () => {
    try { abortRef.current?.abort(); } catch { /* ignore */ }
  };

  // V50.z259 — Navigatore: deep link dai messaggi di Axon → chiude la chat e apre la schermata
  const navigateTo = (route: string) => {
    stopGeneration();
    api("/axon/nav/track", { method: "POST", body: { feature: `nav:${route.split("?")[0]}` } }).catch(() => {});
    onClose();
    setTimeout(() => router.push(route as any), 150);
  };
  // V50.z259 — Azione confermabile [[ACTION]] (es. sposta appuntamenti mancati) → risposta appesa in chat
  const runNavAction = async (action: string, payload: Record<string, any>) => {
    try {
      const r = await api<{ reply: string }>("/axon/nav/action", { method: "POST", body: { action, payload, session_id: sessionId || undefined } });
      setMessages((prev) => [...prev, { role: "assistant", content: r.reply, created_at: new Date().toISOString() }]);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    } catch (e: any) {
      setMessages((prev) => [...prev, { role: "assistant", content: `⚠️ Non sono riuscito a completare l'azione: ${e?.message || "errore"}`, created_at: new Date().toISOString() }]);
    }
  };

  // V50.z305 — VOCE BREVE: a voce non si leggono tabelle/markdown lunghi: si parlano solo le frasi, la tabella resta in chat.
  const speakableText = (raw: string): string => {
    const lines = (raw || "").replace(/\[\[(NAV|ACTION):[^\]]*\]\]/g, "").split("\n");
    const hadTable = lines.some((l) => /^\s*\|.*\|\s*$/.test(l));
    const kept = lines.filter((l) => !/^\s*\|.*\|\s*$/.test(l) && !/^\s*[-:| ]+$/.test(l)).map((l) => l.replace(/[*_#`>]+/g, "").trim()).filter(Boolean);
    let out = kept.join(" ").replace(/\s+/g, " ").trim();
    if (out.length > 700) out = out.slice(0, 700).replace(/[^.!?]*$/, "").trim() || out.slice(0, 700);
    if (hadTable) out = (out ? out + " " : "") + "La tabella completa è in chat.";
    return out || raw;
  };
  const speakReply = async (text: string, forceIdx?: number, onEnded?: () => void) => {
    text = speakableText(text);
    try {
      // Stop any previous playback
      if (cleanupAudioRef.current) { cleanupAudioRef.current(); cleanupAudioRef.current = null; }
      const targetIdx = typeof forceIdx === "number" ? forceIdx : -1;
      setPlayingIdx(targetIdx);
      setPaused(false);
      const r = await api<{ audio_base64: string; mime: string }>("/assistant/tts", {
        method: "POST",
        body: { text, voice: assistantVoice },
      });
      if (!r?.audio_base64) { setPlayingIdx(null); if (onEnded) onEnded(); return; }
      let ended = false;
      // V38T — Keep audio element accessible for pause/resume
      if (Platform.OS === "web") {
        const audio = new Audio(`data:${r.mime || "audio/mpeg"};base64,${r.audio_base64}`);
        currentAudioRef.current = audio;
        audio.addEventListener("ended", () => {
          if (ended) return;
          ended = true;
          currentAudioRef.current = null;
          setPlayingIdx(null); setPaused(false);
          if (onEnded) onEnded();
        }, { once: true });
        try { await audio.play(); } catch {}
        cleanupAudioRef.current = () => {
          try { audio.pause(); } catch {}
          currentAudioRef.current = null;
          setPlayingIdx(null); setPaused(false);
          if (!ended) { ended = true; if (onEnded) onEnded(); }
        };
      } else {
        const cleanup = await playAudioBase64(r.audio_base64, r.mime || "audio/mpeg", () => {
          if (ended) return;
          ended = true;
          setPlayingIdx(null); setPaused(false);
          if (onEnded) onEnded();
        });
        cleanupAudioRef.current = () => {
          cleanup();
          setPlayingIdx(null); setPaused(false);
          if (!ended) { ended = true; if (onEnded) onEnded(); }
        };
      }
      // Fallback timer in case 'ended' event never fires
      const dur = Math.max(2000, Math.min(60000, text.length * 55));
      setTimeout(() => {
        if (ended) return;
        ended = true;
        setPlayingIdx((v) => (v === targetIdx ? null : v));
        setPaused(false);
        if (onEnded) onEnded();
      }, dur + 500);
    } catch {
      setPlayingIdx(null); setPaused(false);
      if (onEnded) onEnded();
    }
  };

  // V38T — Pause / resume Neo's voice (visible pause button + "Neo pausa" voice command)
  const togglePause = () => {
    const audio = currentAudioRef.current;
    if (!audio) { return; }
    if (audio.paused) { try { audio.play(); } catch {} setPaused(false); }
    else { try { audio.pause(); } catch {} setPaused(true); }
  };
  const stopPlayback = () => {
    if (cleanupAudioRef.current) { cleanupAudioRef.current(); cleanupAudioRef.current = null; }
    setPlayingIdx(null); setPaused(false);
  };

  // V50.z186 — Stop vocale su Android/iOS: mentre Axon parla il microfono resta in ascolto;
  // "stop/basta/fermati" → si ferma subito; una nuova domanda detta sopra la voce → la invia.
  useNativeBargeIn({
    active: Platform.OS !== "web" && visible && playingIdx !== null && !paused && !recording && !transcribing,
    onInterrupt: () => { if (speakerRef.current) speakerRef.current.pause(); else stopPlayback(); },
    onStop: () => stopPlayback(),
    onFalseAlarm: () => { speakerRef.current?.resume(); },
    onUtterance: (t) => { void send(t, { forceSpeak: true }); },
    speakingText: () => speakerRef.current?.speakingText || "",
  });

  // V38T — Save an assistant reply to Master files (opens confirm modal)
  const openSaveToMaster = (content: string) => {
    setSaveTarget({ content, defaultName: suggestFileName("Neo", "Ricerca energia") });
  };
  const confirmSaveToMaster = async (name: string) => {
    if (!saveTarget) return;
    try {
      await api("/assistant/save-to-master", {
        method: "POST",
        body: { content: saveTarget.content, name, session_id: sessionId, category: "notes" },
      });
      setSaveTarget(null);
      // Feedback via a temporary system-like bubble
      setMessages((prev) => [
        ...prev,
        { role: "assistant" as const, content: `💾 Risposta salvata come "${name}" nei tuoi file Master.`, created_at: new Date().toISOString() },
      ]);
    } catch (e: any) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant" as const, content: `⚠️ Salvataggio fallito: ${e?.message || ""}`, created_at: new Date().toISOString() },
      ]);
      setSaveTarget(null);
    }
  };

  // V38T — Barge-in detector: while Neo is speaking, monitor mic; if user
  // starts talking, pause TTS immediately (standard voice-assistant behavior).
  // Simple RMS-based VAD; no transcription needed for barge-in.
  const bargeRafRef = useRef<number | null>(null);
  const startBargeInDetector = () => {
    if (bargeRafRef.current != null) return;
    const analyser = convAnalyserRef.current;
    if (!analyser) return;
    const buffer = new Uint8Array(analyser.fftSize);
    let voiceStartMs = 0;
    const tick = () => {
      if (!currentAudioRef.current) { bargeRafRef.current = null; return; }
      analyser.getByteTimeDomainData(buffer);
      let sum = 0;
      for (let i = 0; i < buffer.length; i++) {
        const v = (buffer[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buffer.length);
      if (rms > 0.045) {
        if (!voiceStartMs) voiceStartMs = Date.now();
        // Sustained ~600ms → treat as "Neo pausa" / interruption
        if (Date.now() - voiceStartMs > 600) {
          stopPlayback();
          bargeRafRef.current = null;
          return;
        }
      } else {
        voiceStartMs = 0;
      }
      bargeRafRef.current = requestAnimationFrame(tick);
    };
    bargeRafRef.current = requestAnimationFrame(tick);
  };
  const stopBargeInDetector = () => {
    if (bargeRafRef.current != null) {
      try { cancelAnimationFrame(bargeRafRef.current); } catch {}
      bargeRafRef.current = null;
    }
  };
  // Fire barge-in detector whenever we enter speaking phase in conv mode
  useEffect(() => {
    if (convPhase === "speaking" && convModeRef.current && !convMutedRef.current) {
      startBargeInDetector();
    } else {
      stopBargeInDetector();
    }
    return () => stopBargeInDetector();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convPhase]);

  const cycleMode = async () => {
    const idx = MODE_ORDER.indexOf(responseMode);
    const next = MODE_ORDER[(idx + 1) % MODE_ORDER.length];
    // V29.ao — Al cambio modalità fermiamo IMMEDIATAMENTE la voce in corso
    // (evita che l'audio continui in background dopo aver switchato a "text").
    if (cleanupAudioRef.current) { try { cleanupAudioRef.current(); } catch {} cleanupAudioRef.current = null; }
    setPlayingIdx(null);
    setResponseMode(next);
    try {
      await api("/user-settings", { method: "PUT", body: { assistant_response_mode: next } });
    } catch {}
  };

  const setMode = async (m: ResponseMode) => {
    // V29.ao — Anche dal menù modalità: stop immediato dell'audio in playing.
    if (cleanupAudioRef.current) { try { cleanupAudioRef.current(); } catch {} cleanupAudioRef.current = null; }
    setPlayingIdx(null);
    setShowModeMenu(false);
    setResponseMode(m);
    try {
      await api("/user-settings", { method: "PUT", body: { assistant_response_mode: m } });
    } catch {}
  };

  const resetSession = async () => {
    try {
      const r = await api<{ session_id: string; assistant_name: string }>("/assistant/reset", { method: "POST" });
      setSessionId(r.session_id);
      setMessages([]);
      if (cleanupAudioRef.current) { cleanupAudioRef.current(); cleanupAudioRef.current = null; }
      setPlayingIdx(null);
    } catch {}
  };

  // ---- Continuous conversation mode (client-side VAD loop) ----
  // V28.u — Silence detection tuning: precedentemente SILENCE_MS=1500 (+ overhead
  // MediaRecorder.stop → onstop → onstop handler) portava a 3-4s percepiti prima
  // che il mic venisse effettivamente silenziato. Portato a 700ms con threshold RMS
  // leggermente più alto per resistere al rumore di fondo (che altrimenti manteneva
  // convLastVoiceMsRef in movimento e ritardava lo stop).
  const SILENCE_MS = 700; // silence needed after speech to trigger stop (<1s)
  const MAX_LISTEN_MS = 30000; // hard cap per cycle
  const MIN_SPEECH_MS = 200; // ignore blips shorter than this
  const RMS_THRESHOLD = 0.03; // voice activity threshold (alzato da 0.02 per fissità)
  const RMS_HYST_LOW = 0.018; // hysteresis: sotto questa soglia consideriamo silenzio (evita ping-pong)

  const cleanupConversation = () => {
    convModeRef.current = false;
    if (convRafRef.current != null) {
      try { cancelAnimationFrame(convRafRef.current); } catch {}
      convRafRef.current = null;
    }
    if (convRecorderRef.current && convRecorderRef.current.state !== "inactive") {
      try { convRecorderRef.current.stop(); } catch {}
    }
    convRecorderRef.current = null;
    convChunksRef.current = [];
    if (convStreamRef.current) {
      try { convStreamRef.current.getTracks().forEach((t) => t.stop()); } catch {}
      convStreamRef.current = null;
    }
    if (convAudioCtxRef.current) {
      try { convAudioCtxRef.current.close(); } catch {}
      convAudioCtxRef.current = null;
    }
    convAnalyserRef.current = null;
    setConvPhase("idle");
  };

  const startConversation = async () => {
    if (!voiceSupported || convMode) return;
    // V29.au — L'ascolto continuo usa MediaRecorder + AudioContext (VAD) che
    // sono API browser-only. Su native (APK Android/iOS) informiamo l'utente e
    // suggeriamo il pulsante mic singolo (che invece funziona nativamente).
    if (Platform.OS !== "web") {
      notify(
        "Ascolto continuo",
        "L'ascolto continuo è disponibile solo su Web/Preview. Su mobile usa il pulsante microfono per registrare una domanda alla volta."
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      convStreamRef.current = stream;
      // Setup AudioContext + Analyser for VAD (kept alive for whole session)
      const AC: any = (globalThis as any).AudioContext || (globalThis as any).webkitAudioContext;
      const audioCtx = new AC();
      convAudioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      convAnalyserRef.current = analyser;
      convModeRef.current = true;
      convMutedRef.current = false;
      setConvMuted(false);
      setConvMode(true);
      // Start listening cycle
      startListeningCycle();
    } catch (e) {
      // Permission denied or unsupported
      cleanupConversation();
      setConvMode(false);
    }
  };

  const endConversation = () => {
    // Stop any in-flight TTS playback too
    if (cleanupAudioRef.current) { try { cleanupAudioRef.current(); } catch {} cleanupAudioRef.current = null; }
    setPlayingIdx(null);
    cleanupConversation();
    setConvMode(false);
    setConvMuted(false);
    convMutedRef.current = false;
  };

  // V50.z203 — Stop MANUALE della registrazione: con rumore di fondo il rilevamento del silenzio può non scattare.
  // Ferma subito il recorder → onstop → trascrizione (stesso percorso del VAD).
  const stopListeningNow = () => {
    if (convRafRef.current != null) { cancelAnimationFrame(convRafRef.current); convRafRef.current = null; }
    const rec = convRecorderRef.current;
    if (rec && rec.state !== "inactive") {
      setConvPhase("transcribing");
      try { rec.stop(); } catch {}
    }
  };

  const toggleMute = () => {
    const next = !convMutedRef.current;
    convMutedRef.current = next;
    setConvMuted(next);
    if (next) {
      // stop current recorder + VAD loop, keep stream open
      if (convRafRef.current != null) { cancelAnimationFrame(convRafRef.current); convRafRef.current = null; }
      if (convRecorderRef.current && convRecorderRef.current.state !== "inactive") {
        try { convRecorderRef.current.stop(); } catch {}
      }
      setConvPhase("idle");
    } else {
      // resume listening
      if (convModeRef.current) startListeningCycle();
    }
  };

  const startListeningCycle = () => {
    if (!convModeRef.current || convMutedRef.current) return;
    const stream = convStreamRef.current;
    const analyser = convAnalyserRef.current;
    if (!stream || !analyser) return;
    // Fresh MediaRecorder per cycle
    let mimeType = "audio/webm;codecs=opus";
    const MR: any = (globalThis as any).MediaRecorder;
    if (MR?.isTypeSupported && !MR.isTypeSupported(mimeType)) {
      if (MR.isTypeSupported("audio/webm")) mimeType = "audio/webm";
      else if (MR.isTypeSupported("audio/mp4")) mimeType = "audio/mp4";
      else mimeType = "";
    }
    const rec = mimeType ? new MR(stream, { mimeType }) : new MR(stream);
    convRecorderRef.current = rec;
    convChunksRef.current = [];
    convMimeRef.current = mimeType || "audio/webm";
    convSpeechDetectedRef.current = false;
    convLastVoiceMsRef.current = 0;
    convCycleStartRef.current = Date.now();
    rec.ondataavailable = (ev: BlobEvent) => {
      if (ev.data && ev.data.size > 0) convChunksRef.current.push(ev.data);
    };
    rec.onstop = () => { void handleConvCycleStop(); };
    try { rec.start(); } catch { cleanupConversation(); setConvMode(false); return; }
    setConvPhase("listening");
    // VAD loop
    const buffer = new Uint8Array(analyser.fftSize);
    const tick = () => {
      if (!convModeRef.current || convMutedRef.current) return;
      const recNow = convRecorderRef.current;
      if (!recNow || recNow.state !== "recording") return;
      analyser.getByteTimeDomainData(buffer);
      // Compute RMS around 128 baseline
      let sum = 0;
      for (let i = 0; i < buffer.length; i++) {
        const v = (buffer[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buffer.length);
      const now = Date.now();
      const cycleElapsed = now - convCycleStartRef.current;
      // V28.u — Hysteresis a due soglie:
      //  - Prima di rilevare voce: serve RMS > RMS_THRESHOLD (0.03) per contare come "voce".
      //  - Una volta rilevata voce, se RMS scende sotto RMS_HYST_LOW (0.018) la consideriamo
      //    silenzio così il timer di silenzio parte subito. Se resta in mezzo (0.018→0.03)
      //    non aggiorniamo `convLastVoiceMsRef` — così un rumore di fondo lieve non ritarda lo stop.
      const isVoice = rms > RMS_THRESHOLD;
      const isSilent = rms < RMS_HYST_LOW;
      if (isVoice) {
        convLastVoiceMsRef.current = now;
        if (!convSpeechDetectedRef.current && cycleElapsed > MIN_SPEECH_MS) {
          convSpeechDetectedRef.current = true;
        }
      } else if (!isSilent && convSpeechDetectedRef.current) {
        // Zona grigia: non è voce chiara, ma nemmeno silenzio netto. Non facciamo nulla,
        // così il timer di silenzio continua ad avanzare da convLastVoiceMsRef.
      }
      // Stop conditions
      if (convSpeechDetectedRef.current && convLastVoiceMsRef.current > 0) {
        const silenceFor = now - convLastVoiceMsRef.current;
        if (silenceFor > SILENCE_MS) {
          try { recNow.stop(); } catch {}
          return;
        }
      }
      if (cycleElapsed > MAX_LISTEN_MS) {
        try { recNow.stop(); } catch {}
        return;
      }
      convRafRef.current = requestAnimationFrame(tick);
    };
    convRafRef.current = requestAnimationFrame(tick);
  };

  const handleConvCycleStop = async () => {
    if (convRafRef.current != null) { cancelAnimationFrame(convRafRef.current); convRafRef.current = null; }
    const parts = convChunksRef.current;
    convChunksRef.current = [];
    const hadSpeech = convSpeechDetectedRef.current;
    convSpeechDetectedRef.current = false;
    if (!convModeRef.current) return; // ended during processing
    // No speech detected → just restart listening
    if (!hadSpeech || !parts.length) {
      if (convModeRef.current && !convMutedRef.current) startListeningCycle();
      return;
    }
    setConvPhase("transcribing");
    try {
      const blob = new Blob(parts, { type: convMimeRef.current || parts[0].type || "audio/webm" });
      if (blob.size < 512) {
        if (convModeRef.current && !convMutedRef.current) startListeningCycle();
        return;
      }
      const b64 = await blobToBase64(blob);
      const r = await api<{ transcript: string }>("/ai/transcribe", {
        method: "POST",
        body: { audio_base64: b64, mime: blob.type || "audio/webm" },
      });
      const t = (r?.transcript || "").trim();
      if (!t) {
        if (convModeRef.current && !convMutedRef.current) startListeningCycle();
        return;
      }
      if (!convModeRef.current) return;
      setConvPhase("thinking");
      await send(t, {
        forceSpeak: true,
        onSpoken: () => {
          setConvPhase("idle");
          if (convModeRef.current && !convMutedRef.current) {
            // small delay so mic isn't picking up the tail of TTS
            setTimeout(() => {
              if (convModeRef.current && !convMutedRef.current) startListeningCycle();
            }, 300);
          }
        },
      });
      // The send() promise resolves after chat; TTS runs async. Update phase on TTS start.
      if (convModeRef.current) setConvPhase("speaking");
    } catch {
      if (convModeRef.current && !convMutedRef.current) startListeningCycle();
    }
  };

  // ---- Voice input (web MediaRecorder → /api/ai/transcribe) ----
  // V29.au — Su APK Android/iOS `Platform.OS !== "web"` → il vecchio check
  // era sempre `false` e i bottoni sparivano. Ora `voiceSupported = true`
  // ovunque; su native usiamo `expo-audio` (useAudioRecorder), su web
  // manteniamo MediaRecorder.
  // V50.u — Abilita metering per rilevare silenzio e stoppare automaticamente
  const nativeRecorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  // Polling metering ogni 250ms (state.metering in dB, range ~ -160..0)
  const nativeRecState = useAudioRecorderState(nativeRecorder, 250);
  const nativeUriRef = useRef<string | null>(null);
  // V50.u — Timer di silenzio: se il livello audio resta sotto -40 dB per 2s
  // consecutivi DOPO che almeno una volta è stato sopra soglia (utente ha
  // parlato), fermiamo automaticamente la registrazione.
  const lastVoiceRef = useRef<number | null>(null);
  const hasSpokenRef = useRef<boolean>(false);
  const VOICE_DB_THRESHOLD = -40;
  const SILENCE_TIMEOUT_MS = 2200;
  const voiceSupported =
    Platform.OS === "web"
      ? (typeof navigator !== "undefined" &&
         !!navigator.mediaDevices &&
         typeof (globalThis as any).MediaRecorder !== "undefined")
      : true; // native = sempre supportato via expo-audio

  // V50.u — Auto-stop su silenzio prolungato (solo native):
  // se dopo aver rilevato la voce (metering > -40 dB) restiamo sotto
  // soglia per SILENCE_TIMEOUT_MS, chiudiamo la registrazione.
  useEffect(() => {
    if (Platform.OS === "web") return;
    if (!recording) return;
    const m = typeof nativeRecState?.metering === "number" ? nativeRecState.metering : -160;
    const now = Date.now();
    if (m > VOICE_DB_THRESHOLD) {
      // Utente sta parlando
      hasSpokenRef.current = true;
      lastVoiceRef.current = now;
    } else if (hasSpokenRef.current && lastVoiceRef.current) {
      // Silenzio dopo aver parlato: check timeout
      if (now - lastVoiceRef.current >= SILENCE_TIMEOUT_MS && durRef.current >= 2) {
        // Auto-stop
        stopRec();
      }
    }
    // dep esplicite: reagiamo al cambio di metering
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nativeRecState?.metering, recording]);

  const startRec = async () => {
    if (!voiceSupported) return;
    // V29.au — Branch native: usa expo-audio. Il resto del branch è web con MediaRecorder.
    if (Platform.OS !== "web") {
      try {
        const perm = await AudioModule.requestRecordingPermissionsAsync();
        if (!perm.granted) { notify("Permesso negato", "Consenti l'accesso al microfono nelle impostazioni."); return; }
        await ensureVoiceAudioMode({ recording: true }); // V50.z186 — registrazione anche in background/schermo bloccato
        await nativeRecorder.prepareToRecordAsync();
        nativeRecorder.record();
        setRecording(true);
        durRef.current = 0;
        setRecDuration(0);
        // V50.u — Reset stato voice/silence detection
        lastVoiceRef.current = null;
        hasSpokenRef.current = false;
        timerRef.current = setInterval(() => {
          durRef.current += 1;
          setRecDuration(durRef.current);
          if (durRef.current >= 60) stopRec();
        }, 1000) as any;
      } catch (e: any) {
        notify("Errore microfono", e?.message || String(e));
      }
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      let mimeType = "audio/webm;codecs=opus";
      const MR: any = (globalThis as any).MediaRecorder;
      if (MR?.isTypeSupported && !MR.isTypeSupported(mimeType)) {
        if (MR.isTypeSupported("audio/webm")) mimeType = "audio/webm";
        else if (MR.isTypeSupported("audio/mp4")) mimeType = "audio/mp4";
        else mimeType = "";
      }
      const rec = mimeType ? new MR(stream, { mimeType }) : new MR(stream);
      mrRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (ev: BlobEvent) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      rec.onstop = () => { void handleStop(rec.mimeType); };
      rec.start();
      setRecording(true);
      durRef.current = 0;
      setRecDuration(0);
      timerRef.current = setInterval(() => {
        durRef.current += 1;
        setRecDuration(durRef.current);
        if (durRef.current >= 60) stopRec();
      }, 1000);
    } catch {
      // ignore permission errors
    }
  };

  const stopRec = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setRecording(false);
    // V29.au — Branch native: stop expo-audio + handle base64 upload
    if (Platform.OS !== "web") {
      (async () => {
        try {
          await nativeRecorder.stop();
          const uri = nativeRecorder.uri;
          if (!uri) return;
          nativeUriRef.current = uri;
          setTranscribing(true);
          const b64 = await FileSystem.readAsStringAsync(uri, { encoding: "base64" });
          if (!b64 || b64.length < 500) { setTranscribing(false); return; }
          const r = await api<{ transcript: string }>("/ai/transcribe", {
            method: "POST",
            body: { audio_base64: b64, mime: "audio/m4a" },
          });
          const t = (r?.transcript || "").trim();
          if (t) await send(t);
        } catch (e: any) {
          notify("Errore trascrizione", e?.message || String(e));
        } finally {
          setTranscribing(false);
        }
      })();
      return;
    }
    try {
      if (mrRef.current && mrRef.current.state !== "inactive") mrRef.current.stop();
    } catch {}
  };

  const handleStop = async (recMime: string) => {
    setTranscribing(true);
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      const parts = chunksRef.current;
      chunksRef.current = [];
      if (!parts.length) return;
      const blob = new Blob(parts, { type: recMime || parts[0].type || "audio/webm" });
      if (blob.size < 512) return;
      const b64 = await blobToBase64(blob);
      const r = await api<{ transcript: string }>("/ai/transcribe", {
        method: "POST",
        body: { audio_base64: b64, mime: blob.type || "audio/webm" },
      });
      const t = (r?.transcript || "").trim();
      if (t) {
        // Send immediately
        await send(t);
      }
    } catch {
      // ignore
    } finally {
      setTranscribing(false);
    }
  };

  // V28.o — Quick actions now come from user settings (customizable by Master).
  // - `quickActions === null`: caricamento ancora in corso o fetch fallito → mostra fallback statici.
  // - `quickActions === []`: l'utente ha esplicitamente rimosso tutti i chip → non mostrare nulla.
  // - Altrimenti usa la lista personalizzata.
  const suggestions = quickActions !== null
    ? quickActions
    : [
        { id: "fb1", label: "Prossimo appuntamento", prompt: "Qual è il mio prossimo appuntamento?" },
        { id: "fb2", label: "Telefonate di oggi", prompt: "Quante telefonate ho fatto oggi?" },
        { id: "fb3", label: "Clienti senza appuntamento", prompt: "Mostrami i clienti senza appuntamento futuro" },
        { id: "fb4", label: "Ritelefonate urgenti", prompt: "Quali sono le ritelefonate urgenti da fare oggi?" },
      ];

  return (
    <Modal visible={visible && !hideForShot} animationType="slide" transparent statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropTouch} onPress={onClose} />
        <View ref={sheetContainerRef} style={[styles.sheet, { paddingBottom: insets.bottom }]}>
          {/* V28.v — Drop zone overlay (solo web durante drag di file) */}
          {isDragging && Platform.OS === "web" && (
            <View pointerEvents="none" style={styles.dropOverlay} testID="assistant-drop-overlay">
              <View style={styles.dropInner}>
                <Ionicons name="cloud-upload" size={44} color="#FFF" />
                <Text style={styles.dropTitle}>Rilascia per allegare</Text>
                <Text style={styles.dropSub}>PDF · Excel · Immagini · CSV · TXT</Text>
              </View>
            </View>
          )}
          <KeyboardAvoidingView
            // V50.z11 — Fix input Axon nascosto dalla tastiera Android.
            // V50.z39 — In aggiunta a KeyboardAvoidingView (fallback iOS),
            // applichiamo paddingBottom = kbHeight direttamente al container
            // così su Android nel Modal transparent (dove behavior:padding
            // non funziona) il TextInput sale comunque sopra la tastiera.
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            keyboardVerticalOffset={0}
            style={{ flex: 1, paddingBottom: Platform.OS === "android" ? kbHeight : 0 }}
          >
            {/* Header — V29.n: barra minimale. Rimossi logo e testo "AxonOS".
                Selettore modalità a sinistra come pill dropdown; a destra le 4
                azioni con etichetta: Annunci · Audio · Nuova chat · Chiudi. */}
            {/* Header — V29.p: barra viola a due righe.
                Riga 1: 4 azioni (Annunci · Audio · Nuova chat · Chiudi) distribuite su tutta la larghezza.
                Riga 2: selettore modalità centrato con dropdown chevron. */}
            <View style={styles.header}>
              <View style={styles.headerActionsRow}>
                <Pressable
                  onPress={cycleMode}
                  onLongPress={() => setShowModeMenu(true)}
                  style={styles.headerAction}
                  accessibilityLabel="Modalità annunci"
                  testID="assistant-mode-toggle"
                >
                  <Ionicons name={MODE_ICON[responseMode]} size={20} color={CT.text} />
                  <Text style={styles.headerActionTxt}>Annunci</Text>
                </Pressable>
                <Pressable
                  onPress={voiceSupported ? (convMode ? endConversation : startConversation) : undefined}
                  disabled={!voiceSupported}
                  style={[
                    styles.headerAction,
                    convMode && { backgroundColor: "#EF4444" },
                    !voiceSupported && { opacity: 0.4 },
                  ]}
                  accessibilityLabel={convMode ? "Termina conversazione audio" : "Inizia conversazione audio"}
                  testID="assistant-conv-toggle"
                >
                  <Ionicons name={convMode ? "call" : "headset"} size={20} color={CT.text2} />
                  <Text style={styles.headerActionTxt}>Audio</Text>
                </Pressable>
                <Pressable onPress={resetSession} style={styles.headerAction} accessibilityLabel="Nuova chat" testID="assistant-new-chat">
                  <Ionicons name="create-outline" size={20} color={CT.text2} />
                  <Text style={styles.headerActionTxt}>Nuova chat</Text>
                </Pressable>
                <Pressable
                  onPress={() => { setShowModeMenu(false); setShowMoreMenu((v) => !v); }}
                  style={styles.headerAction}
                  accessibilityLabel="Altre azioni: condividi, PDF, copia"
                  testID="assistant-more-btn"
                >
                  <Ionicons name="ellipsis-vertical" size={20} color={CT.text2} />
                  <Text style={styles.headerActionTxt}>Altro</Text>
                </Pressable>
                <Pressable onPress={onClose} style={styles.headerAction} accessibilityLabel="Chiudi" testID="assistant-close">
                  <Ionicons name="close" size={22} color={CT.text2} />
                  <Text style={styles.headerActionTxt}>Chiudi</Text>
                </Pressable>
              </View>
              <View style={styles.headerModeRow}>
                {/* V50.z238 — Logo AxonOS compatto (stessa altezza del tasto Coda) */}
                <View style={styles.brandPill} testID="assistant-brand-bar-logo">
                  <Image
                    source={AXONOS_LOGO_HORIZONTAL}
                    style={{ width: Math.round(20 * AXONOS_LOGO_HORIZONTAL_ASPECT), height: 20 }}
                    resizeMode="contain"
                  />
                </View>
                {/* V50.z223 — tab «Coda» nell'header */}
                <Pressable onPress={() => { setShowQueue((v) => !v); void refreshQueue(); }} style={[styles.modeDropdown, showQueue && { borderColor: CT.accent, backgroundColor: CT.accentTint }]} hitSlop={6} testID="assistant-queue-tab" accessibilityLabel="Coda messaggi">
                  <Ionicons name="list" size={13} color={CT.text2} />
                  <Text style={styles.modeDropdownTxt}>Coda{queue.length ? ` (${queue.length})` : ""}</Text>
                  {queueFailed.length > 0 && (
                    <View style={styles.queueFailedBadge} testID="assistant-queue-failed-badge"><Text style={styles.queueFailedBadgeTxt}>{queueFailed.length}</Text></View>
                  )}
                </Pressable>
                <Pressable
                  onPress={() => setShowModeMenu((v) => !v)}
                  style={styles.modeDropdown}
                  hitSlop={6}
                  accessibilityLabel="Cambia modalità di risposta"
                  testID="assistant-mode-dropdown"
                >
                  <Ionicons name={MODE_ICON[responseMode]} size={13} color={CT.text2} />
                  <Text style={styles.modeDropdownTxt} numberOfLines={1}>
                    Modalità: {MODE_LABEL[responseMode]}
                  </Text>
                  <Ionicons name="chevron-down" size={13} color={CT.text2} />
                </Pressable>
              </View>
            </View>

            {/* V50.z160 — Menu ⋯ Altro: esporta/condividi l'intera conversazione */}
            {showMoreMenu && (
              <View style={[styles.modeMenu, { minWidth: 240 }]} testID="assistant-more-menu">
                {([
                  { id: "share", icon: "share-social", label: "Condividi conversazione", sub: "WhatsApp, gruppi, mail, social" },
                  { id: "pdf", icon: "document-text", label: "Esporta PDF", sub: "Salva o condividi come PDF" },
                  { id: "copy", icon: "copy", label: "Copia tutto il testo", sub: "Negli appunti" },
                ] as { id: string; icon: any; label: string; sub: string }[]).map((it) => (
                  <Pressable
                    key={it.id}
                    testID={`assistant-more-${it.id}`}
                    disabled={messages.length === 0}
                    onPress={async () => {
                      setShowMoreMenu(false);
                      const txt = conversationToText(messages, assistantName, (user?.name || "").split(" ")[0] || undefined);
                      if (it.id === "share") await shareText(txt, `Conversazione con ${assistantName}`);
                      else if (it.id === "pdf") await exportConversationPdf(messages, assistantName, (user?.name || "").split(" ")[0] || undefined);
                      else await copyText(txt);
                    }}
                    style={[styles.modeItem, messages.length === 0 && { opacity: 0.4 }]}
                  >
                    <Ionicons name={it.icon} size={18} color={CT.text2} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.modeItemTxt}>{it.label}</Text>
                      <Text style={{ fontSize: 11, color: CT.muted }}>{it.sub}</Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            )}

            {/* Mode menu (long-press header toggle) */}
            {showModeMenu && (
              <View style={styles.modeMenu}>
                {MODE_ORDER.map((m) => (
                  <Pressable
                    key={m}
                    onPress={() => setMode(m)}
                    style={[styles.modeItem, responseMode === m && { backgroundColor: CT.accentTint }]}
                    testID={`mode-item-${m}`}
                  >
                    <Ionicons name={MODE_ICON[m]} size={18} color={CT.text2} />
                    <Text style={styles.modeItemTxt}>{MODE_LABEL[m]}</Text>
                    {responseMode === m && <Ionicons name="checkmark" size={18} color={CT.accent} />}
                  </Pressable>
                ))}
              </View>
            )}

            {/* V50.z238 — Brand bar rimossa: il logo AxonOS è ora una pill compatta accanto a «Coda» (libera spazio alla chat). */}

            {/* Messages */}
            <View style={{ flex: 1 }}>
            {/* V50.z238 — barra tab sessioni («+ Nuova» / chip) rimossa su richiesta: i bottoni non rispondevano al tap. */}
            {/* V50.z223 — tab «Coda»: pannello bozze al posto dei messaggi */}
            {showQueue && <ChatQueuePanel items={queue} recentDone={queueDone} failed={queueFailed} onChanged={() => void refreshQueue()} onSendNow={(it) => void sendNow(it)} busy={sending} />}
            <ScrollView
              ref={scrollRef}
              style={[styles.chatArea, showQueue && { display: "none" }]}
              contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 24 }}
              onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
            >
              {loadingHist && (
                <View style={{ alignItems: "center", paddingVertical: 20 }}>
                  <ActivityIndicator color={CT.accent} />
                </View>
              )}
              {!loadingHist && messages.length === 0 && (
                <View style={styles.emptyWrap}>
                  <View style={styles.suggestWrap}>
                    {suggestions.map((s) => (
                      <Pressable
                        key={s.id}
                        testID={`qa-chip-${s.id}`}
                        style={styles.suggestChip}
                        onPress={() => send(s.prompt, { quickLabel: s.label })}
                        disabled={sending}
                      >
                        <Ionicons name="sparkles" size={14} color={CT.accent} />
                        <Text style={styles.suggestTxt}>{s.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              )}
              {messages.map((m, i) => (
                <MessageBubble
                  key={i}
                  msg={m}
                  assistantName={assistantName}
                  onPlay={m.role === "assistant" ? () => void speakReply(m.content, i) : undefined}
                  isPlaying={playingIdx === i || (playingIdx === -1 && i === messages.length - 1 && m.role === "assistant")}
                  paused={paused}
                  onTogglePause={togglePause}
                  onSaveToMaster={m.role === "assistant" && m.used_web_search ? () => openSaveToMaster(m.content) : undefined}
                  isMaster={isMaster}
                  onFeedback={m.role === "assistant" ? (rating) => handleFeedback(i, rating) : undefined}
                  onConfigureArea={(k) => { onClose(); setTimeout(() => router.push(`/le-mie-aree?configure=${k}` as any), 150); }}
                  onNavigate={navigateTo}
                  onAction={runNavAction}
                />
              ))}
              {/* V50.z259 — Suggerimento proattivo del Navigatore (funzioni mai usate) */}
              {!loadingHist && !sending && <NavProactiveCard visible={visible} onNavigate={navigateTo} />}
              {/* V50.z219 — avviso di setup dedicato: interessi futuri attivati nel wizard (finché non si tocca «Ok, ricevuto») */}
              {!loadingHist && !sending && <FutureInterestsAlert variant="chat" onOpen={onClose} />}
              {/* V50.z194 — Pulsanti rapidi sotto la domanda «Vuoi che memorizzi questi dati per uso futuro?» */}
              {!sending && messages.length > 0 && messages[messages.length - 1].role === "assistant" && !messages[messages.length - 1].streaming && hasImportQuestion(messages[messages.length - 1].content) && (
                <ImportConfirmChips onAnswer={(t) => void send(t)} />
              )}
              {/* V50.z207 — ✅ Sì / ❌ No / ❓ Forse sotto le domande chiuse di Axon (un tap = risposta inviata) */}
              {!sending && messages.length > 0 && messages[messages.length - 1].role === "assistant" && !messages[messages.length - 1].streaming
                && !hasImportQuestion(messages[messages.length - 1].content) && isClosedQuestion(messages[messages.length - 1].content) && (
                <QuickReplyButtons key={`qr-${messages.length}`} question={messages[messages.length - 1].content} messageId={messages[messages.length - 1].message_id} onSelect={onQuickReply} />
              )}
              <QuickReplyToast visible={quickReplyToast} />
              {/* V50.z304 — pulsanti automatici per scelte «A) / B)» e azioni «ORA» «MODIFICA»… nell'ultima risposta di Axon */}
              {!sending && messages.length > 0 && messages[messages.length - 1].role === "assistant" && !messages[messages.length - 1].streaming
                && !isClosedQuestion(messages[messages.length - 1].content) && (() => { const ch = extractChoices(messages[messages.length - 1].content); return ch.length ? <ChoiceButtons key={`ch-${messages.length}`} choices={ch} onSelect={(t) => void send(t)} /> : null; })()}
              {/* V50.z211 — avviso «Completa la configurazione…» → link diretto al wizard Set Up and Go */}
              {messages.length > 0 && messages[messages.length - 1].role === "assistant" && !messages[messages.length - 1].streaming && hasSetupNudge(messages[messages.length - 1].content) && (
                <SetupNudgeCard key={`nudge-${messages.length}`} onOpen={onClose} />
              )}
              {sending && prog.visible && (
                <AxonProgressBubble text={prog.text} elapsed={prog.elapsed} assistantName={assistantName} />
              )}
              {sending && !prog.visible && (
                <>
                  <View style={styles.typingBubble}>
                    <TypingDots />
                    <Text style={styles.typingTxt}>{progressText || `${assistantName} sta scrivendo…`}</Text>
                  </View>
                </>
              )}
              {sending && (
                <>
                  <Pressable
                    testID="assistant-stop-btn"
                    onPress={stopGeneration}
                    style={styles.stopBanner}
                    accessibilityLabel="Interrompi risposta"
                    hitSlop={8}
                  >
                    <Ionicons name="stop-circle" size={18} color="#FFF" />
                    <Text style={styles.stopBannerTxt}>Stop</Text>
                  </Pressable>
                </>
              )}
              {/* V50.z301 — bozze in coda visibili in chat (⏳ pos./ETA · Invia ora · Modifica · Elimina); quella in elaborazione è già la bolla utente sopra */}
              <ChatQueueInline items={queue.filter((q) => q.status === "pending")} onChanged={() => void refreshQueue()} onSendNow={(it) => void sendNow(it)} />
            </ScrollView>
            </View>

            {/* Continuous conversation panel */}
            {convMode && (
              <ConversationPanel
                phase={convPhase}
                muted={convMuted}
                onToggleMute={toggleMute}
                onStopListening={stopListeningNow}
                onEnd={endConversation}
                assistantName={assistantName}
              />
            )}

            {/* Input bar (hidden while in conversation mode) */}
            {!convMode && (
            <View>
              {/* V28.l — Preview allegati in attesa di invio */}
              {pendingAttachments.length > 0 ? (
                <View style={styles.attRow}>
                  {pendingAttachments.map((a, i) => (
                    <View key={`${a.name}-${i}`} style={styles.attChip}>
                      <Ionicons name={a.mime.startsWith("image/") ? "image" : a.mime.includes("pdf") ? "document" : "document-attach"} size={13} color={CT.accent} />
                      <Text style={styles.attChipTxt} numberOfLines={1}>{a.name}</Text>
                      <Pressable onPress={() => setPendingAttachments((arr) => arr.filter((_, k) => k !== i))} hitSlop={6}>
                        <Ionicons name="close" size={13} color={CT.text2} />
                      </Pressable>
                    </View>
                  ))}
                </View>
              ) : null}
              <View style={styles.inputBar}>
                {/* V50.h — Layout ristrutturato su richiesta utente: input
                    grande in cima, bottoni allegato/mic sotto. Prima l'input
                    era spinto tra 5 bottoni fissi → largo solo ~130px su
                    phone 390px → testo appariva "in verticale". */}
                <View style={styles.inputRow}>
                  <TextInput
                    value={recording ? `Ascolto… ${recDuration}s` : input}
                    onChangeText={setInput}
                    editable={!recording && !transcribing}
                    placeholder={pendingAttachments.length ? "Aggiungi un contesto (facoltativo)…" : `Scrivi a ${assistantName}…`}
                    placeholderTextColor={CT.muted}
                    style={[styles.input, inputFocused && styles.inputFocused]}
                    onFocus={() => setInputFocused(true)}
                    onBlur={() => setInputFocused(false)}
                    multiline
                    onSubmitEditing={() => { if (sending && input.trim()) { const t = input.trim(); setInput(""); void enqueue(t); } else void send(); }}
                    blurOnSubmit={false}
                    returnKeyType="send"
                    testID="assistant-input"
                  />
                  {/* V50.z223 — input SEMPRE attivo: se Axon sta elaborando, il messaggio va in coda (⏳) e parte da solo dopo */}
                  <Pressable
                    onPress={() => { if (sending) { const t = input.trim(); if (!t) return; setInput(""); void enqueue(t); } else void send(); }}
                    disabled={!input.trim() && pendingAttachments.length === 0}
                    style={[styles.sendBtn, { opacity: !input.trim() && pendingAttachments.length === 0 ? 0.5 : 1 }, sending && input.trim() ? { backgroundColor: CT.warning } : null]}
                    testID="assistant-send"
                    accessibilityLabel={sending ? "Metti in coda" : "Invia"}
                  >
                    {sending && !input.trim() ? (
                      <ActivityIndicator size="small" color="#FFF" />
                    ) : sending ? (
                      <Ionicons name="time-outline" size={20} color="#FFF" />
                    ) : (
                      <Ionicons name="arrow-up" size={20} color="#FFF" />
                    )}
                  </Pressable>
                </View>
                <View style={styles.actionsRow}>
                  {/* V28.l — Pulsante allegato (PDF, Excel, immagini, txt, csv…) */}
                  <Pressable
                    onPress={attachFile}
                    disabled={sending || attaching}
                    hitSlop={4}
                    style={[styles.attachBtn, attaching && { opacity: 0.6 }]}
                    accessibilityLabel="Allega file"
                    testID="assistant-attach"
                  >
                    {attaching ? (
                      <ActivityIndicator size="small" color="#FFF" />
                    ) : (
                      <Ionicons name="attach" size={20} color={CT.text2} />
                    )}
                  </Pressable>
                  {/* V50.z85 — Bottone Foto: menu contestuale camera/galleria */}
                  <Pressable
                    onPress={() => {
                      if (Platform.OS === "web") return attachPhoto("gallery");
                      Alert.alert("Aggiungi foto", "Da dove?", [
                        { text: "Scatta", onPress: () => attachPhoto("camera") },
                        { text: "Galleria", onPress: () => attachPhoto("gallery") },
                        { text: "Annulla", style: "cancel" },
                      ]);
                    }}
                    disabled={sending || attaching}
                    hitSlop={4}
                    style={styles.attachBtn}
                    accessibilityLabel="Aggiungi foto"
                    testID="assistant-photo"
                  >
                    <Ionicons name="camera" size={18} color={CT.text2} />
                  </Pressable>
                  {/* V50.z292 — Screenshot della schermata corrente (un tocco) per segnalare problemi */}
                  <Pressable
                    onPress={attachScreenshot}
                    disabled={sending || attaching}
                    hitSlop={4}
                    style={styles.attachBtn}
                    accessibilityLabel="Allega screenshot della schermata"
                    testID="assistant-screenshot"
                  >
                    <Ionicons name="phone-portrait-outline" size={18} color={CT.text2} />
                  </Pressable>
                  {/* V50.z85 — Scanner documenti jscanify */}
                  <Pressable
                    onPress={() => setScannerOpen(true)}
                    disabled={sending}
                    hitSlop={4}
                    style={styles.attachBtn}
                    accessibilityLabel="Scanner documento"
                    testID="assistant-scanner"
                  >
                    <Ionicons name="scan" size={18} color={CT.text2} />
                  </Pressable>
                  {/* V28.w — Google Drive picker */}
                  <Pressable
                    onPress={() => setDrivePickerOpen(true)}
                    disabled={sending}
                    hitSlop={4}
                    style={styles.attachBtn}
                    accessibilityLabel="Allega da Google Drive"
                    testID="assistant-drive-attach"
                  >
                    <Ionicons name="logo-google" size={16} color={CT.text2} />
                  </Pressable>
                  {/* V49.i — Dropbox picker */}
                  <Pressable
                    onPress={() => setDropboxPickerOpen(true)}
                    disabled={sending}
                    hitSlop={4}
                    style={styles.attachBtn}
                    accessibilityLabel="Allega da Dropbox"
                    testID="assistant-dropbox-attach"
                  >
                    <Ionicons name="logo-dropbox" size={16} color={CT.text2} />
                  </Pressable>
                  {voiceSupported && (
                    <Pressable
                      onPress={recording ? stopRec : startRec}
                      disabled={sending || transcribing}
                      style={[
                        styles.micBtn,
                        { backgroundColor: recording ? CT.danger : transcribing ? CT.surfaceUser : "transparent" },
                      ]}
                      accessibilityLabel={recording ? "Ferma dettatura" : "Detta domanda"}
                    >
                      {transcribing ? (
                        <ActivityIndicator size="small" color="#FFF" />
                      ) : (
                        <Ionicons
                          name={recording ? "stop" : "mic"}
                          size={20}
                          color={recording ? "#FFF" : CT.text2}
                        />
                      )}
                    </Pressable>
                  )}
                </View>
              </View>
            </View>
            )}
          </KeyboardAvoidingView>
        </View>
      </View>
      {/* V38T — Save-to-Master modal (rename confirm) */}
      <SaveConfirmModal
        visible={!!saveTarget}
        title="Salva risposta di Neo"
        subtitle="Verrà salvata nella sezione Note dei tuoi File Master"
        defaultName={saveTarget?.defaultName || ""}
        extension=".md"
        color="#16A34A"
        onCancel={() => setSaveTarget(null)}
        onConfirm={confirmSaveToMaster}
      />
      {/* V28.w — Google Drive picker for attaching authorized Drive files */}
      <GoogleDrivePickerModal
        visible={drivePickerOpen}
        onClose={() => setDrivePickerOpen(false)}
        onNavigateToPicker={() => {
          // V50.y — Se navighiamo al picker cartelle, chiudi ANCHE la chat
          // (altrimenti la Modal AssistantChat resta sopra e nasconde il picker)
          setDrivePickerOpen(false);
          onClose();
        }}
        onFilePicked={(f) => addPendingAttachment({ name: f.name, mime: f.mime, base64: f.data_base64 })}
      />
      {/* V49.i — Dropbox picker for attaching Dropbox files */}
      <DropboxPickerModal
        visible={dropboxPickerOpen}
        onClose={() => setDropboxPickerOpen(false)}
        onFilePicked={(f) => addPendingAttachment({ name: f.name, mime: f.mime, base64: f.data_base64 })}
      />
      {/* V50.z85 — Scanner documenti jscanify */}
      {/* Scanner nativo (stesso della scheda cliente): autofocus, multi-pagina,
          ritaglio manuale, anteprima/conferma → PDF allegato alla chat */}
      <DocumentScannerModal
        visible={scannerOpen}
        onClose={() => setScannerOpen(false)}
        defaultName={`Scansione-${new Date().toISOString().slice(0, 10)}`}
        hintTitle="Scansiona un documento da allegare ad Axon"
        source="chat"
        onSaved={(r) => onScannerResult({
          name: r.name.toLowerCase().endsWith(".pdf") ? r.name : `${r.name}.pdf`,
          dataUrl: `data:${r.mime};base64,${r.pdf_base64}`,
          mime: r.mime,
        })}
      />
      {/* V41 — Feedback 👎 reason modal */}
      <Modal
        visible={!!feedbackDown}
        transparent
        animationType="fade"
        onRequestClose={() => (feedbackSaving ? undefined : setFeedbackDown(null))}
        statusBarTranslucent
      >
        <View style={styles.fbBackdrop}>
          <View style={styles.fbCard} testID="feedback-down-modal">
            <View style={styles.fbHeader}>
              <View style={styles.fbHeaderIcon}>
                <Ionicons name="thumbs-down" size={20} color="#DC2626" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fbTitle}>Cosa non ha funzionato?</Text>
                <Text style={styles.fbSub}>
                  {assistantName} imparerà dai tuoi feedback per migliorare le prossime risposte.
                </Text>
              </View>
            </View>
            <View style={styles.fbReasonWrap}>
              {[
                { id: "impreciso", label: "Impreciso" },
                { id: "non_pertinente", label: "Fuori tema" },
                { id: "troppo_lungo", label: "Troppo lungo" },
                { id: "troppo_corto", label: "Troppo corto" },
                { id: "linguaggio", label: "Linguaggio" },
                { id: "altro", label: "Altro" },
              ].map((r) => (
                <Pressable
                  key={r.id}
                  onPress={() => setFeedbackReason(r.id === feedbackReason ? "" : r.id)}
                  style={[
                    styles.fbReason,
                    feedbackReason === r.id && styles.fbReasonSel,
                  ]}
                  testID={`feedback-reason-${r.id}`}
                >
                  <Text style={[
                    styles.fbReasonTxt,
                    feedbackReason === r.id && { color: "#FFF", fontWeight: "700" },
                  ]}>
                    {r.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              value={feedbackComment}
              onChangeText={setFeedbackComment}
              placeholder="Aggiungi un commento (facoltativo)…"
              placeholderTextColor="#94A3B8"
              style={styles.fbInput}
              multiline
              maxLength={500}
              testID="feedback-comment-input"
            />
            <View style={styles.fbBtnRow}>
              <Pressable
                onPress={() => setFeedbackDown(null)}
                disabled={feedbackSaving}
                style={[styles.fbBtnGhost, feedbackSaving && { opacity: 0.5 }]}
                testID="feedback-cancel"
              >
                <Text style={styles.fbBtnGhostTxt}>Annulla</Text>
              </Pressable>
              <Pressable
                onPress={submitDownFeedback}
                disabled={feedbackSaving}
                style={[styles.fbBtnSubmit, feedbackSaving && { opacity: 0.5 }]}
                testID="feedback-submit"
              >
                {feedbackSaving ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <>
                    <Ionicons name="paper-plane" size={14} color="#FFF" />
                    <Text style={styles.fbBtnSubmitTxt}>Invia feedback</Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      {/* V50.z318 — onda di attivazione / trova il telefono visibili anche sopra la chat (RN Modal = finestra nativa sopra tutto) */}
      <ActivationOverlay mirror />
    </Modal>
  );
}


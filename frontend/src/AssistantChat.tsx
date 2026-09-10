import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Modal,
  TextInput,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  Animated,
  Easing,
  Image,
  Alert,
  PanResponder,
  Dimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
// V29.au — Import expo-audio per il pulsante microfono su native (APK Android/iOS).
// Prima era solo web (MediaRecorder), quindi su APK i pulsanti mic + ascolto
// continuo sparivano. Ora usiamo useAudioRecorder di expo-audio in modo nativo.
import { useAudioRecorder, useAudioRecorderState, AudioModule, RecordingPresets } from "expo-audio";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { SentenceSpeaker } from "@/src/utils/sentenceSpeaker";
import { useAuth } from "@/src/auth";
import { theme } from "@/src/theme";
import { useFabStack } from "@/src/FabStack";
import { SaveConfirmModal, suggestFileName } from "@/src/SaveConfirmModal";
import { pickCommonFile } from "@/src/utils/filePicker";
import { ChatTableExport, parseMessageSegments } from "@/src/ChatTableExport";
import { ChatChartExport } from "@/src/ChatChartExport";
import { ModuleErrorBoundary } from "@/src/shared/ModuleErrorBoundary";
import { GoogleDrivePickerModal } from "@/src/GoogleDrivePickerModal";
import { DocumentScannerModal } from "@/src/DocumentScannerModal";
import { DropboxPickerModal } from "@/src/DropboxPickerModal";
import { SaveToAxonPrompt } from "@/src/SaveToAxonPrompt";
import { AxonOSLogo } from "@/src/BrandLogos";
import { streamAssistantChat } from "@/src/utils/assistantStream";
import { syncAlarmNotifs } from "@/src/alarmNotifs";
import { notify } from "@/src/utils/notify";
import { conversationToText, copyText, shareText, exportConversationPdf } from "@/src/utils/chatExport";

// V50.z11 — useBottomSheetPadding rimosso: era usato per padding sheet ma
// il KeyboardAvoidingView ora gestisce autonomamente lo spazio sopra la tastiera.
// V29.l — Logo AxonOS orizzontale trasparente per l'empty state chat (senza card scura, compatto).
const AXONOS_LOGO_HORIZONTAL = require("@/assets/images/axonos-logo-transparent.png");
const AXONOS_LOGO_HORIZONTAL_ASPECT = 1375 / 294;
// V29.m — Variante bianca (silhouette) per il FAB viola: massima leggibilità senza padding scuro.
const AXONOS_LOGO_WHITE = require("@/assets/images/axonos-logo-white.png");

const ASSISTANT_COLOR = "#8B5CF6"; // violet — distinct from red mic and blue brand
const ASSISTANT_COLOR_DARK = "#6D28D9";

type ResponseMode = "text" | "voice" | "both";

type ChatMsg = {
  role: "user" | "assistant";
  content: string;
  created_at?: string;
  // V38T — Track which assistant messages were augmented with web search
  used_web_search?: boolean;
  web_sources?: { title: string; url: string }[];
  // V29.n — Etichetta breve per messaggi generati da azioni rapide (es. "PUN MEDIO PER FASCE").
  // Se presente, la bubble utente mostra questa label compatta invece del prompt completo.
  quick_label?: string;
  // V29.ag — Metadata cache azione rapida: data ultimo aggiornamento + flag from_cache.
  qa_updated_at?: string;
  qa_from_cache?: boolean;
  // V40 — Streaming state + semantic cache flag
  streaming?: boolean;
  from_cache?: boolean;
  // V41 — Feedback per assistant message
  message_id?: string;
  feedback_rating?: "up" | "down" | null;
};

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

/**
 * Cross-platform audio player. Uses <audio> on web, expo-audio on native.
 * Returns a cleanup function. Calls onEnded when playback naturally completes.
 */
async function playAudioBase64(
  b64: string,
  mime: string = "audio/mpeg",
  onEnded?: () => void
): Promise<() => void> {
  if (Platform.OS === "web") {
    const dataUri = `data:${mime};base64,${b64}`;
    const audio = new Audio(dataUri);
    if (onEnded) {
      audio.addEventListener("ended", () => { try { onEnded(); } catch {} }, { once: true });
    }
    try { await audio.play(); } catch {}
    return () => {
      try { audio.pause(); } catch {}
    };
  }
  // Native — dynamic import so web bundle doesn't try to load it
  try {
    const AudioMod: any = await import("expo-audio");
    const { createAudioPlayer } = AudioMod;
    const player = createAudioPlayer({ uri: `data:${mime};base64,${b64}` });
    try { player.play(); } catch {}
    if (onEnded) {
      // Best-effort duration-based fallback for native
      const est = 4000;
      setTimeout(() => { try { onEnded(); } catch {} }, est);
    }
    return () => {
      try { player.pause?.(); } catch {}
      try { player.release?.(); } catch {}
    };
  } catch {
    return () => {};
  }
}

export function AssistantChatModal({ visible, onClose }: AssistantChatProps) {
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets(); // V29.ao — safe area insets per non finire sotto la gesture bar
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
  // V28.l — Allegati caricati dall'utente per la prossima /assistant/chat
  const [pendingAttachments, setPendingAttachments] = useState<{ name: string; mime: string; data_base64: string }[]>([]);
  const [attaching, setAttaching] = useState(false);
  // V50.z85 — Scanner jscanify (WebView cross-platform)
  const [scannerOpen, setScannerOpen] = useState(false);
  const [sending, setSending] = useState(false);
  // V29.n — Riferimento all'AbortController della chiamata in corso, per il pulsante "Stop".
  const abortRef = useRef<AbortController | null>(null);
  const [loadingHist, setLoadingHist] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  // V50.z126 — Testo di stato del preflight streaming ("Sto raccogliendo il contesto…")
  const [progressText, setProgressText] = useState<string | null>(null);
  const [recDuration, setRecDuration] = useState(0);
  const [responseMode, setResponseMode] = useState<ResponseMode>("text");
  // V28.o — Quick actions personalizzabili (mostrate nell'empty state della chat).
  // `null` = non ancora caricate; array vuoto = utente ha esplicitamente rimosso tutte le azioni.
  const [quickActions, setQuickActions] = useState<{ id: string; label: string; prompt: string }[] | null>(null);  const [assistantVoice, setAssistantVoice] = useState<string>("nova");
  const [playingIdx, setPlayingIdx] = useState<number | null>(null);
  const [showModeMenu, setShowModeMenu] = useState(false);
  // V50.z160 — Menu ⋯ "Altro": condividi / PDF / copia intera conversazione
  const [showMoreMenu, setShowMoreMenu] = useState(false);
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


  const send = async (text?: string, opts?: { forceSpeak?: boolean; onSpoken?: () => void; quickLabel?: string }) => {
    const msg = (text ?? input).trim();
    // V28.l — Consenti l'invio se c'è ALMENO un allegato, anche senza testo
    if ((!msg && pendingAttachments.length === 0) || sending) return;
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
          setPlayingIdx((v) => (v === -1 ? null : v));
          setPaused(false);
          cleanupAudioRef.current = null;
          if (opts?.onSpoken) opts.onSpoken();
        },
      });
      const sp = speaker;
      cleanupAudioRef.current = () => sp.stop();
    }
    try {
      // V50.z142 — Feedback immediato locale: mostra subito "Sto ragionando…" nella bolla
      // di typing; il server invia lo stesso ack come primo evento SSE (stage "ack").
      setProgressText("Sto ragionando…");
      // V40 — Streaming path via SSE. Append delta chunks to the last message
      // in real time. Falls back to a regular POST if streaming fails.
      const streamResult = await streamAssistantChat({
        message: msg || "Analizza gli allegati.",
        session_id: sessionId || undefined,
        attachments: attachmentsPayload,
        quick_label: opts?.quickLabel && !attachmentsPayload.length ? opts.quickLabel : undefined,
        signal: controller.signal,
        onProgress: (p) => {
          // V50.z126 — Stato del preflight visibile ("Sto raccogliendo il contesto…")
          armWatchdog();
          if (p?.text) setProgressText(p.text);
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
      setSending(false);
    }
  };

  // V29.n — Interrompe immediatamente la risposta in corso.
  const stopGeneration = () => {
    try { abortRef.current?.abort(); } catch { /* ignore */ }
  };

  const speakReply = async (text: string, forceIdx?: number, onEnded?: () => void) => {
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
        await AudioModule.setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
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
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent onRequestClose={onClose}>
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
                  <Ionicons name={MODE_ICON[responseMode]} size={20} color="#FFF" />
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
                  <Ionicons name={convMode ? "call" : "headset"} size={20} color="#FFF" />
                  <Text style={styles.headerActionTxt}>Audio</Text>
                </Pressable>
                <Pressable onPress={resetSession} style={styles.headerAction} accessibilityLabel="Nuova chat" testID="assistant-new-chat">
                  <Ionicons name="create-outline" size={20} color="#FFF" />
                  <Text style={styles.headerActionTxt}>Nuova chat</Text>
                </Pressable>
                <Pressable
                  onPress={() => { setShowModeMenu(false); setShowMoreMenu((v) => !v); }}
                  style={styles.headerAction}
                  accessibilityLabel="Altre azioni: condividi, PDF, copia"
                  testID="assistant-more-btn"
                >
                  <Ionicons name="ellipsis-vertical" size={20} color="#FFF" />
                  <Text style={styles.headerActionTxt}>Altro</Text>
                </Pressable>
                <Pressable onPress={onClose} style={styles.headerAction} accessibilityLabel="Chiudi">
                  <Ionicons name="close" size={22} color="#FFF" />
                  <Text style={styles.headerActionTxt}>Chiudi</Text>
                </Pressable>
              </View>
              <View style={styles.headerModeRow}>
                <Pressable
                  onPress={() => setShowModeMenu((v) => !v)}
                  style={styles.modeDropdown}
                  hitSlop={6}
                  accessibilityLabel="Cambia modalità di risposta"
                  testID="assistant-mode-dropdown"
                >
                  <Ionicons name={MODE_ICON[responseMode]} size={13} color="#FFF" />
                  <Text style={styles.modeDropdownTxt} numberOfLines={1}>
                    Modalità: {MODE_LABEL[responseMode]}
                  </Text>
                  <Ionicons name="chevron-down" size={13} color="#FFF" />
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
                    <Ionicons name={it.icon} size={18} color={ASSISTANT_COLOR_DARK} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.modeItemTxt}>{it.label}</Text>
                      <Text style={{ fontSize: 11, color: "#64748B" }}>{it.sub}</Text>
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
                    style={[styles.modeItem, responseMode === m && { backgroundColor: "#F1EEFF" }]}
                    testID={`mode-item-${m}`}
                  >
                    <Ionicons name={MODE_ICON[m]} size={18} color={ASSISTANT_COLOR_DARK} />
                    <Text style={styles.modeItemTxt}>{MODE_LABEL[m]}</Text>
                    {responseMode === m && <Ionicons name="checkmark" size={18} color={ASSISTANT_COLOR_DARK} />}
                  </Pressable>
                ))}
              </View>
            )}

            {/* Brand bar V29.u: logo AxonOS sempre visibile in alto (fisso).
                Non è più solo nell'empty state — resta come elemento persistente
                dell'interfaccia anche durante l'elaborazione e dopo i messaggi. */}
            <View style={styles.brandBar}>
              <Image
                source={AXONOS_LOGO_HORIZONTAL}
                style={{ width: 148, height: Math.round(148 / AXONOS_LOGO_HORIZONTAL_ASPECT) }}
                resizeMode="contain"
                testID="assistant-brand-bar-logo"
              />
            </View>

            {/* Messages */}
            <ScrollView
              ref={scrollRef}
              style={styles.chatArea}
              contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 24 }}
              onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
            >
              {loadingHist && (
                <View style={{ alignItems: "center", paddingVertical: 20 }}>
                  <ActivityIndicator color={ASSISTANT_COLOR} />
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
                        <Ionicons name="sparkles" size={14} color={ASSISTANT_COLOR_DARK} />
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
                />
              ))}
              {sending && (
                <>
                  <View style={styles.typingBubble}>
                    <TypingDots />
                    <Text style={styles.typingTxt}>{progressText || `${assistantName} sta scrivendo…`}</Text>
                  </View>
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
            </ScrollView>

            {/* Continuous conversation panel */}
            {convMode && (
              <ConversationPanel
                phase={convPhase}
                muted={convMuted}
                onToggleMute={toggleMute}
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
                      <Ionicons name={a.mime.startsWith("image/") ? "image" : a.mime.includes("pdf") ? "document" : "document-attach"} size={13} color="#6D28D9" />
                      <Text style={styles.attChipTxt} numberOfLines={1}>{a.name}</Text>
                      <Pressable onPress={() => setPendingAttachments((arr) => arr.filter((_, k) => k !== i))} hitSlop={6}>
                        <Ionicons name="close" size={13} color="#6D28D9" />
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
                    placeholderTextColor="#94A3B8"
                    style={styles.input}
                    multiline
                    onSubmitEditing={() => send()}
                    blurOnSubmit={false}
                    returnKeyType="send"
                    testID="assistant-input"
                  />
                  <Pressable
                    onPress={() => send()}
                    disabled={sending || (!input.trim() && pendingAttachments.length === 0)}
                    style={[styles.sendBtn, { opacity: sending || (!input.trim() && pendingAttachments.length === 0) ? 0.5 : 1 }]}
                    testID="assistant-send"
                  >
                    {sending ? (
                      <ActivityIndicator size="small" color="#FFF" />
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
                    style={[styles.attachBtn, { backgroundColor: attaching ? "#6B7280" : "#F1F0FF" }]}
                    accessibilityLabel="Allega file"
                    testID="assistant-attach"
                  >
                    {attaching ? (
                      <ActivityIndicator size="small" color="#FFF" />
                    ) : (
                      <Ionicons name="attach" size={20} color={ASSISTANT_COLOR_DARK} />
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
                    style={[styles.attachBtn, { backgroundColor: "#FDF2F8" }]}
                    accessibilityLabel="Aggiungi foto"
                    testID="assistant-photo"
                  >
                    <Ionicons name="camera" size={18} color="#DB2777" />
                  </Pressable>
                  {/* V50.z85 — Scanner documenti jscanify */}
                  <Pressable
                    onPress={() => setScannerOpen(true)}
                    disabled={sending}
                    hitSlop={4}
                    style={[styles.attachBtn, { backgroundColor: "#FEF3C7" }]}
                    accessibilityLabel="Scanner documento"
                    testID="assistant-scanner"
                  >
                    <Ionicons name="scan" size={18} color="#B45309" />
                  </Pressable>
                  {/* V28.w — Google Drive picker */}
                  <Pressable
                    onPress={() => setDrivePickerOpen(true)}
                    disabled={sending}
                    hitSlop={4}
                    style={[styles.attachBtn, { backgroundColor: "#F1F0FF" }]}
                    accessibilityLabel="Allega da Google Drive"
                    testID="assistant-drive-attach"
                  >
                    <Ionicons name="logo-google" size={16} color="#0F9D58" />
                  </Pressable>
                  {/* V49.i — Dropbox picker */}
                  <Pressable
                    onPress={() => setDropboxPickerOpen(true)}
                    disabled={sending}
                    hitSlop={4}
                    style={[styles.attachBtn, { backgroundColor: "#E0EFFF" }]}
                    accessibilityLabel="Allega da Dropbox"
                    testID="assistant-dropbox-attach"
                  >
                    <Ionicons name="logo-dropbox" size={16} color="#0061FF" />
                  </Pressable>
                  {voiceSupported && (
                    <Pressable
                      onPress={recording ? stopRec : startRec}
                      disabled={sending || transcribing}
                      style={[
                        styles.micBtn,
                        { backgroundColor: recording ? "#DC2626" : transcribing ? "#6B7280" : "#F1F0FF" },
                      ]}
                      accessibilityLabel={recording ? "Ferma dettatura" : "Detta domanda"}
                    >
                      {transcribing ? (
                        <ActivityIndicator size="small" color="#FFF" />
                      ) : (
                        <Ionicons
                          name={recording ? "stop" : "mic"}
                          size={20}
                          color={recording ? "#FFF" : ASSISTANT_COLOR_DARK}
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
    </Modal>
  );
}


type ConvPhase = "idle" | "listening" | "transcribing" | "thinking" | "speaking";

function ConversationPanel({
  phase,
  muted,
  onToggleMute,
  onEnd,
  assistantName,
}: {
  phase: ConvPhase;
  muted: boolean;
  onToggleMute: () => void;
  onEnd: () => void;
  assistantName: string;
}) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    // Pulse only when actively engaged (not idle-muted)
    if (muted) { pulse.setValue(0); return; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true, easing: Easing.out(Easing.ease) }),
        Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true, easing: Easing.in(Easing.ease) }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [muted, pulse]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] });

  let color = "#8B5CF6"; // idle / speaking
  let icon: keyof typeof Ionicons.glyphMap = "mic";
  let label = "In ascolto…";
  let subLabel = "Parla pure, ti sto ascoltando";
  if (muted) {
    color = "#6B7280"; icon = "mic-off"; label = "Microfono muto"; subLabel = "Tocca il microfono per riprendere";
  } else if (phase === "transcribing") {
    color = "#F59E0B"; icon = "cloud-upload"; label = "Ti sto capendo…"; subLabel = "Sto trascrivendo";
  } else if (phase === "thinking") {
    color = "#8B5CF6"; icon = "sparkles"; label = `${assistantName} sta pensando…`; subLabel = "Attendi la risposta";
  } else if (phase === "speaking") {
    color = "#22C55E"; icon = "volume-high"; label = `${assistantName} sta parlando…`; subLabel = "Ti risponde ora";
  } else if (phase === "listening") {
    color = "#DC2626"; icon = "mic"; label = "In ascolto…"; subLabel = "Parla pure, ti sto ascoltando";
  } else {
    color = "#8B5CF6"; icon = "hourglass"; label = "Pausa"; subLabel = "Un attimo…";
  }

  return (
    <View style={styles.convPanel} testID="assistant-conv-panel">
      <View style={styles.convVisual}>
        <Animated.View
          style={[
            styles.convOrb,
            { backgroundColor: color, transform: [{ scale }], opacity },
          ]}
        >
          <Ionicons name={icon} size={34} color="#FFF" />
        </Animated.View>
      </View>
      <Text style={styles.convLabel}>{label}</Text>
      <Text style={styles.convSubLabel}>{subLabel}</Text>
      <View style={styles.convBtnRow}>
        <Pressable
          onPress={onToggleMute}
          style={[styles.convBtn, { backgroundColor: muted ? "#DC2626" : "#F1F0FF" }]}
          testID="assistant-conv-mute"
          accessibilityLabel={muted ? "Riattiva microfono" : "Silenzia microfono"}
        >
          <Ionicons name={muted ? "mic-off" : "mic"} size={22} color={muted ? "#FFF" : ASSISTANT_COLOR_DARK} />
          <Text style={[styles.convBtnTxt, muted && { color: "#FFF" }]}>{muted ? "Riprendi" : "Muto"}</Text>
        </Pressable>
        <Pressable
          onPress={onEnd}
          style={[styles.convBtn, { backgroundColor: "#EF4444" }]}
          testID="assistant-conv-end"
          accessibilityLabel="Termina conversazione"
        >
          <Ionicons name="call" size={22} color="#FFF" style={{ transform: [{ rotate: "135deg" }] }} />
          <Text style={[styles.convBtnTxt, { color: "#FFF" }]}>Termina</Text>
        </Pressable>
      </View>
    </View>
  );
}

function MessageBubble({
  msg,
  assistantName,
  onPlay,
  isPlaying,
  paused,
  onTogglePause,
  onSaveToMaster,
  isMaster,
  onFeedback,
}: {
  msg: ChatMsg;
  assistantName: string;
  onPlay?: () => void;
  isPlaying?: boolean;
  paused?: boolean;
  onTogglePause?: () => void;
  onSaveToMaster?: () => void;
  isMaster?: boolean;
  onFeedback?: (rating: "up" | "down") => void;
}) {
  const isUser = msg.role === "user";
  return (
    <View style={[styles.bubbleRow, { justifyContent: isUser ? "flex-end" : "flex-start" }]}>
      {!isUser && (
        <View style={styles.bubbleAvatar}>
          <MaterialCommunityIcons name="robot-happy" size={14} color="#FFF" />
        </View>
      )}
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAsst]}>
        {!isUser && (
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={styles.bubbleWho}>{assistantName}</Text>
              {msg.used_web_search && (
                <View style={styles.webBadge}>
                  <Ionicons name="globe" size={10} color="#0EA5E9" />
                  <Text style={styles.webBadgeTxt}>web</Text>
                </View>
              )}
              {msg.from_cache && (
                <View style={styles.cacheBadge} testID="msg-cache-badge">
                  <Ionicons name="flash" size={10} color="#B45309" />
                  <Text style={styles.cacheBadgeTxt}>istantanea</Text>
                </View>
              )}
              {msg.streaming && (
                <View style={styles.streamBadge}>
                  <Ionicons name="ellipsis-horizontal" size={10} color="#6D28D9" />
                </View>
              )}
            </View>
            {onPlay && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                {/* V38T — Prominent pause/resume button while this reply is playing */}
                {isPlaying && onTogglePause && (
                  <Pressable
                    onPress={onTogglePause}
                    hitSlop={8}
                    accessibilityLabel={paused ? "Riprendi" : "Pausa"}
                    testID="msg-pause-btn"
                    style={{ padding: 2 }}
                  >
                    <Ionicons name={paused ? "play" : "pause"} size={20} color="#DC2626" />
                  </Pressable>
                )}
                <Pressable
                  onPress={onPlay}
                  hitSlop={8}
                  accessibilityLabel="Ascolta risposta"
                  testID="msg-play-btn"
                  style={{ padding: 2 }}
                >
                  <Ionicons
                    name={isPlaying ? "volume-high" : "play-circle"}
                    size={18}
                    color={isPlaying ? "#DC2626" : ASSISTANT_COLOR_DARK}
                  />
                </Pressable>
              </View>
            )}
          </View>
        )}
        {/* V28.p — Rende il contenuto in segmenti: testo normale + tabelle markdown con Export */}
        {(() => {
          if (isUser) {
            // V29.n — Se il messaggio viene da un'azione rapida, mostra solo l'etichetta compatta
            // (es. "PUN MEDIO PER FASCE") invece del prompt completo della regola.
            if (msg.quick_label) {
              return (
                <View style={styles.quickActionPill}>
                  <Ionicons name="sparkles" size={12} color="#FFF" />
                  <Text style={styles.quickActionPillTxt} numberOfLines={2}>
                    {msg.quick_label}
                  </Text>
                </View>
              );
            }
            // Utente normale: testo semplice
            return <Text style={[styles.bubbleText, { color: "#FFF" }]}>{msg.content}</Text>;
          }
          // V50.z121 — Il parser tabelle/grafici non deve mai far crashare la chat
          let segments: ReturnType<typeof parseMessageSegments>;
          try { segments = parseMessageSegments(msg.content || ""); }
          catch { segments = [{ type: "text", content: msg.content || "" }] as any; }
          if (segments.length === 0) return null;
          return (
            <View style={{ gap: 6 }}>
              {segments.map((seg, si) => {
                if (seg.type === "text") {
                  return <Text key={`s-${si}`} style={styles.bubbleText}>{seg.content}</Text>;
                }
                if (seg.type === "chart") {
                  // V50.z109 — Grafico Axon con pulsante espandi-a-tutto-schermo in-app
                  // V50.z121 — Error boundary: un grafico non renderizzabile NON deve
                  // mai lasciare la chat bianca (fallback: tabella/testo).
                  return (
                    <ModuleErrorBoundary key={`s-${si}`} moduleName="grafico" fallback={() => <Text style={styles.bubbleText}>{seg.chart?.title ? `📊 ${seg.chart.title}` : "📊 Grafico non disponibile su questo dispositivo"}</Text>}>
                      <ChatChartExport spec={seg.chart} assistantColor={ASSISTANT_COLOR_DARK} />
                    </ModuleErrorBoundary>
                  );
                }
                return (
                  <ModuleErrorBoundary key={`s-${si}`} moduleName="tabella" fallback={() => <Text style={styles.bubbleText}>{(seg.table?.rows || []).map((r: any) => (Array.isArray(r) ? r.join(" | ") : String(r))).join("\n")}</Text>}>
                    <ChatTableExport table={seg.table} assistantColor={ASSISTANT_COLOR} />
                  </ModuleErrorBoundary>
                );
              })}
            </View>
          );
        })()}
        {/* V38T — Save-to-Master button on responses that used web search */}
        {!isUser && onSaveToMaster && (
          <Pressable
            onPress={onSaveToMaster}
            testID="msg-save-master-btn"
            style={styles.saveMasterBtn}
          >
            <Ionicons name="save" size={14} color="#16A34A" />
            <Text style={styles.saveMasterTxt}>Salva nei file Master</Text>
          </Pressable>
        )}
        {/* Web sources footer */}
        {!isUser && msg.web_sources && msg.web_sources.length > 0 && (
          <View style={{ marginTop: 6, gap: 2 }}>
            <Text style={styles.sourcesLbl}>Fonti:</Text>
            {msg.web_sources.slice(0, 3).map((s, k) => (
              <Text key={k} style={styles.sourceTxt} numberOfLines={1}>• {s.title || s.url}</Text>
            ))}
          </View>
        )}
        {/* V29.ag — Footer "Dati aggiornati al: ..." per messaggi da azioni rapide con cache server-side */}
        {!isUser && msg.qa_updated_at && (
          <View style={styles.qaUpdatedRow}>
            <Ionicons name={msg.qa_from_cache ? "flash" : "cloud-download"} size={11} color="#16A34A" />
            <Text style={styles.qaUpdatedTxt}>
              {msg.qa_from_cache ? "Dati aggiornati al: " : "Nuovo aggiornamento: "}
              {(() => {
                try {
                  const d = new Date(msg.qa_updated_at);
                  return d.toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" }) +
                    " · " + d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
                } catch {
                  return msg.qa_updated_at || "";
                }
              })()}
            </Text>
          </View>
        )}
        {/* V28.y — Prompt discreto "Salva come regola" / "Aggiungi fonte" — solo Master */}
        {!isUser && (
          <SaveToAxonPrompt content={msg.content} assistantColor={ASSISTANT_COLOR_DARK} isMaster={!!isMaster} />
        )}
        {/* V50.z160 — Azioni messaggio: Copia · Condividi · PDF (il testo non è
            selezionabile su Android nel Modal → serve un'azione esplicita). */}
        {!msg.streaming && !!(msg.content || "").trim() && (
          <View style={[styles.msgActionsRow, isUser && { justifyContent: "flex-end" }]}>
            <Pressable
              onPress={() => copyText(msg.content)}
              hitSlop={8}
              accessibilityLabel="Copia messaggio"
              testID="msg-copy-btn"
              style={styles.msgActionBtn}
            >
              <Ionicons name="copy-outline" size={13} color={isUser ? "#EDE9FE" : "#64748B"} />
              <Text style={[styles.msgActionTxt, isUser && { color: "#EDE9FE" }]}>Copia</Text>
            </Pressable>
            <Pressable
              onPress={() => shareText(msg.content, `${assistantName} · AdvisorOS`)}
              hitSlop={8}
              accessibilityLabel="Condividi messaggio"
              testID="msg-share-btn"
              style={styles.msgActionBtn}
            >
              <Ionicons name="share-social-outline" size={13} color={isUser ? "#EDE9FE" : "#64748B"} />
              <Text style={[styles.msgActionTxt, isUser && { color: "#EDE9FE" }]}>Condividi</Text>
            </Pressable>
            {!isUser && (
              <Pressable
                onPress={() => exportConversationPdf([msg], assistantName, undefined, `${assistantName} · risposta`)}
                hitSlop={8}
                accessibilityLabel="Esporta messaggio in PDF"
                testID="msg-pdf-btn"
                style={styles.msgActionBtn}
              >
                <Ionicons name="document-text-outline" size={13} color="#64748B" />
                <Text style={styles.msgActionTxt}>PDF</Text>
              </Pressable>
            )}
          </View>
        )}
        {/* V41 — Feedback 👍/👎 (solo su risposte assistant completate, con message_id) */}
        {!isUser && !msg.streaming && msg.message_id && onFeedback && (
          <View style={styles.feedbackRow}>
            <Text style={styles.feedbackLbl}>Utile?</Text>
            <Pressable
              onPress={() => onFeedback("up")}
              hitSlop={8}
              accessibilityLabel="Utile"
              testID="msg-feedback-up"
              style={[
                styles.feedbackBtn,
                msg.feedback_rating === "up" && styles.feedbackBtnUp,
              ]}
            >
              <Ionicons
                name={msg.feedback_rating === "up" ? "thumbs-up" : "thumbs-up-outline"}
                size={14}
                color={msg.feedback_rating === "up" ? "#16A34A" : "#64748B"}
              />
            </Pressable>
            <Pressable
              onPress={() => onFeedback("down")}
              hitSlop={8}
              accessibilityLabel="Non utile"
              testID="msg-feedback-down"
              style={[
                styles.feedbackBtn,
                msg.feedback_rating === "down" && styles.feedbackBtnDown,
              ]}
            >
              <Ionicons
                name={msg.feedback_rating === "down" ? "thumbs-down" : "thumbs-down-outline"}
                size={14}
                color={msg.feedback_rating === "down" ? "#DC2626" : "#64748B"}
              />
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

function TypingDots() {
  const a1 = useRef(new Animated.Value(0)).current;
  const a2 = useRef(new Animated.Value(0)).current;
  const a3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const mkAnim = (val: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(val, { toValue: 1, duration: 300, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
          Animated.timing(val, { toValue: 0, duration: 300, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        ])
      );
    const loops = [mkAnim(a1, 0), mkAnim(a2, 150), mkAnim(a3, 300)];
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [a1, a2, a3]);

  const dot = (v: Animated.Value) => (
    <Animated.View
      style={[
        styles.dot,
        {
          opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }),
          transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -3] }) }],
        },
      ]}
    />
  );

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 3, marginRight: 8 }}>
      {dot(a1)}
      {dot(a2)}
      {dot(a3)}
    </View>
  );
}

/**
 * Global floating action button that opens the assistant chat.
 * Visible on all screens (mounted at root layout).
 */
export function AssistantFAB() {
  const { user } = useAuth();
  const router = useRouter();
  const { present } = useFabStack();
  const [open, setOpen] = useState(false);
  const [unreadInfoReq, setUnreadInfoReq] = useState(0);
  const pulse = useRef(new Animated.Value(1)).current;
  const blink = useRef(new Animated.Value(1)).current;
  const insets = useSafeAreaInsets();

  // V50.z100 — FAB trascinabile con snap agli edge e persistenza posizione.
  const FAB_SIZE = 56;
  const EDGE_MARGIN = 16;
  const winRef = useRef(Dimensions.get("window"));
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const panOffset = useRef({ x: 0, y: 0 });
  const didDrag = useRef(false);
  const dragStartTs = useRef(0);
  const [posReady, setPosReady] = useState(false);
  // Base bottom (senza offset drag) — ricalcolato per render.
  const tabBarHeight = 60 + Math.max(insets.bottom || 0, 20);
  const baseBottom = tabBarHeight + 12;
  const bottom = present.calculator ? baseBottom + 76 : baseBottom;

  // Carica posizione salvata (solo una volta).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem("axon_fab_pos_v1");
        if (raw && !cancelled) {
          const p = JSON.parse(raw);
          if (typeof p?.x === "number" && typeof p?.y === "number") {
            pan.setValue({ x: p.x, y: p.y });
            panOffset.current = { x: p.x, y: p.y };
          }
        }
      } catch { /* ignore */ }
      if (!cancelled) setPosReady(true);
    })();
    return () => { cancelled = true; };
  }, [pan]);

  // Aggiorna larghezza schermo su rotate.
  useEffect(() => {
    const sub = Dimensions.addEventListener("change", ({ window }) => {
      winRef.current = window;
    });
    return () => { try { (sub as any)?.remove?.(); } catch {} };
  }, []);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 3 || Math.abs(g.dy) > 3,
      onPanResponderGrant: () => {
        didDrag.current = false;
        dragStartTs.current = Date.now();
        pan.setOffset({ x: panOffset.current.x, y: panOffset.current.y });
        pan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: (e, g) => {
        if (Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4) didDrag.current = true;
        Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false })(e, g);
      },
      onPanResponderRelease: async (_e, g) => {
        pan.flattenOffset();
        const win = winRef.current;
        // Coordinate correnti (offset dal punto di ancoraggio bottom-right).
        // Ancoraggio: right = EDGE_MARGIN, bottom = `bottom`
        // dx > 0 sposta a destra; dy > 0 sposta in giù.
        const anchorRight = EDGE_MARGIN;
        const anchorBottom = bottom;

        // Ricava x/y attuali (dai valori .__getValue()).
        const curX = (pan.x as any).__getValue();
        const curY = (pan.y as any).__getValue();

        // Snap orizzontale al bordo più vicino.
        // fabLeftPos in coordinate schermo:
        const fabLeftPos = win.width - anchorRight - FAB_SIZE + curX;
        const centerX = fabLeftPos + FAB_SIZE / 2;
        const snapLeft = centerX < win.width / 2;
        // offsetX target per stare a: sinistra → win.width - anchorRight - FAB_SIZE - EDGE_MARGIN
        //                             destra    → 0
        const targetOffsetX = snapLeft
          ? -(win.width - anchorRight - FAB_SIZE - EDGE_MARGIN * 2)
          : 0;

        // Clamp verticale: non uscire sopra la status bar né sotto il tab bar.
        const maxUpOffset = -(win.height - anchorBottom - FAB_SIZE - Math.max(insets.top || 0, 20));
        const clampedY = Math.min(0, Math.max(maxUpOffset, curY));

        try {
          Animated.parallel([
            Animated.spring(pan.x, { toValue: targetOffsetX, useNativeDriver: false, friction: 7, tension: 60 }),
            Animated.spring(pan.y, { toValue: clampedY, useNativeDriver: false, friction: 7, tension: 60 }),
          ]).start();
        } catch { /* non bloccare il tap se l'animazione fallisce */ }

        panOffset.current = { x: targetOffsetX, y: clampedY };
        try {
          await AsyncStorage.setItem(
            "axon_fab_pos_v1",
            JSON.stringify({ x: targetOffsetX, y: clampedY })
          );
        } catch { /* ignore */ }

        // Se non c'è stato drag significativo → tratta come tap (fallback:
        // il tap principale è gestito dalla Pressable interna, vedi V50.z131).
        if (!didDrag.current && Math.abs(g.dx) < 6 && Math.abs(g.dy) < 6 && (Date.now() - dragStartTs.current) < 500) {
          fireTapRef.current?.();
        }
      },
      onPanResponderTerminationRequest: () => false,
    })
  ).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.08, duration: 1600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1.0, duration: 1600, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  // V50.z83 — Poll info-requests: se ci sono richieste non lette, badge + blink veloce
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const fetchCount = async () => {
      try {
        const r = await api<{ pending: number; unread: number }>("/info-requests/count");
        if (!cancelled) setUnreadInfoReq(r?.unread || 0);
      } catch { /* ignore */ }
    };
    fetchCount();
    const iv = setInterval(fetchCount, 30000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [user]);

  // Blink loop attivo solo quando ci sono unread
  useEffect(() => {
    if (unreadInfoReq > 0) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(blink, { toValue: 0.35, duration: 500, useNativeDriver: true }),
          Animated.timing(blink, { toValue: 1.0, duration: 500, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => { loop.stop(); blink.setValue(1); };
    } else {
      blink.setValue(1);
    }
  }, [unreadInfoReq, blink]);

  // Handler tap FAB (usa ref per evitare closure stale nel PanResponder).
  const handlePress = () => {
    // Se ci sono richieste info non lette, apri prima quella pagina invece del chat modal
    if (unreadInfoReq > 0) {
      router.push("/info-requests" as any);
      return;
    }
    setOpen(true);
  };
  const handlePressRef = useRef(handlePress);
  useEffect(() => { handlePressRef.current = handlePress; });
  // V50.z131 — Tap robusto: la Pressable interna gestisce il tap in modo
  // nativo (indipendente dalla negoziazione del PanResponder, che su alcune
  // schermate con liste lunghe — es. Contatti — non arrivava al release).
  // Il PanResponder resta solo per il drag. Guard anti doppio-fire (400ms).
  const lastTapTs = useRef(0);
  const fireTap = () => {
    const now = Date.now();
    if (now - lastTapTs.current < 400) return;
    lastTapTs.current = now;
    handlePressRef.current?.();
  };
  const fireTapRef = useRef(fireTap);
  useEffect(() => { fireTapRef.current = fireTap; });

  // Hide when not logged in
  if (!user) return null;

  return (
    <>
      <Animated.View
        pointerEvents={posReady ? "box-none" : "none"}
        style={[
          styles.fabWrap,
          {
            bottom,
            // NOTA: qui SOLO valori JS-driven (pan). Se si mescolano con valori
            // useNativeDriver:true (pulse/blink) l'intero transform diventa
            // "native" e la spring del rilascio lancia un'eccezione → il tap
            // non viene mai gestito su Android/iOS.
            transform: [
              { translateX: pan.x },
              { translateY: pan.y },
            ],
          },
        ]}
        {...panResponder.panHandlers}
      >
        <Animated.View
          style={{
            opacity: unreadInfoReq > 0 ? blink : 1,
            transform: [{ scale: pulse }],
          }}
        >
        <Pressable
          style={styles.fab}
          onPress={fireTap}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={unreadInfoReq > 0 ? `Apri richieste info (${unreadInfoReq} nuove) — trascina per spostare` : "Apri assistente AI — trascina per spostare"}
          testID="assistant-fab"
        >
          <Image
            source={AXONOS_LOGO_WHITE}
            style={{ width: 46, height: Math.round(46 / AXONOS_LOGO_HORIZONTAL_ASPECT) }}
            resizeMode="contain"
            testID="assistant-fab-logo"
          />
          <View style={styles.fabDot} />
          {unreadInfoReq > 0 ? (
            <View style={styles.fabBadge} testID="assistant-fab-badge">
              <Text style={styles.fabBadgeTxt}>{unreadInfoReq > 9 ? "9+" : String(unreadInfoReq)}</Text>
            </View>
          ) : null}
        </Pressable>
        </Animated.View>
      </Animated.View>
      <AssistantChatModal visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  // FAB — bottom-right, above tab bar. `bottom` is computed per-render in
  // AssistantFAB from safe-area insets and passed via inline style.
  fabWrap: {
    position: "absolute",
    right: 16,
    zIndex: 999,
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: ASSISTANT_COLOR,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: ASSISTANT_COLOR_DARK,
    shadowOpacity: 0.4,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    elevation: 8,
    borderWidth: 2,
    borderColor: "#FFF",
  },
  fabDot: {
    position: "absolute",
    top: 6,
    right: 8,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#22C55E",
    borderWidth: 2,
    borderColor: "#FFF",
  },
  // V50.z83 — Badge conteggio richieste info non lette
  fabBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    backgroundColor: "#DC2626",
    borderWidth: 2,
    borderColor: "#FFF",
    alignItems: "center",
    justifyContent: "center",
  },
  fabBadgeTxt: { color: "#FFF", fontSize: 11, fontWeight: "900" },

  // Modal
  backdrop: { flex: 1, backgroundColor: "rgba(15, 15, 25, 0.55)" },
  backdropTouch: { flex: 1 },
  sheet: {
    height: "82%",
    backgroundColor: "#FFF",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    overflow: "hidden",
  },
  // V28.v — Drop zone overlay (web-only drag&drop)
  dropOverlay: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(139, 92, 246, 0.88)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 99,
    borderRadius: 22,
    borderWidth: 3,
    borderColor: "#FFF",
    borderStyle: "dashed",
  },
  dropInner: { alignItems: "center", gap: 6 },
  dropTitle: { color: "#FFF", fontSize: 18, fontWeight: "800", letterSpacing: -0.3 },
  dropSub: { color: "rgba(255,255,255,0.85)", fontSize: 12, fontWeight: "600" },
  header: {
    backgroundColor: ASSISTANT_COLOR,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 8,
    flexDirection: "column",
    gap: 6,
  },
  headerActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
  },
  headerModeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.18)",
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: { color: "#FFF", fontSize: 17, fontWeight: "700" },
  headerSub: { color: "rgba(255,255,255,0.85)", fontSize: 12, marginTop: 1 },
  modeDropdown: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 4,
    marginTop: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: "rgba(255,255,255,0.18)",
    borderRadius: 999,
    maxWidth: "100%",
  },
  modeDropdownTxt: { color: "#FFF", fontSize: 11, fontWeight: "700", letterSpacing: 0.1 },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(255,255,255,0.14)",
    justifyContent: "center",
    alignItems: "center",
  },
  headerAction: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: 4,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.14)",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  headerActionTxt: { color: "#FFF", fontSize: 9.5, fontWeight: "700", letterSpacing: 0.1, marginTop: 1 },

  modeMenu: {
    position: "absolute",
    top: 72,
    right: 10,
    backgroundColor: "#FFF",
    borderRadius: 12,
    paddingVertical: 6,
    minWidth: 180,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
    zIndex: 20,
    borderWidth: 1,
    borderColor: "#EDE9FE",
  },
  modeItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  modeItemTxt: { flex: 1, fontSize: 13, color: theme.color.onSurface, fontWeight: "600" },

  chatArea: { flex: 1, backgroundColor: "#FAF9FF" },
  brandBar: {
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#EDE9FE",
  },

  emptyWrap: { alignItems: "center", paddingHorizontal: 20, paddingTop: 10, gap: 6 },
  emptyIcon: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: "#F1EEFF",
    justifyContent: "center",
    alignItems: "center",
  },
  emptyTitle: { fontSize: 18, fontWeight: "700", color: theme.color.onSurface, marginTop: 6 },
  emptySub: { fontSize: 13, color: theme.color.muted, textAlign: "center", lineHeight: 18 },
  suggestWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center", marginTop: 8 },
  suggestChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#F1EEFF",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#E1DAFF",
  },
  suggestTxt: { fontSize: 12, color: ASSISTANT_COLOR_DARK, fontWeight: "600" },

  bubbleRow: { flexDirection: "row", alignItems: "flex-end", gap: 6, marginTop: 4 },
  bubbleAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: ASSISTANT_COLOR,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 4,
  },
  bubble: {
    maxWidth: "82%",
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  bubbleUser: {
    backgroundColor: ASSISTANT_COLOR,
    borderBottomRightRadius: 4,
  },
  bubbleAsst: {
    backgroundColor: "#FFF",
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: "#EBE7FF",
  },
  bubbleWho: { fontSize: 10, fontWeight: "700", color: ASSISTANT_COLOR_DARK, marginBottom: 2 },
  bubbleText: { fontSize: 14, color: theme.color.onSurface, lineHeight: 20 },
  // V29.n — Etichetta compatta per messaggi utente generati da azioni rapide
  quickActionPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  quickActionPillTxt: {
    color: "#FFF",
    fontSize: 12.5,
    fontWeight: "800",
    letterSpacing: 0.3,
    textTransform: "uppercase",
    flexShrink: 1,
  },
  // V29.n — Pulsante "Stop" mostrato durante la generazione
  stopBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    alignSelf: "center",
    marginTop: 6,
    marginBottom: 2,
    backgroundColor: "#DC2626",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    shadowColor: "#DC2626",
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  stopBannerTxt: { color: "#FFF", fontWeight: "800", fontSize: 13, letterSpacing: 0.3 },
  // V38T — Web-search badge + Save-to-Master button + sources
  webBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    backgroundColor: "#E0F2FE",
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  webBadgeTxt: { fontSize: 9, color: "#0369A1", fontWeight: "800", textTransform: "uppercase" },
  // V40 — Semantic cache & streaming badges
  cacheBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    backgroundColor: "#FEF3C7",
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  cacheBadgeTxt: { fontSize: 9, color: "#92400E", fontWeight: "800", textTransform: "uppercase" },
  streamBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    backgroundColor: "#EDE9FE",
    borderRadius: 8,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  // V41 — Feedback thumbs + modal styles
  // V50.z160 — Azioni messaggio
  msgActionsRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 8 },
  msgActionBtn: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 28, paddingHorizontal: 2 },
  msgActionTxt: { fontSize: 11, fontWeight: "700", color: "#64748B" },
  feedbackRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: "#F1F5F9",
  },
  feedbackLbl: {
    fontSize: 11,
    color: "#94A3B8",
    fontWeight: "600",
    marginRight: 2,
  },
  feedbackBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  feedbackBtnUp: {
    backgroundColor: "#DCFCE7",
    borderColor: "#16A34A",
  },
  feedbackBtnDown: {
    backgroundColor: "#FEE2E2",
    borderColor: "#DC2626",
  },
  fbBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.55)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  fbCard: {
    width: "100%",
    maxWidth: 440,
    backgroundColor: "#FFF",
    borderRadius: 20,
    padding: 20,
    gap: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 8,
  },
  fbHeader: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  fbHeaderIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#FEE2E2",
    alignItems: "center",
    justifyContent: "center",
  },
  fbTitle: { fontSize: 16, fontWeight: "800", color: "#0F172A" },
  fbSub: { fontSize: 12, color: "#64748B", marginTop: 2, lineHeight: 16 },
  fbReasonWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  fbReason: {
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "#F8FAFC",
  },
  fbReasonSel: {
    borderColor: "#DC2626",
    backgroundColor: "#DC2626",
  },
  fbReasonTxt: { fontSize: 12, color: "#334155", fontWeight: "600" },
  fbInput: {
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 12,
    padding: 10,
    fontSize: 13,
    color: "#0F172A",
    minHeight: 60,
    maxHeight: 100,
    textAlignVertical: "top",
  },
  fbBtnRow: { flexDirection: "row", gap: 8, justifyContent: "flex-end" },
  fbBtnGhost: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: "#F1F5F9",
  },
  fbBtnGhostTxt: { fontSize: 13, fontWeight: "700", color: "#64748B" },
  fbBtnSubmit: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: "#DC2626",
  },
  fbBtnSubmitTxt: { fontSize: 13, fontWeight: "700", color: "#FFF" },
  saveMasterBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    alignSelf: "flex-start",
    backgroundColor: "#DCFCE7",
    borderColor: "#16A34A",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  saveMasterTxt: { fontSize: 12, color: "#166534", fontWeight: "700" },
  sourcesLbl: { fontSize: 10, color: theme.color.muted, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.3 },
  sourceTxt: { fontSize: 11, color: theme.color.muted },
  qaUpdatedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
  },
  qaUpdatedTxt: {
    fontSize: 10,
    fontWeight: "700",
    color: "#16A34A",
    letterSpacing: 0.2,
  },

  typingBubble: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#FFF",
    borderRadius: 16,
    borderBottomLeftRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#EBE7FF",
    marginTop: 4,
  },
  typingTxt: { fontSize: 12, color: theme.color.muted, fontStyle: "italic" },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: ASSISTANT_COLOR,
  },

  inputBar: {
    // V50.h — Layout a colonne: prima l'input+send (row), poi i bottoni
    // allegato/mic. L'input ora prende la larghezza piena della chat invece
    // di essere spinto tra 5 bottoni fissi.
    flexDirection: "column",
    gap: 8,
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: "#EDE9FE",
    backgroundColor: "#FFF",
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
  },
  actionsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 2,
  },
  micBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  // V28.l — Attach button + preview chips
  attachBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  attRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "#FAF9FF",
    borderTopWidth: 1,
    borderTopColor: "#E1DAFF",
  },
  attChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "#EDE9FE",
    borderWidth: 1,
    borderColor: "#C4B5FD",
    maxWidth: 220,
  },
  attChipTxt: {
    fontSize: 11,
    fontWeight: "700",
    color: "#6D28D9",
    flexShrink: 1,
  },
  input: {
    flex: 1,
    // V50.h — Input più alto e più espandibile per leggere quello che si
    // scrive senza scorrimento verticale forzato. minHeight 44→ tap area
    // comoda; maxHeight 120→220 per riga più lunghe visibili tutte insieme.
    minHeight: 44,
    maxHeight: 220,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#E1DAFF",
    paddingHorizontal: 14,
    paddingTop: Platform.OS === "ios" ? 12 : 10,
    paddingBottom: Platform.OS === "ios" ? 12 : 10,
    backgroundColor: "#FAF9FF",
    fontSize: 15,
    lineHeight: 20,
    color: theme.color.onSurface,
    textAlignVertical: "top",
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: ASSISTANT_COLOR,
    justifyContent: "center",
    alignItems: "center",
  },
  // Conversation panel
  convPanel: {
    backgroundColor: "#FFF",
    borderTopWidth: 1,
    borderTopColor: "#EDE9FE",
    paddingHorizontal: 20,
    paddingVertical: 18,
    alignItems: "center",
    gap: 6,
  },
  convVisual: { alignItems: "center", justifyContent: "center", marginBottom: 4 },
  convOrb: {
    width: 84,
    height: 84,
    borderRadius: 42,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    elevation: 6,
  },
  convLabel: { fontSize: 16, fontWeight: "700", color: theme.color.onSurface, marginTop: 4 },
  convSubLabel: { fontSize: 12, color: theme.color.muted, marginBottom: 10, textAlign: "center" },
  convBtnRow: { flexDirection: "row", gap: 14, marginTop: 4 },
  convBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 24,
    minWidth: 120,
    justifyContent: "center",
  },
  convBtnTxt: { fontSize: 14, fontWeight: "700", color: ASSISTANT_COLOR_DARK },
});

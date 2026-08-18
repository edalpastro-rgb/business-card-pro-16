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
  Platform,
  Animated,
  Easing,
} from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { theme } from "@/src/theme";

const ASSISTANT_COLOR = "#8B5CF6"; // violet — distinct from red mic and blue brand
const ASSISTANT_COLOR_DARK = "#6D28D9";

type ResponseMode = "text" | "voice" | "both";

type ChatMsg = { role: "user" | "assistant"; content: string; created_at?: string };

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
 * Returns a cleanup function.
 */
async function playAudioBase64(b64: string, mime: string = "audio/mpeg"): Promise<() => void> {
  if (Platform.OS === "web") {
    const dataUri = `data:${mime};base64,${b64}`;
    const audio = new Audio(dataUri);
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
    return () => {
      try { player.pause?.(); } catch {}
      try { player.release?.(); } catch {}
    };
  } catch {
    return () => {};
  }
}

export function AssistantChatModal({ visible, onClose }: AssistantChatProps) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [assistantName, setAssistantName] = useState("Neo");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingHist, setLoadingHist] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [recDuration, setRecDuration] = useState(0);
  const [responseMode, setResponseMode] = useState<ResponseMode>("text");
  const [assistantVoice, setAssistantVoice] = useState<string>("nova");
  const [playingIdx, setPlayingIdx] = useState<number | null>(null);
  const [showModeMenu, setShowModeMenu] = useState(false);
  const scrollRef = useRef<ScrollView | null>(null);
  const mrRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<any>(null);
  const durRef = useRef(0);
  const cleanupAudioRef = useRef<(() => void) | null>(null);

  const loadHistory = useCallback(async () => {
    setLoadingHist(true);
    try {
      const [hist, us] = await Promise.all([
        api<{ session_id: string | null; messages: ChatMsg[]; assistant_name: string }>("/assistant/history"),
        api<{ assistant_name?: string; assistant_response_mode?: string; assistant_voice?: string }>("/user-settings").catch(() => ({} as any)),
      ]);
      setAssistantName(hist?.assistant_name || us?.assistant_name || "Neo");
      setSessionId(hist?.session_id || null);
      setMessages(Array.isArray(hist?.messages) ? hist.messages : []);
      const m = (us?.assistant_response_mode || "text") as ResponseMode;
      setResponseMode(MODE_ORDER.includes(m) ? m : "text");
      if (us?.assistant_voice) setAssistantVoice(us.assistant_voice);
    } catch {
      // ignore
    } finally {
      setLoadingHist(false);
    }
  }, []);

  useEffect(() => {
    if (visible) {
      loadHistory();
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
    }
  }, [visible, loadHistory]);

  useEffect(() => {
    // Auto-scroll to bottom on new message
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(t);
  }, [messages.length, sending]);

  const send = async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || sending) return;
    setSending(true);
    setInput("");
    // Optimistic add
    const optimistic: ChatMsg = { role: "user", content: msg, created_at: new Date().toISOString() };
    setMessages((prev) => [...prev, optimistic]);
    try {
      const r = await api<{ session_id: string; reply: string; assistant_name: string }>(
        "/assistant/chat",
        { method: "POST", body: { message: msg, session_id: sessionId || undefined } }
      );
      setSessionId(r.session_id);
      setAssistantName(r.assistant_name || assistantName);
      setMessages((prev) => [
        ...prev,
        { role: "assistant" as const, content: r.reply, created_at: new Date().toISOString() },
      ]);
      // Auto-play voice if mode requires
      if (responseMode === "voice" || responseMode === "both") {
        void speakReply(r.reply);
      }
    } catch (e: any) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `⚠️ Errore: ${e?.message || "Impossibile contattare l'assistente"}`, created_at: new Date().toISOString() },
      ]);
    } finally {
      setSending(false);
    }
  };

  const speakReply = async (text: string, forceIdx?: number) => {
    try {
      // Stop any previous playback
      if (cleanupAudioRef.current) { cleanupAudioRef.current(); cleanupAudioRef.current = null; }
      const targetIdx = typeof forceIdx === "number" ? forceIdx : -1;
      setPlayingIdx(targetIdx);
      const r = await api<{ audio_base64: string; mime: string }>("/assistant/tts", {
        method: "POST",
        body: { text, voice: assistantVoice },
      });
      if (!r?.audio_base64) { setPlayingIdx(null); return; }
      const cleanup = await playAudioBase64(r.audio_base64, r.mime || "audio/mpeg");
      // Estimate duration by resetting after ~ (chars * 60ms) as fallback
      cleanupAudioRef.current = () => { cleanup(); setPlayingIdx(null); };
      // Auto-clear indicator after estimated duration
      const dur = Math.max(2000, Math.min(60000, text.length * 55));
      setTimeout(() => { setPlayingIdx((v) => (v === targetIdx ? null : v)); }, dur);
    } catch {
      setPlayingIdx(null);
    }
  };

  const cycleMode = async () => {
    const idx = MODE_ORDER.indexOf(responseMode);
    const next = MODE_ORDER[(idx + 1) % MODE_ORDER.length];
    setResponseMode(next);
    try {
      await api("/user-settings", { method: "PUT", body: { assistant_response_mode: next } });
    } catch {}
  };

  const setMode = async (m: ResponseMode) => {
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

  // ---- Voice input (web MediaRecorder → /api/ai/transcribe) ----
  const voiceSupported =
    Platform.OS === "web" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices &&
    typeof (globalThis as any).MediaRecorder !== "undefined";

  const startRec = async () => {
    if (!voiceSupported) return;
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

  const suggestions = [
    "Qual è il mio prossimo appuntamento?",
    "Quante telefonate ho fatto oggi?",
    "Clienti senza appuntamento",
    "Ritelefonate urgenti",
  ];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropTouch} onPress={onClose} />
        <View style={styles.sheet}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={{ flex: 1 }}
          >
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.avatarWrap}>
                <MaterialCommunityIcons name="robot-happy" size={22} color="#FFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.headerTitle}>{assistantName}</Text>
                <Text style={styles.headerSub}>{MODE_LABEL[responseMode]}</Text>
              </View>
              <Pressable
                onPress={cycleMode}
                onLongPress={() => setShowModeMenu(true)}
                style={styles.iconBtn}
                accessibilityLabel="Cambia modalità di risposta"
                testID="assistant-mode-toggle"
              >
                <Ionicons name={MODE_ICON[responseMode]} size={20} color="#FFF" />
              </Pressable>
              <Pressable onPress={resetSession} style={styles.iconBtn} accessibilityLabel="Nuova conversazione">
                <Ionicons name="refresh" size={20} color="#FFF" />
              </Pressable>
              <Pressable onPress={onClose} style={styles.iconBtn} accessibilityLabel="Chiudi">
                <Ionicons name="close" size={22} color="#FFF" />
              </Pressable>
            </View>

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
                  <View style={styles.emptyIcon}>
                    <MaterialCommunityIcons name="robot-happy" size={40} color={ASSISTANT_COLOR} />
                  </View>
                  <Text style={styles.emptyTitle}>Ciao, sono {assistantName}!</Text>
                  <Text style={styles.emptySub}>
                    Posso aiutarti con appuntamenti, telefonate, clienti e contratti. Prova a chiedermi:
                  </Text>
                  <View style={styles.suggestWrap}>
                    {suggestions.map((s) => (
                      <Pressable
                        key={s}
                        style={styles.suggestChip}
                        onPress={() => send(s)}
                        disabled={sending}
                      >
                        <Ionicons name="sparkles" size={14} color={ASSISTANT_COLOR_DARK} />
                        <Text style={styles.suggestTxt}>{s}</Text>
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
                />
              ))}
              {sending && (
                <View style={styles.typingBubble}>
                  <TypingDots />
                  <Text style={styles.typingTxt}>{assistantName} sta scrivendo…</Text>
                </View>
              )}
            </ScrollView>

            {/* Input bar */}
            <View style={styles.inputBar}>
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
              <TextInput
                value={recording ? `Ascolto… ${recDuration}s` : input}
                onChangeText={setInput}
                editable={!recording && !transcribing}
                placeholder={`Scrivi a ${assistantName}…`}
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
                disabled={sending || !input.trim()}
                style={[styles.sendBtn, { opacity: sending || !input.trim() ? 0.5 : 1 }]}
                testID="assistant-send"
              >
                {sending ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Ionicons name="arrow-up" size={20} color="#FFF" />
                )}
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </View>
      </View>
    </Modal>
  );
}

function MessageBubble({ msg, assistantName, onPlay, isPlaying }: { msg: ChatMsg; assistantName: string; onPlay?: () => void; isPlaying?: boolean }) {
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
            <Text style={styles.bubbleWho}>{assistantName}</Text>
            {onPlay && (
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
            )}
          </View>
        )}
        <Text style={[styles.bubbleText, isUser && { color: "#FFF" }]}>{msg.content}</Text>
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
  const [open, setOpen] = useState(false);
  const pulse = useRef(new Animated.Value(1)).current;

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

  // Hide when not logged in
  if (!user) return null;

  return (
    <>
      <Animated.View
        pointerEvents="box-none"
        style={[
          styles.fabWrap,
          { transform: [{ scale: pulse }] },
        ]}
      >
        <Pressable
          onPress={() => setOpen(true)}
          style={styles.fab}
          accessibilityLabel="Apri assistente AI"
          testID="assistant-fab"
        >
          <MaterialCommunityIcons name="robot-happy" size={26} color="#FFF" />
          <View style={styles.fabDot} />
        </Pressable>
      </Animated.View>
      <AssistantChatModal visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  // FAB — bottom-right, above tab bar
  fabWrap: {
    position: "absolute",
    right: 16,
    // Sits above bottom tab bar (~56-70px); adjust for insets
    bottom: Platform.select({ ios: 96, android: 88, default: 88 }),
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
  header: {
    backgroundColor: ASSISTANT_COLOR,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
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
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(255,255,255,0.14)",
    justifyContent: "center",
    alignItems: "center",
  },

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

  emptyWrap: { alignItems: "center", paddingHorizontal: 20, paddingTop: 24, gap: 10 },
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
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: "#EDE9FE",
    backgroundColor: "#FFF",
  },
  micBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#E1DAFF",
    paddingHorizontal: 14,
    paddingTop: Platform.OS === "ios" ? 10 : 8,
    paddingBottom: Platform.OS === "ios" ? 10 : 8,
    backgroundColor: "#FAF9FF",
    fontSize: 14,
    color: theme.color.onSurface,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: ASSISTANT_COLOR,
    justifyContent: "center",
    alignItems: "center",
  },
});

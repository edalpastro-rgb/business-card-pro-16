import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, Image, Alert, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAudioRecorder, AudioModule, RecordingPresets, useAudioPlayer } from "expo-audio";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { launchLibraryUniversal, launchCameraUniversal } from "@/src/utils/imagePickerCompat";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { theme } from "@/src/theme";
import { shareDataUri } from "@/src/share";

type Message = {
  message_id: string; channel_id: string; sender_id: string; sender_name: string;
  kind: "text" | "audio" | "photo" | "file" | "link";
  text?: string; audio_base64?: string; audio_mime?: string;
  photo_base64?: string; file_base64?: string; file_name?: string; file_mime?: string; file_size?: number;
  link_url?: string; link_title?: string;
  created_at: string;
};

export default function ChatDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [channel, setChannel] = useState<any>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [playingUri, setPlayingUri] = useState<string | null>(null);
  const listRef = useRef<FlatList>(null);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const player = useAudioPlayer(playingUri);

  const load = useCallback(async () => {
    try {
      const [chs, msgs] = await Promise.all([
        api<{ items: any[] }>("/chat/channels"),
        api<{ items: Message[] }>(`/chat/channels/${id}/messages`, { query: { limit: 200 } }),
      ]);
      const ch = chs.items.find((c: any) => c.channel_id === id);
      setChannel(ch);
      setMessages(msgs.items || []);
    } catch (e) { console.warn(e); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Poll for new messages every 5s
  useEffect(() => {
    const iv = setInterval(async () => {
      try {
        if (messages.length === 0) { load(); return; }
        const last = messages[messages.length - 1].created_at;
        const r = await api<{ items: Message[] }>(`/chat/channels/${id}/messages`, { query: { after: last } });
        if (r.items && r.items.length > 0) {
          setMessages((prev) => [...prev, ...r.items]);
          setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
        }
      } catch {}
    }, 5000);
    return () => clearInterval(iv);
  }, [id, messages, load]);

  useEffect(() => {
    setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 200);
  }, []);

  const send = async (payload: any) => {
    setBusy(true);
    try {
      const m = await api<Message>(`/chat/channels/${id}/messages`, { method: "POST", body: payload });
      setMessages((prev) => [...prev, m]);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (e: any) {
      Alert.alert("Errore", e?.message || "Invio fallito");
    } finally { setBusy(false); }
  };

  const sendText = async () => {
    if (!text.trim()) return;
    const t = text; setText("");
    await send({ kind: "text", text: t });
  };

  const startRec = async () => {
    if (Platform.OS === "web") { Alert.alert("Non disponibile", "Registrazione audio non disponibile su web preview"); return; }
    const { granted } = await AudioModule.requestRecordingPermissionsAsync();
    if (!granted) return;
    await recorder.prepareToRecordAsync();
    recorder.record();
    setRecording(true);
  };
  const stopRec = async () => {
    setRecording(false);
    await recorder.stop();
    const uri = recorder.uri;
    if (!uri) return;
    setBusy(true);
    try {
      const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      await send({ kind: "audio", audio_base64: b64, audio_mime: "audio/m4a" });
    } finally { setBusy(false); }
  };

  const pickPhoto = async (fromCamera: boolean) => {
    const res = fromCamera
      ? await launchCameraUniversal({ quality: 0.5, base64: Platform.OS === "web" })
      : await launchLibraryUniversal({ mediaTypes: "images", quality: 0.5, base64: Platform.OS === "web" });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    let uri: string;
    if (a.uri && a.uri.startsWith("data:")) {
      uri = a.uri;
    } else {
      let b64 = a.base64;
      if (!b64) {
        try { b64 = await FileSystem.readAsStringAsync(a.uri, { encoding: FileSystem.EncodingType.Base64 }); } catch { return; }
      }
      uri = `data:${a.mimeType || "image/jpeg"};base64,${b64}`;
    }
    await send({ kind: "photo", photo_base64: uri });
  };

  const pickFile = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: "*/*", multiple: false, copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.[0]) return;
    const asset = res.assets[0];
    try {
      const b64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      await send({
        kind: "file",
        file_base64: b64,
        file_name: asset.name,
        file_mime: asset.mimeType || "application/octet-stream",
        file_size: asset.size || 0,
      });
    } catch (e) { console.warn(e); }
  };

  const promptLink = async () => {
    let url = "", title = "";
    if (Platform.OS === "web") {
      url = window.prompt("URL", "") || "";
      title = window.prompt("Titolo (opzionale)", "") || "";
    } else {
      url = await new Promise<string>((res) => Alert.prompt?.("Link", "URL", [
        { text: "Annulla", style: "cancel", onPress: () => res("") },
        { text: "OK", onPress: (v?: string) => res(v || "") },
      ], "plain-text") ?? res(""));
    }
    if (!url) return;
    await send({ kind: "link", link_url: url, link_title: title });
  };

  const playAudio = (m: Message) => {
    if (!m.audio_base64) return;
    const uri = `data:${m.audio_mime || "audio/m4a"};base64,${m.audio_base64}`;
    setPlayingUri(uri);
    setTimeout(() => player.play(), 100);
  };

  const shareMessage = async (m: Message) => {
    try {
      if (m.kind === "text") {
        const { shareText } = await import("@/src/share");
        await shareText(m.text || "");
      } else if (m.kind === "link") {
        const { shareText } = await import("@/src/share");
        await shareText(`${m.link_title || ""}\n${m.link_url}`.trim());
      } else if (m.kind === "audio" && m.audio_base64) {
        await shareDataUri(`data:${m.audio_mime || "audio/m4a"};base64,${m.audio_base64}`, `vocale-${m.message_id}.m4a`, m.audio_mime || "audio/m4a");
      } else if (m.kind === "photo" && m.photo_base64) {
        await shareDataUri(m.photo_base64, `foto-${m.message_id}.jpg`, "image/jpeg");
      } else if (m.kind === "file" && m.file_base64) {
        await shareDataUri(`data:${m.file_mime};base64,${m.file_base64}`, m.file_name || `file-${m.message_id}`, m.file_mime || "application/octet-stream");
      }
    } catch (e) { console.warn(e); }
  };

  const channelTitle = channel?.name || (channel?.is_direct ? "Chat diretta" : "Gruppo");

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={theme.color.onSurface} />
        </Pressable>
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Text style={styles.title} numberOfLines={1}>{channelTitle}</Text>
          <Text style={styles.subtitle}>{channel?.member_user_ids?.length || 0} partecipanti</Text>
        </View>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(i) => i.message_id}
          contentContainerStyle={{ padding: 12, gap: 6 }}
          renderItem={({ item }) => {
            const mine = item.sender_id === user?.user_id;
            return (
              <View style={[styles.msgWrap, { alignItems: mine ? "flex-end" : "flex-start" }]}>
                {!mine && <Text style={styles.senderName}>{item.sender_name}</Text>}
                <Pressable
                  onLongPress={() => shareMessage(item)}
                  style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}
                >
                  {item.kind === "text" && <Text style={mine ? styles.txtMine : styles.txtOther}>{item.text}</Text>}
                  {item.kind === "audio" && (
                    <Pressable onPress={() => playAudio(item)} style={styles.audioBtn}>
                      <Ionicons name="play-circle" size={28} color={mine ? "#FFF" : theme.color.brandPrimary} />
                      <Text style={mine ? styles.txtMine : styles.txtOther}>Vocale</Text>
                    </Pressable>
                  )}
                  {item.kind === "photo" && item.photo_base64 && (
                    <Image source={{ uri: item.photo_base64 }} style={styles.msgPhoto} />
                  )}
                  {item.kind === "file" && (
                    <Pressable
                      onPress={async () => {
                        if (!item.file_base64) return;
                        await shareDataUri(`data:${item.file_mime};base64,${item.file_base64}`, item.file_name || "file", item.file_mime || "application/octet-stream");
                      }}
                      style={styles.fileBtn}
                    >
                      <Ionicons name="document" size={22} color={mine ? "#FFF" : theme.color.brandPrimary} />
                      <View style={{ flex: 1 }}>
                        <Text style={[mine ? styles.txtMine : styles.txtOther, { fontWeight: "700" }]} numberOfLines={1}>{item.file_name || "File"}</Text>
                        <Text style={[mine ? styles.txtMine : styles.txtOther, { fontSize: 11, opacity: 0.75 }]}>{Math.round((item.file_size || 0) / 1024)} KB</Text>
                      </View>
                    </Pressable>
                  )}
                  {item.kind === "link" && item.link_url && (
                    <Pressable onPress={() => Linking.openURL(item.link_url!)} style={styles.linkBox}>
                      <Ionicons name="link" size={18} color={mine ? "#FFF" : theme.color.brandPrimary} />
                      <Text style={[mine ? styles.txtMine : styles.txtOther, { fontWeight: "700" }]} numberOfLines={2}>{item.link_title || item.link_url}</Text>
                    </Pressable>
                  )}
                  <Text style={[styles.time, { color: mine ? "rgba(255,255,255,0.7)" : theme.color.muted }]}>
                    {new Date(item.created_at).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}
                  </Text>
                </Pressable>
              </View>
            );
          }}
          ListEmptyComponent={<Text style={styles.empty}>Inizia la conversazione!</Text>}
        />

        <View style={styles.inputBar}>
          <Pressable testID="chat-attach-photo" onPress={() => pickPhoto(false)} style={styles.iconBtn}>
            <Ionicons name="image" size={22} color={theme.color.brandPrimary} />
          </Pressable>
          <Pressable testID="chat-attach-camera" onPress={() => pickPhoto(true)} style={styles.iconBtn}>
            <Ionicons name="camera" size={22} color={theme.color.brandPrimary} />
          </Pressable>
          <Pressable testID="chat-attach-file" onPress={pickFile} style={styles.iconBtn}>
            <Ionicons name="attach" size={22} color={theme.color.brandPrimary} />
          </Pressable>
          <Pressable testID="chat-attach-link" onPress={promptLink} style={styles.iconBtn}>
            <Ionicons name="link" size={22} color={theme.color.brandPrimary} />
          </Pressable>
          <TextInput
            testID="chat-input"
            value={text}
            onChangeText={setText}
            placeholder="Scrivi un messaggio..."
            placeholderTextColor="#94A3B8"
            style={styles.input}
            multiline
            onSubmitEditing={sendText}
          />
          {text.trim() ? (
            <Pressable testID="chat-send" onPress={sendText} disabled={busy} style={styles.sendBtn}>
              {busy ? <ActivityIndicator color="#FFF" size="small" /> : <Ionicons name="send" size={20} color="#FFF" />}
            </Pressable>
          ) : (
            <Pressable testID="chat-rec-toggle" onPress={recording ? stopRec : startRec} style={[styles.sendBtn, { backgroundColor: recording ? theme.color.error : theme.color.warning }]}>
              <Ionicons name={recording ? "stop" : "mic"} size={20} color="#FFF" />
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.color.border, backgroundColor: "#FFF" },
  title: { fontSize: 16, fontWeight: "700", color: theme.color.onSurface },
  subtitle: { fontSize: 11, color: theme.color.muted },
  msgWrap: { marginBottom: 6 },
  senderName: { fontSize: 11, color: theme.color.muted, marginBottom: 2, marginLeft: 6 },
  bubble: { maxWidth: "80%", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, gap: 4 },
  bubbleMine: { backgroundColor: theme.color.brandPrimary, borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: "#FFF", borderWidth: 1, borderColor: theme.color.border, borderBottomLeftRadius: 4 },
  txtMine: { color: "#FFF", fontSize: 14, lineHeight: 20 },
  txtOther: { color: theme.color.onSurface, fontSize: 14, lineHeight: 20 },
  time: { fontSize: 10, alignSelf: "flex-end", marginTop: 2 },
  audioBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 2 },
  msgPhoto: { width: 220, height: 220, borderRadius: 10 },
  fileBtn: { flexDirection: "row", alignItems: "center", gap: 8, minWidth: 200 },
  linkBox: { flexDirection: "row", alignItems: "center", gap: 8 },
  empty: { textAlign: "center", color: theme.color.muted, marginTop: 40, fontStyle: "italic" },
  inputBar: { flexDirection: "row", alignItems: "flex-end", gap: 4, paddingHorizontal: 8, paddingVertical: 8, paddingBottom: Platform.OS === "ios" ? 20 : 8, backgroundColor: "#FFF", borderTopWidth: 1, borderTopColor: theme.color.border },
  iconBtn: { padding: 8 },
  input: { flex: 1, minHeight: 40, maxHeight: 120, backgroundColor: theme.color.surface, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8, color: theme.color.onSurface, borderWidth: 1, borderColor: theme.color.border },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.color.brandPrimary, alignItems: "center", justifyContent: "center" },
});

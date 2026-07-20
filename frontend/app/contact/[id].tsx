import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Linking, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { useAudioRecorder, AudioModule, RecordingPresets, useAudioPlayer } from "expo-audio";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { api } from "@/src/api";
import { theme } from "@/src/theme";

type Note = { id: string; kind: "text" | "audio"; text?: string; audio_base64?: string; audio_mime?: string; created_at: string; duration_ms?: number };
type CFile = { id: string; name: string; mime: string; size: number; created_at: string; data_base64?: string };
type Contact = {
  contact_id: string; first_name: string; last_name: string; phone: string; email: string; address: string;
  area: "energy" | "network"; source: string; referral_note: string; email_note: string; general_note: string;
  notes: Note[]; files: CFile[];
};

export default function ContactDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [c, setC] = useState<Contact | null>(null);
  const [tab, setTab] = useState<"info" | "notes" | "files">("info");
  const [noteText, setNoteText] = useState("");
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [playingUri, setPlayingUri] = useState<string | null>(null);
  const player = useAudioPlayer(playingUri);

  const load = useCallback(async () => setC(await api<Contact>(`/contacts/${id}`)), [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!c) return <SafeAreaView style={styles.root}><ActivityIndicator style={{ marginTop: 40 }} color={theme.color.brandPrimary} /></SafeAreaView>;

  const color = c.area === "energy" ? theme.color.energy : theme.color.network;

  const openWaze = () => {
    if (!c.address) return;
    const url = `https://www.waze.com/ul?q=${encodeURIComponent(c.address)}&navigate=yes`;
    Linking.openURL(url);
  };
  const callPhone = () => { if (c.phone) Linking.openURL(`tel:${c.phone.replace(/\s/g, "")}`); };
  const sendWhatsApp = () => { if (c.phone) Linking.openURL(`https://wa.me/${c.phone.replace(/[^\d+]/g, "")}`); };
  const sendEmail = () => { if (c.email) Linking.openURL(`mailto:${c.email}`); };

  const addTextNote = async () => {
    if (!noteText.trim()) return;
    setBusy(true);
    try {
      await api(`/contacts/${id}/notes`, { method: "POST", body: { kind: "text", text: noteText } });
      setNoteText(""); await load();
    } finally { setBusy(false); }
  };

  const startRecording = async () => {
    if (Platform.OS === "web") { alert("Registrazione audio non disponibile su web preview"); return; }
    const { granted } = await AudioModule.requestRecordingPermissionsAsync();
    if (!granted) return;
    await recorder.prepareToRecordAsync();
    recorder.record();
    setRecording(true);
  };

  const stopRecording = async () => {
    setRecording(false);
    await recorder.stop();
    const uri = recorder.uri;
    if (!uri) return;
    setBusy(true);
    try {
      const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      await api(`/contacts/${id}/notes`, {
        method: "POST",
        body: { kind: "audio", audio_base64: b64, audio_mime: "audio/m4a" },
      });
      await load();
    } catch (e) { console.warn(e); }
    finally { setBusy(false); }
  };

  const playNote = (n: Note) => {
    if (!n.audio_base64) return;
    const uri = `data:${n.audio_mime || "audio/m4a"};base64,${n.audio_base64}`;
    setPlayingUri(uri);
    setTimeout(() => player.play(), 100);
  };

  const deleteNote = async (nid: string) => {
    await api(`/contacts/${id}/notes/${nid}`, { method: "DELETE" });
    load();
  };

  const pickFile = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: ["application/pdf", "image/*"], multiple: false, copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.[0]) return;
    const asset = res.assets[0];
    setBusy(true);
    try {
      const b64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      await api(`/contacts/${id}/files`, {
        method: "POST",
        body: { name: asset.name, mime: asset.mimeType || "application/octet-stream", data_base64: b64, size: asset.size || 0 },
      });
      await load();
    } finally { setBusy(false); }
  };

  const deleteFile = async (fid: string) => {
    await api(`/contacts/${id}/files/${fid}`, { method: "DELETE" });
    load();
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={[styles.header, { backgroundColor: color }]}>
        <Pressable testID="back-btn" onPress={() => router.back()}><Ionicons name="chevron-back" size={26} color="#FFF" /></Pressable>
        <View style={{ flex: 1 }} />
        <Pressable testID="edit-contact" onPress={() => router.push(`/contact/edit/${id}`)}><Ionicons name="create-outline" size={22} color="#FFF" /></Pressable>
      </View>
      <View style={[styles.hero, { backgroundColor: color }]}>
        <View style={styles.avatar}><Text style={styles.avatarTxt}>{c.first_name[0]?.toUpperCase()}{c.last_name[0]?.toUpperCase()}</Text></View>
        <Text style={styles.name}>{c.first_name} {c.last_name}</Text>
        <Text style={styles.areaTag}>{c.area === "energy" ? "Consulente Energetico" : "Networker"} · {c.source === "referral" ? "Referenza" : "Conoscenza"}</Text>
        <View style={styles.actionsRow}>
          {c.phone ? <QuickAct icon="call" label="Chiama" onPress={callPhone} testID="act-call" /> : null}
          {c.phone ? <QuickAct icon="logo-whatsapp" label="WhatsApp" onPress={sendWhatsApp} testID="act-wa" /> : null}
          {c.email ? <QuickAct icon="mail" label="Email" onPress={sendEmail} testID="act-mail" /> : null}
          {c.address ? <QuickAct icon="navigate" label="Waze" onPress={openWaze} testID="act-waze" /> : null}
        </View>
      </View>

      <View style={styles.tabs}>
        {(["info", "notes", "files"] as const).map((t) => (
          <Pressable key={t} testID={`tab-${t}`} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabActive]}>
            <Text style={[styles.tabTxt, tab === t && styles.tabTxtActive]}>{t === "info" ? "Info" : t === "notes" ? "Note" : "File"}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={{ padding: 16 }}>
        {tab === "info" && (
          <View style={styles.card}>
            <InfoRow icon="call-outline" label="Telefono" value={c.phone || "—"} />
            <InfoRow icon="mail-outline" label="Email" value={c.email || "—"} />
            <InfoRow icon="location-outline" label="Indirizzo" value={c.address || "—"} />
            {c.referral_note ? <InfoRow icon="star-outline" label="Nota referenza" value={c.referral_note} /> : null}
            {c.email_note ? <InfoRow icon="chatbox-outline" label="Nota email" value={c.email_note} /> : null}
            {c.general_note ? <InfoRow icon="document-text-outline" label="Note generali" value={c.general_note} /> : null}
          </View>
        )}

        {tab === "notes" && (
          <>
            <View style={styles.card}>
              <TextInput
                testID="note-text-input"
                value={noteText}
                onChangeText={setNoteText}
                placeholder="Scrivi una nota..."
                placeholderTextColor="#94A3B8"
                style={[styles.input, { minHeight: 80, textAlignVertical: "top" }]}
                multiline
              />
              <View style={styles.noteBtnRow}>
                <Pressable testID="note-add-text" onPress={addTextNote} style={styles.smallBtn} disabled={busy}>
                  <Ionicons name="add" size={16} color="#FFF" /><Text style={styles.smallBtnTxt}>Aggiungi</Text>
                </Pressable>
                <Pressable testID="note-record-toggle" onPress={recording ? stopRecording : startRecording} style={[styles.smallBtn, { backgroundColor: recording ? theme.color.error : theme.color.info }]}>
                  <Ionicons name={recording ? "stop" : "mic"} size={16} color="#FFF" /><Text style={styles.smallBtnTxt}>{recording ? "Stop" : "Registra"}</Text>
                </Pressable>
              </View>
            </View>
            {c.notes && c.notes.length > 0 ? c.notes.map((n) => (
              <View key={n.id} style={styles.noteCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.noteMeta}>{n.kind === "audio" ? "🎙 Vocale" : "📝 Testo"} · {new Date(n.created_at).toLocaleString("it-IT")}</Text>
                  {n.kind === "text" ? <Text style={styles.noteTxt}>{n.text}</Text> :
                    <Pressable testID={`play-${n.id}`} onPress={() => playNote(n)} style={styles.playBtn}>
                      <Ionicons name="play" size={16} color={theme.color.brandPrimary} />
                      <Text style={styles.playBtnTxt}>Ascolta</Text>
                    </Pressable>}
                </View>
                <Pressable testID={`del-note-${n.id}`} onPress={() => deleteNote(n.id)}><Ionicons name="trash-outline" size={18} color={theme.color.error} /></Pressable>
              </View>
            )) : <Text style={styles.emptyTxt}>Nessuna nota</Text>}
          </>
        )}

        {tab === "files" && (
          <>
            <Pressable testID="file-add-btn" onPress={pickFile} style={styles.addFileBtn} disabled={busy}>
              <Ionicons name="cloud-upload-outline" size={20} color={theme.color.brandPrimary} />
              <Text style={styles.addFileTxt}>Carica PDF o immagine</Text>
            </Pressable>
            {c.files && c.files.length > 0 ? c.files.map((f) => (
              <View key={f.id} style={styles.fileCard}>
                <Ionicons name={f.mime.startsWith("image/") ? "image-outline" : "document-outline"} size={22} color={theme.color.brandPrimary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.fileName} numberOfLines={1}>{f.name}</Text>
                  <Text style={styles.fileMeta}>{Math.round((f.size || 0) / 1024)} KB · {new Date(f.created_at).toLocaleDateString("it-IT")}</Text>
                </View>
                <Pressable testID={`del-file-${f.id}`} onPress={() => deleteFile(f.id)}><Ionicons name="trash-outline" size={18} color={theme.color.error} /></Pressable>
              </View>
            )) : <Text style={styles.emptyTxt}>Nessun file</Text>}
          </>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function QuickAct({ icon, label, onPress, testID }: any) {
  return (
    <Pressable onPress={onPress} testID={testID} style={styles.quickAct}>
      <Ionicons name={icon} size={18} color="#FFF" />
      <Text style={styles.quickActTxt}>{label}</Text>
    </Pressable>
  );
}

function InfoRow({ icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={18} color={theme.color.brandPrimary} />
      <View style={{ flex: 1 }}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 10 },
  hero: { padding: 20, paddingTop: 4, alignItems: "center" },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: "rgba(255,255,255,0.25)", alignItems: "center", justifyContent: "center", marginBottom: 10 },
  avatarTxt: { color: "#FFF", fontSize: 26, fontWeight: "700" },
  name: { color: "#FFF", fontSize: 22, fontWeight: "700" },
  areaTag: { color: "rgba(255,255,255,0.85)", marginTop: 4, fontSize: 12 },
  actionsRow: { flexDirection: "row", gap: 10, marginTop: 14, flexWrap: "wrap", justifyContent: "center" },
  quickAct: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.2)", paddingHorizontal: 12, paddingVertical: 8, borderRadius: theme.radius.pill },
  quickActTxt: { color: "#FFF", fontWeight: "600", fontSize: 12 },
  tabs: { flexDirection: "row", backgroundColor: "#FFF", borderBottomWidth: 1, borderBottomColor: theme.color.border },
  tab: { flex: 1, paddingVertical: 12, alignItems: "center" },
  tabActive: { borderBottomWidth: 2, borderBottomColor: theme.color.brandPrimary },
  tabTxt: { fontWeight: "600", color: theme.color.muted },
  tabTxtActive: { color: theme.color.brandPrimary },
  card: { backgroundColor: "#FFF", borderRadius: theme.radius.md, padding: 14, borderWidth: 1, borderColor: theme.color.border, gap: 12 },
  infoRow: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  infoLabel: { fontSize: 11, color: theme.color.muted, textTransform: "uppercase", fontWeight: "700" },
  infoValue: { fontSize: 15, color: theme.color.onSurface, marginTop: 2 },
  input: { backgroundColor: theme.color.surface, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border, padding: 10, color: theme.color.onSurface },
  noteBtnRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  smallBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: theme.color.brandPrimary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: theme.radius.pill },
  smallBtnTxt: { color: "#FFF", fontWeight: "700", fontSize: 13 },
  noteCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#FFF", borderRadius: theme.radius.md, padding: 12, borderWidth: 1, borderColor: theme.color.border, marginTop: 8 },
  noteMeta: { fontSize: 11, color: theme.color.muted, marginBottom: 4 },
  noteTxt: { fontSize: 14, color: theme.color.onSurface },
  playBtn: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", backgroundColor: theme.color.brandTertiary, paddingHorizontal: 12, paddingVertical: 6, borderRadius: theme.radius.pill },
  playBtnTxt: { color: theme.color.brandPrimary, fontWeight: "700", fontSize: 12 },
  addFileBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#FFF", padding: 14, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.brandPrimary, borderStyle: "dashed" },
  addFileTxt: { color: theme.color.brandPrimary, fontWeight: "700" },
  fileCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#FFF", borderRadius: theme.radius.md, padding: 12, borderWidth: 1, borderColor: theme.color.border, marginTop: 8 },
  fileName: { fontSize: 14, fontWeight: "600", color: theme.color.onSurface },
  fileMeta: { fontSize: 11, color: theme.color.muted, marginTop: 2 },
  emptyTxt: { textAlign: "center", color: theme.color.muted, marginTop: 20 },
});

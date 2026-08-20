import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, TextInput, Modal, Platform, Animated } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { useAudioRecorder, AudioModule, RecordingPresets } from "expo-audio";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { uriToBase64 } from "@/src/utils/media";
import { notify, confirmAsync } from "@/src/utils/notify";
import { FileViewer } from "@/src/FileViewer";
import { ShareSheet, type ShareTarget } from "@/src/ShareSheet";

type MasterCat = "notes" | "bills" | "audio" | "files" | "analisi";
type MasterFile = {
  file_id: string;
  category: MasterCat;
  name: string;
  title?: string | null;
  body?: string | null;
  mime: string;
  size: number;
  created_at: string;
  updated_at?: string;
};

const CATS: { id: MasterCat; label: string; icon: any; color: string }[] = [
  { id: "notes", label: "Note", icon: "document-text", color: "#7C3AED" },
  { id: "bills", label: "Fatture", icon: "receipt", color: "#EA580C" },
  { id: "analisi", label: "Analisi", icon: "sparkles", color: "#16A34A" },
  { id: "audio", label: "Audio", icon: "mic", color: "#DB2777" },
  { id: "files", label: "File", icon: "folder", color: "#0891B2" },
];

export default function MasterFilesScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<MasterCat>("notes");
  const [items, setItems] = useState<MasterFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [noteEditor, setNoteEditor] = useState<null | { file_id?: string; title: string; body: string }>(null);
  const [viewerOpen, setViewerOpen] = useState<null | { name: string; mime: string; data_base64: string }>(null);
  const [renameTarget, setRenameTarget] = useState<null | { file_id: string; name: string }>(null);
  const [renameInput, setRenameInput] = useState("");
  // V38P — audio recording (client-side parity)
  const [recording, setRecording] = useState(false);
  const [recStart, setRecStart] = useState<number>(0);
  const [, setRecTick] = useState<number>(0);
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const blinkAnim = useRef(new Animated.Value(1)).current;
  // V38P — media source picker for "Foto" button (camera vs gallery)
  const [photoPickerOpen, setPhotoPickerOpen] = useState(false);
  // V38P — pick from Master's own file cabinet when uploading a bill/other
  const [pickFromMaster] = useState(false);
  const [masterPickerItems] = useState<MasterFile[]>([]);
  // V38R — Universal share sheet for master files (across all tabs).
  const [shareTarget, setShareTarget] = useState<ShareTarget | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api<{ items: MasterFile[] }>(`/master-files?category=${tab}`);
      setItems(r.items || []);
    } catch (e: any) {
      notify("Errore caricamento", e?.message || "");
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  // V38P — audio recording lifecycle: blink dot + tick timer while recording
  useEffect(() => {
    if (!recording) {
      blinkAnim.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(blinkAnim, { toValue: 0.3, duration: 500, useNativeDriver: true }),
        Animated.timing(blinkAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      ])
    );
    loop.start();
    const t = setInterval(() => setRecTick((n) => n + 1), 500);
    return () => { loop.stop(); clearInterval(t); };
  }, [recording, blinkAnim]);

  const startRecording = async () => {
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        notify("Permesso microfono negato", "Attiva il microfono nelle impostazioni per registrare audio.");
        return;
      }
      await AudioModule.setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      setRecording(true);
      setRecStart(Date.now());
    } catch (e: any) {
      notify("Errore avvio registrazione", e?.message || "");
    }
  };

  const stopAndSaveRecording = async () => {
    if (!recording) return;
    setBusy(true);
    try {
      await audioRecorder.stop();
      const uri = audioRecorder.uri;
      setRecording(false);
      if (!uri) { notify("Registrazione vuota", ""); return; }
      const b64 = await uriToBase64(uri);
      const bytes = Math.round((b64.length * 3) / 4);
      const durSec = Math.round((Date.now() - recStart) / 1000);
      const nm = `nota-vocale-${new Date().toISOString().replace(/[:.]/g, "-")}.m4a`;
      await api("/master-files", {
        method: "POST",
        body: {
          category: "audio",
          name: nm,
          mime: Platform.OS === "ios" ? "audio/m4a" : "audio/mp4",
          data_base64: b64,
          size: bytes,
        },
      });
      try { await FileSystem.deleteAsync(uri, { idempotent: true }); } catch {}
      await load();
      notify("Audio salvato ✅", `Durata ${durSec}s`);
    } catch (e: any) {
      notify("Errore salvataggio", e?.message || "");
      setRecording(false);
    } finally { setBusy(false); }
  };

  const cancelRecording = async () => {
    try {
      if (recording) {
        try { await audioRecorder.stop(); } catch {}
      }
    } finally {
      setRecording(false);
    }
  };

  // --- Notes ---
  const openNewNote = () => setNoteEditor({ title: "", body: "" });
  const openEditNote = (n: MasterFile) => setNoteEditor({ file_id: n.file_id, title: n.title || n.name || "", body: n.body || "" });
  const saveNote = async () => {
    if (!noteEditor) return;
    const t = noteEditor.title.trim();
    const b = noteEditor.body.trim();
    if (!t && !b) { notify("Nota vuota", "Inserisci un titolo o del contenuto."); return; }
    setBusy(true);
    try {
      if (noteEditor.file_id) {
        await api(`/master-files/${noteEditor.file_id}`, {
          method: "PATCH",
          body: { title: t, body: b, name: t || "Nota" },
        });
      } else {
        await api("/master-files", {
          method: "POST",
          body: { category: "notes", title: t, body: b, name: t || "Nota", mime: "text/markdown" },
        });
      }
      setNoteEditor(null);
      await load();
    } catch (e: any) {
      notify("Errore", e?.message || "");
    } finally { setBusy(false); }
  };

  // --- File upload (bills, files, audio) ---
  const uploadFile = async (category: MasterCat) => {
    setBusy(true);
    try {
      let asset: { uri: string; name?: string; mimeType?: string } | null = null;
      if (category === "audio") {
        const res = await DocumentPicker.getDocumentAsync({ type: "audio/*", multiple: false, copyToCacheDirectory: true });
        if (res.canceled || !res.assets?.[0]) { setBusy(false); return; }
        asset = res.assets[0];
      } else if (category === "bills") {
        const res = await DocumentPicker.getDocumentAsync({ type: "application/pdf", multiple: false, copyToCacheDirectory: true });
        if (res.canceled || !res.assets?.[0]) { setBusy(false); return; }
        asset = res.assets[0];
      } else {
        // V38Q — generic files: expose ONLY document types (no image/* so
        // Android doesn't route the user into the Photos picker). Images and
        // video go through the "Foto" button. Client-side parity.
        const res = await DocumentPicker.getDocumentAsync({
          type: [
            "application/pdf",
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/vnd.ms-excel",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/vnd.ms-powerpoint",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "application/vnd.oasis.opendocument.text",
            "application/vnd.oasis.opendocument.spreadsheet",
            "text/plain",
            "text/csv",
            "text/markdown",
            "text/rtf",
            "application/rtf",
            "application/zip",
            "application/x-zip-compressed",
            "application/json",
          ],
          multiple: false,
          copyToCacheDirectory: true,
        });
        if (res.canceled || !res.assets?.[0]) { setBusy(false); return; }
        asset = res.assets[0];
      }
      const b64 = await uriToBase64(asset.uri);
      const bytes = Math.round((b64.length * 3) / 4);
      if (bytes > 20 * 1024 * 1024) { notify("File troppo grande", "Max 20 MB."); setBusy(false); return; }
      await api("/master-files", {
        method: "POST",
        body: {
          category,
          name: asset.name || `file-${Date.now()}`,
          mime: asset.mimeType || "application/octet-stream",
          data_base64: b64,
          size: bytes,
        },
      });
      await load();
    } catch (e: any) {
      notify("Errore caricamento", e?.message || "");
    } finally { setBusy(false); }
  };

  // V38P — "Foto" flow: bottom sheet with 4 options (Scatta foto, Registra
  // video, Scegli foto, Scegli video) — matching client-side.
  const openPhotoPicker = () => setPhotoPickerOpen(true);
  const runMediaPicker = async (kind: "camera-photo" | "camera-video" | "library-photo" | "library-video") => {
    setPhotoPickerOpen(false);
    setBusy(true);
    try {
      let res: any;
      if (kind === "camera-photo" || kind === "camera-video") {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) { setBusy(false); notify("Permesso camera negato", ""); return; }
        res = await ImagePicker.launchCameraAsync({
          mediaTypes: kind === "camera-photo" ? ImagePicker.MediaTypeOptions.Images : ImagePicker.MediaTypeOptions.Videos,
          quality: 0.85,
          allowsEditing: false,
        });
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) { setBusy(false); notify("Permesso galleria negato", ""); return; }
        res = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: kind === "library-photo" ? ImagePicker.MediaTypeOptions.Images : ImagePicker.MediaTypeOptions.Videos,
          quality: 0.85,
          allowsEditing: false,
        });
      }
      if (res.canceled || !res.assets?.[0]?.uri) { setBusy(false); return; }
      const a = res.assets[0];
      const b64 = await uriToBase64(a.uri);
      const bytes = Math.round((b64.length * 3) / 4);
      if (bytes > 20 * 1024 * 1024) { notify("File troppo grande", "Max 20 MB."); setBusy(false); return; }
      const isVideo = kind.endsWith("video");
      await api("/master-files", {
        method: "POST",
        body: {
          category: "files",
          name: a.fileName || (isVideo ? `video-${Date.now()}.mp4` : `foto-${Date.now()}.jpg`),
          mime: a.mimeType || (isVideo ? "video/mp4" : "image/jpeg"),
          data_base64: b64,
          size: bytes,
        },
      });
      await load();
    } catch (e: any) {
      notify("Errore", e?.message || "");
    } finally { setBusy(false); }
  };

  // V38P — legacy alias kept to preserve `uploadImage` reference if anything
  // else depended on it. Now delegates to the new picker.
  const uploadImage = () => openPhotoPicker();
  void uploadImage;

  // Save a recorded audio blob into master files (used by the Master's global
  // audio recorder — legacy hook, currently unused but kept for future wiring).
  const _saveRecordedAudio = async (audio: { uri: string; mimeType?: string; fileName?: string; durationMs?: number }) => {
    setBusy(true);
    try {
      const b64 = await uriToBase64(audio.uri);
      const bytes = Math.round((b64.length * 3) / 4);
      const nm = audio.fileName || `audio-${Date.now()}.m4a`;
      await api("/master-files", {
        method: "POST",
        body: { category: "audio", name: nm, mime: audio.mimeType || "audio/m4a", data_base64: b64, size: bytes },
      });
      await load();
    } catch (e: any) {
      notify("Errore salvataggio audio", e?.message || "");
    } finally { setBusy(false); }
  };
  void _saveRecordedAudio; // silence unused-variable lint

  const openViewer = async (f: MasterFile) => {
    setBusy(true);
    try {
      const full = await api<MasterFile & { data_base64: string }>(`/master-files/${f.file_id}`);
      if (!full.data_base64) { notify("File vuoto", ""); return; }
      setViewerOpen({ name: f.name, mime: f.mime, data_base64: full.data_base64 });
    } catch (e: any) {
      notify("Errore", e?.message || "");
    } finally { setBusy(false); }
  };

  // V38R — Open the universal ShareSheet for any master file (all tabs).
  const openShare = async (f: MasterFile) => {
    setBusy(true);
    try {
      const full = await api<MasterFile & { data_base64: string }>(`/master-files/${f.file_id}`);
      setShareTarget({
        id: f.file_id,
        name: f.name,
        mime: f.mime,
        data_base64: full.data_base64 || "",
        masterFileId: f.file_id,
      });
    } catch (e: any) {
      notify("Errore", e?.message || "");
    } finally { setBusy(false); }
  };

  // V38R — Format created_at with BOTH date and time (dd/mm/YYYY HH:MM)
  const fmtDateTime = (iso: string) => {
    try {
      const d = new Date(iso);
      const dd = String(d.getDate()).padStart(2, "0");
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const yy = d.getFullYear();
      const hh = String(d.getHours()).padStart(2, "0");
      const mn = String(d.getMinutes()).padStart(2, "0");
      return `${dd}/${mm}/${yy} · ${hh}:${mn}`;
    } catch { return iso; }
  };

  const removeItem = async (f: MasterFile) => {
    const ok = await confirmAsync(f.category === "notes" ? "Elimina nota" : "Elimina file", "Sei sicuro?");
    if (!ok) return;
    try {
      await api(`/master-files/${f.file_id}`, { method: "DELETE" });
      await load();
    } catch (e: any) { notify("Errore", e?.message || ""); }
  };

  const openRename = (f: MasterFile) => {
    setRenameTarget({ file_id: f.file_id, name: f.name });
    setRenameInput(f.name);
  };
  const commitRename = async () => {
    if (!renameTarget) return;
    const nm = renameInput.trim();
    if (!nm) return;
    setBusy(true);
    try {
      await api(`/master-files/${renameTarget.file_id}`, { method: "PATCH", body: { name: nm } });
      setRenameTarget(null);
      await load();
    } catch (e: any) { notify("Errore", e?.message || ""); }
    finally { setBusy(false); }
  };

  const catMeta = CATS.find((c) => c.id === tab)!;

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable testID="master-files-back" onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.title}>I miei file</Text>
        <View style={{ width: 26 }} />
      </View>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        {CATS.map((c) => {
          const active = c.id === tab;
          return (
            <Pressable
              key={c.id}
              testID={`master-files-tab-${c.id}`}
              onPress={() => setTab(c.id)}
              style={[styles.tabBtn, active && { backgroundColor: c.color, borderColor: c.color }]}
            >
              <Ionicons name={c.icon} size={18} color={active ? "#FFF" : c.color} />
              <Text style={[styles.tabTxt, active && { color: "#FFF" }]}>{c.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* Add controls */}
      <View style={styles.addBar}>
        {tab === "notes" && (
          <Pressable testID="master-files-add-note" onPress={openNewNote} style={[styles.addBtn, { backgroundColor: catMeta.color }]}>
            <Ionicons name="add" size={18} color="#FFF" />
            <Text style={styles.addTxt}>Nuova nota</Text>
          </Pressable>
        )}
        {tab === "bills" && (
          <Pressable testID="master-files-add-bill" onPress={() => uploadFile("bills")} disabled={busy} style={[styles.addBtn, { backgroundColor: catMeta.color, opacity: busy ? 0.5 : 1 }]}>
            <Ionicons name="cloud-upload" size={18} color="#FFF" />
            <Text style={styles.addTxt}>Carica PDF fattura</Text>
          </Pressable>
        )}
        {tab === "audio" && (
          <View style={{ flex: 1, gap: 8 }}>
            {/* V38P — Blinking REC button (client-side parity) */}
            {recording ? (
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable
                  testID="master-files-stop-recording"
                  onPress={stopAndSaveRecording}
                  disabled={busy}
                  style={[styles.addBtn, { backgroundColor: "#16A34A", flex: 1, opacity: busy ? 0.5 : 1 }]}
                >
                  <Ionicons name="stop-circle" size={20} color="#FFF" />
                  <Text style={styles.addTxt}>Stop & Salva ({Math.floor((Date.now() - recStart) / 1000)}s)</Text>
                </Pressable>
                <Pressable
                  testID="master-files-cancel-recording"
                  onPress={cancelRecording}
                  style={[styles.addBtn, { backgroundColor: "#78716C", paddingHorizontal: 14, flex: 0 }]}
                >
                  <Ionicons name="close" size={18} color="#FFF" />
                </Pressable>
                {/* Blinking indicator */}
                <View style={{ position: "absolute", left: 12, top: -3 }}>
                  <Animated.View style={[styles.recDot, { opacity: blinkAnim }]} />
                </View>
              </View>
            ) : (
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable
                  testID="master-files-record-audio"
                  onPress={startRecording}
                  disabled={busy}
                  style={[styles.addBtn, { backgroundColor: "#DC2626", flex: 1, opacity: busy ? 0.5 : 1 }]}
                >
                  <Ionicons name="mic" size={20} color="#FFF" />
                  <Text style={styles.addTxt}>REC</Text>
                </Pressable>
                <Pressable
                  testID="master-files-add-audio"
                  onPress={() => uploadFile("audio")}
                  disabled={busy}
                  style={[styles.addBtn, { backgroundColor: catMeta.color, flex: 1, opacity: busy ? 0.5 : 1 }]}
                >
                  <Ionicons name="cloud-upload" size={18} color="#FFF" />
                  <Text style={styles.addTxt}>Carica audio</Text>
                </Pressable>
              </View>
            )}
          </View>
        )}
        {tab === "analisi" && (
          <View style={[styles.addBtn, { backgroundColor: catMeta.color + "22", borderWidth: 1, borderColor: catMeta.color + "44", borderStyle: "dashed" }]}>
            <Ionicons name="sparkles" size={18} color={catMeta.color} />
            <Text style={[styles.addTxt, { color: catMeta.color }]}>Generate automaticamente dalle bollette</Text>
          </View>
        )}
        {tab === "files" && (
          <View style={{ flexDirection: "row", gap: 8, flex: 1 }}>
            <Pressable testID="master-files-add-file" onPress={() => uploadFile("files")} disabled={busy} style={[styles.addBtn, { backgroundColor: catMeta.color, flex: 1, opacity: busy ? 0.5 : 1 }]}>
              <Ionicons name="document" size={18} color="#FFF" />
              <Text style={styles.addTxt}>Carica file</Text>
            </Pressable>
            <Pressable testID="master-files-add-image" onPress={openPhotoPicker} disabled={busy} style={[styles.addBtn, { backgroundColor: "#16A34A", flex: 1, opacity: busy ? 0.5 : 1 }]}>
              <Ionicons name="camera" size={18} color="#FFF" />
              <Text style={styles.addTxt}>Foto</Text>
            </Pressable>
          </View>
        )}
      </View>

      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 60 }}>
        {loading ? (
          <ActivityIndicator style={{ marginTop: 30 }} color={catMeta.color} />
        ) : items.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name={catMeta.icon} size={40} color={theme.color.muted} />
            <Text style={styles.emptyTxt}>
              {tab === "notes" ? "Nessuna nota. Tocca 'Nuova nota' per iniziare." :
                tab === "bills" ? "Nessuna fattura salvata." :
                tab === "audio" ? "Nessun audio registrato o caricato." :
                "Nessun file. Carica documenti o foto."}
            </Text>
          </View>
        ) : (
          items.map((f) => (
            <View key={f.file_id} style={styles.card}>
              <Pressable
                testID={`master-files-item-${f.file_id}`}
                onPress={() => tab === "notes" ? openEditNote(f) : openViewer(f)}
                style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10, padding: 12 }}
              >
                <View style={[styles.icoBox, { backgroundColor: catMeta.color + "22" }]}>
                  <Ionicons name={catMeta.icon} size={20} color={catMeta.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName} numberOfLines={1}>
                    {tab === "notes" ? (f.title || f.name || "Nota") : f.name}
                  </Text>
                  <Text style={styles.itemMeta} numberOfLines={1}>
                    {tab === "notes"
                      ? `${(f.body || "").slice(0, 60)} · ${fmtDateTime(f.created_at)}`
                      : `${formatSize(f.size)} · ${fmtDateTime(f.created_at)}`}
                  </Text>
                </View>
              </Pressable>
              <View style={{ flexDirection: "row", gap: 4, paddingRight: 8 }}>
                {tab !== "notes" && (
                  <Pressable
                    testID={`master-files-share-${f.file_id}`}
                    onPress={() => openShare(f)}
                    hitSlop={8}
                    style={styles.iconBtn}
                  >
                    <Ionicons name="share-social" size={14} color={catMeta.color} />
                  </Pressable>
                )}
                {tab !== "notes" && (
                  <Pressable
                    testID={`master-files-rename-${f.file_id}`}
                    onPress={() => openRename(f)}
                    hitSlop={8}
                    style={styles.iconBtn}
                  >
                    <Ionicons name="pencil" size={14} color={theme.color.muted} />
                  </Pressable>
                )}
                <Pressable
                  testID={`master-files-del-${f.file_id}`}
                  onPress={() => removeItem(f)}
                  hitSlop={8}
                  style={styles.iconBtn}
                >
                  <Ionicons name="trash" size={14} color="#DC2626" />
                </Pressable>
              </View>
            </View>
          ))
        )}
      </ScrollView>

      {/* Note editor modal */}
      <Modal visible={!!noteEditor} animationType="slide" transparent onRequestClose={() => setNoteEditor(null)}>
        <View style={styles.modalBack}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{noteEditor?.file_id ? "Modifica nota" : "Nuova nota"}</Text>
            <TextInput
              testID="master-note-title"
              value={noteEditor?.title || ""}
              onChangeText={(v) => setNoteEditor((n) => n ? { ...n, title: v } : n)}
              placeholder="Titolo"
              placeholderTextColor="#94A3B8"
              style={[styles.noteInput, { fontSize: 15, fontWeight: "700" }]}
            />
            <TextInput
              testID="master-note-body"
              value={noteEditor?.body || ""}
              onChangeText={(v) => setNoteEditor((n) => n ? { ...n, body: v } : n)}
              placeholder="Contenuto della nota…"
              placeholderTextColor="#94A3B8"
              multiline
              style={[styles.noteInput, { minHeight: 220, textAlignVertical: "top" }]}
            />
            <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
              <Pressable
                testID="master-note-cancel"
                onPress={() => setNoteEditor(null)}
                style={[styles.modalBtn, { backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border }]}
              >
                <Text style={{ color: theme.color.onSurface, fontWeight: "700" }}>Annulla</Text>
              </Pressable>
              <Pressable
                testID="master-note-save"
                onPress={saveNote}
                disabled={busy}
                style={[styles.modalBtn, { backgroundColor: "#7C3AED", opacity: busy ? 0.5 : 1 }]}
              >
                {busy ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={{ color: "#FFF", fontWeight: "700" }}>Salva</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Rename modal */}
      <Modal visible={!!renameTarget} animationType="fade" transparent onRequestClose={() => setRenameTarget(null)}>
        <View style={styles.modalBack}>
          <View style={[styles.modalCard, { padding: 20 }]}>
            <Text style={styles.modalTitle}>Rinomina file</Text>
            <TextInput
              testID="master-rename-input"
              value={renameInput}
              onChangeText={setRenameInput}
              placeholder="Nome file"
              placeholderTextColor="#94A3B8"
              style={styles.noteInput}
            />
            <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
              <Pressable onPress={() => setRenameTarget(null)} style={[styles.modalBtn, { backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border }]}>
                <Text style={{ color: theme.color.onSurface, fontWeight: "700" }}>Annulla</Text>
              </Pressable>
              <Pressable
                testID="master-rename-save"
                onPress={commitRename}
                disabled={busy}
                style={[styles.modalBtn, { backgroundColor: theme.color.brandPrimary, opacity: busy ? 0.5 : 1 }]}
              >
                <Text style={{ color: "#FFF", fontWeight: "700" }}>Salva</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* File viewer */}
      <FileViewer
        visible={!!viewerOpen}
        onClose={() => setViewerOpen(null)}
        fileName={viewerOpen?.name || ""}
        mime={viewerOpen?.mime || ""}
        dataBase64={viewerOpen?.data_base64 || ""}
        onShare={viewerOpen ? () => {
          const v = viewerOpen;
          setViewerOpen(null);
          setShareTarget({
            id: (items.find((f) => f.name === v.name)?.file_id) || v.name,
            name: v.name,
            mime: v.mime,
            data_base64: v.data_base64,
            masterFileId: items.find((f) => f.name === v.name)?.file_id,
          });
        } : undefined}
      />

      {/* V38R — Universal share sheet for any master file */}
      <ShareSheet
        visible={!!shareTarget}
        target={shareTarget}
        onClose={() => setShareTarget(null)}
      />

      {/* V38P — Photo picker bottom sheet (Foto button) */}
      <Modal visible={photoPickerOpen} animationType="slide" transparent onRequestClose={() => setPhotoPickerOpen(false)}>
        <Pressable style={styles.modalBack} onPress={() => setPhotoPickerOpen(false)}>
          <Pressable style={styles.sheetCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Aggiungi foto o video</Text>
            <View style={{ gap: 8, marginTop: 8 }}>
              <Pressable testID="mf-photo-camera" onPress={() => runMediaPicker("camera-photo")} style={[styles.sheetBtn, { backgroundColor: "#7C3AED" }]}>
                <Ionicons name="camera" size={18} color="#FFF" />
                <Text style={styles.sheetTxt}>Scatta foto</Text>
              </Pressable>
              <Pressable testID="mf-video-camera" onPress={() => runMediaPicker("camera-video")} style={[styles.sheetBtn, { backgroundColor: "#DB2777" }]}>
                <Ionicons name="videocam" size={18} color="#FFF" />
                <Text style={styles.sheetTxt}>Registra video</Text>
              </Pressable>
              <Pressable testID="mf-photo-library" onPress={() => runMediaPicker("library-photo")} style={[styles.sheetBtn, { backgroundColor: "#0891B2" }]}>
                <Ionicons name="images" size={18} color="#FFF" />
                <Text style={styles.sheetTxt}>Scegli foto dalla galleria</Text>
              </Pressable>
              <Pressable testID="mf-video-library" onPress={() => runMediaPicker("library-video")} style={[styles.sheetBtn, { backgroundColor: "#16A34A" }]}>
                <Ionicons name="film" size={18} color="#FFF" />
                <Text style={styles.sheetTxt}>Scegli video dalla galleria</Text>
              </Pressable>
              <Pressable onPress={() => setPhotoPickerOpen(false)} style={[styles.sheetBtn, { backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border }]}>
                <Text style={{ color: theme.color.onSurface, fontWeight: "700" }}>Annulla</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* V38P — Master file picker (used from bill-quick to pick a bill
          without re-uploading). Not directly used inside this screen but the
          state + list is here so it can be reused by other screens later. */}
      {pickFromMaster && masterPickerItems.length === 0 ? null : null}
    </SafeAreaView>
  );
}

function formatSize(bytes: number): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.color.border, backgroundColor: theme.color.surface },
  title: { fontSize: 18, fontWeight: "800", color: theme.color.onSurface },
  tabBar: { flexDirection: "row", gap: 6, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 6 },
  tabBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 10, borderRadius: 10, backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border },
  tabTxt: { fontSize: 12, fontWeight: "700", color: theme.color.onSurface },
  addBar: { paddingHorizontal: 12, paddingVertical: 8, flexDirection: "row" },
  addBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: 10, flex: 1 },
  addTxt: { color: "#FFF", fontWeight: "700", fontSize: 13 },
  emptyCard: { alignItems: "center", padding: 32, backgroundColor: theme.color.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.color.border, borderStyle: "dashed" },
  emptyTxt: { color: theme.color.muted, fontSize: 13, textAlign: "center", marginTop: 10, maxWidth: 300 },
  card: { backgroundColor: theme.color.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.color.border, marginBottom: 8, flexDirection: "row", alignItems: "center", overflow: "hidden" },
  icoBox: { width: 40, height: 40, borderRadius: 20, justifyContent: "center", alignItems: "center" },
  itemName: { fontSize: 14, fontWeight: "700", color: theme.color.onSurface },
  itemMeta: { fontSize: 11, color: theme.color.muted, marginTop: 2 },
  iconBtn: { padding: 8, borderRadius: 6 },
  modalBack: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: theme.color.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: "88%" },
  modalTitle: { fontSize: 18, fontWeight: "800", color: theme.color.onSurface, marginBottom: 12 },
  modalBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: "center" },
  noteInput: { backgroundColor: "#F1F5F9", borderRadius: 8, paddingHorizontal: 10, paddingVertical: Platform.OS === "ios" ? 10 : 8, fontSize: 13, color: theme.color.onSurface, marginTop: 6 },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#DC2626" },
  sheetCard: { backgroundColor: theme.color.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  sheetBtn: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 14, borderRadius: 10, justifyContent: "flex-start" },
  sheetTxt: { color: "#FFF", fontWeight: "700", fontSize: 14 },
});

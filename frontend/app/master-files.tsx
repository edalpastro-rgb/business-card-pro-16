import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, TextInput, Modal, Platform, Animated } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { launchLibraryUniversal, launchCameraUniversal } from "@/src/utils/imagePickerCompat";
import * as FileSystem from "expo-file-system/legacy";
import { useAudioRecorder, AudioModule, RecordingPresets } from "expo-audio";
import { useRouter, useLocalSearchParams } from "expo-router";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { uploadMasterFile } from "@/src/utils/upload"; // V50.z202 — multipart a chunk, niente base64
import { notify, confirmAsync } from "@/src/utils/notify";
import { FileViewer } from "@/src/FileViewer";
import { ShareSheet, type ShareTarget } from "@/src/ShareSheet";
import { ModuleErrorBoundary } from "@/src/shared";

import { useBottomSheetPadding } from "@/src/utils/bottomSheetInsets";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium
type MasterCat = "notes" | "bills" | "audio" | "files" | "analisi" | "scanner" | "neo_prompts";
type MasterFile = {
  file_id: string;
  category: MasterCat;
  name: string;
  text_hash?: string | null; // V50.z246 — presente se il documento ha testo OCR
  ocr_excerpt?: string; // V50.z246 — estratto attorno alla parola cercata
  title?: string | null;
  body?: string | null;
  neo_status?: string; neo_note?: string; neo_seq?: number; // V50.z239
  mime: string;
  size: number;
  created_at: string;
  updated_at?: string;
  source?: string | null;
  source_contact_id?: string | null;
};

const CATS: { id: MasterCat; label: string; icon: any; color: string }[] = [
  { id: "notes", label: "Note", icon: "document-text", color: "#7C3AED" },
  { id: "bills", label: "Fatture", icon: "receipt", color: "#EA580C" },
  { id: "analisi", label: "Analisi", icon: "sparkles", color: "#16A34A" },
  { id: "audio", label: "Audio", icon: "mic", color: "#DB2777" },
  { id: "files", label: "File", icon: "folder", color: "#0891B2" },
  { id: "scanner", label: "Scanner", icon: "scan", color: "#DC2626" }, // V50.z226 — PDF creati dallo scanner
  { id: "neo_prompts", label: "Prompt per Neo", icon: "code-slash", color: "#0F766E" }, // V50.z239 — coda prompt autorizzati per l'agente di sviluppo
];
const NEO_STATUS_LABEL: Record<string, { label: string; color: string }> = {
  pending: { label: "In attesa", color: HT.warning }, read: { label: "Letto da Neo", color: HT.axon }, done: { label: "Completato", color: HT.success }, rejected: { label: "Non eseguibile", color: HT.danger },
};
const CAT_IDS = CATS.map((c) => c.id);

export default function MasterFilesRoute() {
  return (
    <ModuleErrorBoundary moduleName="master">
      <MasterFilesScreen />
    </ModuleErrorBoundary>
  );
}

function MasterFilesScreen() {
  const router = useRouter();
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<MasterCat>(CAT_IDS.includes(tabParam as MasterCat) ? (tabParam as MasterCat) : "notes");
  const bottomPad = useBottomSheetPadding();
  const [items, setItems] = useState<MasterFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // V50.z226 — Controllo duplicati (nome + dimensione identici) → popup Sostituisci / Tieni entrambi
  const [dupPrompt, setDupPrompt] = useState<null | { existing: { file_id: string; name: string }; resolve: (choice: "replace" | "keep" | "cancel") => void }>(null);
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

  // V50.z246 — Ricerca nel TESTO OCR (Tesseract locale) delle scansioni: `q` cerca su nome, titolo e contenuto
  const [query, setQuery] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api<{ items: MasterFile[] }>(`/master-files?category=${tab}${query.trim() ? `&q=${encodeURIComponent(query.trim())}` : ""}`);
      setItems(r.items || []);
    } catch (e: any) {
      notify("Errore caricamento", e?.message || "");
    } finally {
      setLoading(false);
    }
  }, [tab, query]);

  useEffect(() => { const t = setTimeout(() => { void load(); }, query ? 350 : 0); return () => clearTimeout(t); }, [load, query]);

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
      const durSec = Math.round((Date.now() - recStart) / 1000);
      const nm = `nota-vocale-${new Date().toISOString().replace(/[:.]/g, "-")}.m4a`;
      await uploadMasterFile({ uri, name: nm, mime: Platform.OS === "ios" ? "audio/m4a" : "audio/mp4" }, "audio");
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
  /**
   * V50.z226 — Upload con controllo duplicati: se esiste già un file con stesso nome e stessa dimensione
   * chiede «Sostituisci» (elimina il vecchio) o «Tieni entrambi» (nuovo nome con suffisso « (2)»).
   */
  const uploadWithDupCheck = async (src: { uri: string; name: string; mime: string }, size: number | undefined, category: MasterCat) => {
    let name = src.name;
    if (size && size > 0) {
      try {
        const chk = await api<{ duplicate: boolean; file: { file_id: string; name: string } | null }>(`/master-files/duplicate?name=${encodeURIComponent(name)}&size=${size}&category=${category}`);
        if (chk.duplicate && chk.file) {
          const existing = chk.file;
          const choice = await new Promise<"replace" | "keep" | "cancel">((resolve) => setDupPrompt({ existing, resolve }));
          setDupPrompt(null);
          if (choice === "cancel") return false;
          if (choice === "replace") await api(`/master-files/${existing.file_id}`, { method: "DELETE" });
          if (choice === "keep") {
            const m = name.match(/^(.*?)(\.[A-Za-z0-9]{1,6})?$/);
            name = `${m?.[1] || name} (2)${m?.[2] || ""}`;
          }
        }
      } catch { /* controllo non disponibile → carica normalmente */ }
    }
    await uploadMasterFile({ uri: src.uri, name, mime: src.mime }, category as any);
    return true;
  };

  const uploadFile = async (category: MasterCat) => {
    setBusy(true);
    try {
      let asset: { uri: string; name?: string; mimeType?: string; size?: number } | null = null;
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
      if ((asset.size || 0) > 50 * 1024 * 1024) { notify("File troppo grande", "Max 50 MB."); setBusy(false); return; }
      await uploadWithDupCheck({ uri: asset.uri, name: asset.name || `file-${Date.now()}`, mime: asset.mimeType || "application/octet-stream" }, asset.size, category);
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
        res = await launchCameraUniversal({
          mediaTypes: kind === "camera-photo" ? "images" : "videos",
          quality: 0.85,
          allowsEditing: false,
        });
        if (res.canceled) { setBusy(false); return; }
      } else {
        res = await launchLibraryUniversal({
          mediaTypes: kind === "library-photo" ? "images" : "videos",
          quality: 0.85,
          allowsEditing: false,
        });
        if (res.canceled) { setBusy(false); return; }
      }
      if (res.canceled || !res.assets?.[0]?.uri) { setBusy(false); return; }
      const a = res.assets[0];
      if ((a.fileSize || 0) > 50 * 1024 * 1024) { notify("File troppo grande", "Max 50 MB."); setBusy(false); return; }
      const isVideo = kind.endsWith("video");
      await uploadWithDupCheck({ uri: a.uri, name: a.fileName || (isVideo ? `video-${Date.now()}.mp4` : `foto-${Date.now()}.jpg`), mime: a.mimeType || (isVideo ? "video/mp4" : "image/jpeg") }, a.fileSize, "files");
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
      const nm = audio.fileName || `audio-${Date.now()}.m4a`;
      await uploadMasterFile({ uri: audio.uri, name: nm, mime: audio.mimeType || "audio/m4a" }, "audio");
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

  // V50.z309 — Prompt per Neo: cancellazione in blocco + «completato» con un tocco
  const neoDeleteAll = async (scope: "pending" | "done") => {
    const ok = await confirmAsync(scope === "pending" ? "Cancella tutti i prompt in attesa" : "Pulisci i prompt completati", "Operazione definitiva. Procedere?");
    if (!ok) return;
    try { const r = await api<{ deleted: number }>(`/neo-bridge/prompts?scope=${scope}`, { method: "DELETE" }); notify("Prompt per Neo", `Cancellati ${r.deleted} prompt.`); await load(); }
    catch (e: any) { notify("Prompt per Neo", e?.message || "Errore"); }
  };
  const neoToggleDone = async (f: MasterFile) => {
    const next = f.neo_status === "done" ? "pending" : "done";
    try { await api(`/neo-bridge/prompts/${f.file_id}`, { method: "PATCH", body: { status: next } }); await load(); }
    catch (e: any) { notify("Prompt per Neo", e?.message || "Errore"); }
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
  const isTextTab = tab === "notes" || tab === "neo_prompts"; // V50.z239 — entrambe le cartelle sono testo (body)

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable testID="master-files-back" onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={HT.text} />
        </Pressable>
        <Text style={styles.title}>I miei file</Text>
        <View style={{ width: 26 }} />
      </View>

      {/* Tab bar (V50.z226: scorrevole, 6 cartelle) */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0 }} contentContainerStyle={styles.tabBar}>
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
      </ScrollView>

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
                  style={[styles.addBtn, { backgroundColor: '#16A34A', flex: 1, opacity: busy ? 0.5 : 1 }]}
                >
                  <Ionicons name="stop-circle" size={20} color="#FFF" />
                  <Text style={styles.addTxt}>Stop & Salva ({Math.floor((Date.now() - recStart) / 1000)}s)</Text>
                </Pressable>
                <Pressable
                  testID="master-files-cancel-recording"
                  onPress={cancelRecording}
                  style={[styles.addBtn, { backgroundColor: '#78716C', paddingHorizontal: 14, flex: 0 }]}
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
                  style={[styles.addBtn, { backgroundColor: '#DC2626', flex: 1, opacity: busy ? 0.5 : 1 }]}
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
        {tab === "scanner" && (
          <Pressable testID="master-files-open-scanner" onPress={() => router.push("/scanner" as any)} style={[styles.addBtn, { backgroundColor: catMeta.color }]}>
            <Ionicons name="scan-circle" size={18} color="#FFF" />
            <Text style={styles.addTxt}>Nuova scansione</Text>
          </Pressable>
        )}
        {tab === "files" && (
          <View style={{ flexDirection: "row", gap: 8, flex: 1 }}>
            <Pressable testID="master-files-add-file" onPress={() => uploadFile("files")} disabled={busy} style={[styles.addBtn, { backgroundColor: catMeta.color, flex: 1, opacity: busy ? 0.5 : 1 }]}>
              <Ionicons name="document" size={18} color="#FFF" />
              <Text style={styles.addTxt}>Carica file</Text>
            </Pressable>
            <Pressable testID="master-files-add-image" onPress={openPhotoPicker} disabled={busy} style={[styles.addBtn, { backgroundColor: '#16A34A', flex: 1, opacity: busy ? 0.5 : 1 }]}>
              <Ionicons name="camera" size={18} color="#FFF" />
              <Text style={styles.addTxt}>Foto</Text>
            </Pressable>
          </View>
        )}
      </View>

      {tab === "scanner" || tab === "files" ? (
        <View style={styles.searchRow}>
          <Ionicons name="search" size={16} color={HT.muted} />
          <TextInput value={query} onChangeText={setQuery} placeholder="Cerca nel testo dei documenti (OCR)…" placeholderTextColor={HT.muted} style={styles.searchInput} returnKeyType="search" testID="master-files-search" />
          {query ? <Pressable onPress={() => setQuery("")} hitSlop={8} testID="master-files-search-clear"><Ionicons name="close-circle" size={18} color={HT.muted} /></Pressable> : null}
        </View>
      ) : null}
      {tab === "neo_prompts" && items.length > 0 ? (
        // V50.z309 — barra azioni «Prompt per Neo»: Cancella tutti (in attesa) · Cancella completati
        <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingBottom: 4, flexWrap: "wrap" }} testID="neo-toolbar">
          <Pressable onPress={() => void neoDeleteAll("pending")} style={[styles.iconBtn, { flexDirection: "row", gap: 6, paddingHorizontal: 12, minHeight: 40, borderColor: HT.danger + '66', backgroundColor: HT.dangerTint }]} testID="neo-delete-all">
            <Ionicons name="trash-outline" size={16} color={HT.danger} /><Text style={{ color: HT.danger, fontWeight: "800", fontSize: 13 }}>Cancella tutti in attesa ({items.filter((f) => (f.neo_status || "pending") !== "done").length})</Text>
          </Pressable>
          {items.some((f) => f.neo_status === "done") ? (
            <Pressable onPress={() => void neoDeleteAll("done")} style={[styles.iconBtn, { flexDirection: "row", gap: 6, paddingHorizontal: 12, minHeight: 40 }]} testID="neo-delete-done">
              <Ionicons name="checkmark-done" size={16} color={HT.muted} /><Text style={{ color: HT.muted, fontWeight: "800", fontSize: 13 }}>Pulisci completati</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 140 }}>
        {loading ? (
          <ActivityIndicator style={{ marginTop: 30 }} color={catMeta.color} />
        ) : items.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name={catMeta.icon} size={40} color={HT.muted} />
            <Text style={styles.emptyTxt}>
              {tab === "notes" ? "Nessuna nota. Tocca 'Nuova nota' per iniziare." :
                tab === "bills" ? "Nessuna fattura salvata." :
                tab === "audio" ? "Nessun audio registrato o caricato." :
                tab === "scanner" ? "Nessuna scansione. I PDF creati con lo scanner arrivano qui automaticamente." :
                tab === "neo_prompts" ? "Nessun prompt in coda. In chat scrivi ad Axon «invia questo prompt a Neo» seguito dal testo: viene salvato qui con stato «In attesa». Poi, nella chat di sviluppo Emergent, scrivi «Neo, leggi i prompt in coda»." :
                "Nessun file. Carica documenti o foto."}
            </Text>
          </View>
        ) : (
          items.map((f) => (
            <View key={f.file_id} style={styles.card}>
              <Pressable
                testID={`master-files-item-${f.file_id}`}
                onPress={() => isTextTab ? openEditNote(f) : openViewer(f)}
                style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10, padding: 12 }}
              >
                <View style={[styles.icoBox, { backgroundColor: catMeta.color + "22" }]}>
                  <Ionicons name={catMeta.icon} size={20} color={catMeta.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName} numberOfLines={1}>
                    {tab === "neo_prompts" ? `#${f.neo_seq ?? ""} ${f.title || f.name}` : tab === "notes" ? (f.title || f.name || "Nota") : f.name}
                  </Text>
                  <Text style={styles.itemMeta} numberOfLines={1}>
                    {isTextTab
                      ? `${(f.body || "").slice(0, 60)} · ${fmtDateTime(f.created_at)}`
                      : `${formatSize(f.size)} · ${fmtDateTime(f.created_at)}${f.text_hash ? " · OCR" : ""}`}
                  </Text>
                  {f.ocr_excerpt ? <Text style={styles.ocrExcerpt} numberOfLines={2} testID={`ocr-excerpt-${f.file_id}`}>🔍 {f.ocr_excerpt}</Text> : null}
                  {tab === "neo_prompts" ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                      <Pressable onPress={() => void neoToggleDone(f)} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, backgroundColor: (NEO_STATUS_LABEL[f.neo_status || "pending"]?.color || HT.muted) + "22" }} testID={`neo-status-${f.file_id}`} accessibilityLabel={f.neo_status === "done" ? "Riporta in attesa" : "Segna completato"}>
                        <Ionicons name={f.neo_status === "done" ? "checkmark-circle" : "ellipse-outline"} size={13} color={NEO_STATUS_LABEL[f.neo_status || "pending"]?.color || HT.muted} />
                        <Text style={{ fontSize: 10, fontWeight: "800", color: NEO_STATUS_LABEL[f.neo_status || "pending"]?.color || HT.muted }}>{NEO_STATUS_LABEL[f.neo_status || "pending"]?.label || f.neo_status}{f.neo_status === "done" ? "" : " · tocca per completare"}</Text>
                      </Pressable>
                      {f.neo_note ? <Text style={[styles.itemMeta, { flexShrink: 1 }]} numberOfLines={1}>Neo: {f.neo_note}</Text> : null}
                    </View>
                  ) : null}
                </View>
              </Pressable>
              <View style={{ flexDirection: "row", gap: 4, paddingRight: 8 }}>
                {!isTextTab && (
                  <Pressable
                    testID={`master-files-share-${f.file_id}`}
                    onPress={() => openShare(f)}
                    hitSlop={8}
                    style={styles.iconBtn}
                  >
                    <Ionicons name="share-social" size={14} color={catMeta.color} />
                  </Pressable>
                )}
                {!isTextTab && (
                  <Pressable
                    testID={`master-files-rename-${f.file_id}`}
                    onPress={() => openRename(f)}
                    hitSlop={8}
                    style={styles.iconBtn}
                  >
                    <Ionicons name="pencil" size={14} color={HT.muted} />
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

      {/* V50.z226 — Popup duplicato: stesso nome + stessa dimensione */}
      <Modal visible={!!dupPrompt} animationType="fade" transparent onRequestClose={() => dupPrompt?.resolve("cancel")}>
        <View style={[styles.modalBack, { justifyContent: "center", padding: 20 }]}>
          <View style={[styles.modalCard, { borderRadius: 20 }]} testID="master-files-dup-modal">
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <View style={[styles.icoBox, { backgroundColor: HT.warningTint }]}><Ionicons name="copy" size={20} color="#D97706" /></View>
              <Text style={[styles.modalTitle, { marginBottom: 0, flex: 1 }]}>File già presente</Text>
            </View>
            <Text style={{ color: HT.muted, fontSize: 13.5, lineHeight: 19 }}>
              «{dupPrompt?.existing.name}» esiste già con la stessa dimensione. Vuoi sostituirlo o tenerli entrambi?
            </Text>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 16 }}>
              <Pressable testID="master-files-dup-replace" onPress={() => dupPrompt?.resolve("replace")} style={[styles.modalBtn, { backgroundColor: '#DC2626' }]}>
                <Text style={{ color: "#FFF", fontWeight: "800" }}>Sostituisci</Text>
              </Pressable>
              <Pressable testID="master-files-dup-keep" onPress={() => dupPrompt?.resolve("keep")} style={[styles.modalBtn, { backgroundColor: HT.brand }]}>
                <Text style={{ color: "#FFF", fontWeight: "800" }}>Tieni entrambi</Text>
              </Pressable>
            </View>
            <Pressable testID="master-files-dup-cancel" onPress={() => dupPrompt?.resolve("cancel")} style={{ alignSelf: "center", marginTop: 12, minHeight: 36, justifyContent: "center" }}>
              <Text style={{ color: HT.muted, fontWeight: "700" }}>Annulla caricamento</Text>
            </Pressable>
          </View>
        </View>
      </Modal>


      {/* Note editor modal */}
      <Modal visible={!!noteEditor} animationType="slide" transparent onRequestClose={() => setNoteEditor(null)}>
        <View style={styles.modalBack}>
          <View style={[styles.modalCard, { paddingBottom: bottomPad }]}>
            <Text style={styles.modalTitle}>{noteEditor?.file_id ? "Modifica nota" : "Nuova nota"}</Text>
            <TextInput
              testID="master-note-title"
              value={noteEditor?.title || ""}
              onChangeText={(v) => setNoteEditor((n) => n ? { ...n, title: v } : n)}
              placeholder="Titolo"
              placeholderTextColor={HT.muted}
              style={[styles.noteInput, { fontSize: 15, fontWeight: "700" }]}
            />
            <TextInput
              testID="master-note-body"
              value={noteEditor?.body || ""}
              onChangeText={(v) => setNoteEditor((n) => n ? { ...n, body: v } : n)}
              placeholder="Contenuto della nota…"
              placeholderTextColor={HT.muted}
              multiline
              style={[styles.noteInput, { minHeight: 220, textAlignVertical: "top" }]}
            />
            <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
              <Pressable
                testID="master-note-cancel"
                onPress={() => setNoteEditor(null)}
                style={[styles.modalBtn, { backgroundColor: HT.card2, borderWidth: 1, borderColor: HT.border }]}
              >
                <Text style={{ color: HT.text, fontWeight: "700" }}>Annulla</Text>
              </Pressable>
              <Pressable
                testID="master-note-save"
                onPress={saveNote}
                disabled={busy}
                style={[styles.modalBtn, { backgroundColor: '#7C3AED', opacity: busy ? 0.5 : 1 }]}
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
          <View style={[styles.modalCard, { padding: 20 }, { paddingBottom: bottomPad }]}>
            <Text style={styles.modalTitle}>Rinomina file</Text>
            <TextInput
              testID="master-rename-input"
              value={renameInput}
              onChangeText={setRenameInput}
              placeholder="Nome file"
              placeholderTextColor={HT.muted}
              style={styles.noteInput}
            />
            <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
              <Pressable onPress={() => setRenameTarget(null)} style={[styles.modalBtn, { backgroundColor: HT.card2, borderWidth: 1, borderColor: HT.border }]}>
                <Text style={{ color: HT.text, fontWeight: "700" }}>Annulla</Text>
              </Pressable>
              <Pressable
                testID="master-rename-save"
                onPress={commitRename}
                disabled={busy}
                style={[styles.modalBtn, { backgroundColor: HT.brand, opacity: busy ? 0.5 : 1 }]}
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
          <Pressable style={[styles.sheetCard, { paddingBottom: bottomPad }]} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Aggiungi foto o video</Text>
            <View style={{ gap: 8, marginTop: 8 }}>
              <Pressable testID="mf-photo-camera" onPress={() => runMediaPicker("camera-photo")} style={[styles.sheetBtn, { backgroundColor: '#7C3AED' }]}>
                <Ionicons name="camera" size={18} color="#FFF" />
                <Text style={styles.sheetTxt}>Scatta foto</Text>
              </Pressable>
              <Pressable testID="mf-video-camera" onPress={() => runMediaPicker("camera-video")} style={[styles.sheetBtn, { backgroundColor: '#DB2777' }]}>
                <Ionicons name="videocam" size={18} color="#FFF" />
                <Text style={styles.sheetTxt}>Registra video</Text>
              </Pressable>
              <Pressable testID="mf-photo-library" onPress={() => runMediaPicker("library-photo")} style={[styles.sheetBtn, { backgroundColor: '#0891B2' }]}>
                <Ionicons name="images" size={18} color="#FFF" />
                <Text style={styles.sheetTxt}>Scegli foto dalla galleria</Text>
              </Pressable>
              <Pressable testID="mf-video-library" onPress={() => runMediaPicker("library-video")} style={[styles.sheetBtn, { backgroundColor: '#16A34A' }]}>
                <Ionicons name="film" size={18} color="#FFF" />
                <Text style={styles.sheetTxt}>Scegli video dalla galleria</Text>
              </Pressable>
              <Pressable onPress={() => setPhotoPickerOpen(false)} style={[styles.sheetBtn, { backgroundColor: HT.card2, borderWidth: 1, borderColor: HT.border }]}>
                <Text style={{ color: HT.text, fontWeight: "700" }}>Annulla</Text>
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
  searchRow: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 12, marginBottom: 4, paddingHorizontal: 12, minHeight: 42, borderRadius: 12, backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border },
  searchInput: { flex: 1, fontSize: 14, color: HT.text, paddingVertical: 8 },
  ocrExcerpt: { fontSize: 11, color: "#0F766E", marginTop: 3, fontStyle: "italic" },

  root: { flex: 1, backgroundColor: theme.color.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: HT.border, backgroundColor: HT.card2 },
  title: { fontSize: 18, fontWeight: "800", color: HT.text },
  tabBar: { flexDirection: "row", gap: 6, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 6 },
  tabBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 10, paddingHorizontal: 12, minHeight: 44, borderRadius: 10, backgroundColor: HT.card2, borderWidth: 1, borderColor: HT.border },
  tabTxt: { fontSize: 12, fontWeight: "700", color: HT.text },
  addBar: { paddingHorizontal: 12, paddingVertical: 8, flexDirection: "row" },
  addBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: 10, flex: 1 },
  addTxt: { color: "#FFF", fontWeight: "700", fontSize: 13 },
  emptyCard: { alignItems: "center", padding: 32, backgroundColor: HT.card2, borderRadius: 12, borderWidth: 1, borderColor: HT.border, borderStyle: "dashed" },
  emptyTxt: { color: HT.muted, fontSize: 13, textAlign: "center", marginTop: 10, maxWidth: 300 },
  card: { backgroundColor: HT.card2, borderRadius: 12, borderWidth: 1, borderColor: HT.border, marginBottom: 8, flexDirection: "row", alignItems: "center", overflow: "hidden" },
  icoBox: { width: 40, height: 40, borderRadius: 20, justifyContent: "center", alignItems: "center" },
  itemName: { fontSize: 14, fontWeight: "700", color: HT.text },
  itemMeta: { fontSize: 11, color: HT.muted, marginTop: 2 },
  iconBtn: { padding: 8, borderRadius: 6 },
  modalBack: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: HT.card2, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: "88%" },
  modalTitle: { fontSize: 18, fontWeight: "800", color: HT.text, marginBottom: 12 },
  modalBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: "center" },
  noteInput: { backgroundColor: HT.card2, borderRadius: 8, paddingHorizontal: 10, paddingVertical: Platform.OS === "ios" ? 10 : 8, fontSize: 13, color: HT.text, marginTop: 6 },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#DC2626' },
  sheetCard: { backgroundColor: HT.card2, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  sheetBtn: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 14, borderRadius: 10, justifyContent: "flex-start" },
  sheetTxt: { color: "#FFF", fontWeight: "700", fontSize: 14 },
});

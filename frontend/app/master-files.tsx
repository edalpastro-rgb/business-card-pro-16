import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, TextInput, Modal, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { uriToBase64 } from "@/src/utils/media";
import { notify, confirmAsync } from "@/src/utils/notify";
import { FileViewer } from "@/src/FileViewer";

type MasterCat = "notes" | "bills" | "audio" | "files";
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
        // For audio, we prefer either a recording OR the library — but the modal
        // handles recording. Here fallback to picking any audio file.
        const res = await DocumentPicker.getDocumentAsync({ type: "audio/*", multiple: false, copyToCacheDirectory: true });
        if (res.canceled || !res.assets?.[0]) { setBusy(false); return; }
        asset = res.assets[0];
      } else if (category === "bills") {
        const res = await DocumentPicker.getDocumentAsync({ type: "application/pdf", multiple: false, copyToCacheDirectory: true });
        if (res.canceled || !res.assets?.[0]) { setBusy(false); return; }
        asset = res.assets[0];
      } else {
        // Generic files: allow any
        const res = await DocumentPicker.getDocumentAsync({ type: "*/*", multiple: false, copyToCacheDirectory: true });
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

  // Upload an image (photo) into "files" category — useful for pics/screenshots
  const uploadImage = async () => {
    setBusy(true);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { setBusy(false); return; }
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85, allowsEditing: false });
      if (res.canceled || !res.assets?.[0]?.uri) { setBusy(false); return; }
      const a = res.assets[0];
      const b64 = await uriToBase64(a.uri);
      const bytes = Math.round((b64.length * 3) / 4);
      if (bytes > 20 * 1024 * 1024) { notify("File troppo grande", "Max 20 MB."); setBusy(false); return; }
      await api("/master-files", {
        method: "POST",
        body: { category: "files", name: a.fileName || `foto-${Date.now()}.jpg`, mime: a.mimeType || "image/jpeg", data_base64: b64, size: bytes },
      });
      await load();
    } catch (e: any) {
      notify("Errore", e?.message || "");
    } finally { setBusy(false); }
  };

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
          <View style={{ flexDirection: "row", gap: 8, flex: 1 }}>
            <Pressable testID="master-files-add-audio" onPress={() => uploadFile("audio")} disabled={busy} style={[styles.addBtn, { backgroundColor: catMeta.color, flex: 1, opacity: busy ? 0.5 : 1 }]}>
              <Ionicons name="cloud-upload" size={18} color="#FFF" />
              <Text style={styles.addTxt}>Carica audio</Text>
            </Pressable>
          </View>
        )}
        {tab === "files" && (
          <View style={{ flexDirection: "row", gap: 8, flex: 1 }}>
            <Pressable testID="master-files-add-file" onPress={() => uploadFile("files")} disabled={busy} style={[styles.addBtn, { backgroundColor: catMeta.color, flex: 1, opacity: busy ? 0.5 : 1 }]}>
              <Ionicons name="document" size={18} color="#FFF" />
              <Text style={styles.addTxt}>Carica file</Text>
            </Pressable>
            <Pressable testID="master-files-add-image" onPress={uploadImage} disabled={busy} style={[styles.addBtn, { backgroundColor: "#16A34A", flex: 1, opacity: busy ? 0.5 : 1 }]}>
              <Ionicons name="image" size={18} color="#FFF" />
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
                    {tab === "notes" ? (f.body || "").slice(0, 100) : `${formatSize(f.size)} · ${new Date(f.created_at).toLocaleDateString("it-IT")}`}
                  </Text>
                </View>
              </Pressable>
              <View style={{ flexDirection: "row", gap: 4, paddingRight: 8 }}>
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
      />
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
});

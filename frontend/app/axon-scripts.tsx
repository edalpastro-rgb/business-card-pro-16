/**
 * V50.w — Playbook Script Bank
 *
 * Libreria di script vincenti (email, telefonata, obiezioni, closing).
 * Axon usa questi script nel prompt quando l'utente chiede un modello.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput, Alert,
  ActivityIndicator, Modal, KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";

type Script = {
  script_id: string;
  category: string;
  title: string;
  content: string;
  tags?: string[];
  times_used?: number;
  updated_at?: string;
};

const CATEGORIES: { id: string; label: string; emoji: string; color: string }[] = [
  { id: "apertura_chiamata", label: "Apertura chiamata", emoji: "📞", color: "#0F9D58" },
  { id: "email_freddo", label: "Email a freddo", emoji: "✉️", color: "#1D4ED8" },
  { id: "gestione_obiezione", label: "Gestione obiezioni", emoji: "🛡️", color: "#DC2626" },
  { id: "closing", label: "Closing", emoji: "🎯", color: "#7C3AED" },
  { id: "follow_up", label: "Follow-up", emoji: "🔁", color: "#EA580C" },
  { id: "primo_incontro", label: "Primo incontro", emoji: "🤝", color: "#0891B2" },
  { id: "altro", label: "Altro", emoji: "📚", color: "#64748B" },
];

function catInfo(id: string) {
  return CATEGORIES.find((c) => c.id === id) || CATEGORIES[CATEGORIES.length - 1];
}

export default function AxonScriptsScreen() {
  const router = useRouter();
  const bottomInset = usePageBottomPadding();

  const [loading, setLoading] = useState(true);
  const [scripts, setScripts] = useState<Script[]>([]);
  const [filter, setFilter] = useState<string | null>(null);
  const [editing, setEditing] = useState<Script | null>(null);
  const [creating, setCreating] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<any>("/axon/scripts");
      setScripts(Array.isArray(r?.scripts) ? r.scripts : []);
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile caricare gli script");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const del = (id: string) => {
    Alert.alert("Elimina script", "Sei sicuro?", [
      { text: "Annulla", style: "cancel" },
      { text: "Elimina", style: "destructive", onPress: async () => {
        try { await api(`/axon/scripts/${id}`, { method: "DELETE" }); await load(); }
        catch (e: any) { notify("Errore", e?.message || String(e)); }
      }},
    ]);
  };

  const copyContent = async (s: Script) => {
    try {
      await Clipboard.setStringAsync(s.content);
      await api(`/axon/scripts/${s.script_id}/use`, { method: "POST" });
      notify("Copiato ✅", "Script copiato negli appunti");
      load();
    } catch { /* silent */ }
  };

  const visible = filter ? scripts.filter((s) => s.category === filter) : scripts;

  // V50.w — Import da file locale
  const importFromDevice = async () => {
    setShowImport(false);
    try {
      const r = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "text/*", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/msword"],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (r.canceled || !r.assets?.[0]) return;
      const file = r.assets[0];
      setImporting(true);
      const data = await FileSystem.readAsStringAsync(file.uri, { encoding: "base64" as any });
      const resp = await api<any>("/axon/scripts/import/file", {
        method: "POST",
        body: { name: file.name || "file", mime: file.mimeType || "application/octet-stream", data_base64: data },
      });
      notify(
        resp?.scripts_imported ? "Import completato ✅" : "Nessuno script creato",
        resp?.scripts_imported ? `${resp.scripts_imported} script salvati` : "Il file non conteneva script leggibili"
      );
      load();
    } catch (e: any) {
      notify("Errore import file", e?.message || String(e));
    } finally { setImporting(false); }
  };

  // V50.w — Import da testo incollato
  const importFromText = async () => {
    if (!pasteText.trim()) return;
    setImporting(true);
    try {
      const resp = await api<any>("/axon/scripts/import/text", {
        method: "POST",
        body: { text: pasteText, source_name: "Testo incollato" },
      });
      notify(
        resp?.scripts_imported ? "Import completato ✅" : "Nessuno script creato",
        resp?.scripts_imported ? `${resp.scripts_imported} script salvati` : "Non ho trovato script utilizzabili"
      );
      setShowPaste(false);
      setPasteText("");
      load();
    } catch (e: any) {
      notify("Errore", e?.message || String(e));
    } finally { setImporting(false); }
  };

  const importFromDrive = () => {
    setShowImport(false);
    router.push("/axon-scripts-import" as any);
  };

  const importFromDropbox = () => {
    setShowImport(false);
    Alert.alert("Dropbox", "L'import da Dropbox arriverà a breve. Per ora usa Google Drive o carica il file dal telefono.");
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <View style={styles.center}><ActivityIndicator color="#FBBF24" size="large" /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.hBtn}>
          <Ionicons name="chevron-back" size={24} color="#FFF" />
        </Pressable>
        <Text style={styles.hTitle}>📚 Playbook Script</Text>
        <View style={{ flexDirection: "row", gap: 4 }}>
          <Pressable onPress={() => setShowImport(true)} hitSlop={10} style={styles.hBtn} testID="script-import-btn">
            <Ionicons name="cloud-download" size={22} color="#0F9D58" />
          </Pressable>
          <Pressable onPress={() => setCreating(true)} hitSlop={10} style={styles.hBtn} testID="script-add-btn">
            <Ionicons name="add-circle" size={26} color="#FBBF24" />
          </Pressable>
        </View>
      </View>

      {/* Filtri categoria */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filters} contentContainerStyle={{ paddingHorizontal: 12, gap: 6 }}>
        <Pressable onPress={() => setFilter(null)} style={[styles.filterPill, !filter && styles.filterPillActive]}>
          <Text style={[styles.filterTxt, !filter && styles.filterTxtActive]}>Tutti ({scripts.length})</Text>
        </Pressable>
        {CATEGORIES.map((c) => {
          const n = scripts.filter((s) => s.category === c.id).length;
          if (n === 0) return null;
          const active = filter === c.id;
          return (
            <Pressable key={c.id} onPress={() => setFilter(active ? null : c.id)} style={[styles.filterPill, active && styles.filterPillActive]}>
              <Text style={[styles.filterTxt, active && styles.filterTxtActive]}>{c.emoji} {c.label} ({n})</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: bottomInset }}>
        {visible.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="book-outline" size={40} color="#64748B" />
            <Text style={styles.emptyTitle}>Nessuno script</Text>
            <Text style={styles.emptyTxt}>
              Crea la tua libreria personale di script vincenti. Axon li userà come modello quando gli chiedi di scrivere email, aperture, gestioni obiezioni.
            </Text>
            <Pressable onPress={() => setCreating(true)} style={styles.emptyCta}>
              <Ionicons name="add" size={18} color="#0F172A" />
              <Text style={styles.emptyCtaTxt}>Crea primo script</Text>
            </Pressable>
          </View>
        ) : (
          visible.map((s) => {
            const ci = catInfo(s.category);
            return (
              <View key={s.script_id} style={[styles.card, { borderLeftColor: ci.color }]}>
                <View style={styles.cardHead}>
                  <Text style={styles.catBadge}>{ci.emoji} {ci.label}</Text>
                  {s.times_used ? <Text style={styles.usedTxt}>usato {s.times_used}×</Text> : null}
                </View>
                <Text style={styles.title}>{s.title}</Text>
                <Text style={styles.content} numberOfLines={4}>{s.content}</Text>
                {s.tags?.length ? (
                  <View style={styles.tagsRow}>
                    {s.tags.map((t) => <Text key={t} style={styles.tag}>#{t}</Text>)}
                  </View>
                ) : null}
                <View style={styles.actions}>
                  <Pressable onPress={() => copyContent(s)} style={[styles.actionBtn, { backgroundColor: "#0F9D58" }]}>
                    <Ionicons name="copy" size={14} color="#FFF" />
                    <Text style={styles.actionTxt}>Copia</Text>
                  </Pressable>
                  <Pressable onPress={() => setEditing(s)} style={[styles.actionBtn, { backgroundColor: "#FBBF24" }]}>
                    <Ionicons name="create-outline" size={14} color="#0F172A" />
                    <Text style={[styles.actionTxt, { color: "#0F172A" }]}>Modifica</Text>
                  </Pressable>
                  <Pressable onPress={() => del(s.script_id)} style={[styles.actionBtn, { backgroundColor: "#FEE2E2" }]}>
                    <Ionicons name="trash" size={14} color="#DC2626" />
                  </Pressable>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      {(editing || creating) && (
        <ScriptEditor
          script={editing}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSaved={() => { setEditing(null); setCreating(false); load(); }}
        />
      )}

      {/* V50.w — Chooser sorgente import */}
      <Modal transparent visible={showImport} animationType="fade" onRequestClose={() => setShowImport(false)}>
        <Pressable style={styles.chooserBackdrop} onPress={() => setShowImport(false)}>
          <Pressable style={styles.chooserCard} onPress={() => {}}>
            <Text style={styles.chooserTitle}>📥 Importa script da…</Text>

            <Pressable onPress={importFromDrive} style={styles.chooserItem}>
              <View style={[styles.chooserIcon, { backgroundColor: "#0F9D58" }]}><Ionicons name="logo-google" size={20} color="#FFF" /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.chooserItemTitle}>Google Drive</Text>
                <Text style={styles.chooserItemSub}>Da una cartella condivisa (batch)</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
            </Pressable>

            <Pressable onPress={importFromDropbox} style={styles.chooserItem}>
              <View style={[styles.chooserIcon, { backgroundColor: "#0061FF" }]}><Ionicons name="cube" size={20} color="#FFF" /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.chooserItemTitle}>Dropbox</Text>
                <Text style={styles.chooserItemSub}>In arrivo</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
            </Pressable>

            <Pressable onPress={importFromDevice} style={styles.chooserItem}>
              <View style={[styles.chooserIcon, { backgroundColor: "#EA580C" }]}><Ionicons name="document" size={20} color="#FFF" /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.chooserItemTitle}>File dal telefono/PC</Text>
                <Text style={styles.chooserItemSub}>PDF, DOCX, TXT dal dispositivo</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
            </Pressable>

            <Pressable onPress={() => { setShowImport(false); setShowPaste(true); }} style={styles.chooserItem}>
              <View style={[styles.chooserIcon, { backgroundColor: "#7C3AED" }]}><Ionicons name="clipboard" size={20} color="#FFF" /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.chooserItemTitle}>Incolla testo</Text>
                <Text style={styles.chooserItemSub}>Da appunti o chat</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
            </Pressable>

            <Pressable onPress={() => setShowImport(false)} style={styles.chooserCancel}>
              <Text style={styles.chooserCancelTxt}>Annulla</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* V50.w — Modal incolla testo */}
      <Modal visible={showPaste} animationType="slide" onRequestClose={() => setShowPaste(false)}>
        <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
          <View style={styles.header}>
            <Pressable onPress={() => setShowPaste(false)} hitSlop={10} style={styles.hBtn}>
              <Ionicons name="close" size={24} color="#FFF" />
            </Pressable>
            <Text style={styles.hTitle}>📝 Incolla Testo</Text>
            <View style={{ width: 30 }} />
          </View>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
            <ScrollView contentContainerStyle={{ padding: 12, gap: 10 }} keyboardShouldPersistTaps="handled">
              <Text style={styles.formLabel}>Incolla qui il tuo materiale: Axon lo dividerà automaticamente in N script</Text>
              <TextInput
                value={pasteText}
                onChangeText={setPasteText}
                multiline
                style={[styles.input, { minHeight: 300, textAlignVertical: "top" }]}
                placeholder="Incolla script, email, discorsi, appunti…"
                placeholderTextColor="#94A3B8"
                autoFocus
              />
              <Pressable onPress={importFromText} disabled={importing || !pasteText.trim()} style={[styles.saveBtn, (importing || !pasteText.trim()) && { opacity: 0.6 }]}>
                {importing ? <ActivityIndicator color="#0F172A" /> : (
                  <><Ionicons name="sparkles" size={16} color="#0F172A" /><Text style={styles.saveBtnTxt}>Analizza e importa</Text></>
                )}
              </Pressable>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      {/* Overlay importing globale */}
      {importing && !showPaste && (
        <View style={styles.overlay}>
          <ActivityIndicator size="large" color="#FBBF24" />
          <Text style={styles.overlayTxt}>Analizzo il file con Axon…</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

function ScriptEditor({ script, onClose, onSaved }: { script: Script | null; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(script?.title || "");
  const [content, setContent] = useState(script?.content || "");
  const [category, setCategory] = useState(script?.category || "apertura_chiamata");
  const [tags, setTags] = useState((script?.tags || []).join(", "));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!title.trim() || !content.trim()) {
      notify("Errore", "Titolo e contenuto sono obbligatori");
      return;
    }
    setSaving(true);
    try {
      const body = {
        title, content, category,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      };
      if (script) {
        await api(`/axon/scripts/${script.script_id}`, { method: "PUT", body });
      } else {
        await api("/axon/scripts", { method: "POST", body });
      }
      notify(script ? "Script aggiornato ✅" : "Script creato ✅", "");
      onSaved();
    } catch (e: any) {
      notify("Errore", e?.message || String(e));
    } finally { setSaving(false); }
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={10} style={styles.hBtn}>
            <Ionicons name="close" size={24} color="#FFF" />
          </Pressable>
          <Text style={styles.hTitle}>{script ? "Modifica" : "Nuovo Script"}</Text>
          <View style={{ width: 30 }} />
        </View>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ padding: 12, gap: 10 }} keyboardShouldPersistTaps="handled">
            <Text style={styles.formLabel}>Categoria</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {CATEGORIES.map((c) => (
                <Pressable key={c.id} onPress={() => setCategory(c.id)} style={[styles.filterPill, category === c.id && styles.filterPillActive]}>
                  <Text style={[styles.filterTxt, category === c.id && styles.filterTxtActive]}>{c.emoji} {c.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Text style={styles.formLabel}>Titolo</Text>
            <TextInput value={title} onChangeText={setTitle} style={styles.input} placeholder="Es. Apertura freddo bolletta luce" placeholderTextColor="#94A3B8" />
            <Text style={styles.formLabel}>Contenuto</Text>
            <TextInput
              value={content}
              onChangeText={setContent}
              style={[styles.input, { minHeight: 180, textAlignVertical: "top" }]}
              multiline
              placeholder="Ciao [Nome], sono [Consulente]. Ho notato la sua ultima bolletta e volevo mostrarle come…"
              placeholderTextColor="#94A3B8"
            />
            <Text style={styles.formLabel}>Tag (separati da virgola)</Text>
            <TextInput value={tags} onChangeText={setTags} style={styles.input} placeholder="freddo, bolletta, luce" placeholderTextColor="#94A3B8" />
            <Pressable onPress={save} disabled={saving} style={[styles.saveBtn, saving && { opacity: 0.6 }]} testID="script-save-btn">
              {saving ? <ActivityIndicator color="#0F172A" /> : (
                <><Ionicons name="save" size={16} color="#0F172A" /><Text style={styles.saveBtnTxt}>Salva</Text></>
              )}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0F2438" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 10, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.08)",
  },
  hBtn: { padding: 6, minWidth: 30 },
  hTitle: { color: "#FFF", fontSize: 16, fontWeight: "900" },
  filters: { maxHeight: 44, backgroundColor: "#0B1B2C", borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.06)" },
  filterPill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.08)" },
  filterPillActive: { backgroundColor: "#FBBF24" },
  filterTxt: { color: "rgba(255,255,255,0.8)", fontWeight: "700", fontSize: 12 },
  filterTxtActive: { color: "#0F172A" },
  card: {
    backgroundColor: "#FFF", padding: 12, borderRadius: 12, marginBottom: 10,
    borderLeftWidth: 4,
  },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  catBadge: { color: "#64748B", fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  usedTxt: { color: "#94A3B8", fontSize: 10 },
  title: { color: "#0F172A", fontSize: 15, fontWeight: "900", marginTop: 4 },
  content: { color: "#334155", fontSize: 13, marginTop: 4, lineHeight: 18 },
  tagsRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 6 },
  tag: { color: "#7C3AED", fontSize: 11, fontWeight: "700" },
  actions: { flexDirection: "row", gap: 6, marginTop: 8 },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  actionTxt: { color: "#FFF", fontSize: 11, fontWeight: "800" },
  emptyBox: { alignItems: "center", padding: 30, gap: 10 },
  emptyTitle: { color: "#FFF", fontSize: 16, fontWeight: "900" },
  emptyTxt: { color: "rgba(255,255,255,0.7)", fontSize: 12, textAlign: "center", lineHeight: 17 },
  emptyCta: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10, backgroundColor: "#FBBF24", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999 },
  emptyCtaTxt: { color: "#0F172A", fontWeight: "900", fontSize: 13 },

  // Editor
  formLabel: { color: "rgba(255,255,255,0.85)", fontSize: 11, fontWeight: "800", textTransform: "uppercase", marginTop: 8 },
  input: { backgroundColor: "#FFF", borderRadius: 10, padding: 10, color: "#0F172A", fontSize: 14 },
  saveBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: "#FBBF24", paddingVertical: 12, borderRadius: 999, marginTop: 12,
  },
  saveBtnTxt: { color: "#0F172A", fontWeight: "900", fontSize: 14 },

  // V50.w — Import chooser
  chooserBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  chooserCard: { backgroundColor: "#0F2438", padding: 14, borderTopLeftRadius: 20, borderTopRightRadius: 20, gap: 8, paddingBottom: 30 },
  chooserTitle: { color: "#FFF", fontSize: 16, fontWeight: "900", marginBottom: 6, textAlign: "center" },
  chooserItem: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 12 },
  chooserIcon: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  chooserItemTitle: { color: "#FFF", fontWeight: "800", fontSize: 14 },
  chooserItemSub: { color: "rgba(255,255,255,0.6)", fontSize: 11, marginTop: 2 },
  chooserCancel: { alignItems: "center", padding: 12, marginTop: 4 },
  chooserCancelTxt: { color: "#94A3B8", fontWeight: "700", fontSize: 13 },

  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", gap: 10 },
  overlayTxt: { color: "#FFF", fontWeight: "800", fontSize: 13 },
});

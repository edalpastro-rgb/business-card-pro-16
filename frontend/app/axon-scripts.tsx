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
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
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
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(insets.bottom, 12);

  const [loading, setLoading] = useState(true);
  const [scripts, setScripts] = useState<Script[]>([]);
  const [filter, setFilter] = useState<string | null>(null);
  const [editing, setEditing] = useState<Script | null>(null);
  const [creating, setCreating] = useState(false);

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
          <Pressable onPress={() => router.push("/axon-scripts-import" as any)} hitSlop={10} style={styles.hBtn} testID="script-import-btn">
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

      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 40 + bottomInset }}>
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
});

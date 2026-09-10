/**
 * V50.z144 — Editor voce Knowledge Base Axon (FAQ / Dati ricorrenti / Nota / rinomina PDF).
 * Create: POST /api/master-docs {name, kind:"text", category, content}
 * Update: PUT  /api/master-docs/{doc_id} {name?, category?, content?}  (content solo per kind=text)
 * Regola modal: footer FISSO con Salva + Annulla sempre visibili.
 */
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Modal, Pressable, TextInput, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";

export type KbCategory = "Documento" | "FAQ" | "Dati" | "Nota";
export type KbDoc = { doc_id: string; name: string; kind?: "pdf" | "text"; category?: KbCategory; content?: string };

type Props = { visible: boolean; doc: KbDoc | null; onClose: () => void; onSaved: () => void };

const PURPLE = "#7C3AED";
export const KB_CATEGORIES: { key: KbCategory; icon: keyof typeof Ionicons.glyphMap; hint: string }[] = [
  { key: "FAQ", icon: "help-circle", hint: "Domande frequenti con risposta" },
  { key: "Dati", icon: "stats-chart", hint: "Dati ricorrenti: prezzi, codici, listini" },
  { key: "Nota", icon: "create", hint: "Procedure, note operative" },
  { key: "Documento", icon: "document-text", hint: "File PDF / testo caricato" },
];

export function KbEntryEditorModal({ visible, doc, onClose, onSaved }: Props) {
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const isEdit = !!doc;
  const isPdf = (doc?.kind || (doc ? "pdf" : "text")) === "pdf";
  const [name, setName] = useState("");
  const [category, setCategory] = useState<KbCategory>("FAQ");
  const [content, setContent] = useState("");
  const [loadingContent, setLoadingContent] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setName(doc?.name || "");
    setCategory((doc?.category as KbCategory) || (doc ? (isPdf ? "Documento" : "Nota") : "FAQ"));
    setContent(doc?.content || "");
    if (doc && !isPdf && !doc.content) {
      setLoadingContent(true);
      api<KbDoc>(`/master-docs/${doc.doc_id}`)
        .then((d) => setContent(d?.content || ""))
        .catch((e: any) => notify("Errore", e?.message || ""))
        .finally(() => setLoadingContent(false));
    }
  }, [visible, doc, isPdf]);

  const canSave = !saving && !loadingContent && name.trim().length > 0 && (isPdf || content.trim().length >= 10);

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      if (isEdit && doc) {
        const body: Record<string, string> = { name: name.trim(), category };
        if (!isPdf) body.content = content.trim();
        await api(`/master-docs/${doc.doc_id}`, { method: "PUT", body });
        notify("Aggiornato", "Axon userà subito la versione aggiornata.");
      } else {
        await api("/master-docs", { method: "POST", body: { name: name.trim(), kind: "text", category, content: content.trim() } });
        notify("Voce aggiunta", "Axon la userà automaticamente quando è pertinente.");
      }
      onSaved();
      onClose();
    } catch (e: any) {
      notify("Errore salvataggio", e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  const cats = isPdf ? KB_CATEGORIES : KB_CATEGORIES.filter((c) => c.key !== "Documento");

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={() => !saving && onClose()}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.back}>
        <View style={[styles.card, { maxHeight: winH * 0.92, paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={styles.hdr}>
            <View style={styles.hdrIcon}><Ionicons name={isEdit ? "create" : "add"} size={18} color="#FFF" /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{isEdit ? (isPdf ? "Modifica documento" : "Modifica voce") : "Nuova voce knowledge base"}</Text>
              <Text style={styles.sub}>{isPdf ? "Puoi rinominare e cambiare categoria" : "Axon la caricherà nel contesto quando la domanda è pertinente"}</Text>
            </View>
            <Pressable onPress={() => !saving && onClose()} hitSlop={10} testID="kb-editor-close">
              <Ionicons name="close" size={22} color="#1B2B4B" />
            </Pressable>
          </View>

          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ padding: 14, gap: 12 }} keyboardShouldPersistTaps="handled">
            <View>
              <Text style={styles.label}>Titolo</Text>
              <TextInput
                testID="kb-editor-name"
                value={name}
                onChangeText={setName}
                placeholder={isPdf ? "Nome documento" : "Es. Costi di attivazione gas / Orari servizio clienti"}
                placeholderTextColor="#94A3B8"
                style={styles.input}
                maxLength={200}
                editable={!saving}
              />
            </View>
            <View>
              <Text style={styles.label}>Categoria</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {cats.map((c) => {
                  const on = category === c.key;
                  return (
                    <Pressable key={c.key} testID={`kb-editor-cat-${c.key}`} onPress={() => setCategory(c.key)} style={[styles.chip, on && styles.chipOn]}>
                      <Ionicons name={c.icon} size={14} color={on ? "#FFF" : PURPLE} />
                      <Text style={[styles.chipTxt, on && { color: "#FFF" }]}>{c.key}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.hint}>{cats.find((c) => c.key === category)?.hint}</Text>
            </View>
            {!isPdf && (
              <View>
                <Text style={styles.label}>Contenuto</Text>
                {loadingContent ? (
                  <ActivityIndicator color={PURPLE} style={{ marginVertical: 20 }} />
                ) : (
                  <TextInput
                    testID="kb-editor-content"
                    value={content}
                    onChangeText={setContent}
                    multiline
                    textAlignVertical="top"
                    placeholder={"D: Quanto costa l'attivazione?\nR: 23,50 € una tantum in prima bolletta.\n\nSepara le voci con una riga vuota."}
                    placeholderTextColor="#94A3B8"
                    style={[styles.input, styles.textarea]}
                    editable={!saving}
                  />
                )}
                <Text style={styles.hint}>{content.trim().length} caratteri · minimo 10 · massimo 60.000</Text>
              </View>
            )}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable onPress={() => !saving && onClose()} style={[styles.btn, { backgroundColor: "#F1F5F9" }]} testID="kb-editor-cancel">
              <Text style={{ color: "#1B2B4B", fontWeight: "700" }}>Annulla</Text>
            </Pressable>
            <Pressable onPress={save} disabled={!canSave} style={[styles.btn, { backgroundColor: canSave ? PURPLE : "#C4B5FD", flex: 2 }]} testID="kb-editor-save">
              {saving ? <ActivityIndicator color="#FFF" size="small" /> : <Ionicons name="checkmark" size={18} color="#FFF" />}
              <Text style={styles.btnTxt}>{isEdit ? "Salva modifiche" : "Aggiungi alla knowledge base"}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  back: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  card: { backgroundColor: "#FFF", borderTopLeftRadius: 22, borderTopRightRadius: 22, overflow: "hidden" },
  hdr: { flexDirection: "row", alignItems: "center", gap: 10, padding: 16, borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  hdrIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: PURPLE, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 16, fontWeight: "800", color: "#1B2B4B" },
  sub: { fontSize: 11, color: "#64748B", marginTop: 2 },
  label: { fontSize: 12, fontWeight: "800", color: "#475569", marginBottom: 6 },
  input: { backgroundColor: "#F8FAFC", borderRadius: 12, borderWidth: 1, borderColor: "#E5E7EB", paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: "#1B2B4B", minHeight: 44 },
  textarea: { minHeight: 170, maxHeight: 280, lineHeight: 20, paddingTop: 10 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1.5, borderColor: PURPLE, minHeight: 36 },
  chipOn: { backgroundColor: PURPLE },
  chipTxt: { fontSize: 12, fontWeight: "800", color: PURPLE },
  hint: { fontSize: 11, color: "#94A3B8", fontStyle: "italic", marginTop: 6 },
  footer: { flexDirection: "row", gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: "#E5E7EB" },
  btn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 46, borderRadius: 12 },
  btnTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
});

export default KbEntryEditorModal;

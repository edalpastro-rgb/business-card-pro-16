/**
 * V50.z144 — Editor voce Knowledge Base Axon (FAQ / Dati ricorrenti / Nota / rinomina PDF).
 * Create: POST /api/master-docs {name, kind:"text", category, content}
 * Update: PUT  /api/master-docs/{doc_id} {name?, category?, content?}  (content solo per kind=text)
 * Regola modal: footer FISSO con Salva + Annulla sempre visibili.
 */
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Modal, Pressable, TextInput, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform, useWindowDimensions, Keyboard } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useInsetsSafe } from "@/src/hooks/useSafeBottom";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { openInAppLink } from "@/src/utils/openInAppLink";

type KbDocLink = { name: string; mime: string; url: string; download_url: string };
type KbDocText = { name: string; has_file: boolean; pages: { page: number; text: string }[] };

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
  const insets = useInsetsSafe(); // V50.z165 — fallback bottom dentro Modal
  const { height: winH } = useWindowDimensions();
  const isEdit = !!doc;
  const isPdf = (doc?.kind || (doc ? "pdf" : "text")) === "pdf";
  const [name, setName] = useState("");
  const [category, setCategory] = useState<KbCategory>("FAQ");
  const [content, setContent] = useState("");
  const [loadingContent, setLoadingContent] = useState(false);
  const [saving, setSaving] = useState(false);
  // V50.z185 — PDF: apri/scarica l'originale (Object Storage) o leggi il testo estratto (sempre disponibile)
  const router = useRouter();
  const [pdfBusy, setPdfBusy] = useState<"open" | "download" | "text" | null>(null);
  const [textView, setTextView] = useState<KbDocText | null>(null);
  // V50.z39-pattern — dentro Modal transparent su Android KeyboardAvoidingView non funziona:
  // spingiamo la card sopra la tastiera con un listener manuale (campi Titolo/Contenuto non più coperti).
  const [kbHeight, setKbHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const s = Keyboard.addListener("keyboardDidShow", (e) => setKbHeight(e.endCoordinates?.height || 0));
    const h = Keyboard.addListener("keyboardDidHide", () => setKbHeight(0));
    return () => { s.remove(); h.remove(); };
  }, []);

  useEffect(() => {
    if (!visible) return;
    setTextView(null);
    setPdfBusy(null);
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

  const showExtractedText = async () => {
    if (!doc) return;
    setPdfBusy("text");
    try {
      const t = await api<KbDocText>(`/master-docs/${doc.doc_id}/text`);
      setTextView(t);
    } catch (e: any) {
      notify("Testo non disponibile", e?.message || String(e));
    } finally {
      setPdfBusy(null);
    }
  };

  const openOrDownloadPdf = async (mode: "open" | "download") => {
    if (!doc) return;
    setPdfBusy(mode);
    try {
      const link = await api<KbDocLink>(`/master-docs/${doc.doc_id}/link`, { method: "POST" });
      if (mode === "open") {
        if (Platform.OS === "web") {
          if (typeof window !== "undefined") window.open(link.url, "_blank", "noopener");
          return;
        }
        const url = Platform.OS === "android" ? `https://docs.google.com/viewer?embedded=true&url=${encodeURIComponent(link.url)}` : link.url;
        onClose();
        openInAppLink(router, url, { title: link.name });
        return;
      }
      if (Platform.OS === "web") {
        if (typeof window !== "undefined") window.open(link.download_url, "_blank", "noopener");
        return;
      }
      const safe = (link.name || "documento.pdf").replace(/[^\w.\-àèéìòù ]+/gi, "_");
      const dest = `${FileSystem.cacheDirectory}kb-${safe}`;
      const res = await FileSystem.downloadAsync(link.download_url, dest);
      if (res.status && res.status >= 400) throw new Error(`Download fallito (HTTP ${res.status})`);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(res.uri, { mimeType: "application/pdf", dialogTitle: link.name, UTI: "com.adobe.pdf" });
      } else {
        throw new Error("Condivisione non disponibile su questo dispositivo");
      }
    } catch (e: any) {
      const msg = e?.message || String(e);
      // PDF caricato prima di V50.z185 (nessun file originale) → offri il testo estratto
      if (/originale non disponibile/i.test(msg)) {
        notify("PDF originale non disponibile", "Caricato prima dell'aggiornamento: mostro il testo estratto. Ricaricalo per aprire il PDF.");
        await showExtractedText();
      } else {
        notify("Apertura fallita", msg);
      }
    } finally {
      setPdfBusy(null);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={() => !saving && onClose()}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.back}>
        <View style={[styles.card, { maxHeight: Math.max(winH * 0.92 - kbHeight, 320), paddingBottom: Math.max(insets.bottom, 12), marginBottom: kbHeight }]}>
          <View style={styles.hdr}>
            <View style={styles.hdrIcon}><Ionicons name={isEdit ? "create" : "add"} size={18} color="#FFF" /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{textView ? "Testo estratto" : isEdit ? (isPdf ? "Modifica documento" : "Modifica voce") : "Nuova voce knowledge base"}</Text>
              <Text style={styles.sub}>{textView ? `${textView.pages.length} pagine · quello che Axon legge` : isPdf ? "Apri il PDF, rinomina o cambia categoria" : "Axon la caricherà nel contesto quando la domanda è pertinente"}</Text>
            </View>
            <Pressable onPress={() => !saving && onClose()} hitSlop={10} testID="kb-editor-close">
              <Ionicons name="close" size={22} color="#1B2B4B" />
            </Pressable>
          </View>

          {textView ? (
            <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ padding: 14, gap: 14 }} testID="kb-editor-textview">
              {textView.pages.length === 0 && <Text style={styles.hint}>Nessun testo estratto per questo documento.</Text>}
              {textView.pages.map((p) => (
                <View key={p.page}>
                  <Text style={styles.pageLabel}>Pagina {p.page}</Text>
                  <Text style={styles.pageText} selectable>{p.text}</Text>
                </View>
              ))}
            </ScrollView>
          ) : (
          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ padding: 14, gap: 12 }} keyboardShouldPersistTaps="handled">
            {isPdf && isEdit && (
              <View style={styles.pdfBox}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Ionicons name="document-text" size={18} color={PURPLE} />
                  <Text style={[styles.label, { marginBottom: 0, flex: 1 }]}>File PDF caricato</Text>
                </View>
                <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                  <Pressable onPress={() => openOrDownloadPdf("open")} disabled={!!pdfBusy} style={[styles.chip, styles.chipOn]} testID="kb-editor-open-pdf">
                    {pdfBusy === "open" ? <ActivityIndicator size="small" color="#FFF" /> : <Ionicons name="eye" size={14} color="#FFF" />}
                    <Text style={[styles.chipTxt, { color: "#FFF" }]}>Apri PDF</Text>
                  </Pressable>
                  <Pressable onPress={() => openOrDownloadPdf("download")} disabled={!!pdfBusy} style={styles.chip} testID="kb-editor-download-pdf">
                    {pdfBusy === "download" ? <ActivityIndicator size="small" color={PURPLE} /> : <Ionicons name="download-outline" size={14} color={PURPLE} />}
                    <Text style={styles.chipTxt}>Scarica</Text>
                  </Pressable>
                  <Pressable onPress={showExtractedText} disabled={!!pdfBusy} style={styles.chip} testID="kb-editor-show-text">
                    {pdfBusy === "text" ? <ActivityIndicator size="small" color={PURPLE} /> : <Ionicons name="reader-outline" size={14} color={PURPLE} />}
                    <Text style={styles.chipTxt}>Testo estratto</Text>
                  </Pressable>
                </View>
              </View>
            )}
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
          )}

          <View style={styles.footer}>
            {textView ? (
              <Pressable onPress={() => setTextView(null)} style={[styles.btn, { backgroundColor: "#F1F5F9" }]} testID="kb-editor-text-back">
                <Ionicons name="arrow-back" size={16} color="#1B2B4B" />
                <Text style={{ color: "#1B2B4B", fontWeight: "700" }}>Torna alla modifica</Text>
              </Pressable>
            ) : (
              <>
                <Pressable onPress={() => !saving && onClose()} style={[styles.btn, { backgroundColor: "#F1F5F9" }]} testID="kb-editor-cancel">
                  <Text style={{ color: "#1B2B4B", fontWeight: "700" }}>Annulla</Text>
                </Pressable>
                <Pressable onPress={save} disabled={!canSave} style={[styles.btn, { backgroundColor: canSave ? PURPLE : "#C4B5FD", flex: 2 }]} testID="kb-editor-save">
                  {saving ? <ActivityIndicator color="#FFF" size="small" /> : <Ionicons name="checkmark" size={18} color="#FFF" />}
                  <Text style={styles.btnTxt}>{isEdit ? "Salva modifiche" : "Aggiungi alla knowledge base"}</Text>
                </Pressable>
              </>
            )}
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
  pdfBox: { backgroundColor: "#F5F3FF", borderRadius: 12, borderWidth: 1, borderColor: "#DDD6FE", padding: 12, gap: 10 },
  pageLabel: { fontSize: 11, fontWeight: "800", color: PURPLE, marginBottom: 4 },
  pageText: { fontSize: 13, lineHeight: 19, color: "#1B2B4B" },
  btn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 46, borderRadius: 12 },
  btnTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
});

export default KbEntryEditorModal;

/**
 * V50.v — Editor Libretto Informativo (solo Super Master)
 *
 * Funzionalità:
 *  - Lista sezioni riordinabili
 *  - Editor sezione: titolo, sottotitolo, colore, emoji, paragrafi, tips,
 *    warning, immagine (bundled key o upload da galleria)
 *  - Modifica meta (titolo generale, sottotitolo, versione, footer)
 *  - Salva (PUT /libretto/content) / Reset al default
 */
import React, { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput, Image,
  ActivityIndicator, Alert, Modal, KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AndroidKeyboardPadding } from "@/src/keyboard/AndroidKeyboardPadding"; // V50.z186 — tastiera Android dentro Modal
import { useInsetsSafe } from "@/src/hooks/useSafeBottom";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import {
  LIBRETTO_SECTIONS, LIBRETTO_META, LibrettoSection, LibrettoMeta,
  LIBRETTO_IMAGE_KEYS, resolveSectionImage,
} from "@/src/libretto/libretto-content";

const COLORS_PRESET = [
  "#1C4869", "#0F766E", "#4C1D95", "#EA580C", "#1D4ED8", "#16A34A",
  "#DB2777", "#0891B2", "#7C3AED", "#B91C1C", "#0F9D58", "#F59E0B",
  "#1E40AF", "#A21CAF", "#0EA5E9", "#475569", "#CA8A04", "#64748B",
];

const EMOJI_PRESET = [
  "📘", "📲", "🔐", "🏠", "👥", "➕", "📅", "💳", "🤖", "🎓",
  "☁️", "🚗", "👑", "🖼️", "📊", "⚙️", "💡", "❓", "🔥", "🎯",
  "🚀", "⭐", "✨", "📌",
];

function uid(): string {
  return `sec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export default function LibrettoEditorScreen() {
  const router = useRouter();
  const insets = useInsetsSafe(); // V50.z165 — fallback bottom dentro Modal
  const bottomInset = Math.max(insets.bottom, 12);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sections, setSections] = useState<LibrettoSection[]>(LIBRETTO_SECTIONS);
  const [meta, setMeta] = useState<LibrettoMeta>(LIBRETTO_META);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [showMeta, setShowMeta] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await api<any>("/libretto/content");
        if (r && !r.is_default && Array.isArray(r.sections) && r.sections.length > 0) {
          setSections(r.sections);
          if (r.meta) setMeta(r.meta);
        }
      } catch { /* keep default */ }
      finally { setLoading(false); }
    })();
  }, []);

  const move = (idx: number, dir: -1 | 1) => {
    setSections((prev) => {
      const next = [...prev];
      const t = idx + dir;
      if (t < 0 || t >= next.length) return prev;
      [next[idx], next[t]] = [next[t], next[idx]];
      return next;
    });
  };

  const removeSection = (idx: number) => {
    Alert.alert("Rimuovi sezione", "Sei sicuro? Verrà eliminata al prossimo salvataggio.", [
      { text: "Annulla", style: "cancel" },
      {
        text: "Rimuovi", style: "destructive", onPress: () => {
          setSections((prev) => prev.filter((_, i) => i !== idx));
        }
      },
    ]);
  };

  const addSection = () => {
    const empty: LibrettoSection = {
      id: uid(),
      icon: "book",
      emoji: "📘",
      color: "#1C4869",
      title: "Nuova sezione",
      subtitle: "",
      paragraphs: ["Testo del paragrafo…"],
      tips: [],
    };
    setSections((prev) => [...prev, empty]);
    setEditIdx(sections.length);
  };

  const updateSection = (idx: number, patch: Partial<LibrettoSection>) => {
    setSections((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

  const save = async () => {
    if (sections.length === 0) {
      notify("Errore", "Almeno una sezione è richiesta");
      return;
    }
    setSaving(true);
    try {
      // Sanitize: rimuovi null/undefined dai campi opzionali per il backend
      const clean = sections.map((s) => ({
        id: s.id,
        icon: s.icon || "book",
        emoji: s.emoji || "📘",
        color: s.color || "#1C4869",
        title: s.title || "Senza titolo",
        subtitle: s.subtitle || null,
        paragraphs: (s.paragraphs || []).filter((p) => (p || "").trim().length > 0),
        tips: (s.tips || []).filter((t) => (t.text || "").trim().length > 0),
        mockup: s.mockup && s.mockup.lines.length ? s.mockup : null,
        warning: s.warning || null,
        image_key: s.image_key || null,
        image_data_url: s.image_data_url || null,
      }));
      await api("/libretto/content", { method: "PUT", body: { meta, sections: clean } });
      notify("Libretto salvato ✅", "Le modifiche sono ora visibili a tutti");
      router.back();
    } catch (e: any) {
      notify("Errore salvataggio", e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  const resetDefault = () => {
    Alert.alert(
      "Ripristina default",
      "Riporta il libretto alla versione originale? La tua personalizzazione andrà persa.",
      [
        { text: "Annulla", style: "cancel" },
        {
          text: "Ripristina", style: "destructive", onPress: async () => {
            setSaving(true);
            try {
              await api("/libretto/content/reset", { method: "POST" });
              setSections(LIBRETTO_SECTIONS);
              setMeta(LIBRETTO_META);
              notify("Ripristinato", "Libretto tornato al contenuto di default");
            } catch (e: any) {
              notify("Errore", e?.message || String(e));
            } finally { setSaving(false); }
          }
        },
      ],
    );
  };

  const currentSection = editIdx != null ? sections[editIdx] : null;

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#FBBF24" />
          <Text style={styles.loadingTxt}>Caricamento libretto…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.headerBar}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.hBtn}>
          <Ionicons name="chevron-back" size={24} color="#FFF" />
        </Pressable>
        <Text style={styles.hTitle}>Editor Libretto</Text>
        <Pressable onPress={resetDefault} hitSlop={10} style={styles.hBtn} testID="reset-libretto-btn">
          <Ionicons name="refresh" size={20} color="#94A3B8" />
        </Pressable>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, paddingBottom: 120 + bottomInset }}>
        {/* META */}
        <Pressable onPress={() => setShowMeta(true)} style={styles.metaCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.metaLabel}>Copertina & Meta</Text>
            <Text style={styles.metaTitle}>{meta.title}</Text>
            <Text style={styles.metaSub}>{meta.subtitle}</Text>
            <Text style={styles.metaVer}>{meta.version}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#94A3B8" />
        </Pressable>

        <Text style={styles.groupTitle}>{sections.length} Sezioni</Text>

        {sections.map((s, i) => {
          const img = resolveSectionImage(s);
          return (
            <View key={s.id} style={[styles.sectionRow, { borderLeftColor: s.color }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Text style={styles.rowEmoji}>{s.emoji}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{s.title}</Text>
                  {s.subtitle ? <Text style={styles.rowSub} numberOfLines={1}>{s.subtitle}</Text> : null}
                </View>
                {img ? (
                  <Image source={img as any} style={styles.rowThumb} resizeMode="cover" />
                ) : null}
              </View>
              <View style={styles.rowActions}>
                <Pressable onPress={() => move(i, -1)} disabled={i === 0} style={[styles.miniBtn, i === 0 && { opacity: 0.3 }]}>
                  <Ionicons name="chevron-up" size={16} color="#0F172A" />
                </Pressable>
                <Pressable onPress={() => move(i, 1)} disabled={i === sections.length - 1} style={[styles.miniBtn, i === sections.length - 1 && { opacity: 0.3 }]}>
                  <Ionicons name="chevron-down" size={16} color="#0F172A" />
                </Pressable>
                <Pressable onPress={() => setEditIdx(i)} style={[styles.miniBtn, { backgroundColor: "#FBBF24" }]}>
                  <Ionicons name="create-outline" size={16} color="#0F172A" />
                </Pressable>
                <Pressable onPress={() => removeSection(i)} style={[styles.miniBtn, { backgroundColor: "#FEE2E2" }]}>
                  <Ionicons name="trash" size={16} color="#DC2626" />
                </Pressable>
              </View>
            </View>
          );
        })}

        <Pressable onPress={addSection} style={styles.addBtn}>
          <Ionicons name="add-circle" size={22} color="#FBBF24" />
          <Text style={styles.addBtnTxt}>Aggiungi sezione</Text>
        </Pressable>
      </ScrollView>

      {/* Sticky save */}
      <View style={[styles.sticky, { paddingBottom: bottomInset + 10 }]}>
        <Pressable
          onPress={save}
          disabled={saving}
          testID="libretto-save-btn"
          style={[styles.saveBtn, saving && { opacity: 0.6 }]}
        >
          {saving ? <ActivityIndicator color="#0F172A" /> : (
            <>
              <Ionicons name="save" size={18} color="#0F172A" />
              <Text style={styles.saveBtnTxt}>Salva libretto</Text>
            </>
          )}
        </Pressable>
      </View>

      {/* MODAL META */}
      <MetaEditor
        visible={showMeta}
        meta={meta}
        onChange={setMeta}
        onClose={() => setShowMeta(false)}
      />

      {/* MODAL SEZIONE */}
      {currentSection ? (
        <SectionEditor
          section={currentSection}
          onChange={(patch) => updateSection(editIdx as number, patch)}
          onClose={() => setEditIdx(null)}
        />
      ) : null}
    </SafeAreaView>
  );
}

/* ─── META EDITOR ─────────────────────────────────────────────────────── */
function MetaEditor({ visible, meta, onChange, onClose }: {
  visible: boolean; meta: LibrettoMeta; onChange: (m: LibrettoMeta) => void; onClose: () => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
        <View style={styles.headerBar}>
          <Pressable onPress={onClose} hitSlop={10} style={styles.hBtn}>
            <Ionicons name="close" size={24} color="#FFF" />
          </Pressable>
          <Text style={styles.hTitle}>Copertina</Text>
          <View style={{ width: 30 }} />
        </View>
        <AndroidKeyboardPadding><ScrollView contentContainerStyle={{ padding: 14, gap: 12 }} keyboardShouldPersistTaps="handled">
          <Field label="Titolo" value={meta.title} onChange={(t) => onChange({ ...meta, title: t })} />
          <Field label="Sottotitolo" value={meta.subtitle} onChange={(t) => onChange({ ...meta, subtitle: t })} multiline />
          <Field label="Versione" value={meta.version} onChange={(t) => onChange({ ...meta, version: t })} />
          <Field label="Footer" value={meta.footer} onChange={(t) => onChange({ ...meta, footer: t })} />
        </ScrollView></AndroidKeyboardPadding>
      </SafeAreaView>
    </Modal>
  );
}

/* ─── SECTION EDITOR ──────────────────────────────────────────────────── */
function SectionEditor({ section, onChange, onClose }: {
  section: LibrettoSection; onChange: (p: Partial<LibrettoSection>) => void; onClose: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const imgSrc = resolveSectionImage(section);

  const pickImage = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        notify("Permesso negato", "Serve accesso alla galleria per caricare un'immagine");
        return;
      }
      const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.85,
        allowsEditing: false,
      });
      if (r.canceled || !r.assets?.[0]?.uri) return;
      setUploading(true);
      // Comprimi a max 1200px lato lungo, qualità 0.75, JPEG
      const compressed = await ImageManipulator.manipulateAsync(
        r.assets[0].uri,
        [{ resize: { width: 1200 } }],
        { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      if (!compressed.base64) throw new Error("Compressione fallita");
      const dataUrl = `data:image/jpeg;base64,${compressed.base64}`;
      // Sicurezza dimensione (~< 500KB base64)
      if (dataUrl.length > 700_000) {
        notify("Immagine troppo grande", "Prova un'immagine più piccola (max ~500KB)");
      } else {
        onChange({ image_data_url: dataUrl, image_key: null });
      }
    } catch (e: any) {
      notify("Errore immagine", e?.message || String(e));
    } finally { setUploading(false); }
  };

  const clearImage = () => onChange({ image_data_url: null, image_key: null });

  const updateParagraph = (i: number, v: string) => {
    const next = [...(section.paragraphs || [])];
    next[i] = v;
    onChange({ paragraphs: next });
  };
  const addParagraph = () => onChange({ paragraphs: [...(section.paragraphs || []), ""] });
  const removeParagraph = (i: number) => {
    onChange({ paragraphs: (section.paragraphs || []).filter((_, x) => x !== i) });
  };

  const updateTip = (i: number, patch: Partial<{ emoji: string; text: string }>) => {
    const next = [...(section.tips || [])];
    next[i] = { ...next[i], ...patch };
    onChange({ tips: next });
  };
  const addTip = () => onChange({ tips: [...(section.tips || []), { emoji: "💡", text: "" }] });
  const removeTip = (i: number) => onChange({ tips: (section.tips || []).filter((_, x) => x !== i) });

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
        <View style={styles.headerBar}>
          {/* V50.z6 — chevron-back (chiaro "torna al libretto") al posto della
              spunta verde che gli utenti non capivano come "salva". Il vero
              "Salva sezione" è nel bottone sticky in fondo. */}
          <Pressable onPress={onClose} hitSlop={10} style={styles.hBtn} testID="section-editor-back">
            <Ionicons name="chevron-back" size={24} color="#FFF" />
          </Pressable>
          <Text style={styles.hTitle}>Modifica Sezione</Text>
          <View style={{ width: 30 }} />
        </View>
        <AndroidKeyboardPadding><KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ padding: 14, gap: 14, paddingBottom: 100 }} keyboardShouldPersistTaps="handled">
            <Field label="Titolo" value={section.title} onChange={(t) => onChange({ title: t })} />
            <Field label="Sottotitolo" value={section.subtitle || ""} onChange={(t) => onChange({ subtitle: t })} />

            {/* Emoji picker */}
            <Text style={styles.fieldLabel}>Emoji</Text>
            <View style={styles.gridRow}>
              {EMOJI_PRESET.map((e) => (
                <Pressable key={e} onPress={() => onChange({ emoji: e })} style={[styles.emojiPill, section.emoji === e && styles.emojiPillActive]}>
                  <Text style={styles.emojiTxt}>{e}</Text>
                </Pressable>
              ))}
            </View>

            {/* Color picker */}
            <Text style={styles.fieldLabel}>Colore</Text>
            <View style={styles.gridRow}>
              {COLORS_PRESET.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => onChange({ color: c })}
                  style={[styles.colorSwatch, { backgroundColor: c }, section.color === c && styles.colorSwatchActive]}
                />
              ))}
            </View>

            {/* Image */}
            <Text style={styles.fieldLabel}>Immagine</Text>
            {imgSrc ? (
              <View style={styles.imgPreviewWrap}>
                <Image source={imgSrc as any} style={styles.imgPreview} resizeMode="contain" />
                <Pressable onPress={clearImage} style={styles.imgClearBtn}>
                  <Ionicons name="close-circle" size={22} color="#DC2626" />
                </Pressable>
              </View>
            ) : (
              <View style={styles.imgEmpty}><Ionicons name="image-outline" size={30} color="#94A3B8" /><Text style={styles.imgEmptyTxt}>Nessuna immagine</Text></View>
            )}
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              <Pressable onPress={pickImage} disabled={uploading} style={styles.ctaBtn}>
                {uploading ? <ActivityIndicator color="#0F172A" /> : (
                  <>
                    <Ionicons name="cloud-upload" size={16} color="#0F172A" />
                    <Text style={styles.ctaBtnTxt}>Carica foto</Text>
                  </>
                )}
              </Pressable>
            </View>

            {/* Or select bundled image */}
            <Text style={styles.fieldLabelSm}>Oppure usa una foto già inclusa nell&apos;app:</Text>
            <View style={styles.gridRow}>
              <Pressable onPress={() => onChange({ image_key: null, image_data_url: null })} style={[styles.keyPill, !section.image_key && !section.image_data_url && styles.keyPillActive]}>
                <Text style={styles.keyTxt}>Nessuna</Text>
              </Pressable>
              {LIBRETTO_IMAGE_KEYS.map((k) => (
                <Pressable
                  key={k}
                  onPress={() => onChange({ image_key: k, image_data_url: null })}
                  style={[styles.keyPill, section.image_key === k && !section.image_data_url && styles.keyPillActive]}
                >
                  <Text style={styles.keyTxt}>{k}</Text>
                </Pressable>
              ))}
            </View>

            {/* Paragraphs */}
            <Text style={styles.fieldLabel}>Paragrafi</Text>
            {(section.paragraphs || []).map((p, i) => (
              <View key={i} style={styles.paraRow}>
                <TextInput
                  value={p}
                  onChangeText={(t) => updateParagraph(i, t)}
                  multiline
                  style={styles.paraInput}
                  placeholder="Testo del paragrafo…"
                  placeholderTextColor="#94A3B8"
                />
                <Pressable onPress={() => removeParagraph(i)} style={styles.paraRemove}>
                  <Ionicons name="trash" size={16} color="#DC2626" />
                </Pressable>
              </View>
            ))}
            <Pressable onPress={addParagraph} style={styles.smallAddBtn}>
              <Ionicons name="add" size={16} color="#0F172A" />
              <Text style={styles.smallAddTxt}>Aggiungi paragrafo</Text>
            </Pressable>

            {/* Tips */}
            <Text style={styles.fieldLabel}>Consigli / Tips</Text>
            {(section.tips || []).map((t, i) => (
              <View key={i} style={styles.tipRow}>
                <TextInput
                  value={t.emoji}
                  onChangeText={(v) => updateTip(i, { emoji: v })}
                  style={styles.tipEmojiInput}
                  maxLength={4}
                />
                <TextInput
                  value={t.text}
                  onChangeText={(v) => updateTip(i, { text: v })}
                  style={styles.tipTxtInput}
                  placeholder="Suggerimento…"
                  placeholderTextColor="#94A3B8"
                />
                <Pressable onPress={() => removeTip(i)} style={styles.paraRemove}>
                  <Ionicons name="trash" size={16} color="#DC2626" />
                </Pressable>
              </View>
            ))}
            <Pressable onPress={addTip} style={styles.smallAddBtn}>
              <Ionicons name="add" size={16} color="#0F172A" />
              <Text style={styles.smallAddTxt}>Aggiungi tip</Text>
            </Pressable>

            {/* Warning */}
            <Field
              label="Avviso importante (opzionale)"
              value={section.warning || ""}
              onChange={(t) => onChange({ warning: t || null })}
              multiline
            />
          </ScrollView>
          {/* V50.z6 — Sticky "Salva sezione" button at bottom (chiaro CTA,
              sostituisce la spunta verde nell'header che gli utenti non
              capivano). Il vero salvataggio backend avviene con il bottone
              "Salva libretto" nel main editor. */}
          <View style={styles.sectionEditorSticky}>
            <Pressable onPress={onClose} style={styles.sectionEditorSaveBtn} testID="section-editor-save">
              <Ionicons name="save" size={18} color="#0F172A" />
              <Text style={styles.sectionEditorSaveTxt}>Salva sezione</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView></AndroidKeyboardPadding>
      </SafeAreaView>
    </Modal>
  );
}

/* ─── FIELD helper ────────────────────────────────────────────────────── */
function Field({ label, value, onChange, multiline }: {
  label: string; value: string; onChange: (t: string) => void; multiline?: boolean;
}) {
  return (
    <View>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        multiline={multiline}
        style={[styles.textInput, multiline && { minHeight: 68, textAlignVertical: "top" }]}
        placeholderTextColor="#94A3B8"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0F2438" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  loadingTxt: { color: "#FFF" },
  headerBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 10, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.08)",
  },
  hBtn: { padding: 6, minWidth: 30 },
  hTitle: { color: "#FFF", fontSize: 16, fontWeight: "900" },

  // META card
  metaCard: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: "#FBBF24", padding: 12, borderRadius: 12, marginBottom: 12, gap: 6,
  },
  metaLabel: { color: "#78350F", fontSize: 11, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase" },
  metaTitle: { color: "#0F172A", fontSize: 16, fontWeight: "900", marginTop: 2 },
  metaSub: { color: "#334155", fontSize: 12, marginTop: 2 },
  metaVer: { color: "#78350F", fontSize: 11, fontWeight: "700", marginTop: 3 },

  groupTitle: { color: "rgba(255,255,255,0.9)", fontSize: 13, fontWeight: "800", marginTop: 8, marginBottom: 6, letterSpacing: 0.3, textTransform: "uppercase" },

  sectionRow: {
    backgroundColor: "#FFF", borderRadius: 12, padding: 12, marginBottom: 8,
    borderLeftWidth: 4,
  },
  rowEmoji: { fontSize: 28 },
  rowTitle: { color: "#0F172A", fontWeight: "800", fontSize: 14 },
  rowSub: { color: "#64748B", fontSize: 12, marginTop: 2 },
  rowThumb: { width: 40, height: 40, borderRadius: 6, backgroundColor: "#E2E8F0" },
  rowActions: { flexDirection: "row", gap: 6, marginTop: 8, justifyContent: "flex-end" },
  miniBtn: {
    width: 34, height: 30, alignItems: "center", justifyContent: "center",
    borderRadius: 6, backgroundColor: "#E2E8F0",
  },

  addBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 14, borderRadius: 12,
    backgroundColor: "rgba(251,191,36,0.15)", borderWidth: 1, borderColor: "rgba(251,191,36,0.4)", borderStyle: "dashed",
    marginTop: 10,
  },
  addBtnTxt: { color: "#FBBF24", fontWeight: "900", fontSize: 14 },

  sticky: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(15,36,56,0.98)",
    paddingHorizontal: 14, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)",
  },
  saveBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: "#FBBF24", paddingVertical: 14, borderRadius: 999,
  },
  saveBtnTxt: { color: "#0F172A", fontWeight: "900", fontSize: 15 },

  // Field / Input styles
  fieldLabel: { color: "rgba(255,255,255,0.85)", fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 },
  fieldLabelSm: { color: "rgba(255,255,255,0.6)", fontSize: 11, marginTop: 4 },
  textInput: {
    backgroundColor: "#FFF", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    color: "#0F172A", fontSize: 14,
  },

  gridRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  emojiPill: {
    width: 42, height: 42, alignItems: "center", justifyContent: "center",
    borderRadius: 8, backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1, borderColor: "transparent",
  },
  emojiPillActive: { borderColor: "#FBBF24", backgroundColor: "rgba(251,191,36,0.15)" },
  emojiTxt: { fontSize: 22 },

  colorSwatch: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: "transparent" },
  colorSwatchActive: { borderColor: "#FFF" },

  keyPill: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1, borderColor: "transparent",
  },
  keyPillActive: { borderColor: "#FBBF24", backgroundColor: "rgba(251,191,36,0.15)" },
  keyTxt: { color: "#FFF", fontSize: 12, fontWeight: "700" },

  imgPreviewWrap: {
    backgroundColor: "#FFF", borderRadius: 10, padding: 8, position: "relative",
    alignItems: "center",
  },
  imgPreview: { width: "100%", height: 180 },
  imgClearBtn: { position: "absolute", top: 6, right: 6, backgroundColor: "#FFF", borderRadius: 12 },

  imgEmpty: {
    backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 10,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", borderStyle: "dashed",
    padding: 24, alignItems: "center", gap: 6,
  },
  imgEmptyTxt: { color: "rgba(255,255,255,0.6)", fontSize: 12 },

  ctaBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#FBBF24", paddingHorizontal: 12, paddingVertical: 10, borderRadius: 999,
  },
  ctaBtnTxt: { color: "#0F172A", fontWeight: "800", fontSize: 13 },

  paraRow: { flexDirection: "row", gap: 6, alignItems: "flex-start" },
  paraInput: {
    flex: 1, backgroundColor: "#FFF", borderRadius: 10, padding: 10,
    color: "#0F172A", fontSize: 13, minHeight: 60, textAlignVertical: "top",
  },
  paraRemove: {
    width: 34, height: 34, alignItems: "center", justifyContent: "center",
    borderRadius: 8, backgroundColor: "#FEE2E2",
  },

  tipRow: { flexDirection: "row", gap: 6, alignItems: "center" },
  tipEmojiInput: {
    width: 50, backgroundColor: "#FFF", borderRadius: 8, textAlign: "center",
    paddingVertical: 8, fontSize: 20, color: "#0F172A",
  },
  tipTxtInput: {
    flex: 1, backgroundColor: "#FFF", borderRadius: 10, padding: 10, color: "#0F172A", fontSize: 13,
  },

  smallAddBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: "rgba(255,255,255,0.1)",
    paddingVertical: 8, borderRadius: 8,
  },
  smallAddTxt: { color: "#FFF", fontWeight: "800", fontSize: 12 },

  // V50.z6 — Sticky "Salva sezione" bottom bar (rimpiazza la spunta verde in alto)
  sectionEditorSticky: {
    borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(15,36,56,0.98)",
    paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14,
  },
  sectionEditorSaveBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: "#FBBF24", paddingVertical: 14, borderRadius: 999,
    shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  sectionEditorSaveTxt: { color: "#0F172A", fontWeight: "900", fontSize: 15, letterSpacing: 0.2 },
});

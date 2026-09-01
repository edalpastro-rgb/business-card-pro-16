/**
 * V28.o — Azioni rapide personalizzabili per la chat Axon (Master-only).
 * Ogni azione ha: label (testo mostrato sul chip) + prompt (comando inviato ad Axon al tap).
 * Persistenza via PUT /api/user-settings body `{assistant_quick_actions: [...]}`.
 */
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Modal, TextInput, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";

import { useBottomSheetPadding } from "@/src/utils/bottomSheetInsets";
type QuickAction = { id: string; label: string; prompt: string };

const C = { primary: "#8B5CF6", primarySoft: "#F1EEFF", navy: "#1B2B4B", muted: "#94A3B8" };

// Preset suggeriti che il Master può aggiungere con un tap.
const PRESETS: { label: string; prompt: string }[] = [
  { label: "Prossimo appuntamento", prompt: "Qual è il mio prossimo appuntamento?" },
  { label: "Telefonate di oggi", prompt: "Quante telefonate ho fatto oggi?" },
  { label: "Clienti senza appuntamento", prompt: "Mostrami i clienti senza appuntamento futuro" },
  { label: "Ritelefonate urgenti", prompt: "Quali sono le ritelefonate urgenti da fare oggi?" },
  { label: "Contratti recenti", prompt: "Mostrami i contratti degli ultimi 30 giorni" },
  { label: "Compleanni del mese", prompt: "Chi compie gli anni questo mese?" },
  { label: "Analisi bolletta luce", prompt: "Riassumi le ultime bollette luce analizzate" },
  { label: "Report settimanale", prompt: "Prepara un riassunto della mia settimana lavorativa" },
];

export default function QuickActionsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const isMaster = !user?.parent_user_id && (user?.role || "member") === "owner";
  const [items, setItems] = useState<QuickAction[]>([]);
  const bottomPad = useBottomSheetPadding();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<Partial<QuickAction> | null>(null);

  const load = useCallback(async () => {
    if (!isMaster) return;
    try {
      setLoading(true);
      const s = await api<{ assistant_quick_actions?: QuickAction[] }>("/user-settings");
      setItems(Array.isArray(s?.assistant_quick_actions) ? s.assistant_quick_actions : []);
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile caricare le azioni");
    } finally { setLoading(false); }
  }, [isMaster]);

  useEffect(() => { load(); }, [load]);

  const persist = async (next: QuickAction[]) => {
    try {
      setBusy(true);
      const res = await api<{ assistant_quick_actions?: QuickAction[] }>("/user-settings", {
        method: "PUT",
        body: { assistant_quick_actions: next },
      });
      // Il backend ritorna la lista normalizzata (id assegnati, trim). Usiamola.
      setItems(Array.isArray(res?.assistant_quick_actions) ? res.assistant_quick_actions : next);
    } catch (e: any) {
      notify("Errore salvataggio", e?.message || "");
    } finally { setBusy(false); }
  };

  const addPreset = (p: { label: string; prompt: string }) => {
    // Evita duplicati esatti (stesso label + prompt)
    if (items.some((it) => it.label.toLowerCase() === p.label.toLowerCase() && it.prompt.toLowerCase() === p.prompt.toLowerCase())) {
      notify("Già presente", `"${p.label}" è già nell'elenco`);
      return;
    }
    persist([...items, { id: `qa_${Date.now().toString(36)}`, label: p.label, prompt: p.prompt }]);
  };

  const saveEdit = async () => {
    if (!edit) return;
    const label = (edit.label || "").trim();
    const prompt = (edit.prompt || "").trim();
    if (!label || !prompt) {
      notify("Dati mancanti", "Testo del pulsante e comando sono obbligatori");
      return;
    }
    let next: QuickAction[];
    if (edit.id) {
      next = items.map((it) => (it.id === edit.id ? { id: it.id, label, prompt } : it));
    } else {
      next = [...items, { id: `qa_${Date.now().toString(36)}`, label, prompt }];
    }
    await persist(next);
    setEdit(null);
  };

  const remove = async (id: string) => {
    await persist(items.filter((it) => it.id !== id));
  };

  const moveItem = async (id: string, dir: -1 | 1) => {
    const idx = items.findIndex((it) => it.id === id);
    if (idx < 0) return;
    const to = idx + dir;
    if (to < 0 || to >= items.length) return;
    const next = items.slice();
    const [it] = next.splice(idx, 1);
    next.splice(to, 0, it);
    await persist(next);
  };

  const resetDefaults = async () => {
    await persist([
      { id: `qa_${Date.now().toString(36)}_1`, label: "Prossimo appuntamento", prompt: "Qual è il mio prossimo appuntamento?" },
      { id: `qa_${Date.now().toString(36)}_2`, label: "Telefonate di oggi", prompt: "Quante telefonate ho fatto oggi?" },
      { id: `qa_${Date.now().toString(36)}_3`, label: "Clienti senza appuntamento", prompt: "Mostrami i clienti senza appuntamento futuro" },
      { id: `qa_${Date.now().toString(36)}_4`, label: "Ritelefonate urgenti", prompt: "Quali sono le ritelefonate urgenti da fare oggi?" },
    ]);
  };

  if (!isMaster) {
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={26} color={C.navy} /></Pressable>
          <Text style={styles.title}>Azioni rapide</Text>
          <View style={{ width: 26 }} />
        </View>
        <View style={{ padding: 40, alignItems: "center", gap: 10 }}>
          <Ionicons name="lock-closed" size={40} color={C.muted} />
          <Text style={{ fontWeight: "800", color: C.navy }}>Sezione riservata al Master</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={26} color={C.navy} /></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Azioni rapide</Text>
          <Text style={styles.sub}>Pulsanti mostrati nella schermata iniziale della chat Axon</Text>
        </View>
        <View style={styles.badge}><Ionicons name="sparkles" size={16} color="#FFF" /></View>
      </View>

      {loading ? <ActivityIndicator style={{ marginTop: 24 }} color={C.primary} /> : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 200, gap: 12 }}>
          {/* Add button */}
          <Pressable testID="qa-add-btn" onPress={() => setEdit({ label: "", prompt: "" })} style={styles.addBtn} disabled={busy}>
            <Ionicons name="add-circle" size={20} color="#FFF" />
            <Text style={styles.addBtnTxt}>Aggiungi azione rapida</Text>
          </Pressable>

          {/* Current items */}
          <Text style={styles.sectionLbl}>Le tue azioni ({items.length})</Text>
          {items.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="sparkles" size={26} color={C.muted} />
              <Text style={styles.emptyTxt}>Nessuna azione rapida. Aggiungi la prima o usa un preset qui sotto per iniziare.</Text>
              <Pressable testID="qa-reset-defaults" onPress={resetDefaults} style={styles.linkBtn} disabled={busy}>
                <Text style={styles.linkBtnTxt}>Ripristina i default</Text>
              </Pressable>
            </View>
          ) : items.map((it, idx) => (
            <View key={it.id} style={styles.card} testID={`qa-item-${it.id}`}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={styles.iconChip}><Ionicons name="sparkles" size={14} color={C.primary} /></View>
                <Text style={styles.cardTitle} numberOfLines={1}>{it.label}</Text>
                <Pressable testID={`qa-up-${it.id}`} onPress={() => moveItem(it.id, -1)} disabled={busy || idx === 0} hitSlop={8} style={{ opacity: idx === 0 ? 0.3 : 1 }}>
                  <Ionicons name="chevron-up" size={18} color={C.navy} />
                </Pressable>
                <Pressable testID={`qa-down-${it.id}`} onPress={() => moveItem(it.id, 1)} disabled={busy || idx === items.length - 1} hitSlop={8} style={{ opacity: idx === items.length - 1 ? 0.3 : 1 }}>
                  <Ionicons name="chevron-down" size={18} color={C.navy} />
                </Pressable>
                <Pressable testID={`qa-edit-${it.id}`} onPress={() => setEdit({ ...it })} hitSlop={8}><Ionicons name="pencil" size={16} color={C.primary} /></Pressable>
                <Pressable testID={`qa-del-${it.id}`} onPress={() => remove(it.id)} hitSlop={8}><Ionicons name="trash-outline" size={16} color="#DC2626" /></Pressable>
              </View>
              <Text style={styles.cardPromptLabel}>Comando inviato ad Axon:</Text>
              <Text style={styles.cardPrompt} numberOfLines={3}>{it.prompt}</Text>
            </View>
          ))}

          {/* Presets */}
          <Text style={[styles.sectionLbl, { marginTop: 8 }]}>Preset consigliati</Text>
          <Text style={styles.metaTxt}>Tocca un preset per aggiungerlo alla lista.</Text>
          <View style={styles.presetGrid}>
            {PRESETS.map((p, i) => (
              <Pressable
                key={`preset-${i}`}
                testID={`qa-preset-${i}`}
                onPress={() => addPreset(p)}
                style={styles.presetChip}
                disabled={busy}
              >
                <Ionicons name="add-circle-outline" size={14} color={C.primary} />
                <Text style={styles.presetTxt} numberOfLines={1}>{p.label}</Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      )}

      {/* Edit modal */}
      <Modal transparent visible={!!edit} animationType="slide" onRequestClose={() => setEdit(null)}>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { paddingBottom: bottomPad }]}>
            <View style={styles.sheetHdr}>
              <Text style={styles.sheetTitle}>{edit?.id ? "Modifica azione" : "Nuova azione rapida"}</Text>
              <Pressable onPress={() => setEdit(null)} hitSlop={10}><Ionicons name="close" size={22} color={C.navy} /></Pressable>
            </View>
            <ScrollView contentContainerStyle={{ paddingBottom: 20 }}>
              <Text style={styles.lbl}>Testo del pulsante</Text>
              <TextInput
                testID="qa-label-input"
                value={edit?.label || ""}
                onChangeText={(t) => setEdit((e) => ({ ...(e || {}), label: t }))}
                placeholder="Es. Ritelefonate urgenti"
                placeholderTextColor="#94A3B8"
                maxLength={80}
                style={styles.input}
              />
              <Text style={styles.helper}>Massimo 80 caratteri. Mostrato sul chip nella chat Axon.</Text>

              <Text style={styles.lbl}>Comando inviato ad Axon</Text>
              <TextInput
                testID="qa-prompt-input"
                value={edit?.prompt || ""}
                onChangeText={(t) => setEdit((e) => ({ ...(e || {}), prompt: t }))}
                placeholder="Es. Quali sono le ritelefonate urgenti da fare oggi?"
                placeholderTextColor="#94A3B8"
                multiline
                maxLength={2000}
                style={[styles.input, { minHeight: 100, textAlignVertical: "top" }]}
              />
              <Text style={styles.helper}>Al tap del pulsante, questo testo verrà inviato ad Axon come messaggio.</Text>

              <Pressable onPress={saveEdit} disabled={busy} style={[styles.saveBtn, { backgroundColor: busy ? C.muted : C.primary }]} testID="qa-save">
                {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.saveBtnTxt}>{edit?.id ? "Salva modifiche" : "Aggiungi azione"}</Text>}
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: "row", alignItems: "center", gap: 10, padding: 16, paddingBottom: 6 },
  title: { fontSize: 18, fontWeight: "800", color: C.navy, letterSpacing: -0.3 },
  sub: { fontSize: 11, color: C.muted, marginTop: 2, fontWeight: "600" },
  // V29.bc — Stile Optima
  badge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.9)",
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  sectionLbl: { fontSize: 11, fontWeight: "800", color: C.muted, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 4 },
  addBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: C.primary, paddingVertical: 13, borderRadius: 14 },
  addBtnTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
  card: { backgroundColor: "#FFF", borderRadius: 14, padding: 12, gap: 6, borderWidth: 1, borderColor: theme.color.border },
  // V29.bc — Stile Optima
  iconChip: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: C.primarySoft,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.85)",
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  cardTitle: { flex: 1, fontSize: 14, fontWeight: "800", color: C.navy },
  cardPromptLabel: { fontSize: 10, fontWeight: "800", color: C.muted, textTransform: "uppercase", letterSpacing: 0.4, marginTop: 2 },
  cardPrompt: { fontSize: 13, color: theme.color.onSurface, lineHeight: 18, fontStyle: "italic" },
  metaTxt: { fontSize: 11, color: C.muted, fontWeight: "600" },
  empty: { padding: 24, alignItems: "center", gap: 8, backgroundColor: "#FFF", borderRadius: 14, borderWidth: 1, borderColor: theme.color.border, borderStyle: "dashed" },
  emptyTxt: { color: C.muted, textAlign: "center", fontSize: 12, fontWeight: "600" },
  linkBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: C.primarySoft, marginTop: 4 },
  linkBtnTxt: { color: C.primary, fontWeight: "800", fontSize: 12 },
  presetGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  presetChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 999, backgroundColor: "#FFF", borderWidth: 1.5, borderColor: C.primary, maxWidth: "100%" },
  presetTxt: { fontSize: 12, fontWeight: "700", color: C.primary, flexShrink: 1 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#FFF", borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, paddingBottom: 30, maxHeight: "92%" },
  sheetHdr: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  sheetTitle: { fontSize: 17, fontWeight: "800", color: C.navy },
  lbl: { fontSize: 11, fontWeight: "800", color: C.muted, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 12, marginBottom: 4 },
  input: { backgroundColor: "#F1F5F9", borderRadius: 10, padding: 12, fontSize: 14, color: C.navy, marginBottom: 4 },
  helper: { fontSize: 11, color: C.muted, fontStyle: "italic", marginBottom: 4 },
  saveBtn: { padding: 14, borderRadius: 14, marginTop: 14, alignItems: "center" },
  saveBtnTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
});

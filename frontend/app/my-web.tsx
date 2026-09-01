import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, Modal, Linking, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";

import { useBottomSheetPadding, usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
type Link = { link_id: string; title: string; url: string; icon: string; order: number };

const ICONS = ["🔗","🔍","📊","📰","🏦","💼","⚡","🔥","📞","🌐","📈","🛒","💰","🎯","🔧"];

export default function MyWebScreen() {
  const router = useRouter();
  const [items, setItems] = useState<Link[]>([]);
  const bottomPad = useBottomSheetPadding();
  const pagePad = usePageBottomPadding();
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [icon, setIcon] = useState("🔗");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: Link[] }>("/web-links");
      setItems(r.items);
    } catch (e: any) { console.warn(e); } finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openLink = (u: string) => Linking.openURL(u).catch(() => notify("Errore", "Impossibile aprire il link"));

  const submit = async () => {
    if (!title.trim() || !url.trim()) { notify("Compila titolo e URL"); return; }
    try {
      setSaving(true);
      await api("/web-links", { method: "POST", body: { title: title.trim(), url: url.trim(), icon } });
      setAddOpen(false); setTitle(""); setUrl(""); setIcon("🔗");
      await load();
    } catch (e: any) { notify("Errore", e?.message || ""); } finally { setSaving(false); }
  };

  const remove = (lk: Link) => notify("Elimina", `Rimuovere "${lk.title}"?`, [
    { text: "Annulla", style: "cancel" },
    { text: "Elimina", style: "destructive", onPress: async () => { try { await api(`/web-links/${lk.link_id}`, { method: "DELETE" }); await load(); } catch (e: any) { notify("Errore", e?.message); } } },
  ]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.color.background }} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn}><Ionicons name="chevron-back" size={22} color={theme.color.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>My Web</Text>
        <Pressable onPress={() => setAddOpen(true)} testID="add-link-btn" style={[styles.headerBtn, { backgroundColor: "#DB2777" }]}><Ionicons name="add" size={22} color="#FFF" /></Pressable>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={theme.color.brandPrimary} />
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="globe-outline" size={48} color={theme.color.muted} />
          <Text style={styles.emptyTitle}>Nessun link salvato</Text>
          <Text style={styles.emptyTxt}>Salva qui i tuoi siti preferiti per accesso rapido.</Text>
          <Pressable onPress={() => setAddOpen(true)} style={styles.emptyBtn}><Ionicons name="add" size={18} color="#FFF" /><Text style={styles.emptyBtnTxt}>Aggiungi link</Text></Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: pagePad }}>
          <View style={styles.grid}>
            {items.map((lk) => (
              <View key={lk.link_id} style={styles.card}>
                <Pressable onPress={() => openLink(lk.url)} onLongPress={() => remove(lk)} style={styles.cardInner} testID={`link-${lk.link_id}`}>
                  <Text style={styles.cardIcon}>{lk.icon || "🔗"}</Text>
                  <Text style={styles.cardTitle} numberOfLines={2}>{lk.title}</Text>
                  <Text style={styles.cardUrl} numberOfLines={1}>{lk.url.replace(/^https?:\/\//, "")}</Text>
                </Pressable>
                <Pressable onPress={() => remove(lk)} style={styles.deleteBtn}><Ionicons name="close-circle" size={20} color="#DC2626" /></Pressable>
              </View>
            ))}
          </View>
        </ScrollView>
      )}

      <Modal transparent visible={addOpen} onRequestClose={() => setAddOpen(false)} animationType="slide">
        <Pressable style={styles.backdrop} onPress={() => setAddOpen(false)}>
          <View style={[styles.sheet, { paddingBottom: bottomPad }]} onStartShouldSetResponder={() => true}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Nuovo link</Text>
            <Text style={styles.label}>Titolo</Text>
            <TextInput value={title} onChangeText={setTitle} style={styles.input} placeholder="Es. Portale ENEL" testID="link-title-input" />
            <Text style={styles.label}>URL</Text>
            <TextInput value={url} onChangeText={setUrl} style={styles.input} placeholder="www.esempio.com" autoCapitalize="none" keyboardType="url" testID="link-url-input" />
            <Text style={styles.label}>Icona</Text>
            <View style={styles.iconRow}>
              {ICONS.map((e) => (
                <Pressable key={e} onPress={() => setIcon(e)} style={[styles.iconOpt, icon === e && styles.iconOptActive]}>
                  <Text style={{ fontSize: 22 }}>{e}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable onPress={submit} disabled={saving} style={styles.submitBtn} testID="link-save-btn">
              {saving ? <ActivityIndicator color="#FFF" /> : <Text style={styles.submitTxt}>Salva</Text>}
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", padding: 14, gap: 10, borderBottomWidth: 1, borderBottomColor: theme.color.border, backgroundColor: theme.color.surface },
  headerBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#F1F5F9", alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, fontSize: 16, fontWeight: "800", color: theme.color.onSurface },
  empty: { alignItems: "center", padding: 40, marginTop: 40 },
  emptyTitle: { fontSize: 16, fontWeight: "800", color: theme.color.onSurface, marginTop: 12 },
  emptyTxt: { fontSize: 12, color: theme.color.muted, marginTop: 4, textAlign: "center" },
  emptyBtn: { marginTop: 20, flexDirection: "row", gap: 6, alignItems: "center", backgroundColor: "#DB2777", paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10 },
  emptyBtnTxt: { color: "#FFF", fontWeight: "800" },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
  card: { width: "47%", backgroundColor: theme.color.surface, borderRadius: 14, marginBottom: 12, borderWidth: 1, borderColor: theme.color.border, position: "relative" },
  cardInner: { padding: 14, alignItems: "flex-start" },
  cardIcon: { fontSize: 32, marginBottom: 6 },
  cardTitle: { fontSize: 13, fontWeight: "800", color: theme.color.onSurface },
  cardUrl: { fontSize: 11, color: theme.color.muted, marginTop: 4 },
  deleteBtn: { position: "absolute", top: 6, right: 6, padding: 4 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#FFF", borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, paddingBottom: 30 },
  sheetHandle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: "#CBD5E1", marginBottom: 12 },
  sheetTitle: { fontSize: 16, fontWeight: "800", color: theme.color.onSurface, marginBottom: 10 },
  label: { fontSize: 12, fontWeight: "700", color: theme.color.muted, marginTop: 10, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: theme.color.border, borderRadius: 10, padding: 12, fontSize: 14, color: theme.color.onSurface, backgroundColor: theme.color.surface },
  iconRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  iconOpt: { padding: 8, borderRadius: 10, backgroundColor: "#F1F5F9" },
  iconOptActive: { backgroundColor: "#FCE7F3", borderWidth: 2, borderColor: "#DB2777" },
  submitBtn: { marginTop: 20, backgroundColor: "#DB2777", padding: 14, borderRadius: 12, alignItems: "center" },
  submitTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
});

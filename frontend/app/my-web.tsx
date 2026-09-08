import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, Modal, Linking, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";

import { useBottomSheetPadding, usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
type Link = { link_id: string; title: string; url: string; icon: string; order: number };

const ICONS = ["🔗","🔍","📊","📰","🏦","💼","⚡","🔥","📞","🌐","📈","🛒","💰","🎯","🔧"];

export default function MyWebScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const isMaster = user?.role === "owner" && !user?.parent_user_id;
  const [items, setItems] = useState<Link[]>([]);
  const bottomPad = useBottomSheetPadding();
  const pagePad = usePageBottomPadding();
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [icon, setIcon] = useState("🔗");
  const [saving, setSaving] = useState(false);
  // V50.z60 — Feedback "Aggiungi a Comunica con l'azienda"
  const [addingCompanyId, setAddingCompanyId] = useState<string | null>(null);
  const [addedCompanyIds, setAddedCompanyIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: Link[] }>("/web-links");
      setItems(r.items);
    } catch (e: any) { console.warn(e); } finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openLink = (u: string) => Linking.openURL(u).catch(() => notify("Errore", "Impossibile aprire il link"));

  // V50.z60 — Aggiunge un link personale di My Web alla scheda "Comunica con
  // l'azienda" (endpoint tenant-scoped /company-web-links, solo Master).
  const addToCompany = async (lk: Link) => {
    if (!isMaster || addingCompanyId) return;
    setAddingCompanyId(lk.link_id);
    try {
      await api("/company-web-links", {
        method: "POST",
        body: { title: lk.title, url: lk.url, icon: lk.icon || "🔗" },
      });
      setAddedCompanyIds((prev) => new Set(prev).add(lk.link_id));
      notify("Aggiunto ✅", `"${lk.title}" è ora nella scheda Comunica con l'azienda → Link utili.`);
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile aggiungere il link");
    } finally {
      setAddingCompanyId(null);
    }
  };

  const submit = async () => {
    if (!title.trim() || !url.trim()) { notify("Compila titolo e URL"); return; }
    try {
      setSaving(true);
      if (editingId) {
        // V50.z73 — Modifica link esistente
        await api(`/web-links/${editingId}`, { method: "PUT", body: { title: title.trim(), url: url.trim(), icon } });
      } else {
        await api("/web-links", { method: "POST", body: { title: title.trim(), url: url.trim(), icon } });
      }
      setAddOpen(false); setEditingId(null); setTitle(""); setUrl(""); setIcon("🔗");
      await load();
    } catch (e: any) { notify("Errore", e?.message || ""); } finally { setSaving(false); }
  };

  // V50.z73 — Apre il modal in modalità "modifica" con i valori del link
  const openEdit = (lk: Link) => {
    setEditingId(lk.link_id);
    setTitle(lk.title);
    // Rimuovi il prefisso https:// per rendere l'edit più leggibile (verrà riaggiunto dal backend)
    setUrl(lk.url.replace(/^https?:\/\//, ""));
    setIcon(lk.icon || "🔗");
    setAddOpen(true);
  };

  const openCreate = () => {
    setEditingId(null);
    setTitle(""); setUrl(""); setIcon("🔗");
    setAddOpen(true);
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
        {/* V50.z64 — Pulsante Aggiungi link spostato in fondo alla griglia
            (ben visibile). Il posto qui è mantenuto vuoto per bilanciare
            l'header (chevron-back a sinistra). */}
        <View style={styles.headerBtn} />
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={theme.color.brandPrimary} />
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="globe-outline" size={48} color={theme.color.muted} />
          <Text style={styles.emptyTitle}>Nessun link salvato</Text>
          <Text style={styles.emptyTxt}>Salva qui i tuoi siti preferiti per accesso rapido.</Text>
          <Pressable onPress={openCreate} style={styles.emptyBtn}><Ionicons name="add" size={18} color="#FFF" /><Text style={styles.emptyBtnTxt}>Aggiungi link</Text></Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: pagePad }}>
          <View style={styles.grid}>
            {items.map((lk) => {
              const busy = addingCompanyId === lk.link_id;
              const added = addedCompanyIds.has(lk.link_id);
              return (
                <View key={lk.link_id} style={styles.card}>
                  <Pressable onPress={() => openLink(lk.url)} onLongPress={() => remove(lk)} style={styles.cardInner} testID={`link-${lk.link_id}`}>
                    <Text style={styles.cardIcon}>{lk.icon || "🔗"}</Text>
                    <Text style={styles.cardTitle} numberOfLines={2}>{lk.title}</Text>
                    <Text style={styles.cardUrl} numberOfLines={1}>{lk.url.replace(/^https?:\/\//, "")}</Text>
                  </Pressable>
                  {/* V50.z73 — Bottone modifica visibile in alto a destra su ogni link */}
                  <Pressable
                    onPress={() => openEdit(lk)}
                    style={styles.editBtn}
                    testID={`link-edit-${lk.link_id}`}
                    hitSlop={6}
                  >
                    <Ionicons name="create-outline" size={18} color={theme.color.brandPrimary} />
                  </Pressable>
                  <Pressable onPress={() => remove(lk)} style={styles.deleteBtn} testID={`link-delete-${lk.link_id}`}><Ionicons name="close-circle" size={20} color="#DC2626" /></Pressable>
                  {/* V50.z60 — Pulsante "Aggiungi a Comunica con l'azienda"
                      (solo Master). Il link viene copiato nella collection
                      tenant-scoped /company-web-links. */}
                  {isMaster && (
                    <Pressable
                      onPress={() => addToCompany(lk)}
                      disabled={busy || added}
                      style={[styles.addToCompanyBtn, added && styles.addToCompanyBtnDone, busy && { opacity: 0.6 }]}
                      testID={`link-add-company-${lk.link_id}`}
                    >
                      {busy ? (
                        <ActivityIndicator size="small" color="#FFF" />
                      ) : (
                        <>
                          <Ionicons name={added ? "checkmark" : "business"} size={14} color="#FFF" />
                          <Text style={styles.addToCompanyTxt}>{added ? "Aggiunto" : "Azienda"}</Text>
                        </>
                      )}
                    </Pressable>
                  )}
                </View>
              );
            })}
          </View>

          {/* V50.z64 — Bottone "Aggiungi link" spostato dall'header a fondo
              lista, ben visibile con testo e icona (non più solo icona +). */}
          <Pressable
            onPress={openCreate}
            style={styles.addBigBtn}
            testID="add-link-btn"
          >
            <Ionicons name="add-circle" size={22} color="#FFF" />
            <Text style={styles.addBigBtnTxt}>Aggiungi link</Text>
          </Pressable>
        </ScrollView>
      )}

      <Modal transparent visible={addOpen} onRequestClose={() => { setAddOpen(false); setEditingId(null); }} animationType="slide">
        {/* V50.z62 — Bug fix (stesso di CompanyContactSheet):
            rimosso il backdrop <Pressable onPress={setAddOpen(false)}> che
            veniva ri-triggerato dal re-render causato dagli onChangeText,
            chiudendo il modal appena l'utente digitava. Il modal si chiude
            via bottone "Chiudi" o back Android (onRequestClose). */}
        <View style={styles.backdrop} pointerEvents="box-none">
          <View style={[styles.sheet, { paddingBottom: bottomPad }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeaderRow}>
              <Text style={styles.sheetTitle}>{editingId ? "Modifica link" : "Nuovo link"}</Text>
              <Pressable
                onPress={() => { setAddOpen(false); setEditingId(null); }}
                hitSlop={10}
                style={styles.sheetCloseBtn}
                testID="link-modal-close"
              >
                <Ionicons name="close" size={20} color={theme.color.muted} />
              </Pressable>
            </View>
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
              {saving ? <ActivityIndicator color="#FFF" /> : <Text style={styles.submitTxt}>{editingId ? "Salva modifiche" : "Salva"}</Text>}
            </Pressable>
          </View>
        </View>
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
  // V50.z64 — Pulsante "Aggiungi link" grande sotto la griglia
  addBigBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    marginTop: 16, marginHorizontal: 4,
    backgroundColor: "#DB2777", paddingVertical: 14, borderRadius: 12,
    shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 3,
  },
  addBigBtnTxt: { color: "#FFF", fontWeight: "800", fontSize: 15 },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
  card: { width: "47%", backgroundColor: theme.color.surface, borderRadius: 14, marginBottom: 12, borderWidth: 1, borderColor: theme.color.border, position: "relative" },
  cardInner: { padding: 14, alignItems: "flex-start" },
  cardIcon: { fontSize: 32, marginBottom: 6 },
  cardTitle: { fontSize: 13, fontWeight: "800", color: theme.color.onSurface },
  cardUrl: { fontSize: 11, color: theme.color.muted, marginTop: 4 },
  deleteBtn: { position: "absolute", top: 6, right: 6, padding: 4 },
  // V50.z73 — Bottone modifica su ogni link (top-left, complementare al delete top-right)
  editBtn: { position: "absolute", top: 6, left: 6, padding: 4, backgroundColor: "#FFF", borderRadius: 999, borderWidth: 1, borderColor: theme.color.border },
  // V50.z60 — Pulsante "Aggiungi a Comunica con l'azienda"
  addToCompanyBtn: {
    position: "absolute", bottom: 8, right: 8,
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999,
    backgroundColor: "#0EA5E9",
  },
  addToCompanyBtnDone: { backgroundColor: "#16A34A" },
  addToCompanyTxt: { color: "#FFF", fontSize: 10, fontWeight: "800" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#FFF", borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, paddingBottom: 30 },
  sheetHandle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: "#CBD5E1", marginBottom: 12 },
  // V50.z62 — Header con titolo + pulsante X (sostituisce il tap-outside-to-close)
  sheetHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  sheetCloseBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: "#F1F5F9", alignItems: "center", justifyContent: "center" },
  sheetTitle: { fontSize: 16, fontWeight: "800", color: theme.color.onSurface, marginBottom: 10 },
  label: { fontSize: 12, fontWeight: "700", color: theme.color.muted, marginTop: 10, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: theme.color.border, borderRadius: 10, padding: 12, fontSize: 14, color: theme.color.onSurface, backgroundColor: theme.color.surface },
  iconRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  iconOpt: { padding: 8, borderRadius: 10, backgroundColor: "#F1F5F9" },
  iconOptActive: { backgroundColor: "#FCE7F3", borderWidth: 2, borderColor: "#DB2777" },
  submitBtn: { marginTop: 20, backgroundColor: "#DB2777", padding: 14, borderRadius: 12, alignItems: "center" },
  submitTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
});

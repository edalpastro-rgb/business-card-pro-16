import { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, TextInput, ActivityIndicator, Modal, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

type Group = { group_id: string; name: string; color: string; description: string; member_count: number };

const COLOR_SWATCHES = ["#1B6CB0", "#C83232", "#2D7A5A", "#B77C14", "#7A2E8E", "#0B7285", "#E67700", HT.muted];

export default function GroupsScreen() {
  const pagePad = usePageBottomPadding();
  const router = useRouter();
  const [items, setItems] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Group | null>(null);
  const [form, setForm] = useState({ name: "", color: COLOR_SWATCHES[0], description: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api<{ items: Group[] }>("/groups");
      setItems(r.items);
    } finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openNew = () => {
    setEditing(null);
    setForm({ name: "", color: COLOR_SWATCHES[0], description: "" });
    setModalOpen(true);
  };
  const openEdit = (g: Group) => {
    setEditing(g);
    setForm({ name: g.name, color: g.color, description: g.description || "" });
    setModalOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      if (editing) {
        await api(`/groups/${editing.group_id}`, { method: "PUT", body: form });
      } else {
        await api("/groups", { method: "POST", body: form });
      }
      setModalOpen(false);
      await load();
    } finally { setBusy(false); }
  };

  const remove = (g: Group) => {
    Alert.alert("Elimina gruppo", `Vuoi eliminare "${g.name}"? I contatti resteranno ma perderanno l'associazione.`, [
      { text: "Annulla", style: "cancel" },
      {
        text: "Elimina", style: "destructive", onPress: async () => {
          await api(`/groups/${g.group_id}`, { method: "DELETE" });
          load();
        }
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={HT.text} />
        </Pressable>
        <Text style={styles.title}>Gruppi</Text>
        <Pressable testID="group-add-btn" onPress={openNew} style={styles.headerBtn}>
          <Ionicons name="add" size={22} color="#FFF" />
        </Pressable>
      </View>

      <Text style={styles.hint}>Organizza i contatti in gruppi personalizzati. Da qui puoi inviare email o messaggi WhatsApp/Telegram a tutti i membri del gruppo.</Text>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={HT.brand} />
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="people-outline" size={40} color={HT.muted} />
          <Text style={styles.emptyTxt}>Ancora nessun gruppo</Text>
          <Pressable onPress={openNew} style={styles.emptyBtn}>
            <Text style={styles.emptyBtnTxt}>Crea il primo gruppo</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.group_id}
          contentContainerStyle={{ padding: 16, paddingTop: 4, paddingBottom: pagePad }}
          renderItem={({ item }) => (
            <Pressable testID={`group-${item.group_id}`} onPress={() => router.push(`/groups/${item.group_id}`)} style={styles.card}>
              <View style={[styles.dot, { backgroundColor: item.color }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.sub}>{item.member_count} contatt{item.member_count === 1 ? "o" : "i"}{item.description ? ` · ${item.description}` : ""}</Text>
              </View>
              <Pressable testID={`group-edit-${item.group_id}`} onPress={() => openEdit(item)} hitSlop={8} style={{ padding: 8 }}>
                <Ionicons name="create-outline" size={20} color={HT.brand} />
              </Pressable>
              <Pressable testID={`group-del-${item.group_id}`} onPress={() => remove(item)} hitSlop={8} style={{ padding: 8 }}>
                <Ionicons name="trash-outline" size={18} color={HT.danger} />
              </Pressable>
            </Pressable>
          )}
        />
      )}

      <Modal visible={modalOpen} transparent animationType="fade" onRequestClose={() => setModalOpen(false)}>
        <View style={styles.modalBack}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{editing ? "Modifica gruppo" : "Nuovo gruppo"}</Text>
            <Text style={styles.lbl}>Nome</Text>
            <TextInput
              testID="group-name-input"
              value={form.name}
              onChangeText={(t) => setForm({ ...form, name: t })}
              placeholder="Es. Clienti Energia, Team Networker"
              placeholderTextColor={HT.muted}
              style={styles.input}
            />
            <Text style={styles.lbl}>Descrizione (opzionale)</Text>
            <TextInput
              testID="group-desc-input"
              value={form.description}
              onChangeText={(t) => setForm({ ...form, description: t })}
              placeholder="Descrivi il gruppo"
              placeholderTextColor={HT.muted}
              style={styles.input}
            />
            <Text style={styles.lbl}>Colore</Text>
            <View style={styles.swatches}>
              {COLOR_SWATCHES.map((c) => (
                <Pressable key={c} onPress={() => setForm({ ...form, color: c })} style={[styles.swatch, { backgroundColor: c }, form.color === c && styles.swatchActive]}>
                  {form.color === c && <Ionicons name="checkmark" size={16} color="#FFF" />}
                </Pressable>
              ))}
            </View>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 18 }}>
              <Pressable onPress={() => setModalOpen(false)} style={[styles.modalBtn, { backgroundColor: HT.card2, borderWidth: 1, borderColor: HT.border }]}>
                <Text style={{ color: HT.text, fontWeight: "700" }}>Annulla</Text>
              </Pressable>
              <Pressable testID="group-save-btn" onPress={save} disabled={busy || !form.name.trim()} style={[styles.modalBtn, { backgroundColor: HT.brand, opacity: form.name.trim() ? 1 : 0.5 }]}>
                {busy ? <ActivityIndicator color="#FFF" /> : <Text style={{ color: "#FFF", fontWeight: "700" }}>Salva</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: HT.card2 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontSize: 20, fontWeight: "700", color: HT.text },
  headerBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: HT.brand, alignItems: "center", justifyContent: "center" },
  hint: { paddingHorizontal: 20, paddingBottom: 8, color: HT.muted, fontSize: 12 },
  card: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: HT.card, padding: 14, borderRadius: theme.radius.md, marginBottom: 8, borderWidth: 1, borderColor: HT.border },
  dot: { width: 14, height: 14, borderRadius: 7 },
  name: { fontSize: 16, fontWeight: "700", color: HT.text },
  sub: { fontSize: 12, color: HT.muted, marginTop: 2 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40, gap: 12 },
  emptyTxt: { color: HT.muted, fontSize: 15 },
  emptyBtn: { backgroundColor: HT.brand, paddingHorizontal: 20, paddingVertical: 12, borderRadius: theme.radius.md, marginTop: 8 },
  emptyBtnTxt: { color: "#FFF", fontWeight: "700" },
  modalBack: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 20 },
  modalCard: { width: "100%", maxWidth: 480, backgroundColor: HT.card, borderRadius: theme.radius.md, padding: 18 },
  modalTitle: { fontSize: 18, fontWeight: "700", color: HT.text, marginBottom: 8 },
  lbl: { fontSize: 12, color: HT.text2, fontWeight: "600", marginTop: 10, marginBottom: 4 },
  input: { backgroundColor: HT.card2, borderRadius: theme.radius.md, padding: 12, borderWidth: 1, borderColor: HT.border, color: HT.text },
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  swatch: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "transparent" },
  swatchActive: { borderColor: HT.text },
  modalBtn: { flex: 1, paddingVertical: 12, borderRadius: theme.radius.md, alignItems: "center" },
});

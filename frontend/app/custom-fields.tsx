import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput, ActivityIndicator, Modal } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { useAuth } from "@/src/auth";
import { notify } from "@/src/utils/notify";

/**
 * V50.z67 — Master può creare/modificare/eliminare campi personalizzati
 * per l'anagrafica contatti. Ogni campo ha nome, tipo (text/number/date/checkbox)
 * e visibilità (solo master oppure tutti gli utenti).
 */
type FieldType = "text" | "number" | "date" | "checkbox";
type Visibility = "master" | "all";
type FieldDef = {
  field_id: string;
  key: string;
  name: string;
  type: FieldType;
  visibility: Visibility;
  order: number;
};

const TYPE_LABELS: Record<FieldType, string> = {
  text: "Testo",
  number: "Numero",
  date: "Data",
  checkbox: "Sì / No",
};

const TYPE_ICONS: Record<FieldType, keyof typeof Ionicons.glyphMap> = {
  text: "text",
  number: "calculator",
  date: "calendar",
  checkbox: "checkbox",
};

export default function CustomFieldsScreen() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const isMaster = user?.role === "owner" || user?.role === "admin";

  const [items, setItems] = useState<FieldDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<FieldDef | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<{ name: string; type: FieldType; visibility: Visibility }>({
    name: "",
    type: "text",
    visibility: "all",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<FieldDef[]>("/contact-custom-fields");
      setItems(data || []);
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile caricare i campi");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: "", type: "text", visibility: "all" });
    setModalOpen(true);
  };

  const openEdit = (f: FieldDef) => {
    setEditing(f);
    setForm({ name: f.name, type: f.type, visibility: f.visibility });
    setModalOpen(true);
  };

  const save = async () => {
    const nm = form.name.trim();
    if (!nm) {
      notify("Attenzione", "Inserisci un nome per il campo");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api(`/contact-custom-fields/${editing.field_id}`, {
          method: "PUT",
          body: { name: nm, type: form.type, visibility: form.visibility },
        });
      } else {
        await api("/contact-custom-fields", {
          method: "POST",
          body: { name: nm, type: form.type, visibility: form.visibility },
        });
      }
      setModalOpen(false);
      await load();
    } catch (e: any) {
      notify("Errore", e?.message || "Salvataggio non riuscito");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (f: FieldDef) => {
    // Conferma via confirm nativo del browser su web, oppure notify con azione
    const ok = typeof window !== "undefined" && window.confirm
      ? window.confirm(`Eliminare il campo "${f.name}"?\n\nI valori inseriti nelle schede clienti verranno rimossi.`)
      : true;
    if (!ok) return;
    try {
      await api(`/contact-custom-fields/${f.field_id}`, { method: "DELETE" });
      await load();
    } catch (e: any) {
      notify("Errore", e?.message || "Eliminazione non riuscita");
    }
  };

  if (!isMaster) {
    if (authLoading || !user) {
      return (
        <SafeAreaView style={styles.root} edges={["top"]}>
          <View style={styles.header}>
            <Pressable onPress={() => router.back()} hitSlop={10}>
              <Ionicons name="chevron-back" size={24} color={theme.color.onSurface} />
            </Pressable>
            <Text style={styles.title}>Campi personalizzati</Text>
            <View style={{ width: 24 }} />
          </View>
          <ActivityIndicator style={{ marginTop: 40 }} color={theme.color.brandPrimary} />
        </SafeAreaView>
      );
    }
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <Ionicons name="chevron-back" size={24} color={theme.color.onSurface} />
          </Pressable>
          <Text style={styles.title}>Campi personalizzati</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.emptyBox}>
          <Ionicons name="lock-closed" size={48} color={theme.color.muted} />
          <Text style={styles.emptyTitle}>Accesso riservato al Master</Text>
          <Text style={styles.emptySub}>Solo il proprietario del CRM può configurare i campi personalizzati.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.title}>Campi personalizzati</Text>
        <Pressable onPress={openCreate} hitSlop={10}>
          <Ionicons name="add-circle" size={26} color={theme.color.brandPrimary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <View style={styles.infoBox}>
          <Text style={styles.infoTxt}>
            Aggiungi campi non presenti di default alla scheda anagrafica. Puoi decidere se ogni campo è visibile a tutti oppure solo al Master.
          </Text>
        </View>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={theme.color.brandPrimary} />
        ) : items.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="options" size={48} color={theme.color.muted} />
            <Text style={styles.emptyTitle}>Nessun campo personalizzato</Text>
            <Text style={styles.emptySub}>Tocca "+" in alto per aggiungerne uno.</Text>
          </View>
        ) : (
          items.map((f) => (
            <View key={f.field_id} style={styles.card}>
              <View style={styles.cardIcon}>
                <Ionicons name={TYPE_ICONS[f.type]} size={22} color={theme.color.brandPrimary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{f.name}</Text>
                <View style={styles.tagRow}>
                  <View style={styles.tag}>
                    <Text style={styles.tagTxt}>{TYPE_LABELS[f.type]}</Text>
                  </View>
                  <View style={[styles.tag, f.visibility === "master" ? styles.tagMaster : styles.tagAll]}>
                    <Ionicons
                      name={f.visibility === "master" ? "lock-closed" : "people"}
                      size={11}
                      color={f.visibility === "master" ? "#7C2D12" : "#065F46"}
                    />
                    <Text style={[styles.tagTxt, f.visibility === "master" ? { color: "#7C2D12" } : { color: "#065F46" }]}>
                      {f.visibility === "master" ? "Solo Master" : "Tutti"}
                    </Text>
                  </View>
                </View>
                <Text style={styles.cardKey}>chiave: {f.key}</Text>
              </View>
              <View style={{ gap: 6 }}>
                <Pressable onPress={() => openEdit(f)} hitSlop={8} style={styles.iconBtn}>
                  <Ionicons name="create-outline" size={20} color={theme.color.brandPrimary} />
                </Pressable>
                <Pressable onPress={() => remove(f)} hitSlop={8} style={styles.iconBtn}>
                  <Ionicons name="trash-outline" size={20} color="#DC2626" />
                </Pressable>
              </View>
            </View>
          ))
        )}
      </ScrollView>

      {/* Modal Crea / Modifica */}
      <Modal visible={modalOpen} transparent animationType="fade" onRequestClose={() => setModalOpen(false)}>
        <View style={styles.backdrop} pointerEvents="box-none">
          <View style={styles.sheet}>
            <KeyboardAwareScrollView bottomOffset={20} contentContainerStyle={{ padding: 18, gap: 14 }} keyboardShouldPersistTaps="handled">
              <Text style={styles.sheetTitle}>{editing ? "Modifica campo" : "Nuovo campo personalizzato"}</Text>

              <View>
                <Text style={styles.label}>Nome campo</Text>
                <TextInput
                  value={form.name}
                  onChangeText={(v) => setForm({ ...form, name: v })}
                  placeholder="es. Codice fiscale coniuge"
                  style={styles.input}
                  placeholderTextColor={theme.color.muted}
                />
              </View>

              <View>
                <Text style={styles.label}>Tipo di dato</Text>
                <View style={styles.chipRow}>
                  {(["text", "number", "date", "checkbox"] as FieldType[]).map((t) => (
                    <Pressable
                      key={t}
                      onPress={() => setForm({ ...form, type: t })}
                      style={[styles.chip, form.type === t && styles.chipActive]}
                    >
                      <Ionicons
                        name={TYPE_ICONS[t]}
                        size={14}
                        color={form.type === t ? "#FFF" : theme.color.onSurface}
                      />
                      <Text style={[styles.chipTxt, form.type === t && { color: "#FFF" }]}>{TYPE_LABELS[t]}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              <View>
                <Text style={styles.label}>Visibilità</Text>
                <View style={styles.chipRow}>
                  <Pressable
                    onPress={() => setForm({ ...form, visibility: "all" })}
                    style={[styles.chip, form.visibility === "all" && styles.chipActive]}
                  >
                    <Ionicons name="people" size={14} color={form.visibility === "all" ? "#FFF" : theme.color.onSurface} />
                    <Text style={[styles.chipTxt, form.visibility === "all" && { color: "#FFF" }]}>Tutti gli utenti</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setForm({ ...form, visibility: "master" })}
                    style={[styles.chip, form.visibility === "master" && styles.chipActive]}
                  >
                    <Ionicons name="lock-closed" size={14} color={form.visibility === "master" ? "#FFF" : theme.color.onSurface} />
                    <Text style={[styles.chipTxt, form.visibility === "master" && { color: "#FFF" }]}>Solo Master</Text>
                  </Pressable>
                </View>
                <Text style={styles.hint}>
                  {form.visibility === "master"
                    ? "Il campo sarà visibile solo agli utenti Master."
                    : "Il campo sarà visibile a tutti gli utenti autorizzati."}
                </Text>
              </View>

              <View style={{ flexDirection: "row", gap: 10, marginTop: 6 }}>
                <Pressable onPress={() => setModalOpen(false)} style={[styles.btn, styles.btnGhost]}>
                  <Text style={styles.btnGhostTxt}>Annulla</Text>
                </Pressable>
                <Pressable onPress={save} disabled={saving} style={[styles.btn, styles.btnPrimary, saving && { opacity: 0.6 }]}>
                  {saving ? (
                    <ActivityIndicator color="#FFF" />
                  ) : (
                    <>
                      <Ionicons name="checkmark" size={18} color="#FFF" />
                      <Text style={styles.btnPrimaryTxt}>{editing ? "Salva" : "Crea campo"}</Text>
                    </>
                  )}
                </Pressable>
              </View>
            </KeyboardAwareScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.border,
  },
  title: { fontSize: 17, fontWeight: "800", color: theme.color.onSurface },
  infoBox: {
    backgroundColor: "#EFF6FF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#93C5FD",
    padding: 12,
    marginBottom: 14,
  },
  infoTxt: { fontSize: 13, color: theme.color.onSurface, lineHeight: 18 },
  emptyBox: { alignItems: "center", padding: 40, gap: 8 },
  emptyTitle: { fontSize: 15, fontWeight: "700", color: theme.color.onSurface, marginTop: 8 },
  emptySub: { fontSize: 13, color: theme.color.muted, textAlign: "center" },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#FFF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: 12,
    marginBottom: 10,
  },
  cardIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#EEF2FF",
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: { fontSize: 15, fontWeight: "800", color: theme.color.onSurface },
  cardKey: { fontSize: 10, color: theme.color.muted, marginTop: 4, fontStyle: "italic" },
  tagRow: { flexDirection: "row", gap: 6, marginTop: 4, flexWrap: "wrap" },
  tag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: "#F1F5F9",
  },
  tagAll: { backgroundColor: "#D1FAE5" },
  tagMaster: { backgroundColor: "#FEE2E2" },
  tagTxt: { fontSize: 10, fontWeight: "700", color: theme.color.onSurface },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F1F5F9",
  },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 20 },
  sheet: {
    backgroundColor: "#FFF",
    borderRadius: 16,
    maxHeight: "90%",
  },
  sheetTitle: { fontSize: 17, fontWeight: "800", color: theme.color.onSurface },
  label: { fontSize: 12, fontWeight: "700", color: theme.color.muted, marginBottom: 6, textTransform: "uppercase" },
  input: {
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: theme.color.onSurface,
    backgroundColor: "#F8FAFC",
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  chipActive: { backgroundColor: theme.color.brandPrimary, borderColor: theme.color.brandPrimary },
  chipTxt: { fontSize: 12, fontWeight: "700", color: theme.color.onSurface },
  hint: { fontSize: 11, color: theme.color.muted, marginTop: 6, fontStyle: "italic" },
  btn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
  },
  btnPrimary: { backgroundColor: theme.color.brandPrimary },
  btnPrimaryTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
  btnGhost: { backgroundColor: "#F1F5F9" },
  btnGhostTxt: { color: theme.color.onSurface, fontWeight: "700" },
});

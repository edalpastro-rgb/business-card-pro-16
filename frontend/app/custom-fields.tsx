import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, Modal } from "react-native";
import { KScrollView, KModalBody } from "@/src/ui/keyboard"; // V50.z374 — tastiera: campo attivo sempre visibile
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { useAuth } from "@/src/auth";
import { notify } from "@/src/utils/notify";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

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
  required?: boolean;
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
  const [form, setForm] = useState<{ name: string; type: FieldType; visibility: Visibility; required: boolean }>({
    name: "",
    type: "text",
    visibility: "all",
    required: false,
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
    setForm({ name: "", type: "text", visibility: "all", required: false });
    setModalOpen(true);
  };

  const openEdit = (f: FieldDef) => {
    setEditing(f);
    setForm({ name: f.name, type: f.type, visibility: f.visibility, required: !!f.required });
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
          body: { name: nm, type: form.type, visibility: form.visibility, required: form.required },
        });
      } else {
        await api("/contact-custom-fields", {
          method: "POST",
          body: { name: nm, type: form.type, visibility: form.visibility, required: form.required },
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

  const move = async (idx: number, direction: -1 | 1) => {
    const target = idx + direction;
    if (target < 0 || target >= items.length) return;
    // Optimistic swap
    const next = [...items];
    [next[idx], next[target]] = [next[target], next[idx]];
    setItems(next);
    try {
      await api("/contact-custom-fields/reorder", {
        method: "POST",
        body: { field_ids: next.map((f) => f.field_id) },
      });
    } catch (e: any) {
      notify("Errore", e?.message || "Riordino non riuscito");
      await load(); // rollback via refetch
    }
  };

  if (!isMaster) {
    if (authLoading || !user) {
      return (
        <SafeAreaView style={styles.root} edges={["top"]}>
          <View style={styles.header}>
            <Pressable onPress={() => router.back()} hitSlop={10}>
              <Ionicons name="chevron-back" size={24} color={HT.text} />
            </Pressable>
            <Text style={styles.title}>Campi personalizzati</Text>
            <View style={{ width: 24 }} />
          </View>
          <ActivityIndicator style={{ marginTop: 40 }} color={HT.brand} />
        </SafeAreaView>
      );
    }
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <Ionicons name="chevron-back" size={24} color={HT.text} />
          </Pressable>
          <Text style={styles.title}>Campi personalizzati</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.emptyBox}>
          <Ionicons name="lock-closed" size={48} color={HT.muted} />
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
          <Ionicons name="chevron-back" size={24} color={HT.text} />
        </Pressable>
        <Text style={styles.title}>Campi personalizzati</Text>
        <Pressable onPress={openCreate} hitSlop={10}>
          <Ionicons name="add-circle" size={26} color={HT.brand} />
        </Pressable>
      </View>

      <KScrollView contentContainerStyle={{ padding: 16, paddingBottom: 140 }}>
        <View style={styles.infoBox}>
          <Text style={styles.infoTxt}>
            Aggiungi campi non presenti di default alla scheda anagrafica. Puoi decidere se ogni campo è visibile a tutti oppure solo al Master.
          </Text>
        </View>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={HT.brand} />
        ) : items.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="options" size={48} color={HT.muted} />
            <Text style={styles.emptyTitle}>Nessun campo personalizzato</Text>
            <Text style={styles.emptySub}>Tocca "+" in alto per aggiungerne uno.</Text>
          </View>
        ) : (
          items.map((f, idx) => (
            <View key={f.field_id} style={styles.card}>
              <View style={styles.cardIcon}>
                <Ionicons name={TYPE_ICONS[f.type]} size={22} color={HT.brand} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={styles.cardTitle}>{f.name}</Text>
                  {f.required ? <Text style={styles.reqStar}>*</Text> : null}
                </View>
                <View style={styles.tagRow}>
                  <View style={styles.tag}>
                    <Text style={styles.tagTxt}>{TYPE_LABELS[f.type]}</Text>
                  </View>
                  <View style={[styles.tag, f.visibility === "master" ? styles.tagMaster : styles.tagAll]}>
                    <Ionicons
                      name={f.visibility === "master" ? "lock-closed" : "people"}
                      size={11}
                      color={f.visibility === "master" ? "#7C2D12" : HT.success}
                    />
                    <Text style={[styles.tagTxt, f.visibility === "master" ? { color: "#7C2D12" } : { color: HT.success }]}>
                      {f.visibility === "master" ? "Solo Master" : "Tutti"}
                    </Text>
                  </View>
                  {f.required ? (
                    <View style={[styles.tag, styles.tagRequired]}>
                      <Ionicons name="alert-circle" size={11} color={HT.warning} />
                      <Text style={[styles.tagTxt, { color: HT.warning }]}>Obbligatorio</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.cardKey}>chiave: {f.key}</Text>
              </View>
              <View style={{ gap: 4 }}>
                <Pressable
                  onPress={() => move(idx, -1)}
                  hitSlop={6}
                  disabled={idx === 0}
                  style={[styles.iconBtn, idx === 0 && { opacity: 0.3 }]}
                  testID={`cf-up-${f.field_id}`}
                >
                  <Ionicons name="chevron-up" size={16} color={HT.text} />
                </Pressable>
                <Pressable
                  onPress={() => move(idx, 1)}
                  hitSlop={6}
                  disabled={idx === items.length - 1}
                  style={[styles.iconBtn, idx === items.length - 1 && { opacity: 0.3 }]}
                  testID={`cf-down-${f.field_id}`}
                >
                  <Ionicons name="chevron-down" size={16} color={HT.text} />
                </Pressable>
              </View>
              <View style={{ gap: 6 }}>
                <Pressable onPress={() => openEdit(f)} hitSlop={8} style={styles.iconBtn}>
                  <Ionicons name="create-outline" size={18} color={HT.brand} />
                </Pressable>
                <Pressable onPress={() => remove(f)} hitSlop={8} style={styles.iconBtn}>
                  <Ionicons name="trash-outline" size={18} color="#DC2626" />
                </Pressable>
              </View>
            </View>
          ))
        )}
      </KScrollView>

      {/* Modal Crea / Modifica */}
      <Modal visible={modalOpen} transparent animationType="fade" onRequestClose={() => setModalOpen(false)}><KModalBody>
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
                  placeholderTextColor={HT.muted}
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
                        color={form.type === t ? "#FFF" : HT.text}
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
                    <Ionicons name="people" size={14} color={form.visibility === "all" ? "#FFF" : HT.text} />
                    <Text style={[styles.chipTxt, form.visibility === "all" && { color: "#FFF" }]}>Tutti gli utenti</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setForm({ ...form, visibility: "master" })}
                    style={[styles.chip, form.visibility === "master" && styles.chipActive]}
                  >
                    <Ionicons name="lock-closed" size={14} color={form.visibility === "master" ? "#FFF" : HT.text} />
                    <Text style={[styles.chipTxt, form.visibility === "master" && { color: "#FFF" }]}>Solo Master</Text>
                  </Pressable>
                </View>
                <Text style={styles.hint}>
                  {form.visibility === "master"
                    ? "Il campo sarà visibile solo agli utenti Master."
                    : "Il campo sarà visibile a tutti gli utenti autorizzati."}
                </Text>
              </View>

              <View>
                <Text style={styles.label}>Obbligatorio</Text>
                <Pressable
                  onPress={() => setForm({ ...form, required: !form.required })}
                  style={[styles.toggleRow, form.required && styles.toggleRowOn]}
                  testID="cf-required-toggle"
                >
                  <Ionicons
                    name={form.required ? "checkmark-circle" : "ellipse-outline"}
                    size={22}
                    color={form.required ? HT.warning : HT.muted}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.toggleTitle}>
                      {form.required ? "Campo obbligatorio" : "Campo facoltativo"}
                    </Text>
                    <Text style={styles.toggleSub}>
                      {form.required
                        ? "Il contatto non potrà essere salvato senza questo campo compilato."
                        : "Il campo può essere lasciato vuoto."}
                    </Text>
                  </View>
                </Pressable>
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
      </KModalBody></Modal>
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
    borderBottomColor: HT.border,
  },
  title: { fontSize: 17, fontWeight: "800", color: HT.text },
  infoBox: {
    backgroundColor: HT.axonTint,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#93C5FD',
    padding: 12,
    marginBottom: 14,
  },
  infoTxt: { fontSize: 13, color: HT.text, lineHeight: 18 },
  emptyBox: { alignItems: "center", padding: 40, gap: 8 },
  emptyTitle: { fontSize: 15, fontWeight: "700", color: HT.text, marginTop: 8 },
  emptySub: { fontSize: 13, color: HT.muted, textAlign: "center" },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: HT.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: HT.border,
    padding: 12,
    marginBottom: 10,
  },
  cardIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: HT.violetTint,
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: { fontSize: 15, fontWeight: "800", color: HT.text },
  cardKey: { fontSize: 10, color: HT.muted, marginTop: 4, fontStyle: "italic" },
  tagRow: { flexDirection: "row", gap: 6, marginTop: 4, flexWrap: "wrap" },
  tag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: HT.card2,
  },
  tagAll: { backgroundColor: HT.successTint },
  tagMaster: { backgroundColor: HT.dangerTint },
  tagRequired: { backgroundColor: HT.warningTint },
  tagTxt: { fontSize: 10, fontWeight: "700", color: HT.text },
  reqStar: { fontSize: 16, fontWeight: "900", color: HT.warning },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: HT.card2,
  },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 20 },
  sheet: {
    backgroundColor: HT.card,
    borderRadius: 16,
    maxHeight: "90%",
  },
  sheetTitle: { fontSize: 17, fontWeight: "800", color: HT.text },
  label: { fontSize: 12, fontWeight: "700", color: HT.muted, marginBottom: 6, textTransform: "uppercase" },
  input: {
    borderWidth: 1,
    borderColor: HT.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: HT.text,
    backgroundColor: HT.card2,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: HT.card2,
    borderWidth: 1,
    borderColor: HT.border,
  },
  chipActive: { backgroundColor: HT.brand, borderColor: HT.brand },
  chipTxt: { fontSize: 12, fontWeight: "700", color: HT.text },
  hint: { fontSize: 11, color: HT.muted, marginTop: 6, fontStyle: "italic" },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: HT.border,
    backgroundColor: HT.card2,
  },
  toggleRowOn: { backgroundColor: HT.warningTint, borderColor: '#FBBF24' },
  toggleTitle: { fontSize: 13, fontWeight: "800", color: HT.text },
  toggleSub: { fontSize: 11, color: HT.muted, marginTop: 2 },
  btn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
  },
  btnPrimary: { backgroundColor: HT.brand },
  btnPrimaryTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
  btnGhost: { backgroundColor: HT.card2 },
  btnGhostTxt: { color: HT.text, fontWeight: "700" },
});

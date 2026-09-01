/**
 * V49 — CompanyContactSheet
 *
 * Bottom sheet mostrato dalla Home quando l'utente tocca il bottone
 * "COMUNICA CON L'AZIENDA". Mostra:
 *   • Nome dell'azienda (titolo)
 *   • Email di servizio (tap → mailto:)
 *   • Elenco di numeri di telefono di servizio con etichetta (tap → tel:)
 *
 * Il pannello è configurabile SOLO dal Master (role="owner" && !parent_user_id):
 * toccando "Modifica" può aggiungere/modificare/eliminare numeri, nome ed email.
 * Le altre utenze (agenti/collaboratori) vedono soltanto i dati in modalità
 * consultazione. La configurazione è persistita tramite il modello backend
 * `/settings` (campi communica_azienda_*) così è condivisa in tutto il tenant.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Linking,
  TextInput,
  Platform,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useBottomSheetPadding } from "@/src/utils/bottomSheetInsets";

type Phone = { id: string; label: string; number: string };

type CompanyContactData = {
  communica_azienda_name?: string;
  communica_azienda_email?: string;
  communica_azienda_phones?: Phone[];
};

type Props = {
  visible: boolean;
  onClose: () => void;
};

const genId = () => `p_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

const C = {
  primary: "#FF6B35",
  navy: "#1B2B4B",
  muted: "#94A3B8",
  border: "#E2E8F0",
  bg: "#F8FAFC",
  green: "#16A34A",
};

export function CompanyContactSheet({ visible, onClose }: Props) {
  const { user } = useAuth();
  const bottomPad = useBottomSheetPadding();
  const isMaster = user?.role === "owner" && !user?.parent_user_id;

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<CompanyContactData>({});
  const [editMode, setEditMode] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftEmail, setDraftEmail] = useState("");
  const [draftPhones, setDraftPhones] = useState<Phone[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await api<CompanyContactData & Record<string, unknown>>("/settings");
      setData({
        communica_azienda_name: s.communica_azienda_name || "",
        communica_azienda_email: s.communica_azienda_email || "",
        communica_azienda_phones: Array.isArray(s.communica_azienda_phones)
          ? (s.communica_azienda_phones as Phone[]).filter((p) => p && p.id)
          : [],
      });
    } catch (e) {
      console.warn("company-sheet load", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) {
      setEditMode(false);
      load();
    }
  }, [visible, load]);

  // Sync draft when entering edit mode
  useEffect(() => {
    if (editMode) {
      setDraftName(data.communica_azienda_name || "");
      setDraftEmail(data.communica_azienda_email || "");
      setDraftPhones(
        (data.communica_azienda_phones || []).map((p) => ({ ...p })),
      );
    }
  }, [editMode, data]);

  const phones = useMemo<Phone[]>(
    () => data.communica_azienda_phones || [],
    [data],
  );

  const callNumber = (num: string) => {
    const clean = (num || "").replace(/\s+/g, "");
    if (!clean) return;
    const url = `tel:${clean}`;
    if (Platform.OS === "web") {
      try {
        window.location.href = url;
      } catch {
        /* ignore */
      }
    } else {
      Linking.openURL(url).catch(() =>
        Alert.alert("Chiamata non disponibile", "Impossibile avviare la chiamata."),
      );
    }
  };

  const openMail = (email: string) => {
    if (!email) return;
    const url = `mailto:${email.trim()}`;
    if (Platform.OS === "web") {
      try {
        window.location.href = url;
      } catch {
        /* ignore */
      }
    } else {
      Linking.openURL(url).catch(() => {});
    }
  };

  const addDraftPhone = () => {
    setDraftPhones((prev) => [...prev, { id: genId(), label: "", number: "" }]);
  };

  const updateDraftPhone = (id: string, key: "label" | "number", value: string) => {
    setDraftPhones((prev) =>
      prev.map((p) => (p.id === id ? { ...p, [key]: value } : p)),
    );
  };

  const removeDraftPhone = (id: string) => {
    setDraftPhones((prev) => prev.filter((p) => p.id !== id));
  };

  const saveChanges = async () => {
    setSaving(true);
    try {
      // Filter out entries with no number; keep label if present
      const cleaned = draftPhones
        .map((p) => ({
          id: p.id || genId(),
          label: (p.label || "").trim(),
          number: (p.number || "").trim(),
        }))
        .filter((p) => p.number.length > 0);
      // Load current settings so we don't overwrite unrelated fields on PUT.
      const current = await api<Record<string, unknown>>("/settings");
      const body = {
        ...current,
        communica_azienda_name: draftName.trim(),
        communica_azienda_email: draftEmail.trim(),
        communica_azienda_phones: cleaned,
      };
      // Remove non-model fields from the body to avoid validation errors.
      delete (body as any)._id;
      delete (body as any).user_id;
      const updated = await api<CompanyContactData>("/settings", {
        method: "PUT",
        body,
      });
      setData({
        communica_azienda_name: updated.communica_azienda_name || "",
        communica_azienda_email: updated.communica_azienda_email || "",
        communica_azienda_phones: updated.communica_azienda_phones || [],
      });
      setEditMode(false);
    } catch (e: any) {
      Alert.alert("Errore", e?.message || "Impossibile salvare le modifiche.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      transparent
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View
          style={[styles.sheet, { paddingBottom: bottomPad + 12 }]}
          onStartShouldSetResponder={() => true}
        >
          <View style={styles.handle} />
          <View style={styles.hdrRow}>
            <View style={styles.hdrIcon}>
              <Ionicons name="business" size={20} color="#FFF" />
            </View>
            <Text style={styles.hdrLabel} numberOfLines={1}>
              Comunica con l&apos;azienda
            </Text>
            {isMaster && !editMode && (
              <Pressable
                onPress={() => setEditMode(true)}
                hitSlop={8}
                style={styles.editBtn}
                testID="company-sheet-edit"
              >
                <Ionicons name="create" size={16} color={C.primary} />
                <Text style={styles.editBtnTxt}>Modifica</Text>
              </Pressable>
            )}
            <Pressable
              onPress={onClose}
              hitSlop={10}
              testID="company-sheet-close"
              style={{ marginLeft: 4 }}
            >
              <Ionicons name="close" size={22} color={C.navy} />
            </Pressable>
          </View>

          <ScrollView
            style={{ maxHeight: 520 }}
            contentContainerStyle={{ padding: 16, gap: 12 }}
            keyboardShouldPersistTaps="handled"
          >
            {editMode ? (
              // ─────────── EDIT MODE (Master) ───────────
              <>
                <Text style={styles.fieldLbl}>Nome azienda</Text>
                <TextInput
                  testID="company-sheet-name-input"
                  value={draftName}
                  onChangeText={setDraftName}
                  placeholder="Es. AdvisorOS S.r.l."
                  placeholderTextColor={C.muted}
                  style={styles.input}
                />

                <Text style={[styles.fieldLbl, { marginTop: 6 }]}>Email di servizio</Text>
                <TextInput
                  testID="company-sheet-email-input"
                  value={draftEmail}
                  onChangeText={setDraftEmail}
                  placeholder="Es. info@advisoros.it"
                  placeholderTextColor={C.muted}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  style={styles.input}
                />

                <View style={styles.phonesHdr}>
                  <Text style={styles.fieldLbl}>Numeri di telefono di servizio</Text>
                  <Pressable
                    onPress={addDraftPhone}
                    style={styles.addBtn}
                    testID="company-sheet-add-phone"
                  >
                    <Ionicons name="add" size={16} color="#FFF" />
                    <Text style={styles.addBtnTxt}>Aggiungi</Text>
                  </Pressable>
                </View>

                {draftPhones.length === 0 ? (
                  <Text style={styles.empty}>
                    Nessun numero. Tocca &quot;Aggiungi&quot; per inserire il primo.
                  </Text>
                ) : (
                  draftPhones.map((p) => (
                    <View key={p.id} style={styles.phoneEditRow}>
                      <View style={{ flex: 1, gap: 6 }}>
                        <TextInput
                          testID={`company-sheet-phone-label-${p.id}`}
                          value={p.label}
                          onChangeText={(t) => updateDraftPhone(p.id, "label", t)}
                          placeholder="Etichetta (es. Assistenza Consulenti)"
                          placeholderTextColor={C.muted}
                          style={[styles.input, { fontSize: 13 }]}
                        />
                        <TextInput
                          testID={`company-sheet-phone-number-${p.id}`}
                          value={p.number}
                          onChangeText={(t) => updateDraftPhone(p.id, "number", t)}
                          placeholder="Numero (es. +39 02 1234 5678)"
                          placeholderTextColor={C.muted}
                          keyboardType="phone-pad"
                          style={[styles.input, { fontSize: 13 }]}
                        />
                      </View>
                      <Pressable
                        onPress={() => removeDraftPhone(p.id)}
                        hitSlop={6}
                        style={styles.trashBtn}
                        testID={`company-sheet-remove-phone-${p.id}`}
                      >
                        <Ionicons name="trash" size={16} color="#DC2626" />
                      </Pressable>
                    </View>
                  ))
                )}

                <View style={styles.actionsRow}>
                  <Pressable
                    onPress={() => setEditMode(false)}
                    style={styles.btnGhost}
                    disabled={saving}
                    testID="company-sheet-cancel"
                  >
                    <Text style={styles.btnGhostTxt}>Annulla</Text>
                  </Pressable>
                  <Pressable
                    onPress={saveChanges}
                    style={[styles.btnSave, saving && { opacity: 0.6 }]}
                    disabled={saving}
                    testID="company-sheet-save"
                  >
                    <Ionicons name="save" size={16} color="#FFF" />
                    <Text style={styles.btnSaveTxt}>{saving ? "Salvo…" : "Salva"}</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              // ─────────── VIEW MODE ───────────
              <>
                <Text style={styles.companyName}>
                  {data.communica_azienda_name?.trim() || (loading ? "Caricamento…" : "Azienda")}
                </Text>

                {data.communica_azienda_email ? (
                  <Pressable
                    onPress={() => openMail(data.communica_azienda_email || "")}
                    style={styles.emailRow}
                    testID="company-sheet-email"
                  >
                    <View style={[styles.rowIcon, { backgroundColor: "#DBEAFE" }]}>
                      <Ionicons name="mail" size={18} color="#1D4ED8" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowLabel}>Email</Text>
                      <Text style={styles.rowValue} numberOfLines={1}>
                        {data.communica_azienda_email}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={C.muted} />
                  </Pressable>
                ) : null}

                {phones.length === 0 ? (
                  <View style={styles.emptyBox}>
                    <Ionicons name="call" size={22} color={C.muted} />
                    <Text style={styles.emptyTxt}>Nessun numero configurato</Text>
                    {isMaster ? (
                      <Text style={styles.emptySub}>
                        Tocca &quot;Modifica&quot; per aggiungere numeri di servizio
                      </Text>
                    ) : (
                      <Text style={styles.emptySub}>
                        Chiedi al tuo Master di configurare i numeri di servizio
                      </Text>
                    )}
                  </View>
                ) : (
                  phones.map((p) => (
                    <Pressable
                      key={p.id}
                      onPress={() => callNumber(p.number)}
                      style={styles.phoneRow}
                      testID={`company-sheet-call-${p.id}`}
                    >
                      <View style={[styles.rowIcon, { backgroundColor: "#DCFCE7" }]}>
                        <Ionicons name="call" size={18} color={C.green} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowLabel} numberOfLines={1}>
                          {p.label || "Contatto"}
                        </Text>
                        <Text style={styles.rowValueBig} numberOfLines={1}>
                          {p.number}
                        </Text>
                      </View>
                      <View style={styles.callBadge}>
                        <Ionicons name="call" size={14} color="#FFF" />
                      </View>
                    </Pressable>
                  ))
                )}
              </>
            )}
          </ScrollView>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.55)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#FFF",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 8,
  },
  handle: {
    alignSelf: "center",
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#CBD5E1",
    marginBottom: 6,
  },
  hdrRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#EEF0F4",
  },
  hdrIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  hdrLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: "800",
    color: C.navy,
    letterSpacing: -0.2,
  },
  editBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: "#FFF1E9",
    borderWidth: 1,
    borderColor: C.primary,
  },
  editBtnTxt: { fontSize: 12, fontWeight: "800", color: C.primary },
  companyName: {
    fontSize: 22,
    fontWeight: "900",
    color: C.navy,
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  emailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: C.bg,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
  },
  phoneRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#FFF",
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  rowLabel: { fontSize: 11, fontWeight: "700", color: C.muted, textTransform: "uppercase", letterSpacing: 0.5 },
  rowValue: { fontSize: 14, fontWeight: "700", color: C.navy, marginTop: 2 },
  rowValueBig: { fontSize: 18, fontWeight: "900", color: C.navy, letterSpacing: -0.3, marginTop: 2 },
  callBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: C.green,
    alignItems: "center",
    justifyContent: "center",
  },
  fieldLbl: { fontSize: 12, fontWeight: "800", color: C.navy, letterSpacing: -0.1 },
  input: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    color: C.navy,
    backgroundColor: "#FFF",
  },
  phonesHdr: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 8,
    marginBottom: 4,
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: C.primary,
  },
  addBtnTxt: { fontSize: 12, fontWeight: "800", color: "#FFF" },
  phoneEditRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: C.bg,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  trashBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: "#FEE2E2",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  empty: { fontSize: 12, color: C.muted, fontStyle: "italic", textAlign: "center", padding: 12 },
  emptyBox: {
    alignItems: "center",
    padding: 20,
    gap: 6,
    backgroundColor: C.bg,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: C.border,
  },
  emptyTxt: { fontSize: 14, fontWeight: "800", color: C.navy },
  emptySub: { fontSize: 11, color: C.muted, textAlign: "center" },
  actionsRow: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 12 },
  btnGhost: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, backgroundColor: "#F1F5F9" },
  btnGhostTxt: { fontSize: 13, fontWeight: "800", color: "#64748B" },
  btnSave: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: C.primary,
  },
  btnSaveTxt: { fontSize: 13, fontWeight: "800", color: "#FFF" },
});

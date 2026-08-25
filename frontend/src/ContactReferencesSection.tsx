/**
 * V28.q — ContactReferencesSection
 * Sezione "Referenze" mostrata nella vista principale dell'anagrafica.
 * Il Master (o admin/member con permesso) può collegare bidirezionalmente altre
 * anagrafiche esistenti. I chip mostrano avatar + nome; il tap apre l'anagrafica.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, Image, Modal, TextInput, ActivityIndicator, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";

type ContactRef = {
  contact_id: string;
  first_name: string;
  last_name?: string;
  avatar_base64?: string | null;
  area?: string;
  contact_code?: string;
  status?: string;
};

const AREA_COLOR: Record<string, string> = {
  energy: "#EA580C",
  network: "#2563EB",
};

function initials(first?: string, last?: string): string {
  const f = (first || "").trim();
  const l = (last || "").trim();
  return `${f.charAt(0)}${l.charAt(0)}`.toUpperCase() || "?";
}

export function ContactReferencesSection({ contactId, contactName }: { contactId: string; contactName?: string }) {
  const router = useRouter();
  const { user } = useAuth();
  // Il Master (owner) può sempre modificare; gli altri hanno accesso in sola lettura.
  const canEdit = !user?.parent_user_id && (user?.role || "member") === "owner";

  const [items, setItems] = useState<ContactRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [allContacts, setAllContacts] = useState<ContactRef[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!contactId) return;
    try {
      setLoading(true);
      const res = await api<{ items: ContactRef[] }>(`/contacts/${contactId}/references`);
      setItems(res.items || []);
    } catch (e: any) {
      // Silent: se il contatto non ha refs va bene mostrare vuoto.
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => { load(); }, [load]);

  const openPicker = useCallback(async () => {
    setPickerOpen(true);
    if (allContacts.length === 0) {
      setPickerLoading(true);
      try {
        const res = await api<{ items?: ContactRef[] } | ContactRef[]>("/contacts?limit=500");
        const list = Array.isArray(res) ? res : (res.items || []);
        setAllContacts(list);
      } catch (e: any) {
        notify("Errore", e?.message || "Impossibile caricare i contatti");
      } finally {
        setPickerLoading(false);
      }
    }
  }, [allContacts.length]);

  const linkedIds = useMemo(() => new Set(items.map((it) => it.contact_id)), [items]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return allContacts
      .filter((c) => c.contact_id !== contactId) // exclude self
      .filter((c) => !linkedIds.has(c.contact_id)) // exclude already-linked
      .filter((c) => {
        if (!term) return true;
        const full = `${c.first_name || ""} ${c.last_name || ""}`.toLowerCase();
        return full.includes(term) || (c.contact_code || "").toLowerCase().includes(term);
      })
      .slice(0, 200);
  }, [allContacts, contactId, linkedIds, q]);

  const linkContact = async (ref: ContactRef) => {
    try {
      setBusy(true);
      await api(`/contacts/${contactId}/references/${ref.contact_id}`, { method: "POST" });
      setPickerOpen(false);
      setQ("");
      await load();
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile collegare la referenza");
    } finally {
      setBusy(false);
    }
  };

  const unlinkContact = async (ref: ContactRef) => {
    try {
      setBusy(true);
      await api(`/contacts/${contactId}/references/${ref.contact_id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((it) => it.contact_id !== ref.contact_id));
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile rimuovere la referenza");
    } finally {
      setBusy(false);
    }
  };

  // Non mostriamo la sezione se non ci sono referenze e l'utente non può editare
  if (!canEdit && items.length === 0) return null;

  return (
    <View style={styles.wrap} testID="contact-references-section">
      <View style={styles.hdr}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
          <View style={styles.hdrIcon}>
            <Ionicons name="people" size={14} color="#7C3AED" />
          </View>
          <Text style={styles.hdrTitle}>Referenze</Text>
          <View style={styles.countPill}><Text style={styles.countPillTxt}>{items.length}</Text></View>
        </View>
        {canEdit && (
          <Pressable testID="ref-add-btn" onPress={openPicker} disabled={busy} style={styles.addBtn} hitSlop={6}>
            <Ionicons name="add-circle" size={18} color="#7C3AED" />
            <Text style={styles.addBtnTxt}>Aggiungi</Text>
          </Pressable>
        )}
      </View>

      {loading ? (
        <ActivityIndicator size="small" color="#7C3AED" style={{ marginTop: 6 }} />
      ) : items.length === 0 ? (
        <Text style={styles.emptyTxt}>Nessuna referenza collegata. {canEdit ? "Tocca &quot;Aggiungi&quot; per collegare un contatto." : ""}</Text>
      ) : (
        <View style={styles.chipsRow}>
          {items.map((it) => {
            const name = `${it.first_name || ""} ${it.last_name || ""}`.trim() || "Contatto";
            const color = AREA_COLOR[it.area || "energy"] || "#7C3AED";
            return (
              <View key={it.contact_id} style={styles.chip} testID={`ref-chip-${it.contact_id}`}>
                <Pressable
                  onPress={() => router.push(`/contact/${it.contact_id}` as any)}
                  style={styles.chipPress}
                  testID={`ref-chip-open-${it.contact_id}`}
                >
                  {it.avatar_base64 ? (
                    <Image
                      source={{ uri: it.avatar_base64.startsWith("data:") ? it.avatar_base64 : `data:image/jpeg;base64,${it.avatar_base64}` }}
                      style={styles.chipAvatar}
                    />
                  ) : (
                    <View style={[styles.chipAvatarFallback, { backgroundColor: color }]}>
                      <Text style={styles.chipInitials}>{initials(it.first_name, it.last_name)}</Text>
                    </View>
                  )}
                  <Text style={styles.chipTxt} numberOfLines={1}>{name}</Text>
                </Pressable>
                {canEdit && (
                  <Pressable
                    testID={`ref-remove-${it.contact_id}`}
                    onPress={() => unlinkContact(it)}
                    disabled={busy}
                    hitSlop={8}
                    style={styles.chipRemove}
                  >
                    <Ionicons name="close-circle" size={16} color="#94A3B8" />
                  </Pressable>
                )}
              </View>
            );
          })}
        </View>
      )}

      {/* Picker modal */}
      <Modal transparent visible={pickerOpen} animationType="slide" onRequestClose={() => !busy && setPickerOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHdr}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetTitle}>Aggiungi referenza</Text>
                <Text style={styles.sheetSub}>{contactName ? `per "${contactName}"` : "Seleziona un contatto da collegare"}</Text>
              </View>
              <Pressable onPress={() => !busy && setPickerOpen(false)} hitSlop={10}>
                <Ionicons name="close" size={22} color={theme.color.onSurface} />
              </Pressable>
            </View>
            <View style={styles.searchWrap}>
              <Ionicons name="search" size={16} color="#94A3B8" />
              <TextInput
                testID="ref-search-input"
                value={q}
                onChangeText={setQ}
                placeholder="Cerca per nome o codice…"
                placeholderTextColor="#94A3B8"
                style={styles.searchInput}
                autoCapitalize="none"
              />
              {q ? (
                <Pressable onPress={() => setQ("")} hitSlop={8}>
                  <Ionicons name="close-circle" size={16} color="#94A3B8" />
                </Pressable>
              ) : null}
            </View>
            {pickerLoading ? (
              <ActivityIndicator color="#7C3AED" style={{ marginTop: 20 }} />
            ) : filtered.length === 0 ? (
              <View style={styles.emptyPicker}>
                <Ionicons name="search" size={26} color="#94A3B8" />
                <Text style={styles.emptyTxt}>Nessun contatto trovato</Text>
              </View>
            ) : (
              <ScrollView contentContainerStyle={{ paddingBottom: 20 }} keyboardShouldPersistTaps="handled">
                {filtered.map((c) => {
                  const name = `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Contatto";
                  const color = AREA_COLOR[c.area || "energy"] || "#7C3AED";
                  return (
                    <Pressable
                      key={c.contact_id}
                      testID={`ref-picker-${c.contact_id}`}
                      onPress={() => linkContact(c)}
                      disabled={busy}
                      style={styles.pickerRow}
                    >
                      {c.avatar_base64 ? (
                        <Image
                          source={{ uri: c.avatar_base64.startsWith("data:") ? c.avatar_base64 : `data:image/jpeg;base64,${c.avatar_base64}` }}
                          style={styles.rowAvatar}
                        />
                      ) : (
                        <View style={[styles.rowAvatarFallback, { backgroundColor: color }]}>
                          <Text style={styles.rowInitials}>{initials(c.first_name, c.last_name)}</Text>
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowName} numberOfLines={1}>{name}</Text>
                        {c.contact_code ? <Text style={styles.rowMeta}>{c.contact_code}</Text> : null}
                      </View>
                      <Ionicons name="add-circle-outline" size={22} color="#7C3AED" />
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: "#FFF", borderRadius: 14, padding: 12, gap: 8, borderWidth: 1, borderColor: theme.color.border, marginTop: 10 },
  hdr: { flexDirection: "row", alignItems: "center", gap: 8 },
  hdrIcon: { width: 28, height: 28, borderRadius: 8, backgroundColor: "#EDE9FE", alignItems: "center", justifyContent: "center" },
  hdrTitle: { fontSize: 14, fontWeight: "800", color: theme.color.onSurface, letterSpacing: -0.2 },
  countPill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: "#EDE9FE" },
  countPillTxt: { fontSize: 11, fontWeight: "800", color: "#7C3AED" },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 999, backgroundColor: "#EDE9FE" },
  addBtnTxt: { fontSize: 12, fontWeight: "800", color: "#7C3AED" },
  emptyTxt: { fontSize: 12, color: theme.color.muted, fontStyle: "italic" },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#F8FAFC", borderRadius: 999, paddingRight: 6, borderWidth: 1, borderColor: "#E2E8F0" },
  chipPress: { flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 2, paddingVertical: 3, paddingRight: 6, maxWidth: 220 },
  chipAvatar: { width: 26, height: 26, borderRadius: 13, backgroundColor: "#E2E8F0" },
  chipAvatarFallback: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  chipInitials: { fontSize: 10, fontWeight: "800", color: "#FFF" },
  chipTxt: { fontSize: 12, fontWeight: "700", color: theme.color.onSurface, flexShrink: 1 },
  chipRemove: { padding: 2 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#FFF", borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, paddingBottom: 30, maxHeight: "82%" },
  sheetHdr: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  sheetTitle: { fontSize: 17, fontWeight: "800", color: theme.color.onSurface },
  sheetSub: { fontSize: 11, color: theme.color.muted, marginTop: 2, fontWeight: "600" },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#F1F5F9", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 10 },
  searchInput: { flex: 1, fontSize: 14, color: theme.color.onSurface, padding: 0 },
  emptyPicker: { alignItems: "center", padding: 30, gap: 8 },
  pickerRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: "#F1F5F9" },
  rowAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#E2E8F0" },
  rowAvatarFallback: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  rowInitials: { fontSize: 13, fontWeight: "800", color: "#FFF" },
  rowName: { fontSize: 14, fontWeight: "700", color: theme.color.onSurface },
  rowMeta: { fontSize: 11, color: theme.color.muted, fontWeight: "600" },
});

import { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ScrollView, ActivityIndicator, Modal } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";

import { useBottomSheetPadding, usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
/**
 * V27 — Pick or quick-create a contact for an invite (prospect | collaborator).
 * Query params:
 *   intent = "prospect" | "collaborator"  (default: prospect)
 * After confirming, routes to the actual invite generator:
 *   /invite-collaborator?contact_id=…&contact_name=…&contact_email=…&intent=collaborator
 *   /invitati?contact_id=…&contact_name=…&contact_email=…                (for prospect trial invites)
 */
type Contact = {
  contact_id: string;
  first_name: string;
  last_name: string;
  email?: string;
  phone?: string;
  status?: string;
};

export default function InvitaPickContact() {
  const router = useRouter();
  const params = useLocalSearchParams<{ intent?: string }>();
  const intent = (params.intent === "collaborator" ? "collaborator" : "prospect") as "prospect" | "collaborator";
  const [contacts, setContacts] = useState<Contact[]>([]);
  const bottomPad = useBottomSheetPadding();
  const pagePad = usePageBottomPadding();
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);

  // Quick-create form
  const [qFirst, setQFirst] = useState("");
  const [qLast, setQLast] = useState("");
  const [qEmail, setQEmail] = useState("");
  const [qPhone, setQPhone] = useState("");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const r = await api<{ items: Contact[] }>("/contacts");
      setContacts(r.items || []);
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile caricare i contatti");
    } finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const filtered = useMemo(() => {
    if (!search.trim()) return contacts.slice(0, 200);
    const q = search.toLowerCase();
    return contacts.filter((c) =>
      `${c.first_name || ""} ${c.last_name || ""}`.toLowerCase().includes(q)
      || (c.email || "").toLowerCase().includes(q)
      || (c.phone || "").includes(q)
    ).slice(0, 200);
  }, [contacts, search]);

  const pick = (ct: Contact) => {
    const name = `${ct.first_name || ""} ${ct.last_name || ""}`.trim();
    if (intent === "collaborator") {
      router.replace(`/invite-collaborator?contact_id=${ct.contact_id}&contact_name=${encodeURIComponent(name)}&contact_email=${encodeURIComponent(ct.email || "")}&intent=collaborator` as any);
    } else {
      // For prospect flow we stay in the invitati screen (trial-only invite). Keep contact_id in query for backend linkage.
      router.replace(`/invitati?contact_id=${ct.contact_id}&contact_name=${encodeURIComponent(name)}&contact_email=${encodeURIComponent(ct.email || "")}` as any);
    }
  };

  const createAndContinue = async () => {
    if (!qFirst.trim() && !qEmail.trim() && !qPhone.trim()) {
      notify("Dati richiesti", "Servono almeno nome, email o telefono.");
      return;
    }
    try {
      setBusy(true);
      const created = await api<Contact>("/contacts", {
        method: "POST",
        body: {
          first_name: qFirst.trim() || (qEmail.split("@")[0] || "—"),
          last_name: qLast.trim(),
          email: qEmail.trim().toLowerCase(),
          phone: qPhone.trim(),
          area: "energy",
          source: "personal",
          status: intent, // V27 — new contact gets the intended status
        },
      });
      setShowCreate(false);
      pick(created);
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile creare il contatto");
    } finally { setBusy(false); }
  };

  const intentMeta = intent === "collaborator"
    ? { label: "Collaboratore", color: "#7C3AED", icon: "people" as const }
    : { label: "Prospect", color: "#0891B2", icon: "person-outline" as const };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} testID="pick-back">
          <Ionicons name="chevron-back" size={26} color={theme.color.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Invita {intentMeta.label}</Text>
          <Text style={styles.sub}>Scegli un contatto o creane uno nuovo</Text>
        </View>
        <View style={[styles.intentBadge, { backgroundColor: intentMeta.color }]}>
          <Ionicons name={intentMeta.icon} size={14} color="#FFF" />
        </View>
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={16} color={theme.color.muted} />
        <TextInput
          testID="contact-search"
          value={search}
          onChangeText={setSearch}
          placeholder="Cerca per nome, email o telefono…"
          placeholderTextColor="#94A3B8"
          style={styles.searchInput}
        />
      </View>

      <Pressable testID="quick-create-btn" onPress={() => setShowCreate(true)} style={styles.createBtn}>
        <View style={[styles.createIcon, { backgroundColor: intentMeta.color }]}>
          <Ionicons name="add" size={22} color="#FFF" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.createTitle}>Crea nuovo contatto</Text>
          <Text style={styles.createSub}>Aggiungi al volo nome, email e telefono</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={theme.color.muted} />
      </Pressable>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: pagePad, gap: 8 }}>
        <Text style={styles.sectionLbl}>Contatti in rubrica ({filtered.length})</Text>
        {loading ? (
          <ActivityIndicator style={{ marginTop: 20 }} color={theme.color.brandPrimary} />
        ) : filtered.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="people-outline" size={30} color={theme.color.muted} />
            <Text style={styles.emptyTxt}>{search ? "Nessun contatto trovato." : "La tua rubrica è vuota."}</Text>
          </View>
        ) : (
          filtered.map((ct) => (
            <Pressable
              key={ct.contact_id}
              testID={`pick-${ct.contact_id}`}
              onPress={() => pick(ct)}
              style={styles.row}
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarTxt}>
                  {(ct.first_name?.[0] || "").toUpperCase()}{(ct.last_name?.[0] || "").toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName} numberOfLines={1}>{ct.first_name} {ct.last_name}</Text>
                <Text style={styles.rowSub} numberOfLines={1}>{ct.email || ct.phone || "—"}</Text>
              </View>
              {ct.status && (
                <View style={[styles.statusMini, { backgroundColor: (ct.status === "collaborator" ? "#7C3AED" : ct.status === "client" ? "#16A34A" : "#0891B2") + "22" }]}>
                  <Text style={[styles.statusMiniTxt, { color: ct.status === "collaborator" ? "#7C3AED" : ct.status === "client" ? "#16A34A" : "#0891B2" }]}>
                    {ct.status === "collaborator" ? "Collab." : ct.status === "client" ? "Cliente" : "Prospect"}
                  </Text>
                </View>
              )}
              <Ionicons name="chevron-forward" size={18} color={theme.color.muted} />
            </Pressable>
          ))
        )}
      </ScrollView>

      {/* Quick-create modal */}
      <Modal transparent visible={showCreate} animationType="slide" onRequestClose={() => setShowCreate(false)}>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { paddingBottom: bottomPad }]}>
            <View style={styles.sheetHdr}>
              <Text style={styles.sheetTitle}>Nuovo contatto</Text>
              <Pressable onPress={() => setShowCreate(false)} hitSlop={8}>
                <Ionicons name="close" size={22} color={theme.color.onSurface} />
              </Pressable>
            </View>
            <Text style={styles.lbl}>Nome</Text>
            <TextInput value={qFirst} onChangeText={setQFirst} placeholder="Es. Mario" placeholderTextColor="#94A3B8" style={styles.input} testID="q-first" />
            <Text style={styles.lbl}>Cognome</Text>
            <TextInput value={qLast} onChangeText={setQLast} placeholder="Es. Rossi" placeholderTextColor="#94A3B8" style={styles.input} testID="q-last" />
            <Text style={styles.lbl}>Email</Text>
            <TextInput value={qEmail} onChangeText={setQEmail} placeholder="mario.rossi@example.it" placeholderTextColor="#94A3B8" style={styles.input} keyboardType="email-address" autoCapitalize="none" testID="q-email" />
            <Text style={styles.lbl}>Telefono</Text>
            <TextInput value={qPhone} onChangeText={setQPhone} placeholder="+39 333 1234567" placeholderTextColor="#94A3B8" style={styles.input} keyboardType="phone-pad" testID="q-phone" />
            <Pressable onPress={createAndContinue} disabled={busy} style={[styles.saveBtn, { backgroundColor: intentMeta.color }]} testID="q-save">
              {busy ? <ActivityIndicator color="#FFF" /> : (
                <>
                  <Ionicons name="checkmark" size={18} color="#FFF" />
                  <Text style={styles.saveBtnTxt}>Crea e invita</Text>
                </>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontSize: 17, fontWeight: "800", color: theme.color.onSurface },
  sub: { fontSize: 12, color: theme.color.muted, marginTop: 2 },
  intentBadge: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16, backgroundColor: "#FFF", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: theme.color.border },
  searchInput: { flex: 1, fontSize: 14, color: theme.color.onSurface },
  createBtn: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#FFF", borderRadius: 14, padding: 14, marginHorizontal: 16, marginTop: 12, marginBottom: 8, borderWidth: 1, borderColor: theme.color.border, borderStyle: "dashed" },
  // V29.bb — Stile Optima
  createIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.9)",
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  createTitle: { fontSize: 14, fontWeight: "800", color: theme.color.onSurface },
  createSub: { fontSize: 11, color: theme.color.muted, marginTop: 2 },
  sectionLbl: { fontSize: 11, fontWeight: "800", color: theme.color.muted, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 8, marginBottom: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#FFF", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: theme.color.border },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.color.brandTertiary, alignItems: "center", justifyContent: "center" },
  avatarTxt: { color: theme.color.brandPrimary, fontWeight: "800", fontSize: 13 },
  rowName: { fontSize: 14, fontWeight: "700", color: theme.color.onSurface },
  rowSub: { fontSize: 11, color: theme.color.muted, marginTop: 2 },
  statusMini: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  statusMiniTxt: { fontSize: 10, fontWeight: "800" },
  empty: { alignItems: "center", padding: 20, gap: 8 },
  emptyTxt: { color: theme.color.muted, fontStyle: "italic" },
  // Modal
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#FFF", borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, gap: 4, paddingBottom: 30 },
  sheetHdr: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  sheetTitle: { fontSize: 17, fontWeight: "800", color: theme.color.onSurface },
  lbl: { fontSize: 11, fontWeight: "700", color: theme.color.muted, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 10, marginBottom: 4 },
  input: { backgroundColor: "#F1F5F9", borderRadius: 10, padding: 12, fontSize: 14, color: theme.color.onSurface },
  saveBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, padding: 14, marginTop: 14 },
  saveBtnTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
});

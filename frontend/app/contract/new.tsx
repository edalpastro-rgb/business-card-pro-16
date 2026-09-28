import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, Modal } from "react-native";
import { KScrollView } from "@/src/ui/keyboard"; // V50.z374 — tastiera: campo attivo sempre visibile
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";

import { useBottomSheetPadding } from "@/src/utils/bottomSheetInsets";
import { ContractFormsSection } from "@/src/ContractFormsSection"; // V50.z268
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium
import { DateField } from "@/src/ui/DateField"; // V50.z388 — calendario nativo su ogni campo data
import { KModalBody } from "@/src/ui/keyboard"; // V50.z397 — tastiera: campo attivo sempre visibile nelle Modal
type Contact = { contact_id: string; first_name: string; last_name: string; contact_code?: string; phone?: string };

const TYPES = [
  { id: "luce", label: "Luce", color: "#F59E0B", icon: "flash" as const },
  { id: "gas", label: "Gas", color: "#DC2626", icon: "flame" as const },
  { id: "telco", label: "Telco", color: "#0891B2", icon: "call" as const },
  { id: "other", label: "Altro", color: HT.muted, icon: "document" as const },
];

export default function NewContractScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ contact_id?: string }>();
  const [contact, setContact] = useState<Contact | null>(null);
  const bottomPad = useBottomSheetPadding();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState("");
  const [contractNumber, setContractNumber] = useState("");
  const [contractType, setContractType] = useState("luce");
  const [supplier, setSupplier] = useState("");
  const [signedDate, setSignedDate] = useState(new Date().toISOString().slice(0,10));
  const [expiryDate, setExpiryDate] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await api<{ items: Contact[] }>("/contacts");
        setContacts(r.items || []);
        if (params.contact_id) {
          const c = r.items?.find(x => x.contact_id === params.contact_id);
          if (c) setContact(c);
        }
      } catch {}
    })();
  }, [params.contact_id]);

  const filtered = contacts.filter(c => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return `${c.first_name} ${c.last_name} ${c.contact_code || ""} ${c.phone || ""}`.toLowerCase().includes(q);
  }).slice(0, 40);

  const submit = async () => {
    if (!contractNumber.trim() && !supplier.trim()) { notify("Compila almeno numero o fornitore"); return; }
    try {
      setSaving(true);
      await api("/contracts", {
        method: "POST",
        body: {
          contact_id: contact?.contact_id,
          contract_number: contractNumber.trim() || undefined,
          contract_type: contractType,
          supplier: supplier.trim() || undefined,
          signed_date: signedDate || undefined,
          expiry_date: expiryDate || undefined,
          amount_eur: amount ? parseFloat(amount.replace(",", ".")) : undefined,
          status: "active",
          notes: notes.trim(),
        },
      });
      notify("Contratto salvato", "Il contratto è stato aggiunto.", [{ text: "OK", onPress: () => router.back() }]);
    } catch (e: any) { notify("Errore", e?.message || ""); } finally { setSaving(false); }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.color.background }} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn}><Ionicons name="chevron-back" size={22} color={HT.text} /></Pressable>
        <Text style={styles.headerTitle}>Nuovo Contratto</Text>
      </View>
      <KScrollView contentContainerStyle={{ padding: 16, paddingBottom: 140 }}>
        <Text style={styles.label}>Cliente (opzionale)</Text>
        <Pressable onPress={() => setPickerOpen(true)} style={styles.pickerBtn} testID="contract-contact-picker">
          {contact ? (
            <>
              <Ionicons name="person-circle" size={22} color="#059669" />
              <Text style={styles.pickerTxt}>{contact.first_name} {contact.last_name}{contact.contact_code ? ` · ${contact.contact_code}` : ""}</Text>
              <Ionicons name="close-circle" size={18} color={HT.muted} onPress={(e: any) => { e.stopPropagation?.(); setContact(null); }} />
            </>
          ) : (
            <>
              <Ionicons name="person-add" size={20} color={HT.muted} />
              <Text style={[styles.pickerTxt, { color: HT.muted }]}>Seleziona cliente…</Text>
            </>
          )}
        </Pressable>

        <Text style={styles.label}>Tipo</Text>
        <View style={styles.typeRow}>
          {TYPES.map(t => (
            <Pressable key={t.id} onPress={() => setContractType(t.id)} style={[styles.typeChip, contractType === t.id && { backgroundColor: t.color, borderColor: t.color }]} testID={`type-${t.id}`}>
              <Ionicons name={t.icon} size={16} color={contractType === t.id ? "#FFF" : t.color} />
              <Text style={[styles.typeChipTxt, contractType === t.id && { color: "#FFF" }]}>{t.label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Numero contratto</Text>
        <TextInput value={contractNumber} onChangeText={setContractNumber} style={styles.input} placeholder="Es. C-2026-001" testID="contract-num" />

        <Text style={styles.label}>Fornitore</Text>
        <TextInput value={supplier} onChangeText={setSupplier} style={styles.input} placeholder="Es. ENEL Energia" testID="contract-supplier" />

        <View style={styles.rowGap}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Data firma</Text>
            <DateField value={signedDate} onChange={setSignedDate} placeholder="Data firma" testID="contract-signed" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Data scadenza</Text>
            <DateField value={expiryDate} onChange={setExpiryDate} placeholder="Data scadenza" testID="contract-expiry" />
          </View>
        </View>

        <Text style={styles.label}>Importo €</Text>
        <TextInput value={amount} onChangeText={setAmount} style={styles.input} placeholder="0,00" keyboardType="decimal-pad" testID="contract-amount" />

        <Text style={styles.label}>Note</Text>
        <TextInput value={notes} onChangeText={setNotes} style={[styles.input, { height: 80, textAlignVertical: "top" }]} multiline placeholder="Note interne" testID="contract-notes" />

        {/* V50.z268 — Modulo precompilato da Axon (modelli PDF del Master + dati cliente/documenti/fatture) */}
        <ContractFormsSection contactId={contact?.contact_id || null} />

        <Pressable onPress={submit} disabled={saving} style={styles.submitBtn} testID="contract-submit">
          {saving ? <ActivityIndicator color="#FFF" /> : (<><Ionicons name="checkmark-circle" size={20} color="#FFF" /><Text style={styles.submitTxt}>Salva contratto</Text></>)}
        </Pressable>
      </KScrollView>

      <Modal transparent visible={pickerOpen} onRequestClose={() => setPickerOpen(false)} animationType="slide"><KModalBody>
        <Pressable style={styles.backdrop} onPress={() => setPickerOpen(false)}>
          <View style={[styles.sheet, { paddingBottom: bottomPad }]} onStartShouldSetResponder={() => true}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Seleziona cliente</Text>
            <TextInput value={search} onChangeText={setSearch} placeholder="Cerca…" style={[styles.input, { marginBottom: 10 }]} />
            <KScrollView style={{ maxHeight: 400 }}>
              {filtered.map(c => (
                <Pressable key={c.contact_id} onPress={() => { setContact(c); setPickerOpen(false); }} style={styles.contactRow} testID={`pick-${c.contact_id}`}>
                  <Ionicons name="person" size={18} color={HT.muted} />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={styles.contactName}>{c.first_name} {c.last_name}</Text>
                    <Text style={styles.contactMeta}>{c.contact_code} · {c.phone}</Text>
                  </View>
                </Pressable>
              ))}
              {filtered.length === 0 && <Text style={{ textAlign: "center", color: HT.muted, padding: 20 }}>Nessun cliente trovato.</Text>}
            </KScrollView>
          </View>
        </Pressable>
      </KModalBody></Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", padding: 14, gap: 10, borderBottomWidth: 1, borderBottomColor: HT.border, backgroundColor: HT.card2 },
  headerBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: HT.card2, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, fontSize: 16, fontWeight: "800", color: HT.text },
  label: { fontSize: 12, fontWeight: "700", color: HT.muted, marginTop: 14, marginBottom: 4, textTransform: "uppercase", letterSpacing: 1 },
  pickerBtn: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10, backgroundColor: HT.card2, borderWidth: 1, borderColor: HT.border },
  pickerTxt: { flex: 1, fontSize: 14, color: HT.text, fontWeight: "600" },
  typeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  typeChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: HT.border, backgroundColor: HT.card2 },
  typeChipTxt: { fontSize: 12, fontWeight: "700", color: HT.text },
  input: { borderWidth: 1, borderColor: HT.border, borderRadius: 10, padding: 12, fontSize: 14, color: HT.text, backgroundColor: HT.card2 },
  rowGap: { flexDirection: "row", gap: 10 },
  submitBtn: { marginTop: 24, backgroundColor: '#059669', flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 14, borderRadius: 12 },
  submitTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: HT.card, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, paddingBottom: 30, maxHeight: "80%" },
  sheetHandle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: HT.borderStrong, marginBottom: 12 },
  sheetTitle: { fontSize: 16, fontWeight: "800", color: HT.text, marginBottom: 10 },
  contactRow: { flexDirection: "row", alignItems: "center", padding: 10, borderRadius: 8, borderBottomWidth: 1, borderBottomColor: HT.border },
  contactName: { fontSize: 14, fontWeight: "700", color: HT.text },
  contactMeta: { fontSize: 11, color: HT.muted, marginTop: 2 },
});

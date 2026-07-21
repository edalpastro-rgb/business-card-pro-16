import { useState, useEffect } from "react";
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { theme } from "@/src/theme";

type ContactLite = { contact_id: string; first_name: string; last_name: string };

export default function NewContactScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const allowed = (user?.areas || ["energy", "network"]) as ("energy" | "network")[];
  const [contacts, setContacts] = useState<ContactLite[]>([]);
  const [form, setForm] = useState({
    first_name: "", last_name: "",
    phone: "", phone_alt: "", whatsapp: "",
    email: "", email_alt: "",
    address_street: "", address_zip: "", address_city: "", address_province: "",
    birth_date: "", fiscal_code: "", vat_number: "",
    website: "", linkedin: "", instagram: "", facebook: "",
    area: (allowed[0] || "energy") as "energy" | "network",
    source: "personal" as "personal" | "referral",
    referred_by_contact_id: "",
    referral_note: "", email_note: "", general_note: "",
    tags: [] as string[],
    tag_input: "",
  });
  const [busy, setBusy] = useState(false);
  const [showMore, setShowMore] = useState(false);

  useEffect(() => {
    api<{ items: ContactLite[] }>("/contacts").then((r) => setContacts(r.items)).catch(() => {});
  }, []);

  const submit = async () => {
    if (!form.first_name.trim()) return;
    setBusy(true);
    try {
      const { tag_input, ...payload } = form;
      const body: any = { ...payload };
      // build compound address for backward-compat
      body.address = [form.address_street, form.address_city, form.address_province, form.address_zip]
        .filter(Boolean).join(", ");
      if (!body.referred_by_contact_id) delete body.referred_by_contact_id;
      if (!body.birth_date) delete body.birth_date;
      const c = await api<{ contact_id: string }>("/contacts", { method: "POST", body });
      router.replace(`/contact/${c.contact_id}`);
    } finally { setBusy(false); }
  };

  const addTag = () => {
    const t = form.tag_input.trim();
    if (!t) return;
    if (form.tags.includes(t)) return;
    setForm({ ...form, tags: [...form.tags, t], tag_input: "" });
  };

  const removeTag = (t: string) => setForm({ ...form, tags: form.tags.filter((x) => x !== t) });

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable testID="back-btn" onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.title}>Nuovo contatto</Text>
        <View style={{ width: 26 }} />
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

          <Section title="Anagrafica">
            <Row>
              <Field flex={1} label="Nome *" testID="c-first-name" value={form.first_name} onChangeText={(t: string) => setForm({ ...form, first_name: t })} />
              <Field flex={1} label="Cognome" testID="c-last-name" value={form.last_name} onChangeText={(t: string) => setForm({ ...form, last_name: t })} />
            </Row>
            <Field label="Data di nascita (gg/mm/aaaa)" testID="c-birth-date" value={form.birth_date} onChangeText={(t: string) => setForm({ ...form, birth_date: t })} placeholder="01/01/1980" />
            <Row>
              <Field flex={1} label="Codice Fiscale" testID="c-fiscal-code" value={form.fiscal_code} onChangeText={(t: string) => setForm({ ...form, fiscal_code: t.toUpperCase() })} />
              <Field flex={1} label="Partita IVA" testID="c-vat" value={form.vat_number} onChangeText={(t: string) => setForm({ ...form, vat_number: t })} />
            </Row>
          </Section>

          <Section title="Contatti">
            <Field label="Telefono principale" testID="c-phone" value={form.phone} onChangeText={(t: string) => setForm({ ...form, phone: t })} keyboardType="phone-pad" />
            <Row>
              <Field flex={1} label="Telefono 2°" testID="c-phone-alt" value={form.phone_alt} onChangeText={(t: string) => setForm({ ...form, phone_alt: t })} keyboardType="phone-pad" />
              <Field flex={1} label="WhatsApp" testID="c-whatsapp" value={form.whatsapp} onChangeText={(t: string) => setForm({ ...form, whatsapp: t })} keyboardType="phone-pad" />
            </Row>
            <Field label="Email principale" testID="c-email" value={form.email} onChangeText={(t: string) => setForm({ ...form, email: t })} keyboardType="email-address" autoCapitalize="none" />
            <Field label="Email 2°" testID="c-email-alt" value={form.email_alt} onChangeText={(t: string) => setForm({ ...form, email_alt: t })} keyboardType="email-address" autoCapitalize="none" />
          </Section>

          <Section title="Indirizzo">
            <Field label="Via e civico" testID="c-street" value={form.address_street} onChangeText={(t: string) => setForm({ ...form, address_street: t })} placeholder="Via Verdi 15" />
            <Row>
              <Field flex={2} label="Città" testID="c-city" value={form.address_city} onChangeText={(t: string) => setForm({ ...form, address_city: t })} />
              <Field flex={1} label="CAP" testID="c-zip" value={form.address_zip} onChangeText={(t: string) => setForm({ ...form, address_zip: t })} keyboardType="number-pad" />
              <Field flex={1} label="Prov." testID="c-prov" value={form.address_province} onChangeText={(t: string) => setForm({ ...form, address_province: t.toUpperCase().slice(0, 2) })} />
            </Row>
          </Section>

          <Section title="Classificazione">
            <Text style={styles.lbl}>Area</Text>
            <View style={styles.pillsRow}>
              {(["energy", "network"] as const).filter((a) => allowed.includes(a)).map((a) => (
                <Pressable key={a} testID={`c-area-${a}`} onPress={() => setForm({ ...form, area: a })} style={[styles.pill, form.area === a && { backgroundColor: a === "energy" ? theme.color.energy : theme.color.network, borderColor: a === "energy" ? theme.color.energy : theme.color.network }]}>
                  <Text style={[styles.pillTxt, form.area === a && styles.pillTxtActive]}>{a === "energy" ? "Energia" : "Network"}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.lbl}>Origine</Text>
            <View style={styles.pillsRow}>
              {(["personal", "referral"] as const).map((a) => (
                <Pressable key={a} testID={`c-source-${a}`} onPress={() => setForm({ ...form, source: a })} style={[styles.pill, form.source === a && styles.pillActive]}>
                  <Text style={[styles.pillTxt, form.source === a && styles.pillTxtActive]}>{a === "personal" ? "Conoscenza personale" : "Referenza"}</Text>
                </Pressable>
              ))}
            </View>

            {form.source === "referral" && (
              <>
                <Text style={styles.lbl}>Chi lo ha segnalato</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  <Pressable testID="c-ref-none" onPress={() => setForm({ ...form, referred_by_contact_id: "" })} style={[styles.pill, !form.referred_by_contact_id && styles.pillActive]}>
                    <Text style={[styles.pillTxt, !form.referred_by_contact_id && styles.pillTxtActive]}>Non specificato</Text>
                  </Pressable>
                  {contacts.map((c) => (
                    <Pressable key={c.contact_id} onPress={() => setForm({ ...form, referred_by_contact_id: c.contact_id })} style={[styles.pill, form.referred_by_contact_id === c.contact_id && styles.pillActive]}>
                      <Text style={[styles.pillTxt, form.referred_by_contact_id === c.contact_id && styles.pillTxtActive]}>{c.first_name} {c.last_name}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
                <View style={{ height: 8 }} />
                <Field label="Nota alla referenza" testID="c-referral-note" value={form.referral_note} onChangeText={(t: string) => setForm({ ...form, referral_note: t })} multiline />
              </>
            )}

            <Text style={styles.lbl}>Tag</Text>
            <View style={styles.tagRow}>
              <TextInput
                testID="c-tag-input"
                value={form.tag_input}
                onChangeText={(t) => setForm({ ...form, tag_input: t })}
                onSubmitEditing={addTag}
                style={[styles.input, { flex: 1 }]}
                placeholder="Es. VIP, energia+gas"
                placeholderTextColor="#94A3B8"
                returnKeyType="done"
              />
              <Pressable testID="c-tag-add" onPress={addTag} style={styles.tagAddBtn}>
                <Ionicons name="add" size={20} color="#FFF" />
              </Pressable>
            </View>
            {form.tags.length > 0 && (
              <View style={styles.tagsWrap}>
                {form.tags.map((t) => (
                  <Pressable key={t} onPress={() => removeTag(t)} style={styles.tagChip}>
                    <Text style={styles.tagChipTxt}>{t}</Text>
                    <Ionicons name="close" size={12} color={theme.color.brandPrimary} />
                  </Pressable>
                ))}
              </View>
            )}
          </Section>

          <Pressable testID="c-toggle-more" onPress={() => setShowMore(!showMore)} style={styles.toggleMore}>
            <Text style={styles.toggleMoreTxt}>{showMore ? "Nascondi" : "Mostra"} campi aggiuntivi (web, social, note)</Text>
            <Ionicons name={showMore ? "chevron-up" : "chevron-down"} size={16} color={theme.color.brandPrimary} />
          </Pressable>

          {showMore && (
            <>
              <Section title="Web & Social">
                <Field label="Sito web" testID="c-website" value={form.website} onChangeText={(t: string) => setForm({ ...form, website: t })} autoCapitalize="none" />
                <Field label="LinkedIn" testID="c-linkedin" value={form.linkedin} onChangeText={(t: string) => setForm({ ...form, linkedin: t })} autoCapitalize="none" />
                <Field label="Instagram" testID="c-instagram" value={form.instagram} onChangeText={(t: string) => setForm({ ...form, instagram: t })} autoCapitalize="none" />
                <Field label="Facebook" testID="c-facebook" value={form.facebook} onChangeText={(t: string) => setForm({ ...form, facebook: t })} autoCapitalize="none" />
              </Section>

              <Section title="Note">
                <Field label="Nota email condivisibile" testID="c-email-note" value={form.email_note} onChangeText={(t: string) => setForm({ ...form, email_note: t })} multiline />
                <Field label="Note generali" testID="c-general-note" value={form.general_note} onChangeText={(t: string) => setForm({ ...form, general_note: t })} multiline />
              </Section>
            </>
          )}

          <Pressable testID="c-save-btn" onPress={submit} style={styles.saveBtn} disabled={busy || !form.first_name.trim()}>
            {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.saveBtnTxt}>Salva contatto</Text>}
          </Pressable>
          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: any }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Row({ children }: { children: any }) {
  return <View style={{ flexDirection: "row", gap: 10 }}>{children}</View>;
}

function Field({ label, multiline, flex, ...rest }: any) {
  return (
    <View style={{ marginTop: 8, flex: flex }}>
      <Text style={styles.lbl}>{label}</Text>
      <TextInput
        {...rest}
        style={[styles.input, multiline && { minHeight: 70, textAlignVertical: "top" }]}
        placeholderTextColor="#94A3B8"
        multiline={multiline}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontSize: 18, fontWeight: "700", color: theme.color.onSurface },
  content: { padding: 16, paddingBottom: 40 },
  section: { backgroundColor: "#FFF", borderRadius: theme.radius.md, padding: 14, borderWidth: 1, borderColor: theme.color.border, marginTop: 12 },
  sectionTitle: { fontSize: 12, fontWeight: "700", color: theme.color.brandPrimary, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  lbl: { fontSize: 12, fontWeight: "600", color: theme.color.onSurfaceTertiary, marginTop: 8, marginBottom: 4 },
  input: { backgroundColor: theme.color.surface, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: theme.color.onSurface },
  pillsRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  pill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: theme.radius.pill, backgroundColor: "#FFF", borderWidth: 1, borderColor: theme.color.border, flexShrink: 0 },
  pillActive: { backgroundColor: theme.color.brandPrimary, borderColor: theme.color.brandPrimary },
  pillTxt: { color: theme.color.onSurfaceTertiary, fontWeight: "600", fontSize: 13 },
  pillTxtActive: { color: "#FFF" },
  tagRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  tagAddBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: theme.color.brandPrimary, alignItems: "center", justifyContent: "center" },
  tagsWrap: { flexDirection: "row", gap: 6, flexWrap: "wrap", marginTop: 8 },
  tagChip: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: theme.color.brandTertiary, paddingHorizontal: 10, paddingVertical: 4, borderRadius: theme.radius.pill },
  tagChipTxt: { color: theme.color.brandPrimary, fontWeight: "700", fontSize: 12 },
  toggleMore: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 14, paddingVertical: 10 },
  toggleMoreTxt: { color: theme.color.brandPrimary, fontWeight: "700", fontSize: 13 },
  saveBtn: { backgroundColor: theme.color.brandPrimary, paddingVertical: 14, borderRadius: theme.radius.md, alignItems: "center", marginTop: 20 },
  saveBtnTxt: { color: "#FFF", fontWeight: "700", fontSize: 15 },
});

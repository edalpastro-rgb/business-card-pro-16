import { useState, useEffect } from "react";
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform, Image, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import * as Contacts from "expo-contacts";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { theme } from "@/src/theme";
import { scheduleBirthdayReminder } from "@/src/notifications";

type ContactLite = { contact_id: string; first_name: string; last_name: string };

export default function NewContactScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ id?: string }>();
  const editId = params.id;
  const isEdit = !!editId;
  const allowed = (user?.areas || ["energy", "network"]) as ("energy" | "network")[];
  const [contacts, setContacts] = useState<ContactLite[]>([]);
  const [form, setForm] = useState({
    first_name: "", last_name: "",
    phone: "", phone_alt: "", whatsapp: "",
    email: "", email_alt: "",
    address_street: "", address_zip: "", address_city: "", address_province: "",
    birth_date: "", fiscal_code: "", vat_number: "",
    website: "", linkedin: "", instagram: "", facebook: "",
    birthday_alert_days_before: 1,
    birthday_auto_send: false,
    birthday_message: "",
    birthday_message_link: "",
    area: (allowed[0] || "energy") as "energy" | "network",
    source: "personal" as "personal" | "referral",
    referral_type: "" as "" | "direct" | "from_contact",
    referred_by_contact_id: "",
    referral_note: "", email_note: "", general_note: "",
    tags: [] as string[],
    tag_input: "",
    photos: [] as string[],
    avatar_base64: "",
  });
  const [busy, setBusy] = useState(false);
  const [showMore, setShowMore] = useState(false);

  useEffect(() => {
    api<{ items: ContactLite[] }>("/contacts").then((r) => setContacts(r.items)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!isEdit || !editId) return;
    (async () => {
      try {
        const c: any = await api(`/contacts/${editId}`);
        setForm((f) => ({
          ...f,
          first_name: c.first_name || "", last_name: c.last_name || "",
          phone: c.phone || "", phone_alt: c.phone_alt || "", whatsapp: c.whatsapp || "",
          email: c.email || "", email_alt: c.email_alt || "",
          address_street: c.address_street || "", address_number: c.address_number || "",
          address_zip: c.address_zip || "", address_city: c.address_city || "", address_province: c.address_province || "",
          birth_date: c.birth_date || "",
          birthday_alert_days_before: c.birthday_alert_days_before ?? 1,
          birthday_auto_send: !!c.birthday_auto_send,
          birthday_message: c.birthday_message || "",
          birthday_message_link: c.birthday_message_link || "",
          fiscal_code: c.fiscal_code || "", vat_number: c.vat_number || "",
          website: c.website || "", linkedin: c.linkedin || "",
          instagram: c.instagram || "", facebook: c.facebook || "",
          area: (c.area === "network" ? "network" : "energy"),
          source: (c.source === "referral" ? "referral" : "personal"),
          referral_type: c.referral_type || "",
          referred_by_contact_id: c.referred_by_contact_id || "",
          referral_note: c.referral_note || "",
          email_note: c.email_note || "",
          general_note: c.general_note || "",
          tags: c.tags || [],
        }));
      } catch (e) { console.warn(e); }
    })();
  }, [isEdit, editId]);

  const importFromPhone = async () => {
    if (Platform.OS === "web") { Alert.alert("Non disponibile", "L'importazione dalla rubrica funziona solo su cellulare (app Expo Go o build nativa)."); return; }
    const { status } = await Contacts.requestPermissionsAsync();
    if (status !== "granted") { Alert.alert("Permesso negato", "Serve accesso alla rubrica per importare."); return; }
    const c = await (Contacts as any).presentContactPickerAsync?.();
    if (!c) return;
    setForm((f) => ({
      ...f,
      first_name: c.firstName || f.first_name,
      last_name: c.lastName || f.last_name,
      phone: c.phoneNumbers?.[0]?.number || f.phone,
      phone_alt: c.phoneNumbers?.[1]?.number || f.phone_alt,
      email: c.emails?.[0]?.email || f.email,
      email_alt: c.emails?.[1]?.email || f.email_alt,
      address_street: c.addresses?.[0]?.street || f.address_street,
      address_city: c.addresses?.[0]?.city || f.address_city,
      address_zip: c.addresses?.[0]?.postalCode || f.address_zip,
      address_province: c.addresses?.[0]?.region || f.address_province,
      birth_date: c.birthday ? `${c.birthday.day || ""}/${c.birthday.month || ""}/${c.birthday.year || ""}` : f.birth_date,
    }));
  };

  const pickPhoto = async (fromCamera: boolean) => {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (Platform.OS !== "web" && !perm.granted) return;
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.5, base64: Platform.OS === "web" })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.5, base64: Platform.OS === "web" });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    let b64 = a.base64;
    if (!b64) {
      try { b64 = await FileSystem.readAsStringAsync(a.uri, { encoding: FileSystem.EncodingType.Base64 }); }
      catch { return; }
    }
    const dataUri = `data:${a.mimeType || "image/jpeg"};base64,${b64}`;
    setForm({ ...form, photos: [...form.photos, dataUri] });
  };

  const removePhoto = (idx: number) => {
    setForm({ ...form, photos: form.photos.filter((_, i) => i !== idx) });
  };

  const submit = async () => {
    if (!form.first_name.trim()) return;
    setBusy(true);
    try {
      const { tag_input, photos, ...payload } = form;
      const body: any = { ...payload };
      body.address = [
        [form.address_street, form.address_number].filter(Boolean).join(" "),
        form.address_city, form.address_province, form.address_zip
      ].filter(Boolean).join(", ");
      if (!body.referred_by_contact_id) delete body.referred_by_contact_id;
      if (!body.referral_type) delete body.referral_type;
      if (!body.birth_date) delete body.birth_date;

      let contactId: string;
      if (isEdit && editId) {
        await api(`/contacts/${editId}`, { method: "PUT", body });
        contactId = editId;
      } else {
        const c = await api<{ contact_id: string }>("/contacts", { method: "POST", body });
        contactId = c.contact_id;
      }

      // attach photos as notes with kind="photo" (only new ones during create)
      if (!isEdit) {
        for (const p of photos) {
          try { await api(`/contacts/${contactId}/notes`, { method: "POST", body: { kind: "photo", photo_base64: p } }); } catch {}
        }
      }
      // schedule birthday reminder if birth_date present
      if (form.birth_date && form.birth_date.length >= 5) {
        try {
          await scheduleBirthdayReminder(contactId, `${form.first_name} ${form.last_name}`.trim(), form.birth_date, form.birthday_alert_days_before);
        } catch {}
      }
      router.replace(`/contact/${contactId}`);
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
        <Text style={styles.title}>{isEdit ? "Modifica contatto" : "Nuovo contatto"}</Text>
        <View style={{ width: 26 }} />
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

          <Pressable testID="import-phone-btn" onPress={importFromPhone} style={styles.importBtn}>
            <Ionicons name="download-outline" size={18} color={theme.color.brandPrimary} />
            <Text style={styles.importBtnTxt}>Importa dalla rubrica telefono</Text>
          </Pressable>

          <Section title="Anagrafica">
            <Row>
              <Field flex={1} label="Nome *" testID="c-first-name" value={form.first_name} onChangeText={(t: string) => setForm({ ...form, first_name: t })} />
              <Field flex={1} label="Cognome" testID="c-last-name" value={form.last_name} onChangeText={(t: string) => setForm({ ...form, last_name: t })} />
            </Row>
            <Text style={styles.lbl}>Data di nascita</Text>
            {Platform.OS === "web" ? (
              <View style={{ marginBottom: 4 }}>
                {/* @ts-expect-error web-only */}
                <input
                  type="date"
                  data-testid="c-birth-date-web"
                  value={(() => {
                    const p = form.birth_date.split("/");
                    if (p.length === 3) {
                      const y = p[2].padStart(4, "0"), m = p[1].padStart(2, "0"), d = p[0].padStart(2, "0");
                      return `${y}-${m}-${d}`;
                    }
                    return "";
                  })()}
                  onChange={(e: any) => {
                    const v = e.target.value;
                    if (!v) { setForm({ ...form, birth_date: "" }); return; }
                    const [y, m, d] = v.split("-");
                    setForm({ ...form, birth_date: `${d}/${m}/${y}` });
                  }}
                  style={webDateInputStyle}
                />
              </View>
            ) : (
              <Field label="" testID="c-birth-date" value={form.birth_date} onChangeText={(t: string) => setForm({ ...form, birth_date: t })} placeholder="gg/mm/aaaa" />
            )}

            {form.birth_date.length >= 5 && (
              <>
                <Text style={styles.lbl}>Avviso compleanno</Text>
                <View style={styles.pillsRow}>
                  {[
                    { d: 0, label: "Solo il giorno" },
                    { d: 1, label: "1 giorno prima" },
                    { d: 2, label: "2 giorni prima" },
                  ].map((o) => (
                    <Pressable key={o.d} testID={`c-bday-alert-${o.d}`} onPress={() => setForm({ ...form, birthday_alert_days_before: o.d })} style={[styles.pill, form.birthday_alert_days_before === o.d && styles.pillActive]}>
                      <Text style={[styles.pillTxt, form.birthday_alert_days_before === o.d && styles.pillTxtActive]}>{o.label}</Text>
                    </Pressable>
                  ))}
                </View>
                <View style={styles.rowBetween}>
                  <Text style={styles.switchLbl}>Invia automaticamente messaggio</Text>
                  <Pressable testID="c-bday-auto" onPress={() => setForm({ ...form, birthday_auto_send: !form.birthday_auto_send })}>
                    <Ionicons name={form.birthday_auto_send ? "toggle" : "toggle-outline"} size={38} color={form.birthday_auto_send ? theme.color.success : theme.color.muted} />
                  </Pressable>
                </View>
                {form.birthday_auto_send && (
                  <Field label="Messaggio compleanno custom" testID="c-bday-msg" value={form.birthday_message} onChangeText={(t: string) => setForm({ ...form, birthday_message: t })} placeholder="Buon compleanno! Ti auguro..." multiline />
                )}
                {form.birthday_auto_send && (
                  <Field label="Link da allegare (opzionale)" testID="c-bday-link" value={form.birthday_message_link} onChangeText={(t: string) => setForm({ ...form, birthday_message_link: t })} placeholder="https://..." autoCapitalize="none" />
                )}
              </>
            )}
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
            <Row>
              <Field flex={3} label="Via" testID="c-street" value={form.address_street} onChangeText={(t: string) => setForm({ ...form, address_street: t })} placeholder="Via Verdi" />
              <Field flex={1} label="N. civico" testID="c-number" value={form.address_number} onChangeText={(t: string) => setForm({ ...form, address_number: t })} placeholder="15" />
            </Row>
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
              <Pressable testID="c-source-personal" onPress={() => setForm({ ...form, source: "personal", referral_type: "", referred_by_contact_id: "" })} style={[styles.pill, form.source === "personal" && styles.pillActive]}>
                <Text style={[styles.pillTxt, form.source === "personal" && styles.pillTxtActive]}>Conoscenza personale</Text>
              </Pressable>
              <Pressable testID="c-source-ref-direct" onPress={() => setForm({ ...form, source: "referral", referral_type: "direct", referred_by_contact_id: "" })} style={[styles.pill, form.source === "referral" && form.referral_type === "direct" && styles.pillActive]}>
                <Text style={[styles.pillTxt, form.source === "referral" && form.referral_type === "direct" && styles.pillTxtActive]}>Referenza diretta personale</Text>
              </Pressable>
              <Pressable testID="c-source-ref-contact" onPress={() => setForm({ ...form, source: "referral", referral_type: "from_contact" })} style={[styles.pill, form.source === "referral" && form.referral_type === "from_contact" && styles.pillActive]}>
                <Text style={[styles.pillTxt, form.source === "referral" && form.referral_type === "from_contact" && styles.pillTxtActive]}>Referenza da altro contatto</Text>
              </Pressable>
            </View>

            {form.source === "referral" && form.referral_type === "from_contact" && (
              <>
                <Text style={styles.lbl}>Chi lo ha segnalato</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {contacts.length === 0 ? (
                    <Text style={{ color: theme.color.muted, fontSize: 12, paddingVertical: 8 }}>Ancora nessun contatto in rubrica</Text>
                  ) : contacts.map((c) => (
                    <Pressable key={c.contact_id} onPress={() => setForm({ ...form, referred_by_contact_id: c.contact_id })} style={[styles.pill, form.referred_by_contact_id === c.contact_id && styles.pillActive]}>
                      <Text style={[styles.pillTxt, form.referred_by_contact_id === c.contact_id && styles.pillTxtActive]}>{c.first_name} {c.last_name}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </>
            )}

            {form.source === "referral" && (
              <>
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

          <Section title="Foto contatto">
            <View style={styles.photoRow}>
              <Pressable testID="photo-camera" onPress={() => pickPhoto(true)} style={styles.photoAddBtn}>
                <Ionicons name="camera" size={22} color={theme.color.brandPrimary} />
                <Text style={styles.photoAddTxt}>Foto camera</Text>
              </Pressable>
              <Pressable testID="photo-gallery" onPress={() => pickPhoto(false)} style={styles.photoAddBtn}>
                <Ionicons name="image" size={22} color={theme.color.brandPrimary} />
                <Text style={styles.photoAddTxt}>Da galleria</Text>
              </Pressable>
            </View>
            {form.photos.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginTop: 10 }}>
                {form.photos.map((p, i) => (
                  <Pressable key={i} onPress={() => removePhoto(i)}>
                    <View style={styles.photoThumb}>
                      <Image source={{ uri: p }} style={styles.photoThumbImg} />
                      <View style={styles.photoThumbRemove}><Ionicons name="close" size={14} color="#FFF" /></View>
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
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
            {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.saveBtnTxt}>{isEdit ? "Salva modifiche" : "Salva contatto"}</Text>}
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
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8 },
  switchLbl: { fontSize: 13, color: theme.color.onSurface, fontWeight: "600" },
  toggleMore: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 14, paddingVertical: 10 },
  toggleMoreTxt: { color: theme.color.brandPrimary, fontWeight: "700", fontSize: 13 },
  importBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#FFF", padding: 12, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.brandPrimary, borderStyle: "dashed" },
  importBtnTxt: { color: theme.color.brandPrimary, fontWeight: "700", fontSize: 14 },
  photoRow: { flexDirection: "row", gap: 10 },
  photoAddBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: theme.color.surface, padding: 12, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border },
  photoAddTxt: { color: theme.color.brandPrimary, fontWeight: "600", fontSize: 13 },
  photoThumb: { position: "relative", width: 80, height: 80 },
  photoThumbImg: { width: 80, height: 80, borderRadius: theme.radius.md },
  photoThumbRemove: { position: "absolute", top: -6, right: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: theme.color.error, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#FFF" },
  saveBtn: { backgroundColor: theme.color.brandPrimary, paddingVertical: 14, borderRadius: theme.radius.md, alignItems: "center", marginTop: 20 },
  saveBtnTxt: { color: "#FFF", fontWeight: "700", fontSize: 15 },
});

const webDateInputStyle: any = {
  width: "100%",
  backgroundColor: theme.color.surface,
  border: `1px solid ${theme.color.border}`,
  borderRadius: 12,
  padding: "10px 12px",
  fontSize: 15,
  color: theme.color.onSurface,
  fontFamily: "inherit",
  outline: "none",
};

// ContactPreviewForm.tsx — V50.z278 — Anagrafica ADATTIVA da biglietto da visita / dettatura.
// Mostra solo i campi effettivamente estratti (nome, cognome, ruolo, azienda, P.IVA, indirizzo…) più:
// • elenco recapiti telefonici (etichetta + numero, tipo cell/fisso/fax) con scelta del PRINCIPALE (★)
// • elenco email con scelta della principale
// • altri referenti citati sul biglietto (nome, ruolo, telefono)
// • preferenze di contatto (Telefono / WhatsApp / Email / SMS, orario migliore)
// • anteprima del biglietto ritagliato
// `ContactChannelsEditor` è riusabile anche nella scheda di modifica contatto.
import React from "react";
import { View, Text, StyleSheet, Pressable, TextInput, Image } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/src/theme";

export type PhoneEntry = { label: string; number: string; type: "mobile" | "landline" | "fax" | "other"; primary?: boolean };
export type EmailEntry = { label: string; address: string; primary?: boolean };
export type PersonEntry = { name: string; role?: string; phone?: string; email?: string };
export type ContactPrefs = { channels?: string[]; best_time?: string; note?: string };
export type ExtractedContact = Record<string, any> & { phones?: PhoneEntry[]; emails?: EmailEntry[]; people?: PersonEntry[]; contact_prefs?: ContactPrefs };

export const CHANNELS: { id: string; label: string; icon: any }[] = [
  { id: "call", label: "Telefonata", icon: "call" }, { id: "whatsapp", label: "WhatsApp", icon: "logo-whatsapp" }, { id: "email", label: "Email", icon: "mail" }, { id: "sms", label: "SMS", icon: "chatbubble" },
];
const PHONE_TYPE_LABEL: Record<string, string> = { mobile: "cell.", landline: "fisso", fax: "fax", other: "" };
const BASE_FIELDS: [string, string][] = [
  ["first_name", "Nome"], ["last_name", "Cognome"], ["role", "Ruolo"], ["company", "Azienda"], ["vat_number", "P. IVA"], ["fiscal_code", "Cod. Fiscale"],
  ["address_street", "Via"], ["address_number", "Civico"], ["address_zip", "CAP"], ["address_city", "Città"], ["address_province", "Prov."], ["website", "Sito web"], ["notes", "Note"],
];

/** Applica le scelte (principale) ai campi piatti usati dal resto dell'app. */
export function flattenChannels(c: ExtractedContact): ExtractedContact {
  const out: ExtractedContact = { ...c };
  const phones = (c.phones || []).filter((p) => p.number?.trim());
  const emails = (c.emails || []).filter((e) => e.address?.trim());
  const main = phones.find((p) => p.primary) || phones.find((p) => p.type === "mobile") || phones.find((p) => p.type !== "fax");
  if (main) out.phone = main.number.trim();
  const land = phones.find((p) => p !== main && p.type === "landline") || phones.find((p) => p !== main && p.type !== "fax");
  out.phone_alt = land ? land.number.trim() : out.phone_alt || "";
  const fax = phones.find((p) => p.type === "fax");
  out.fax = fax ? fax.number.trim() : out.fax || "";
  const mainE = emails.find((e) => e.primary) || emails[0];
  if (mainE) out.email = mainE.address.trim();
  const altE = emails.find((e) => e !== mainE);
  out.email_alt = altE ? altE.address.trim() : out.email_alt || "";
  if (main && (c.contact_prefs?.channels || []).includes("whatsapp") && !out.whatsapp) out.whatsapp = main.number.trim();
  out.phones = phones.map((p) => ({ ...p, primary: p === main }));
  out.emails = emails.map((e) => ({ ...e, primary: e === mainE }));
  return out;
}

type ChanProps = { value: ExtractedContact; onChange: (patch: Partial<ExtractedContact>) => void; dark?: boolean; testIdPrefix?: string };

export function ContactChannelsEditor({ value, onChange, dark, testIdPrefix = "cc" }: ChanProps) {
  const s = dark ? sd : sl;
  const phones: PhoneEntry[] = value.phones || [];
  const emails: EmailEntry[] = value.emails || [];
  const prefs: ContactPrefs = value.contact_prefs || {};
  const setPhones = (l: PhoneEntry[]) => onChange({ phones: l });
  const setEmails = (l: EmailEntry[]) => onChange({ emails: l });
  const toggleChannel = (id: string) => { const cur = prefs.channels || []; onChange({ contact_prefs: { ...prefs, channels: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] } }); };
  return (
    <View style={{ gap: 10 }}>
      <View style={s.block}>
        <View style={s.rowH}><Text style={s.h}>📞 Recapiti telefonici</Text><Text style={s.hint}>tocca ★ = principale</Text></View>
        {phones.length === 0 ? <Text style={s.hint}>Nessun numero rilevato.</Text> : null}
        {phones.map((p, i) => (
          <View key={i} style={[s.row, p.primary && s.rowOn]}>
            <Pressable onPress={() => setPhones(phones.map((x, k) => ({ ...x, primary: k === i })))} hitSlop={8} style={{ paddingTop: 4 }} testID={`${testIdPrefix}-phone-primary-${i}`}>
              <Ionicons name={p.primary ? "star" : "star-outline"} size={24} color={p.primary ? "#FBBF24" : (dark ? "#94A3B8" : theme.color.muted)} />
            </Pressable>
            <View style={{ flex: 1, gap: 6 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <TextInput value={p.label} onChangeText={(v) => setPhones(phones.map((x, k) => (k === i ? { ...x, label: v } : x)))} placeholder="Etichetta (es. Cell. Rudy)" placeholderTextColor="#94A3B8" style={[s.input, { flex: 1 }]} testID={`${testIdPrefix}-phone-label-${i}`} />
                <Pressable onPress={() => setPhones(phones.map((x, k) => (k === i ? { ...x, type: x.type === "mobile" ? "landline" : x.type === "landline" ? "fax" : "mobile" } : x)))} style={s.typeChip} testID={`${testIdPrefix}-phone-type-${i}`}><Text style={s.typeTxt}>{PHONE_TYPE_LABEL[p.type] || "altro"}</Text></Pressable>
                <Pressable onPress={() => setPhones(phones.filter((_, k) => k !== i))} hitSlop={8}><Ionicons name="close" size={18} color="#94A3B8" /></Pressable>
              </View>
              <TextInput value={p.number} onChangeText={(v) => setPhones(phones.map((x, k) => (k === i ? { ...x, number: v } : x)))} keyboardType="phone-pad" placeholder="Numero" placeholderTextColor="#94A3B8" style={s.input} testID={`${testIdPrefix}-phone-number-${i}`} />
            </View>
          </View>
        ))}
        <Pressable onPress={() => setPhones([...phones, { label: "Telefono", number: "", type: "mobile", primary: phones.length === 0 }])} style={s.addBtn} testID={`${testIdPrefix}-phone-add`}><Ionicons name="add" size={16} color="#38BDF8" /><Text style={s.addTxt}>Aggiungi numero</Text></Pressable>
      </View>
      <View style={s.block}>
        <View style={s.rowH}><Text style={s.h}>✉️ Email</Text><Text style={s.hint}>★ = principale</Text></View>
        {emails.map((e, i) => (
          <View key={i} style={[s.row, e.primary && s.rowOn]}>
            <Pressable onPress={() => setEmails(emails.map((x, k) => ({ ...x, primary: k === i })))} hitSlop={8} style={{ paddingTop: 4 }} testID={`${testIdPrefix}-email-primary-${i}`}>
              <Ionicons name={e.primary ? "star" : "star-outline"} size={24} color={e.primary ? "#FBBF24" : (dark ? "#94A3B8" : theme.color.muted)} />
            </Pressable>
            <View style={{ flex: 1, gap: 6 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <TextInput value={e.label} onChangeText={(v) => setEmails(emails.map((x, k) => (k === i ? { ...x, label: v } : x)))} placeholder="Etichetta (es. Email ufficio)" placeholderTextColor="#94A3B8" style={[s.input, { flex: 1 }]} />
                <Pressable onPress={() => setEmails(emails.filter((_, k) => k !== i))} hitSlop={8}><Ionicons name="close" size={18} color="#94A3B8" /></Pressable>
              </View>
              <TextInput value={e.address} onChangeText={(v) => setEmails(emails.map((x, k) => (k === i ? { ...x, address: v } : x)))} keyboardType="email-address" autoCapitalize="none" placeholder="email" placeholderTextColor="#94A3B8" style={s.input} testID={`${testIdPrefix}-email-address-${i}`} />
            </View>
          </View>
        ))}
        <Pressable onPress={() => setEmails([...emails, { label: "Email", address: "", primary: emails.length === 0 }])} style={s.addBtn} testID={`${testIdPrefix}-email-add`}><Ionicons name="add" size={16} color="#38BDF8" /><Text style={s.addTxt}>Aggiungi email</Text></Pressable>
      </View>
      <View style={s.block}>
        <Text style={s.h}>💬 Preferenze di contatto</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {CHANNELS.map((ch) => { const on = (prefs.channels || []).includes(ch.id); return (
            <Pressable key={ch.id} onPress={() => toggleChannel(ch.id)} style={[s.chip, on && s.chipOn]} testID={`${testIdPrefix}-pref-${ch.id}`}><Ionicons name={ch.icon} size={14} color={on ? "#0B1B33" : "#38BDF8"} /><Text style={[s.chipTxt, on && { color: "#0B1B33" }]}>{ch.label}</Text></Pressable>
          ); })}
        </View>
        <TextInput value={prefs.best_time || ""} onChangeText={(v) => onChange({ contact_prefs: { ...prefs, best_time: v } })} placeholder="Quando contattarlo (es. mattina 9-12, mai il sabato)" placeholderTextColor="#94A3B8" style={s.input} testID={`${testIdPrefix}-pref-time`} />
      </View>
    </View>
  );
}

type FormProps = { value: ExtractedContact; onChange: (patch: Partial<ExtractedContact>) => void; cardImage?: string | null; onRecrop?: () => void; dark?: boolean };

export function ContactPreviewForm({ value, onChange, cardImage, onRecrop, dark }: FormProps) {
  const s = dark ? sd : sl;
  const people: PersonEntry[] = value.people || [];
  return (
    <View style={{ gap: 10 }}>
      {cardImage ? (
        <View style={{ alignItems: "center", gap: 6 }}>
          <Image source={{ uri: cardImage.startsWith("data:") ? cardImage : `data:image/jpeg;base64,${cardImage}` }} style={s.cardImg} resizeMode="contain" testID="contact-card-thumb" />
          {onRecrop ? <Pressable onPress={onRecrop} hitSlop={6} testID="contact-card-recrop"><Text style={s.addTxt}>✂️ Ritaglia di nuovo</Text></Pressable> : null}
        </View>
      ) : null}
      {BASE_FIELDS.filter(([k]) => value[k] !== undefined && value[k] !== null && String(value[k]) !== "").map(([k, l]) => (
        <View key={k} style={s.fieldRow}><Text style={s.fieldLbl}>{l}</Text><TextInput value={String(value[k])} onChangeText={(v) => onChange({ [k]: v })} style={s.fieldVal} multiline={k === "notes"} testID={`tour-field-${k}`} /></View>
      ))}
      <ContactChannelsEditor value={value} onChange={onChange} dark={dark} testIdPrefix="tour" />
      {people.length ? (
        <View style={s.block}>
          <Text style={s.h}>👥 Altri referenti sul biglietto</Text>
          {people.map((p, i) => (
            <View key={i} style={s.row}>
              <TextInput value={p.name} onChangeText={(v) => onChange({ people: people.map((x, k) => (k === i ? { ...x, name: v } : x)) })} placeholder="Nome" placeholderTextColor="#94A3B8" style={[s.input, { flex: 1.2 }]} testID={`tour-person-name-${i}`} />
              <TextInput value={p.role || ""} onChangeText={(v) => onChange({ people: people.map((x, k) => (k === i ? { ...x, role: v } : x)) })} placeholder="Ruolo" placeholderTextColor="#94A3B8" style={[s.input, { flex: 0.8 }]} />
              <TextInput value={p.phone || ""} onChangeText={(v) => onChange({ people: people.map((x, k) => (k === i ? { ...x, phone: v } : x)) })} placeholder="Tel." placeholderTextColor="#94A3B8" keyboardType="phone-pad" style={[s.input, { flex: 1 }]} />
              <Pressable onPress={() => onChange({ people: people.filter((_, k) => k !== i) })} hitSlop={8}><Ionicons name="close" size={18} color="#94A3B8" /></Pressable>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const common = {
  rowH: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const },
  row: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: 8, padding: 6, borderRadius: 10, borderWidth: 1, borderColor: "transparent" },
  rowOn: { borderColor: "rgba(251,191,36,0.6)", backgroundColor: "rgba(251,191,36,0.08)" },
  addBtn: { flexDirection: "row" as const, alignItems: "center" as const, gap: 4, alignSelf: "flex-start" as const, minHeight: 36, paddingHorizontal: 6 },
  addTxt: { color: "#38BDF8", fontWeight: "800" as const, fontSize: 13 },
  chip: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, paddingHorizontal: 12, minHeight: 38, borderRadius: 19, borderWidth: 1, borderColor: "#38BDF8" },
  chipOn: { backgroundColor: "#38BDF8" },
  chipTxt: { color: "#38BDF8", fontWeight: "800" as const, fontSize: 12 },
  cardImg: { width: "100%" as const, height: 150, borderRadius: 12, backgroundColor: "#0B1B33" },
  fieldRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 10 },
  typeChip: { paddingHorizontal: 8, minHeight: 32, borderRadius: 8, alignItems: "center" as const, justifyContent: "center" as const, backgroundColor: "rgba(56,189,248,0.18)" },
  typeTxt: { color: "#38BDF8", fontSize: 11, fontWeight: "800" as const },
};
const sd = StyleSheet.create({
  ...common,
  block: { gap: 8, padding: 10, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)" },
  h: { color: "#FFFFFF", fontWeight: "900", fontSize: 13 }, hint: { color: "#94A3B8", fontSize: 11 },
  input: { color: "#FFFFFF", fontSize: 13, fontWeight: "700", backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 10, paddingHorizontal: 8, minHeight: 40 },
  fieldLbl: { width: 78, color: "#94A3B8", fontSize: 12, fontWeight: "700" },
  fieldVal: { flex: 1, color: "#FFFFFF", fontSize: 14, fontWeight: "700", backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 10, paddingHorizontal: 10, minHeight: 40 },
});
const sl = StyleSheet.create({
  ...common,
  block: { gap: 8, padding: 10, borderRadius: 12, backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: theme.color.border },
  h: { color: theme.color.onSurface, fontWeight: "900", fontSize: 13 }, hint: { color: theme.color.muted, fontSize: 11 },
  input: { color: theme.color.onSurface, fontSize: 13, fontWeight: "600", backgroundColor: "#FFF", borderWidth: 1, borderColor: theme.color.border, borderRadius: 10, paddingHorizontal: 8, minHeight: 40 },
  fieldLbl: { width: 78, color: theme.color.muted, fontSize: 12, fontWeight: "700" },
  fieldVal: { flex: 1, color: theme.color.onSurface, fontSize: 14, fontWeight: "600", backgroundColor: "#FFF", borderWidth: 1, borderColor: theme.color.border, borderRadius: 10, paddingHorizontal: 10, minHeight: 40 },
  cardImg: { ...common.cardImg, backgroundColor: "#F1F5F9" },
});

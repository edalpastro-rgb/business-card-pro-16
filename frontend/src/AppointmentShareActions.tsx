import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, Linking, Platform, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/src/theme";

/**
 * v2.14 — Shared "Invia dettagli" panel for appointments.
 * v2.16 — Now supports fallback phone/email from the appointment itself
 *         (used when there's no linked contact), and structured address fields.
 * Renders Email + WhatsApp + SMS buttons with a pre-composed message.
 */
export type ApptContactLite = {
  first_name?: string;
  last_name?: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
};

export type ApptDetails = {
  title: string;
  start_at: Date | string;
  is_phone?: boolean;
  /** Legacy free-form location string (kept for backward compat) */
  location?: string;
  /** v2.16 — Structured address parts. If any is set, the full address is
   *  rebuilt as "street number, zip city (province)". */
  address_street?: string;
  address_number?: string;
  address_city?: string;
  address_zip?: string;
  address_province?: string;
  notes?: string;
  /** v2.16 — Optional phone/email inserted directly on the appointment
   *  (used as fallbacks when the appointment has no linked contact). */
  phone_mobile?: string;
  phone_work?: string;
  email?: string;
};

export function composeAppointmentAddress(appt: ApptDetails): string {
  const street = (appt.address_street || "").trim();
  const number = (appt.address_number || "").trim();
  const city = (appt.address_city || "").trim();
  const zip = (appt.address_zip || "").trim();
  const prov = (appt.address_province || "").trim();
  const hasStructured = street || number || city || zip || prov;
  if (hasStructured) {
    const line1 = [street, number].filter(Boolean).join(" ");
    const line2 = [zip, city].filter(Boolean).join(" ");
    const withProv = prov ? `${line2}${line2 ? " " : ""}(${prov})` : line2;
    return [line1, withProv].filter(Boolean).join(", ").trim();
  }
  return (appt.location || "").trim();
}

export function buildAppointmentMessage(appt: ApptDetails, contact?: ApptContactLite | null): string {
  const dt = typeof appt.start_at === "string" ? new Date(appt.start_at) : appt.start_at;
  const dateStr = dt.toLocaleString("it-IT", { dateStyle: "full", timeStyle: "short" });
  const greet = contact?.first_name ? `Ciao ${contact.first_name}` : "Ciao";
  const addr = composeAppointmentAddress(appt);
  const loc = addr ? `\n📍 ${addr}` : "";
  const phone = appt.is_phone ? "\n📞 Appuntamento telefonico" : "";
  const notes = appt.notes && appt.notes.trim() ? `\n\nNote: ${appt.notes.trim()}` : "";
  return `${greet},\n\nti confermo il nostro appuntamento:\n\n📅 ${appt.title}\n🗓 ${dateStr}${loc}${phone}${notes}\n\nA presto!`;
}

type Props = {
  appt: ApptDetails;
  contact?: ApptContactLite | null;
  /** Optional tighter styling for embedding in scroll views. Default: card style */
  compact?: boolean;
};

export function AppointmentShareActions({ appt, contact, compact = false }: Props) {
  const defaultText = useMemo(() => buildAppointmentMessage(appt, contact), [appt, contact]);
  // V50.z135 — Testo personalizzabile prima dell'invio (WhatsApp/SMS/Email).
  const [bodyText, setBodyText] = useState(defaultText);
  const [editing, setEditing] = useState(false);
  useEffect(() => { setBodyText(defaultText); }, [defaultText]);
  const isCustom = bodyText !== defaultText;

  // v2.16 — Effective channels: prefer contact fields when present, else
  // fall back to the appointment's own phone/email fields.
  const effectivePhone = (contact?.phone || appt.phone_mobile || appt.phone_work || "").trim();
  const effectiveWhatsapp = (contact?.whatsapp || contact?.phone || appt.phone_mobile || appt.phone_work || "").trim();
  const effectiveEmail = (contact?.email || appt.email || "").trim();

  const hasEmail = !!effectiveEmail;
  const hasWa = !!effectiveWhatsapp;
  const hasSms = !!effectivePhone;

  const openEmail = () => {
    if (!hasEmail) return;
    const subject = encodeURIComponent(`Appuntamento: ${appt.title}`);
    Linking.openURL(`mailto:${effectiveEmail}?subject=${subject}&body=${encodeURIComponent(bodyText)}`);
  };
  const openWhatsapp = () => {
    if (!hasWa) return;
    const num = effectiveWhatsapp.replace(/[^\d+]/g, "");
    Linking.openURL(`https://wa.me/${num}?text=${encodeURIComponent(bodyText)}`);
  };
  const openSms = () => {
    if (!hasSms) return;
    const num = effectivePhone.replace(/\s/g, "");
    const sep = Platform.OS === "ios" ? "&" : "?";
    Linking.openURL(`sms:${num}${sep}body=${encodeURIComponent(bodyText)}`);
  };

  const anyChannel = hasEmail || hasWa || hasSms;

  return (
    <View style={[styles.card, compact && styles.cardCompact]}>
      <View style={styles.hdr}>
        <Ionicons name="paper-plane" size={18} color={theme.color.brandPrimary} />
        <Text style={styles.title}>Invia dettagli al cliente</Text>
      </View>
      <Text style={styles.hint}>Condividi data, ora e luogo dell&apos;appuntamento via Email, WhatsApp o SMS.</Text>
      <View style={styles.editRow}>
        <Pressable testID="appt-share-edit-toggle" onPress={() => setEditing((v) => !v)} style={styles.editBtn} hitSlop={6}>
          <Ionicons name={editing ? "chevron-up" : "create-outline"} size={14} color={theme.color.brandPrimary} />
          <Text style={styles.editBtnTxt}>{editing ? "Nascondi testo" : (isCustom ? "Testo personalizzato · modifica" : "Personalizza messaggio")}</Text>
        </Pressable>
        {isCustom && (
          <Pressable testID="appt-share-reset" onPress={() => setBodyText(defaultText)} hitSlop={6}>
            <Text style={styles.resetTxt}>Ripristina</Text>
          </Pressable>
        )}
      </View>
      {editing && (
        <TextInput
          testID="appt-share-message"
          value={bodyText}
          onChangeText={setBodyText}
          multiline
          textAlignVertical="top"
          style={styles.msgInput}
          placeholder="Testo del messaggio…"
          placeholderTextColor={theme.color.muted}
        />
      )}
      <View style={styles.btnRow}>
        <Pressable
          testID="appt-share-email"
          onPress={openEmail}
          disabled={!hasEmail}
          style={[styles.btn, { backgroundColor: theme.color.brandPrimary }, !hasEmail && { opacity: 0.4 }]}
        >
          <Ionicons name="mail" size={16} color="#FFF" />
          <Text style={styles.btnTxt}>Email</Text>
        </Pressable>
        <Pressable
          testID="appt-share-whatsapp"
          onPress={openWhatsapp}
          disabled={!hasWa}
          style={[styles.btn, { backgroundColor: "#25D366" }, !hasWa && { opacity: 0.4 }]}
        >
          <Ionicons name="logo-whatsapp" size={16} color="#FFF" />
          <Text style={styles.btnTxt}>WhatsApp</Text>
        </Pressable>
        <Pressable
          testID="appt-share-sms"
          onPress={openSms}
          disabled={!hasSms}
          style={[styles.btn, { backgroundColor: theme.color.brandSecondary }, !hasSms && { opacity: 0.4 }]}
        >
          <Ionicons name="chatbubble" size={16} color="#FFF" />
          <Text style={styles.btnTxt}>SMS</Text>
        </Pressable>
      </View>
      {!anyChannel && (
        <Text style={styles.warn}>
          Inserisci un telefono o email nell&apos;appuntamento (o associa un contatto) per abilitare l&apos;invio dei dettagli.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: theme.color.surface, borderRadius: 12, padding: 14, marginTop: 12, borderWidth: 1, borderColor: theme.color.border },
  cardCompact: { padding: 10, marginTop: 8 },
  hdr: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  title: { fontSize: 14, fontWeight: "800", color: theme.color.onSurface },
  hint: { fontSize: 11, color: theme.color.muted, marginBottom: 10, lineHeight: 15 },
  btnRow: { flexDirection: "row", gap: 6 },
  btn: { flex: 1, paddingVertical: 10, borderRadius: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  btnTxt: { color: "#FFF", fontWeight: "800", fontSize: 12 },
  warn: { marginTop: 8, fontSize: 11, color: "#B45309", fontStyle: "italic" },
  editRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  editBtn: { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 28 },
  editBtnTxt: { fontSize: 12, fontWeight: "700", color: theme.color.brandPrimary },
  resetTxt: { fontSize: 12, fontWeight: "700", color: theme.color.muted, textDecorationLine: "underline" },
  msgInput: { minHeight: 120, maxHeight: 220, backgroundColor: "#FFF", borderWidth: 1, borderColor: theme.color.border, borderRadius: 10, padding: 10, fontSize: 13, lineHeight: 18, color: theme.color.onSurface, marginBottom: 10 },
});

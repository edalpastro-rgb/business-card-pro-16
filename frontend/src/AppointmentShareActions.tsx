import React, { useMemo } from "react";
import { View, Text, StyleSheet, Pressable, Linking, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/src/theme";

/**
 * v2.14 — Shared "Invia dettagli" panel for appointments.
 * Renders Email + WhatsApp + SMS buttons with a pre-composed message.
 * Buttons are disabled if the corresponding channel is not available.
 *
 * Kept dumb / stateless: the caller provides the appointment fields and the
 * (optional) contact so the same component works both in the create-flow
 * ("appuntamento appena creato") and the view-flow ("appointment/[id]").
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
  location?: string;
  notes?: string;
};

export function buildAppointmentMessage(appt: ApptDetails, contact?: ApptContactLite | null): string {
  const dt = typeof appt.start_at === "string" ? new Date(appt.start_at) : appt.start_at;
  const dateStr = dt.toLocaleString("it-IT", { dateStyle: "full", timeStyle: "short" });
  const greet = contact?.first_name ? `Ciao ${contact.first_name}` : "Ciao";
  const loc = appt.location ? `\n📍 ${appt.location}` : "";
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
  const bodyText = useMemo(() => buildAppointmentMessage(appt, contact), [appt, contact]);
  const hasEmail = !!contact?.email;
  const hasWa = !!(contact?.whatsapp || contact?.phone);
  const hasSms = !!contact?.phone;

  const openEmail = () => {
    if (!hasEmail) return;
    const subject = encodeURIComponent(`Appuntamento: ${appt.title}`);
    Linking.openURL(`mailto:${contact!.email}?subject=${subject}&body=${encodeURIComponent(bodyText)}`);
  };
  const openWhatsapp = () => {
    if (!hasWa) return;
    const num = (contact?.whatsapp || contact?.phone || "").replace(/[^\d+]/g, "");
    Linking.openURL(`https://wa.me/${num}?text=${encodeURIComponent(bodyText)}`);
  };
  const openSms = () => {
    if (!hasSms) return;
    const num = (contact?.phone || "").replace(/\s/g, "");
    const sep = Platform.OS === "ios" ? "&" : "?";
    Linking.openURL(`sms:${num}${sep}body=${encodeURIComponent(bodyText)}`);
  };

  return (
    <View style={[styles.card, compact && styles.cardCompact]}>
      <View style={styles.hdr}>
        <Ionicons name="paper-plane" size={18} color={theme.color.brandPrimary} />
        <Text style={styles.title}>Invia dettagli al cliente</Text>
      </View>
      <Text style={styles.hint}>Condividi data, ora e luogo dell&apos;appuntamento via Email, WhatsApp o SMS.</Text>
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
      {!hasEmail && !hasWa && !hasSms && (
        <Text style={styles.warn}>
          Aggiungi telefono o email al contatto per abilitare l&apos;invio dei dettagli.
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
});

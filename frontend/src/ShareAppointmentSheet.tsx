import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, Modal, Platform, Linking, ActivityIndicator, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import * as DocumentPicker from "expo-document-picker";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

/**
 * V50.z80 — Sheet condivisione appuntamento con cliente.
 * Canali: WhatsApp (wa.me con testo precompilato) + Email (mailto o SMTP).
 * Allegati: file/foto/audio via document picker (l'utente li allega manualmente in WA/mail
 * dopo aver aperto il messaggio pre-compilato — limitazione dei link wa.me/mailto).
 * Reminder automatici: consenti di programmare un promemoria X ore prima al cliente.
 */

type Preview = {
  message: string;
  wa_url: string | null;
  mailto: string | null;
  channels_available: { whatsapp: boolean; email: boolean };
  current_settings: { hours: number | null; channels: string[]; sent_at: string | null };
};

const REMINDER_PRESETS = [1, 3, 6, 12, 24, 48] as const;

export function ShareAppointmentSheet({
  appointmentId,
  visible,
  onClose,
}: {
  appointmentId: string;
  visible: boolean;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState("");
  const [attachments, setAttachments] = useState<{ name: string; uri: string }[]>([]);
  const [reminderHours, setReminderHours] = useState<number | null>(null);
  const [reminderChannels, setReminderChannels] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!visible) return;
    setLoading(true);
    try {
      const p = await api<Preview>(`/appointments/${appointmentId}/share-preview`);
      setPreview(p);
      setMessage(p.message);
      setReminderHours(p.current_settings.hours);
      setReminderChannels(new Set(p.current_settings.channels || []));
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile caricare l'anteprima");
    } finally {
      setLoading(false);
    }
  }, [appointmentId, visible]);

  useEffect(() => { load(); }, [load]);

  const pickAttachment = async () => {
    try {
      const r = await DocumentPicker.getDocumentAsync({ multiple: true, type: "*/*", copyToCacheDirectory: true });
      if (!r.canceled && r.assets) {
        setAttachments((prev) => [...prev, ...r.assets.map((a) => ({ name: a.name, uri: a.uri }))]);
      }
    } catch { /* ignore */ }
  };

  const openWhatsApp = () => {
    const url = preview?.wa_url;
    if (!url) { notify("Attenzione", "Il contatto non ha un numero di telefono"); return; }
    // Ricostruisco l'URL usando il messaggio corrente (potrebbe essere stato editato)
    const base = url.split("?text=")[0];
    const finalUrl = `${base}?text=${encodeURIComponent(message)}`;
    if (attachments.length > 0) {
      Alert.alert("Allegati", `Dopo aver aperto WhatsApp, allega manualmente i ${attachments.length} file selezionati (WhatsApp non supporta allegati via link).`);
    }
    if (Platform.OS === "web") { try { window.open(finalUrl, "_blank"); } catch { /* ignore */ } }
    else Linking.openURL(finalUrl).catch(() => {});
  };

  const openEmail = () => {
    const mailto = preview?.mailto;
    if (!mailto) { notify("Attenzione", "Il contatto non ha un'email"); return; }
    const base = mailto.split("&body=")[0];
    const finalUrl = `${base}&body=${encodeURIComponent(message)}`;
    if (Platform.OS === "web") { try { window.open(finalUrl, "_blank"); } catch { /* ignore */ } }
    else Linking.openURL(finalUrl).catch(() => {});
  };

  const saveReminder = async () => {
    setSaving(true);
    try {
      await api(`/appointments/${appointmentId}`, {
        method: "PUT",
        body: {
          client_reminder_hours: reminderHours,
          client_reminder_channels: Array.from(reminderChannels),
          client_reminder_message: message,
        },
      });
      notify("Salvato", reminderHours ? `Promemoria automatico impostato: ${reminderHours}h prima` : "Promemoria disattivato");
      onClose();
    } catch (e: any) {
      notify("Errore", e?.message || "");
    } finally {
      setSaving(false);
    }
  };

  const toggleChannel = (ch: string) => {
    setReminderChannels((prev) => {
      const n = new Set(prev);
      if (n.has(ch)) n.delete(ch); else n.add(ch);
      return n;
    });
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop} pointerEvents="box-none">
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Condividi con il cliente</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={22} color={HT.muted} />
            </Pressable>
          </View>
          {loading ? (
            <ActivityIndicator style={{ marginVertical: 40 }} color={HT.brand} />
          ) : (
            <KeyboardAwareScrollView bottomOffset={20} contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
              <Text style={styles.label}>Messaggio</Text>
              <TextInput
                value={message}
                onChangeText={setMessage}
                multiline
                style={styles.textarea}
                placeholder="Testo del messaggio"
                testID="share-appt-message"
              />

              <Text style={styles.label}>Allegati (opzionali)</Text>
              <Pressable onPress={pickAttachment} style={styles.attachBtn} testID="share-appt-attach">
                <Ionicons name="attach" size={16} color={HT.brand} />
                <Text style={styles.attachBtnTxt}>Aggiungi file / foto / audio</Text>
              </Pressable>
              {attachments.map((a, i) => (
                <View key={i} style={styles.attachRow}>
                  <Ionicons name="document-outline" size={14} color={HT.muted} />
                  <Text style={styles.attachTxt} numberOfLines={1}>{a.name}</Text>
                  <Pressable onPress={() => setAttachments((prev) => prev.filter((_, j) => j !== i))} hitSlop={6}>
                    <Ionicons name="close-circle" size={16} color="#DC2626" />
                  </Pressable>
                </View>
              ))}
              {attachments.length > 0 ? (
                <Text style={styles.hint}>ℹ️ Dopo aver aperto WhatsApp/Email, allega manualmente i file (limitazione dei link diretti).</Text>
              ) : null}

              <View style={styles.actionsRow}>
                <Pressable
                  onPress={openWhatsApp}
                  disabled={!preview?.channels_available.whatsapp}
                  style={[styles.actionBtn, { backgroundColor: '#16A34A' }, !preview?.channels_available.whatsapp && { opacity: 0.4 }]}
                  testID="share-wa-btn"
                >
                  <Ionicons name="logo-whatsapp" size={18} color="#FFF" />
                  <Text style={styles.actionTxt}>WhatsApp</Text>
                </Pressable>
                <Pressable
                  onPress={openEmail}
                  disabled={!preview?.channels_available.email}
                  style={[styles.actionBtn, { backgroundColor: '#4285F4' }, !preview?.channels_available.email && { opacity: 0.4 }]}
                  testID="share-email-btn"
                >
                  <Ionicons name="mail" size={18} color="#FFF" />
                  <Text style={styles.actionTxt}>Email</Text>
                </Pressable>
              </View>

              {/* Reminder automatici */}
              <View style={styles.reminderBox}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Ionicons name="alarm" size={16} color={HT.brand} />
                  <Text style={styles.reminderTitle}>Promemoria automatico</Text>
                </View>
                <Text style={styles.reminderSub}>Invia in automatico il messaggio X ore prima dell&apos;appuntamento.</Text>

                <View style={styles.chipRow}>
                  <Pressable
                    onPress={() => setReminderHours(null)}
                    style={[styles.chip, reminderHours === null && styles.chipActive]}
                  >
                    <Text style={[styles.chipTxt, reminderHours === null && { color: "#FFF" }]}>Off</Text>
                  </Pressable>
                  {REMINDER_PRESETS.map((h) => (
                    <Pressable
                      key={h}
                      onPress={() => setReminderHours(h)}
                      style={[styles.chip, reminderHours === h && styles.chipActive]}
                      testID={`reminder-${h}h`}
                    >
                      <Text style={[styles.chipTxt, reminderHours === h && { color: "#FFF" }]}>{h}h</Text>
                    </Pressable>
                  ))}
                </View>

                {reminderHours ? (
                  <>
                    <Text style={[styles.label, { marginTop: 8 }]}>Canali</Text>
                    <View style={styles.chipRow}>
                      <Pressable onPress={() => toggleChannel("whatsapp")} style={[styles.chipCh, reminderChannels.has("whatsapp") && styles.chipChOn]}>
                        <Ionicons name="logo-whatsapp" size={13} color={reminderChannels.has("whatsapp") ? "#FFF" : "#16A34A"} />
                        <Text style={[styles.chipChTxt, reminderChannels.has("whatsapp") && { color: "#FFF" }]}>WhatsApp</Text>
                      </Pressable>
                      <Pressable onPress={() => toggleChannel("email")} style={[styles.chipCh, reminderChannels.has("email") && styles.chipChOn]}>
                        <Ionicons name="mail" size={13} color={reminderChannels.has("email") ? "#FFF" : "#4285F4"} />
                        <Text style={[styles.chipChTxt, reminderChannels.has("email") && { color: "#FFF" }]}>Email</Text>
                      </Pressable>
                    </View>
                  </>
                ) : null}

                <Pressable
                  onPress={saveReminder}
                  disabled={saving}
                  style={[styles.saveBtn, saving && { opacity: 0.6 }]}
                  testID="save-reminder-btn"
                >
                  {saving ? <ActivityIndicator color="#FFF" /> : (
                    <>
                      <Ionicons name="save" size={14} color="#FFF" />
                      <Text style={styles.saveBtnTxt}>Salva promemoria</Text>
                    </>
                  )}
                </Pressable>
              </View>
            </KeyboardAwareScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: HT.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "90%" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 1, borderBottomColor: HT.border },
  title: { fontSize: 16, fontWeight: "800", color: HT.text },
  label: { fontSize: 11, fontWeight: "700", color: HT.muted, textTransform: "uppercase" },
  textarea: { borderWidth: 1, borderColor: HT.border, borderRadius: 10, padding: 12, fontSize: 14, minHeight: 100, textAlignVertical: "top", color: HT.text, backgroundColor: HT.card2 },
  attachBtn: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderStyle: "dashed", borderColor: HT.brand },
  attachBtnTxt: { color: HT.brand, fontWeight: "700", fontSize: 12 },
  attachRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: HT.card2 },
  attachTxt: { flex: 1, fontSize: 12, color: HT.text },
  hint: { fontSize: 11, color: HT.muted, fontStyle: "italic" },
  actionsRow: { flexDirection: "row", gap: 10, marginTop: 4 },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: 10 },
  actionTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
  reminderBox: { padding: 12, borderRadius: 12, backgroundColor: HT.card2, borderWidth: 1, borderColor: HT.border, gap: 8, marginTop: 6 },
  reminderTitle: { fontSize: 13, fontWeight: "800", color: HT.text },
  reminderSub: { fontSize: 11, color: HT.muted },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: HT.border, backgroundColor: HT.card },
  chipActive: { backgroundColor: HT.brand, borderColor: HT.brand },
  chipTxt: { fontSize: 12, fontWeight: "700", color: HT.text },
  chipCh: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: HT.border, backgroundColor: HT.card },
  chipChOn: { backgroundColor: HT.brand, borderColor: HT.brand },
  chipChTxt: { fontSize: 11, fontWeight: "700", color: HT.text },
  saveBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 10, backgroundColor: HT.brand, marginTop: 6 },
  saveBtnTxt: { color: "#FFF", fontWeight: "800", fontSize: 13 },
});

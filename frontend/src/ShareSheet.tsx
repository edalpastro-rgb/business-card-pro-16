import React, { useEffect, useState } from "react";
import { View, Text, Modal, Pressable, StyleSheet, ActivityIndicator, Platform, Linking, TextInput } from "react-native";
import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/src/theme";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { shareDataUri } from "@/src/share";

import { useBottomSheetPadding } from "@/src/utils/bottomSheetInsets";
export type ShareTarget = {
  // The file to share
  id: string;
  name: string;
  mime: string;
  data_base64?: string;
  // For contact-file share links (backend endpoint that mints the link)
  contactId?: string;
  // For master-file share links (later — reserved)
  masterFileId?: string;
};

type Props = {
  visible: boolean;
  target: ShareTarget | null;
  onClose: () => void;
  // Optional prefix message for WhatsApp / email
  suggestedMessage?: string;
};

/** Universal share sheet with 4 channels: System, WhatsApp, Email, Copy link. */
export function ShareSheet({ visible, target, onClose, suggestedMessage }: Props) {
  const [busyChannel, setBusyChannel] = useState<null | string>(null);
  const bottomPad = useBottomSheetPadding();
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [loadingLink, setLoadingLink] = useState(false);
  // V38I — inline email composer
  const [emailMode, setEmailMode] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailMessage, setEmailMessage] = useState("");

  useEffect(() => {
    setShareUrl(null);
    setEmailMode(false);
    if (!visible || !target) return;
    // Pre-fill email composer
    setEmailSubject(`File condiviso: ${target.name}`);
    setEmailMessage(suggestedMessage || `Ti condivido in allegato il file: ${target.name}.`);
    setEmailTo("");
    // V38R — Pre-fetch share URL for CONTACT files (via /contacts/.../share-link)
    // OR for MASTER files (via /master-files/{id}/share-link).
    if (target.contactId) {
      setLoadingLink(true);
      api<{ url: string; expires_at: string }>(
        `/contacts/${target.contactId}/files/${target.id}/share-link`,
        { method: "POST" }
      )
        .then((r) => setShareUrl(r.url))
        .catch((e: any) => { console.warn("share link err", e); })
        .finally(() => setLoadingLink(false));
    } else if (target.masterFileId) {
      setLoadingLink(true);
      api<{ url: string; expires_at: string }>(
        `/master-files/${target.masterFileId}/share-link`,
        { method: "POST" }
      )
        .then((r) => setShareUrl(r.url))
        .catch((e: any) => { console.warn("master share link err", e); })
        .finally(() => setLoadingLink(false));
    }
  }, [visible, target, suggestedMessage]);

  if (!target) return null;

  const defaultMsg = suggestedMessage || `Ti condivido il file: ${target.name}`;
  const withUrl = (msg: string) => (shareUrl ? `${msg}\n\n${shareUrl}` : msg);

  const shareSystem = async () => {
    setBusyChannel("system");
    try {
      if (!target.data_base64) {
        notify("File non disponibile", "Impossibile aprire il file da condividere.");
        return;
      }
      await shareDataUri(`data:${target.mime};base64,${target.data_base64}`, target.name, target.mime);
      onClose();
    } finally {
      setBusyChannel(null);
    }
  };

  const shareWhatsApp = async () => {
    setBusyChannel("whatsapp");
    try {
      // V38I — Prefer native share sheet (which lists WhatsApp as a target and
      // attaches the actual file). Fall back to WhatsApp deep link only on web.
      if (Platform.OS !== "web" && target.data_base64) {
        await shareDataUri(`data:${target.mime};base64,${target.data_base64}`, target.name, target.mime);
        onClose();
        return;
      }
      // Web fallback: Web Share API (level 2 supports files) if available, else wa.me text-only
      const nav: any = (globalThis as any).navigator;
      if (nav?.canShare && nav?.share && target.data_base64) {
        try {
          const bin = atob(target.data_base64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const file = new File([bytes], target.name, { type: target.mime });
          if (nav.canShare({ files: [file] })) {
            await nav.share({ files: [file], title: target.name, text: defaultMsg });
            onClose();
            return;
          }
        } catch {}
      }
      const text = encodeURIComponent(withUrl(defaultMsg));
      window.open(`https://wa.me/?text=${text}`, "_blank");
    } catch (e: any) {
      notify("WhatsApp non disponibile", e?.message || "");
    } finally {
      setBusyChannel(null);
    }
  };

  const shareEmail = () => {
    // V38I — open the inline email composer that sends the actual attachment via SMTP
    setEmailMode(true);
  };

  const submitEmailWithAttachment = async () => {
    if (!target?.contactId) {
      notify("Non disponibile", "Invio email con allegato disponibile solo per file cliente.");
      return;
    }
    if (!emailTo.trim() || !emailTo.includes("@")) {
      notify("Destinatario non valido", "Inserisci un indirizzo email valido.");
      return;
    }
    setBusyChannel("email");
    try {
      await api(`/contacts/${target.contactId}/files/${target.id}/email-attachment`, {
        method: "POST",
        body: { to_email: emailTo.trim(), subject: emailSubject, message: emailMessage },
      });
      notify("Email inviata", `Il file "${target.name}" è stato inviato a ${emailTo.trim()} come allegato.`);
      setEmailMode(false);
      onClose();
    } catch (e: any) {
      // If SMTP not configured, fallback to mailto: text link
      const msg = e?.message || "";
      if (msg.toLowerCase().includes("smtp non configurato")) {
        notify("SMTP mancante", "Configura SMTP in Impostazioni per inviare email con allegato. In alternativa, condividi via link.");
      } else {
        notify("Errore invio email", msg);
      }
    } finally {
      setBusyChannel(null);
    }
  };

  const copyLink = async () => {
    setBusyChannel("copy");
    try {
      if (!shareUrl) {
        notify("Link non disponibile", "Impossibile generare il link diretto.");
        return;
      }
      await Clipboard.setStringAsync(shareUrl);
      notify("Link copiato", "Il link diretto è nella clipboard (validità 24h).");
      onClose();
    } catch (e: any) {
      notify("Errore", e?.message || "");
    } finally {
      setBusyChannel(null);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { paddingBottom: bottomPad }]} onPress={(e) => e.stopPropagation()}>
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Condividi file</Text>
              <Text style={styles.subtitle} numberOfLines={1}>{target.name}</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8} testID="share-sheet-close">
              <Ionicons name="close" size={22} color={theme.color.onSurface} />
            </Pressable>
          </View>

          <View style={styles.row}>
            <ChannelBtn
              testID="share-ch-system"
              icon="share-social"
              color="#4F46E5"
              label="Sistema"
              busy={busyChannel === "system"}
              onPress={shareSystem}
              disabled={!target.data_base64}
            />
            <ChannelBtn
              testID="share-ch-whatsapp"
              icon="logo-whatsapp"
              color="#25D366"
              label="WhatsApp"
              busy={busyChannel === "whatsapp"}
              onPress={shareWhatsApp}
              disabled={false}
            />
            <ChannelBtn
              testID="share-ch-email"
              icon="mail"
              color="#DC2626"
              label="Email"
              busy={busyChannel === "email"}
              onPress={shareEmail}
              disabled={false}
            />
            <ChannelBtn
              testID="share-ch-copy"
              icon="link"
              color="#0891B2"
              label="Copia link"
              busy={busyChannel === "copy" || loadingLink}
              onPress={copyLink}
              disabled={!shareUrl}
            />
          </View>

          {emailMode && (
            <View style={styles.emailBox}>
              <View style={styles.emailHeader}>
                <Ionicons name="mail" size={18} color="#DC2626" />
                <Text style={styles.emailTitle}>Invia via email (con allegato)</Text>
                <Pressable onPress={() => setEmailMode(false)} hitSlop={6}>
                  <Ionicons name="close" size={18} color={theme.color.muted} />
                </Pressable>
              </View>
              <TextInput
                testID="share-email-to"
                value={emailTo}
                onChangeText={setEmailTo}
                placeholder="Destinatario (email)"
                placeholderTextColor={theme.color.muted}
                keyboardType="email-address"
                autoCapitalize="none"
                style={styles.emailInput}
              />
              <TextInput
                testID="share-email-subject"
                value={emailSubject}
                onChangeText={setEmailSubject}
                placeholder="Oggetto"
                placeholderTextColor={theme.color.muted}
                style={styles.emailInput}
              />
              <TextInput
                testID="share-email-message"
                value={emailMessage}
                onChangeText={setEmailMessage}
                placeholder="Messaggio (opzionale)"
                placeholderTextColor={theme.color.muted}
                multiline
                numberOfLines={3}
                style={[styles.emailInput, { minHeight: 60, textAlignVertical: "top" }]}
              />
              <Pressable
                testID="share-email-submit"
                onPress={submitEmailWithAttachment}
                disabled={busyChannel === "email" || !emailTo.includes("@")}
                style={[styles.emailBtn, (!emailTo.includes("@") || busyChannel === "email") && { opacity: 0.5 }]}
              >
                {busyChannel === "email" ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <>
                    <Ionicons name="send" size={14} color="#FFF" />
                    <Text style={styles.emailBtnTxt}>Invia allegato</Text>
                  </>
                )}
              </Pressable>
            </View>
          )}

          {loadingLink && (
            <View style={styles.linkStatus}>
              <ActivityIndicator size="small" color={theme.color.muted} />
              <Text style={styles.linkStatusTxt}>Genero link condivisibile…</Text>
            </View>
          )}
          {shareUrl && !loadingLink && (
            <View style={styles.linkBox}>
              <Ionicons name="link" size={14} color={theme.color.muted} />
              <Text style={styles.linkTxt} numberOfLines={1}>{shareUrl}</Text>
              <Text style={styles.linkExp}>24h</Text>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ChannelBtn({ testID, icon, color, label, busy, onPress, disabled }: {
  testID?: string; icon: any; color: string; label: string; busy?: boolean; onPress: () => void; disabled?: boolean;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={busy || disabled}
      style={[styles.chBtn, (busy || disabled) && { opacity: 0.5 }]}
    >
      <View style={[styles.chIcon, { backgroundColor: color + "18" }]}>
        {busy ? <ActivityIndicator size="small" color={color} /> : <Ionicons name={icon} size={22} color={color} />}
      </View>
      <Text style={styles.chLbl} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#FFF", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, paddingBottom: 24, gap: 14 },
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  title: { fontSize: 16, fontWeight: "800", color: theme.color.onSurface },
  subtitle: { fontSize: 12, color: theme.color.muted, marginTop: 2 },
  row: { flexDirection: "row", justifyContent: "space-around", paddingVertical: 8 },
  chBtn: { alignItems: "center", gap: 8, minWidth: 68 },
  chIcon: { width: 52, height: 52, borderRadius: 26, justifyContent: "center", alignItems: "center" },
  chLbl: { fontSize: 12, color: theme.color.onSurface, fontWeight: "600" },
  linkStatus: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, justifyContent: "center" },
  linkStatusTxt: { fontSize: 12, color: theme.color.muted },
  linkBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#F1F5F9", padding: 10, borderRadius: 10 },
  linkTxt: { flex: 1, fontSize: 11, color: theme.color.onSurface, fontFamily: Platform.select({ ios: "Courier", android: "monospace" }) },
  linkExp: { fontSize: 10, color: theme.color.muted, fontWeight: "700" },
  // V38I — email composer
  emailBox: { backgroundColor: "#FFF7F5", padding: 12, borderRadius: 12, borderWidth: 1, borderColor: "#FECACA", gap: 8 },
  emailHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  emailTitle: { flex: 1, fontSize: 13, fontWeight: "700", color: theme.color.onSurface },
  emailInput: { backgroundColor: "#FFF", borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, color: theme.color.onSurface },
  emailBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: "#DC2626", paddingVertical: 10, borderRadius: 8 },
  emailBtnTxt: { color: "#FFF", fontSize: 13, fontWeight: "700" },
});

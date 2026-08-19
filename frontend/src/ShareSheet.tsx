import React, { useEffect, useState } from "react";
import { View, Text, Modal, Pressable, StyleSheet, ActivityIndicator, Platform, Linking } from "react-native";
import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/src/theme";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { shareDataUri } from "@/src/share";

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
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [loadingLink, setLoadingLink] = useState(false);

  useEffect(() => {
    setShareUrl(null);
    if (!visible || !target) return;
    // Pre-fetch share URL when opened (only if we can — contact file)
    if (!target.contactId) return;
    setLoadingLink(true);
    api<{ url: string; expires_at: string }>(
      `/contacts/${target.contactId}/files/${target.id}/share-link`,
      { method: "POST" }
    )
      .then((r) => setShareUrl(r.url))
      .catch((e: any) => {
        console.warn("share link err", e);
      })
      .finally(() => setLoadingLink(false));
  }, [visible, target]);

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
    } finally {
      setBusyChannel(null);
    }
  };

  const shareWhatsApp = async () => {
    setBusyChannel("whatsapp");
    try {
      const text = encodeURIComponent(withUrl(defaultMsg));
      // Native WhatsApp deep link (fallback to wa.me on web)
      const nativeUrl = `whatsapp://send?text=${text}`;
      const webUrl = `https://wa.me/?text=${text}`;
      if (Platform.OS === "web") {
        window.open(webUrl, "_blank");
      } else {
        const canOpen = await Linking.canOpenURL(nativeUrl);
        await Linking.openURL(canOpen ? nativeUrl : webUrl);
      }
    } catch (e: any) {
      notify("WhatsApp non disponibile", e?.message || "");
    } finally {
      setBusyChannel(null);
    }
  };

  const shareEmail = async () => {
    setBusyChannel("email");
    try {
      const subject = encodeURIComponent(`Condivisione file: ${target.name}`);
      const body = encodeURIComponent(withUrl(defaultMsg));
      const url = `mailto:?subject=${subject}&body=${body}`;
      if (Platform.OS === "web") {
        window.location.href = url;
      } else {
        await Linking.openURL(url);
      }
    } catch (e: any) {
      notify("Email non disponibile", e?.message || "");
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
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
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
              disabled={!shareUrl && loadingLink}
            />
            <ChannelBtn
              testID="share-ch-email"
              icon="mail"
              color="#DC2626"
              label="Email"
              busy={busyChannel === "email"}
              onPress={shareEmail}
              disabled={!shareUrl && loadingLink}
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
});

// V50.z25 — Sezione "Allegati dalle mail" nella scheda contatto.
// Mostra i file salvati automaticamente dall'Auto-CRM (contact_mail_attachments).
// Preview IN-APP: iframe/Image su web, Image/hint su native.

import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, ActivityIndicator, Modal, Image, Platform, Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import { api, getAuthHeader } from "@/src/api";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

type MailAtt = {
  attachment_id: string;
  contact_id: string;
  filename: string;
  content_type: string;
  size: number;
  account_id: string;
  mail_uid: string;
  created_at: string;
  mail_subject?: string;
  mail_from_email?: string;
  mail_from_name?: string;
  mail_received_at?: string;
};

function formatSize(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function ContactMailAttachmentsSection({ contactId }: { contactId: string }) {
  const [items, setItems] = useState<MailAtt[]>([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<{ url: string; name: string; type: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: MailAtt[] }>(`/contacts/${contactId}/mail-attachments`);
      setItems(r.items || []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => { load(); }, [load]);

  const openPreview = async (a: MailAtt) => {
    try {
      const backend = process.env.EXPO_PUBLIC_BACKEND_URL || "";
      const url = `${backend}/api/contacts/${contactId}/mail-attachments/${a.attachment_id}/download`;
      const auth = await getAuthHeader();
      if (Platform.OS === "web") {
        const resp = await fetch(url, { headers: auth });
        if (!resp.ok) { Alert.alert("Errore", `HTTP ${resp.status}`); return; }
        const blob = await resp.blob();
        const blobUrl = URL.createObjectURL(blob);
        setPreview({ url: blobUrl, name: a.filename, type: blob.type || a.content_type });
      } else {
        const dest = `${FileSystem.cacheDirectory}${a.filename}`;
        const dl = await FileSystem.downloadAsync(url, dest, { headers: auth });
        if (dl.status !== 200) { Alert.alert("Errore", `Download fallito (${dl.status})`); return; }
        setPreview({ url: dl.uri, name: a.filename, type: a.content_type });
      }
    } catch (e: any) {
      Alert.alert("Errore", e?.message || "Impossibile aprire");
    }
  };

  const remove = async (a: MailAtt) => {
    try {
      await api(`/contacts/${contactId}/mail-attachments/${a.attachment_id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((x) => x.attachment_id !== a.attachment_id));
    } catch (e: any) {
      Alert.alert("Errore", e?.message || "");
    }
  };

  if (loading) {
    return (
      <View style={styles.section}>
        <View style={styles.header}>
          <Ionicons name="mail-open-outline" size={16} color="#F97316" />
          <Text style={styles.title}>Allegati dalle mail</Text>
        </View>
        <View style={styles.loading}><ActivityIndicator size="small" color="#F97316" /></View>
      </View>
    );
  }

  if (items.length === 0) {
    return null; // Sezione discreta: appare solo se ci sono allegati
  }

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Ionicons name="mail-open" size={16} color="#F97316" />
        <Text style={styles.title}>Allegati dalle mail</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeTxt}>{items.length}</Text>
        </View>
      </View>
      <Text style={styles.hint}>File salvati automaticamente dall&apos;Auto-CRM da mail di questo contatto</Text>
      {items.map((a) => {
        const isImg = /^image\//i.test(a.content_type) || /\.(png|jpe?g|gif|webp)$/i.test(a.filename);
        const isPdf = /pdf/i.test(a.content_type) || /\.pdf$/i.test(a.filename);
        return (
          <Pressable
            key={a.attachment_id}
            onPress={() => openPreview(a)}
            style={styles.card}
            testID={`mail-att-${a.attachment_id}`}
          >
            <Ionicons
              name={isImg ? "image-outline" : isPdf ? "document-text-outline" : "document-outline"}
              size={22}
              color="#F97316"
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.fname} numberOfLines={1}>{a.filename}</Text>
              <Text style={styles.meta} numberOfLines={1}>
                {formatSize(a.size)}
                {a.mail_from_email ? ` · da ${a.mail_from_name || a.mail_from_email}` : ""}
              </Text>
              {a.mail_subject ? (
                <Text style={styles.subj} numberOfLines={1}>{a.mail_subject}</Text>
              ) : null}
            </View>
            <Pressable
              onPress={(e: any) => {
                e?.stopPropagation?.();
                Alert.alert(
                  "Rimuovi allegato",
                  `Vuoi rimuovere ${a.filename} da questo contatto?`,
                  [
                    { text: "Annulla", style: "cancel" },
                    { text: "Rimuovi", style: "destructive", onPress: () => remove(a) },
                  ],
                );
              }}
              hitSlop={8}
              style={{ padding: 4 }}
              testID={`mail-att-del-${a.attachment_id}`}
            >
              <Ionicons name="trash-outline" size={18} color={HT.danger} />
            </Pressable>
          </Pressable>
        );
      })}

      {preview ? (
        <MailAttPreview
          src={preview}
          onClose={() => {
            if (Platform.OS === "web" && preview.url.startsWith("blob:")) URL.revokeObjectURL(preview.url);
            setPreview(null);
          }}
        />
      ) : null}
    </View>
  );
}

function MailAttPreview({ src, onClose }: { src: { url: string; name: string; type: string }; onClose: () => void }) {
  const isImage = /^image\//i.test(src.type) || /\.(png|jpe?g|gif|webp)$/i.test(src.name);
  const isPdf = /pdf/i.test(src.type) || /\.pdf$/i.test(src.name);

  const onDownload = async () => {
    try {
      if (Platform.OS === "web") {
        const a = document.createElement("a");
        a.href = src.url; a.download = src.name;
        document.body.appendChild(a); a.click(); a.remove();
      } else {
        const Sharing = await import("expo-sharing");
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(src.url, { dialogTitle: src.name });
        } else {
          Alert.alert("Salvato", `File in cache:\n${src.url}`);
        }
      }
    } catch (e: any) {
      Alert.alert("Errore", e?.message || "");
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={pStyles.backdrop}>
        <View style={pStyles.header}>
          <Text style={pStyles.title} numberOfLines={1}>{src.name}</Text>
          <Pressable onPress={onDownload} hitSlop={10} style={pStyles.dlBtn}>
            <Ionicons name="download" size={18} color="#FFF" />
            <Text style={pStyles.dlTxt}>Scarica</Text>
          </Pressable>
          <Pressable onPress={onClose} hitSlop={10} style={{ marginLeft: 8 }}>
            <Ionicons name="close" size={28} color="#FFF" />
          </Pressable>
        </View>
        <View style={pStyles.body}>
          {Platform.OS === "web" ? (
            isImage ? (
              (<img src={src.url} alt={src.name} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />) as any
            ) : (
              (<iframe src={src.url} title={src.name} style={{ width: "100%", height: "100%", border: 0, background: "#FFF" }} />) as any
            )
          ) : isImage ? (
            <Image source={{ uri: src.url }} style={{ width: "100%", height: "100%" }} resizeMode="contain" />
          ) : isPdf ? (
            <View style={pStyles.nativeHint}>
              <Ionicons name="document-text" size={64} color="#F97316" />
              <Text style={pStyles.hintTxt}>Anteprima PDF non disponibile in-app</Text>
              <Text style={pStyles.hintSub}>Tocca Scarica per aprire con il tuo lettore PDF</Text>
            </View>
          ) : (
            <View style={pStyles.nativeHint}>
              <Ionicons name="document" size={64} color="#F97316" />
              <Text style={pStyles.hintTxt}>Anteprima non disponibile</Text>
              <Text style={pStyles.hintSub}>Tocca Scarica per aprire con l&apos;app di sistema</Text>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: 14, padding: 12, borderRadius: 14,
    backgroundColor: HT.brandTint, borderWidth: 1, borderColor: HT.brandLine, gap: 8,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { fontSize: 13, fontWeight: "800", color: "#FDBA74" },
  badge: {
    marginLeft: 4, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999,
    backgroundColor: '#F97316',
  },
  badgeTxt: { color: "#FFF", fontSize: 11, fontWeight: "800" },
  hint: { fontSize: 11, color: "#FDBA74", opacity: 0.75, marginTop: -2 },
  loading: { padding: 8, alignItems: "center" },
  card: {
    flexDirection: "row", alignItems: "center", gap: 10,
    padding: 10, borderRadius: 10, backgroundColor: HT.card,
    borderWidth: 1, borderColor: HT.brandLine,
  },
  fname: { fontSize: 13, fontWeight: "700", color: HT.text },
  meta: { fontSize: 11, color: HT.muted, marginTop: 2 },
  subj: { fontSize: 10, color: "#FDBA74", fontStyle: "italic", marginTop: 1 },
});

const pStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)" },
  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 12, backgroundColor: "rgba(0,0,0,0.9)",
    borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.15)",
  },
  title: { flex: 1, color: "#FFF", fontSize: 14, fontWeight: "800" },
  body: { flex: 1, alignItems: "center", justifyContent: "center" },
  nativeHint: { padding: 24, alignItems: "center", gap: 10 },
  hintTxt: { color: "#FFF", fontSize: 14, fontWeight: "700", textAlign: "center" },
  hintSub: { color: "rgba(255,255,255,0.6)", fontSize: 11, textAlign: "center" },
  dlBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: '#F97316' },
  dlTxt: { color: "#FFF", fontSize: 12, fontWeight: "800" },
});

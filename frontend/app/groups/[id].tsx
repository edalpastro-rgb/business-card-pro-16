import { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, Modal, TextInput, ScrollView, Linking, Platform, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { api } from "@/src/api";
import { theme } from "@/src/theme";

type Contact = { contact_id: string; first_name: string; last_name: string; phone?: string; email?: string; whatsapp?: string; telegram?: string; area: string };
type BulkPreviewItem = { contact_id: string; name: string; target: string; skip: boolean };

export default function GroupDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [members, setMembers] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ sent: number; failed: number } | null>(null);

  const [seqModal, setSeqModal] = useState<{ channel: "whatsapp" | "telegram" | "sms"; message: string; items: BulkPreviewItem[]; idx: number } | null>(null);
  const [seqBusy, setSeqBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api<{ items: Contact[] }>(`/groups/${id}/contacts`);
      setMembers(r.items);
    } finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const sendBulkEmail = async () => {
    if (!emailSubject.trim() || !emailBody.trim()) return;
    setSending(true);
    setResult(null);
    try {
      const r = await api<{ sent_count: number; failed_count: number }>("/bulk/email", {
        method: "POST",
        body: { group_id: id, subject: emailSubject, body_text: emailBody },
      });
      setResult({ sent: r.sent_count, failed: r.failed_count });
    } catch (e: any) {
      Alert.alert("Errore", e?.message || "Impossibile inviare");
    } finally { setSending(false); }
  };

  const startSequential = async (channel: "whatsapp" | "telegram" | "sms") => {
    const message = await promptMessage(channel);
    if (message === null) return;
    try {
      const r = await api<{ items: BulkPreviewItem[] }>("/bulk/preview", {
        method: "POST",
        body: { group_id: id, channel },
      });
      const filtered = r.items.filter((i) => !i.skip);
      if (filtered.length === 0) {
        Alert.alert("Nessun destinatario", `Nessun contatto del gruppo ha un ${channel === "telegram" ? "username Telegram" : "numero"} valido.`);
        return;
      }
      setSeqModal({ channel, message, items: filtered, idx: 0 });
    } catch (e: any) {
      Alert.alert("Errore", e?.message || "Anteprima fallita");
    }
  };

  const promptMessage = (channel: string): Promise<string | null> => new Promise((resolve) => {
    if (Platform.OS === "web") {
      const v = window.prompt(`Messaggio ${channel} (opzionale)\nPuoi usare {nome} {cognome} per personalizzare.`, "");
      resolve(v === null ? null : v);
    } else {
      Alert.prompt?.(
        `Messaggio ${channel}`,
        "Opzionale. Puoi usare {nome} {cognome}.",
        [
          { text: "Annulla", style: "cancel", onPress: () => resolve(null) },
          { text: "Continua", onPress: (v?: string) => resolve(v || "") },
        ],
        "plain-text",
        "",
      ) ?? resolve("");
    }
  });

  const openNext = async () => {
    if (!seqModal) return;
    const it = seqModal.items[seqModal.idx];
    const contact = members.find((m) => m.contact_id === it.contact_id);
    const text = seqModal.message
      .replace(/\{nome\}/g, contact?.first_name || "")
      .replace(/\{cognome\}/g, contact?.last_name || "");
    let url = "";
    if (seqModal.channel === "whatsapp") {
      const num = it.target.replace(/[^\d+]/g, "");
      url = `https://wa.me/${num}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
    } else if (seqModal.channel === "telegram") {
      const u = it.target.replace(/^@/, "");
      url = `https://t.me/${u}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
    } else if (seqModal.channel === "sms") {
      const num = it.target.replace(/[^\d+]/g, "");
      const sep = Platform.OS === "ios" ? "&" : "?";
      url = `sms:${num}${text ? `${sep}body=${encodeURIComponent(text)}` : ""}`;
    }
    setSeqBusy(true);
    try {
      await Linking.openURL(url);
    } catch (e) { console.warn(e); }
    setSeqBusy(false);
    // Move to next
    if (seqModal.idx + 1 >= seqModal.items.length) {
      setSeqModal(null);
      Alert.alert("Completato", `Aperti ${seqModal.items.length} contatti`);
    } else {
      setSeqModal({ ...seqModal, idx: seqModal.idx + 1 });
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.title}>Membri gruppo</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 4 }}>
        <View style={styles.actionsCard}>
          <Text style={styles.actionsTitle}>Invia a tutti i {members.length} membri</Text>
          <View style={styles.actionsGrid}>
            <BulkBtn testID="bulk-email-btn" icon="mail" label="Email" color="#0F2438" onPress={() => { setResult(null); setEmailModalOpen(true); }} />
            <BulkBtn testID="bulk-wa-btn" icon="logo-whatsapp" label="WhatsApp" color="#25D366" onPress={() => startSequential("whatsapp")} />
            <BulkBtn testID="bulk-tg-btn" icon="paper-plane" label="Telegram" color="#0088CC" onPress={() => startSequential("telegram")} />
            <BulkBtn testID="bulk-sms-btn" icon="chatbubble-ellipses" label="SMS" color={theme.color.brandSecondary} onPress={() => startSequential("sms")} />
          </View>
          <Text style={styles.hint}>WhatsApp/Telegram/SMS aprono la chat nativa uno alla volta. Email usa il tuo SMTP configurato.</Text>
        </View>

        <Text style={styles.sectionTitle}>Contatti nel gruppo</Text>
        {loading ? (
          <ActivityIndicator style={{ marginTop: 20 }} color={theme.color.brandPrimary} />
        ) : members.length === 0 ? (
          <Text style={styles.emptyTxt}>Nessun contatto associato a questo gruppo. Assegnalo dalla scheda contatto.</Text>
        ) : (
          <FlatList
            scrollEnabled={false}
            data={members}
            keyExtractor={(i) => i.contact_id}
            renderItem={({ item }) => (
              <Pressable onPress={() => router.push(`/contact/${item.contact_id}`)} style={styles.memberCard}>
                <View style={styles.avatar}><Text style={styles.avatarTxt}>{(item.first_name?.[0] || "").toUpperCase()}{(item.last_name?.[0] || "").toUpperCase()}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.memberName}>{item.first_name} {item.last_name}</Text>
                  <Text style={styles.memberSub}>{item.phone || item.email || "—"}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.color.muted} />
              </Pressable>
            )}
          />
        )}
      </ScrollView>

      {/* Email modal */}
      <Modal visible={emailModalOpen} transparent animationType="fade" onRequestClose={() => setEmailModalOpen(false)}>
        <View style={styles.modalBack}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Email al gruppo</Text>
            <Text style={styles.hint}>Puoi usare {"{nome}"} e {"{cognome}"} per personalizzare.</Text>
            <TextInput
              testID="bulk-email-subject"
              value={emailSubject}
              onChangeText={setEmailSubject}
              placeholder="Oggetto"
              placeholderTextColor="#94A3B8"
              style={styles.input}
            />
            <TextInput
              testID="bulk-email-body"
              value={emailBody}
              onChangeText={setEmailBody}
              placeholder="Corpo del messaggio..."
              placeholderTextColor="#94A3B8"
              style={[styles.input, { minHeight: 140, textAlignVertical: "top", marginTop: 8 }]}
              multiline
            />
            {result && (
              <Text style={{ marginTop: 10, color: result.failed === 0 ? theme.color.success : theme.color.warning, fontWeight: "700" }}>
                ✓ Inviate: {result.sent} · Fallite: {result.failed}
              </Text>
            )}
            <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
              <Pressable onPress={() => setEmailModalOpen(false)} style={[styles.modalBtn, { backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border }]}>
                <Text style={{ color: theme.color.onSurface, fontWeight: "700" }}>Chiudi</Text>
              </Pressable>
              <Pressable testID="bulk-email-send" onPress={sendBulkEmail} disabled={sending || !emailSubject.trim() || !emailBody.trim()} style={[styles.modalBtn, { backgroundColor: theme.color.brandPrimary, opacity: (sending || !emailSubject.trim() || !emailBody.trim()) ? 0.5 : 1 }]}>
                {sending ? <ActivityIndicator color="#FFF" /> : <Text style={{ color: "#FFF", fontWeight: "700" }}>Invia</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Sequential open modal */}
      <Modal visible={!!seqModal} transparent animationType="fade" onRequestClose={() => setSeqModal(null)}>
        <View style={styles.modalBack}>
          {seqModal && (
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Invio {seqModal.channel === "whatsapp" ? "WhatsApp" : seqModal.channel === "telegram" ? "Telegram" : "SMS"}</Text>
              <Text style={styles.hint}>Contatto {seqModal.idx + 1} di {seqModal.items.length}</Text>
              <Text style={styles.next}>{seqModal.items[seqModal.idx]?.name}</Text>
              <Text style={styles.nextTarget}>{seqModal.items[seqModal.idx]?.target}</Text>
              <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
                <Pressable onPress={() => setSeqModal(null)} style={[styles.modalBtn, { backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border }]}>
                  <Text style={{ color: theme.color.onSurface, fontWeight: "700" }}>Interrompi</Text>
                </Pressable>
                <Pressable
                  testID="seq-next-btn"
                  onPress={() => {
                    if (seqModal.idx + 1 >= seqModal.items.length) {
                      openNext();
                    } else {
                      setSeqModal({ ...seqModal, idx: seqModal.idx + 1 });
                    }
                  }}
                  style={[styles.modalBtn, { backgroundColor: theme.color.warning }]}
                >
                  <Text style={{ color: "#FFF", fontWeight: "700" }}>Salta</Text>
                </Pressable>
                <Pressable testID="seq-open-btn" onPress={openNext} disabled={seqBusy} style={[styles.modalBtn, { backgroundColor: theme.color.brandPrimary }]}>
                  {seqBusy ? <ActivityIndicator color="#FFF" /> : <Text style={{ color: "#FFF", fontWeight: "700" }}>Apri e prossimo</Text>}
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function BulkBtn({ testID, icon, label, color, onPress }: any) {
  return (
    <Pressable testID={testID} onPress={onPress} style={[bulkStyles.btn, { backgroundColor: color }]}>
      <Ionicons name={icon} size={22} color="#FFF" />
      <Text style={bulkStyles.txt}>{label}</Text>
    </Pressable>
  );
}

const bulkStyles = StyleSheet.create({
  btn: { flex: 1, minWidth: 140, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: theme.radius.md },
  txt: { color: "#FFF", fontWeight: "700", fontSize: 14 },
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontSize: 20, fontWeight: "700", color: theme.color.onSurface },
  actionsCard: { backgroundColor: "#FFF", borderRadius: theme.radius.md, padding: 14, borderWidth: 1, borderColor: theme.color.border, marginBottom: 16 },
  actionsTitle: { fontSize: 14, fontWeight: "700", color: theme.color.onSurface, marginBottom: 10 },
  actionsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  hint: { color: theme.color.muted, fontSize: 11, marginTop: 8, fontStyle: "italic" },
  sectionTitle: { fontSize: 13, fontWeight: "700", color: theme.color.onSurfaceTertiary, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },
  memberCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#FFF", padding: 12, borderRadius: theme.radius.md, marginBottom: 8, borderWidth: 1, borderColor: theme.color.border },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.color.brandTertiary, alignItems: "center", justifyContent: "center" },
  avatarTxt: { color: theme.color.brandPrimary, fontWeight: "700", fontSize: 14 },
  memberName: { fontSize: 15, fontWeight: "700", color: theme.color.onSurface },
  memberSub: { fontSize: 12, color: theme.color.muted, marginTop: 2 },
  emptyTxt: { color: theme.color.muted, textAlign: "center", marginTop: 20, fontStyle: "italic" },
  modalBack: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: 20 },
  modalCard: { backgroundColor: "#FFF", borderRadius: theme.radius.md, padding: 18, maxWidth: 480, width: "100%", alignSelf: "center" },
  modalTitle: { fontSize: 18, fontWeight: "700", color: theme.color.onSurface, marginBottom: 6 },
  input: { backgroundColor: theme.color.surface, borderRadius: theme.radius.md, padding: 12, borderWidth: 1, borderColor: theme.color.border, color: theme.color.onSurface, marginTop: 8 },
  modalBtn: { flex: 1, paddingVertical: 12, borderRadius: theme.radius.md, alignItems: "center" },
  next: { fontSize: 20, fontWeight: "700", color: theme.color.onSurface, marginTop: 10 },
  nextTarget: { fontSize: 14, color: theme.color.muted, marginTop: 4 },
});

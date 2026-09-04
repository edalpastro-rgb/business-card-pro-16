// V50.z18 — Outlook OAuth: collega account Microsoft (personale o M365) e
// leggi le mail INBOX in AdvisorOS/AxonOS via Microsoft Graph.
// Flow OAuth interamente lato backend: qui si apre solo l'URL di Microsoft
// tramite WebBrowser Expo. Il backend salva token cifrati (Fernet).

import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, RefreshControl, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";

WebBrowser.maybeCompleteAuthSession();

type OutlookStatus = {
  configured: boolean;
  connected: boolean;
  account_email?: string | null;
  connected_at?: string | null;
};

type OutlookMessage = {
  id: string;
  subject: string;
  preview: string;
  from_name?: string | null;
  from_email?: string | null;
  received_at?: string | null;
  is_read: boolean;
  web_link?: string | null;
  importance?: string;
  has_attachments?: boolean;
};

export default function OutlookScreen() {
  const router = useRouter();
  const pagePad = usePageBottomPadding();
  const [status, setStatus] = useState<OutlookStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [messages, setMessages] = useState<OutlookMessage[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showAll, setShowAll] = useState(false); // false = solo non lette

  const loadStatus = useCallback(async () => {
    try {
      const s = await api<OutlookStatus>("/outlook/status");
      setStatus(s);
      return s;
    } catch (e: any) {
      // Errore di rete/auth: assumi che sia configurato ma non connesso
      // (il messaggio "non configurato" è solo per casi genuini in cui il
      // server risponde configured:false).
      setStatus({ configured: true, connected: false });
      return null;
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  const loadMessages = useCallback(async (unreadOnly: boolean = !showAll) => {
    setLoadingMsgs(true);
    try {
      const r = await api<{ messages: OutlookMessage[]; count: number }>(
        `/outlook/messages?unread_only=${unreadOnly ? "true" : "false"}&top=30`,
      );
      setMessages(r.messages || []);
    } catch (e: any) {
      // Non intrusive: mostra alert solo se non è "non connesso"
      if (!/non collegato/i.test(String(e?.message || ""))) {
        Alert.alert("Errore", e?.message || "Impossibile caricare le mail");
      }
      setMessages([]);
    } finally {
      setLoadingMsgs(false);
      setRefreshing(false);
    }
  }, [showAll]);

  useFocusEffect(useCallback(() => {
    (async () => {
      const s = await loadStatus();
      if (s?.connected) loadMessages(!showAll);
    })();
  }, [loadStatus, loadMessages, showAll]));

  const connect = async () => {
    if (connecting) return;
    setConnecting(true);
    try {
      const r = await api<{ authorization_url: string }>("/outlook/start");
      // Redirect URI del backend (definito dal server) — WebBrowser aprirà una
      // sessione di autenticazione. Al callback, il backend redirige a
      // /outlook/callback?ok=1 che questa app gestisce.
      const returnUrl = process.env.EXPO_PUBLIC_BACKEND_URL
        ? `${process.env.EXPO_PUBLIC_BACKEND_URL}/outlook/callback`
        : (Platform.OS === "web" ? window.location.origin + "/outlook/callback" : "axon://outlook/callback");
      const result = await WebBrowser.openAuthSessionAsync(r.authorization_url, returnUrl);
      if (result.type === "success" || result.type === "dismiss") {
        // Ricarica status: se success, sarà connesso
        setTimeout(async () => {
          const s = await loadStatus();
          if (s?.connected) {
            Alert.alert("Outlook collegato", `Account ${s.account_email || "Microsoft"} collegato con successo.`);
            loadMessages(true);
          }
        }, 600);
      } else if (result.type === "cancel") {
        // Utente ha annullato → silenzioso
      }
    } catch (e: any) {
      Alert.alert("Errore", e?.message || "Impossibile avviare OAuth");
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = () => {
    Alert.alert(
      "Scollega Outlook",
      "Sicuro di voler scollegare l'account? I token saranno rimossi da AdvisorOS.",
      [
        { text: "Annulla", style: "cancel" },
        {
          text: "Scollega",
          style: "destructive",
          onPress: async () => {
            try {
              await api("/outlook/disconnect", { method: "POST" });
              setStatus({ configured: true, connected: false });
              setMessages([]);
            } catch (e: any) {
              Alert.alert("Errore", e?.message || "Impossibile scollegare");
            }
          },
        },
      ],
    );
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadMessages(!showAll);
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Outlook</Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 14, paddingBottom: pagePad, gap: 12 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {loadingStatus ? (
          <View style={styles.center}><ActivityIndicator size="large" color="#0078D4" /></View>
        ) : !status?.configured ? (
          <View style={styles.warnBox}>
            <Ionicons name="alert-circle" size={22} color="#F59E0B" />
            <View style={{ flex: 1 }}>
              <Text style={styles.warnTitle}>Outlook non configurato</Text>
              <Text style={styles.warnSub}>Manca la configurazione delle credenziali Microsoft nel server. Contatta l&apos;amministratore.</Text>
            </View>
          </View>
        ) : !status.connected ? (
          <View>
            {/* Card presentazione */}
            <View style={styles.introCard}>
              <View style={styles.introIconBox}>
                <Ionicons name="mail" size={28} color="#0078D4" />
              </View>
              <Text style={styles.introTitle}>Collega il tuo account Outlook</Text>
              <Text style={styles.introSub}>
                Axon leggerà le mail in entrata (INBOX) per aiutarti a rispondere, classificare
                e priorizzare. Supporta account personali (outlook.com, hotmail.com, live.com)
                e aziendali (Microsoft 365).
              </Text>
              <View style={styles.permList}>
                <PermRow icon="mail-open" text="Legge le tue mail INBOX (Mail.Read)" />
                <PermRow icon="refresh" text="Rimane collegato tramite refresh token (offline_access)" />
                <PermRow icon="lock-closed" text="Token cifrati con AES/Fernet sul server" />
                <PermRow icon="shield-checkmark" text="Puoi scollegare in qualsiasi momento" />
              </View>
              <Pressable
                onPress={connect}
                disabled={connecting}
                style={[styles.connectBtn, connecting && { opacity: 0.6 }]}
                testID="connect-outlook-btn"
              >
                {connecting ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <>
                    <Ionicons name="logo-microsoft" size={18} color="#FFF" />
                    <Text style={styles.connectTxt}>Collega Outlook</Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            {/* Card account collegato */}
            <View style={styles.connectedCard}>
              <View style={styles.connectedRow}>
                <View style={styles.connectedIcon}>
                  <Ionicons name="checkmark-circle" size={22} color="#059669" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.connectedTitle}>Collegato</Text>
                  <Text style={styles.connectedEmail} numberOfLines={1}>{status.account_email || "Account Microsoft"}</Text>
                </View>
                <Pressable onPress={disconnect} hitSlop={8}>
                  <Ionicons name="log-out-outline" size={22} color="#DC2626" />
                </Pressable>
              </View>
            </View>

            {/* Toggle filter */}
            <View style={styles.filterBar}>
              <Pressable
                onPress={() => setShowAll(false)}
                style={[styles.filterChip, !showAll && styles.filterChipOn]}
              >
                <Text style={[styles.filterTxt, !showAll && styles.filterTxtOn]}>Non lette</Text>
              </Pressable>
              <Pressable
                onPress={() => setShowAll(true)}
                style={[styles.filterChip, showAll && styles.filterChipOn]}
              >
                <Text style={[styles.filterTxt, showAll && styles.filterTxtOn]}>Tutte</Text>
              </Pressable>
              <View style={{ flex: 1 }} />
              <Pressable onPress={() => loadMessages(!showAll)} hitSlop={8} style={styles.reloadBtn}>
                <Ionicons name="refresh" size={18} color="#0078D4" />
              </Pressable>
            </View>

            {/* Messages */}
            {loadingMsgs ? (
              <View style={styles.center}><ActivityIndicator size="large" color="#0078D4" /></View>
            ) : messages.length === 0 ? (
              <View style={styles.emptyBox}>
                <Ionicons name="mail-open-outline" size={40} color={theme.color.muted} />
                <Text style={styles.emptyTxt}>
                  {showAll ? "Nessuna mail nella tua Inbox" : "Nessuna mail non letta 🎉"}
                </Text>
              </View>
            ) : (
              messages.map((m) => (
                <View key={m.id} style={[styles.msgCard, !m.is_read && styles.msgUnread]}>
                  <View style={styles.msgHead}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.msgFrom} numberOfLines={1}>
                        {m.from_name || m.from_email || "(sconosciuto)"}
                      </Text>
                      <Text style={styles.msgSubj} numberOfLines={1}>{m.subject}</Text>
                    </View>
                    <View style={styles.msgMetaCol}>
                      {m.received_at ? (
                        <Text style={styles.msgDate}>
                          {new Date(m.received_at).toLocaleString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </Text>
                      ) : null}
                      <View style={styles.msgFlags}>
                        {m.has_attachments ? <Ionicons name="attach" size={14} color={theme.color.muted} /> : null}
                        {m.importance === "high" ? <Ionicons name="flame" size={14} color="#EF4444" /> : null}
                        {!m.is_read ? <View style={styles.unreadDot} /> : null}
                      </View>
                    </View>
                  </View>
                  {m.preview ? <Text style={styles.msgPreview} numberOfLines={2}>{m.preview}</Text> : null}
                  {m.web_link ? (
                    <Pressable
                      onPress={() => WebBrowser.openBrowserAsync(m.web_link!)}
                      style={styles.openLink}
                    >
                      <Ionicons name="open-outline" size={13} color="#0078D4" />
                      <Text style={styles.openLinkTxt}>Apri in Outlook</Text>
                    </Pressable>
                  ) : null}
                </View>
              ))
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function PermRow({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={styles.permRow}>
      <Ionicons name={icon} size={16} color="#0078D4" />
      <Text style={styles.permTxt}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.background },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 12, paddingVertical: 10, backgroundColor: "#FFF",
    borderBottomWidth: 1, borderBottomColor: theme.color.border,
  },
  backBtn: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 17, fontWeight: "800", color: theme.color.onSurface },
  center: { padding: 40, alignItems: "center", justifyContent: "center" },
  warnBox: {
    flexDirection: "row", gap: 12, padding: 14, backgroundColor: "#FEF3C7",
    borderWidth: 1, borderColor: "#FCD34D", borderRadius: 12, alignItems: "flex-start",
  },
  warnTitle: { fontSize: 14, fontWeight: "800", color: "#92400E" },
  warnSub: { fontSize: 12, color: "#92400E", marginTop: 3, lineHeight: 17 },

  introCard: {
    backgroundColor: "#FFF", borderRadius: 16, padding: 20, gap: 10,
    borderWidth: 1, borderColor: theme.color.border, alignItems: "center",
  },
  introIconBox: {
    width: 64, height: 64, borderRadius: 16, backgroundColor: "#DBEAFE",
    alignItems: "center", justifyContent: "center", marginBottom: 4,
  },
  introTitle: { fontSize: 18, fontWeight: "800", color: theme.color.onSurface, textAlign: "center" },
  introSub: { fontSize: 13, color: theme.color.muted, textAlign: "center", lineHeight: 18, marginBottom: 6 },
  permList: { alignSelf: "stretch", gap: 8, marginVertical: 8 },
  permRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  permTxt: { fontSize: 12, color: theme.color.onSurface, flex: 1 },
  connectBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    marginTop: 8, paddingVertical: 14, borderRadius: 999, alignSelf: "stretch",
    backgroundColor: "#0078D4",
    shadowColor: "#0078D4", shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 4,
  },
  connectTxt: { color: "#FFF", fontWeight: "900", fontSize: 15, letterSpacing: 0.3 },

  connectedCard: {
    backgroundColor: "#DCFCE7", borderWidth: 1, borderColor: "#86EFAC",
    borderRadius: 12, padding: 12,
  },
  connectedRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  connectedIcon: {
    width: 40, height: 40, borderRadius: 10, backgroundColor: "#FFF",
    alignItems: "center", justifyContent: "center",
  },
  connectedTitle: { fontSize: 12, fontWeight: "900", color: "#059669", letterSpacing: 0.5 },
  connectedEmail: { fontSize: 14, fontWeight: "700", color: "#064E3B", marginTop: 2 },

  filterBar: { flexDirection: "row", alignItems: "center", gap: 8 },
  filterChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
    backgroundColor: "#F1F5F9",
  },
  filterChipOn: { backgroundColor: "#0078D4" },
  filterTxt: { color: theme.color.onSurface, fontWeight: "700", fontSize: 12 },
  filterTxtOn: { color: "#FFF" },
  reloadBtn: { padding: 6 },

  emptyBox: { padding: 40, alignItems: "center", gap: 8 },
  emptyTxt: { fontSize: 13, color: theme.color.muted },

  msgCard: {
    padding: 12, borderRadius: 12, backgroundColor: "#FFF",
    borderWidth: 1, borderColor: theme.color.border, gap: 6,
  },
  msgUnread: { borderLeftWidth: 3, borderLeftColor: "#0078D4" },
  msgHead: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  msgFrom: { fontSize: 13, fontWeight: "800", color: theme.color.onSurface },
  msgSubj: { fontSize: 13, color: theme.color.onSurface, marginTop: 2 },
  msgMetaCol: { alignItems: "flex-end", gap: 4 },
  msgDate: { fontSize: 10, color: theme.color.muted },
  msgFlags: { flexDirection: "row", gap: 4, alignItems: "center" },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#0078D4" },
  msgPreview: { fontSize: 12, color: theme.color.muted, lineHeight: 17 },
  openLink: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start" },
  openLinkTxt: { fontSize: 11, color: "#0078D4", fontWeight: "700" },
});

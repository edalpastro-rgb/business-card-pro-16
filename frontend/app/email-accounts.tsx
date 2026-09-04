// V50.z21 — MAIL UNIVERSALE: gestione caselle IMAP (Aruba, Gmail, Outlook,
// Register, Libero, Yahoo, IONOS, custom). Legge INBOX e scarica allegati.

import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput,
  ActivityIndicator, Alert, RefreshControl, Modal, Switch, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import * as FileSystem from "expo-file-system/legacy";
import * as WebBrowser from "expo-web-browser";
import { api, getAuthHeader } from "@/src/api";
import { theme } from "@/src/theme";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";

type Preset = { id: string; label: string; host?: string; port?: number; ssl?: boolean; note?: string };
type MailAccount = {
  account_id: string;
  email: string;
  label?: string;
  provider: string;
  imap_host: string;
  imap_port: number;
  imap_ssl: boolean;
  connected_at?: string;
  last_check_at?: string;
  last_error?: string | null;
};
type MailMessage = {
  uid: string;
  subject: string;
  from_name?: string;
  from_email?: string;
  date?: string;
  preview?: string;
  is_read: boolean;
  has_attachments: boolean;
  attachments_count: number;
  attachments?: { filename: string; content_type: string; size: number }[];
};

export default function EmailAccountsScreen() {
  const router = useRouter();
  const pagePad = usePageBottomPadding();
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [selectedAcct, setSelectedAcct] = useState<MailAccount | null>(null);
  // V50.z21 — Tab: accounts (gestione caselle) | inbox (vista unificata)
  const [tab, setTab] = useState<"accounts" | "inbox">("accounts");

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: MailAccount[] }>("/mail/accounts");
      setAccounts(r.items || []);
    } catch (e: any) {
      Alert.alert("Errore", e?.message || "Impossibile caricare");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = () => { setRefreshing(true); load(); };

  const removeAccount = (a: MailAccount) => {
    Alert.alert("Rimuovi casella", `Vuoi scollegare ${a.email}?`, [
      { text: "Annulla", style: "cancel" },
      {
        text: "Rimuovi",
        style: "destructive",
        onPress: async () => {
          try {
            await api(`/mail/accounts/${a.account_id}`, { method: "DELETE" });
            setAccounts((prev) => prev.filter((x) => x.account_id !== a.account_id));
          } catch (e: any) {
            Alert.alert("Errore", e?.message || "Impossibile rimuovere");
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Caselle Email</Text>
        <Pressable onPress={() => setAddOpen(true)} hitSlop={10} style={styles.addHeaderBtn} testID="add-mail-account">
          <Ionicons name="add-circle" size={26} color="#0EA5E9" />
        </Pressable>
      </View>

      {/* V50.z21 — Tab bar: gestione caselle vs Inbox unificata */}
      <View style={styles.tabBar}>
        <Pressable
          onPress={() => setTab("accounts")}
          style={[styles.tabBtn, tab === "accounts" && styles.tabBtnOn]}
        >
          <Ionicons name="folder" size={16} color={tab === "accounts" ? "#FFF" : theme.color.onSurface} />
          <Text style={[styles.tabTxt, tab === "accounts" && styles.tabTxtOn]}>Le mie caselle</Text>
          {accounts.length > 0 ? (
            <View style={[styles.tabBadge, tab === "accounts" && { backgroundColor: "#FFF" }]}>
              <Text style={[styles.tabBadgeTxt, tab === "accounts" && { color: "#0EA5E9" }]}>{accounts.length}</Text>
            </View>
          ) : null}
        </Pressable>
        <Pressable
          onPress={() => setTab("inbox")}
          style={[styles.tabBtn, tab === "inbox" && styles.tabBtnOn]}
        >
          <Ionicons name="mail-unread" size={16} color={tab === "inbox" ? "#FFF" : theme.color.onSurface} />
          <Text style={[styles.tabTxt, tab === "inbox" && styles.tabTxtOn]}>Inbox unificata</Text>
        </Pressable>
      </View>

      {tab === "inbox" ? (
        <CombinedInbox />
      ) : (
      <ScrollView
        contentContainerStyle={{ padding: 14, paddingBottom: pagePad, gap: 10 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.introBox}>
          <Ionicons name="mail" size={22} color="#0EA5E9" />
          <View style={{ flex: 1 }}>
            <Text style={styles.introTitle}>Collega qualsiasi casella mail</Text>
            <Text style={styles.introSub}>
              Funziona con Aruba, Gmail, Outlook, Register, Libero, Yahoo e altri.
              La password è cifrata con Fernet sul server.
            </Text>
          </View>
        </View>

        {loading ? (
          <View style={styles.empty}><ActivityIndicator size="large" color="#0EA5E9" /></View>
        ) : accounts.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="mail-open-outline" size={48} color={theme.color.muted} />
            <Text style={styles.emptyTxt}>Nessuna casella collegata</Text>
            <Text style={styles.emptyHint}>Tocca il ➕ in alto per aggiungerne una</Text>
          </View>
        ) : (
          accounts.map((a) => (
            <Pressable
              key={a.account_id}
              style={[styles.card, a.last_error ? styles.cardError : null]}
              onPress={() => setSelectedAcct(a)}
              testID={`account-${a.account_id}`}
            >
              <View style={styles.cardIcon}>
                <Ionicons name={a.last_error ? "alert-circle" : "mail"} size={22} color={a.last_error ? "#DC2626" : "#0EA5E9"} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle} numberOfLines={1}>{a.label || a.email}</Text>
                <Text style={styles.cardSub} numberOfLines={1}>{a.email} · {a.provider}</Text>
                {a.last_error ? (
                  <Text style={styles.cardErr} numberOfLines={2}>⚠ {a.last_error}</Text>
                ) : a.last_check_at ? (
                  <Text style={styles.cardMeta}>
                    Ultimo controllo: {new Date(a.last_check_at).toLocaleString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </Text>
                ) : null}
              </View>
              <Pressable onPress={() => removeAccount(a)} hitSlop={8}>
                <Ionicons name="trash-outline" size={20} color="#DC2626" />
              </Pressable>
            </Pressable>
          ))
        )}
      </ScrollView>
      )}

      {addOpen ? (
        <AddAccountModal
          onClose={() => setAddOpen(false)}
          onAdded={(a) => { setAccounts((prev) => [a, ...prev]); setAddOpen(false); }}
        />
      ) : null}

      {selectedAcct ? (
        <MessagesModal
          account={selectedAcct}
          onClose={() => setSelectedAcct(null)}
        />
      ) : null}
    </SafeAreaView>
  );
}

// ────────────────────────────────────────────────────────────────
// COMBINED INBOX — tutte le caselle in vista unificata (parallelo)
// ────────────────────────────────────────────────────────────────
type CombinedMessage = {
  account_id: string;
  account_email: string;
  account_label: string;
  uid: string;
  subject: string;
  from_name?: string;
  from_email?: string;
  date?: string;
  preview?: string;
  is_read: boolean;
  has_attachments: boolean;
  attachments?: { filename: string; content_type: string; size: number }[];
};

function CombinedInbox() {
  const [msgs, setMsgs] = useState<CombinedMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(true);
  const [errors, setErrors] = useState<{ email: string; error: string }[]>([]);
  const [stats, setStats] = useState<{ total: number; ok: number }>({ total: 0, ok: 0 });

  const load = useCallback(async () => {
    try {
      const r = await api<{
        messages: CombinedMessage[]; accounts_count: number; success_count: number;
        errors: { email: string; error: string }[];
      }>(`/mail/inbox?unread_only=${unreadOnly ? "true" : "false"}&per_account=20`);
      setMsgs(r.messages || []);
      setErrors(r.errors || []);
      setStats({ total: r.accounts_count || 0, ok: r.success_count || 0 });
    } catch (e: any) {
      Alert.alert("Errore", e?.message || "Impossibile caricare");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [unreadOnly]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = () => { setRefreshing(true); load(); };

  const downloadAttachment = async (m: CombinedMessage, filename: string) => {
    try {
      const backend = process.env.EXPO_PUBLIC_BACKEND_URL || "";
      const url = `${backend}/api/mail/accounts/${m.account_id}/messages/${encodeURIComponent(m.uid)}/attachments/${encodeURIComponent(filename)}`;
      if (Platform.OS === "web") { window.open(url, "_blank"); return; }
      const dest = `${FileSystem.cacheDirectory}${filename}`;
      const auth = await getAuthHeader();
      const dl = await FileSystem.downloadAsync(url, dest, { headers: auth });
      if (dl.status !== 200) { Alert.alert("Errore", `Download fallito (${dl.status})`); return; }
      await WebBrowser.openBrowserAsync(dl.uri);
    } catch (e: any) {
      Alert.alert("Errore download", e?.message || "");
    }
  };

  return (
    <ScrollView
      contentContainerStyle={{ padding: 12, paddingBottom: 40, gap: 8 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {stats.total > 0 ? (
        <View style={styles.combinedStats}>
          <Ionicons name="mail-unread" size={16} color="#0EA5E9" />
          <Text style={styles.combinedStatsTxt}>
            {msgs.length} mail da {stats.ok}/{stats.total} caselle
          </Text>
          {errors.length > 0 ? (
            <View style={styles.errorPill}>
              <Ionicons name="warning" size={11} color="#FFF" />
              <Text style={styles.errorPillTxt}>{errors.length} errore</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={styles.filterBar}>
        <Pressable onPress={() => setUnreadOnly(true)} style={[styles.filterChip, unreadOnly && styles.filterChipOn]}>
          <Text style={[styles.filterTxt, unreadOnly && styles.filterTxtOn]}>Non lette</Text>
        </Pressable>
        <Pressable onPress={() => setUnreadOnly(false)} style={[styles.filterChip, !unreadOnly && styles.filterChipOn]}>
          <Text style={[styles.filterTxt, !unreadOnly && styles.filterTxtOn]}>Tutte</Text>
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable onPress={load} hitSlop={8} style={styles.reloadBtn}>
          <Ionicons name="refresh" size={20} color="#0EA5E9" />
        </Pressable>
      </View>

      {errors.length > 0 ? (
        <View style={styles.errorsBox}>
          <Text style={styles.errorsTitle}>⚠ Caselle con errore</Text>
          {errors.map((e, i) => (
            <Text key={i} style={styles.errorsLine} numberOfLines={2}>
              • {e.email}: {e.error}
            </Text>
          ))}
        </View>
      ) : null}

      {loading ? (
        <View style={styles.empty}><ActivityIndicator size="large" color="#0EA5E9" /></View>
      ) : msgs.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="mail-open-outline" size={40} color={theme.color.muted} />
          <Text style={styles.emptyTxt}>
            {stats.total === 0 ? "Nessuna casella collegata" :
             unreadOnly ? "Nessuna mail non letta 🎉" : "Nessuna mail nelle Inbox"}
          </Text>
        </View>
      ) : msgs.map((m) => (
        <View key={`${m.account_id}-${m.uid}`} style={[styles.msgCard, !m.is_read && styles.msgUnread]}>
          <View style={styles.msgHead}>
            <View style={{ flex: 1 }}>
              <View style={styles.acctPill}>
                <Text style={styles.acctPillTxt} numberOfLines={1}>{m.account_label}</Text>
              </View>
              <Text style={styles.msgFrom} numberOfLines={1}>{m.from_name || m.from_email || "(sconosciuto)"}</Text>
              <Text style={styles.msgSubj} numberOfLines={1}>{m.subject}</Text>
            </View>
            <View style={styles.msgMetaCol}>
              {m.date ? (
                <Text style={styles.msgDate}>
                  {new Date(m.date).toLocaleString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                </Text>
              ) : null}
              <View style={styles.msgFlags}>
                {m.has_attachments ? <Ionicons name="attach" size={14} color={theme.color.muted} /> : null}
                {!m.is_read ? <View style={styles.unreadDot} /> : null}
              </View>
            </View>
          </View>
          {m.preview ? <Text style={styles.msgPreview} numberOfLines={3}>{m.preview}</Text> : null}
          {m.attachments && m.attachments.length > 0 ? (
            <View style={styles.attRow}>
              {m.attachments.map((att) => (
                <Pressable key={att.filename} onPress={() => downloadAttachment(m, att.filename)} style={styles.attChip}>
                  <Ionicons name="document" size={13} color="#0EA5E9" />
                  <Text style={styles.attTxt} numberOfLines={1}>{att.filename} · {formatSize(att.size)}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      ))}
    </ScrollView>
  );
}

// ────────────────────────────────────────────────────────────────
// ADD ACCOUNT MODAL
// ────────────────────────────────────────────────────────────────
function AddAccountModal({ onClose, onAdded }: { onClose: () => void; onAdded: (a: MailAccount) => void }) {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [providerId, setProviderId] = useState<string>("aruba");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("993");
  const [ssl, setSsl] = useState(true);
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);

  useFocusEffect(useCallback(() => {
    (async () => {
      try {
        const r = await api<{ presets: Preset[] }>("/mail/presets");
        setPresets(r.presets || []);
        const first = r.presets?.find((p) => p.id === "aruba") || r.presets?.[0];
        if (first) {
          setProviderId(first.id);
          setHost(first.host || "");
          setPort(String(first.port || 993));
          setSsl(first.ssl !== false);
        }
      } catch (e: any) {
        Alert.alert("Errore", e?.message || "Impossibile caricare i preset");
      }
    })();
  }, []));

  const selectPreset = (p: Preset) => {
    setProviderId(p.id);
    setHost(p.host || "");
    setPort(String(p.port || 993));
    setSsl(p.ssl !== false);
  };

  const submit = async () => {
    if (saving) return;
    if (!email.includes("@")) { Alert.alert("Email non valida"); return; }
    if (!password) { Alert.alert("Password mancante"); return; }
    if (!host) { Alert.alert("Host IMAP mancante"); return; }
    setSaving(true);
    try {
      const acct = await api<MailAccount>("/mail/accounts", {
        method: "POST",
        body: {
          email: email.trim(),
          password,
          provider: providerId,
          imap_host: host.trim(),
          imap_port: parseInt(port, 10) || 993,
          imap_ssl: ssl,
          label: label.trim() || email.trim(),
        },
      });
      Alert.alert("Casella collegata", `${acct.email} è stata aggiunta con successo.`);
      onAdded(acct);
    } catch (e: any) {
      Alert.alert("Errore", e?.message || "Aggiunta fallita");
    } finally {
      setSaving(false);
    }
  };

  const currentPreset = presets.find((p) => p.id === providerId);

  return (
    <Modal transparent visible animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.mBackdrop}>
        <View style={styles.mBox}>
          <View style={styles.mHeader}>
            <Text style={styles.mTitle}>Aggiungi casella email</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={24} color={theme.color.onSurface} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 14, gap: 12 }}>
            <Text style={styles.sectionLabel}>Provider</Text>
            <View style={styles.presetGrid}>
              {presets.map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() => selectPreset(p)}
                  style={[styles.presetChip, providerId === p.id && styles.presetChipOn]}
                >
                  <Text style={[styles.presetChipTxt, providerId === p.id && styles.presetChipTxtOn]}>{p.label}</Text>
                </Pressable>
              ))}
            </View>
            {currentPreset?.note ? (
              <View style={styles.noteBox}>
                <Ionicons name="information-circle" size={16} color="#B45309" />
                <Text style={styles.noteTxt}>{currentPreset.note}</Text>
              </View>
            ) : null}

            <Text style={styles.sectionLabel}>Email</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="mario@example.com"
              placeholderTextColor={theme.color.muted}
              autoCapitalize="none"
              keyboardType="email-address"
              style={styles.input}
              testID="mail-email-input"
            />
            <Text style={styles.sectionLabel}>Password</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder={currentPreset?.note?.includes("App Password") ? "App Password (16 caratteri)" : "Password della casella"}
              placeholderTextColor={theme.color.muted}
              secureTextEntry
              autoCapitalize="none"
              style={styles.input}
              testID="mail-password-input"
            />
            <Text style={styles.sectionLabel}>Nome (opzionale)</Text>
            <TextInput
              value={label}
              onChangeText={setLabel}
              placeholder="Es. Lavoro, Personale"
              placeholderTextColor={theme.color.muted}
              style={styles.input}
            />

            {providerId === "custom" ? (
              <>
                <Text style={styles.sectionLabel}>Server IMAP</Text>
                <TextInput
                  value={host}
                  onChangeText={setHost}
                  placeholder="es. imaps.miodominio.it"
                  placeholderTextColor={theme.color.muted}
                  autoCapitalize="none"
                  style={styles.input}
                />
                <View style={styles.rowInputs}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sectionLabel}>Porta</Text>
                    <TextInput
                      value={port}
                      onChangeText={setPort}
                      placeholder="993"
                      placeholderTextColor={theme.color.muted}
                      keyboardType="number-pad"
                      style={styles.input}
                    />
                  </View>
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={styles.sectionLabel}>SSL/TLS</Text>
                    <View style={styles.sslRow}>
                      <Switch value={ssl} onValueChange={setSsl} />
                      <Text style={{ marginLeft: 8, color: theme.color.onSurface }}>{ssl ? "Attivo" : "Disattivo"}</Text>
                    </View>
                  </View>
                </View>
              </>
            ) : null}

            <Pressable
              onPress={submit}
              disabled={saving}
              style={[styles.submitBtn, saving && { opacity: 0.6 }]}
              testID="mail-submit-btn"
            >
              {saving ? <ActivityIndicator color="#FFF" /> : (
                <>
                  <Ionicons name="link" size={18} color="#FFF" />
                  <Text style={styles.submitTxt}>Collega casella</Text>
                </>
              )}
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ────────────────────────────────────────────────────────────────
// MESSAGES MODAL — Inbox della casella selezionata
// ────────────────────────────────────────────────────────────────
function MessagesModal({ account, onClose }: { account: MailAccount; onClose: () => void }) {
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [unreadOnly, setUnreadOnly] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api<{ messages: MailMessage[] }>(
        `/mail/accounts/${account.account_id}/messages?unread_only=${unreadOnly ? "true" : "false"}&limit=30`,
      );
      setMessages(r.messages || []);
    } catch (e: any) {
      Alert.alert("Errore", e?.message || "Errore lettura mail");
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [account.account_id, unreadOnly]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const downloadAttachment = async (uid: string, filename: string, contentType?: string) => {
    try {
      const backend = process.env.EXPO_PUBLIC_BACKEND_URL || "";
      const url = `${backend}/api/mail/accounts/${account.account_id}/messages/${encodeURIComponent(uid)}/attachments/${encodeURIComponent(filename)}`;
      if (Platform.OS === "web") {
        window.open(url, "_blank");
        return;
      }
      // Native: download poi apri
      const dest = `${FileSystem.cacheDirectory}${filename}`;
      const auth = await getAuthHeader();
      const dl = await FileSystem.downloadAsync(url, dest, { headers: auth });
      if (dl.status !== 200) {
        Alert.alert("Errore", `Download fallito (${dl.status})`);
        return;
      }
      await WebBrowser.openBrowserAsync(dl.uri);
    } catch (e: any) {
      Alert.alert("Errore download", e?.message || "");
    }
  };

  return (
    <Modal transparent visible animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.mBackdrop}>
        <View style={styles.mBox}>
          <View style={styles.mHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.mTitle}>{account.label || account.email}</Text>
              <Text style={styles.mSub}>{account.email}</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={24} color={theme.color.onSurface} />
            </Pressable>
          </View>

          <View style={styles.filterBar}>
            <Pressable onPress={() => setUnreadOnly(true)} style={[styles.filterChip, unreadOnly && styles.filterChipOn]}>
              <Text style={[styles.filterTxt, unreadOnly && styles.filterTxtOn]}>Non lette</Text>
            </Pressable>
            <Pressable onPress={() => setUnreadOnly(false)} style={[styles.filterChip, !unreadOnly && styles.filterChipOn]}>
              <Text style={[styles.filterTxt, !unreadOnly && styles.filterTxtOn]}>Tutte</Text>
            </Pressable>
            <View style={{ flex: 1 }} />
            <Pressable onPress={load} hitSlop={8} style={styles.reloadBtn}>
              <Ionicons name="refresh" size={20} color="#0EA5E9" />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ padding: 12, gap: 8, paddingBottom: 40 }}>
            {loading ? (
              <View style={styles.empty}><ActivityIndicator size="large" color="#0EA5E9" /></View>
            ) : messages.length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="mail-open-outline" size={40} color={theme.color.muted} />
                <Text style={styles.emptyTxt}>{unreadOnly ? "Nessuna mail non letta 🎉" : "Nessuna mail nella Inbox"}</Text>
              </View>
            ) : (
              messages.map((m) => (
                <View key={m.uid} style={[styles.msgCard, !m.is_read && styles.msgUnread]}>
                  <View style={styles.msgHead}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.msgFrom} numberOfLines={1}>{m.from_name || m.from_email || "(sconosciuto)"}</Text>
                      <Text style={styles.msgSubj} numberOfLines={1}>{m.subject}</Text>
                    </View>
                    <View style={styles.msgMetaCol}>
                      {m.date ? (
                        <Text style={styles.msgDate}>
                          {new Date(m.date).toLocaleString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </Text>
                      ) : null}
                      <View style={styles.msgFlags}>
                        {m.has_attachments ? <Ionicons name="attach" size={14} color={theme.color.muted} /> : null}
                        {!m.is_read ? <View style={styles.unreadDot} /> : null}
                      </View>
                    </View>
                  </View>
                  {m.preview ? <Text style={styles.msgPreview} numberOfLines={3}>{m.preview}</Text> : null}
                  {m.attachments && m.attachments.length > 0 ? (
                    <View style={styles.attRow}>
                      {m.attachments.map((att) => (
                        <Pressable
                          key={att.filename}
                          onPress={() => downloadAttachment(m.uid, att.filename, att.content_type)}
                          style={styles.attChip}
                        >
                          <Ionicons name="document" size={13} color="#0EA5E9" />
                          <Text style={styles.attTxt} numberOfLines={1}>
                            {att.filename} · {formatSize(att.size)}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function formatSize(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ────────────────────────────────────────────────────────────────
// STYLES
// ────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.background },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 12, paddingVertical: 10, backgroundColor: "#FFF",
    borderBottomWidth: 1, borderBottomColor: theme.color.border,
  },
  backBtn: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  addHeaderBtn: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 17, fontWeight: "800", color: theme.color.onSurface },

  // V50.z21 — Tab bar + combined inbox
  tabBar: {
    flexDirection: "row", gap: 6, padding: 8,
    borderBottomWidth: 1, borderBottomColor: theme.color.border, backgroundColor: "#FFF",
  },
  tabBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, paddingVertical: 10, borderRadius: 10, backgroundColor: "#F1F5F9",
  },
  tabBtnOn: { backgroundColor: "#0EA5E9" },
  tabTxt: { fontSize: 13, fontWeight: "800", color: theme.color.onSurface },
  tabTxtOn: { color: "#FFF" },
  tabBadge: {
    minWidth: 20, height: 20, borderRadius: 10, backgroundColor: "#0EA5E9",
    paddingHorizontal: 6, alignItems: "center", justifyContent: "center",
  },
  tabBadgeTxt: { color: "#FFF", fontSize: 10, fontWeight: "900" },
  combinedStats: {
    flexDirection: "row", alignItems: "center", gap: 8,
    padding: 10, backgroundColor: "#F0F9FF", borderRadius: 10,
    borderWidth: 1, borderColor: "#BAE6FD",
  },
  combinedStatsTxt: { flex: 1, fontSize: 12, fontWeight: "700", color: "#075985" },
  errorPill: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: "#DC2626",
  },
  errorPillTxt: { color: "#FFF", fontSize: 10, fontWeight: "800" },
  errorsBox: {
    padding: 10, backgroundColor: "#FEF2F2", borderRadius: 10,
    borderWidth: 1, borderColor: "#FCA5A5", gap: 4,
  },
  errorsTitle: { fontSize: 12, fontWeight: "800", color: "#991B1B" },
  errorsLine: { fontSize: 11, color: "#991B1B", lineHeight: 15 },
  acctPill: {
    alignSelf: "flex-start", paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 4, backgroundColor: "#DBEAFE", marginBottom: 2,
  },
  acctPillTxt: { fontSize: 10, fontWeight: "800", color: "#0369A1", letterSpacing: 0.3 },

  introBox: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#F0F9FF", borderWidth: 1, borderColor: "#BAE6FD",
    borderRadius: 12, padding: 12,
  },
  introTitle: { fontSize: 14, fontWeight: "800", color: "#0369A1" },
  introSub: { fontSize: 12, color: "#075985", marginTop: 3, lineHeight: 17 },

  empty: { alignItems: "center", justifyContent: "center", gap: 8, padding: 40 },
  emptyTxt: { color: theme.color.onSurface, fontSize: 15, fontWeight: "700" },
  emptyHint: { color: theme.color.muted, fontSize: 12, textAlign: "center" },

  card: {
    flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 12,
    backgroundColor: "#FFF", borderWidth: 1, borderColor: theme.color.border,
  },
  cardError: { borderLeftWidth: 4, borderLeftColor: "#DC2626", backgroundColor: "#FEF2F2" },
  cardIcon: {
    width: 40, height: 40, borderRadius: 10, backgroundColor: "#F0F9FF",
    alignItems: "center", justifyContent: "center",
  },
  cardTitle: { fontSize: 14, fontWeight: "800", color: theme.color.onSurface },
  cardSub: { fontSize: 12, color: theme.color.muted, marginTop: 2 },
  cardMeta: { fontSize: 11, color: theme.color.muted, marginTop: 3 },
  cardErr: { fontSize: 11, color: "#DC2626", marginTop: 3 },

  // MODAL
  mBackdrop: { flex: 1, backgroundColor: "rgba(15,23,42,0.55)", justifyContent: "flex-end" },
  mBox: { backgroundColor: "#FFF", borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "92%" },
  mHeader: {
    flexDirection: "row", alignItems: "center", gap: 10,
    padding: 14, borderBottomWidth: 1, borderBottomColor: theme.color.border,
  },
  mTitle: { flex: 1, fontSize: 16, fontWeight: "800", color: theme.color.onSurface },
  mSub: { fontSize: 12, color: theme.color.muted, marginTop: 2 },

  sectionLabel: { fontSize: 12, fontWeight: "700", color: theme.color.muted, letterSpacing: 0.3 },
  presetGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  presetChip: {
    paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999,
    backgroundColor: "#F1F5F9", borderWidth: 1, borderColor: theme.color.border,
  },
  presetChipOn: { backgroundColor: "#0EA5E9", borderColor: "#0EA5E9" },
  presetChipTxt: { fontSize: 12, fontWeight: "700", color: theme.color.onSurface },
  presetChipTxtOn: { color: "#FFF" },

  noteBox: {
    flexDirection: "row", gap: 6, alignItems: "flex-start",
    padding: 10, borderRadius: 10, backgroundColor: "#FEF3C7",
    borderWidth: 1, borderColor: "#FCD34D",
  },
  noteTxt: { color: "#92400E", fontSize: 12, flex: 1, lineHeight: 16 },

  input: {
    borderWidth: 1, borderColor: theme.color.border, borderRadius: 10,
    padding: 12, fontSize: 14, color: theme.color.onSurface, backgroundColor: "#F8FAFC",
  },
  rowInputs: { flexDirection: "row", alignItems: "flex-start" },
  sslRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6 },

  submitBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    marginTop: 10, paddingVertical: 14, borderRadius: 999, backgroundColor: "#0EA5E9",
  },
  submitTxt: { color: "#FFF", fontSize: 15, fontWeight: "900", letterSpacing: 0.3 },

  filterBar: {
    flexDirection: "row", alignItems: "center", gap: 8, padding: 10,
    borderBottomWidth: 1, borderBottomColor: theme.color.border, backgroundColor: "#FFF",
  },
  filterChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
    backgroundColor: "#F1F5F9",
  },
  filterChipOn: { backgroundColor: "#0EA5E9" },
  filterTxt: { color: theme.color.onSurface, fontWeight: "700", fontSize: 12 },
  filterTxtOn: { color: "#FFF" },
  reloadBtn: { padding: 6 },

  msgCard: {
    padding: 12, borderRadius: 12, backgroundColor: "#FFF",
    borderWidth: 1, borderColor: theme.color.border, gap: 6,
  },
  msgUnread: { borderLeftWidth: 3, borderLeftColor: "#0EA5E9" },
  msgHead: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  msgFrom: { fontSize: 13, fontWeight: "800", color: theme.color.onSurface },
  msgSubj: { fontSize: 13, color: theme.color.onSurface, marginTop: 2 },
  msgMetaCol: { alignItems: "flex-end", gap: 4 },
  msgDate: { fontSize: 10, color: theme.color.muted },
  msgFlags: { flexDirection: "row", gap: 4, alignItems: "center" },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#0EA5E9" },
  msgPreview: { fontSize: 12, color: theme.color.muted, lineHeight: 17 },
  attRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  attChip: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "#F0F9FF", borderWidth: 1, borderColor: "#BAE6FD",
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, maxWidth: 220,
  },
  attTxt: { fontSize: 11, color: "#0369A1", fontWeight: "600" },
});

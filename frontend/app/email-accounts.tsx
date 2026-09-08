// V50.z21 — MAIL UNIVERSALE: gestione caselle IMAP (Aruba, Gmail, Outlook,
// Register, Libero, Yahoo, IONOS, custom). Legge INBOX e scarica allegati.

import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput,
  ActivityIndicator, Alert, RefreshControl, Modal, Switch, Platform, Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import * as FileSystem from "expo-file-system/legacy";
import { api, getAuthHeader } from "@/src/api";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";
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
    const doRemove = async () => {
      try {
        await api(`/mail/accounts/${a.account_id}`, { method: "DELETE" });
        setAccounts((prev) => prev.filter((x) => x.account_id !== a.account_id));
      } catch (e: any) {
        if (Platform.OS === "web") {
          window.alert(`Errore: ${e?.message || "Impossibile rimuovere"}`);
        } else {
          Alert.alert("Errore", e?.message || "Impossibile rimuovere");
        }
      }
    };
    // V50.z30 — Su web Alert.alert non mostra i pulsanti multipli (bug RN-Web):
    // usiamo window.confirm() nativo del browser. Su native manteniamo Alert.alert.
    if (Platform.OS === "web") {
      const ok = window.confirm(`Vuoi scollegare la casella ${a.email}?\n\nLe mail sul server non verranno toccate.`);
      if (ok) doRemove();
      return;
    }
    Alert.alert("Rimuovi casella", `Vuoi scollegare ${a.email}?`, [
      { text: "Annulla", style: "cancel" },
      { text: "Rimuovi", style: "destructive", onPress: doRemove },
    ]);
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Caselle Email</Text>
        <View style={{ width: 30 }} />
      </View>

      {/* V50.z21b — Bottone AGGIUNGI MAIL prominente sotto l'header */}
      <View style={styles.addBarWrap}>
        <Pressable
          onPress={() => setAddOpen(true)}
          style={styles.addBigBtn}
          testID="add-mail-account"
        >
          <Ionicons name="add-circle" size={22} color="#FFF" />
          <Text style={styles.addBigTxt}>AGGIUNGI MAIL</Text>
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
  attachments_count?: number;
  attachments?: { filename: string; content_type: string; size: number }[];
};

function CombinedInbox() {
  const pagePad = usePageBottomPadding();
  const [msgs, setMsgs] = useState<CombinedMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(true);
  const [errors, setErrors] = useState<{ email: string; error: string }[]>([]);
  const [stats, setStats] = useState<{ total: number; ok: number }>({ total: 0, ok: 0 });
  // V50.z21e — paginazione client-side: carica 20 alla volta
  const [displayCount, setDisplayCount] = useState(20);
  useEffect(() => { setDisplayCount(20); }, [unreadOnly]);

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

  // V50.z21d — useEffect invece di useFocusEffect: CombinedInbox è un
  // sotto-componente della pagina, il focus fires solo alla pagina non al
  // tab switch → fetch non partiva e refresh sembrava bloccato.
  useEffect(() => { load(); }, [load]);

  const onRefresh = () => { setRefreshing(true); load(); };

  // V50.z23 — Anteprima allegato IN-APP (no uscita da maschera app/web)
  const [previewSrc, setPreviewSrc] = useState<{ url: string; name: string; type: string } | null>(null);

  // V50.z65 — Vista dettaglio messaggio (corpo completo)
  type MailDetail = {
    uid: string; subject: string; from_name: string; from_email: string;
    to: string[]; cc: string[]; date: string | null;
    text: string; html: string;
    attachments: { filename: string; size: number; content_type: string }[];
    account_id: string; account_label: string;
  };
  const [detail, setDetail] = useState<MailDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const openMessage = async (m: CombinedMessage) => {
    setDetailLoading(true);
    setDetail({
      uid: m.uid, subject: m.subject, from_name: m.from_name || "",
      from_email: m.from_email || "", to: [], cc: [], date: m.date,
      text: m.preview || "", html: "", attachments: m.attachments || [],
      account_id: m.account_id, account_label: m.account_label,
    });
    try {
      const r = await api<MailDetail>(`/mail/accounts/${m.account_id}/messages/${encodeURIComponent(m.uid)}/body`);
      setDetail({ ...r, account_id: m.account_id, account_label: m.account_label });
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile caricare il messaggio");
    } finally {
      setDetailLoading(false);
    }
  };

  const downloadAttachment = async (m: CombinedMessage, filename: string) => {
    try {
      const backend = process.env.EXPO_PUBLIC_BACKEND_URL || "";
      const url = `${backend}/api/mail/accounts/${m.account_id}/messages/${encodeURIComponent(m.uid)}/attachments/${encodeURIComponent(filename)}`;
      const auth = await getAuthHeader();
      const resp = await fetch(url, { headers: auth });
      if (!resp.ok) {
        Alert.alert("Errore download", `HTTP ${resp.status}${resp.status === 401 ? " — non autenticato, riprova." : ""}`);
        return;
      }
      const blob = await resp.blob();
      const blobUrl = (Platform.OS === "web") ? URL.createObjectURL(blob) : `${FileSystem.cacheDirectory}${filename}`;
      if (Platform.OS !== "web") {
        // Native: salva su disco per il preview
        const dl = await FileSystem.downloadAsync(url, blobUrl, { headers: auth });
        if (dl.status !== 200) { Alert.alert("Errore", `Download fallito (${dl.status})`); return; }
      }
      // Apri modal preview interno all'app
      setPreviewSrc({ url: blobUrl, name: filename, type: blob.type || "application/octet-stream" });
    } catch (e: any) {
      Alert.alert("Errore download", e?.message || "");
    }
  };

  return (
    <ScrollView
      contentContainerStyle={{ padding: 12, paddingBottom: Math.max(pagePad, 80), gap: 8 }}
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
        <Pressable onPress={load} hitSlop={8} style={styles.reloadBtn} disabled={loading}>
          {loading ? (
            <ActivityIndicator size="small" color="#0EA5E9" />
          ) : (
            <Ionicons name="refresh" size={20} color="#0EA5E9" />
          )}
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
          {unreadOnly && stats.total > 0 ? (
            <Pressable onPress={() => setUnreadOnly(false)} style={styles.switchAllBtn}>
              <Text style={styles.switchAllTxt}>Mostra tutte le mail</Text>
            </Pressable>
          ) : null}
        </View>
      ) : msgs.slice(0, displayCount).map((m) => (
        <Pressable
          key={`${m.account_id}-${m.uid}`}
          onPress={() => openMessage(m)}
          testID={`mail-open-${m.account_id}-${m.uid}`}
          style={[
            styles.msgCard,
            !m.is_read && styles.msgUnread,
            m.has_attachments && styles.msgHasAtt,
          ]}
        >
          {m.has_attachments ? (
            <View style={styles.attHeader}>
              <Ionicons name="attach" size={14} color="#FFF" />
              <Text style={styles.attHeaderTxt}>
                {(m.attachments?.length || m.attachments_count || 1)} ALLEGAT{(m.attachments?.length || m.attachments_count || 1) === 1 ? "O" : "I"}
              </Text>
            </View>
          ) : null}
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
                {!m.is_read ? <View style={styles.unreadDot} /> : null}
              </View>
            </View>
          </View>
          {m.preview ? <Text style={styles.msgPreview} numberOfLines={3}>{m.preview}</Text> : null}
          {m.attachments && m.attachments.length > 0 ? (
            <View style={styles.attRow}>
              {m.attachments.map((att) => (
                <Pressable key={att.filename} onPress={() => downloadAttachment(m, att.filename)} style={styles.attChipBig}>
                  <Ionicons name="download" size={16} color="#FFF" />
                  <Text style={styles.attTxtBig} numberOfLines={1}>{att.filename || "allegato"} · {formatSize(att.size)}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </Pressable>
      ))}
      {/* V50.z21e — Bottone "Carica altre 20" quando ci sono più mail */}
      {msgs.length > displayCount ? (
        <Pressable onPress={() => setDisplayCount((n) => n + 20)} style={styles.loadMoreBtn} testID="mail-load-more">
          <Ionicons name="chevron-down" size={18} color="#0EA5E9" />
          <Text style={styles.loadMoreTxt}>Carica altre {Math.min(20, msgs.length - displayCount)} mail (visualizzate {displayCount}/{msgs.length})</Text>
        </Pressable>
      ) : msgs.length > 0 ? (
        <View style={styles.endHint}>
          <Text style={styles.endHintTxt}>✓ Fine elenco ({msgs.length} mail)</Text>
        </View>
      ) : null}
      {/* V50.z23 — Modal anteprima allegato IN-APP */}
      {previewSrc ? <AttachmentPreview src={previewSrc} onClose={() => {
        if (Platform.OS === "web" && previewSrc.url.startsWith("blob:")) URL.revokeObjectURL(previewSrc.url);
        setPreviewSrc(null);
      }} /> : null}

      {/* V50.z65 — Modal dettaglio messaggio email */}
      {detail ? (
        <Modal transparent visible={!!detail} onRequestClose={() => setDetail(null)} animationType="slide">
          <View style={styles.detailBackdrop} pointerEvents="box-none">
            <View style={styles.detailSheet}>
              <View style={styles.detailHeader}>
                <Pressable onPress={() => setDetail(null)} hitSlop={10} testID="mail-detail-close">
                  <Ionicons name="chevron-back" size={24} color="#FFF" />
                </Pressable>
                <Text style={styles.detailHeaderTxt} numberOfLines={1}>Messaggio</Text>
                <View style={{ width: 24 }} />
              </View>
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
                <View style={styles.detailAcctPill}>
                  <Text style={styles.detailAcctPillTxt}>{detail.account_label}</Text>
                </View>
                <Text style={styles.detailSubject}>{detail.subject || "(senza oggetto)"}</Text>
                <View style={styles.detailMetaRow}>
                  <Text style={styles.detailMetaLbl}>Da:</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.detailMetaVal} numberOfLines={2}>
                      {detail.from_name ? `${detail.from_name}  ` : ""}
                      <Text style={{ color: "#64748B" }}>{detail.from_email ? `<${detail.from_email}>` : ""}</Text>
                    </Text>
                  </View>
                </View>
                {detail.to && detail.to.length > 0 ? (
                  <View style={styles.detailMetaRow}>
                    <Text style={styles.detailMetaLbl}>A:</Text>
                    <Text style={[styles.detailMetaVal, { flex: 1 }]} numberOfLines={2}>{detail.to.join(", ")}</Text>
                  </View>
                ) : null}
                {detail.cc && detail.cc.length > 0 ? (
                  <View style={styles.detailMetaRow}>
                    <Text style={styles.detailMetaLbl}>Cc:</Text>
                    <Text style={[styles.detailMetaVal, { flex: 1 }]} numberOfLines={2}>{detail.cc.join(", ")}</Text>
                  </View>
                ) : null}
                {detail.date ? (
                  <View style={styles.detailMetaRow}>
                    <Text style={styles.detailMetaLbl}>Data:</Text>
                    <Text style={[styles.detailMetaVal, { flex: 1 }]}>
                      {new Date(detail.date).toLocaleString("it-IT", { weekday: "short", day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </Text>
                  </View>
                ) : null}

                {detail.attachments && detail.attachments.length > 0 ? (
                  <View style={styles.detailAttSect}>
                    <Text style={styles.detailAttTitle}>📎 Allegati ({detail.attachments.length})</Text>
                    {detail.attachments.map((att) => (
                      <Pressable
                        key={att.filename}
                        onPress={() => downloadAttachment({ account_id: detail.account_id, uid: detail.uid } as any, att.filename)}
                        style={styles.detailAttChip}
                      >
                        <Ionicons name="download" size={16} color="#FFF" />
                        <Text style={styles.detailAttChipTxt} numberOfLines={1}>
                          {att.filename || "allegato"} · {formatSize(att.size)}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}

                <View style={styles.detailBodyBox}>
                  {detailLoading && !detail.text && !detail.html ? (
                    <View style={{ padding: 30, alignItems: "center" }}>
                      <ActivityIndicator size="large" color="#0EA5E9" />
                      <Text style={{ marginTop: 10, color: "#64748B" }}>Caricamento messaggio…</Text>
                    </View>
                  ) : detail.html ? (
                    Platform.OS === "web" ? (
                      // @ts-expect-error web only
                      <iframe
                        srcDoc={`<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;color:#0F172A;margin:0;padding:12px;line-height:1.5;}img{max-width:100%;height:auto;}a{color:#0EA5E9;}</style>${detail.html}`}
                        style={{ width: "100%", minHeight: 380, border: "none", backgroundColor: "#FFF" }}
                        title="Corpo email"
                      />
                    ) : (
                      <Text style={styles.detailBodyText} selectable>
                        {detail.text || detail.html.replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim()}
                      </Text>
                    )
                  ) : detail.text ? (
                    <Text style={styles.detailBodyText} selectable>{detail.text}</Text>
                  ) : (
                    <Text style={{ color: "#94A3B8", fontStyle: "italic" }}>(nessun contenuto testuale)</Text>
                  )}
                </View>
              </ScrollView>
            </View>
          </View>
        </Modal>
      ) : null}
    </ScrollView>
  );
}

function AttachmentPreview({ src, onClose }: { src: { url: string; name: string; type: string }; onClose: () => void }) {
  const isImage = /^image\//i.test(src.type) || /\.(png|jpe?g|gif|webp|bmp)$/i.test(src.name);
  const isPdf = /pdf/i.test(src.type) || /\.pdf$/i.test(src.name);

  const onDownload = async () => {
    try {
      if (Platform.OS === "web") {
        const a = document.createElement("a");
        a.href = src.url; a.download = src.name;
        document.body.appendChild(a); a.click(); a.remove();
      } else {
        // Native: condividi/salva il file già presente in cache
        try {
          const Sharing = await import("expo-sharing");
          if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(src.url, { dialogTitle: src.name });
          } else {
            Alert.alert("Salvato", `File in cache:\n${src.url}`);
          }
        } catch {
          Alert.alert("Salvato", `File in cache:\n${src.url}`);
        }
      }
    } catch (e: any) {
      Alert.alert("Errore", e?.message || "Impossibile scaricare");
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={attStyles.backdrop}>
        <View style={attStyles.header}>
          <Text style={attStyles.title} numberOfLines={1}>{src.name}</Text>
          <Pressable onPress={onDownload} hitSlop={10} style={attStyles.dlBtn}>
            <Ionicons name="download" size={20} color="#FFF" />
            <Text style={attStyles.dlTxt}>Scarica</Text>
          </Pressable>
          <Pressable onPress={onClose} hitSlop={10} style={{ marginLeft: 8 }}>
            <Ionicons name="close" size={28} color="#FFF" />
          </Pressable>
        </View>
        <View style={attStyles.body}>
          {Platform.OS === "web" ? (
            isImage ? (
              (<img src={src.url} alt={src.name} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />) as any
            ) : (
              (<iframe src={src.url} title={src.name} style={{ width: "100%", height: "100%", border: 0, background: "#FFF" }} />) as any
            )
          ) : isImage ? (
            <Image source={{ uri: src.url }} style={{ width: "100%", height: "100%" }} resizeMode="contain" />
          ) : isPdf ? (
            <View style={attStyles.nativeHint}>
              <Ionicons name="document-text" size={64} color="#0EA5E9" />
              <Text style={attStyles.nativeHintTxt}>Anteprima PDF non disponibile in-app su mobile</Text>
              <Text style={attStyles.nativeHintSub}>Tocca Scarica per aprire con il tuo lettore PDF</Text>
            </View>
          ) : (
            <View style={attStyles.nativeHint}>
              <Ionicons name="document" size={64} color="#0EA5E9" />
              <Text style={attStyles.nativeHintTxt}>Anteprima non disponibile per questo tipo di file</Text>
              <Text style={attStyles.nativeHintSub}>Tocca Scarica per aprire con l&apos;app di sistema</Text>
            </View>
          )}
        </View>
      </View>
    </Modal>
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
  // V50.z21c — Toggle visualizzazione password
  const [showPassword, setShowPassword] = useState(false);
  // V50.z21b — Errore inline sempre visibile (RN Alert su web è a volte silente)
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // V50.z21b — usa useEffect invece di useFocusEffect (che scatta solo al
  // focus della pagina, non del modal). Con useFocusEffect i preset non
  // venivano caricati e `host` restava vuoto → submit fallito silenziosamente.
  useEffect(() => {
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
  }, []);

  const selectPreset = (p: Preset) => {
    setProviderId(p.id);
    setHost(p.host || "");
    setPort(String(p.port || 993));
    setSsl(p.ssl !== false);
  };

  const submit = async () => {
    if (saving) return;
    setErrorMsg(null);
    if (!email.includes("@")) { setErrorMsg("Email non valida"); return; }
    if (!password) { setErrorMsg("Password mancante"); return; }
    if (!host) { setErrorMsg("Host IMAP mancante — attendi che i preset si carichino o scegli 'Altro (config manuale)'"); return; }
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
      onAdded(acct);
      // V50.z21b — Feedback esplicito success (Alert può essere silente su web)
      setTimeout(() => Alert.alert("Casella collegata", `${acct.email} è stata aggiunta con successo.`), 200);
    } catch (e: any) {
      const msg = e?.message || "Aggiunta fallita";
      setErrorMsg(msg);
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
            <View style={styles.pwdWrap}>
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder={currentPreset?.note?.includes("App Password") ? "App Password (16 caratteri)" : "Password della casella"}
                placeholderTextColor={theme.color.muted}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.input, { paddingRight: 44 }]}
                testID="mail-password-input"
              />
              <Pressable
                onPress={() => setShowPassword((v) => !v)}
                style={styles.pwdEye}
                hitSlop={8}
                testID="mail-password-toggle"
              >
                <Ionicons
                  name={showPassword ? "eye-off" : "eye"}
                  size={20}
                  color={theme.color.muted}
                />
              </Pressable>
            </View>
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
            {/* V50.z21b — Banner errore inline sempre visibile */}
            {errorMsg ? (
              <View style={styles.errBanner}>
                <Ionicons name="alert-circle" size={16} color="#DC2626" />
                <Text style={styles.errBannerTxt}>{errorMsg}</Text>
              </View>
            ) : null}
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

  // V50.z21d — useEffect invece di useFocusEffect (stesso motivo)
  useEffect(() => { load(); }, [load]);

  // V50.z23 — Preview allegato IN-APP (nessuna uscita dal frame)
  const [previewSrc, setPreviewSrc] = useState<{ url: string; name: string; type: string } | null>(null);

  const downloadAttachment = async (uid: string, filename: string, contentType?: string) => {
    try {
      const backend = process.env.EXPO_PUBLIC_BACKEND_URL || "";
      const url = `${backend}/api/mail/accounts/${account.account_id}/messages/${encodeURIComponent(uid)}/attachments/${encodeURIComponent(filename)}`;
      const auth = await getAuthHeader();
      if (Platform.OS === "web") {
        const resp = await fetch(url, { headers: auth });
        if (!resp.ok) {
          Alert.alert("Errore download", `HTTP ${resp.status}${resp.status === 401 ? " — non autenticato, riprova." : ""}`);
          return;
        }
        const blob = await resp.blob();
        const blobUrl = URL.createObjectURL(blob);
        setPreviewSrc({ url: blobUrl, name: filename, type: blob.type || contentType || "application/octet-stream" });
        return;
      }
      // Native: scarica in cache e mostra preview in-app
      const dest = `${FileSystem.cacheDirectory}${filename}`;
      const dl = await FileSystem.downloadAsync(url, dest, { headers: auth });
      if (dl.status !== 200) {
        Alert.alert("Errore", `Download fallito (${dl.status})`);
        return;
      }
      setPreviewSrc({ url: dl.uri, name: filename, type: contentType || "application/octet-stream" });
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
      {/* V50.z23 — Modal anteprima allegato IN-APP */}
      {previewSrc ? <AttachmentPreview src={previewSrc} onClose={() => {
        if (Platform.OS === "web" && previewSrc.url.startsWith("blob:")) URL.revokeObjectURL(previewSrc.url);
        setPreviewSrc(null);
      }} /> : null}
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

  // V50.z21b — Bottone AGGIUNGI MAIL prominente
  addBarWrap: {
    paddingHorizontal: 14, paddingTop: 12, paddingBottom: 6, backgroundColor: "#FFF",
  },
  addBigBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    paddingVertical: 14, borderRadius: 12,
    backgroundColor: "#0EA5E9",
    shadowColor: "#0EA5E9", shadowOpacity: 0.35, shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 }, elevation: 4,
  },
  addBigTxt: { color: "#FFF", fontSize: 15, fontWeight: "900", letterSpacing: 1.2 },

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
  // V50.z21d — Bottone "Mostra tutte" quando non ci sono non-lette
  switchAllBtn: {
    marginTop: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
    backgroundColor: "#0EA5E9",
  },
  switchAllTxt: { color: "#FFF", fontSize: 12, fontWeight: "800" },

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
  // V50.z21c — Password toggle 👁
  pwdWrap: { position: "relative" },
  pwdEye: {
    position: "absolute", right: 10, top: 0, bottom: 0,
    justifyContent: "center", alignItems: "center", paddingHorizontal: 6,
  },
  rowInputs: { flexDirection: "row", alignItems: "flex-start" },
  sslRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6 },

  submitBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    marginTop: 10, paddingVertical: 14, borderRadius: 999, backgroundColor: "#0EA5E9",
  },
  submitTxt: { color: "#FFF", fontSize: 15, fontWeight: "900", letterSpacing: 0.3 },
  // V50.z21b — Banner errore inline
  errBanner: {
    flexDirection: "row", gap: 8, alignItems: "flex-start",
    marginTop: 10, padding: 10, borderRadius: 10,
    backgroundColor: "#FEE2E2", borderWidth: 1, borderColor: "#FCA5A5",
  },
  errBannerTxt: { flex: 1, color: "#991B1B", fontSize: 13, lineHeight: 18, fontWeight: "600" },

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
  // V50.z21e — Card mail con allegato molto evidente
  msgHasAtt: {
    borderWidth: 2, borderColor: "#F59E0B", backgroundColor: "#FFFBEB",
  },
  attHeader: {
    flexDirection: "row", alignItems: "center", gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6,
    backgroundColor: "#F59E0B", marginBottom: 4,
  },
  attHeaderTxt: { color: "#FFF", fontSize: 11, fontWeight: "900", letterSpacing: 0.6 },
  attChipBig: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#0EA5E9",
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, maxWidth: "100%",
    shadowColor: "#0EA5E9", shadowOpacity: 0.3, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  attTxtBig: { fontSize: 12, color: "#FFF", fontWeight: "800", flexShrink: 1 },
  // V50.z21e — Bottone Carica altre + fine elenco
  loadMoreBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    padding: 14, borderRadius: 10, backgroundColor: "#F0F9FF",
    borderWidth: 1, borderColor: "#BAE6FD",
  },
  loadMoreTxt: { color: "#0369A1", fontSize: 13, fontWeight: "800" },
  endHint: { alignItems: "center", padding: 12 },
  endHintTxt: { color: theme.color.muted, fontSize: 11, fontStyle: "italic" },
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

  // V50.z65 — Modal dettaglio mail
  detailBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  detailSheet: { flex: 1, backgroundColor: "#F8FAFC", marginTop: 40, borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: "hidden" },
  detailHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 14, paddingVertical: 12, backgroundColor: "#0F172A",
  },
  detailHeaderTxt: { color: "#FFF", fontSize: 15, fontWeight: "800", flex: 1, textAlign: "center" },
  detailAcctPill: {
    alignSelf: "flex-start", backgroundColor: "#0EA5E9",
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, marginBottom: 8,
  },
  detailAcctPillTxt: { color: "#FFF", fontSize: 11, fontWeight: "800" },
  detailSubject: { fontSize: 18, fontWeight: "900", color: theme.color.onSurface, marginBottom: 12 },
  detailMetaRow: { flexDirection: "row", gap: 6, marginBottom: 4 },
  detailMetaLbl: { fontSize: 12, fontWeight: "800", color: theme.color.muted, width: 40 },
  detailMetaVal: { fontSize: 12, color: theme.color.onSurface, fontWeight: "600" },
  detailAttSect: { marginTop: 14, gap: 6 },
  detailAttTitle: { fontSize: 12, fontWeight: "800", color: theme.color.onSurface, marginBottom: 2 },
  detailAttChip: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#0EA5E9", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
  },
  detailAttChipTxt: { color: "#FFF", fontSize: 12, fontWeight: "700", flex: 1 },
  detailBodyBox: {
    marginTop: 16, backgroundColor: "#FFF", borderRadius: 12,
    borderWidth: 1, borderColor: theme.color.border, padding: 14,
  },
  detailBodyText: { fontSize: 14, color: theme.color.onSurface, lineHeight: 20 },
});

// V50.z23 — Stili modal anteprima allegato in-app
const attStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)" },
  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 12, backgroundColor: "rgba(0,0,0,0.9)",
    borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.15)",
  },
  title: { flex: 1, color: "#FFF", fontSize: 14, fontWeight: "800" },
  body: { flex: 1, alignItems: "center", justifyContent: "center" },
  nativeHint: { padding: 24, alignItems: "center", gap: 10 },
  nativeHintTxt: { color: "#FFF", fontSize: 14, fontWeight: "700", textAlign: "center" },
  nativeHintSub: { color: "rgba(255,255,255,0.6)", fontSize: 11, textAlign: "center" },
  dlBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: "#0EA5E9" },
  dlTxt: { color: "#FFF", fontSize: 12, fontWeight: "800" },
});

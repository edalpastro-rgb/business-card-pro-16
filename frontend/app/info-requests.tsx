import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Platform, RefreshControl } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { theme } from "@/src/theme";
import { notify, confirmAsync } from "@/src/utils/notify";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

/**
 * V50.z82 — Richieste info aziendali.
 * - Collaboratori: form per inviare una richiesta al Master (subject + body).
 * - Master: lista di tutte le richieste del tenant con toggle risolto/pending.
 * Accessibile da widget home "Richieste info in attesa" oppure da CompanyContactSheet.
 */

type Req = {
  request_id: string;
  subject: string;
  body: string;
  status: "pending" | "resolved";
  created_by: string;
  created_by_name?: string;
  created_at: string;
  resolved_at?: string | null;
};

export default function InfoRequestsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ mode?: string }>();
  const insets = useSafeAreaInsets();
  const isMaster = user?.role === "owner" && !user?.parent_user_id;
  const [items, setItems] = useState<Req[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<"pending" | "resolved" | "compose">(
    params.mode === "compose" ? "compose" : "pending"
  );

  // Compose fields
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: Req[] }>(`/info-requests`);
      setItems(r.items || []);
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile caricare le richieste");
    } finally { setLoading(false); setRefreshing(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const send = async () => {
    if (subject.trim().length < 2 || body.trim().length < 2) {
      notify("Compila", "Serve un oggetto e un messaggio");
      return;
    }
    setSending(true);
    try {
      await api(`/info-requests`, { method: "POST", body: { subject: subject.trim(), body: body.trim() } });
      notify("Inviata", "La richiesta è stata trasmessa al Master");
      setSubject(""); setBody("");
      setTab("pending");
      load();
    } catch (e: any) {
      notify("Errore", e?.message || "Invio fallito");
    } finally { setSending(false); }
  };

  const toggleStatus = async (r: Req) => {
    try {
      const nextStatus = r.status === "pending" ? "resolved" : "pending";
      await api(`/info-requests/${r.request_id}`, { method: "PUT", body: { status: nextStatus } });
      load();
    } catch (e: any) {
      notify("Errore", e?.message || "Aggiornamento fallito");
    }
  };

  const remove = async (r: Req) => {
    const ok = await confirmAsync("Elimina richiesta?", `«${r.subject}»`);
    if (!ok) return;
    try {
      await api(`/info-requests/${r.request_id}`, { method: "DELETE" });
      load();
    } catch (e: any) {
      notify("Errore", e?.message || "Eliminazione fallita");
    }
  };

  const filtered = items.filter((x) => (tab === "compose" ? false : x.status === tab));

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="ireq-back">
          <Ionicons name="chevron-back" size={24} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.title}>Richieste info</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.tabs}>
        <Pressable onPress={() => setTab("pending")} style={[styles.tab, tab === "pending" && styles.tabActive]} testID="ireq-tab-pending">
          <Text style={[styles.tabTxt, tab === "pending" && styles.tabTxtActive]}>
            In attesa{items.filter((x) => x.status === "pending").length ? ` · ${items.filter((x) => x.status === "pending").length}` : ""}
          </Text>
        </Pressable>
        <Pressable onPress={() => setTab("resolved")} style={[styles.tab, tab === "resolved" && styles.tabActive]} testID="ireq-tab-resolved">
          <Text style={[styles.tabTxt, tab === "resolved" && styles.tabTxtActive]}>Risolte</Text>
        </Pressable>
        <Pressable onPress={() => setTab("compose")} style={[styles.tab, tab === "compose" && styles.tabActive]} testID="ireq-tab-compose">
          <Ionicons name="add-circle" size={14} color={tab === "compose" ? "#FFF" : theme.color.brandPrimary} />
          <Text style={[styles.tabTxt, tab === "compose" && styles.tabTxtActive, { marginLeft: 4 }]}>Nuova</Text>
        </Pressable>
      </View>

      {tab === "compose" ? (
        <KeyboardAwareScrollView bottomOffset={20} contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.hint}>
            Invia una richiesta al Master dell&apos;azienda: chiarimenti su offerte, procedure, materiali, dubbi commerciali.
          </Text>
          <Text style={styles.label}>Oggetto</Text>
          <TextInput
            value={subject}
            onChangeText={setSubject}
            style={styles.input}
            placeholder="Es. Chiarimento offerta Luce Impresa Plus"
            placeholderTextColor="#94A3B8"
            maxLength={200}
            testID="ireq-subject"
          />
          <Text style={styles.label}>Messaggio</Text>
          <TextInput
            value={body}
            onChangeText={setBody}
            style={[styles.input, styles.textarea]}
            placeholder="Descrivi la richiesta…"
            placeholderTextColor="#94A3B8"
            multiline
            maxLength={4000}
            testID="ireq-body"
          />
          <Pressable onPress={send} disabled={sending} style={[styles.sendBtn, sending && { opacity: 0.6 }]} testID="ireq-send">
            {sending ? <ActivityIndicator color="#FFF" /> : (
              <>
                <Ionicons name="send" size={14} color="#FFF" />
                <Text style={styles.sendTxt}>Invia richiesta</Text>
              </>
            )}
          </Pressable>
        </KeyboardAwareScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom + (Platform.OS === "web" ? 60 : 0) }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={theme.color.brandPrimary} />}
        >
          {loading ? (
            <ActivityIndicator style={{ marginTop: 32 }} color={theme.color.brandPrimary} />
          ) : filtered.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="mail-open-outline" size={40} color={theme.color.muted} />
              <Text style={styles.emptyTxt}>
                {tab === "pending" ? "Nessuna richiesta in attesa" : "Nessuna richiesta risolta"}
              </Text>
            </View>
          ) : (
            filtered.map((r) => (
              <View key={r.request_id} style={styles.card} testID={`ireq-card-${r.request_id}`}>
                <View style={styles.cardHead}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardSubject} numberOfLines={2}>{r.subject}</Text>
                    <Text style={styles.cardMeta}>{r.created_by_name || r.created_by} · {formatDate(r.created_at)}</Text>
                  </View>
                  <View style={[styles.statusPill, r.status === "pending" ? styles.pillPending : styles.pillResolved]}>
                    <Text style={styles.pillTxt}>{r.status === "pending" ? "In attesa" : "Risolta"}</Text>
                  </View>
                </View>
                <Text style={styles.cardBody}>{r.body}</Text>
                <View style={styles.actions}>
                  {isMaster ? (
                    <Pressable onPress={() => toggleStatus(r)} style={[styles.actionBtn, r.status === "pending" ? styles.btnResolve : styles.btnReopen]} testID={`ireq-toggle-${r.request_id}`}>
                      <Ionicons name={r.status === "pending" ? "checkmark-circle" : "refresh"} size={14} color="#FFF" />
                      <Text style={styles.actionTxt}>{r.status === "pending" ? "Segna risolta" : "Riapri"}</Text>
                    </Pressable>
                  ) : null}
                  {(isMaster || r.created_by === user?.user_id) ? (
                    <Pressable onPress={() => remove(r)} style={[styles.actionBtn, styles.btnDelete]} testID={`ireq-delete-${r.request_id}`}>
                      <Ionicons name="trash" size={14} color="#DC2626" />
                    </Pressable>
                  ) : null}
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  title: { fontSize: 16, fontWeight: "800", color: theme.color.onSurface },
  tabs: { flexDirection: "row", gap: 6, paddingHorizontal: 16, paddingTop: 12 },
  tab: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: theme.color.border, backgroundColor: "#FFF" },
  tabActive: { backgroundColor: theme.color.brandPrimary, borderColor: theme.color.brandPrimary },
  tabTxt: { fontSize: 12, fontWeight: "700", color: theme.color.onSurface },
  tabTxtActive: { color: "#FFF" },
  hint: { fontSize: 12, color: theme.color.muted, lineHeight: 17 },
  label: { fontSize: 11, fontWeight: "800", color: theme.color.muted, textTransform: "uppercase", letterSpacing: 0.4 },
  input: { borderWidth: 1, borderColor: theme.color.border, borderRadius: 10, padding: 12, fontSize: 14, color: theme.color.onSurface, backgroundColor: "#FFF" },
  textarea: { minHeight: 120, textAlignVertical: "top" },
  sendBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 14, borderRadius: 12, backgroundColor: theme.color.brandPrimary, marginTop: 6 },
  sendTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
  empty: { alignItems: "center", padding: 40, gap: 8 },
  emptyTxt: { fontSize: 13, color: theme.color.muted },
  card: { backgroundColor: "#FFF", borderWidth: 1, borderColor: theme.color.border, borderRadius: 12, padding: 12, marginBottom: 10, gap: 8 },
  cardHead: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  cardSubject: { fontSize: 14, fontWeight: "800", color: theme.color.onSurface },
  cardMeta: { fontSize: 11, color: theme.color.muted, marginTop: 3 },
  cardBody: { fontSize: 13, color: theme.color.onSurface, lineHeight: 18 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  pillPending: { backgroundColor: "#FEF3C7" },
  pillResolved: { backgroundColor: "#DCFCE7" },
  pillTxt: { fontSize: 10, fontWeight: "800", color: theme.color.onSurface, textTransform: "uppercase", letterSpacing: 0.4 },
  actions: { flexDirection: "row", gap: 8, justifyContent: "flex-end", marginTop: 4 },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  actionTxt: { color: "#FFF", fontWeight: "800", fontSize: 12 },
  btnResolve: { backgroundColor: "#16A34A" },
  btnReopen: { backgroundColor: "#F59E0B" },
  btnDelete: { backgroundColor: "#FEE2E2", paddingHorizontal: 10 },
});

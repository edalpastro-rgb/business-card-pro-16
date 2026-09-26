import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, Platform, RefreshControl } from "react-native";
import { KScrollView } from "@/src/ui/keyboard"; // V50.z374 — tastiera: campo attivo sempre visibile
import { SafeAreaView } from "react-native-safe-area-context";
import { useInsetsSafe } from "@/src/hooks/useSafeBottom";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { notify, confirmAsync } from "@/src/utils/notify";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

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
  contact_id?: string | null;
  created_at: string;
  resolved_at?: string | null;
  updated_at?: string;
  unread?: boolean;
  messages?: unknown[];
};

type ContactMini = { contact_id: string; first_name?: string; last_name?: string; phone?: string };

export default function InfoRequestsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ mode?: string }>();
  const insets = useInsetsSafe(); // V50.z165 — fallback bottom dentro Modal
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
  // V50.z83 — contatto opzionale collegato
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [selectedContact, setSelectedContact] = useState<ContactMini | null>(null);
  const [contactSearch, setContactSearch] = useState("");
  const [contactResults, setContactResults] = useState<ContactMini[]>([]);
  const [contactLoading, setContactLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: Req[] }>(`/info-requests`);
      setItems(r.items || []);
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile caricare le richieste");
    } finally { setLoading(false); setRefreshing(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Cerca contatti per il picker
  useEffect(() => {
    if (!contactPickerOpen) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setContactLoading(true);
      try {
        const q = contactSearch.trim();
        const url = q ? `/contacts?search=${encodeURIComponent(q)}&limit=20` : `/contacts?limit=20`;
        const res = await api<{ items?: ContactMini[] } | ContactMini[]>(url);
        const list = Array.isArray(res) ? res : (res as any).items || [];
        if (!cancelled) setContactResults(list);
      } catch { /* ignore */ }
      finally { if (!cancelled) setContactLoading(false); }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [contactPickerOpen, contactSearch]);

  const send = async () => {
    if (subject.trim().length < 2 || body.trim().length < 2) {
      notify("Compila", "Serve un oggetto e un messaggio");
      return;
    }
    setSending(true);
    try {
      await api(`/info-requests`, { method: "POST", body: { subject: subject.trim(), body: body.trim(), contact_id: selectedContact?.contact_id || null } });
      notify("Inviata", "La richiesta è stata trasmessa al Master");
      setSubject(""); setBody(""); setSelectedContact(null);
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
          <Ionicons name="chevron-back" size={24} color={HT.text} />
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
          <Ionicons name="add-circle" size={14} color={tab === "compose" ? "#FFF" : HT.brand} />
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
            placeholderTextColor={HT.muted}
            maxLength={200}
            testID="ireq-subject"
          />
          <Text style={styles.label}>Messaggio</Text>
          <TextInput
            value={body}
            onChangeText={setBody}
            style={[styles.input, styles.textarea]}
            placeholder="Descrivi la richiesta…"
            placeholderTextColor={HT.muted}
            multiline
            maxLength={4000}
            testID="ireq-body"
          />

          <Text style={styles.label}>Cliente collegato (opzionale)</Text>
          {selectedContact ? (
            <View style={styles.contactPill}>
              <Ionicons name="person" size={14} color={HT.brand} />
              <Text style={styles.contactPillTxt} numberOfLines={1}>{`${selectedContact.first_name || ""} ${selectedContact.last_name || ""}`.trim() || selectedContact.contact_id}</Text>
              <Pressable onPress={() => setSelectedContact(null)} hitSlop={6}>
                <Ionicons name="close-circle" size={16} color={HT.muted} />
              </Pressable>
            </View>
          ) : (
            <Pressable onPress={() => setContactPickerOpen(true)} style={styles.pickerBtn} testID="ireq-pick-contact">
              <Ionicons name="link" size={14} color={HT.brand} />
              <Text style={styles.pickerBtnTxt}>Collega un cliente</Text>
            </Pressable>
          )}

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
        <KScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom + (Platform.OS === "web" ? 60 : 0) }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={HT.brand} />}
        >
          {loading ? (
            <ActivityIndicator style={{ marginTop: 32 }} color={HT.brand} />
          ) : filtered.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="mail-open-outline" size={40} color={HT.muted} />
              <Text style={styles.emptyTxt}>
                {tab === "pending" ? "Nessuna richiesta in attesa" : "Nessuna richiesta risolta"}
              </Text>
            </View>
          ) : (
            filtered.map((r) => (
              <Pressable
                key={r.request_id}
                onPress={() => router.push(`/info-request-chat?id=${r.request_id}` as any)}
                style={[styles.card, r.unread && styles.cardUnread]}
                testID={`ireq-card-${r.request_id}`}
              >
                <View style={styles.cardHead}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      {r.unread ? <View style={styles.unreadDot} /> : null}
                      <Text style={styles.cardSubject} numberOfLines={2}>{r.subject}</Text>
                    </View>
                    <Text style={styles.cardMeta}>
                      {r.created_by_name || r.created_by} · {formatDate(r.updated_at || r.created_at)}
                      {r.messages && r.messages.length > 0 ? ` · ${r.messages.length} risposte` : ""}
                    </Text>
                  </View>
                  <View style={[styles.statusPill, r.status === "pending" ? styles.pillPending : styles.pillResolved]}>
                    <Text style={styles.pillTxt}>{r.status === "pending" ? "In attesa" : "Risolta"}</Text>
                  </View>
                </View>
                <Text style={styles.cardBody} numberOfLines={3}>{r.body}</Text>
                <View style={styles.actions}>
                  <View style={styles.openHint}>
                    <Ionicons name="chatbubbles" size={12} color={HT.brand} />
                    <Text style={styles.openHintTxt}>Apri conversazione</Text>
                  </View>
                  {isMaster ? (
                    <Pressable onPress={(e) => { (e as any).stopPropagation?.(); toggleStatus(r); }} style={[styles.actionBtn, r.status === "pending" ? styles.btnResolve : styles.btnReopen]} testID={`ireq-toggle-${r.request_id}`}>
                      <Ionicons name={r.status === "pending" ? "checkmark-circle" : "refresh"} size={14} color="#FFF" />
                      <Text style={styles.actionTxt}>{r.status === "pending" ? "Risolta" : "Riapri"}</Text>
                    </Pressable>
                  ) : null}
                  {(isMaster || r.created_by === user?.user_id) ? (
                    <Pressable onPress={(e) => { (e as any).stopPropagation?.(); remove(r); }} style={[styles.actionBtn, styles.btnDelete]} testID={`ireq-delete-${r.request_id}`}>
                      <Ionicons name="trash" size={14} color="#DC2626" />
                    </Pressable>
                  ) : null}
                </View>
              </Pressable>
            ))
          )}
        </KScrollView>
      )}

      {/* V50.z83 — Modal picker contatto */}
      {contactPickerOpen ? (
        <View style={styles.pickerOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setContactPickerOpen(false)} />
          <View style={styles.pickerSheet}>
            <View style={styles.pickerHead}>
              <Text style={styles.pickerTitle}>Seleziona cliente</Text>
              <Pressable onPress={() => setContactPickerOpen(false)} hitSlop={8}>
                <Ionicons name="close" size={20} color={HT.muted} />
              </Pressable>
            </View>
            <TextInput
              value={contactSearch}
              onChangeText={setContactSearch}
              placeholder="Cerca nome, cognome…"
              placeholderTextColor={HT.muted}
              style={[styles.input, { margin: 12 }]}
              testID="ireq-contact-search"
            />
            <KScrollView style={{ maxHeight: 360 }}>
              {contactLoading ? (
                <ActivityIndicator style={{ marginVertical: 24 }} color={HT.brand} />
              ) : contactResults.length === 0 ? (
                <Text style={{ padding: 24, textAlign: "center", color: HT.muted, fontSize: 13 }}>Nessun contatto trovato</Text>
              ) : (
                contactResults.map((c) => (
                  <Pressable
                    key={c.contact_id}
                    onPress={() => { setSelectedContact(c); setContactPickerOpen(false); }}
                    style={styles.pickerRow}
                  >
                    <Ionicons name="person-circle" size={26} color={HT.brand} />
                    <Text style={styles.pickerRowTxt}>{`${c.first_name || ""} ${c.last_name || ""}`.trim() || c.contact_id}</Text>
                  </Pressable>
                ))
              )}
            </KScrollView>
          </View>
        </View>
      ) : null}
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
  root: { flex: 1, backgroundColor: HT.card2 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: HT.border },
  title: { fontSize: 16, fontWeight: "800", color: HT.text },
  tabs: { flexDirection: "row", gap: 6, paddingHorizontal: 16, paddingTop: 12 },
  tab: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: HT.border, backgroundColor: HT.card },
  tabActive: { backgroundColor: HT.brand, borderColor: HT.brand },
  tabTxt: { fontSize: 12, fontWeight: "700", color: HT.text },
  tabTxtActive: { color: "#FFF" },
  hint: { fontSize: 12, color: HT.muted, lineHeight: 17 },
  label: { fontSize: 11, fontWeight: "800", color: HT.muted, textTransform: "uppercase", letterSpacing: 0.4 },
  input: { borderWidth: 1, borderColor: HT.border, borderRadius: 10, padding: 12, fontSize: 14, color: HT.text, backgroundColor: HT.card },
  textarea: { minHeight: 120, textAlignVertical: "top" },
  sendBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 14, borderRadius: 12, backgroundColor: HT.brand, marginTop: 6 },
  sendTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
  empty: { alignItems: "center", padding: 40, gap: 8 },
  emptyTxt: { fontSize: 13, color: HT.muted },
  card: { backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border, borderRadius: 12, padding: 12, marginBottom: 10, gap: 8 },
  cardUnread: { borderColor: '#DC2626', borderLeftWidth: 4 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#DC2626' },
  cardHead: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  cardSubject: { fontSize: 14, fontWeight: "800", color: HT.text },
  cardMeta: { fontSize: 11, color: HT.muted, marginTop: 3 },
  cardBody: { fontSize: 13, color: HT.text, lineHeight: 18 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  pillPending: { backgroundColor: HT.warningTint },
  pillResolved: { backgroundColor: HT.successTint },
  pillTxt: { fontSize: 10, fontWeight: "800", color: HT.text, textTransform: "uppercase", letterSpacing: 0.4 },
  actions: { flexDirection: "row", gap: 8, justifyContent: "flex-end", marginTop: 4 },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  actionTxt: { color: "#FFF", fontWeight: "800", fontSize: 12 },
  btnResolve: { backgroundColor: '#16A34A' },
  btnReopen: { backgroundColor: '#F59E0B' },
  btnDelete: { backgroundColor: HT.dangerTint, paddingHorizontal: 10 },
  openHint: { flex: 1, flexDirection: "row", alignItems: "center", gap: 4 },
  openHintTxt: { fontSize: 11, fontWeight: "700", color: HT.brand },
  contactPill: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: HT.brand + "18", borderRadius: 999, alignSelf: "flex-start" },
  contactPillTxt: { fontSize: 12, fontWeight: "700", color: HT.brand, maxWidth: 200 },
  pickerBtn: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderStyle: "dashed", borderColor: HT.brand },
  pickerBtnTxt: { fontSize: 12, fontWeight: "700", color: HT.brand },
  pickerOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end", zIndex: 100 },
  pickerSheet: { backgroundColor: HT.card, borderTopLeftRadius: 18, borderTopRightRadius: 18, maxHeight: "80%" },
  pickerHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 14, borderBottomWidth: 1, borderBottomColor: HT.border },
  pickerTitle: { fontSize: 15, fontWeight: "800", color: HT.text },
  pickerRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: HT.border },
  pickerRowTxt: { fontSize: 14, color: HT.text },
});

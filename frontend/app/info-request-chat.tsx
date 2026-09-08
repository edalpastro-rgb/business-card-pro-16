import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Platform } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";

/**
 * V50.z83 — Chat thread di una richiesta info (Master ↔ Collaboratore).
 * Header con oggetto + stato + eventuale contatto collegato.
 * Messaggi in bolla stile chat.
 * Input testo + Invia.
 * All'apertura viene chiamato /seen per azzerare l'unread badge.
 */

type Msg = {
  author_id: string;
  author_name?: string;
  author_role?: "master" | "collaborator";
  text: string;
  at: string;
};

type ReqDetail = {
  request_id: string;
  subject: string;
  body: string;
  status: "pending" | "resolved";
  created_by: string;
  created_by_name?: string;
  contact_id?: string | null;
  created_at: string;
  messages: Msg[];
};

type ContactMini = { contact_id: string; first_name?: string; last_name?: string; phone?: string };

export default function InfoRequestChatScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string }>();
  const rid = params.id as string;
  const [detail, setDetail] = useState<ReqDetail | null>(null);
  const [contact, setContact] = useState<ContactMini | null>(null);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const isMaster = user?.role === "owner" && !user?.parent_user_id;

  const load = useCallback(async () => {
    if (!rid) return;
    try {
      const d = await api<ReqDetail>(`/info-requests/${rid}`);
      setDetail(d);
      if (d.contact_id) {
        try {
          const c = await api<ContactMini>(`/contacts/${d.contact_id}`);
          setContact(c);
        } catch { /* ignore */ }
      }
      // Segna come letto (aggiorna last_seen)
      try { await api(`/info-requests/${rid}/seen`, { method: "POST", body: {} }); } catch { /* ignore */ }
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile caricare la conversazione");
    } finally { setLoading(false); }
  }, [rid]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    // Auto-scroll all'ultimo messaggio
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 200);
    return () => clearTimeout(t);
  }, [detail?.messages?.length]);

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setSending(true);
    try {
      const d = await api<ReqDetail>(`/info-requests/${rid}/messages`, { method: "POST", body: { text: t } });
      setDetail(d);
      setText("");
    } catch (e: any) {
      notify("Errore", e?.message || "Invio fallito");
    } finally { setSending(false); }
  };

  const resolve = async () => {
    try {
      const d = await api<ReqDetail>(`/info-requests/${rid}`, { method: "PUT", body: { status: detail?.status === "pending" ? "resolved" : "pending" } });
      setDetail(d);
    } catch (e: any) {
      notify("Errore", e?.message || "Aggiornamento fallito");
    }
  };

  const contactName = contact ? `${contact.first_name || ""} ${contact.last_name || ""}`.trim() : "";

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="ireqchat-back">
          <Ionicons name="chevron-back" size={24} color={theme.color.onSurface} />
        </Pressable>
        <View style={{ flex: 1, marginHorizontal: 8 }}>
          <Text style={styles.title} numberOfLines={1}>{detail?.subject || "Conversazione"}</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            con {detail?.created_by_name || "collaboratore"}{contactName ? ` · cliente: ${contactName}` : ""}
          </Text>
        </View>
        {isMaster ? (
          <Pressable onPress={resolve} hitSlop={6} style={[styles.statusBtn, detail?.status === "pending" ? styles.pillPending : styles.pillResolved]} testID="ireqchat-toggle">
            <Text style={styles.statusTxt}>{detail?.status === "pending" ? "In attesa" : "Risolta"}</Text>
          </Pressable>
        ) : (
          <View style={[styles.statusBtn, detail?.status === "pending" ? styles.pillPending : styles.pillResolved]}>
            <Text style={styles.statusTxt}>{detail?.status === "pending" ? "In attesa" : "Risolta"}</Text>
          </View>
        )}
      </View>

      {contact ? (
        <Pressable onPress={() => router.push(`/contact/${contact.contact_id}` as any)} style={styles.contactStrip} testID="ireqchat-open-contact">
          <Ionicons name="person" size={14} color={theme.color.brandPrimary} />
          <Text style={styles.contactStripTxt}>Apri scheda cliente: {contactName}</Text>
          <Ionicons name="chevron-forward" size={14} color={theme.color.muted} />
        </Pressable>
      ) : null}

      {loading || !detail ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={theme.color.brandPrimary} />
      ) : (
        <KeyboardAwareScrollView
          bottomOffset={20}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 20 + insets.bottom + (Platform.OS === "web" ? 60 : 0) }}
          ref={scrollRef as any}
        >
          {/* Primo messaggio = "body" originale */}
          <MessageBubble
            role={user?.user_id === detail.created_by ? "self" : "other"}
            author={detail.created_by_name || "Collaboratore"}
            text={detail.body}
            at={detail.created_at}
            isOriginal
          />
          {(detail.messages || []).map((m, i) => (
            <MessageBubble
              key={i}
              role={m.author_id === user?.user_id ? "self" : "other"}
              author={m.author_name || (m.author_role === "master" ? "Master" : "Collaboratore")}
              text={m.text}
              at={m.at}
            />
          ))}
        </KeyboardAwareScrollView>
      )}

      <View style={[styles.inputBar, { paddingBottom: 8 + (Platform.OS === "web" ? 60 : insets.bottom) }]}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Scrivi una risposta…"
          placeholderTextColor="#94A3B8"
          style={styles.input}
          multiline
          maxLength={4000}
          testID="ireqchat-input"
        />
        <Pressable onPress={send} disabled={sending || !text.trim()} style={[styles.sendBtn, (sending || !text.trim()) && { opacity: 0.5 }]} testID="ireqchat-send">
          {sending ? <ActivityIndicator color="#FFF" /> : <Ionicons name="send" size={18} color="#FFF" />}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function MessageBubble({ role, author, text, at, isOriginal }: { role: "self" | "other"; author: string; text: string; at: string; isOriginal?: boolean }) {
  return (
    <View style={[styles.bubbleRow, role === "self" ? { justifyContent: "flex-end" } : { justifyContent: "flex-start" }]}>
      <View style={[styles.bubble, role === "self" ? styles.bubbleSelf : styles.bubbleOther, isOriginal && styles.bubbleOriginal]}>
        {isOriginal ? <Text style={styles.bubbleTag}>MESSAGGIO INIZIALE</Text> : null}
        {role === "other" ? <Text style={styles.bubbleAuthor}>{author}</Text> : null}
        <Text style={[styles.bubbleText, role === "self" && { color: "#FFF" }]}>{text}</Text>
        <Text style={[styles.bubbleTime, role === "self" && { color: "#E2E8F0" }]}>{formatTime(at)}</Text>
      </View>
    </View>
  );
}

function formatTime(iso: string): string {
  try { return new Date(iso).toLocaleString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); }
  catch { return iso; }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.color.border, backgroundColor: "#FFF" },
  title: { fontSize: 15, fontWeight: "800", color: theme.color.onSurface },
  subtitle: { fontSize: 11, color: theme.color.muted, marginTop: 2 },
  statusBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  pillPending: { backgroundColor: "#FEF3C7" },
  pillResolved: { backgroundColor: "#DCFCE7" },
  statusTxt: { fontSize: 10, fontWeight: "800", color: theme.color.onSurface, textTransform: "uppercase", letterSpacing: 0.4 },
  contactStrip: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: theme.color.brandPrimary + "10", borderBottomWidth: 1, borderBottomColor: theme.color.border },
  contactStripTxt: { flex: 1, fontSize: 12, fontWeight: "700", color: theme.color.brandPrimary },
  bubbleRow: { flexDirection: "row" },
  bubble: { maxWidth: "80%", padding: 10, borderRadius: 14 },
  bubbleSelf: { backgroundColor: theme.color.brandPrimary, borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: "#FFF", borderWidth: 1, borderColor: theme.color.border, borderBottomLeftRadius: 4 },
  bubbleOriginal: { borderWidth: 1, borderColor: "#F59E0B" },
  bubbleTag: { fontSize: 9, fontWeight: "900", color: "#B45309", marginBottom: 4, letterSpacing: 0.6 },
  bubbleAuthor: { fontSize: 11, fontWeight: "800", color: theme.color.brandPrimary, marginBottom: 2 },
  bubbleText: { fontSize: 14, color: theme.color.onSurface, lineHeight: 19 },
  bubbleTime: { fontSize: 10, color: theme.color.muted, marginTop: 4, textAlign: "right" },
  inputBar: { flexDirection: "row", alignItems: "flex-end", gap: 8, padding: 10, borderTopWidth: 1, borderTopColor: theme.color.border, backgroundColor: "#FFF" },
  input: { flex: 1, minHeight: 40, maxHeight: 120, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: "#F1F5F9", borderRadius: 20, fontSize: 14, color: theme.color.onSurface },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.color.brandPrimary, alignItems: "center", justifyContent: "center" },
});

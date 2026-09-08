// V50.z101 — Sezione Recensioni cliente per la scheda contatto.
// PROMPT 24: sondaggio qualità post-conversione.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Modal,
  TextInput,
  ActivityIndicator,
  Linking,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";

type Channel = "whatsapp" | "email" | "sms" | "telegram";

type ReviewRequest = {
  req_id: string;
  contact_id: string;
  contact_name: string;
  contact_phone?: string;
  contact_email?: string;
  contact_telegram?: string;
  channel: Channel;
  scheduled_at: string;
  custom_message: string;
  form_url: string;
  status: "pending" | "ready_to_send" | "sent" | "responded" | "cancelled";
  created_at: string;
  sent_at?: string | null;
  responded_at?: string | null;
};

type Review = {
  review_id: string;
  req_id: string;
  contact_id: string;
  contact_name: string;
  rating: number;
  text: string;
  consent_publish: boolean;
  submitted_at: string;
  approved: boolean | null;
  approved_at?: string | null;
};

const CHANNEL_META: Record<Channel, { label: string; icon: any; color: string }> = {
  whatsapp: { label: "WhatsApp", icon: "logo-whatsapp", color: "#25D366" },
  email:    { label: "Email",    icon: "mail",           color: "#DC2626" },
  sms:      { label: "SMS",      icon: "chatbubble",     color: "#2563EB" },
  telegram: { label: "Telegram", icon: "paper-plane",    color: "#0088CC" },
};

const STATUS_META: Record<ReviewRequest["status"], { label: string; color: string }> = {
  pending:        { label: "In attesa (programmata)", color: theme.color.muted },
  ready_to_send:  { label: "Pronta da inviare",       color: "#EA580C" },
  sent:           { label: "Inviata",                 color: "#2563EB" },
  responded:      { label: "Risposta ricevuta ✓",     color: theme.color.success },
  cancelled:      { label: "Cancellata",              color: "#94A3B8" },
};

function fmtIt(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString("it-IT", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

function toLocalISOForInput(d: Date): string {
  // YYYY-MM-DDTHH:mm (per <input type="datetime-local"> nel web)
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

type Props = {
  contactId: string;
  contactName: string;
  contactPhone?: string;
  contactWhatsapp?: string;
  contactEmail?: string;
  contactTelegram?: string;
  autoOpenNew?: boolean;   // Se true, apre subito il modal "Nuova richiesta"
  onAutoOpenHandled?: () => void;
};

export function ContactReviewsSection({
  contactId,
  contactName,
  contactPhone,
  contactWhatsapp,
  contactEmail,
  contactTelegram,
  autoOpenNew,
  onAutoOpenHandled,
}: Props) {
  const [requests, setRequests] = useState<ReviewRequest[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const router = useRouter();

  // New request form
  const [channel, setChannel] = useState<Channel>("whatsapp");
  const [scheduledLocal, setScheduledLocal] = useState<string>(() => {
    // Default: fra 7 giorni alle 10:00
    const d = new Date();
    d.setDate(d.getDate() + 7);
    d.setHours(10, 0, 0, 0);
    return toLocalISOForInput(d);
  });
  const [customMsg, setCustomMsg] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [reqR, revR] = await Promise.all([
        api<{ items: ReviewRequest[] }>(`/contacts/${contactId}/review-requests`),
        api<{ items: Review[] }>(`/contacts/${contactId}/reviews`),
      ]);
      setRequests(reqR?.items || []);
      setReviews(revR?.items || []);
    } catch (e: any) {
      // silent
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (autoOpenNew) {
      setShowNew(true);
      onAutoOpenHandled?.();
    }
  }, [autoOpenNew, onAutoOpenHandled]);

  const createRequest = async (sendImmediately: boolean) => {
    if (!scheduledLocal && !sendImmediately) {
      notify("Data richiesta", "Seleziona quando inviare la richiesta");
      return;
    }
    setSaving(true);
    try {
      // Converti local datetime → ISO UTC
      let iso = new Date().toISOString();
      if (!sendImmediately) {
        const d = new Date(scheduledLocal);
        if (isNaN(d.getTime())) {
          notify("Data non valida", "Formato data non riconosciuto");
          setSaving(false);
          return;
        }
        iso = d.toISOString();
      }
      await api(`/contacts/${contactId}/review-request`, {
        method: "POST",
        body: {
          channel,
          scheduled_at: iso,
          custom_message: customMsg || null,
          send_immediately: sendImmediately,
        },
      });
      setShowNew(false);
      setCustomMsg("");
      notify(
        "Richiesta creata",
        sendImmediately
          ? "Richiesta pronta: usa il pulsante di invio nella lista."
          : "Programmata correttamente."
      );
      await load();
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile creare la richiesta");
    } finally {
      setSaving(false);
    }
  };

  const cancelRequest = async (reqId: string) => {
    try {
      await api(`/review-requests/${reqId}`, { method: "DELETE" });
      await load();
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile cancellare");
    }
  };

  const sendViaDeepLink = async (r: ReviewRequest) => {
    const msg = r.custom_message || `Ciao ${r.contact_name}! 👉 ${r.form_url}`;
    let url = "";
    if (r.channel === "whatsapp") {
      const phone = (contactWhatsapp || contactPhone || r.contact_phone || "").replace(/[^0-9]/g, "");
      if (!phone) {
        notify("Numero mancante", "Aggiungi un numero WhatsApp/telefono al contatto");
        return;
      }
      url = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
    } else if (r.channel === "sms") {
      const phone = (contactPhone || r.contact_phone || "").replace(/[^0-9+]/g, "");
      if (!phone) {
        notify("Numero mancante", "Aggiungi un numero di telefono al contatto");
        return;
      }
      // iOS uses ?body=, Android uses ?body= too (works on most modern devices)
      url = `sms:${phone}${Platform.OS === "ios" ? "&" : "?"}body=${encodeURIComponent(msg)}`;
    } else if (r.channel === "telegram") {
      const handle = (contactTelegram || r.contact_telegram || "").replace(/^@/, "").trim();
      if (handle) {
        url = `https://t.me/${handle}?text=${encodeURIComponent(msg)}`;
      } else {
        // Se manca handle → apri share url generico Telegram
        url = `https://t.me/share/url?url=${encodeURIComponent(r.form_url)}&text=${encodeURIComponent(msg)}`;
      }
    } else if (r.channel === "email") {
      const to = (contactEmail || r.contact_email || "").trim();
      if (!to) {
        notify("Email mancante", "Aggiungi un'email al contatto");
        return;
      }
      url = `mailto:${to}?subject=${encodeURIComponent("Un secondo per una recensione?")}&body=${encodeURIComponent(msg)}`;
    }
    try {
      await Linking.openURL(url);
      // Marca come inviata
      await api(`/review-requests/${r.req_id}/mark-sent`, { method: "POST" });
      await load();
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile aprire l'app di invio");
    }
  };

  const copyFormLink = async (formUrl: string) => {
    try {
      await Clipboard.setStringAsync(formUrl);
      notify("Copiato", "Link del form copiato negli appunti");
    } catch { }
  };

  const approveReview = async (reviewId: string, approved: boolean) => {
    try {
      await api(`/reviews/${reviewId}/approve`, { method: "PATCH", body: { approved } });
      await load();
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile aggiornare");
    }
  };

  const deleteReview = async (reviewId: string) => {
    try {
      await api(`/reviews/${reviewId}`, { method: "DELETE" });
      await load();
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile eliminare");
    }
  };

  const openPublicPage = async () => {
    try {
      const r = await api<{ public_url: string; slug: string }>("/reviews/public-link", { method: "POST", body: {} });
      if (r?.public_url) {
        await Clipboard.setStringAsync(r.public_url);
        notify("Link pubblico", "Copiato negli appunti — condividilo per far vedere le tue recensioni.");
      }
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile generare il link");
    }
  };

  const avg = useMemo(() => {
    const approved = reviews.filter(r => r.approved === true);
    if (!approved.length) return null;
    return (approved.reduce((s, r) => s + (r.rating || 0), 0) / approved.length).toFixed(1);
  }, [reviews]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface }}>
      <ScrollView contentContainerStyle={styles.container}>
        {/* Header */}
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.h1}>Recensioni cliente</Text>
            <Text style={styles.h1Sub}>
              {reviews.length} risposte · {avg ? `media ${avg}★` : "nessuna approvata"}
            </Text>
          </View>
          <Pressable style={[styles.btnPrimary]} onPress={() => setShowNew(true)} testID="btn-new-review-request">
            <Ionicons name="add-circle" size={18} color="#FFF" />
            <Text style={styles.btnPrimaryTxt}>Richiedi recensione</Text>
          </Pressable>
        </View>

        <Pressable style={styles.publicLinkBtn} onPress={openPublicPage} testID="btn-public-reviews-link">
          <Ionicons name="link" size={16} color={theme.color.brandPrimary} />
          <Text style={styles.publicLinkTxt}>Copia link pagina pubblica recensioni</Text>
        </Pressable>

        <Pressable
          style={[styles.publicLinkBtn, { backgroundColor: "#F59E0B15", marginTop: 6 }]}
          onPress={() => router.push("/reviews-analytics" as any)}
          testID="btn-open-analytics"
        >
          <Ionicons name="stats-chart" size={16} color="#F59E0B" />
          <Text style={[styles.publicLinkTxt, { color: "#F59E0B" }]}>Dashboard analytics recensioni</Text>
        </Pressable>

        {loading ? (
          <View style={{ paddingVertical: 24 }}><ActivityIndicator color={theme.color.brandPrimary} /></View>
        ) : null}

        {/* Richieste */}
        <Text style={styles.section}>Richieste inviate ({requests.length})</Text>
        {requests.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="mail-open-outline" size={36} color={theme.color.muted} />
            <Text style={styles.emptyTxt}>Nessuna richiesta inviata. Programmane una con il pulsante in alto.</Text>
          </View>
        ) : requests.map((r) => {
          const chMeta = CHANNEL_META[r.channel];
          const stMeta = STATUS_META[r.status];
          const isSendable = r.status === "pending" || r.status === "ready_to_send";
          return (
            <View key={r.req_id} style={styles.card} testID={`review-req-${r.req_id}`}>
              <View style={styles.cardHead}>
                <View style={[styles.chMini, { backgroundColor: chMeta.color + "22" }]}>
                  <Ionicons name={chMeta.icon} size={14} color={chMeta.color} />
                  <Text style={[styles.chMiniTxt, { color: chMeta.color }]}>{chMeta.label}</Text>
                </View>
                <Text style={[styles.stMiniTxt, { color: stMeta.color }]}>{stMeta.label}</Text>
              </View>
              <Text style={styles.cardDate}>
                📅 {fmtIt(r.scheduled_at)}
                {r.sent_at ? ` · inviata ${fmtIt(r.sent_at)}` : ""}
              </Text>
              {r.custom_message ? (
                <Text style={styles.cardMsg} numberOfLines={4}>{r.custom_message}</Text>
              ) : null}
              <View style={styles.cardActions}>
                {isSendable && r.channel !== "email" ? (
                  <Pressable
                    style={[styles.actionBtn, { backgroundColor: chMeta.color }]}
                    onPress={() => sendViaDeepLink(r)}
                    testID={`send-review-${r.req_id}`}
                  >
                    <Ionicons name={chMeta.icon} size={14} color="#FFF" />
                    <Text style={styles.actionBtnTxt}>Invia ora</Text>
                  </Pressable>
                ) : null}
                {isSendable && r.channel === "email" ? (
                  <Pressable
                    style={[styles.actionBtn, { backgroundColor: chMeta.color }]}
                    onPress={() => sendViaDeepLink(r)}
                    testID={`send-review-email-${r.req_id}`}
                  >
                    <Ionicons name="mail" size={14} color="#FFF" />
                    <Text style={styles.actionBtnTxt}>Apri mail</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  style={[styles.actionBtn, styles.actionBtnGhost]}
                  onPress={() => copyFormLink(r.form_url)}
                  testID={`copy-form-${r.req_id}`}
                >
                  <Ionicons name="copy" size={14} color={theme.color.brandPrimary} />
                  <Text style={[styles.actionBtnTxt, { color: theme.color.brandPrimary }]}>Copia link form</Text>
                </Pressable>
                {r.status !== "cancelled" && r.status !== "responded" ? (
                  <Pressable
                    style={[styles.actionBtn, styles.actionBtnGhost]}
                    onPress={() => cancelRequest(r.req_id)}
                    testID={`cancel-review-${r.req_id}`}
                  >
                    <Ionicons name="close-circle" size={14} color="#DC2626" />
                    <Text style={[styles.actionBtnTxt, { color: "#DC2626" }]}>Annulla</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          );
        })}

        {/* Recensioni ricevute */}
        <Text style={[styles.section, { marginTop: 24 }]}>Recensioni ricevute ({reviews.length})</Text>
        {reviews.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="star-outline" size={36} color={theme.color.muted} />
            <Text style={styles.emptyTxt}>Nessuna risposta ancora. Le recensioni compaiono qui dopo l&apos;invio del cliente.</Text>
          </View>
        ) : reviews.map((rv) => (
          <View key={rv.review_id} style={styles.card} testID={`review-${rv.review_id}`}>
            <View style={styles.cardHead}>
              <View style={{ flexDirection: "row" }}>
                {[1, 2, 3, 4, 5].map((s) => (
                  <Ionicons
                    key={s}
                    name={s <= rv.rating ? "star" : "star-outline"}
                    size={18}
                    color="#F59E0B"
                  />
                ))}
              </View>
              {rv.approved === true ? (
                <Text style={[styles.stMiniTxt, { color: theme.color.success }]}>Approvata ✓</Text>
              ) : rv.approved === false ? (
                <Text style={[styles.stMiniTxt, { color: "#DC2626" }]}>Respinta</Text>
              ) : (
                <Text style={[styles.stMiniTxt, { color: "#EA580C" }]}>In attesa di approvazione</Text>
              )}
            </View>
            <Text style={styles.cardDate}>{fmtIt(rv.submitted_at)}</Text>
            {rv.text ? <Text style={styles.reviewTxt}>“{rv.text}”</Text> : <Text style={styles.reviewTxtEmpty}>(nessun commento testuale)</Text>}
            <View style={styles.consentBox}>
              <Ionicons
                name={rv.consent_publish ? "checkmark-circle" : "close-circle"}
                size={14}
                color={rv.consent_publish ? theme.color.success : theme.color.muted}
              />
              <Text style={styles.consentTxt}>
                {rv.consent_publish ? "Consenso alla pubblicazione dato" : "Consenso NON dato (solo interno)"}
              </Text>
            </View>
            <View style={styles.cardActions}>
              {rv.approved !== true ? (
                <Pressable
                  style={[styles.actionBtn, { backgroundColor: theme.color.success }]}
                  onPress={() => approveReview(rv.review_id, true)}
                  testID={`approve-review-${rv.review_id}`}
                >
                  <Ionicons name="checkmark" size={14} color="#FFF" />
                  <Text style={styles.actionBtnTxt}>Approva</Text>
                </Pressable>
              ) : null}
              {rv.approved !== false ? (
                <Pressable
                  style={[styles.actionBtn, styles.actionBtnGhost]}
                  onPress={() => approveReview(rv.review_id, false)}
                  testID={`reject-review-${rv.review_id}`}
                >
                  <Ionicons name="close" size={14} color="#DC2626" />
                  <Text style={[styles.actionBtnTxt, { color: "#DC2626" }]}>Rifiuta</Text>
                </Pressable>
              ) : null}
              <Pressable
                style={[styles.actionBtn, styles.actionBtnGhost]}
                onPress={() => deleteReview(rv.review_id)}
                testID={`delete-review-${rv.review_id}`}
              >
                <Ionicons name="trash" size={14} color="#DC2626" />
                <Text style={[styles.actionBtnTxt, { color: "#DC2626" }]}>Elimina</Text>
              </Pressable>
            </View>
          </View>
        ))}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Modal nuova richiesta */}
      <Modal visible={showNew} transparent animationType="slide" onRequestClose={() => setShowNew(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Programma richiesta recensione</Text>
              <Pressable onPress={() => setShowNew(false)} testID="btn-close-new-review">
                <Ionicons name="close" size={22} color={theme.color.onSurface} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ padding: 16 }}>
              <Text style={styles.lbl}>Cliente</Text>
              <Text style={styles.lblVal}>{contactName}</Text>

              <Text style={[styles.lbl, { marginTop: 14 }]}>Canale di invio</Text>
              <View style={styles.chRow}>
                {(["whatsapp","email","sms","telegram"] as Channel[]).map(k => {
                  const m = CHANNEL_META[k];
                  const active = channel === k;
                  return (
                    <Pressable
                      key={k}
                      onPress={() => setChannel(k)}
                      style={[styles.chBtn, active && { borderColor: m.color, backgroundColor: m.color + "18" }]}
                      testID={`ch-${k}`}
                    >
                      <Ionicons name={m.icon} size={18} color={m.color} />
                      <Text style={[styles.chBtnTxt, active && { color: m.color, fontWeight: "700" }]}>{m.label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={[styles.lbl, { marginTop: 14 }]}>Data e ora invio</Text>
              {Platform.OS === "web" ? (
                <TextInput
                  value={scheduledLocal}
                  onChangeText={setScheduledLocal}
                  style={styles.dateInput}
                  // @ts-ignore
                  type="datetime-local"
                  testID="review-scheduled-at"
                />
              ) : (
                <TextInput
                  value={scheduledLocal}
                  onChangeText={setScheduledLocal}
                  placeholder="YYYY-MM-DDTHH:mm"
                  style={styles.dateInput}
                  testID="review-scheduled-at"
                />
              )}
              <Text style={styles.hint}>ℹ️ Formato: {toLocalISOForInput(new Date())} (ora locale)</Text>

              <Text style={[styles.lbl, { marginTop: 14 }]}>Messaggio personalizzato (opzionale)</Text>
              <TextInput
                value={customMsg}
                onChangeText={setCustomMsg}
                multiline
                numberOfLines={5}
                placeholder="Lascia vuoto per usare il messaggio predefinito"
                style={styles.msgInput}
                testID="review-custom-msg"
              />
              <Text style={styles.hint}>Il link del form recensione verrà aggiunto automaticamente in fondo se manca.</Text>

              <View style={{ height: 20 }} />

              <Pressable
                style={[styles.btnPrimary, saving && { opacity: 0.6 }]}
                disabled={saving}
                onPress={() => createRequest(false)}
                testID="btn-schedule-review"
              >
                <Ionicons name="calendar" size={18} color="#FFF" />
                <Text style={styles.btnPrimaryTxt}>Programma per la data indicata</Text>
              </Pressable>

              <Pressable
                style={[styles.btnGhost, saving && { opacity: 0.6 }]}
                disabled={saving}
                onPress={() => createRequest(true)}
                testID="btn-send-now-review"
              >
                <Ionicons name="send" size={18} color={theme.color.brandPrimary} />
                <Text style={styles.btnGhostTxt}>Prepara e invia adesso</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 60 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 6 },
  h1: { fontSize: 18, fontWeight: "800", color: theme.color.onSurface },
  h1Sub: { fontSize: 12, color: theme.color.muted, marginTop: 2 },
  btnPrimary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: theme.color.brandPrimary,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
  },
  btnPrimaryTxt: { color: "#FFF", fontWeight: "700", fontSize: 13 },
  btnGhost: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.color.brandPrimary,
    marginTop: 10,
  },
  btnGhostTxt: { color: theme.color.brandPrimary, fontWeight: "700" },
  publicLinkBtn: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: theme.color.brandPrimary + "10",
    borderRadius: 8,
    marginTop: 12,
    marginBottom: 4,
  },
  publicLinkTxt: { color: theme.color.brandPrimary, fontWeight: "600", fontSize: 13 },
  section: { fontSize: 14, fontWeight: "800", color: theme.color.onSurface, marginTop: 16, marginBottom: 8 },
  empty: {
    alignItems: "center",
    padding: 22,
    borderRadius: 12,
    backgroundColor: theme.color.surfaceTertiary,
  },
  emptyTxt: { color: theme.color.muted, fontSize: 13, textAlign: "center", marginTop: 8 },
  card: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: theme.color.surfaceSecondary,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  cardHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  chMini: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  chMiniTxt: { fontSize: 11, fontWeight: "700" },
  stMiniTxt: { fontSize: 12, fontWeight: "700" },
  cardDate: { color: theme.color.muted, fontSize: 12, marginBottom: 6 },
  cardMsg: { color: theme.color.onSurface, fontSize: 13, marginTop: 4, lineHeight: 18 },
  cardActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8 },
  actionBtnGhost: { backgroundColor: "transparent", borderWidth: 1, borderColor: theme.color.border },
  actionBtnTxt: { color: "#FFF", fontWeight: "700", fontSize: 12 },
  reviewTxt: { color: theme.color.onSurface, fontSize: 14, fontStyle: "italic", lineHeight: 20, marginTop: 4 },
  reviewTxtEmpty: { color: theme.color.muted, fontSize: 12, marginTop: 4 },
  consentBox: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, paddingVertical: 6 },
  consentTxt: { color: theme.color.muted, fontSize: 12 },
  // Modal
  backdrop: { flex: 1, backgroundColor: "rgba(15,15,25,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: theme.color.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: "90%" },
  sheetHead: { flexDirection: "row", alignItems: "center", padding: 16, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  sheetTitle: { flex: 1, fontSize: 16, fontWeight: "800", color: theme.color.onSurface },
  lbl: { fontSize: 12, fontWeight: "700", color: theme.color.muted, marginBottom: 4 },
  lblVal: { fontSize: 15, fontWeight: "700", color: theme.color.onSurface },
  chRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.color.border,
    backgroundColor: theme.color.surfaceSecondary,
  },
  chBtnTxt: { color: theme.color.onSurface, fontSize: 13 },
  dateInput: {
    borderWidth: 1, borderColor: theme.color.border, borderRadius: 10,
    padding: 12, color: theme.color.onSurface, backgroundColor: theme.color.surfaceSecondary,
    fontSize: 14,
  },
  msgInput: {
    borderWidth: 1, borderColor: theme.color.border, borderRadius: 10,
    padding: 12, color: theme.color.onSurface, backgroundColor: theme.color.surfaceSecondary,
    fontSize: 14, minHeight: 100, textAlignVertical: "top",
  },
  hint: { fontSize: 11, color: theme.color.muted, marginTop: 4 },
});

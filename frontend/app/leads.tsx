// V50.z103 — Pagina master: gestione lead pubblici + risposte AxonOS.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Modal,
  TextInput,
  Linking,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

type Lead = {
  lead_id: string;
  full_name: string;
  email?: string | null;
  phone?: string | null;
  company?: string | null; // V50.z314 — richiesta demo dalla landing
  source?: string | null;  // "landing_demo" | undefined (form pubblico)
  needs: string[];
  free_text: string;
  created_at: string;
  status: "new" | "analyzed" | "approved" | "replied" | "archived";
  axon_reply_text?: string | null;
  axon_generated_at?: string | null;
  master_reply_text?: string | null;
  master_reply_channel?: string | null;
  master_replied_at?: string | null;
};

type NeedItem = { id: string; label: string; emoji: string };

const DEFAULT_NEED_META: Record<string, { label: string; emoji: string }> = {
  luce: { label: "Luce", emoji: "💡" },
  gas: { label: "Gas", emoji: "🔥" },
  fibra: { label: "Fibra", emoji: "📶" },
  fotovoltaico: { label: "Fotovoltaico", emoji: "☀️" },
  networker: { label: "Networker", emoji: "🤝" },
};

const STATUS_META: Record<Lead["status"], { label: string; color: string; icon: any }> = {
  new: { label: "Nuovo", color: "#EA580C", icon: "sparkles" },
  analyzed: { label: "Analizzato", color: "#8B5CF6", icon: "flash" },
  approved: { label: "Approvato", color: HT.success, icon: "checkmark-circle" },
  replied: { label: "Risposto", color: HT.axon, icon: "send" },
  archived: { label: "Archiviato", color: HT.muted, icon: "archive" },
};

const CHANNEL_META: Record<string, { label: string; icon: any; color: string }> = {
  whatsapp: { label: "WhatsApp", icon: "logo-whatsapp", color: "#25D366" },
  email:    { label: "Email",    icon: "mail",           color: "#DC2626" },
  sms:      { label: "SMS",      icon: "chatbubble",     color: "#2563EB" },
  telegram: { label: "Telegram", icon: "paper-plane",    color: "#0088CC" },
};

function fmt(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString("it-IT", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}

export default function LeadsPage() {
  const router = useRouter();
  const [items, setItems] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<"all" | Lead["status"]>("all");
  const [detail, setDetail] = useState<Lead | null>(null);
  const [editText, setEditText] = useState<string>("");
  const [regenerating, setRegenerating] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [publicUrl, setPublicUrl] = useState("");

  // V50.z103.b — Config esigenze modificabili
  const [needsList, setNeedsList] = useState<NeedItem[]>([]);
  const [needsDefault, setNeedsDefault] = useState(true);
  const [showNeedsCfg, setShowNeedsCfg] = useState(false);
  const [editNeeds, setEditNeeds] = useState<NeedItem[]>([]);
  const [savingCfg, setSavingCfg] = useState(false);
  const NEED_META = useMemo<Record<string, { label: string; emoji: string }>>(() => {
    const map: Record<string, { label: string; emoji: string }> = { ...DEFAULT_NEED_META };
    for (const n of needsList) map[n.id] = { label: n.label, emoji: n.emoji };
    return map;
  }, [needsList]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api<{ items: Lead[] }>(`/leads?status=${filter}`);
      setItems(r?.items || []);
    } catch {} finally {
      setLoading(false);
    }
  }, [filter]);

  const loadNeedsConfig = useCallback(async () => {
    try {
      const r = await api<{ needs: NeedItem[]; is_default: boolean }>(`/leads/needs-config`);
      setNeedsList(r?.needs || []);
      setNeedsDefault(!!r?.is_default);
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadNeedsConfig(); }, [loadNeedsConfig]);

  const openNeedsCfg = async () => {
    setShowNeedsCfg(true);
    // Pre-populate immediatamente con quello che ho, poi refresh dal server
    setEditNeeds(needsList.map(n => ({ ...n })));
    try {
      const r = await api<{ needs: NeedItem[]; is_default: boolean }>(`/leads/needs-config`);
      const fresh = r?.needs || [];
      setNeedsList(fresh);
      setNeedsDefault(!!r?.is_default);
      setEditNeeds(fresh.map(n => ({ ...n })));
    } catch {
      // silent — user vede la snapshot locale
    }
  };

  const slugify = (s: string): string =>
    s.toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || `n${Date.now().toString(36).slice(-4)}`;

  const addNeed = () => {
    if (editNeeds.length >= 12) {
      notify("Massimo 12", "Non puoi aggiungere altre esigenze");
      return;
    }
    setEditNeeds([...editNeeds, { id: `nuova-${editNeeds.length + 1}`, label: "Nuova esigenza", emoji: "✨" }]);
  };

  const removeNeed = (idx: number) => {
    setEditNeeds(editNeeds.filter((_, i) => i !== idx));
  };

  const updateNeed = (idx: number, patch: Partial<NeedItem>) => {
    setEditNeeds(editNeeds.map((n, i) => i === idx ? { ...n, ...patch } : n));
  };

  const saveNeeds = async () => {
    // Auto-slugify label -> id se l'id sembra default
    const clean = editNeeds.map(n => {
      let id = (n.id || "").trim();
      if (!id || /^nuova-\d+$/.test(id)) id = slugify(n.label || "esigenza");
      else id = slugify(id);
      return { id, label: (n.label || "").trim(), emoji: (n.emoji || "").trim() || "•" };
    }).filter(n => n.label);
    if (clean.length === 0) {
      notify("Nessuna esigenza", "Aggiungi almeno una voce");
      return;
    }
    // Check duplicati
    const ids = new Set<string>();
    for (const n of clean) {
      if (ids.has(n.id)) { notify("ID duplicato", `Rinomina '${n.label}' (id già usato)`); return; }
      ids.add(n.id);
    }
    setSavingCfg(true);
    try {
      await api(`/leads/needs-config`, { method: "PUT", body: { needs: clean } });
      notify("Salvato", "Esigenze aggiornate");
      setShowNeedsCfg(false);
      await loadNeedsConfig();
    } catch (e: any) {
      notify("Errore", e?.message || "");
    } finally {
      setSavingCfg(false);
    }
  };

  const resetNeeds = async () => {
    setSavingCfg(true);
    try {
      await api(`/leads/needs-config/reset`, { method: "POST" });
      await loadNeedsConfig();
      setShowNeedsCfg(false);
      notify("Ripristinato", "Esigenze default ripristinate");
    } catch (e: any) {
      notify("Errore", e?.message || "");
    } finally {
      setSavingCfg(false);
    }
  };

  const openDetail = async (lead: Lead) => {
    // fetch fresh in case status changed
    try {
      const fresh = await api<Lead>(`/leads/${lead.lead_id}`);
      setDetail(fresh);
      setEditText(fresh.axon_reply_text || "");
    } catch {
      setDetail(lead);
      setEditText(lead.axon_reply_text || "");
    }
  };

  const regenerate = async (style: "friendly" | "professional" | "short") => {
    if (!detail) return;
    setRegenerating(true);
    try {
      const r = await api<{ axon_reply_text: string }>(`/leads/${detail.lead_id}/regenerate-axon`, {
        method: "POST", body: { style },
      });
      setEditText(r.axon_reply_text);
      setDetail({ ...detail, axon_reply_text: r.axon_reply_text, status: "analyzed" });
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile rigenerare");
    } finally {
      setRegenerating(false);
    }
  };

  const saveEdit = async () => {
    if (!detail) return;
    setSavingEdit(true);
    try {
      await api(`/leads/${detail.lead_id}/axon-reply`, {
        method: "PATCH", body: { axon_reply_text: editText },
      });
      setDetail({ ...detail, axon_reply_text: editText });
      notify("Salvato", "Bozza aggiornata");
    } catch (e: any) {
      notify("Errore", e?.message || "");
    } finally {
      setSavingEdit(false);
    }
  };

  const approve = async () => {
    if (!detail) return;
    try {
      await api(`/leads/${detail.lead_id}/approve`, { method: "PATCH" });
      setDetail({ ...detail, status: "approved" });
      load();
      notify("Approvata", "Ora puoi inviare la risposta al lead");
    } catch (e: any) {
      notify("Errore", e?.message || "");
    }
  };

  const sendReply = async (channel: "email" | "whatsapp" | "sms" | "telegram") => {
    if (!detail) return;
    const text = editText || detail.axon_reply_text || "";
    if (!text) { notify("Testo mancante", "Genera prima una risposta"); return; }

    // Per email → SMTP diretto lato server. Per altri → deep-link + registra invio.
    try {
      const r = await api<{ ok: boolean; sent_via_backend: boolean }>(
        `/leads/${detail.lead_id}/reply`,
        { method: "POST", body: { channel, text } }
      );
      if (channel === "email" && r.sent_via_backend) {
        notify("Email inviata", "Il lead ha ricevuto la risposta");
      } else if (channel !== "email") {
        // Apri deep-link
        let url = "";
        if (channel === "whatsapp") {
          const phone = (detail.phone || "").replace(/[^0-9]/g, "");
          if (!phone) { notify("Manca telefono", "Il lead non ha telefono"); return; }
          url = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
        } else if (channel === "sms") {
          const phone = (detail.phone || "").replace(/[^0-9+]/g, "");
          if (!phone) { notify("Manca telefono", "Il lead non ha telefono"); return; }
          url = `sms:${phone}${Platform.OS === "ios" ? "&" : "?"}body=${encodeURIComponent(text)}`;
        } else if (channel === "telegram") {
          url = `https://t.me/share/url?url=${encodeURIComponent("")}&text=${encodeURIComponent(text)}`;
        }
        if (url) await Linking.openURL(url);
      } else if (channel === "email" && !r.sent_via_backend) {
        // SMTP non configurato → mailto: fallback
        if (detail.email) {
          const url = `mailto:${detail.email}?subject=${encodeURIComponent("Risposta alla tua richiesta")}&body=${encodeURIComponent(text)}`;
          await Linking.openURL(url);
        }
      }
      setDetail({ ...detail, status: "replied", master_reply_channel: channel });
      load();
    } catch (e: any) {
      notify("Errore", e?.message || "");
    }
  };

  const remove = async () => {
    if (!detail) return;
    try {
      await api(`/leads/${detail.lead_id}`, { method: "DELETE" });
      setDetail(null);
      load();
    } catch (e: any) {
      notify("Errore", e?.message || "");
    }
  };

  const copyPublicLink = async () => {
    try {
      const r = await api<{ public_url: string }>("/leads/public-link", { method: "POST", body: {} });
      if (r?.public_url) {
        setPublicUrl(r.public_url);
        await Clipboard.setStringAsync(r.public_url);
        notify("Link copiato", "Condividilo per raccogliere lead");
      }
    } catch (e: any) {
      notify("Errore", e?.message || "");
    }
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length, new: 0, analyzed: 0, approved: 0, replied: 0, archived: 0 };
    for (const l of items) c[l.status] = (c[l.status] || 0) + 1;
    return c;
  }, [items]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="leads-back">
          <Ionicons name="chevron-back" size={24} color={HT.text} />
        </Pressable>
        <Text style={styles.title}>Richieste Info</Text>
        <Pressable onPress={openNeedsCfg} style={styles.iconBtn} testID="leads-config-needs">
          <Ionicons name="options" size={22} color={HT.brand} />
        </Pressable>
        <Pressable onPress={copyPublicLink} style={styles.iconBtn} testID="leads-copy-link">
          <Ionicons name="share-social" size={22} color={HT.brand} />
        </Pressable>
      </View>

      {publicUrl ? (
        <View style={styles.linkBar}>
          <Ionicons name="link" size={14} color={HT.brand} />
          <Text style={styles.linkTxt} numberOfLines={1}>{publicUrl}</Text>
        </View>
      ) : null}

      {/* Filter tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {(["all", "new", "analyzed", "approved", "replied", "archived"] as const).map((s) => {
          const label = s === "all" ? "Tutti" : STATUS_META[s as Lead["status"]]?.label || s;
          const active = filter === s;
          return (
            <Pressable
              key={s}
              onPress={() => setFilter(s)}
              style={[styles.filterChip, active && styles.filterChipActive]}
              testID={`filter-${s}`}
            >
              <Text style={[styles.filterTxt, active && styles.filterTxtActive]}>{label}</Text>
              {counts[s] ? <Text style={[styles.filterCount, active && { color: "#FFF" }]}>{counts[s]}</Text> : null}
            </Pressable>
          );
        })}
      </ScrollView>

      {loading ? (
        <View style={styles.centered}><ActivityIndicator size="large" color={HT.brand} /></View>
      ) : items.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="mail-open-outline" size={48} color={HT.muted} />
          <Text style={styles.emptyTxt}>Nessuna richiesta al momento.</Text>
          <Pressable style={styles.emptyBtn} onPress={copyPublicLink}>
            <Ionicons name="share-social" size={16} color="#FFF" />
            <Text style={styles.emptyBtnTxt}>Condividi link form</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 100 }}>
          {items.map((l) => {
            const stMeta = STATUS_META[l.status] || STATUS_META.new;
            return (
              <Pressable
                key={l.lead_id}
                style={styles.card}
                onPress={() => openDetail(l)}
                testID={`lead-card-${l.lead_id}`}
              >
                <View style={styles.cardHead}>
                  <Text style={styles.cardName}>{l.full_name}</Text>
                  <View style={[styles.statusBadge, { backgroundColor: stMeta.color + "22" }]}>
                    <Ionicons name={stMeta.icon} size={12} color={stMeta.color} />
                    <Text style={[styles.statusBadgeTxt, { color: stMeta.color }]}>{stMeta.label}</Text>
                  </View>
                </View>
                <Text style={styles.cardDate}>{fmt(l.created_at)}</Text>
                <View style={styles.needsRow}>
                  {(l.needs || []).map(n => {
                    const nm = NEED_META[n];
                    return nm ? (
                      <Text key={n} style={styles.needTiny}>{nm.emoji} {nm.label}</Text>
                    ) : null;
                  })}
                </View>
                {l.free_text ? (
                  <Text style={styles.freeTextPrev} numberOfLines={2}>“{l.free_text}”</Text>
                ) : null}
                <View style={styles.contactMini}>
                  {l.company ? <Text style={styles.contactMiniTxt} testID={`lead-company-${l.lead_id}`}>🏢 {l.company}{l.source === "landing_demo" ? " · DEMO dalla landing" : ""}</Text> : null}
                  {l.email ? <Text style={styles.contactMiniTxt}>✉️ {l.email}</Text> : null}
                  {l.phone ? <Text style={styles.contactMiniTxt}>📞 {l.phone}</Text> : null}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {/* Detail Modal */}
      <Modal visible={!!detail} animationType="slide" transparent onRequestClose={() => setDetail(null)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetTitle} numberOfLines={1}>{detail?.full_name || ""}</Text>
                {detail?.status ? (
                  <Text style={{ color: STATUS_META[detail.status].color, fontSize: 12, fontWeight: "700" }}>
                    {STATUS_META[detail.status].label}
                  </Text>
                ) : null}
              </View>
              <Pressable onPress={() => setDetail(null)} testID="lead-detail-close">
                <Ionicons name="close" size={22} color={HT.text} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 140 }}>
              {detail ? (
                <>
                  <View style={styles.detailBox}>
                    <Text style={styles.detailKv}>📅 {fmt(detail.created_at)}</Text>
                    {detail.email ? <Text style={styles.detailKv}>✉️ {detail.email}</Text> : null}
                    {detail.phone ? <Text style={styles.detailKv}>📞 {detail.phone}</Text> : null}
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                      {(detail.needs || []).map(n => {
                        const nm = NEED_META[n];
                        return nm ? (
                          <View key={n} style={styles.needPill}>
                            <Text style={styles.needPillTxt}>{nm.emoji} {nm.label}</Text>
                          </View>
                        ) : null;
                      })}
                    </View>
                    {detail.free_text ? (
                      <View style={{ marginTop: 10, padding: 10, backgroundColor: HT.card2, borderRadius: 8 }}>
                        <Text style={{ fontSize: 12, color: HT.muted, marginBottom: 4, fontWeight: "700" }}>Messaggio:</Text>
                        <Text style={{ color: HT.text, fontSize: 13, lineHeight: 18, fontStyle: "italic" }}>“{detail.free_text}”</Text>
                      </View>
                    ) : null}
                  </View>

                  <View style={styles.axonBox}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
                      <Ionicons name="sparkles" size={16} color="#8B5CF6" />
                      <Text style={styles.axonTitle}>Bozza AxonOS</Text>
                      {regenerating ? <ActivityIndicator size="small" color="#8B5CF6" /> : null}
                    </View>
                    <TextInput
                      style={styles.axonInput}
                      value={editText}
                      onChangeText={setEditText}
                      multiline
                      numberOfLines={10}
                      placeholder="Nessuna risposta generata ancora. Tocca 'Rigenera' qui sotto."
                      placeholderTextColor={HT.muted}
                      testID="lead-axon-input"
                    />
                    <View style={styles.axonActions}>
                      <Pressable style={styles.axonBtn} onPress={() => regenerate("friendly")} testID="lead-regen-friendly">
                        <Ionicons name="happy" size={14} color="#8B5CF6" />
                        <Text style={styles.axonBtnTxt}>Amichevole</Text>
                      </Pressable>
                      <Pressable style={styles.axonBtn} onPress={() => regenerate("professional")} testID="lead-regen-pro">
                        <Ionicons name="briefcase" size={14} color="#8B5CF6" />
                        <Text style={styles.axonBtnTxt}>Formale</Text>
                      </Pressable>
                      <Pressable style={styles.axonBtn} onPress={() => regenerate("short")} testID="lead-regen-short">
                        <Ionicons name="flash" size={14} color="#8B5CF6" />
                        <Text style={styles.axonBtnTxt}>Breve</Text>
                      </Pressable>
                    </View>
                    <Pressable
                      style={[styles.saveEditBtn, savingEdit && { opacity: 0.6 }]}
                      onPress={saveEdit}
                      disabled={savingEdit}
                      testID="lead-save-edit"
                    >
                      <Ionicons name="save" size={14} color="#FFF" />
                      <Text style={styles.saveEditTxt}>Salva modifiche</Text>
                    </Pressable>
                  </View>

                  {detail.status !== "approved" && detail.status !== "replied" ? (
                    <Pressable style={styles.approveBtn} onPress={approve} testID="lead-approve">
                      <Ionicons name="checkmark-circle" size={18} color="#FFF" />
                      <Text style={styles.approveTxt}>Approva risposta</Text>
                    </Pressable>
                  ) : null}

                  <Text style={styles.sendLbl}>Invia al lead tramite:</Text>
                  <View style={styles.sendChannels}>
                    {(["whatsapp", "email", "sms", "telegram"] as const).map((ch) => {
                      const meta = CHANNEL_META[ch];
                      const disabled = (ch === "email" && !detail.email) || (["whatsapp","sms"].includes(ch) && !detail.phone);
                      return (
                        <Pressable
                          key={ch}
                          style={[styles.sendChBtn, { backgroundColor: meta.color }, disabled && { opacity: 0.4 }]}
                          onPress={() => !disabled && sendReply(ch)}
                          disabled={disabled}
                          testID={`send-${ch}`}
                        >
                          <Ionicons name={meta.icon} size={16} color="#FFF" />
                          <Text style={styles.sendChTxt}>{meta.label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  {detail.master_replied_at ? (
                    <View style={styles.repliedBox}>
                      <Ionicons name="checkmark-done" size={16} color={HT.success} />
                      <Text style={styles.repliedTxt}>
                        Risposto {detail.master_reply_channel ? `via ${CHANNEL_META[detail.master_reply_channel]?.label || detail.master_reply_channel}` : ""} il {fmt(detail.master_replied_at)}
                      </Text>
                    </View>
                  ) : null}

                  <Pressable style={styles.deleteBtn} onPress={remove} testID="lead-delete">
                    <Ionicons name="trash" size={14} color={HT.danger} />
                    <Text style={styles.deleteTxt}>Elimina lead</Text>
                  </Pressable>
                </>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* V50.z103.b — Modal Configura Esigenze */}
      <Modal visible={showNeedsCfg} animationType="slide" transparent onRequestClose={() => setShowNeedsCfg(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetTitle}>Configura esigenze</Text>
                <Text style={{ fontSize: 11, color: HT.muted }}>
                  Modifica le checkbox del form pubblico · {needsDefault ? "Default attivi" : "Custom attivi"}
                </Text>
              </View>
              <Pressable onPress={() => setShowNeedsCfg(false)} testID="needs-cfg-close">
                <Ionicons name="close" size={22} color={HT.text} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 140 }}>
              <Text style={{ fontSize: 12, color: HT.muted, marginBottom: 10, lineHeight: 16 }}>
                Puoi avere da 1 a 12 esigenze. L&apos;ID viene generato automaticamente dal nome.
                I lead già ricevuti mantengono le esigenze originali.
              </Text>

              {editNeeds.map((n, idx) => (
                <View key={idx} style={styles.needEditRow} testID={`need-edit-${idx}`}>
                  <TextInput
                    style={styles.needEmojiInput}
                    value={n.emoji}
                    onChangeText={(v) => updateNeed(idx, { emoji: v })}
                    placeholder="😀"
                    maxLength={4}
                    testID={`need-emoji-${idx}`}
                  />
                  <TextInput
                    style={styles.needLabelInput}
                    value={n.label}
                    onChangeText={(v) => updateNeed(idx, { label: v })}
                    placeholder="Nome esigenza"
                    testID={`need-label-${idx}`}
                  />
                  <Pressable
                    onPress={() => removeNeed(idx)}
                    style={styles.needRemoveBtn}
                    testID={`need-remove-${idx}`}
                  >
                    <Ionicons name="trash" size={16} color={HT.danger} />
                  </Pressable>
                </View>
              ))}

              <Pressable
                style={[styles.needAddBtn, editNeeds.length >= 12 && { opacity: 0.4 }]}
                onPress={addNeed}
                disabled={editNeeds.length >= 12}
                testID="need-add"
              >
                <Ionicons name="add-circle" size={18} color={HT.brand} />
                <Text style={styles.needAddTxt}>Aggiungi esigenza ({editNeeds.length}/12)</Text>
              </Pressable>

              <Pressable
                style={[styles.needSaveBtn, savingCfg && { opacity: 0.6 }]}
                onPress={saveNeeds}
                disabled={savingCfg}
                testID="need-save"
              >
                {savingCfg ? <ActivityIndicator color="#FFF" /> : (
                  <>
                    <Ionicons name="checkmark-circle" size={18} color="#FFF" />
                    <Text style={styles.needSaveTxt}>Salva configurazione</Text>
                  </>
                )}
              </Pressable>

              {!needsDefault ? (
                <Pressable
                  style={styles.needResetBtn}
                  onPress={resetNeeds}
                  disabled={savingCfg}
                  testID="need-reset"
                >
                  <Ionicons name="refresh" size={14} color={HT.muted} />
                  <Text style={styles.needResetTxt}>Ripristina 5 default</Text>
                </Pressable>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: HT.card2 },
  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: HT.border,
    backgroundColor: HT.card2,
  },
  iconBtn: { padding: 8 },
  title: { flex: 1, fontSize: 17, fontWeight: "800", color: HT.text, textAlign: "center" },
  linkBar: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: HT.brand + "10",
  },
  linkTxt: { flex: 1, fontSize: 12, color: HT.brand, fontWeight: "600" },
  filterRow: { paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  filterChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 20, borderWidth: 1, borderColor: HT.border,
    backgroundColor: HT.card2,
  },
  filterChipActive: { backgroundColor: HT.brand, borderColor: HT.brand },
  filterTxt: { fontSize: 12, color: HT.text, fontWeight: "600" },
  filterTxtActive: { color: "#FFF" },
  filterCount: { fontSize: 10, color: HT.muted, fontWeight: "700" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40 },
  emptyTxt: { color: HT.muted, marginTop: 12, fontSize: 14, textAlign: "center" },
  emptyBtn: {
    marginTop: 20, flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10,
    backgroundColor: HT.brand,
  },
  emptyBtnTxt: { color: "#FFF", fontWeight: "700" },
  card: {
    padding: 14, borderRadius: 12,
    backgroundColor: HT.card2,
    marginBottom: 10,
    borderWidth: 1, borderColor: HT.border,
  },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  cardName: { flex: 1, fontSize: 15, fontWeight: "800", color: HT.text },
  statusBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
  },
  statusBadgeTxt: { fontSize: 11, fontWeight: "700" },
  cardDate: { color: HT.muted, fontSize: 11 },
  needsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  needTiny: {
    fontSize: 11, color: HT.text,
    paddingHorizontal: 8, paddingVertical: 3,
    backgroundColor: HT.card2,
    borderRadius: 6, fontWeight: "600",
  },
  freeTextPrev: { color: HT.muted, fontStyle: "italic", fontSize: 12, marginTop: 6, lineHeight: 16 },
  contactMini: { flexDirection: "row", gap: 10, marginTop: 8, flexWrap: "wrap" },
  contactMiniTxt: { fontSize: 11, color: HT.brand, fontWeight: "600" },
  // Modal
  backdrop: { flex: 1, backgroundColor: "rgba(15,15,25,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: HT.card2, borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: "94%" },
  sheetHead: {
    flexDirection: "row", alignItems: "center", padding: 16,
    borderBottomWidth: 1, borderBottomColor: HT.border,
  },
  sheetTitle: { fontSize: 17, fontWeight: "800", color: HT.text },
  detailBox: {
    padding: 12, borderRadius: 12,
    backgroundColor: HT.card2,
    borderWidth: 1, borderColor: HT.border,
    marginBottom: 12,
  },
  detailKv: { fontSize: 13, color: HT.text, marginBottom: 3 },
  needPill: {
    paddingHorizontal: 8, paddingVertical: 3,
    backgroundColor: HT.brand + "18", borderRadius: 6,
  },
  needPillTxt: { fontSize: 11, color: HT.brand, fontWeight: "700" },
  axonBox: {
    padding: 12, borderRadius: 12,
    backgroundColor: "#8B5CF60A",
    borderWidth: 1, borderColor: "#8B5CF633",
    marginBottom: 12,
  },
  axonTitle: { fontSize: 13, fontWeight: "800", color: "#8B5CF6", flex: 1 },
  axonInput: {
    borderWidth: 1, borderColor: HT.border, borderRadius: 8,
    padding: 12, backgroundColor: HT.card2,
    color: HT.text, fontSize: 13, minHeight: 200,
    textAlignVertical: "top",
  },
  axonActions: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  axonBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6,
    borderWidth: 1, borderColor: '#8B5CF6',
  },
  axonBtnTxt: { fontSize: 11, color: "#8B5CF6", fontWeight: "700" },
  saveEditBtn: {
    marginTop: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 8, borderRadius: 8, backgroundColor: '#8B5CF6',
  },
  saveEditTxt: { color: "#FFF", fontWeight: "800", fontSize: 12 },
  approveBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 12, borderRadius: 10,
    backgroundColor: HT.success, marginBottom: 12,
  },
  approveTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
  sendLbl: { fontSize: 12, fontWeight: "700", color: HT.muted, marginBottom: 6 },
  sendChannels: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  sendChBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 12, borderRadius: 10, minWidth: 120,
  },
  sendChTxt: { color: "#FFF", fontWeight: "800", fontSize: 13 },
  repliedBox: {
    flexDirection: "row", alignItems: "center", gap: 6,
    padding: 10, borderRadius: 8,
    backgroundColor: HT.success + "15", marginTop: 12,
  },
  repliedTxt: { fontSize: 12, color: HT.success, fontWeight: "600" },
  deleteBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    marginTop: 20, paddingVertical: 10,
  },
  deleteTxt: { color: HT.danger, fontWeight: "700" },
  // V50.z103.b — Config esigenze
  needEditRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginBottom: 10,
  },
  needEmojiInput: {
    width: 52, height: 44, borderRadius: 8,
    borderWidth: 1, borderColor: HT.border,
    backgroundColor: HT.card2,
    textAlign: "center", fontSize: 22, color: HT.text,
  },
  needLabelInput: {
    flex: 1, height: 44, borderRadius: 8,
    borderWidth: 1, borderColor: HT.border,
    backgroundColor: HT.card2,
    paddingHorizontal: 12, fontSize: 14, color: HT.text,
  },
  needRemoveBtn: {
    width: 40, height: 44, borderRadius: 8,
    alignItems: "center", justifyContent: "center",
    backgroundColor: HT.danger + "15",
  },
  needAddBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 12, borderRadius: 10,
    borderWidth: 1.5, borderStyle: "dashed", borderColor: HT.brand,
    marginTop: 4,
  },
  needAddTxt: { color: HT.brand, fontWeight: "700", fontSize: 13 },
  needSaveBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 13, borderRadius: 10,
    backgroundColor: HT.success, marginTop: 16,
  },
  needSaveTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
  needResetBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 10, marginTop: 8,
  },
  needResetTxt: { color: HT.muted, fontWeight: "600", fontSize: 12 },
});

// V50.z104 — Gestione Clienti AdvisorOS (Super-Admin)
// PROMPT 27: Lista utenti, tier assignment, broadcast, tips analytics.

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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";

type Tier = "paying_business" | "paying_private" | "test" | "axonos_business" | "axonos_private";

type TierMeta = { id: Tier; label: string; color: string };
type FeatureMeta = { key: string; label: string; days_threshold: number; video_url: string };

type Customer = {
  user_id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  role?: string;
  advisor_tier?: Tier;
  created_at?: string;
  last_login?: string;
  parent_user_id?: string;
};

type CustomerDetail = Customer & {
  usage?: {
    counts: Record<string, number>;
    last_used_at: Record<string, string | null>;
  };
};

type Channels = { in_app: boolean; email: boolean; whatsapp: boolean };
type WaTarget = { user_id: string; name: string; phone: string; wa_url: string };

function fmt(iso?: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
  } catch { return "—"; }
}

function daysSince(iso?: string | null): number | null {
  if (!iso) return null;
  try {
    const d = new Date(iso).getTime();
    if (Number.isNaN(d)) return null;
    return Math.floor((Date.now() - d) / (86400 * 1000));
  } catch { return null; }
}

export default function AdminCustomersPage() {
  const router = useRouter();
  const [tiers, setTiers] = useState<TierMeta[]>([]);
  const [features, setFeatures] = useState<FeatureMeta[]>([]);
  const [items, setItems] = useState<Customer[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [tierFilter, setTierFilter] = useState<"all" | Tier>("all");
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [savingTier, setSavingTier] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestion, setSuggestion] = useState<{ suggested: string; reason: string } | null>(null);

  const [showBroadcast, setShowBroadcast] = useState(false);
  const [bcTarget, setBcTarget] = useState<string>("all");
  const [bcChannels, setBcChannels] = useState<Channels>({ in_app: true, email: false, whatsapp: false });
  const [bcSubject, setBcSubject] = useState("");
  const [bcBody, setBcBody] = useState("");
  const [bcVideoUrl, setBcVideoUrl] = useState("");
  const [bcSending, setBcSending] = useState(false);
  const [bcWaTargets, setBcWaTargets] = useState<WaTarget[]>([]);

  const loadMeta = useCallback(async () => {
    try {
      const r = await api<{ tiers: TierMeta[]; features: FeatureMeta[] }>("/admin/tiers-meta");
      setTiers(r?.tiers || []);
      setFeatures(r?.features || []);
    } catch (e: any) {
      notify("Accesso negato", e?.message || "Solo super-admin");
      router.back();
    }
  }, [router]);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const [r, c] = await Promise.all([
        api<{ items: Customer[] }>(`/admin/customers?tier=${tierFilter}`),
        api<{ counts: Record<string, number>; total: number }>(`/admin/customers/counts`),
      ]);
      setItems(r?.items || []);
      setCounts({ ...(c?.counts || {}), _all: c?.total || 0 });
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [tierFilter]);

  useEffect(() => { loadMeta(); }, [loadMeta]);
  useEffect(() => { loadList(); }, [loadList]);

  const openDetail = async (c: Customer) => {
    try {
      const fresh = await api<CustomerDetail>(`/admin/customers/${c.user_id}`);
      setDetail(fresh);
      setSuggestion(null);
    } catch (e: any) {
      notify("Errore", e?.message || "");
    }
  };

  const setTier = async (t: Tier) => {
    if (!detail) return;
    setSavingTier(true);
    try {
      await api(`/admin/customers/${detail.user_id}/tier`, { method: "PATCH", body: { tier: t } });
      setDetail({ ...detail, advisor_tier: t });
      loadList();
      notify("Aggiornato", `Tier: ${tierLabel(t)}`);
    } catch (e: any) {
      notify("Errore", e?.message || "");
    } finally {
      setSavingTier(false);
    }
  };

  const suggestTier = async () => {
    if (!detail) return;
    setSuggesting(true);
    try {
      const r = await api<{ suggested: string; reason: string }>(`/admin/customers/${detail.user_id}/tier-suggest`, { method: "POST" });
      setSuggestion(r);
    } catch (e: any) {
      notify("Errore", e?.message || "");
    } finally {
      setSuggesting(false);
    }
  };

  const openBroadcast = (targetTier?: string) => {
    setBcTarget(targetTier || "all");
    setBcChannels({ in_app: true, email: false, whatsapp: false });
    setBcSubject("");
    setBcBody("");
    setBcVideoUrl("");
    setBcWaTargets([]);
    setShowBroadcast(true);
  };

  const sendBroadcast = async () => {
    if (!bcSubject.trim() || !bcBody.trim()) {
      notify("Campi mancanti", "Compila oggetto e messaggio");
      return;
    }
    const chans = (["in_app", "email", "whatsapp"] as const).filter(k => bcChannels[k]);
    if (chans.length === 0) {
      notify("Nessun canale", "Scegli almeno un canale");
      return;
    }
    setBcSending(true);
    try {
      const r = await api<{ ok: boolean; delivered: any; wa_targets: WaTarget[]; targets_count: number }>(
        `/admin/broadcasts`,
        { method: "POST", body: {
          target_tier: bcTarget,
          channels: chans,
          subject: bcSubject.trim(),
          body: bcBody.trim(),
          video_url: bcVideoUrl.trim() || null,
        } }
      );
      setBcWaTargets(r?.wa_targets || []);
      const stats = [
        `In-app: ${r.delivered?.in_app || 0}/${r.targets_count}`,
        (chans.includes("email") ? `Email: ${r.delivered?.email || 0}` : ""),
        (chans.includes("whatsapp") ? `WhatsApp: ${(r.wa_targets || []).length} pronti` : ""),
      ].filter(Boolean).join(" · ");
      notify("Broadcast inviato", stats);
    } catch (e: any) {
      notify("Errore", e?.message || "");
    } finally {
      setBcSending(false);
    }
  };

  const tierLabel = (t?: string): string => (tiers.find(x => x.id === t)?.label) || "—";
  const tierColor = (t?: string): string => (tiers.find(x => x.id === t)?.color) || theme.color.muted;

  const filteredCount = useMemo(() => items.length, [items]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={24} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.title}>Gestione Clienti</Text>
        <Pressable onPress={() => openBroadcast(tierFilter === "all" ? "all" : tierFilter)} style={styles.iconBtn} testID="btn-broadcast">
          <Ionicons name="megaphone" size={22} color={theme.color.brandPrimary} />
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        <FilterChip label={`Tutti (${counts._all || 0})`} active={tierFilter === "all"} color={theme.color.brandPrimary} onPress={() => setTierFilter("all")} testID="chip-all" />
        {tiers.map(t => (
          <FilterChip
            key={t.id}
            label={`${t.label} (${counts[t.id] || 0})`}
            active={tierFilter === t.id}
            color={t.color}
            onPress={() => setTierFilter(t.id)}
            testID={`chip-${t.id}`}
          />
        ))}
      </ScrollView>

      {loading ? (
        <View style={styles.centered}><ActivityIndicator size="large" color={theme.color.brandPrimary} /></View>
      ) : items.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="people-outline" size={48} color={theme.color.muted} />
          <Text style={styles.emptyTxt}>Nessun utente in questa categoria</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 100 }}>
          <Text style={styles.countLine}>{filteredCount} utenti</Text>
          {items.map(c => (
            <Pressable
              key={c.user_id}
              style={styles.card}
              onPress={() => openDetail(c)}
              testID={`user-${c.user_id}`}
            >
              <View style={styles.cardHead}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardName}>
                    {(c.first_name || c.last_name) ? `${c.first_name || ""} ${c.last_name || ""}`.trim() : c.email}
                  </Text>
                  <Text style={styles.cardEmail}>{c.email}</Text>
                </View>
                <View style={[styles.tierBadge, { backgroundColor: tierColor(c.advisor_tier) + "22" }]}>
                  <Text style={[styles.tierBadgeTxt, { color: tierColor(c.advisor_tier) }]}>{tierLabel(c.advisor_tier)}</Text>
                </View>
              </View>
              <View style={styles.cardMeta}>
                <Text style={styles.cardMetaTxt}>Ruolo: {c.role || "—"}</Text>
                <Text style={styles.cardMetaTxt}>Login: {fmt(c.last_login)}</Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {/* Detail modal */}
      <Modal visible={!!detail} animationType="slide" transparent onRequestClose={() => setDetail(null)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetTitle} numberOfLines={1}>
                  {detail ? ((detail.first_name || detail.last_name) ? `${detail.first_name || ""} ${detail.last_name || ""}`.trim() : detail.email) : ""}
                </Text>
                <Text style={styles.sheetSub}>{detail?.email}</Text>
              </View>
              <Pressable onPress={() => setDetail(null)} testID="detail-close">
                <Ionicons name="close" size={22} color={theme.color.onSurface} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ padding: 16 }}>
              {detail ? (
                <>
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Tier categoria</Text>
                    <View style={styles.tierGrid}>
                      {tiers.map(t => {
                        const active = detail.advisor_tier === t.id;
                        return (
                          <Pressable
                            key={t.id}
                            style={[
                              styles.tierBtn,
                              active && { backgroundColor: t.color, borderColor: t.color },
                            ]}
                            onPress={() => setTier(t.id)}
                            disabled={savingTier}
                            testID={`set-tier-${t.id}`}
                          >
                            <Text style={[styles.tierBtnTxt, active && { color: "#FFF", fontWeight: "800" }]}>
                              {t.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    <Pressable style={styles.suggestBtn} onPress={suggestTier} disabled={suggesting} testID="tier-suggest">
                      {suggesting ? <ActivityIndicator size="small" color="#8B5CF6" /> : (
                        <>
                          <Ionicons name="sparkles" size={14} color="#8B5CF6" />
                          <Text style={styles.suggestBtnTxt}>Suggerisci tier con AI</Text>
                        </>
                      )}
                    </Pressable>
                    {suggestion ? (
                      <View style={styles.suggestBox}>
                        <Text style={{ fontWeight: "700", color: "#8B5CF6" }}>
                          Suggerito: {tierLabel(suggestion.suggested)}
                        </Text>
                        <Text style={{ fontSize: 12, color: theme.color.muted, marginTop: 4 }}>{suggestion.reason}</Text>
                        <Pressable
                          style={styles.applyBtn}
                          onPress={() => setTier(suggestion.suggested as Tier)}
                          testID="apply-suggest"
                        >
                          <Text style={styles.applyBtnTxt}>Applica</Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </View>

                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Storico utilizzo</Text>
                    {features.map(f => {
                      const cnt = detail.usage?.counts?.[f.key] || 0;
                      const last = detail.usage?.last_used_at?.[f.key];
                      const days = daysSince(last);
                      const unused = cnt === 0;
                      return (
                        <View key={f.key} style={styles.featRow}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.featName}>{f.label}</Text>
                            <Text style={styles.featMeta}>
                              {cnt} utilizzi · {last ? `ultimo ${days}gg fa` : "mai usato"}
                            </Text>
                          </View>
                          {unused ? (
                            <View style={[styles.featBadge, { backgroundColor: "#EA580C22" }]}>
                              <Text style={[styles.featBadgeTxt, { color: "#EA580C" }]}>Non usato</Text>
                            </View>
                          ) : days != null && days > f.days_threshold ? (
                            <View style={[styles.featBadge, { backgroundColor: "#F59E0B22" }]}>
                              <Text style={[styles.featBadgeTxt, { color: "#F59E0B" }]}>Inattivo {days}gg</Text>
                            </View>
                          ) : (
                            <View style={[styles.featBadge, { backgroundColor: theme.color.success + "22" }]}>
                              <Text style={[styles.featBadgeTxt, { color: theme.color.success }]}>Attivo</Text>
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </View>
                </>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Broadcast modal */}
      <Modal visible={showBroadcast} animationType="slide" transparent onRequestClose={() => setShowBroadcast(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Nuovo Broadcast</Text>
              <Pressable onPress={() => setShowBroadcast(false)} testID="bc-close">
                <Ionicons name="close" size={22} color={theme.color.onSurface} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ padding: 16 }}>
              <Text style={styles.lbl}>Categoria destinatari</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4 }}>
                <FilterChip label={`Tutti`} active={bcTarget === "all"} color={theme.color.brandPrimary} onPress={() => setBcTarget("all")} />
                {tiers.map(t => (
                  <FilterChip key={t.id} label={t.label} active={bcTarget === t.id} color={t.color} onPress={() => setBcTarget(t.id)} />
                ))}
              </ScrollView>

              <Text style={[styles.lbl, { marginTop: 14 }]}>Canali</Text>
              <View style={{ gap: 6 }}>
                {(["in_app", "email", "whatsapp"] as const).map(ch => (
                  <Pressable
                    key={ch}
                    style={styles.channelRow}
                    onPress={() => setBcChannels({ ...bcChannels, [ch]: !bcChannels[ch] })}
                    testID={`ch-${ch}`}
                  >
                    <View style={[styles.checkbox, bcChannels[ch] && { backgroundColor: theme.color.brandPrimary, borderColor: theme.color.brandPrimary }]}>
                      {bcChannels[ch] ? <Ionicons name="checkmark" size={14} color="#FFF" /> : null}
                    </View>
                    <Ionicons
                      name={ch === "in_app" ? "notifications" : ch === "email" ? "mail" : "logo-whatsapp"}
                      size={18}
                      color={ch === "whatsapp" ? "#25D366" : ch === "email" ? "#DC2626" : theme.color.brandPrimary}
                    />
                    <Text style={styles.channelLbl}>
                      {ch === "in_app" ? "In-app (homepage banner)" : ch === "email" ? "Email (SMTP sistema)" : "WhatsApp (deep-link manuale)"}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={[styles.lbl, { marginTop: 14 }]}>Oggetto</Text>
              <TextInput
                style={styles.input}
                value={bcSubject}
                onChangeText={setBcSubject}
                placeholder="Es. Nuova funzionalità disponibile"
                placeholderTextColor={theme.color.muted}
                testID="bc-subject"
              />

              <Text style={[styles.lbl, { marginTop: 12 }]}>Messaggio</Text>
              <TextInput
                style={styles.textArea}
                value={bcBody}
                onChangeText={setBcBody}
                multiline
                numberOfLines={6}
                placeholder="Scrivi il messaggio da inviare…"
                placeholderTextColor={theme.color.muted}
                testID="bc-body"
              />

              <Text style={[styles.lbl, { marginTop: 12 }]}>Link video (opzionale)</Text>
              <TextInput
                style={styles.input}
                value={bcVideoUrl}
                onChangeText={setBcVideoUrl}
                placeholder="https://youtu.be/…"
                autoCapitalize="none"
                placeholderTextColor={theme.color.muted}
                testID="bc-video"
              />

              <Pressable
                style={[styles.sendBtn, bcSending && { opacity: 0.6 }]}
                onPress={sendBroadcast}
                disabled={bcSending}
                testID="bc-send"
              >
                {bcSending ? <ActivityIndicator color="#FFF" /> : (
                  <>
                    <Ionicons name="send" size={16} color="#FFF" />
                    <Text style={styles.sendBtnTxt}>Invia broadcast</Text>
                  </>
                )}
              </Pressable>

              {bcWaTargets.length > 0 ? (
                <View style={styles.waSection}>
                  <Text style={styles.waTitle}>WhatsApp — {bcWaTargets.length} utenti pronti</Text>
                  <Text style={styles.waSub}>Tocca ogni nome per aprire WhatsApp con il messaggio precompilato.</Text>
                  {bcWaTargets.map((t, i) => (
                    <Pressable
                      key={t.user_id + i}
                      style={styles.waRow}
                      onPress={() => Linking.openURL(t.wa_url)}
                      testID={`wa-${i}`}
                    >
                      <Ionicons name="logo-whatsapp" size={18} color="#25D366" />
                      <Text style={styles.waRowTxt}>{t.name}</Text>
                      <Text style={styles.waRowPhone}>{t.phone}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function FilterChip({ label, active, color, onPress, testID }: { label: string; active: boolean; color: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable
      style={[
        styles.filterChip,
        active && { backgroundColor: color, borderColor: color },
      ]}
      onPress={onPress}
      testID={testID}
    >
      <Text style={[styles.filterTxt, active && { color: "#FFF" }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.surface },
  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: theme.color.divider,
    backgroundColor: theme.color.surfaceSecondary,
  },
  iconBtn: { padding: 8 },
  title: { flex: 1, fontSize: 17, fontWeight: "800", color: theme.color.onSurface, textAlign: "center" },
  filterRow: { paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  filterChip: {
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 20, borderWidth: 1, borderColor: theme.color.border,
    backgroundColor: theme.color.surfaceSecondary,
  },
  filterTxt: { fontSize: 11, color: theme.color.onSurface, fontWeight: "700" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40 },
  emptyTxt: { color: theme.color.muted, marginTop: 12, fontSize: 14 },
  countLine: { fontSize: 12, color: theme.color.muted, marginBottom: 8, fontWeight: "600" },
  card: {
    padding: 14, borderRadius: 12,
    backgroundColor: theme.color.surfaceSecondary,
    marginBottom: 8,
    borderWidth: 1, borderColor: theme.color.divider,
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardName: { fontSize: 14, fontWeight: "800", color: theme.color.onSurface },
  cardEmail: { fontSize: 11, color: theme.color.muted, marginTop: 2 },
  tierBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  tierBadgeTxt: { fontSize: 10, fontWeight: "800" },
  cardMeta: { flexDirection: "row", gap: 12, marginTop: 8 },
  cardMetaTxt: { fontSize: 11, color: theme.color.muted },
  // Modal
  backdrop: { flex: 1, backgroundColor: "rgba(15,15,25,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: theme.color.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: "94%" },
  sheetHead: { flexDirection: "row", alignItems: "center", padding: 16, borderBottomWidth: 1, borderBottomColor: theme.color.divider },
  sheetTitle: { fontSize: 17, fontWeight: "800", color: theme.color.onSurface },
  sheetSub: { fontSize: 11, color: theme.color.muted },
  section: { marginBottom: 16, padding: 12, borderRadius: 12, backgroundColor: theme.color.surfaceSecondary, borderWidth: 1, borderColor: theme.color.divider },
  sectionTitle: { fontSize: 13, fontWeight: "800", color: theme.color.onSurface, marginBottom: 8 },
  tierGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tierBtn: {
    paddingHorizontal: 10, paddingVertical: 8,
    borderRadius: 8, borderWidth: 1, borderColor: theme.color.border,
    backgroundColor: theme.color.surface,
  },
  tierBtnTxt: { fontSize: 11, color: theme.color.onSurface, fontWeight: "600" },
  suggestBtn: {
    marginTop: 10, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, paddingVertical: 8, borderRadius: 8,
    borderWidth: 1, borderStyle: "dashed", borderColor: "#8B5CF6",
  },
  suggestBtnTxt: { color: "#8B5CF6", fontWeight: "700", fontSize: 12 },
  suggestBox: {
    marginTop: 10, padding: 10, borderRadius: 8,
    backgroundColor: "#8B5CF610", borderWidth: 1, borderColor: "#8B5CF633",
  },
  applyBtn: { marginTop: 8, alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, backgroundColor: "#8B5CF6" },
  applyBtnTxt: { color: "#FFF", fontWeight: "800", fontSize: 11 },
  featRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.color.divider,
  },
  featName: { fontSize: 13, fontWeight: "700", color: theme.color.onSurface },
  featMeta: { fontSize: 11, color: theme.color.muted, marginTop: 2 },
  featBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  featBadgeTxt: { fontSize: 10, fontWeight: "700" },
  lbl: { fontSize: 12, fontWeight: "700", color: theme.color.muted, marginBottom: 6 },
  input: {
    borderWidth: 1, borderColor: theme.color.border, borderRadius: 10,
    padding: 12, fontSize: 14, color: theme.color.onSurface,
    backgroundColor: theme.color.surfaceSecondary,
  },
  textArea: {
    borderWidth: 1, borderColor: theme.color.border, borderRadius: 10,
    padding: 12, fontSize: 14, color: theme.color.onSurface,
    backgroundColor: theme.color.surfaceSecondary,
    minHeight: 120, textAlignVertical: "top",
  },
  channelRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingVertical: 8, paddingHorizontal: 8,
    borderRadius: 8, backgroundColor: theme.color.surfaceSecondary,
  },
  checkbox: {
    width: 22, height: 22, borderRadius: 4, borderWidth: 2, borderColor: theme.color.border,
    alignItems: "center", justifyContent: "center",
  },
  channelLbl: { fontSize: 13, color: theme.color.onSurface, flex: 1 },
  sendBtn: {
    marginTop: 18, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 13, borderRadius: 10, backgroundColor: theme.color.brandPrimary,
  },
  sendBtnTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
  waSection: {
    marginTop: 20, padding: 12, borderRadius: 10,
    backgroundColor: "#25D36615", borderWidth: 1, borderColor: "#25D36644",
  },
  waTitle: { fontSize: 13, fontWeight: "800", color: "#25D366" },
  waSub: { fontSize: 11, color: theme.color.muted, marginTop: 2, marginBottom: 8 },
  waRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingVertical: 8, borderTopWidth: 1, borderTopColor: "#25D36622",
  },
  waRowTxt: { flex: 1, fontSize: 12, color: theme.color.onSurface, fontWeight: "600" },
  waRowPhone: { fontSize: 11, color: theme.color.muted },
});

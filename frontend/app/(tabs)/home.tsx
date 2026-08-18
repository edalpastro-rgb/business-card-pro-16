import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, ActivityIndicator, Image, TextInput, Linking, Platform, Animated, Easing } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { theme } from "@/src/theme";
import { CallActionSheet, CallTarget } from "@/src/CallActionSheet";
import { openTelegram } from "@/src/utils/telegram";

type CustomArea = { id: string; name: string; color: string };
type Settings = { energy_title: string; energy_color: string; network_title: string; network_color: string; custom_areas?: CustomArea[] };
type Callback = { callback_id: string; title: string; area: "energy" | "network"; scheduled_at: string; note: string; done: boolean; contact_id?: string; phone?: string };
type ReportStats = { period: string; stats: { energy: any; network: any } };
type Contact = { contact_id: string; first_name: string; last_name: string; phone?: string; whatsapp?: string; telegram?: string; email?: string; area: string; additional_areas?: string[]; group_ids?: string[] };
type Group = { group_id: string; name: string; color: string; member_count: number };

export default function HomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [callbacks, setCallbacks] = useState<Callback[]>([]);
  const [report, setReport] = useState<ReportStats | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [chatQuery, setChatQuery] = useState("");
  const [chatAreaFilter, setChatAreaFilter] = useState<string>("all");
  const [subscription, setSubscription] = useState<{ status: string; days_left?: number | null; is_active: boolean } | null>(null);
  const [callTarget, setCallTarget] = useState<CallTarget | null>(null);

  const load = useCallback(async () => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const [s, c, r, ct, gr, sub] = await Promise.all([
        api<Settings>("/settings"),
        api<{ items: Callback[] }>("/callbacks", { query: { day: today, include_done: true } }),
        api<ReportStats>("/reports", { query: { period: "day" } }),
        api<{ items: Contact[] }>("/contacts"),
        api<{ items: Group[] }>("/groups"),
        api<any>("/subscription/status").catch(() => null),
      ]);
      setSettings(s);
      setCallbacks(c.items);
      setReport(r);
      setContacts(ct.items || []);
      setGroups(gr.items || []);
      setSubscription(sub);
    } catch (e) {
      console.warn(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <View style={styles.center}><ActivityIndicator color={theme.color.brandPrimary} /></View>
      </SafeAreaView>
    );
  }

  const energyColor = settings?.energy_color || theme.color.energy;
  const networkColor = settings?.network_color || theme.color.network;

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <LinearGradient colors={["#0F2438", "#1C4869"]} style={styles.hero}>
        <View style={styles.heroInner}>
          <View style={styles.heroTop}>
            <View style={{ flex: 1 }}>
              <Text style={styles.helloEyebrow}>{new Date().toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" })}</Text>
              <Text style={styles.hi} testID="home-greeting">Ciao, {user?.name?.split(" ")[0] || ""}</Text>
            </View>
            {user?.avatar_base64 ? (
              <Image source={{ uri: user.avatar_base64 }} style={styles.heroAvatar} />
            ) : (
              <View style={styles.heroAvatarFallback}><Text style={styles.heroAvatarTxt}>{user?.name?.[0]?.toUpperCase() || "?"}</Text></View>
            )}
          </View>
        </View>
      </LinearGradient>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      >
        {subscription?.status === "trial" && (subscription.days_left ?? 999) <= 7 && (
          <View style={[styles.trialBanner, { backgroundColor: (subscription.days_left ?? 0) <= 3 ? "#FEE2E2" : "#FEF3C7", borderColor: (subscription.days_left ?? 0) <= 3 ? theme.color.error : theme.color.warning }]}>
            <Ionicons name="time" size={18} color={(subscription.days_left ?? 0) <= 3 ? theme.color.error : theme.color.warning} />
            <Text style={styles.trialBannerTxt}>
              Trial in scadenza: {subscription.days_left} giorni residui
            </Text>
          </View>
        )}
        {subscription?.status === "expired" && (
          <View style={[styles.trialBanner, { backgroundColor: "#FEE2E2", borderColor: theme.color.error }]}>
            <Ionicons name="alert-circle" size={18} color={theme.color.error} />
            <Text style={[styles.trialBannerTxt, { color: theme.color.error }]}>Trial scaduto — contatta chi ti ha invitato per rinnovare</Text>
          </View>
        )}
        {!user?.parent_user_id && (
          <Pressable testID="home-master-btn" onPress={() => router.push("/master" as any)} style={styles.masterBtn}>
            <View style={styles.masterIcon}>
              <Ionicons name="grid" size={22} color="#FFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.masterTitle}>Interfaccia Master</Text>
              <Text style={styles.masterSub}>Accesso rapido: Agenda, Contatti, Contratti, Team</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#FFF" />
          </Pressable>
        )}

        <Pressable testID="home-my-thing-btn" onPress={() => router.push("/my-thing")} style={styles.myThingBtn}>
          <View style={styles.myThingIcon}>
            <Ionicons name="sparkles" size={22} color="#FFF" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.myThingTitle}>My Thing</Text>
            <Text style={styles.myThingSub}>Il tuo spazio personale · messaggi, immagini, ricorrenze</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#FFF" />
        </Pressable>

        <View style={styles.statsRow}>
          <View style={[styles.statCard, { borderLeftColor: energyColor }]} testID="stat-energy">
            <View style={[styles.statBadge, { backgroundColor: energyColor + "22" }]}>
              <Ionicons name="flash" size={16} color={energyColor} />
            </View>
            <Text style={[styles.statTitle, { color: energyColor }]} numberOfLines={1}>{settings?.energy_title}</Text>
            <View style={styles.statRow}><Text style={styles.statNum}>{report?.stats.energy.appointments_done ?? 0}</Text><Text style={styles.statLbl}>App. fatti</Text></View>
            <View style={styles.statRow}><Text style={styles.statNum}>{report?.stats.energy.contracts ?? 0}</Text><Text style={styles.statLbl}>Contratti</Text></View>
            <View style={styles.statRow}><Text style={styles.statNum}>{report?.stats.energy.products ?? 0}</Text><Text style={styles.statLbl}>Prodotti</Text></View>
          </View>
          <View style={[styles.statCard, { borderLeftColor: networkColor }]} testID="stat-network">
            <View style={[styles.statBadge, { backgroundColor: networkColor + "22" }]}>
              <Ionicons name="people" size={16} color={networkColor} />
            </View>
            <Text style={[styles.statTitle, { color: networkColor }]} numberOfLines={1}>{settings?.network_title}</Text>
            <View style={styles.statRow}><Text style={styles.statNum}>{report?.stats.network.appointments_done ?? 0}</Text><Text style={styles.statLbl}>App. fatti</Text></View>
            <View style={styles.statRow}><Text style={styles.statNum}>{report?.stats.network.contracts ?? 0}</Text><Text style={styles.statLbl}>Contratti</Text></View>
            <View style={styles.statRow}><Text style={styles.statNum}>{report?.stats.network.products ?? 0}</Text><Text style={styles.statLbl}>Prodotti</Text></View>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Chat & Messaggi</Text>
            <Pressable testID="home-open-chat" onPress={() => router.push("/chat")}>
              <Text style={styles.linkTxt}>Chat interna →</Text>
            </Pressable>
          </View>

          <View style={styles.chatCard}>
            <View style={styles.searchRow}>
              <Ionicons name="search" size={16} color={theme.color.muted} />
              <TextInput
                testID="home-chat-search"
                value={chatQuery}
                onChangeText={setChatQuery}
                placeholder="Cerca contatto o gruppo per nome…"
                placeholderTextColor="#94A3B8"
                style={styles.searchInput}
              />
              {chatQuery.length > 0 && (
                <Pressable onPress={() => setChatQuery("")} hitSlop={10}>
                  <Ionicons name="close-circle" size={16} color={theme.color.muted} />
                </Pressable>
              )}
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
              {[
                { id: "all", name: "Tutti", color: theme.color.brandPrimary },
                { id: "energy", name: settings?.energy_title || "Consulente Energetico", color: energyColor },
                { id: "network", name: settings?.network_title || "Networker", color: networkColor },
                ...(settings?.custom_areas || []),
              ].map((a) => {
                const on = chatAreaFilter === a.id;
                return (
                  <Pressable
                    key={a.id}
                    testID={`home-chat-filter-${a.id}`}
                    onPress={() => setChatAreaFilter(a.id)}
                    style={[styles.filterChip, on && { backgroundColor: a.color, borderColor: a.color }]}
                  >
                    <Text style={[styles.filterChipTxt, on && { color: "#FFF" }]}>{a.name}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {(() => {
              const q = chatQuery.trim().toLowerCase();
              const filteredGroups = groups.filter((g) => !q || g.name.toLowerCase().includes(q));
              const filteredContacts = contacts.filter((c) => {
                if (chatAreaFilter !== "all") {
                  const inArea = c.area === chatAreaFilter || (c.additional_areas || []).includes(chatAreaFilter);
                  if (!inArea) return false;
                }
                if (!q) return true;
                return `${c.first_name} ${c.last_name}`.toLowerCase().includes(q) || (c.phone || "").includes(q);
              });
              const showGroups = chatAreaFilter === "all" ? filteredGroups : [];
              const results = [
                ...showGroups.slice(0, 3).map((g) => ({ type: "group" as const, item: g })),
                ...filteredContacts.slice(0, 6).map((c) => ({ type: "contact" as const, item: c })),
              ];
              if (results.length === 0) {
                return (
                  <View style={styles.chatEmpty}>
                    <Ionicons name="chatbubbles-outline" size={28} color={theme.color.muted} />
                    <Text style={styles.emptyTxt}>{q ? "Nessun risultato" : "Aggiungi contatti e gruppi per iniziare"}</Text>
                  </View>
                );
              }
              return (
                <View style={{ marginTop: 10, gap: 6 }}>
                  {results.map((r) => {
                    if (r.type === "group") {
                      const g = r.item;
                      return (
                        <Pressable
                          key={`g-${g.group_id}`}
                          testID={`home-chat-group-${g.group_id}`}
                          onPress={() => router.push(`/groups/${g.group_id}`)}
                          style={styles.resultCard}
                        >
                          <View style={[styles.avatarLg, { backgroundColor: g.color + "22" }]}>
                            <Ionicons name="people" size={20} color={g.color} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.resultName}>{g.name}</Text>
                            <Text style={styles.resultSub}>Gruppo · {g.member_count} contatt{g.member_count === 1 ? "o" : "i"}</Text>
                          </View>
                          <View style={[styles.grpBadge, { backgroundColor: g.color }]}>
                            <Text style={styles.grpBadgeTxt}>Bulk</Text>
                          </View>
                        </Pressable>
                      );
                    }
                    const c = r.item;
                    const areaColor = c.area === "energy" ? energyColor : c.area === "network" ? networkColor : (settings?.custom_areas || []).find((x) => x.id === c.area)?.color || theme.color.muted;
                    return (
                      <View key={`c-${c.contact_id}`} style={styles.resultCard}>
                        <Pressable style={{ flexDirection: "row", alignItems: "center", flex: 1, gap: 10 }} onPress={() => router.push(`/contact/${c.contact_id}`)}>
                          <View style={[styles.avatarLg, { backgroundColor: areaColor + "22" }]}>
                            <Text style={[styles.avatarLgTxt, { color: areaColor }]}>{(c.first_name?.[0] || "").toUpperCase()}{(c.last_name?.[0] || "").toUpperCase()}</Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.resultName} numberOfLines={1}>{c.first_name} {c.last_name}</Text>
                            <Text style={styles.resultSub} numberOfLines={1}>{c.phone || c.email || "—"}</Text>
                          </View>
                        </Pressable>
                        <View style={styles.commRow}>
                          {(c.whatsapp || c.phone) && (
                            <Pressable
                              testID={`home-wa-${c.contact_id}`}
                              onPress={() => Linking.openURL(`https://wa.me/${(c.whatsapp || c.phone || "").replace(/[^\d+]/g, "")}`)}
                              style={[styles.iconBtn, { backgroundColor: "#25D366" }]}
                            >
                              <Ionicons name="logo-whatsapp" size={14} color="#FFF" />
                            </Pressable>
                          )}
                          {c.telegram && (
                            <Pressable
                              testID={`home-tg-${c.contact_id}`}
                              onPress={() => openTelegram(c.telegram || "")}
                              style={[styles.iconBtn, { backgroundColor: "#0088CC" }]}
                            >
                              <Ionicons name="paper-plane" size={14} color="#FFF" />
                            </Pressable>
                          )}
                          {c.email && (
                            <Pressable
                              testID={`home-mail-${c.contact_id}`}
                              onPress={() => Linking.openURL(`mailto:${c.email}`)}
                              style={[styles.iconBtn, { backgroundColor: "#0F2438" }]}
                            >
                              <Ionicons name="mail" size={14} color="#FFF" />
                            </Pressable>
                          )}
                          {c.phone && (
                            <Pressable
                              testID={`home-call-${c.contact_id}`}
                              onPress={() => Linking.openURL(`tel:${c.phone}`)}
                              style={[styles.iconBtn, { backgroundColor: theme.color.brandPrimary }]}
                            >
                              <Ionicons name="call" size={14} color="#FFF" />
                            </Pressable>
                          )}
                        </View>
                      </View>
                    );
                  })}
                  {(filteredContacts.length > 6 || filteredGroups.length > 3) && (
                    <Pressable onPress={() => router.push("/(tabs)/contatti")} style={{ padding: 8, alignItems: "center" }}>
                      <Text style={styles.linkTxt}>Vedi tutti ({filteredContacts.length} contatti · {filteredGroups.length} gruppi) →</Text>
                    </Pressable>
                  )}
                </View>
              );
            })()}
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Ritelefonate di oggi</Text>
            <Pressable testID="add-callback-btn" onPress={() => router.push("/callback/new")}>
              <Text style={styles.linkTxt}>+ Aggiungi</Text>
            </Pressable>
          </View>
          {callbacks.length === 0 && (
            <View style={styles.empty}><Ionicons name="call-outline" size={28} color={theme.color.muted} /><Text style={styles.emptyTxt}>Nessuna ritelefonata programmata</Text></View>
          )}
          {["energy", "network"].map((area) => {
            const list = callbacks.filter((c) => c.area === area);
            if (list.length === 0) return null;
            const color = area === "energy" ? energyColor : networkColor;
            const title = area === "energy" ? settings?.energy_title : settings?.network_title;
            return (
              <View key={area} style={styles.areaBlock}>
                <View style={styles.areaHead}><View style={[styles.dot, { backgroundColor: color }]} /><Text style={styles.areaTitle}>{title}</Text></View>
                {list.map((cb) => (
                  <CallbackRow
                    key={cb.callback_id}
                    cb={cb}
                    color={color}
                    contacts={contacts}
                    onOpen={() => cb.contact_id && router.push(`/contact/${cb.contact_id}`)}
                    onCall={() => {
                      const contact = contacts.find((x) => x.contact_id === cb.contact_id);
                      setCallTarget({
                        phone: cb.phone || contact?.phone || null,
                        contact_id: cb.contact_id || null,
                        callback_id: cb.callback_id,
                        display_name: cb.title,
                      });
                    }}
                    onToggleDone={async () => {
                      try {
                        await api(`/callbacks/${cb.callback_id}`, { method: "PUT", body: { done: !cb.done } });
                        await load();
                      } catch (e: any) { notify("Errore", e?.message || ""); }
                    }}
                  />
                ))}
              </View>
            );
          })}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Azioni rapide</Text>
          <View style={styles.quickRow}>
            <Pressable testID="qa-new-appt" style={styles.quick} onPress={() => router.push("/appointment/new")}>
              <Ionicons name="calendar-outline" size={22} color={theme.color.brandPrimary} />
              <Text style={styles.quickTxt}>Nuovo appuntamento</Text>
            </Pressable>
            <Pressable testID="qa-new-contact" style={styles.quick} onPress={() => router.push("/contact/new")}>
              <Ionicons name="person-add-outline" size={22} color={theme.color.brandPrimary} />
              <Text style={styles.quickTxt}>Nuovo contatto</Text>
            </Pressable>
          </View>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
      <CallActionSheet
        visible={!!callTarget}
        target={callTarget}
        onClose={() => setCallTarget(null)}
        onCompleted={() => { setCallTarget(null); load(); }}
      />
    </SafeAreaView>
  );
}

function CallbackRow({ cb, color, contacts, onOpen, onCall, onToggleDone }: { cb: Callback; color: string; contacts: Contact[]; onOpen: () => void; onCall: () => void; onToggleDone: () => void }) {
  const [now, setNow] = useState(Date.now());
  const blink = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20000);
    return () => clearInterval(t);
  }, []);

  const dueAt = new Date(cb.scheduled_at).getTime();
  const diffMin = (dueAt - now) / 60000;
  const past = diffMin < 0;
  const urgent = !cb.done && diffMin <= 15;
  const soon = !cb.done && !urgent && diffMin <= 30;
  const upcoming = !cb.done && !urgent && !soon;

  useEffect(() => {
    if (!urgent && !soon) { blink.setValue(1); return; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(blink, { toValue: 0.35, duration: urgent ? 400 : 700, useNativeDriver: false, easing: Easing.inOut(Easing.ease) }),
        Animated.timing(blink, { toValue: 1, duration: urgent ? 400 : 700, useNativeDriver: false, easing: Easing.inOut(Easing.ease) }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [urgent, soon, blink]);

  const bg = cb.done ? "#FFF" : urgent ? "#FEE2E2" : soon ? "#FFEDD5" : upcoming ? "#FEF9C3" : "#FFF";
  const border = cb.done ? "transparent" : urgent ? "#DC2626" : soon ? "#F59E0B" : upcoming ? "#EAB308" : "transparent";
  const hasPhone = !cb.done && (cb.phone || contacts.find((x) => x.contact_id === cb.contact_id)?.phone);

  return (
    <Animated.View style={{ opacity: cb.done ? 0.55 : blink }} testID={`callback-${cb.callback_id}`}>
      <Pressable
        onPress={onOpen}
        style={[
          { flexDirection: "row", backgroundColor: bg, borderRadius: 12, marginBottom: 8, alignItems: "center", overflow: "hidden", borderWidth: 1.5, borderColor: border },
        ]}
      >
        <View style={{ width: 5, backgroundColor: color, alignSelf: "stretch" }} />
        <View style={{ flex: 1, paddingHorizontal: 12, paddingVertical: 10 }}>
          <Text style={[{ fontSize: 15, fontWeight: "700", color: theme.color.onSurface }, cb.done && { textDecorationLine: "line-through" }]}>{cb.title}</Text>
          <Text style={{ fontSize: 12, color: theme.color.muted, marginTop: 2 }}>
            {new Date(cb.scheduled_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            {!cb.done && !past && urgent && "  ⚠ tra pochi minuti"}
            {!cb.done && !past && soon && "  ⏰ tra meno di 30 min"}
            {!cb.done && past && "  · in ritardo"}
            {cb.note ? "  · " + cb.note : ""}
          </Text>
        </View>
        {hasPhone ? (
          <Pressable
            testID={`callback-call-${cb.callback_id}`}
            onPress={(e) => { e.stopPropagation(); onCall(); }}
            style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "#16A34A", justifyContent: "center", alignItems: "center", marginHorizontal: 8 }}
          >
            <Ionicons name="call" size={18} color="#FFF" />
          </Pressable>
        ) : null}
        <Pressable testID={`callback-toggle-${cb.callback_id}`} onPress={(e) => { e.stopPropagation(); onToggleDone(); }} style={{ padding: 10 }}>
          <Ionicons name={cb.done ? "checkmark-circle" : "ellipse-outline"} size={26} color={cb.done ? theme.color.success : theme.color.muted} />
        </Pressable>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  hero: { paddingBottom: 20 },
  heroInner: { paddingHorizontal: 20, paddingTop: 14, gap: 14 },
  heroTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  helloEyebrow: { color: "rgba(255,255,255,0.75)", fontSize: 12, textTransform: "capitalize", fontWeight: "600" },
  hi: { color: "#FFF", fontSize: 24, fontWeight: "700", marginTop: 2 },
  heroAvatar: { width: 46, height: 46, borderRadius: 23, borderWidth: 2, borderColor: "rgba(255,255,255,0.4)" },
  heroAvatarFallback: { width: 46, height: 46, borderRadius: 23, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  heroAvatarTxt: { color: "#FFF", fontSize: 18, fontWeight: "700" },
  scroll: { paddingHorizontal: 16, paddingTop: 16 },
  statsRow: { flexDirection: "row", gap: 12 },
  statCard: { flex: 1, backgroundColor: "#FFF", borderRadius: theme.radius.md, padding: 14, borderLeftWidth: 4, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  statBadge: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  statTitle: { fontSize: 11, fontWeight: "700", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 },
  statRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 3 },
  statNum: { fontSize: 20, fontWeight: "700", color: theme.color.onSurface },
  statLbl: { fontSize: 11, color: theme.color.muted },
  section: { marginTop: 22 },
  sectionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: theme.color.onSurface },
  linkTxt: { color: theme.color.brandPrimary, fontWeight: "600" },
  empty: { alignItems: "center", padding: 22, gap: 8, backgroundColor: "#FFF", borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border, borderStyle: "dashed" },
  emptyTxt: { color: theme.color.muted },
  areaBlock: { marginBottom: 8 },
  areaHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6, marginTop: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  areaTitle: { fontSize: 13, fontWeight: "700", color: theme.color.onSurfaceTertiary },
  cbCard: { flexDirection: "row", backgroundColor: "#FFF", borderRadius: theme.radius.md, marginBottom: 8, alignItems: "center", overflow: "hidden" },
  cbBar: { width: 4, height: "100%", alignSelf: "stretch" },
  cbTitle: { fontSize: 15, fontWeight: "600", color: theme.color.onSurface, paddingHorizontal: 12, paddingTop: 12 },
  cbTime: { fontSize: 12, color: theme.color.muted, paddingHorizontal: 12, paddingBottom: 12, paddingTop: 2 },
  checkBtn: { padding: 12 },
  callIconBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: "#16A34A", alignItems: "center", justifyContent: "center", marginRight: 4 },
  quickRow: { flexDirection: "row", gap: 12 },
  quick: { flex: 1, backgroundColor: "#FFF", padding: 16, borderRadius: theme.radius.md, alignItems: "center", gap: 8, borderWidth: 1, borderColor: theme.color.border },
  quickTxt: { fontWeight: "600", color: theme.color.onSurface, fontSize: 13, textAlign: "center" },
  chatCard: { backgroundColor: "#FFF", borderRadius: theme.radius.md, padding: 12, borderWidth: 1, borderColor: theme.color.border },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: theme.color.surface, borderRadius: theme.radius.md, paddingHorizontal: 10, paddingVertical: 8 },
  searchInput: { flex: 1, fontSize: 14, color: theme.color.onSurface, ...Platform.select({ web: { outlineStyle: "none" as any } }) },
  filterRow: { gap: 6, paddingVertical: 10 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: theme.radius.pill, backgroundColor: "#FFF", borderWidth: 1, borderColor: theme.color.border },
  filterChipTxt: { fontSize: 12, fontWeight: "700", color: theme.color.onSurfaceTertiary },
  chatEmpty: { alignItems: "center", padding: 22, gap: 6 },
  resultCard: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: theme.radius.md, backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border },
  avatarLg: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  avatarLgTxt: { fontWeight: "700", fontSize: 13 },
  resultName: { fontSize: 14, fontWeight: "700", color: theme.color.onSurface },
  resultSub: { fontSize: 11, color: theme.color.muted, marginTop: 2 },
  commRow: { flexDirection: "row", gap: 4 },
  iconBtn: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  grpBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: theme.radius.pill },
  grpBadgeTxt: { color: "#FFF", fontWeight: "700", fontSize: 11 },
  trialBanner: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: theme.radius.md, borderWidth: 1, marginBottom: 12 },
  trialBannerTxt: { flex: 1, fontWeight: "700", fontSize: 13, color: theme.color.onSurface },
  inviteBtn: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: theme.color.brandPrimary, paddingHorizontal: 14, paddingVertical: 12, borderRadius: theme.radius.md, marginBottom: 12 },
  inviteTitle: { color: "#FFF", fontWeight: "700", fontSize: 14 },
  inviteSub: { color: "rgba(255,255,255,0.85)", fontSize: 11, marginTop: 2 },
  myThingBtn: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#7A2E8E", paddingHorizontal: 14, paddingVertical: 12, borderRadius: theme.radius.md, marginBottom: 12 },
  masterBtn: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#1E3A8A", paddingHorizontal: 14, paddingVertical: 12, borderRadius: theme.radius.md, marginBottom: 12 },
  masterIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" },
  masterTitle: { color: "#FFF", fontWeight: "800", fontSize: 15 },
  masterSub: { color: "rgba(255,255,255,0.85)", fontSize: 11, marginTop: 2 },
  myThingIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" },
  myThingTitle: { color: "#FFF", fontWeight: "800", fontSize: 15 },
  myThingSub: { color: "rgba(255,255,255,0.85)", fontSize: 11, marginTop: 2 },
  mtBanner: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: theme.radius.md, borderWidth: 1, marginBottom: 12 },
  mtBannerImg: { width: 52, height: 52, borderRadius: 8 },
  mtBannerIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  mtBannerTitle: { fontSize: 14, fontWeight: "800" },
  mtBannerBody: { fontSize: 12, color: theme.color.onSurface, marginTop: 2 },
});

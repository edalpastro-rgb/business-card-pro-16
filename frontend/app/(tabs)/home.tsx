import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, ActivityIndicator, Image, ImageBackground, Platform, Animated, Easing, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { theme } from "@/src/theme";

type CustomArea = { id: string; name: string; color: string };
type Settings = { energy_title: string; energy_color: string; network_title: string; network_color: string; custom_areas?: CustomArea[] };
type Callback = { callback_id: string; title: string; area: "energy" | "network"; scheduled_at: string; note: string; done: boolean; contact_id?: string; phone?: string };
type ReportStats = { period: string; stats: { energy: any; network: any } };
type MyThingImage = { item_id: string; image_base64?: string | null };

export default function HomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [callbacks, setCallbacks] = useState<Callback[]>([]);
  const [report, setReport] = useState<ReportStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [subscription, setSubscription] = useState<{ status: string; days_left?: number | null; is_active: boolean } | null>(null);
  const [myThingImages, setMyThingImages] = useState<string[]>([]);
  const [myThingIdx, setMyThingIdx] = useState(0);

  const load = useCallback(async () => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const [s, c, r, sub, mt] = await Promise.all([
        api<Settings>("/settings"),
        api<{ items: Callback[] }>("/callbacks", { query: { day: today, include_done: true } }),
        api<ReportStats>("/reports", { query: { period: "day" } }),
        api<any>("/subscription/status").catch(() => null),
        api<{ items: MyThingImage[] }>("/my-thing", { query: { kind: "image" } }).catch(() => ({ items: [] })),
      ]);
      setSettings(s);
      setCallbacks(c.items);
      setReport(r);
      setSubscription(sub);
      const imgs = (mt.items || [])
        .map((it) => it.image_base64)
        .filter((v): v is string => !!v && v.length > 20);
      // Shuffle for random rotation
      for (let i = imgs.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [imgs[i], imgs[j]] = [imgs[j], imgs[i]];
      }
      setMyThingImages(imgs);
      setMyThingIdx(0);
    } catch (e) {
      console.warn(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Auto-cycle My Thing images every 4s with crossfade
  const myThingFade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (myThingImages.length < 2) return;
    const id = setInterval(() => {
      // Fade out
      Animated.timing(myThingFade, { toValue: 0, duration: 350, useNativeDriver: true }).start(() => {
        setMyThingIdx((n) => (n + 1) % myThingImages.length);
        // Fade in
        Animated.timing(myThingFade, { toValue: 1, duration: 350, useNativeDriver: true }).start();
      });
    }, 4000);
    return () => clearInterval(id);
  }, [myThingImages, myThingFade]);

  const myThingImg = myThingImages.length > 0 ? myThingImages[myThingIdx] : null;

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
          {myThingImg ? (
            <Animated.View style={[StyleSheet.absoluteFill, { opacity: myThingFade }]} pointerEvents="none">
              <ImageBackground
                source={{ uri: myThingImg }}
                resizeMode="cover"
                style={StyleSheet.absoluteFill}
                imageStyle={Platform.OS === "web" ? ({ objectFit: "cover", width: "100%", height: "100%" } as any) : undefined}
              />
            </Animated.View>
          ) : null}
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
                    onOpen={() => {
                      if (cb.contact_id) {
                        router.push(`/contact/${cb.contact_id}`);
                      } else {
                        // Nessun contatto collegato: mostrare avviso
                        if (Platform.OS === "web") {
                          window.alert("Nessun contatto collegato a questa ritelefonata.");
                        } else {
                          Alert.alert("Nessun contatto collegato", "Questa ritelefonata non ha un contatto collegato. Usa l'icona matita per modificarla o collegare un contatto.");
                        }
                      }
                    }}
                    onEdit={() => router.push(`/callback/${cb.callback_id}`)}
                    onToggleDone={async () => {
                      try {
                        await api(`/callbacks/${cb.callback_id}`, { method: "PUT", body: { done: !cb.done } });
                        await load();
                      } catch (e: any) { console.warn("Errore toggle callback:", e?.message || e); }
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
    </SafeAreaView>
  );
}

function CallbackRow({ cb, color, onOpen, onEdit, onToggleDone }: { cb: Callback; color: string; onOpen: () => void; onEdit: () => void; onToggleDone: () => void }) {
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

  return (
    <Animated.View style={{ opacity: cb.done ? 0.55 : blink }} testID={`callback-${cb.callback_id}`}>
      <View
        style={{ flexDirection: "row", backgroundColor: bg, borderRadius: 12, marginBottom: 8, alignItems: "stretch", overflow: "hidden", borderWidth: 1.5, borderColor: border }}
      >
        <Pressable
          testID={`callback-open-${cb.callback_id}`}
          onPress={() => { if (typeof onOpen === "function") onOpen(); }}
          android_ripple={{ color: "rgba(0,0,0,0.06)" }}
          style={({ pressed }) => [{ flex: 1, flexDirection: "row", alignItems: "center", opacity: pressed ? 0.75 : 1 }]}
        >
          <View style={{ width: 5, backgroundColor: color, alignSelf: "stretch" }} />
          <View style={{ flex: 1, paddingHorizontal: 12, paddingVertical: 10 }}>
            <Text style={[{ fontSize: 15, fontWeight: "700", color: theme.color.onSurface }, cb.done && { textDecorationLine: "line-through" }]}>{cb.title}</Text>
            <Text style={{ fontSize: 12, color: theme.color.muted, marginTop: 2 }}>
              {new Date(cb.scheduled_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              {!cb.done && !past && urgent ? "  ⚠ tra pochi minuti" : ""}
              {!cb.done && !past && soon ? "  ⏰ tra meno di 30 min" : ""}
              {!cb.done && past ? "  · in ritardo" : ""}
              {cb.note ? "  · " + cb.note : ""}
            </Text>
          </View>
        </Pressable>
        <Pressable
          testID={`callback-edit-${cb.callback_id}`}
          onPress={onEdit}
          hitSlop={8}
          style={({ pressed }) => [{ paddingHorizontal: 8, justifyContent: "center", opacity: pressed ? 0.55 : 1 }]}
        >
          <Ionicons name="pencil" size={18} color={theme.color.brandPrimary} />
        </Pressable>
        <Pressable
          testID={`callback-toggle-${cb.callback_id}`}
          onPress={onToggleDone}
          hitSlop={8}
          style={({ pressed }) => [{ paddingHorizontal: 12, justifyContent: "center", opacity: pressed ? 0.6 : 1 }]}
        >
          <Ionicons name={cb.done ? "checkmark-circle" : "ellipse-outline"} size={26} color={cb.done ? theme.color.success : theme.color.muted} />
        </Pressable>
      </View>
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
  myThingBtn: { backgroundColor: "#F1F5F9", borderRadius: theme.radius.md, marginBottom: 12, overflow: "hidden", position: "relative", height: 120 },
  myThingBgImg: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%", resizeMode: "cover" },
  masterBtn: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#1E3A8A", paddingHorizontal: 14, paddingVertical: 12, borderRadius: theme.radius.md, marginBottom: 12 },
  masterIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" },
  masterTitle: { color: "#FFF", fontWeight: "800", fontSize: 15 },
  masterSub: { color: "rgba(255,255,255,0.85)", fontSize: 11, marginTop: 2 },
  mtBanner: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: theme.radius.md, borderWidth: 1, marginBottom: 12 },
  mtBannerImg: { width: 52, height: 52, borderRadius: 8 },
  mtBannerIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  mtBannerTitle: { fontSize: 14, fontWeight: "800" },
  mtBannerBody: { fontSize: 12, color: theme.color.onSurface, marginTop: 2 },
});

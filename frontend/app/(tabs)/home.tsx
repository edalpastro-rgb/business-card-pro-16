import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, ActivityIndicator, Image, ImageBackground, Platform, Animated, Easing, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import Svg, { Circle, G } from "react-native-svg";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { CallActionSheet, CallTarget } from "@/src/CallActionSheet";
import { HomeEventBanner } from "@/src/HomeEventBanner";

/* ────────────────────────────────────────────────────────────────
   V27 — Modern Dashboard Redesign
   Palette: primary orange #FF6B35 · secondary navy #1B2B4B
   White background · rounded shadow cards · bold KPIs · SVG charts
   ──────────────────────────────────────────────────────────────── */
const C = {
  primary: "#FF6B35",
  primarySoft: "#FFF1E9",
  navy: "#1B2B4B",
  navySoft: "#EEF1F7",
  white: "#FFFFFF",
  bg: "#FFFFFF",
  border: "#EEF0F4",
  muted: "#7A8794",
  text: "#111820",
  success: "#16A34A",
  successSoft: "#DCFCE7",
  danger: "#DC2626",
  dangerSoft: "#FEE2E2",
  warning: "#F59E0B",
  warningSoft: "#FEF3C7",
};

type CustomArea = { id: string; name: string; color: string };
type Settings = { energy_title: string; energy_color: string; network_title: string; network_color: string; custom_areas?: CustomArea[] };
type Callback = { callback_id: string; title: string; area: "energy" | "network"; scheduled_at: string; note: string; done: boolean; contact_id?: string; phone?: string };
type ApptStats = { mine: { total: number; done: number; undone: number }; group: { total: number; done: number; undone: number } };
// V28.b — My Thing banner can rotate BOTH images and messages (Messaggi tab)
type MyThingItem = {
  item_id: string;
  kind: "message" | "image" | "event" | "anniversary";
  title?: string | null;
  body?: string | null;
  image_base64?: string | null;
  color?: string | null;
  active?: boolean;
};
type MyThingBannerSlide =
  | { kind: "image"; image: string }
  | { kind: "message"; title: string; body: string; color: string };

export default function HomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [callbacks, setCallbacks] = useState<Callback[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [subscription, setSubscription] = useState<{ status: string; days_left?: number | null; is_active: boolean } | null>(null);
  const [myThingSlides, setMyThingSlides] = useState<MyThingBannerSlide[]>([]);
  const [myThingIdx, setMyThingIdx] = useState(0);
  const [callTarget, setCallTarget] = useState<CallTarget | null>(null);
  const [apptStats, setApptStats] = useState<ApptStats | null>(null);
  const [contactsCount, setContactsCount] = useState<number>(0);
  const [nowTick, setNowTick] = useState<number>(Date.now());

  // Update header clock every minute (aligned to the next :00 second)
  useEffect(() => {
    let intervalId: any = null;
    const d = new Date();
    const msToNextMinute = (60 - d.getSeconds()) * 1000 - d.getMilliseconds();
    const timeoutId = setTimeout(() => {
      setNowTick(Date.now());
      intervalId = setInterval(() => setNowTick(Date.now()), 60000);
    }, Math.max(500, msToNextMinute));
    return () => {
      clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const [s, c, sub, mtImgs, mtMsgs, ast, cts] = await Promise.all([
        api<Settings>("/settings"),
        api<{ items: Callback[] }>("/callbacks", { query: { day: today, include_done: true } }),
        api<any>("/subscription/status").catch(() => null),
        api<{ items: MyThingItem[] }>("/my-thing", { query: { kind: "image" } }).catch(() => ({ items: [] })),
        // V28.b — also fetch Messaggi so they appear in the rotating banner
        api<{ items: MyThingItem[] }>("/my-thing", { query: { kind: "message" } }).catch(() => ({ items: [] })),
        api<ApptStats>("/appointments/stats", { query: { range_days: 30 } }).catch(() => null),
        api<{ items: any[] }>("/contacts").catch(() => ({ items: [] })),
      ]);
      setSettings(s);
      setCallbacks(c.items);
      setSubscription(sub);
      setApptStats(ast);
      setContactsCount((cts?.items || []).length);
      const imgs = (mtImgs.items || [])
        .filter((it) => it.active !== false)
        .map((it) => it.image_base64)
        .filter((v): v is string => !!v && v.length > 20);
      // Build combined banner slides (images + messages), shuffle for variety
      const messageSlides: MyThingBannerSlide[] = (mtMsgs.items || [])
        .filter((it) => it.active !== false && ((it.body || "").trim() || (it.title || "").trim()))
        .map((it) => ({
          kind: "message" as const,
          title: (it.title || "").trim(),
          body: (it.body || "").trim(),
          color: it.color || "#1B2B4B",
        }));
      const imageSlides: MyThingBannerSlide[] = imgs.map((img) => ({ kind: "image" as const, image: img }));
      const combined: MyThingBannerSlide[] = [...imageSlides, ...messageSlides];
      for (let i = combined.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [combined[i], combined[j]] = [combined[j], combined[i]];
      }
      setMyThingSlides(combined);
      setMyThingIdx(0);
    } catch (e) {
      console.warn(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Refresh at midnight
  useEffect(() => {
    const t = setInterval(() => {
      const d = new Date();
      if (d.getHours() === 0 && d.getMinutes() < 2) load();
    }, 60000);
    return () => clearInterval(t);
  }, [load]);

  // Auto-cycle My Thing banner (images + messages)
  const myThingFade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (myThingSlides.length < 2) return;
    const id = setInterval(() => {
      Animated.timing(myThingFade, { toValue: 0, duration: 350, useNativeDriver: true }).start(() => {
        setMyThingIdx((n) => (n + 1) % myThingSlides.length);
        Animated.timing(myThingFade, { toValue: 1, duration: 350, useNativeDriver: true }).start();
      });
    }, 10000);
    return () => clearInterval(id);
  }, [myThingSlides, myThingFade]);

  const myThingSlide = myThingSlides.length > 0 ? myThingSlides[myThingIdx] : null;

  // KPI derived values
  const nowMs = Date.now();
  const cbTodayTotal = callbacks.length;
  const cbDone = callbacks.filter((c) => c.done).length;
  const cbLate = callbacks.filter((c) => !c.done && new Date(c.scheduled_at).getTime() < nowMs).length;
  const cbPending = cbTodayTotal - cbDone;
  const cbEnergy = callbacks.filter((c) => c.area === "energy").length;
  const cbNetwork = callbacks.filter((c) => c.area === "network").length;
  const apptTotal = apptStats?.mine?.total || 0;
  const apptDone = apptStats?.mine?.done || 0;
  const apptUndone = apptStats?.mine?.undone || 0;

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <View style={styles.center}><ActivityIndicator color={C.primary} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.primary} />}
      >
        {/* ── Header ── */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>
              {new Date(nowTick).toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" })}
              {" · "}
              {new Date(nowTick).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}
            </Text>
            <Text style={styles.hi} testID="home-greeting">Ciao, <Text style={{ color: C.primary }}>{user?.name?.split(" ")[0] || ""}</Text></Text>
          </View>
          <Pressable onPress={() => router.push("/impostazioni" as any)} hitSlop={8}>
            {user?.avatar_base64 ? (
              <Image source={{ uri: user.avatar_base64 }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarFallback}><Text style={styles.avatarTxt}>{user?.name?.[0]?.toUpperCase() || "?"}</Text></View>
            )}
          </Pressable>
        </View>

        {/* ── Trial banners ── */}
        {subscription?.status === "trial" && (subscription.days_left ?? 999) <= 7 && (
          <View style={[styles.banner, { backgroundColor: (subscription.days_left ?? 0) <= 3 ? C.dangerSoft : C.warningSoft, borderColor: (subscription.days_left ?? 0) <= 3 ? C.danger : C.warning }]}>
            <Ionicons name="time" size={18} color={(subscription.days_left ?? 0) <= 3 ? C.danger : C.warning} />
            <Text style={styles.bannerTxt}>Trial in scadenza: {subscription.days_left} giorni residui</Text>
          </View>
        )}
        {subscription?.status === "expired" && (
          <View style={[styles.banner, { backgroundColor: C.dangerSoft, borderColor: C.danger }]}>
            <Ionicons name="alert-circle" size={18} color={C.danger} />
            <Text style={[styles.bannerTxt, { color: C.danger }]}>Trial scaduto — contatta chi ti ha invitato per rinnovare</Text>
          </View>
        )}

        {/* ── 2) Banner My Thing (immersive rotating: images + messages) ── */}
        <Pressable testID="home-my-thing-btn" onPress={() => router.push("/my-thing")} style={styles.myThingBtn}>
          {myThingSlide ? (
            <Animated.View style={[StyleSheet.absoluteFill, { opacity: myThingFade }]} pointerEvents="none">
              {myThingSlide.kind === "image" ? (
                <ImageBackground
                  source={{ uri: myThingSlide.image }}
                  resizeMode="cover"
                  style={StyleSheet.absoluteFill}
                  imageStyle={Platform.OS === "web" ? ({ objectFit: "cover", width: "100%", height: "100%" } as any) : undefined}
                />
              ) : (
                <View style={[StyleSheet.absoluteFill, styles.myThingMsg, { backgroundColor: myThingSlide.color }]}>
                  {myThingSlide.title ? (
                    <Text style={styles.myThingMsgTitle} numberOfLines={1}>
                      {myThingSlide.title}
                    </Text>
                  ) : null}
                  <Text
                    style={[styles.myThingMsgBody, myThingSlide.title ? null : { fontSize: 16 }]}
                    numberOfLines={myThingSlide.title ? 3 : 4}
                  >
                    {myThingSlide.body}
                  </Text>
                </View>
              )}
            </Animated.View>
          ) : (
            <View style={styles.myThingEmpty}>
              <Ionicons name="images-outline" size={22} color={C.primary} />
              <Text style={styles.myThingEmptyTxt}>Personalizza il tuo spazio</Text>
            </View>
          )}
        </Pressable>

        {/* ── 2b) Banner Evento ── */}
        <HomeEventBanner />

        {/* ── 3) Bottone Interfaccia Master ── */}
        {!user?.parent_user_id && (
          <Pressable testID="home-master-btn" onPress={() => router.push("/master" as any)} style={styles.masterCard}>
            <View style={styles.masterIcon}>
              <Ionicons name="grid" size={20} color={C.white} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.masterTitle}>Interfaccia Master</Text>
              <Text style={styles.masterSub}>Agenda · Contatti · Contratti · Team</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={C.white} />
          </Pressable>
        )}

        {/* ── 4) Ritelefonate di oggi ── */}
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Ritelefonate di oggi</Text>
            <View style={styles.pill}><Text style={styles.pillTxt}>{cbTodayTotal}</Text></View>
          </View>
          <Pressable testID="add-callback-btn" onPress={() => router.push("/callback/new")} style={styles.addBtn}>
            <Ionicons name="add-circle" size={20} color={C.white} />
            <Text style={styles.addBtnTxt}>Aggiungi Telefonata</Text>
          </Pressable>
          {callbacks.length === 0 && (
            <View style={styles.empty}>
              <Ionicons name="call-outline" size={28} color={C.muted} />
              <Text style={styles.emptyTxt}>Nessuna ritelefonata programmata</Text>
            </View>
          )}
          {["energy", "network"].map((area) => {
            const list = callbacks.filter((c) => c.area === area);
            if (list.length === 0) return null;
            const color = area === "energy" ? (settings?.energy_color || C.primary) : (settings?.network_color || C.navy);
            const title = area === "energy" ? settings?.energy_title : settings?.network_title;
            return (
              <View key={area} style={styles.areaBlock}>
                <View style={styles.areaHead}>
                  <View style={[styles.dot, { backgroundColor: color }]} />
                  <Text style={styles.areaTitle}>{title}</Text>
                </View>
                {list.map((cb) => (
                  <CallbackRow
                    key={cb.callback_id}
                    cb={cb}
                    color={color}
                    onOpen={() => {
                      if (cb.contact_id) {
                        router.push(`/contact/${cb.contact_id}`);
                      } else if (cb.phone) {
                        setCallTarget({ phone: cb.phone, contact_id: null, callback_id: cb.callback_id, display_name: cb.title });
                      } else {
                        if (Platform.OS === "web") {
                          window.alert("Questa ritelefonata non ha un contatto collegato né un numero di telefono. Usa l'icona matita per aggiungerlo.");
                        } else {
                          Alert.alert("Nessun numero disponibile", "Questa ritelefonata non ha né contatto collegato né numero di telefono. Usa l'icona matita per modificarla.");
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

        {/* ── 5) Azioni rapide ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Azioni rapide</Text>
          <View style={styles.quickRow}>
            <Pressable testID="qa-new-appt" style={styles.quick} onPress={() => router.push("/appointment/new")}>
              <View style={[styles.quickIcon, { backgroundColor: C.primarySoft }]}>
                <Ionicons name="calendar-outline" size={20} color={C.primary} />
              </View>
              <Text style={styles.quickTxt}>Nuovo appuntamento</Text>
            </Pressable>
            <Pressable testID="qa-new-contact" style={styles.quick} onPress={() => router.push("/contact/new")}>
              <View style={[styles.quickIcon, { backgroundColor: C.navySoft }]}>
                <Ionicons name="person-add-outline" size={20} color={C.navy} />
              </View>
              <Text style={styles.quickTxt}>Nuovo contatto</Text>
            </Pressable>
          </View>
        </View>

        {/* ── 6) Statistiche ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Statistiche</Text>

          {/* KPI cards 2×2 */}
          <View style={styles.kpiRow}>
            <KpiCard
              testID="kpi-callbacks"
              label="Ritelefonate oggi"
              value={cbTodayTotal}
              icon="call"
              accent={C.primary}
              hint={cbLate > 0 ? `${cbLate} in ritardo` : cbDone > 0 ? `${cbDone} completate` : "nessuna urgenza"}
              hintColor={cbLate > 0 ? C.danger : C.success}
              onPress={() => router.push("/callbacks-list" as any)}
            />
            <KpiCard
              testID="kpi-appointments"
              label="Appuntamenti 30gg"
              value={apptTotal}
              icon="calendar"
              accent={C.navy}
              hint={`${apptDone} fatti · ${apptUndone} da fare`}
              hintColor={C.muted}
              onPress={() => router.push("/(tabs)/calendario" as any)}
            />
          </View>
          <View style={[styles.kpiRow, { marginTop: 12 }]}>
            <KpiCard
              testID="kpi-contacts"
              label="Contatti totali"
              value={contactsCount}
              icon="people"
              accent={C.primary}
              hint="in rubrica"
              hintColor={C.muted}
              onPress={() => router.push("/(tabs)/contatti" as any)}
            />
            <KpiCard
              testID="kpi-done-today"
              label="Fatte oggi"
              value={cbDone}
              icon="checkmark-done"
              accent={C.navy}
              hint={cbPending > 0 ? `${cbPending} da chiudere` : "tutto ok"}
              hintColor={cbPending > 0 ? C.warning : C.success}
              onPress={() => router.push("/callbacks-list" as any)}
            />
          </View>

          {/* Charts: donut + bar */}
          {(apptTotal > 0 || cbTodayTotal > 0) && (
            <View style={[styles.chartsRow, { marginTop: 12 }]}>
              <View style={[styles.card, styles.donutCard]}>
                <Text style={styles.cardTitle}>Appuntamenti</Text>
                <Text style={styles.cardSub}>ultimi 30 giorni</Text>
                <View style={styles.donutWrap}>
                  <DonutChart
                    size={120}
                    strokeWidth={14}
                    segments={[
                      { value: apptDone, color: C.primary },
                      { value: apptUndone, color: C.navy },
                    ]}
                    centerLabel={apptTotal > 0 ? `${Math.round((apptDone / apptTotal) * 100)}%` : "0%"}
                    centerSub="fatti"
                  />
                </View>
                <View style={styles.legend}>
                  <LegendDot color={C.primary} label={`Fatti · ${apptDone}`} />
                  <LegendDot color={C.navy} label={`Da fare · ${apptUndone}`} />
                </View>
              </View>

              <View style={[styles.card, styles.donutCard]}>
                <Text style={styles.cardTitle}>Ritelefonate</Text>
                <Text style={styles.cardSub}>di oggi per area</Text>
                <View style={{ marginTop: 14, marginBottom: 8 }}>
                  <BarRow label={settings?.energy_title || "Energy"} value={cbEnergy} max={Math.max(1, cbEnergy, cbNetwork)} color={C.primary} />
                  <BarRow label={settings?.network_title || "Network"} value={cbNetwork} max={Math.max(1, cbEnergy, cbNetwork)} color={C.navy} />
                  <BarRow label="In ritardo" value={cbLate} max={Math.max(1, cbEnergy, cbNetwork, cbLate)} color={C.danger} />
                </View>
              </View>
            </View>
          )}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      <CallActionSheet
        visible={!!callTarget}
        target={callTarget}
        onClose={() => setCallTarget(null)}
        onCompleted={(res) => {
          setCallTarget(null);
          load();
          if (res?.outcome_id === "call_appointment") {
            const cid = callTarget?.contact_id;
            if (cid) router.push(`/appointment/new?contact_id=${cid}`);
          }
        }}
      />
    </SafeAreaView>
  );
}

/* ═══════════════════════ Reusable UI bits ═══════════════════════ */

function KpiCard({ testID, label, value, icon, accent, hint, hintColor, onPress }: {
  testID?: string; label: string; value: number; icon: any; accent: string; hint?: string; hintColor?: string; onPress?: () => void;
}) {
  return (
    <Pressable testID={testID} onPress={onPress} style={({ pressed }) => [styles.kpi, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}>
      <View style={[styles.kpiIconBadge, { backgroundColor: accent + "18" }]}>
        <Ionicons name={icon} size={16} color={accent} />
      </View>
      <Text style={styles.kpiValue}>{value}</Text>
      <Text style={styles.kpiLabel} numberOfLines={1}>{label}</Text>
      {!!hint && <Text style={[styles.kpiHint, { color: hintColor || C.muted }]} numberOfLines={1}>{hint}</Text>}
    </Pressable>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendLabel}>{label}</Text>
    </View>
  );
}

function BarRow({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.max(6, (value / max) * 100) : 0;
  return (
    <View style={styles.barRow}>
      <View style={styles.barTop}>
        <Text style={styles.barLabel} numberOfLines={1}>{label}</Text>
        <Text style={styles.barValue}>{value}</Text>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: value > 0 ? color : "transparent" }]} />
      </View>
    </View>
  );
}

/* Simple animated SVG donut chart */
function DonutChart({ size, strokeWidth, segments, centerLabel, centerSub }: {
  size: number; strokeWidth: number; segments: { value: number; color: string }[]; centerLabel?: string; centerSub?: string;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = segments.reduce((a, b) => a + b.value, 0);
  const hasData = total > 0;

  let offset = 0;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size}>
        <G rotation={-90} origin={`${size / 2}, ${size / 2}`}>
          {/* Track */}
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={C.border}
            strokeWidth={strokeWidth}
            fill="transparent"
          />
          {hasData && segments.map((seg, i) => {
            if (seg.value <= 0) return null;
            const dash = (seg.value / total) * circumference;
            const el = (
              <Circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                stroke={seg.color}
                strokeWidth={strokeWidth}
                fill="transparent"
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
              />
            );
            offset += dash;
            return el;
          })}
        </G>
      </Svg>
      <View style={StyleSheet.absoluteFill as any} pointerEvents="none">
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={styles.donutCenterLabel}>{centerLabel}</Text>
          {!!centerSub && <Text style={styles.donutCenterSub}>{centerSub}</Text>}
        </View>
      </View>
    </View>
  );
}

/* ═══════════════════════ Callback Row (kept behavior, updated look) ═══════════════════════ */

function CallbackRow({ cb, color, onOpen, onEdit, onToggleDone }: { cb: Callback; color: string; onOpen: () => void; onEdit: () => void; onToggleDone: () => void }) {
  const [now, setNow] = useState(Date.now());
  const sweep = useRef(new Animated.Value(0)).current;

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
    if (!urgent && !soon) { sweep.setValue(0); return; }
    const cycle = urgent ? 2000 : 3200;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sweep, { toValue: 1, duration: cycle, useNativeDriver: false, easing: Easing.inOut(Easing.ease) }),
        Animated.timing(sweep, { toValue: 0, duration: 0, useNativeDriver: false }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [urgent, soon, sweep]);

  const bg = cb.done ? C.white : urgent ? C.dangerSoft : soon ? "#FFEDD5" : upcoming ? C.warningSoft : C.white;
  const border = cb.done ? C.border : urgent ? C.danger : soon ? "#F59E0B" : upcoming ? "#EAB308" : C.border;
  const sweepColor = urgent ? "rgba(220,38,38,0.22)" : "rgba(245,158,11,0.18)";

  return (
    <View style={{ opacity: cb.done ? 0.55 : 1 }} testID={`callback-${cb.callback_id}`}>
      <View style={{ flexDirection: "row", backgroundColor: bg, borderRadius: 14, marginBottom: 8, alignItems: "stretch", overflow: "hidden", borderWidth: 1, borderColor: border, position: "relative" }}>
        {(urgent || soon) && !cb.done ? (
          <Animated.View
            pointerEvents="none"
            style={{
              position: "absolute", left: 0, top: 0, bottom: 0,
              width: sweep.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }),
              backgroundColor: sweepColor, zIndex: 0,
            }}
          />
        ) : null}
        <Pressable
          testID={`callback-open-${cb.callback_id}`}
          onPress={() => { if (typeof onOpen === "function") onOpen(); }}
          android_ripple={{ color: "rgba(0,0,0,0.06)" }}
          style={({ pressed }) => [{ flex: 1, flexDirection: "row", alignItems: "center", opacity: pressed ? 0.75 : 1, zIndex: 1 }]}
        >
          <View style={{ width: 5, backgroundColor: color, alignSelf: "stretch" }} />
          <View style={{ flex: 1, paddingHorizontal: 12, paddingVertical: 12 }}>
            <Text style={[{ fontSize: 15, fontWeight: "700", color: C.text }, cb.done && { textDecorationLine: "line-through" }]}>{cb.title}</Text>
            <Text style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
              {new Date(cb.scheduled_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              {!cb.done && !past && urgent ? "  ⚠ tra pochi minuti" : ""}
              {!cb.done && !past && soon ? "  ⏰ tra meno di 30 min" : ""}
              {!cb.done && past ? "  · in ritardo" : ""}
              {cb.note ? "  · " + cb.note : ""}
            </Text>
          </View>
        </Pressable>
        <Pressable testID={`callback-edit-${cb.callback_id}`} onPress={onEdit} hitSlop={8} style={({ pressed }) => [{ paddingHorizontal: 8, justifyContent: "center", opacity: pressed ? 0.55 : 1, zIndex: 1 }]}>
          <Ionicons name="pencil" size={18} color={C.primary} />
        </Pressable>
        <Pressable testID={`callback-toggle-${cb.callback_id}`} onPress={onToggleDone} hitSlop={8} style={({ pressed }) => [{ paddingHorizontal: 12, justifyContent: "center", opacity: pressed ? 0.6 : 1, zIndex: 1 }]}>
          <Ionicons name={cb.done ? "checkmark-circle" : "ellipse-outline"} size={26} color={cb.done ? C.success : C.muted} />
        </Pressable>
      </View>
    </View>
  );
}

/* ═══════════════════════ Styles ═══════════════════════ */

const cardShadow = Platform.select({
  ios: { shadowColor: "#0F172A", shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } },
  android: { elevation: 3 },
  default: { shadowColor: "#0F172A", shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } },
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 180 },

  /* Header */
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 },
  eyebrow: { color: C.muted, fontSize: 12, textTransform: "capitalize", fontWeight: "600" },
  hi: { color: C.navy, fontSize: 26, fontWeight: "800", marginTop: 2, letterSpacing: -0.5 },
  avatar: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: C.primarySoft },
  avatarFallback: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.navy, alignItems: "center", justifyContent: "center" },
  avatarTxt: { color: C.white, fontSize: 16, fontWeight: "800" },

  /* Banners */
  banner: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 12 },
  bannerTxt: { flex: 1, fontWeight: "700", fontSize: 13, color: C.text },

  /* KPI */
  kpiRow: { flexDirection: "row", gap: 12, marginTop: 8 },
  kpi: {
    flex: 1, backgroundColor: C.white, borderRadius: 18, padding: 14,
    borderWidth: 1, borderColor: C.border,
    ...(cardShadow as any),
  },
  kpiIconBadge: { width: 30, height: 30, borderRadius: 10, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  kpiValue: { fontSize: 32, fontWeight: "900", color: C.navy, letterSpacing: -1 },
  kpiLabel: { fontSize: 12, fontWeight: "700", color: C.text, marginTop: 2 },
  kpiHint: { fontSize: 11, fontWeight: "600", marginTop: 4 },

  /* Master */
  masterCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: C.navy,
    paddingHorizontal: 14, paddingVertical: 14, borderRadius: 16,
    marginTop: 16, marginBottom: 12,
    ...(cardShadow as any),
  },
  masterIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: C.primary, alignItems: "center", justifyContent: "center" },
  masterTitle: { color: C.white, fontWeight: "800", fontSize: 15 },
  masterSub: { color: "rgba(255,255,255,0.75)", fontSize: 11, marginTop: 2, fontWeight: "600" },

  /* Charts */
  chartsRow: { flexDirection: "row", gap: 12, marginTop: 12 },
  card: { flex: 1, backgroundColor: C.white, borderRadius: 18, padding: 14, borderWidth: 1, borderColor: C.border, ...(cardShadow as any) },
  donutCard: { minHeight: 220 },
  cardTitle: { fontSize: 14, fontWeight: "800", color: C.navy },
  cardSub: { fontSize: 11, color: C.muted, marginTop: 2, fontWeight: "600" },
  donutWrap: { alignItems: "center", justifyContent: "center", marginTop: 10 },
  donutCenterLabel: { fontSize: 20, fontWeight: "900", color: C.navy, letterSpacing: -0.5 },
  donutCenterSub: { fontSize: 10, color: C.muted, fontWeight: "700", marginTop: 2, textTransform: "uppercase", letterSpacing: 0.6 },
  legend: { marginTop: 12, gap: 6 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 8 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendLabel: { fontSize: 11, fontWeight: "700", color: C.text },

  /* Bars */
  barRow: { marginBottom: 12 },
  barTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  barLabel: { fontSize: 12, fontWeight: "700", color: C.text, flex: 1 },
  barValue: { fontSize: 14, fontWeight: "900", color: C.navy },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: C.navySoft, overflow: "hidden" },
  barFill: { height: 8, borderRadius: 4 },

  /* My Thing */
  myThingBtn: { backgroundColor: C.primarySoft, borderRadius: 16, marginTop: 12, marginBottom: 4, overflow: "hidden", position: "relative", height: 120, borderWidth: 1, borderColor: C.border },
  myThingEmpty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6 },
  myThingEmptyTxt: { color: C.primary, fontWeight: "700", fontSize: 13 },
  // V28.b — Message-style slide inside the My Thing banner
  myThingMsg: { padding: 16, justifyContent: "center", alignItems: "flex-start", gap: 6 },
  myThingMsgTitle: { color: "#FFF", fontWeight: "800", fontSize: 14, letterSpacing: 0.2, textTransform: "uppercase", opacity: 0.9 },
  myThingMsgBody: { color: "#FFF", fontWeight: "700", fontSize: 15, lineHeight: 21 },

  /* Section */
  section: { marginTop: 22 },
  sectionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  sectionTitle: { fontSize: 17, fontWeight: "800", color: C.navy, letterSpacing: -0.3 },
  pill: { backgroundColor: C.primarySoft, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
  pillTxt: { color: C.primary, fontWeight: "800", fontSize: 12 },

  addBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: C.primary, paddingVertical: 13, borderRadius: 14, marginBottom: 12,
    ...(cardShadow as any),
  },
  addBtnTxt: { color: C.white, fontSize: 14, fontWeight: "800" },

  empty: { alignItems: "center", padding: 22, gap: 8, backgroundColor: C.white, borderRadius: 14, borderWidth: 1, borderColor: C.border, borderStyle: "dashed" },
  emptyTxt: { color: C.muted, fontWeight: "600" },

  areaBlock: { marginBottom: 8 },
  areaHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6, marginTop: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  areaTitle: { fontSize: 12, fontWeight: "800", color: C.navy, textTransform: "uppercase", letterSpacing: 0.5 },

  /* Quick */
  quickRow: { flexDirection: "row", gap: 12 },
  quick: {
    flex: 1, backgroundColor: C.white, padding: 14, borderRadius: 16, alignItems: "flex-start", gap: 10,
    borderWidth: 1, borderColor: C.border,
    ...(cardShadow as any),
  },
  quickIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  quickTxt: { fontWeight: "800", color: C.navy, fontSize: 13 },
});

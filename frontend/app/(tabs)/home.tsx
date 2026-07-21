import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, ActivityIndicator, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useFocusEffect } from "expo-router";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { theme } from "@/src/theme";

type Settings = { energy_title: string; energy_color: string; network_title: string; network_color: string };
type Callback = { callback_id: string; title: string; area: "energy" | "network"; scheduled_at: string; note: string; done: boolean; contact_id?: string };
type ReportStats = { period: string; stats: { energy: any; network: any } };

export default function HomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [callbacks, setCallbacks] = useState<Callback[]>([]);
  const [report, setReport] = useState<ReportStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const [s, c, r] = await Promise.all([
        api<Settings>("/settings"),
        api<{ items: Callback[] }>("/callbacks", { query: { day: today, include_done: true } }),
        api<ReportStats>("/reports", { query: { period: "day" } }),
      ]);
      setSettings(s);
      setCallbacks(c.items);
      setReport(r);
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
          <Pressable testID="home-add-btn" onPress={() => router.push("/appointment/new")} style={styles.heroCTA}>
            <Ionicons name="add-circle" size={20} color={theme.color.brandPrimary} />
            <Text style={styles.heroCTATxt}>Nuovo appuntamento</Text>
          </Pressable>
        </View>
      </LinearGradient>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      >
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
                  <Pressable
                    key={cb.callback_id}
                    testID={`callback-${cb.callback_id}`}
                    onPress={() => cb.contact_id && router.push(`/contact/${cb.contact_id}`)}
                    style={[styles.cbCard, cb.done && { opacity: 0.55 }]}
                  >
                    <View style={[styles.cbBar, { backgroundColor: color }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.cbTitle, cb.done && { textDecorationLine: "line-through" }]}>{cb.title}</Text>
                      <Text style={styles.cbTime}>{new Date(cb.scheduled_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} {cb.note ? "· " + cb.note : ""}</Text>
                    </View>
                    <Pressable
                      testID={`callback-toggle-${cb.callback_id}`}
                      onPress={async (e) => {
                        e.stopPropagation();
                        await api(`/callbacks/${cb.callback_id}`, { method: "PUT", body: { done: !cb.done } });
                        load();
                      }}
                      style={styles.checkBtn}
                    >
                      <Ionicons name={cb.done ? "checkmark-circle" : "ellipse-outline"} size={26} color={cb.done ? theme.color.success : theme.color.muted} />
                    </Pressable>
                  </Pressable>
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
  heroCTA: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#FFF", paddingHorizontal: 16, paddingVertical: 12, borderRadius: theme.radius.md, alignSelf: "flex-start" },
  heroCTATxt: { color: theme.color.brandPrimary, fontWeight: "700", fontSize: 14 },
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
  quickRow: { flexDirection: "row", gap: 12 },
  quick: { flex: 1, backgroundColor: "#FFF", padding: 16, borderRadius: theme.radius.md, alignItems: "center", gap: 8, borderWidth: 1, borderColor: theme.color.border },
  quickTxt: { fontWeight: "600", color: theme.color.onSurface, fontSize: 13, textAlign: "center" },
});

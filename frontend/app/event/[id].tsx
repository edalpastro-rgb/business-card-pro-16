import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Image, ScrollView, Platform, Share } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";
import { FileViewer } from "@/src/FileViewer";
import { ShareSheet, type ShareTarget } from "@/src/ShareSheet";
import { ModuleErrorBoundary } from "@/src/shared";

function pad(n: number): string { return String(n).padStart(2, "0"); }

function useCountdown(target: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  let d = Math.max(0, target - now);
  const days = Math.floor(d / 86400000); d -= days * 86400000;
  const hours = Math.floor(d / 3600000); d -= hours * 3600000;
  const minutes = Math.floor(d / 60000); d -= minutes * 60000;
  const seconds = Math.floor(d / 1000);
  return { days, hours, minutes, seconds, passed: (target - now) <= 0 };
}

export default function EventRoute() {
  return (
    <ModuleErrorBoundary moduleName="events">
      <EventScreen />
    </ModuleErrorBoundary>
  );
}

function EventScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const eventId = String(id || "");
  const [ev, setEv] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [program, setProgram] = useState<null | { kind: "pdf" | "html"; name: string; mime: string; data_base64: string }>(null);
  const [shareTarget, setShareTarget] = useState<ShareTarget | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<any>(`/event-banners/${eventId}`);
      setEv(r);
    } catch (e: any) {
      notify("Errore", e?.message || "");
    } finally { setLoading(false); }
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  const openProgram = async () => {
    try {
      const r = await api<any>(`/event-banners/${eventId}/program`);
      setProgram(r);
    } catch (e: any) {
      notify("Nessun programma", e?.message || "Il master non ha ancora caricato o generato il programma per questo evento.");
    }
  };

  const sharePublicLink = async () => {
    if (!ev?.public_token) return;
    const url = `${process.env.EXPO_BACKEND_URL || ""}/api/public/event-banners/${ev.public_token}`.replace(/\/+$/g, (m) => m).replace(/(https?:\/\/[^/]+)\/api/, "$1/api");
    try {
      if (Platform.OS === "web") {
        const nav: any = (globalThis as any).navigator;
        if (nav?.share) {
          await nav.share({ title: ev.title, url });
          return;
        }
        await (globalThis as any).navigator.clipboard.writeText(url);
        notify("Link copiato", "Link pubblico dell'evento copiato negli appunti.");
      } else {
        await Share.share({ message: `${ev.title}\n${url}`, url });
      }
    } catch (e: any) {
      // AbortError silenzioso; log altrimenti
      if (e?.name !== "AbortError") console.warn(e);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <View style={styles.header}>
          <Pressable testID="back-btn" onPress={() => router.back()} hitSlop={10}>
            <Ionicons name="chevron-back" size={26} color={theme.color.onSurface} />
          </Pressable>
          <Text style={styles.title}>Evento</Text>
          <View style={{ width: 26 }} />
        </View>
        <ActivityIndicator style={{ marginTop: 40 }} color={theme.color.brandPrimary} />
      </SafeAreaView>
    );
  }

  if (!ev) {
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <Text style={{ padding: 20, color: theme.color.muted }}>Evento non disponibile.</Text>
      </SafeAreaView>
    );
  }

  const target = new Date(ev.event_at).getTime();
  const cd = useCountdown(target);
  const cover = ev.cover_base64 ? `data:${ev.cover_mime || "image/jpeg"};base64,${ev.cover_base64}` : null;
  const dateFmt = new Date(ev.event_at).toLocaleString("it-IT", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable testID="back-btn" onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>Evento</Text>
        <Pressable testID="event-share-link" onPress={sharePublicLink} hitSlop={10}>
          <Ionicons name="share-social" size={22} color={theme.color.brandPrimary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={styles.hero}>
          {cover ? (
            <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: "#1E3A5F" }]} />
          )}
          <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.5)" }]} />
          <View style={styles.heroInner}>
            <Text style={styles.heroTitle}>{ev.title}</Text>
            <Text style={styles.heroWhen}>{dateFmt}</Text>
            {cd.passed ? (
              <View style={[styles.badge, { backgroundColor: "rgba(220,38,38,0.9)" }]}>
                <Text style={{ color: "#FFF", fontWeight: "800", fontSize: 12 }}>Evento in corso o passato</Text>
              </View>
            ) : (
              <View style={styles.cdRow}>
                <CdBox n={cd.days} l="giorni" />
                <CdBox n={cd.hours} l="ore" />
                <CdBox n={cd.minutes} l="min" />
                <CdBox n={cd.seconds} l="sec" />
              </View>
            )}
          </View>
        </View>

        <View style={{ padding: 16, gap: 10 }}>
          <Pressable testID="event-open-program" onPress={openProgram} style={[styles.actionBtn, { backgroundColor: "#F59E0B" }]}>
            <Ionicons name="document-text" size={18} color="#FFF" />
            <Text style={styles.actionTxt}>Apri il programma</Text>
          </Pressable>
          <Pressable testID="event-share-public" onPress={sharePublicLink} style={[styles.actionBtn, { backgroundColor: "#7C3AED" }]}>
            <Ionicons name="link" size={18} color="#FFF" />
            <Text style={styles.actionTxt}>Condividi link pubblico</Text>
          </Pressable>
        </View>
      </ScrollView>

      <FileViewer
        visible={!!program}
        onClose={() => setProgram(null)}
        fileName={program?.name || "programma"}
        mime={program?.mime || "application/pdf"}
        dataBase64={program?.data_base64 || ""}
        onShare={program ? () => {
          setShareTarget({
            id: eventId,
            name: program.name,
            mime: program.mime,
            data_base64: program.data_base64,
          });
        } : undefined}
      />
      <ShareSheet visible={!!shareTarget} target={shareTarget} onClose={() => setShareTarget(null)} />
    </SafeAreaView>
  );
}

function CdBox({ n, l }: { n: number; l: string }) {
  return (
    <View style={styles.cdBox}>
      <Text style={styles.cdN}>{pad(n)}</Text>
      <Text style={styles.cdL}>{l}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.color.border, backgroundColor: theme.color.surface },
  title: { fontSize: 18, fontWeight: "800", color: theme.color.onSurface },
  hero: { width: "100%", height: 320, overflow: "hidden" },
  heroInner: { flex: 1, justifyContent: "flex-end", padding: 22 },
  heroTitle: { color: "#FFF", fontSize: 26, fontWeight: "900", lineHeight: 30, textShadowColor: "rgba(0,0,0,0.5)", textShadowRadius: 4 },
  heroWhen: { color: "rgba(255,255,255,0.85)", fontSize: 14, marginTop: 4 },
  badge: { alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, marginTop: 12 },
  cdRow: { flexDirection: "row", gap: 6, marginTop: 14 },
  cdBox: { flex: 1, backgroundColor: "rgba(255,255,255,0.14)", borderRadius: 10, paddingVertical: 10, alignItems: "center" },
  cdN: { fontSize: 22, fontWeight: "900", color: "#FFF" },
  cdL: { fontSize: 10, color: "rgba(255,255,255,0.75)", textTransform: "uppercase", letterSpacing: 0.4, marginTop: 2 },
  actionBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 14, borderRadius: 12 },
  actionTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
});

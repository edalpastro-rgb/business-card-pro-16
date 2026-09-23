import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { theme } from "@/src/theme";
import { ModuleErrorBoundary } from "@/src/shared";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

type Message = { message_id: string; sender_id: string; sender_name: string; kind: string; text?: string; created_at: string; file_name?: string };
type Channel = {
  channel_id: string; name: string; is_direct: boolean; member_user_ids: string[];
  created_by: string; last_message_at: string;
  last_message?: Message | null; unread_count?: number;
};
type Member = { user_id: string; name: string; email: string };

export default function ChatListRoute() {
  return (
    <ModuleErrorBoundary moduleName="communications">
      <ChatListScreen />
    </ModuleErrorBoundary>
  );
}

function ChatListScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const pagePad = usePageBottomPadding();
  const [items, setItems] = useState<Channel[]>([]);
  const [members, setMembers] = useState<Record<string, Member>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [chR, tR] = await Promise.all([
        api<{ items: Channel[] }>("/chat/channels"),
        api<{ items: Member[] }>("/team/members").catch(() => ({ items: [] })),
      ]);
      setItems(chR.items || []);
      const mmap: Record<string, Member> = {};
      (tR.items || []).forEach((m: Member) => { mmap[m.user_id] = m; });
      if (user) mmap[user.user_id] = { user_id: user.user_id, name: user.name, email: user.email };
      setMembers(mmap);
    } finally { setLoading(false); }
  }, [user]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Poll for new messages every 15s while focused
  useEffect(() => {
    const iv = setInterval(load, 15000);
    return () => clearInterval(iv);
  }, [load]);

  const channelTitle = (ch: Channel): string => {
    if (ch.name) return ch.name;
    if (ch.is_direct && user) {
      const other = ch.member_user_ids.find((u) => u !== user.user_id);
      return (other && members[other]?.name) || "Chat diretta";
    }
    return `Gruppo (${ch.member_user_ids.length})`;
  };

  const summary = (m?: Message | null): string => {
    if (!m) return "Nessun messaggio";
    if (m.kind === "text") return m.text || "";
    if (m.kind === "audio") return "🎤 Vocale";
    if (m.kind === "photo") return "🖼️ Foto";
    if (m.kind === "file") return `📎 ${m.file_name || "File"}`;
    if (m.kind === "link") return "🔗 Link";
    return "Messaggio";
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Chat Team</Text>
        <Pressable testID="chat-new-btn" onPress={() => router.push("/chat/new")} style={styles.headerBtn}>
          <Ionicons name="create-outline" size={20} color="#FFF" />
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={HT.brand} />
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="chatbubbles-outline" size={44} color={HT.muted} />
          <Text style={styles.emptyTxt}>Nessuna chat attiva</Text>
          <Text style={styles.emptySub}>Avvia una conversazione con i membri del tuo team per condividere file, audio e link.</Text>
          <Pressable onPress={() => router.push("/chat/new")} style={styles.emptyBtn}>
            <Text style={styles.emptyBtnTxt}>Nuova chat</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.channel_id}
          contentContainerStyle={{ padding: 16, paddingTop: 4, paddingBottom: pagePad }}
          renderItem={({ item }) => (
            <Pressable testID={`chat-${item.channel_id}`} onPress={() => router.push(`/chat/${item.channel_id}`)} style={styles.card}>
              <View style={styles.avatar}>
                <Ionicons name={item.is_direct ? "person" : "people"} size={20} color={HT.brand} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{channelTitle(item)}</Text>
                <Text style={styles.sub} numberOfLines={1}>
                  {item.last_message?.sender_name ? `${item.last_message.sender_name}: ` : ""}{summary(item.last_message)}
                </Text>
              </View>
              {!!item.unread_count && item.unread_count > 0 && (
                <View style={styles.badge}><Text style={styles.badgeTxt}>{item.unread_count}</Text></View>
              )}
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: HT.card2 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 12 },
  title: { fontSize: 24, fontWeight: "700", color: HT.text },
  // V29.bc — Stile Optima
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: HT.brand,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.9)",
    shadowColor: "#000",
    shadowOpacity: 0.20,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40, gap: 10 },
  emptyTxt: { color: HT.text, fontSize: 16, fontWeight: "700" },
  emptySub: { color: HT.muted, textAlign: "center", fontSize: 13 },
  emptyBtn: { backgroundColor: HT.brand, paddingHorizontal: 22, paddingVertical: 12, borderRadius: theme.radius.md, marginTop: 8 },
  emptyBtnTxt: { color: "#FFF", fontWeight: "700" },
  card: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: HT.card, padding: 14, borderRadius: theme.radius.md, marginBottom: 8, borderWidth: 1, borderColor: HT.border },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: HT.brandTint,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.9)",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  name: { fontSize: 15, fontWeight: "700", color: HT.text },
  sub: { fontSize: 12, color: HT.muted, marginTop: 2 },
  badge: { backgroundColor: HT.brand, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3, minWidth: 24, alignItems: "center" },
  badgeTxt: { color: "#FFF", fontWeight: "700", fontSize: 11 },
});

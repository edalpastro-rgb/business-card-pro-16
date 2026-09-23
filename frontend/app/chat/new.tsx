import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, ScrollView, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { theme } from "@/src/theme";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

type Member = { user_id: string; name: string; email: string };

export default function NewChatScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await api<{ items: Member[] }>("/team/members");
        setMembers(r.items || []);
      } finally { setLoading(false); }
    })();
  }, [user]);

  const toggle = (uid: string) => setSelected((s) => ({ ...s, [uid]: !s[uid] }));
  const selCount = Object.values(selected).filter(Boolean).length;

  const create = async () => {
    const ids = Object.entries(selected).filter(([, v]) => v).map(([k]) => k);
    if (ids.length === 0) return;
    setBusy(true);
    try {
      const ch = await api<{ channel_id: string }>("/chat/channels", {
        method: "POST",
        body: { name: name.trim(), member_user_ids: ids, is_direct: ids.length === 1 && !name.trim() },
      });
      router.replace(`/chat/${ch.channel_id}`);
    } catch (e: any) {
      Alert.alert("Errore", e?.message || "Impossibile creare la chat");
    } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={HT.text} />
        </Pressable>
        <Text style={styles.title}>Nuova chat</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 140 }}>
        <Text style={styles.lbl}>Nome (opzionale — per chat di gruppo)</Text>
        <TextInput
          testID="chat-name-input"
          value={name}
          onChangeText={setName}
          placeholder="Es. Team commerciale"
          placeholderTextColor={HT.muted}
          style={styles.input}
        />

        <Text style={[styles.lbl, { marginTop: 16 }]}>Seleziona partecipanti ({selCount})</Text>
        {loading ? (
          <ActivityIndicator style={{ marginTop: 20 }} color={HT.brand} />
        ) : members.length === 0 ? (
          <Text style={styles.emptyTxt}>Non ci sono altri utenti nel tuo team. Invita collaboratori da Impostazioni → Team.</Text>
        ) : (
          members.map((m) => (
            <Pressable key={m.user_id} testID={`chat-user-${m.user_id}`} onPress={() => toggle(m.user_id)} style={[styles.userRow, selected[m.user_id] && styles.userRowActive]}>
              <View style={styles.avatar}><Text style={styles.avatarTxt}>{m.name?.[0]?.toUpperCase()}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.userName}>{m.name}</Text>
                <Text style={styles.userEmail}>{m.email}</Text>
              </View>
              <Ionicons name={selected[m.user_id] ? "checkmark-circle" : "ellipse-outline"} size={22} color={selected[m.user_id] ? HT.success : HT.muted} />
            </Pressable>
          ))
        )}

        <Pressable testID="chat-create-btn" onPress={create} disabled={busy || selCount === 0} style={[styles.saveBtn, { opacity: selCount === 0 ? 0.5 : 1 }]}>
          {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.saveBtnTxt}>Crea chat</Text>}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: HT.card2 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontSize: 18, fontWeight: "700", color: HT.text },
  lbl: { fontSize: 12, color: HT.text2, fontWeight: "600", marginBottom: 4 },
  input: { backgroundColor: HT.card, borderRadius: theme.radius.md, padding: 12, borderWidth: 1, borderColor: HT.border, color: HT.text },
  userRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: HT.card, padding: 12, borderRadius: theme.radius.md, marginBottom: 8, borderWidth: 1, borderColor: HT.border },
  userRowActive: { borderColor: HT.success, backgroundColor: HT.successTint },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: HT.brandTint, alignItems: "center", justifyContent: "center" },
  avatarTxt: { color: HT.brand, fontWeight: "700", fontSize: 14 },
  userName: { fontSize: 15, fontWeight: "700", color: HT.text },
  userEmail: { fontSize: 12, color: HT.muted, marginTop: 2 },
  emptyTxt: { color: HT.muted, textAlign: "center", marginTop: 20, fontStyle: "italic" },
  saveBtn: { backgroundColor: HT.brand, paddingVertical: 14, borderRadius: theme.radius.md, alignItems: "center", marginTop: 20 },
  saveBtnTxt: { color: "#FFF", fontWeight: "700", fontSize: 15 },
});

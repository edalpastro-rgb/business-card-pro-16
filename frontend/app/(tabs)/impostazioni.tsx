import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { theme } from "@/src/theme";

type Settings = { energy_title: string; energy_color: string; network_title: string; network_color: string };

const COLOR_SWATCHES = ["#C83232", "#1B6CB0", "#1C4869", "#2D7A5A", "#B77C14", "#7A2E8E", "#0B7285", "#E67700"];

export default function ImpostazioniScreen() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [s, setS] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [ok, setOk] = useState(false);

  const load = useCallback(async () => setS(await api<Settings>("/settings")), []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!s) return;
    setSaving(true); setOk(false);
    try { await api("/settings", { method: "PUT", body: s }); setOk(true); }
    finally { setSaving(false); setTimeout(() => setOk(false), 2000); }
  };

  if (!s) return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ActivityIndicator style={{ marginTop: 40 }} color={theme.color.brandPrimary} />
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}><Text style={styles.title}>Profilo & Impostazioni</Text></View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        <View style={styles.card}>
          <View style={styles.profileHead}>
            <View style={styles.avatar}><Text style={styles.avatarTxt}>{user?.name?.[0]?.toUpperCase()}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{user?.name}</Text>
              <Text style={styles.email}>{user?.email}</Text>
              <Text style={styles.roleBadge}>{user?.parent_user_id ? "Collaboratore" : "Owner"}</Text>
            </View>
          </View>
        </View>

        {!user?.parent_user_id && (
          <Pressable testID="team-link" onPress={() => router.push("/team")} style={styles.linkCard}>
            <Ionicons name="people-circle" size={26} color={theme.color.brandPrimary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.linkTitle}>Gestione Team</Text>
              <Text style={styles.linkSub}>Invita collaboratori e assegna aree</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={theme.color.muted} />
          </Pressable>
        )}

        {!user?.parent_user_id && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Personalizza aree</Text>

          <Text style={styles.label}>Titolo Area 1 (Energia)</Text>
          <TextInput
            testID="settings-energy-title"
            value={s.energy_title}
            onChangeText={(t) => setS({ ...s, energy_title: t })}
            style={styles.input}
          />
          <Text style={styles.label}>Colore Area 1</Text>
          <View style={styles.swatches}>
            {COLOR_SWATCHES.map((c) => (
              <Pressable
                key={"e"+c}
                testID={`energy-color-${c}`}
                onPress={() => setS({ ...s, energy_color: c })}
                style={[styles.swatch, { backgroundColor: c }, s.energy_color === c && styles.swatchActive]}
              >
                {s.energy_color === c && <Ionicons name="checkmark" size={16} color="#FFF" />}
              </Pressable>
            ))}
          </View>

          <View style={{ height: 12 }} />
          <Text style={styles.label}>Titolo Area 2 (Network)</Text>
          <TextInput
            testID="settings-network-title"
            value={s.network_title}
            onChangeText={(t) => setS({ ...s, network_title: t })}
            style={styles.input}
          />
          <Text style={styles.label}>Colore Area 2</Text>
          <View style={styles.swatches}>
            {COLOR_SWATCHES.map((c) => (
              <Pressable
                key={"n"+c}
                testID={`network-color-${c}`}
                onPress={() => setS({ ...s, network_color: c })}
                style={[styles.swatch, { backgroundColor: c }, s.network_color === c && styles.swatchActive]}
              >
                {s.network_color === c && <Ionicons name="checkmark" size={16} color="#FFF" />}
              </Pressable>
            ))}
          </View>

          <Pressable testID="settings-save" onPress={save} style={styles.saveBtn} disabled={saving}>
            {saving ? <ActivityIndicator color="#FFF" /> : <Text style={styles.saveBtnTxt}>{ok ? "Salvato ✓" : "Salva modifiche"}</Text>}
          </Pressable>
        </View>
        )}

        <Pressable testID="logout-btn" onPress={async () => { await logout(); router.replace("/login"); }} style={styles.logoutBtn}>
          <Ionicons name="log-out-outline" size={20} color={theme.color.error} />
          <Text style={styles.logoutTxt}>Esci</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { paddingHorizontal: 20, paddingVertical: 12 },
  title: { fontSize: 24, fontWeight: "700", color: theme.color.onSurface },
  card: { backgroundColor: "#FFF", borderRadius: theme.radius.md, padding: 16, borderWidth: 1, borderColor: theme.color.border },
  profileHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: theme.color.brandTertiary, alignItems: "center", justifyContent: "center" },
  avatarTxt: { color: theme.color.brandPrimary, fontWeight: "700", fontSize: 20 },
  name: { fontSize: 16, fontWeight: "700", color: theme.color.onSurface },
  email: { fontSize: 13, color: theme.color.muted, marginTop: 2 },
  roleBadge: { alignSelf: "flex-start", marginTop: 6, backgroundColor: theme.color.brandTertiary, color: theme.color.brandPrimary, fontSize: 11, fontWeight: "700", paddingHorizontal: 8, paddingVertical: 2, borderRadius: theme.radius.pill, overflow: "hidden" },
  linkCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#FFF", padding: 14, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border },
  linkTitle: { fontSize: 15, fontWeight: "700", color: theme.color.onSurface },
  linkSub: { fontSize: 12, color: theme.color.muted, marginTop: 2 },
  sectionTitle: { fontSize: 15, fontWeight: "700", color: theme.color.onSurface, marginBottom: 12 },
  label: { fontSize: 12, color: theme.color.onSurfaceTertiary, fontWeight: "600", marginTop: 10, marginBottom: 6 },
  input: { backgroundColor: theme.color.surface, borderRadius: theme.radius.md, padding: 12, borderWidth: 1, borderColor: theme.color.border, color: theme.color.onSurface },
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  swatch: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "transparent" },
  swatchActive: { borderColor: theme.color.onSurface },
  saveBtn: { backgroundColor: theme.color.brandPrimary, paddingVertical: 12, borderRadius: theme.radius.md, alignItems: "center", marginTop: 16 },
  saveBtnTxt: { color: "#FFF", fontWeight: "700" },
  logoutBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#FFF", padding: 14, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border },
  logoutTxt: { color: theme.color.error, fontWeight: "700" },
});

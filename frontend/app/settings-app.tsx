import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";

type Settings = { theme?: string; accent_color?: string; banner_image_url?: string };

const ACCENTS = [
  { color: "#7C3AED", name: "Viola" },
  { color: "#0891B2", name: "Ciano" },
  { color: "#DB2777", name: "Magenta" },
  { color: "#16A34A", name: "Verde" },
  { color: "#F59E0B", name: "Ambra" },
  { color: "#DC2626", name: "Rosso" },
  { color: "#6366F1", name: "Indaco" },
  { color: "#0F172A", name: "Notte" },
];

export default function SettingsAppScreen() {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings>({ theme: "light", accent_color: "#7C3AED" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await api<Settings>("/user-settings");
      setSettings(s);
    } catch (e) { console.warn(e); } finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const save = async (patch: Partial<Settings>) => {
    setSaving(true);
    try {
      const s = await api<Settings>("/user-settings", { method: "PUT", body: patch });
      setSettings(s);
    } catch (e: any) { notify("Errore", e?.message || ""); } finally { setSaving(false); }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.color.background }} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn}><Ionicons name="chevron-back" size={22} color={theme.color.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Setting App</Text>
        {saving && <ActivityIndicator color={theme.color.brandPrimary} />}
      </View>

      {loading ? <ActivityIndicator style={{ marginTop: 40 }} color={theme.color.brandPrimary} /> : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
          <Text style={styles.section}>Tema</Text>
          <View style={styles.row}>
            {(["light","dark","auto"] as const).map((t) => (
              <Pressable key={t} onPress={() => save({ theme: t })} testID={`theme-${t}`} style={[styles.themeOpt, settings.theme === t && styles.themeOptActive]}>
                <Ionicons name={t === "light" ? "sunny" : t === "dark" ? "moon" : "contrast"} size={22} color={settings.theme === t ? "#FFF" : theme.color.onSurface} />
                <Text style={[styles.themeLabel, settings.theme === t && { color: "#FFF" }]}>{t === "light" ? "Chiaro" : t === "dark" ? "Scuro" : "Auto"}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.section}>Colore accento</Text>
          <View style={styles.accentGrid}>
            {ACCENTS.map((a) => (
              <Pressable key={a.color} testID={`accent-${a.color}`} onPress={() => save({ accent_color: a.color })} style={[styles.accentCell, { backgroundColor: a.color }, settings.accent_color === a.color && styles.accentCellActive]}>
                {settings.accent_color === a.color && <Ionicons name="checkmark" size={22} color="#FFF" />}
              </Pressable>
            ))}
          </View>
          <Text style={styles.hint}>Anteprima: pulsanti e accenti useranno questo colore.</Text>

          <View style={styles.previewCard}>
            <View style={[styles.previewCircle, { backgroundColor: settings.accent_color }]}><Ionicons name="star" size={22} color="#FFF" /></View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.previewTitle}>Anteprima Master</Text>
              <Text style={styles.previewSub}>Tema: {settings.theme} · Accento: {settings.accent_color}</Text>
            </View>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", padding: 14, gap: 10, borderBottomWidth: 1, borderBottomColor: theme.color.border, backgroundColor: theme.color.surface },
  // V29.bc — Stile Optima
  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#F1F5F9",
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
  headerTitle: { flex: 1, fontSize: 16, fontWeight: "800", color: theme.color.onSurface },
  section: { fontSize: 13, fontWeight: "800", color: theme.color.muted, textTransform: "uppercase", marginTop: 16, marginBottom: 8, letterSpacing: 1 },
  row: { flexDirection: "row", gap: 10 },
  themeOpt: { flex: 1, backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border, padding: 14, borderRadius: 12, alignItems: "center", gap: 4 },
  themeOptActive: { backgroundColor: "#7C3AED", borderColor: "#7C3AED" },
  themeLabel: { fontSize: 12, fontWeight: "700", color: theme.color.onSurface },
  accentGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  accentCell: { width: 60, height: 60, borderRadius: 30, alignItems: "center", justifyContent: "center" },
  accentCellActive: { borderWidth: 3, borderColor: "#0F172A" },
  hint: { fontSize: 11, color: theme.color.muted, marginTop: 10 },
  previewCard: { flexDirection: "row", alignItems: "center", padding: 14, backgroundColor: theme.color.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.color.border, marginTop: 20 },
  previewCircle: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  previewTitle: { fontSize: 14, fontWeight: "800", color: theme.color.onSurface },
  previewSub: { fontSize: 11, color: theme.color.muted, marginTop: 2 },
});

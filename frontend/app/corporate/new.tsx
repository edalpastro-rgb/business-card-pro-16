import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

const COLORS = ["#7C3AED","#0891B2","#DB2777","#16A34A","#F59E0B","#DC2626","#6366F1",HT.text];

export default function NewCorporateScreen() {
  const router = useRouter();
  const pagePad = usePageBottomPadding();
  const [name, setName] = useState("");
  const [color, setColor] = useState("#7C3AED");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim()) { notify("Nome obbligatorio"); return; }
    try {
      setSaving(true);
      // Add as custom area in settings
      const s = await api<any>("/settings");
      const areas = Array.isArray(s.custom_areas) ? s.custom_areas : [];
      const id = `corp_${Date.now().toString(36)}`;
      areas.push({ id, name: name.trim(), color, description });
      await api("/settings", { method: "PUT", body: { custom_areas: areas } });
      notify("Area creata", `"${name}" è stata aggiunta con successo.`, [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (e: any) { notify("Errore", e?.message || ""); } finally { setSaving(false); }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.color.background }} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn}><Ionicons name="chevron-back" size={22} color={HT.text} /></Pressable>
        <Text style={styles.headerTitle}>New Corporate</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: pagePad }}>
        <View style={styles.intro}><Ionicons name="business" size={22} color="#059669" /><Text style={styles.introTxt}>Crea una nuova area business per organizzare i tuoi contatti (es. Aziende, Retail, Consulting).</Text></View>

        <Text style={styles.label}>Nome area</Text>
        <TextInput value={name} onChangeText={setName} style={styles.input} placeholder="Es. Business Aziendali" testID="corp-name" />

        <Text style={styles.label}>Descrizione (opzionale)</Text>
        <TextInput value={description} onChangeText={setDescription} style={[styles.input, { height: 80, textAlignVertical: "top" }]} multiline placeholder="A cosa serve questa area" testID="corp-desc" />

        <Text style={styles.label}>Colore</Text>
        <View style={styles.colorRow}>
          {COLORS.map((c) => (
            <Pressable key={c} onPress={() => setColor(c)} style={[styles.colorDot, { backgroundColor: c }, color === c && styles.colorDotActive]} testID={`corp-color-${c}`}>
              {color === c && <Ionicons name="checkmark" size={18} color="#FFF" />}
            </Pressable>
          ))}
        </View>

        <Pressable onPress={submit} disabled={saving} style={styles.submitBtn} testID="corp-submit">
          {saving ? <ActivityIndicator color="#FFF" /> : (<><Ionicons name="checkmark-circle" size={20} color="#FFF" /><Text style={styles.submitTxt}>Crea area</Text></>)}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", padding: 14, gap: 10, borderBottomWidth: 1, borderBottomColor: HT.border, backgroundColor: HT.card2 },
  headerBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: HT.card2, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, fontSize: 16, fontWeight: "800", color: HT.text },
  intro: { flexDirection: "row", alignItems: "flex-start", backgroundColor: HT.successTint, padding: 12, borderRadius: 10, marginBottom: 14, gap: 10 },
  introTxt: { flex: 1, fontSize: 12, color: HT.success, lineHeight: 16 },
  label: { fontSize: 12, fontWeight: "700", color: HT.muted, marginTop: 14, marginBottom: 4, textTransform: "uppercase", letterSpacing: 1 },
  input: { borderWidth: 1, borderColor: HT.border, borderRadius: 10, padding: 12, fontSize: 14, color: HT.text, backgroundColor: HT.card2 },
  colorRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 4 },
  colorDot: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  colorDotActive: { borderWidth: 3, borderColor: '#0F172A' },
  submitBtn: { marginTop: 30, backgroundColor: '#059669', flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 14, borderRadius: 12 },
  submitTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
});

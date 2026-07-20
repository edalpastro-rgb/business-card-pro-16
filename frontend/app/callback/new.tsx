import { useEffect, useState } from "react";
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView, ActivityIndicator, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import DateTimePicker from "@react-native-community/datetimepicker";
import { api } from "@/src/api";
import { theme } from "@/src/theme";

type Contact = { contact_id: string; first_name: string; last_name: string; area: string };

export default function NewCallbackScreen() {
  const router = useRouter();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [form, setForm] = useState({
    title: "",
    area: "energy" as "energy" | "network",
    scheduled_at: new Date(Date.now() + 60 * 60 * 1000),
    note: "",
    contact_id: "",
  });
  const [showPicker, setShowPicker] = useState<"date" | "time" | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api<{ items: Contact[] }>("/contacts").then((r) => setContacts(r.items)); }, []);

  const submit = async () => {
    if (!form.title.trim()) return;
    setBusy(true);
    try {
      await api("/callbacks", { method: "POST", body: { ...form, scheduled_at: form.scheduled_at.toISOString() } });
      router.back();
    } finally { setBusy(false); }
  };

  const setDate = (d: Date) => { const n = new Date(form.scheduled_at); n.setFullYear(d.getFullYear(), d.getMonth(), d.getDate()); setForm({ ...form, scheduled_at: n }); };
  const setTime = (d: Date) => { const n = new Date(form.scheduled_at); n.setHours(d.getHours(), d.getMinutes()); setForm({ ...form, scheduled_at: n }); };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable testID="back-btn" onPress={() => router.back()}><Ionicons name="chevron-back" size={26} color={theme.color.onSurface} /></Pressable>
        <Text style={styles.title}>Nuova ritelefonata</Text>
        <View style={{ width: 26 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.lbl}>Titolo *</Text>
        <TextInput testID="cb-title" value={form.title} onChangeText={(t) => setForm({ ...form, title: t })} style={styles.input} placeholder="Es. Ritelefonare cliente" placeholderTextColor="#94A3B8" />

        <Text style={styles.lbl}>Area</Text>
        <View style={styles.pillsRow}>
          {(["energy", "network"] as const).map((a) => (
            <Pressable key={a} testID={`cb-area-${a}`} onPress={() => setForm({ ...form, area: a })} style={[styles.pill, form.area === a && { backgroundColor: a === "energy" ? theme.color.energy : theme.color.network, borderColor: a === "energy" ? theme.color.energy : theme.color.network }]}>
              <Text style={[styles.pillTxt, form.area === a && styles.pillTxtActive]}>{a === "energy" ? "Energia" : "Network"}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.lbl}>Contatto (opzionale)</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          <Pressable testID="cb-c-none" onPress={() => setForm({ ...form, contact_id: "" })} style={[styles.pill, !form.contact_id && styles.pillActive]}>
            <Text style={[styles.pillTxt, !form.contact_id && styles.pillTxtActive]}>Nessuno</Text>
          </Pressable>
          {contacts.map((c) => (
            <Pressable key={c.contact_id} testID={`cb-c-${c.contact_id}`} onPress={() => setForm({ ...form, contact_id: c.contact_id })} style={[styles.pill, form.contact_id === c.contact_id && styles.pillActive]}>
              <Text style={[styles.pillTxt, form.contact_id === c.contact_id && styles.pillTxtActive]}>{c.first_name} {c.last_name}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.dateRow}>
          <Pressable testID="cb-date-btn" onPress={() => setShowPicker("date")} style={styles.dateBtn}>
            <Ionicons name="calendar-outline" size={16} color={theme.color.brandPrimary} />
            <Text style={styles.dateBtnTxt}>{form.scheduled_at.toLocaleDateString("it-IT")}</Text>
          </Pressable>
          <Pressable testID="cb-time-btn" onPress={() => setShowPicker("time")} style={styles.dateBtn}>
            <Ionicons name="time-outline" size={16} color={theme.color.brandPrimary} />
            <Text style={styles.dateBtnTxt}>{form.scheduled_at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text>
          </Pressable>
        </View>

        {showPicker && (Platform.OS === "web" ? (
          <TextInput
            testID="cb-datetime-web"
            value={form.scheduled_at.toISOString().slice(0, 16)}
            onChangeText={(v) => setForm({ ...form, scheduled_at: new Date(v) })}
            style={styles.input}
            placeholder="YYYY-MM-DDTHH:MM"
          />
        ) : (
          <DateTimePicker value={form.scheduled_at} mode={showPicker} onChange={(e, d) => { setShowPicker(null); if (d) showPicker === "date" ? setDate(d) : setTime(d); }} />
        ))}

        <Text style={styles.lbl}>Nota</Text>
        <TextInput testID="cb-note" value={form.note} onChangeText={(t) => setForm({ ...form, note: t })} style={[styles.input, { minHeight: 70, textAlignVertical: "top" }]} multiline placeholderTextColor="#94A3B8" />

        <Pressable testID="cb-save" onPress={submit} style={styles.saveBtn} disabled={busy}>
          {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.saveBtnTxt}>Salva ritelefonata</Text>}
        </Pressable>
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontSize: 18, fontWeight: "700", color: theme.color.onSurface },
  content: { padding: 16 },
  lbl: { fontSize: 12, fontWeight: "600", color: theme.color.onSurfaceTertiary, marginTop: 14, marginBottom: 6 },
  input: { backgroundColor: "#FFF", borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: theme.color.onSurface },
  pillsRow: { flexDirection: "row", gap: 8 },
  pill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: theme.radius.pill, backgroundColor: "#FFF", borderWidth: 1, borderColor: theme.color.border },
  pillActive: { backgroundColor: theme.color.brandPrimary, borderColor: theme.color.brandPrimary },
  pillTxt: { color: theme.color.onSurfaceTertiary, fontWeight: "600", fontSize: 13 },
  pillTxtActive: { color: "#FFF" },
  dateRow: { flexDirection: "row", gap: 10, marginTop: 14 },
  dateBtn: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#FFF", padding: 12, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border },
  dateBtnTxt: { color: theme.color.onSurface, fontWeight: "600" },
  saveBtn: { backgroundColor: theme.color.brandPrimary, paddingVertical: 14, borderRadius: theme.radius.md, alignItems: "center", marginTop: 24 },
  saveBtnTxt: { color: "#FFF", fontWeight: "700", fontSize: 15 },
});

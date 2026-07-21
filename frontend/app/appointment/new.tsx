import { useEffect, useState } from "react";
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView, ActivityIndicator, Platform, Switch } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import DateTimePicker from "@react-native-community/datetimepicker";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { theme } from "@/src/theme";
import { scheduleAppointmentReminder } from "@/src/notifications";

type Contact = { contact_id: string; first_name: string; last_name: string; area: string; address: string };

export default function NewAppointmentScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const allowed = (user?.areas || ["energy", "network"]) as ("energy" | "network")[];
  const { contactId } = useLocalSearchParams<{ contactId?: string }>();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [form, setForm] = useState({
    title: "",
    contact_id: contactId || "",
    area: (allowed[0] || "energy") as "energy" | "network",
    start_at: new Date(Date.now() + 60 * 60 * 1000),
    is_phone: false,
    location: "",
    notes: "",
  });
  const [showPicker, setShowPicker] = useState<"date" | "time" | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ items: Contact[] }>("/contacts").then((r) => setContacts(r.items));
  }, []);

  useEffect(() => {
    if (contactId) {
      const c = contacts.find((x) => x.contact_id === contactId);
      if (c) setForm((f) => ({ ...f, contact_id: c.contact_id, area: (c.area as any) || f.area, title: f.title || `Appuntamento ${c.first_name} ${c.last_name}`, location: c.address || f.location }));
    }
  }, [contacts, contactId]);

  const submit = async () => {
    if (!form.title.trim()) return;
    setBusy(true);
    try {
      const created = await api<{ appointment_id: string }>("/appointments", { method: "POST", body: { ...form, start_at: form.start_at.toISOString() } });
      await scheduleAppointmentReminder(created.appointment_id, form.title, form.start_at);
      router.back();
    } finally { setBusy(false); }
  };

  const setDate = (d: Date) => {
    const next = new Date(form.start_at);
    next.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
    setForm({ ...form, start_at: next });
  };
  const setTime = (d: Date) => {
    const next = new Date(form.start_at);
    next.setHours(d.getHours(), d.getMinutes(), 0, 0);
    setForm({ ...form, start_at: next });
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable testID="back-btn" onPress={() => router.back()}><Ionicons name="chevron-back" size={26} color={theme.color.onSurface} /></Pressable>
        <Text style={styles.title}>Nuovo appuntamento</Text>
        <View style={{ width: 26 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.lbl}>Titolo *</Text>
        <TextInput testID="ap-title" value={form.title} onChangeText={(t) => setForm({ ...form, title: t })} style={styles.input} placeholder="Titolo appuntamento" placeholderTextColor="#94A3B8" />

        <Text style={styles.lbl}>Area</Text>
        <View style={styles.pillsRow}>
          {(["energy", "network"] as const).filter((a) => allowed.includes(a)).map((a) => (
            <Pressable key={a} testID={`ap-area-${a}`} onPress={() => setForm({ ...form, area: a })} style={[styles.pill, form.area === a && { backgroundColor: a === "energy" ? theme.color.energy : theme.color.network, borderColor: a === "energy" ? theme.color.energy : theme.color.network }]}>
              <Text style={[styles.pillTxt, form.area === a && styles.pillTxtActive]}>{a === "energy" ? "Energia (Rosso)" : "Network (Blu)"}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.lbl}>Contatto (opzionale)</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 6 }} contentContainerStyle={{ gap: 8 }}>
          <Pressable testID="ap-contact-none" onPress={() => setForm({ ...form, contact_id: "" })} style={[styles.pill, !form.contact_id && styles.pillActive]}>
            <Text style={[styles.pillTxt, !form.contact_id && styles.pillTxtActive]}>Nessuno</Text>
          </Pressable>
          {contacts.map((c) => (
            <Pressable key={c.contact_id} testID={`ap-contact-${c.contact_id}`} onPress={() => setForm({ ...form, contact_id: c.contact_id })} style={[styles.pill, form.contact_id === c.contact_id && styles.pillActive]}>
              <Text style={[styles.pillTxt, form.contact_id === c.contact_id && styles.pillTxtActive]}>{c.first_name} {c.last_name}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {Platform.OS === "web" ? (
          <View style={styles.webDateRow}>
            {/* @ts-expect-error web-only */}
            <input
              type="datetime-local"
              value={
                new Date(form.start_at.getTime() - form.start_at.getTimezoneOffset() * 60000)
                  .toISOString()
                  .slice(0, 16)
              }
              onChange={(e: any) => setForm({ ...form, start_at: new Date(e.target.value) })}
              style={webInputStyle}
            />
          </View>
        ) : (
          <>
            <View style={styles.dateRow}>
              <Pressable testID="ap-date-btn" onPress={() => setShowPicker("date")} style={styles.dateBtn}>
                <Ionicons name="calendar-outline" size={18} color={theme.color.brandPrimary} />
                <Text style={styles.dateBtnTxt}>{form.start_at.toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" })}</Text>
              </Pressable>
              <Pressable testID="ap-time-btn" onPress={() => setShowPicker("time")} style={styles.dateBtn}>
                <Ionicons name="time-outline" size={18} color={theme.color.brandPrimary} />
                <Text style={styles.dateBtnTxt}>{form.start_at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text>
              </Pressable>
            </View>
            {showPicker && (
              <DateTimePicker
                value={form.start_at}
                mode={showPicker}
                onChange={(e, d) => {
                  setShowPicker(null);
                  if (d) { showPicker === "date" ? setDate(d) : setTime(d); }
                }}
              />
            )}
          </>
        )}

        <View style={styles.switchRow}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Ionicons name="call" size={18} color={theme.color.brandPrimary} />
            <Text style={styles.switchLbl}>Appuntamento telefonico</Text>
          </View>
          <Switch testID="ap-phone-switch" value={form.is_phone} onValueChange={(v) => setForm({ ...form, is_phone: v })} />
        </View>

        <Text style={styles.lbl}>Luogo</Text>
        <TextInput testID="ap-location" value={form.location} onChangeText={(t) => setForm({ ...form, location: t })} style={styles.input} placeholder="Indirizzo" placeholderTextColor="#94A3B8" />

        <Text style={styles.lbl}>Note</Text>
        <TextInput testID="ap-notes" value={form.notes} onChangeText={(t) => setForm({ ...form, notes: t })} style={[styles.input, { minHeight: 70, textAlignVertical: "top" }]} multiline placeholder="Note" placeholderTextColor="#94A3B8" />

        <Pressable testID="ap-save" onPress={submit} style={styles.saveBtn} disabled={busy}>
          {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.saveBtnTxt}>Crea appuntamento</Text>}
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
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 16, backgroundColor: "#FFF", padding: 12, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border },
  switchLbl: { fontSize: 14, color: theme.color.onSurface, fontWeight: "600" },
  saveBtn: { backgroundColor: theme.color.brandPrimary, paddingVertical: 14, borderRadius: theme.radius.md, alignItems: "center", marginTop: 24 },
  saveBtnTxt: { color: "#FFF", fontWeight: "700", fontSize: 15 },
});

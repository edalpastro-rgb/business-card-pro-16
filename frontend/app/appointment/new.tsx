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

const DURATIONS = [
  { m: 15, label: "15m" }, { m: 30, label: "30m" }, { m: 60, label: "1h" },
  { m: 90, label: "1h30" }, { m: 120, label: "2h" }, { m: 180, label: "3h" },
];
const REMINDERS = [
  { m: 0, label: "Nessuno" }, { m: 5, label: "5m prima" },
  { m: 15, label: "15m prima" }, { m: 30, label: "30m prima" },
  { m: 60, label: "1h prima" }, { m: 1440, label: "1 giorno prima" },
];
const RECURRENCES = [
  { k: "none", label: "Nessuna" }, { k: "weekly", label: "Settimanale" },
  { k: "monthly", label: "Mensile" }, { k: "yearly", label: "Annuale" },
];

export default function NewAppointmentScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const allowed = (user?.areas || ["energy", "network"]) as ("energy" | "network")[];
  const { contactId } = useLocalSearchParams<{ contactId?: string }>();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [form, setForm] = useState({
    title: "",
    contact_id: contactId || "",
    participant_contact_ids: [] as string[],
    area: (allowed[0] || "energy") as "energy" | "network",
    start_at: new Date(Date.now() + 60 * 60 * 1000),
    duration_min: 60,
    reminder_minutes: 15,
    recurrence: "none" as "none" | "weekly" | "monthly" | "yearly",
    is_phone: false,
    location: "",
    notes: "",
    value_amount: "",
  });
  const [showPicker, setShowPicker] = useState<"date" | "time" | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ items: Contact[] }>("/contacts").then((r) => setContacts(r.items));
  }, []);

  useEffect(() => {
    if (contactId && contacts.length) {
      const c = contacts.find((x) => x.contact_id === contactId);
      if (c) setForm((f) => ({
        ...f,
        contact_id: c.contact_id,
        area: ((c.area as any) || f.area) as any,
        title: f.title || `Appuntamento ${c.first_name} ${c.last_name}`,
        location: c.address || f.location,
      }));
    }
  }, [contacts, contactId]);

  const submit = async () => {
    if (!form.title.trim()) return;
    setBusy(true);
    try {
      const payload: any = {
        ...form,
        start_at: form.start_at.toISOString(),
        value_amount: form.value_amount ? parseFloat(form.value_amount) : 0,
      };
      delete payload.value_amount_str;
      const created = await api<{ appointment_id: string }>("/appointments", { method: "POST", body: payload });
      if (form.reminder_minutes > 0) {
        await scheduleAppointmentReminder(created.appointment_id, form.title, form.start_at);
      }
      router.back();
    } finally { setBusy(false); }
  };

  const setDate = (d: Date) => { const n = new Date(form.start_at); n.setFullYear(d.getFullYear(), d.getMonth(), d.getDate()); setForm({ ...form, start_at: n }); };
  const setTime = (d: Date) => { const n = new Date(form.start_at); n.setHours(d.getHours(), d.getMinutes(), 0, 0); setForm({ ...form, start_at: n }); };

  const toggleParticipant = (cid: string) => {
    const has = form.participant_contact_ids.includes(cid);
    const next = has ? form.participant_contact_ids.filter((x) => x !== cid) : [...form.participant_contact_ids, cid];
    setForm({ ...form, participant_contact_ids: next });
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable testID="back-btn" onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={26} color={theme.color.onSurface} /></Pressable>
        <Text style={styles.title}>Nuovo appuntamento</Text>
        <View style={{ width: 26 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

        <View style={styles.card}>
          <Text style={styles.lbl}>Titolo *</Text>
          <TextInput testID="ap-title" value={form.title} onChangeText={(t) => setForm({ ...form, title: t })} style={styles.input} placeholder="Titolo appuntamento" placeholderTextColor="#94A3B8" />

          <Text style={styles.lbl}>Area</Text>
          <View style={styles.pillsRow}>
            {(["energy", "network"] as const).filter((a) => allowed.includes(a)).map((a) => (
              <Pressable key={a} testID={`ap-area-${a}`} onPress={() => setForm({ ...form, area: a })} style={[styles.pill, form.area === a && { backgroundColor: a === "energy" ? theme.color.energy : theme.color.network, borderColor: a === "energy" ? theme.color.energy : theme.color.network }]}>
                <Text style={[styles.pillTxt, form.area === a && styles.pillTxtActive]}>{a === "energy" ? "Energia" : "Network"}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Data & ora</Text>
          {Platform.OS === "web" ? (
            <View style={{ marginTop: 4 }}>
              {/* @ts-expect-error web-only */}
              <input
                type="datetime-local"
                value={
                  new Date(form.start_at.getTime() - form.start_at.getTimezoneOffset() * 60000)
                    .toISOString().slice(0, 16)
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
                <DateTimePicker value={form.start_at} mode={showPicker}
                  onChange={(e, d) => { setShowPicker(null); if (d) { showPicker === "date" ? setDate(d) : setTime(d); } }} />
              )}
            </>
          )}

          <Text style={styles.lbl}>Durata prevista</Text>
          <View style={styles.pillsRow}>
            {DURATIONS.map((d) => (
              <Pressable key={d.m} onPress={() => setForm({ ...form, duration_min: d.m })} style={[styles.pill, form.duration_min === d.m && styles.pillActive]}>
                <Text style={[styles.pillTxt, form.duration_min === d.m && styles.pillTxtActive]}>{d.label}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.lbl}>Promemoria</Text>
          <View style={styles.pillsRow}>
            {REMINDERS.map((r) => (
              <Pressable key={r.m} onPress={() => setForm({ ...form, reminder_minutes: r.m })} style={[styles.pill, form.reminder_minutes === r.m && styles.pillActive]}>
                <Text style={[styles.pillTxt, form.reminder_minutes === r.m && styles.pillTxtActive]}>{r.label}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.lbl}>Ricorrenza</Text>
          <View style={styles.pillsRow}>
            {RECURRENCES.map((r) => (
              <Pressable key={r.k} onPress={() => setForm({ ...form, recurrence: r.k as any })} style={[styles.pill, form.recurrence === r.k && styles.pillActive]}>
                <Text style={[styles.pillTxt, form.recurrence === r.k && styles.pillTxtActive]}>{r.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Contatto principale</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            <Pressable testID="ap-contact-none" onPress={() => setForm({ ...form, contact_id: "" })} style={[styles.pill, !form.contact_id && styles.pillActive]}>
              <Text style={[styles.pillTxt, !form.contact_id && styles.pillTxtActive]}>Nessuno</Text>
            </Pressable>
            {contacts.map((c) => (
              <Pressable key={c.contact_id} testID={`ap-contact-${c.contact_id}`} onPress={() => setForm({ ...form, contact_id: c.contact_id })} style={[styles.pill, form.contact_id === c.contact_id && styles.pillActive]}>
                <Text style={[styles.pillTxt, form.contact_id === c.contact_id && styles.pillTxtActive]}>{c.first_name} {c.last_name}</Text>
              </Pressable>
            ))}
          </ScrollView>

          {contacts.length > 0 && (
            <>
              <Text style={styles.lbl}>Partecipanti aggiuntivi</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {contacts.filter((c) => c.contact_id !== form.contact_id).map((c) => {
                  const active = form.participant_contact_ids.includes(c.contact_id);
                  return (
                    <Pressable key={c.contact_id} onPress={() => toggleParticipant(c.contact_id)} style={[styles.pill, active && styles.pillActive]}>
                      <Text style={[styles.pillTxt, active && styles.pillTxtActive]}>{active ? "✓ " : "+ "}{c.first_name} {c.last_name}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </>
          )}
        </View>

        <View style={styles.card}>
          <View style={styles.switchRow}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Ionicons name="call" size={18} color={theme.color.brandPrimary} />
              <Text style={styles.switchLbl}>Telefonico</Text>
            </View>
            <Switch testID="ap-phone-switch" value={form.is_phone} onValueChange={(v) => setForm({ ...form, is_phone: v })} />
          </View>

          <Text style={styles.lbl}>Luogo</Text>
          <TextInput testID="ap-location" value={form.location} onChangeText={(t) => setForm({ ...form, location: t })} style={styles.input} placeholder="Indirizzo o link videochiamata" placeholderTextColor="#94A3B8" />

          <Text style={styles.lbl}>Valore stimato (€)</Text>
          <TextInput testID="ap-value" value={form.value_amount} onChangeText={(t) => setForm({ ...form, value_amount: t.replace(/[^0-9.]/g, "") })} style={styles.input} placeholder="0" placeholderTextColor="#94A3B8" keyboardType="decimal-pad" />

          <Text style={styles.lbl}>Note</Text>
          <TextInput testID="ap-notes" value={form.notes} onChangeText={(t) => setForm({ ...form, notes: t })} style={[styles.input, { minHeight: 70, textAlignVertical: "top" }]} multiline placeholder="Note" placeholderTextColor="#94A3B8" />
        </View>

        <Pressable testID="ap-save" onPress={submit} style={styles.saveBtn} disabled={busy || !form.title.trim()}>
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
  card: { backgroundColor: "#FFF", padding: 14, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border, marginTop: 12, gap: 4 },
  sectionTitle: { fontSize: 12, fontWeight: "700", color: theme.color.brandPrimary, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  lbl: { fontSize: 12, fontWeight: "600", color: theme.color.onSurfaceTertiary, marginTop: 10, marginBottom: 4 },
  input: { backgroundColor: theme.color.surface, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: theme.color.onSurface },
  pillsRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  pill: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: theme.radius.pill, backgroundColor: "#FFF", borderWidth: 1, borderColor: theme.color.border, flexShrink: 0 },
  pillActive: { backgroundColor: theme.color.brandPrimary, borderColor: theme.color.brandPrimary },
  pillTxt: { color: theme.color.onSurfaceTertiary, fontWeight: "600", fontSize: 12 },
  pillTxtActive: { color: "#FFF" },
  dateRow: { flexDirection: "row", gap: 10, marginTop: 4 },
  dateBtn: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: theme.color.surface, padding: 12, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border },
  dateBtnTxt: { color: theme.color.onSurface, fontWeight: "600" },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  switchLbl: { fontSize: 14, color: theme.color.onSurface, fontWeight: "600" },
  saveBtn: { backgroundColor: theme.color.brandPrimary, paddingVertical: 14, borderRadius: theme.radius.md, alignItems: "center", marginTop: 20 },
  saveBtnTxt: { color: "#FFF", fontWeight: "700", fontSize: 15 },
});

const webInputStyle: any = {
  width: "100%",
  backgroundColor: theme.color.surface,
  border: `1px solid ${theme.color.border}`,
  borderRadius: 12,
  padding: "12px 14px",
  fontSize: 15,
  color: theme.color.onSurface,
  fontFamily: "inherit",
  outline: "none",
};

import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Platform, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import DateTimePicker from "@react-native-community/datetimepicker";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { scheduleAppointmentReminder, cancelAppointmentReminder, scheduleCallbackReminder } from "@/src/notifications";
import { openGoogleCalendar, openOutlookCalendar, shareIcs } from "@/src/calendar-export";

type Appointment = {
  appointment_id: string; title: string; area: "energy" | "network"; start_at: string;
  is_phone: boolean; done: boolean; location: string; notes: string;
  outcome_tags: string[]; outcome_notes: string; products_sold: number; contract_signed: boolean;
  contact_id?: string;
};

const ENERGY_OUTCOMES = [
  { key: "non_interessato", label: "Non interessato" },
  { key: "contratto_fatto", label: "Contratto fatto" },
  { key: "richiamare", label: "Richiamare" },
];
const NETWORK_OUTCOMES = [
  { key: "post_appuntamento", label: "Post appuntamento" },
  { key: "ok_abo", label: "Ok Abo" },
  { key: "ok_cliente", label: "Ok Cliente" },
  { key: "dare_seguito", label: "Dare seguito" },
  { key: "primo_avvio", label: "Primo avvio" },
  { key: "presentazione_prodotti", label: "Presentazione prodotti" },
  { key: "incontro_open", label: "Incontro Open" },
  { key: "incontro_bbs", label: "Incontro BBS" },
  { key: "incontro_wes", label: "Incontro WES" },
];

export default function AppointmentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [a, setA] = useState<Appointment | null>(null);
  const [showPicker, setShowPicker] = useState<"date" | "time" | null>(null);
  const [callbackAt, setCallbackAt] = useState<Date>(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const [showCbSection, setShowCbSection] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => setA(await api<Appointment>(`/appointments/${id}`)), [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!a) return <SafeAreaView style={styles.root}><ActivityIndicator style={{ marginTop: 40 }} color={theme.color.brandPrimary} /></SafeAreaView>;

  const color = a.area === "energy" ? theme.color.energy : theme.color.network;
  const outcomes = a.area === "energy" ? ENERGY_OUTCOMES : NETWORK_OUTCOMES;

  const toggleTag = async (key: string) => {
    const has = a.outcome_tags.includes(key);
    const next = has ? a.outcome_tags.filter((t) => t !== key) : [...a.outcome_tags, key];
    setA({ ...a, outcome_tags: next });
    // energy: single-select behavior implicit; for network multiselect. Persist:
    await api(`/appointments/${id}`, { method: "PUT", body: { outcome_tags: next, contract_signed: next.includes("contratto_fatto") || a.contract_signed } });
  };

  const savePartial = async (patch: any) => {
    setBusy(true);
    try {
      const updated = await api<Appointment>(`/appointments/${id}`, { method: "PUT", body: patch });
      setA(updated);
      if (patch.start_at) {
        await scheduleAppointmentReminder(id as string, updated.title, new Date(updated.start_at));
      }
      if (patch.done === true) {
        await cancelAppointmentReminder(id as string);
      }
    } finally { setBusy(false); }
  };

  const rescheduleTo = async (d: Date, mode: "date" | "time") => {
    const next = new Date(a.start_at);
    if (mode === "date") next.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
    else next.setHours(d.getHours(), d.getMinutes());
    await savePartial({ start_at: next.toISOString() });
  };

  const createCallback = async () => {
    const cb = await api<{ callback_id: string; title: string }>("/callbacks", {
      method: "POST",
      body: { title: `Richiamare: ${a.title}`, area: a.area, scheduled_at: callbackAt.toISOString(), contact_id: a.contact_id, note: "" },
    });
    await scheduleCallbackReminder(cb.callback_id, cb.title, callbackAt);
    setShowCbSection(false);
  };

  const del = async () => {
    await cancelAppointmentReminder(id as string);
    await api(`/appointments/${id}`, { method: "DELETE" });
    router.back();
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={[styles.header, { backgroundColor: color }]}>
        <Pressable testID="back-btn" onPress={() => router.back()}><Ionicons name="chevron-back" size={26} color="#FFF" /></Pressable>
        <Text style={styles.headerTxt}>Dettaglio</Text>
        <Pressable testID="delete-appt" onPress={del}><Ionicons name="trash-outline" size={22} color="#FFF" /></Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <View style={[styles.titleCard, { borderLeftColor: color }]}>
          <Text style={styles.apTitle}>{a.title}</Text>
          <View style={styles.metaRow}>
            <Ionicons name="time-outline" size={14} color={theme.color.muted} />
            <Text style={styles.metaTxt}>{new Date(a.start_at).toLocaleString("it-IT")}</Text>
            {a.is_phone && <><Ionicons name="call" size={14} color={color} /><Text style={[styles.metaTxt, { color }]}>Telefonico</Text></>}
          </View>
          {a.location ? (
            <Pressable testID="waze-btn" onPress={() => Linking.openURL(`https://www.waze.com/ul?q=${encodeURIComponent(a.location)}&navigate=yes`)} style={styles.wazeBtn}>
              <Ionicons name="navigate" size={16} color={theme.color.brandPrimary} />
              <Text style={styles.wazeTxt}>{a.location}</Text>
            </Pressable>
          ) : null}
        </View>

        <Pressable testID="done-btn" onPress={() => savePartial({ done: !a.done })} style={[styles.doneBtn, a.done && { backgroundColor: theme.color.success }]}>
          <Ionicons name={a.done ? "checkmark-circle" : "ellipse-outline"} size={22} color="#FFF" />
          <Text style={styles.doneBtnTxt}>{a.done ? "Appuntamento fatto ✓" : "Segna come fatto"}</Text>
        </Pressable>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Sincronizza con calendario</Text>
          <View style={styles.syncRow}>
            <Pressable
              testID="sync-google"
              onPress={() => openGoogleCalendar({ id: a.appointment_id, title: a.title, start: new Date(a.start_at), location: a.location, description: a.notes })}
              style={[styles.syncBtn, { backgroundColor: "#EA4335" }]}
            >
              <Ionicons name="logo-google" size={16} color="#FFF" />
              <Text style={styles.syncBtnTxt}>Google</Text>
            </Pressable>
            <Pressable
              testID="sync-outlook"
              onPress={() => openOutlookCalendar({ id: a.appointment_id, title: a.title, start: new Date(a.start_at), location: a.location, description: a.notes })}
              style={[styles.syncBtn, { backgroundColor: "#0078D4" }]}
            >
              <Ionicons name="mail" size={16} color="#FFF" />
              <Text style={styles.syncBtnTxt}>Outlook</Text>
            </Pressable>
            <Pressable
              testID="sync-ics"
              onPress={() => shareIcs({ id: a.appointment_id, title: a.title, start: new Date(a.start_at), location: a.location, description: a.notes })}
              style={[styles.syncBtn, { backgroundColor: theme.color.brandPrimary }]}
            >
              <Ionicons name="download-outline" size={16} color="#FFF" />
              <Text style={styles.syncBtnTxt}>.ics</Text>
            </Pressable>
          </View>
          <Text style={styles.syncHint}>Aggiungi l&apos;appuntamento al tuo calendario personale (Google, Outlook o file .ics per Apple/altri).</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Sposta / Rinvia</Text>
          <View style={styles.dateRow}>
            <Pressable testID="reschedule-date" onPress={() => setShowPicker("date")} style={styles.dateBtn}>
              <Ionicons name="calendar-outline" size={16} color={theme.color.brandPrimary} />
              <Text style={styles.dateBtnTxt}>{new Date(a.start_at).toLocaleDateString("it-IT")}</Text>
            </Pressable>
            <Pressable testID="reschedule-time" onPress={() => setShowPicker("time")} style={styles.dateBtn}>
              <Ionicons name="time-outline" size={16} color={theme.color.brandPrimary} />
              <Text style={styles.dateBtnTxt}>{new Date(a.start_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text>
            </Pressable>
          </View>
          {showPicker && (Platform.OS === "web" ? (
            <TextInput
              testID="reschedule-web"
              value={new Date(a.start_at).toISOString().slice(0, 16)}
              onChangeText={(v) => { rescheduleTo(new Date(v), "date"); setShowPicker(null); }}
              style={styles.input}
              placeholder="YYYY-MM-DDTHH:MM"
            />
          ) : (
            <DateTimePicker
              value={new Date(a.start_at)}
              mode={showPicker}
              onChange={(e, d) => { setShowPicker(null); if (d) rescheduleTo(d, showPicker); }}
            />
          ))}
        </View>

        {a.is_phone && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Programma ritelefonata</Text>
            {!showCbSection ? (
              <Pressable testID="add-callback-btn" onPress={() => setShowCbSection(true)} style={styles.linkBtn}>
                <Ionicons name="add-circle-outline" size={18} color={theme.color.brandPrimary} />
                <Text style={styles.linkTxt}>Aggiungi ritelefonata</Text>
              </Pressable>
            ) : (
              <>
                {Platform.OS === "web" ? (
                  <TextInput
                    testID="cb-datetime-web"
                    value={callbackAt.toISOString().slice(0, 16)}
                    onChangeText={(v) => setCallbackAt(new Date(v))}
                    style={styles.input}
                  />
                ) : (
                  <DateTimePicker
                    value={callbackAt}
                    mode="datetime"
                    onChange={(e, d) => { if (d) setCallbackAt(d); }}
                  />
                )}
                <Pressable testID="save-callback" onPress={createCallback} style={styles.smallSave}>
                  <Text style={styles.smallSaveTxt}>Salva ritelefonata</Text>
                </Pressable>
              </>
            )}
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Dopo l&apos;appuntamento</Text>
          <View style={styles.outcomesGrid}>
            {outcomes.map((o) => {
              const active = a.outcome_tags.includes(o.key);
              return (
                <Pressable
                  key={o.key}
                  testID={`outcome-${o.key}`}
                  onPress={() => toggleTag(o.key)}
                  style={[styles.outcomeChip, active && { backgroundColor: color, borderColor: color }]}
                >
                  <Ionicons name={active ? "checkmark-circle" : "ellipse-outline"} size={16} color={active ? "#FFF" : theme.color.muted} />
                  <Text style={[styles.outcomeTxt, active && { color: "#FFF" }]}>{o.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.lbl}>Note dettagliate</Text>
          <TextInput
            testID="outcome-notes"
            value={a.outcome_notes || ""}
            onChangeText={(t) => setA({ ...a, outcome_notes: t })}
            onEndEditing={() => savePartial({ outcome_notes: a.outcome_notes })}
            style={[styles.input, { minHeight: 80, textAlignVertical: "top" }]}
            multiline
            placeholder="Aggiungi note approfondite..."
            placeholderTextColor="#94A3B8"
          />

          {a.area === "energy" && (
            <>
              <Text style={styles.lbl}>Prodotti venduti</Text>
              <TextInput
                testID="products-sold"
                value={String(a.products_sold || 0)}
                onChangeText={(t) => setA({ ...a, products_sold: parseInt(t) || 0 })}
                onEndEditing={() => savePartial({ products_sold: a.products_sold })}
                style={styles.input}
                keyboardType="number-pad"
              />
            </>
          )}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12 },
  headerTxt: { color: "#FFF", fontSize: 16, fontWeight: "700" },
  titleCard: { backgroundColor: "#FFF", padding: 16, borderRadius: theme.radius.md, borderLeftWidth: 4, borderWidth: 1, borderColor: theme.color.border },
  apTitle: { fontSize: 20, fontWeight: "700", color: theme.color.onSurface },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6, flexWrap: "wrap" },
  metaTxt: { fontSize: 13, color: theme.color.muted },
  wazeBtn: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10, backgroundColor: theme.color.brandTertiary, alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 6, borderRadius: theme.radius.pill },
  wazeTxt: { color: theme.color.brandPrimary, fontWeight: "600" },
  doneBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: theme.color.brandPrimary, padding: 14, borderRadius: theme.radius.md },
  doneBtnTxt: { color: "#FFF", fontWeight: "700" },
  card: { backgroundColor: "#FFF", padding: 14, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border },
  sectionTitle: { fontSize: 14, fontWeight: "700", color: theme.color.onSurface, marginBottom: 10 },
  dateRow: { flexDirection: "row", gap: 10 },
  dateBtn: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: theme.color.surface, padding: 10, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border },
  dateBtnTxt: { color: theme.color.onSurface, fontWeight: "600" },
  input: { backgroundColor: theme.color.surface, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border, padding: 10, fontSize: 14, color: theme.color.onSurface, marginTop: 8 },
  linkBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
  linkTxt: { color: theme.color.brandPrimary, fontWeight: "600" },
  smallSave: { backgroundColor: theme.color.brandPrimary, padding: 10, borderRadius: theme.radius.md, alignItems: "center", marginTop: 10 },
  smallSaveTxt: { color: "#FFF", fontWeight: "700" },
  outcomesGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  outcomeChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 8, borderRadius: theme.radius.pill, backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border },
  outcomeTxt: { fontSize: 12, fontWeight: "600", color: theme.color.onSurfaceTertiary },
  lbl: { fontSize: 12, fontWeight: "600", color: theme.color.onSurfaceTertiary, marginTop: 12, marginBottom: 4 },
  syncRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  syncBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: theme.radius.md, flex: 1, justifyContent: "center", minWidth: 90 },
  syncBtnTxt: { color: "#FFF", fontWeight: "700", fontSize: 13 },
  syncHint: { fontSize: 11, color: theme.color.muted, marginTop: 8 },
});

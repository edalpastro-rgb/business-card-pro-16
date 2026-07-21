import { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { api } from "@/src/api";
import { theme } from "@/src/theme";

type Appointment = {
  appointment_id: string; title: string; area: "energy" | "network";
  start_at: string; end_at?: string; is_phone: boolean; done: boolean;
  location: string; notes: string; contact_id?: string;
  appointment_type_tags?: string[];
};
type Contact = { contact_id: string; first_name: string; last_name: string; birth_date?: string; area: string };
type Settings = { energy_title: string; energy_color: string; network_title: string; network_color: string };

type CalItem = {
  kind: "appt" | "birthday";
  id: string;
  title: string;
  area: "energy" | "network" | "birthday";
  start_at: Date;
  is_phone?: boolean;
  done?: boolean;
  location?: string;
  contact_id?: string;
  original?: Appointment;
};

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate()+n); return x; }
function sameDay(a: Date, b: Date) { return a.toDateString() === b.toDateString(); }

export default function CalendarioScreen() {
  const router = useRouter();
  const [selectedDate, setSelectedDate] = useState(startOfDay(new Date()));
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "energy" | "network" | "birthday">("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const start = addDays(selectedDate, -3);
      const end = addDays(selectedDate, 30);
      const [a, s, cs] = await Promise.all([
        api<{ items: Appointment[] }>("/appointments", {
          query: { start: start.toISOString(), end: end.toISOString() },
        }),
        api<Settings>("/settings"),
        api<{ items: Contact[] }>("/contacts"),
      ]);
      setAppts(a.items);
      setSettings(s);
      setContacts(cs.items);
    } finally { setLoading(false); }
  }, [selectedDate]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Merge appointments + birthdays into unified calendar items
  const items: CalItem[] = [
    ...appts.map((a): CalItem => ({
      kind: "appt", id: a.appointment_id, title: a.title, area: a.area,
      start_at: new Date(a.start_at), is_phone: a.is_phone, done: a.done,
      location: a.location, contact_id: a.contact_id, original: a,
    })),
    ...contacts.filter((c) => c.birth_date && c.birth_date.length >= 5)
      .flatMap((c): CalItem[] => {
        const parts = (c.birth_date || "").split("/").map((x) => parseInt(x, 10));
        if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) return [];
        const [dd, mm] = parts;
        // generate the birthday for the current year and next year (so it shows within the window)
        return [selectedDate.getFullYear(), selectedDate.getFullYear() + 1].map((year) => {
          const d = new Date(year, mm - 1, dd, 9, 0, 0);
          return {
            kind: "birthday" as const,
            id: `bday_${c.contact_id}_${year}`,
            title: `Compleanno di ${c.first_name} ${c.last_name}`.trim(),
            area: "birthday" as const,
            start_at: d,
            contact_id: c.contact_id,
          };
        });
      }),
  ];

  const days = Array.from({ length: 14 }, (_, i) => addDays(startOfDay(new Date()), i));
  const filteredItems = items.filter((it) => filter === "all" ? true : it.area === filter);
  const dayItems = filteredItems.filter((a) => sameDay(a.start_at, selectedDate));

  const colorFor = (area: string) => {
    if (area === "energy") return settings?.energy_color || theme.color.energy;
    if (area === "network") return settings?.network_color || theme.color.network;
    return "#F59E0B"; // birthday orange
  };

  const toggleDone = async (id: string, done: boolean) => {
    await api(`/appointments/${id}`, { method: "PUT", body: { done: !done } });
    load();
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Calendario</Text>
        <Pressable testID="cal-add-btn" onPress={() => router.push("/appointment/new")} style={styles.headerBtn}>
          <Ionicons name="add" size={22} color="#FFF" />
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.daysRow}>
        {days.map((d) => {
          const selected = sameDay(d, selectedDate);
          const hasEvents = filteredItems.some((it) => sameDay(it.start_at, d));
          return (
            <Pressable
              key={d.toISOString()}
              testID={`day-${d.toISOString().slice(0,10)}`}
              onPress={() => setSelectedDate(d)}
              style={[styles.dayPill, selected && styles.dayPillActive]}
            >
              <Text style={[styles.dayDow, selected && styles.dayDowActive]}>{d.toLocaleDateString("it-IT", { weekday: "short" }).replace(".", "")}</Text>
              <Text style={[styles.dayNum, selected && styles.dayNumActive]}>{d.getDate()}</Text>
              {hasEvents && <View style={[styles.dayDot, selected && { backgroundColor: "#FFF" }]} />}
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filtersRow}>
        {(["all", "energy", "network", "birthday"] as const).map((f) => (
          <Pressable key={f} testID={`cal-filter-${f}`} onPress={() => setFilter(f)} style={[styles.chip, filter === f && styles.chipActive]}>
            <Text style={[styles.chipTxt, filter === f && styles.chipTxtActive]}>
              {f === "all" ? "Tutti" : f === "energy" ? (settings?.energy_title || "Energia") : f === "network" ? (settings?.network_title || "Network") : "Compleanni"}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.dateHeader}>
        <Text style={styles.dateTxt}>{selectedDate.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" })}</Text>
        <Text style={styles.dateSub}>{dayItems.length} appuntamenti</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={theme.color.brandPrimary} style={{ marginTop: 40 }} />
      ) : dayItems.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="calendar-outline" size={40} color={theme.color.muted} />
          <Text style={styles.emptyTxt}>Nessun appuntamento</Text>
        </View>
      ) : (
        <FlatList
          data={dayItems}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: 16 }}
          renderItem={({ item }) => (
            <Pressable
              testID={`appt-${item.id}`}
              onPress={() => {
                if (item.kind === "appt") router.push(`/appointment/${item.id}`);
                else if (item.contact_id) router.push(`/contact/${item.contact_id}`);
              }}
              style={styles.card}
            >
              <View style={[styles.leftBar, { backgroundColor: colorFor(item.area) }]} />
              <View style={{ flex: 1, padding: 12 }}>
                <View style={styles.row}>
                  <Text style={styles.time}>{item.start_at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text>
                  {item.kind === "birthday" && <Ionicons name="gift" size={14} color={colorFor(item.area)} />}
                  {item.is_phone && <Ionicons name="call" size={14} color={colorFor(item.area)} />}
                </View>
                <Text style={[styles.apptTitle, item.done && { textDecorationLine: "line-through", color: theme.color.muted }]}>{item.title}</Text>
                {item.location ? <Text style={styles.loc} numberOfLines={1}><Ionicons name="location-outline" size={11} color={theme.color.muted} /> {item.location}</Text> : null}
              </View>
              {item.kind === "appt" && (
                <Pressable testID={`appt-done-${item.id}`} onPress={() => toggleDone(item.id, !!item.done)} style={styles.checkBtn}>
                  <Ionicons name={item.done ? "checkmark-circle" : "ellipse-outline"} size={26} color={item.done ? theme.color.success : theme.color.muted} />
                </Pressable>
              )}
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 12 },
  title: { fontSize: 24, fontWeight: "700", color: theme.color.onSurface },
  headerBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.color.brandPrimary, alignItems: "center", justifyContent: "center" },
  daysRow: { paddingHorizontal: 16, gap: 8, paddingVertical: 4 },
  filtersRow: { paddingHorizontal: 16, gap: 8, paddingBottom: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: theme.radius.pill, backgroundColor: "#FFF", borderWidth: 1, borderColor: theme.color.border, flexShrink: 0 },
  chipActive: { backgroundColor: theme.color.brandPrimary, borderColor: theme.color.brandPrimary },
  chipTxt: { color: theme.color.onSurfaceTertiary, fontWeight: "600", fontSize: 12 },
  chipTxtActive: { color: "#FFF" },
  dayPill: { width: 56, alignItems: "center", paddingVertical: 10, borderRadius: theme.radius.md, backgroundColor: "#FFF", borderWidth: 1, borderColor: theme.color.border, flexShrink: 0 },
  dayPillActive: { backgroundColor: theme.color.brandPrimary, borderColor: theme.color.brandPrimary },
  dayDow: { fontSize: 11, color: theme.color.muted, textTransform: "capitalize", fontWeight: "600" },
  dayDowActive: { color: "#CFE1EE" },
  dayNum: { fontSize: 18, fontWeight: "700", color: theme.color.onSurface, marginTop: 2 },
  dayNumActive: { color: "#FFF" },
  dayDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: theme.color.brandPrimary, marginTop: 3 },
  dateHeader: { paddingHorizontal: 20, paddingVertical: 12 },
  dateTxt: { fontSize: 17, fontWeight: "700", color: theme.color.onSurface, textTransform: "capitalize" },
  dateSub: { fontSize: 12, color: theme.color.muted, marginTop: 2 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40, gap: 8 },
  emptyTxt: { color: theme.color.muted },
  card: { flexDirection: "row", backgroundColor: "#FFF", borderRadius: theme.radius.md, marginBottom: 8, overflow: "hidden", borderWidth: 1, borderColor: theme.color.border, alignItems: "center" },
  leftBar: { width: 4, alignSelf: "stretch" },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  time: { fontSize: 13, color: theme.color.muted, fontWeight: "600" },
  apptTitle: { fontSize: 15, fontWeight: "700", color: theme.color.onSurface, marginTop: 4 },
  loc: { fontSize: 12, color: theme.color.muted, marginTop: 4 },
  checkBtn: { padding: 14 },
});

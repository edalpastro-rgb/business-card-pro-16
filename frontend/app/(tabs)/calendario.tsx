import { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { CallActionSheet, CallTarget } from "@/src/CallActionSheet";

type Appointment = {
  appointment_id: string; title: string; area: "energy" | "network";
  start_at: string; end_at?: string; is_phone: boolean; done: boolean;
  location: string; notes: string; contact_id?: string;
  appointment_type_tags?: string[];
};
type Contact = { contact_id: string; first_name: string; last_name: string; birth_date?: string; area: string; phone?: string };
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
  const [callTarget, setCallTarget] = useState<CallTarget | null>(null);
  const [viewMode, setViewMode] = useState<"week" | "month" | "year">("week");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let start: Date, end: Date;
      if (viewMode === "year") {
        start = new Date(selectedDate.getFullYear(), 0, 1);
        end = new Date(selectedDate.getFullYear() + 1, 0, 1);
      } else if (viewMode === "month") {
        start = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
        end = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 1);
      } else {
        start = addDays(selectedDate, -7);
        end = addDays(selectedDate, 30);
      }
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
  }, [selectedDate, viewMode]);

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

      <View style={styles.segment}>
        {(["week", "month", "year"] as const).map((m) => (
          <Pressable
            key={m}
            testID={`view-${m}`}
            onPress={() => setViewMode(m)}
            style={[styles.segBtn, viewMode === m && styles.segBtnOn]}
          >
            <Text style={[styles.segTxt, viewMode === m && styles.segTxtOn]}>
              {m === "week" ? "Settimana" : m === "month" ? "Mese" : "Anno"}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Area/merceologica filter — always visible in every view */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filtersRow} style={{ maxHeight: 44 }} testID="cal-area-filters">
        {(["all", "energy", "network", "birthday"] as const).map((f) => (
          <Pressable key={f} testID={`cal-filter-${f}`} onPress={() => setFilter(f)} style={[styles.chip, filter === f && styles.chipActive]}>
            <Text style={[styles.chipTxt, filter === f && styles.chipTxtActive]}>
              {f === "all" ? "Tutti" : f === "energy" ? (settings?.energy_title || "Energia") : f === "network" ? (settings?.network_title || "Network") : "Compleanni"}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {viewMode === "week" && (
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
      )}

      {viewMode === "month" && (
        <MonthGrid
          selectedDate={selectedDate}
          onSelectDay={(d) => { setSelectedDate(d); }}
          items={filteredItems}
          colorFor={colorFor}
          onNavMonth={(delta) => {
            const d = new Date(selectedDate);
            d.setMonth(d.getMonth() + delta);
            setSelectedDate(d);
          }}
        />
      )}

      {viewMode === "year" && (
        <YearGrid
          year={selectedDate.getFullYear()}
          items={filteredItems}
          onSelectMonth={(month) => {
            const d = new Date(selectedDate);
            d.setFullYear(selectedDate.getFullYear(), month, 1);
            setSelectedDate(d);
            setViewMode("month");
          }}
          onNavYear={(delta) => {
            const d = new Date(selectedDate);
            d.setFullYear(d.getFullYear() + delta);
            setSelectedDate(d);
          }}
        />
      )}

      <View style={styles.dateHeader}>
        <Text style={styles.dateTxt}>{selectedDate.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" })}</Text>
        <Text style={styles.dateSub}>{dayItems.length} {dayItems.length === 1 ? "evento" : "eventi"}</Text>
      </View>

      {viewMode !== "year" && (loading ? (
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
                <>
                  {(() => {
                    const contact = item.contact_id ? contacts.find((c) => c.contact_id === item.contact_id) : null;
                    if (!contact?.phone && !item.original?.notes?.match(/(\+?\d[\d\s]{6,})/)) return null;
                    return (
                      <Pressable
                        testID={`appt-call-${item.id}`}
                        onPress={(e) => {
                          e.stopPropagation();
                          const phone = contact?.phone || null;
                          setCallTarget({
                            phone,
                            contact_id: item.contact_id || null,
                            appointment_id: item.id,
                            display_name: item.title,
                          });
                        }}
                        style={styles.callBtn}
                      >
                        <Ionicons name="call" size={18} color="#FFF" />
                      </Pressable>
                    );
                  })()}
                  <Pressable testID={`appt-done-${item.id}`} onPress={() => toggleDone(item.id, !!item.done)} style={styles.checkBtn}>
                    <Ionicons name={item.done ? "checkmark-circle" : "ellipse-outline"} size={26} color={item.done ? theme.color.success : theme.color.muted} />
                  </Pressable>
                </>
              )}
            </Pressable>
          )}
        />
      ))}
      <CallActionSheet
        visible={!!callTarget}
        target={callTarget}
        onClose={() => setCallTarget(null)}
        onCompleted={() => { setCallTarget(null); load(); }}
      />
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
  card: { flexDirection: "row", backgroundColor: "#FFF", borderRadius: 10, marginBottom: 5, overflow: "hidden", borderWidth: 1, borderColor: theme.color.border, alignItems: "center", minHeight: 44 },
  leftBar: { width: 3, alignSelf: "stretch" },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  time: { fontSize: 11, color: theme.color.muted, fontWeight: "600" },
  apptTitle: { fontSize: 13, fontWeight: "700", color: theme.color.onSurface, marginTop: 2 },
  loc: { fontSize: 10, color: theme.color.muted, marginTop: 2 },
  checkBtn: { padding: 10 },
  callBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: "#16A34A", alignItems: "center", justifyContent: "center", marginRight: 4, alignSelf: "center" },
  segment: { flexDirection: "row", marginHorizontal: 16, marginBottom: 8, backgroundColor: theme.color.surfaceTertiary, borderRadius: 20, padding: 3 },
  segBtn: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 16 },
  segBtnOn: { backgroundColor: theme.color.brandPrimary },
  segTxt: { color: theme.color.muted, fontWeight: "700", fontSize: 12 },
  segTxtOn: { color: "#FFF" },
  navRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, marginTop: 4, marginBottom: 8 },
  navTitle: { fontSize: 17, fontWeight: "800", color: theme.color.onSurface, textTransform: "capitalize" },
  navBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: theme.color.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  monthGrid: { paddingHorizontal: 12 },
  monthWeekRow: { flexDirection: "row", justifyContent: "space-around", paddingVertical: 4 },
  monthWeekLbl: { fontSize: 10, color: theme.color.muted, fontWeight: "700", width: `${100/7}%`, textAlign: "center" },
  monthRow: { flexDirection: "row" },
  monthCell: { width: `${100/7}%`, aspectRatio: 1, padding: 2 },
  monthCellInner: { flex: 1, borderRadius: 8, backgroundColor: "#FFF", borderWidth: 1, borderColor: theme.color.border, alignItems: "center", justifyContent: "flex-start", paddingTop: 4 },
  monthCellSelected: { backgroundColor: theme.color.brandPrimary, borderColor: theme.color.brandPrimary },
  monthCellOff: { opacity: 0.35 },
  monthNum: { fontSize: 13, color: theme.color.onSurface, fontWeight: "700" },
  monthNumSel: { color: "#FFF" },
  monthDots: { flexDirection: "row", gap: 2, marginTop: 2 },
  monthDot: { width: 5, height: 5, borderRadius: 3 },
  yearGrid: { padding: 12, flexDirection: "row", flexWrap: "wrap", gap: 8 },
  yearCell: { width: "31%", backgroundColor: "#FFF", borderRadius: 12, borderWidth: 1, borderColor: theme.color.border, padding: 10, alignItems: "center", gap: 4 },
  yearMonthName: { fontSize: 13, fontWeight: "800", color: theme.color.onSurface, textTransform: "capitalize" },
  yearMonthCount: { fontSize: 11, color: theme.color.muted },
  yearDots: { flexDirection: "row", gap: 3, marginTop: 4 },
});

// ============ MonthGrid ============
function MonthGrid({
  selectedDate,
  onSelectDay,
  items,
  colorFor,
  onNavMonth,
}: {
  selectedDate: Date;
  onSelectDay: (d: Date) => void;
  items: CalItem[];
  colorFor: (area: string) => string;
  onNavMonth: (delta: number) => void;
}) {
  const year = selectedDate.getFullYear();
  const month = selectedDate.getMonth();
  const first = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0).getDate();
  // Monday = 0 (Italian week start)
  const startOffset = (first.getDay() + 6) % 7;
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= lastDay; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  const rows: (Date | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));

  const dowLabels = ["L", "M", "M", "G", "V", "S", "D"];
  const eventsByDay: Record<string, CalItem[]> = {};
  for (const it of items) {
    const k = it.start_at.toDateString();
    (eventsByDay[k] = eventsByDay[k] || []).push(it);
  }

  return (
    <View>
      <View style={styles.navRow}>
        <Pressable testID="month-prev" onPress={() => onNavMonth(-1)} style={styles.navBtn}>
          <Ionicons name="chevron-back" size={16} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.navTitle}>{first.toLocaleDateString("it-IT", { month: "long", year: "numeric" })}</Text>
        <Pressable testID="month-next" onPress={() => onNavMonth(1)} style={styles.navBtn}>
          <Ionicons name="chevron-forward" size={16} color={theme.color.onSurface} />
        </Pressable>
      </View>
      <View style={styles.monthGrid}>
        <View style={styles.monthWeekRow}>
          {dowLabels.map((l, i) => <Text key={i} style={styles.monthWeekLbl}>{l}</Text>)}
        </View>
        {rows.map((row, ri) => (
          <View key={ri} style={styles.monthRow}>
            {row.map((d, ci) => {
              const selected = d && d.toDateString() === selectedDate.toDateString();
              const dayEvents = d ? (eventsByDay[d.toDateString()] || []) : [];
              const dots = Array.from(new Set(dayEvents.map((e) => colorFor(e.area)))).slice(0, 3);
              return (
                <View key={ci} style={styles.monthCell}>
                  {d ? (
                    <Pressable
                      testID={`month-day-${d.toISOString().slice(0,10)}`}
                      onPress={() => onSelectDay(d)}
                      style={[styles.monthCellInner, selected && styles.monthCellSelected]}
                    >
                      <Text style={[styles.monthNum, selected && styles.monthNumSel]}>{d.getDate()}</Text>
                      {dots.length > 0 && (
                        <View style={styles.monthDots}>
                          {dots.map((c, i) => <View key={i} style={[styles.monthDot, { backgroundColor: selected ? "#FFF" : c }]} />)}
                        </View>
                      )}
                    </Pressable>
                  ) : (
                    <View style={[styles.monthCellInner, styles.monthCellOff]} />
                  )}
                </View>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

// ============ YearGrid ============
function YearGrid({
  year,
  items,
  onSelectMonth,
  onNavYear,
}: {
  year: number;
  items: CalItem[];
  onSelectMonth: (month: number) => void;
  onNavYear: (delta: number) => void;
}) {
  const countByMonth: number[] = new Array(12).fill(0);
  for (const it of items) {
    if (it.start_at.getFullYear() === year) {
      countByMonth[it.start_at.getMonth()]++;
    }
  }
  return (
    <ScrollView>
      <View style={styles.navRow}>
        <Pressable testID="year-prev" onPress={() => onNavYear(-1)} style={styles.navBtn}>
          <Ionicons name="chevron-back" size={16} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.navTitle}>{year}</Text>
        <Pressable testID="year-next" onPress={() => onNavYear(1)} style={styles.navBtn}>
          <Ionicons name="chevron-forward" size={16} color={theme.color.onSurface} />
        </Pressable>
      </View>
      <View style={styles.yearGrid}>
        {Array.from({ length: 12 }).map((_, m) => {
          const name = new Date(year, m, 1).toLocaleDateString("it-IT", { month: "short" });
          const count = countByMonth[m];
          return (
            <Pressable key={m} testID={`year-month-${m}`} onPress={() => onSelectMonth(m)} style={styles.yearCell}>
              <Text style={styles.yearMonthName}>{name}</Text>
              <Text style={styles.yearMonthCount}>{count} {count === 1 ? "evento" : "eventi"}</Text>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}


import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { CallActionSheet, CallTarget } from "@/src/CallActionSheet";
import { apptTypeColor } from "@/app/appointment/new";
import { useAuth } from "@/src/auth";
import { ModuleErrorBoundary } from "@/src/shared";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";

type Appointment = {
  appointment_id: string; title: string; area: "energy" | "network";
  start_at: string; end_at?: string; is_phone: boolean; done: boolean;
  location: string; notes: string; contact_id?: string;
  appointment_type_tags?: string[];
};
// V38T — Team calendar event (own + others). Adds creator metadata.
type TeamAppointment = Appointment & {
  is_mine: boolean;
  read_only: boolean;
  created_by: string;
  created_by_name: string;
  created_by_color: string;
};
type Contact = { contact_id: string; first_name: string; last_name: string; birth_date?: string; area: string; phone?: string };
type Settings = { energy_title: string; energy_color: string; network_title: string; network_color: string };
type TeamMember = { user_id: string; name: string; email?: string; role: string; color: string; is_me: boolean; is_owner: boolean };

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
  // V38T — Team calendar metadata
  is_mine?: boolean;
  read_only?: boolean;
  created_by?: string;
  created_by_name?: string;
  created_by_color?: string;
};

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate()+n); return x; }
function sameDay(a: Date, b: Date) { return a.toDateString() === b.toDateString(); }

type CalScope = "mine" | "team" | "all";

export default function CalendarioRoute() {
  return (
    <ModuleErrorBoundary moduleName="agenda">
      <CalendarioScreen />
    </ModuleErrorBoundary>
  );
}

function CalendarioScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const pagePad = usePageBottomPadding();
  const [selectedDate, setSelectedDate] = useState(startOfDay(new Date()));
  const [appts, setAppts] = useState<Appointment[]>([]);
  // V50.z79 — Meteo per appuntamenti (cache in memoria: apptId → {icon, temp, label})
  const [weatherByAppt, setWeatherByAppt] = useState<Record<string, { icon: string; temp: number; label: string } | null>>({});
  const [teamAppts, setTeamAppts] = useState<TeamAppointment[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "energy" | "network" | "birthday">("all");
  const [callTarget, setCallTarget] = useState<CallTarget | null>(null);
  const [viewMode, setViewMode] = useState<"week" | "month" | "year">("month");
  // V38T — New: scope tab (Mine / Team / All)
  const [scope, setScope] = useState<CalScope>("mine");
  // V38T — Selected collaborator filter (multi-select). Empty = show all.
  const [memberFilter, setMemberFilter] = useState<Set<string>>(new Set());

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
      const promises: Promise<any>[] = [
        api<{ items: Appointment[] }>("/appointments", {
          query: { start: start.toISOString(), end: end.toISOString() },
        }),
        api<Settings>("/settings"),
        api<{ items: Contact[] }>("/contacts"),
      ];
      // Also load team-wide events when needed
      if (scope === "team" || scope === "all") {
        promises.push(
          api<{ items: TeamAppointment[] }>("/calendar/team", {
            query: { start: start.toISOString(), end: end.toISOString() },
          }),
        );
        promises.push(api<{ items: TeamMember[] }>("/calendar/team-members"));
      }
      const results = await Promise.all(promises);
      const a = results[0] as { items: Appointment[] };
      const s = results[1] as Settings;
      const cs = results[2] as { items: Contact[] };
      setAppts(a.items);
      setSettings(s);
      setContacts(cs.items);
      if (scope === "team" || scope === "all") {
        const t = results[3] as { items: TeamAppointment[] };
        const tm = results[4] as { items: TeamMember[] };
        setTeamAppts(t.items || []);
        setTeamMembers(tm.items || []);
      } else {
        // Reset when going back to mine tab
        setTeamAppts([]);
      }
    } finally { setLoading(false); }
  }, [selectedDate, viewMode, scope]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // V38T — Build unified item list depending on the active scope.
  const items: CalItem[] = useMemo(() => {
    const list: CalItem[] = [];

    if (scope === "mine") {
      // Only own appointments + birthdays
      list.push(
        ...appts.map((a): CalItem => ({
          kind: "appt", id: a.appointment_id, title: a.title, area: a.area,
          start_at: new Date(a.start_at), is_phone: a.is_phone, done: a.done,
          location: a.location, contact_id: a.contact_id, original: a,
          is_mine: true, read_only: false,
          created_by: user?.user_id, created_by_name: user?.name || "Io",
          created_by_color: theme.color.brandPrimary,
        })),
      );
    } else if (scope === "team") {
      // Only OTHERS' appointments (redacted, read-only)
      list.push(
        ...teamAppts
          .filter((a) => !a.is_mine)
          .map((a): CalItem => ({
            kind: "appt", id: a.appointment_id, title: a.title,
            area: (a.area as any) || "energy",
            start_at: new Date(a.start_at),
            is_phone: a.is_phone, done: a.done,
            location: "", contact_id: undefined,
            original: undefined,
            is_mine: false, read_only: true,
            created_by: a.created_by, created_by_name: a.created_by_name,
            created_by_color: a.created_by_color,
          })),
      );
    } else {
      // "all" — combine team (mine + others) into one list. Use teamAppts (both).
      list.push(
        ...teamAppts.map((a): CalItem => ({
          kind: "appt", id: a.appointment_id, title: a.title,
          area: (a.area as any) || "energy",
          start_at: new Date(a.start_at),
          is_phone: a.is_phone, done: a.done,
          location: a.is_mine ? (a.location || "") : "",
          contact_id: a.is_mine ? a.contact_id : undefined,
          original: a.is_mine ? (a as any) : undefined,
          is_mine: !!a.is_mine, read_only: !a.is_mine,
          created_by: a.created_by, created_by_name: a.created_by_name,
          created_by_color: a.created_by_color,
        })),
      );
    }

    // Birthdays — show in "mine" and "all" tabs (never in Team-only tab)
    if (scope !== "team") {
      list.push(
        ...contacts.filter((c) => c.birth_date && c.birth_date.length >= 5)
          .flatMap((c): CalItem[] => {
            const parts = (c.birth_date || "").split("/").map((x) => parseInt(x, 10));
            if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) return [];
            const [dd, mm] = parts;
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
      );
    }

    return list;
  }, [scope, appts, teamAppts, contacts, selectedDate, user]);

  const days = Array.from({ length: 14 }, (_, i) => addDays(startOfDay(new Date()), i));

  // V38T — Apply member filter (only in team/all scopes) + area filter
  const filteredItems = items.filter((it) => {
    if (filter !== "all" && it.area !== filter) return false;
    if (scope !== "mine" && memberFilter.size > 0) {
      // Only apply to appointments; birthdays always pass
      if (it.kind === "appt" && it.created_by && !memberFilter.has(it.created_by)) return false;
    }
    return true;
  });
  const dayItems = filteredItems.filter((a) => sameDay(a.start_at, selectedDate));

  // V50.z79 — Fetch meteo per gli appuntamenti del giorno selezionato.
  // Priorità location: preferred_address del contatto (via lookup contact_id) → item.location → skip.
  useEffect(() => {
    const targets = dayItems
      .filter((it) => it.kind === "appt" && !weatherByAppt[it.id])
      .map((it) => {
        // Priorità: item.location (indirizzo appuntamento). Il preferred_address del contatto
        // richiederebbe una lookup separata — se serve, l'utente può settarlo come location al momento
        // della creazione dell'appuntamento (già supportato).
        const addr = (it.location || "").trim();
        if (!addr) return null;
        const d = it.start_at.toISOString().slice(0, 10);
        return { id: it.id, address: addr, date: d };
      })
      .filter((x): x is { id: string; address: string; date: string } => !!x);
    if (targets.length === 0) return;
    // Limita a 16 giorni (Open-Meteo forecast limit)
    const today = new Date();
    const safe = targets.filter((t) => {
      const dt = new Date(t.date);
      return (dt.getTime() - today.getTime()) <= 16 * 24 * 3600 * 1000 && (dt.getTime() - today.getTime()) >= -1 * 24 * 3600 * 1000;
    });
    if (safe.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api<{ results: Array<{ icon_key?: string; temp?: number; temp_min?: number; temp_max?: number; label?: string } | null> }>(
          "/weather/forecast-by-address",
          { method: "POST", body: { items: safe.map((t) => ({ address: t.address, date: t.date })) } }
        );
        if (cancelled) return;
        const map: Record<string, { icon: string; temp: number; label: string } | null> = {};
        safe.forEach((t, i) => {
          const r = res.results?.[i];
          if (!r) { map[t.id] = null; return; }
          map[t.id] = { icon: r.icon_key || "cloudy", temp: r.temp_max ?? r.temp ?? 0, label: r.label || "" };
        });
        setWeatherByAppt((prev) => ({ ...prev, ...map }));
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [dayItems, weatherByAppt]);

  // v2.19 — Persistent backlog: MY non-done appointments in the past or today.
  // Stays visible until user marks them done or reschedules them to a future date.
  const backlogItems = React.useMemo(() => {
    const now = new Date();
    const endToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    return items
      .filter((it) => it.kind === "appt" && it.is_mine !== false && !it.done)
      .filter((it) => it.start_at <= endToday)
      // Apply the same area filter as the main list so it stays consistent
      .filter((it) => filter === "all" || it.area === filter)
      .sort((a, b) => a.start_at.getTime() - b.start_at.getTime());
  }, [items, filter]);

  const colorFor = (area: string) => {
    if (area === "energy") return settings?.energy_color || theme.color.energy;
    if (area === "network") return settings?.network_color || theme.color.network;
    return "#F59E0B"; // birthday orange
  };

  // V38S — Prefer the appointment_type_tags color over the area color for
  // week/month rendering, so users can see at a glance if it's an Energy
  // appointment, a Telefonata, a Riunione, etc.
  // V38T — In team/all mode, colour events by the creator so users can
  // instantly see who's on the schedule.
  const eventColor = (item: any): string => {
    if (scope !== "mine" && item?.created_by_color) return item.created_by_color;
    const tags = item?.appointment_type_tags || item?.original?.appointment_type_tags || [];
    if (Array.isArray(tags) && tags.length > 0) return apptTypeColor(tags[0]);
    return colorFor(item?.area || "");
  };

  const toggleDone = async (id: string, done: boolean) => {
    await api(`/appointments/${id}`, { method: "PUT", body: { done: !done } });
    load();
  };

  const toggleMember = (uid: string) => {
    setMemberFilter((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid); else next.add(uid);
      return next;
    });
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Calendario</Text>
      </View>

      {/* V38S — Long green "Aggiungi Appuntamento" button */}
      <Pressable testID="cal-add-btn" onPress={() => router.push("/appointment/new")} style={styles.greenAddBtn}>
        <Ionicons name="add-circle" size={20} color="#FFF" />
        <Text style={styles.greenAddTxt}>Aggiungi Appuntamento</Text>
      </Pressable>

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

      {viewMode !== "year" && (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: pagePad }}
          showsVerticalScrollIndicator={true}
          testID="cal-scroll"
        >
          {viewMode === "month" && (
            <MonthGrid
              selectedDate={selectedDate}
              onSelectDay={(d) => { setSelectedDate(d); }}
              items={filteredItems}
              colorFor={colorFor}
              eventColor={eventColor}
              onNavMonth={(delta) => {
                const d = new Date(selectedDate);
                d.setMonth(d.getMonth() + delta);
                setSelectedDate(d);
              }}
            />
          )}

          {/* v2.19 — Filters moved BELOW the calendar so the grid stays visible */}
          <View style={styles.scopeBar}>
            {([
              { k: "mine" as const, label: "I miei", icon: "person" as const },
              { k: "team" as const, label: "Team", icon: "people" as const },
              { k: "all" as const, label: "Io + Team", icon: "layers" as const },
            ]).map((s) => (
              <Pressable
                key={s.k}
                testID={`scope-${s.k}`}
                onPress={() => { setScope(s.k); setMemberFilter(new Set()); }}
                style={[styles.scopeBtn, scope === s.k && styles.scopeBtnOn]}
              >
                <Ionicons name={s.icon} size={14} color={scope === s.k ? "#FFF" : theme.color.muted} />
                <Text style={[styles.scopeTxt, scope === s.k && styles.scopeTxtOn]}>{s.label}</Text>
              </Pressable>
            ))}
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filtersRow} style={{ maxHeight: 44 }} testID="cal-area-filters">
            {(["all", "energy", "network", "birthday"] as const).map((f) => (
              <Pressable key={f} testID={`cal-filter-${f}`} onPress={() => setFilter(f)} style={[styles.chip, filter === f && styles.chipActive]}>
                <Text style={[styles.chipTxt, filter === f && styles.chipTxtActive]}>
                  {f === "all" ? "Tutti" : f === "energy" ? (settings?.energy_title || "Energia") : f === "network" ? (settings?.network_title || "Network") : "Compleanni"}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          {(scope === "team" || scope === "all") && teamMembers.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filtersRow}
              style={{ maxHeight: 44 }}
              testID="cal-member-filters"
            >
              {teamMembers
                .filter((m) => scope === "all" || !m.is_me)
                .map((m) => {
                  const active = memberFilter.has(m.user_id);
                  return (
                    <Pressable
                      key={m.user_id}
                      testID={`member-filter-${m.user_id}`}
                      onPress={() => toggleMember(m.user_id)}
                      style={[styles.memberChip, active && { backgroundColor: m.color, borderColor: m.color }]}
                    >
                      <View style={[styles.memberDot, { backgroundColor: m.color }]} />
                      <Text style={[styles.chipTxt, active && styles.chipTxtActive]} numberOfLines={1}>
                        {m.is_me ? "Io" : (m.name?.split(" ")[0] || m.name || "Coll.")}
                      </Text>
                    </Pressable>
                  );
                })}
            </ScrollView>
          )}

          {/* v2.19 — Stats link */}
          <Pressable
            testID="cal-stats-link"
            onPress={() => router.push("/appointment-stats" as any)}
            style={styles.statsLink}
          >
            <Ionicons name="stats-chart" size={16} color={theme.color.brandPrimary} />
            <Text style={styles.statsLinkTxt}>Statistiche appuntamenti</Text>
            <Ionicons name="chevron-forward" size={16} color={theme.color.brandPrimary} />
          </Pressable>

          <View style={styles.dateHeader}>
            <Text style={styles.dateTxt}>{selectedDate.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" })}</Text>
            <Text style={styles.dateSub}>{dayItems.length} {dayItems.length === 1 ? "evento" : "eventi"}</Text>
          </View>

          {loading ? (
            <ActivityIndicator color={theme.color.brandPrimary} style={{ marginTop: 40 }} />
          ) : dayItems.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="calendar-outline" size={40} color={theme.color.muted} />
              <Text style={styles.emptyTxt}>
                {scope === "team" ? "Nessun appuntamento del team" : "Nessun appuntamento"}
              </Text>
            </View>
          ) : (
            <View style={{ padding: 16 }}>
              {dayItems.map((item) => (
                <Pressable
                  key={item.id}
                  testID={`appt-${item.id}`}
                  onPress={() => {
                    // V38T — read-only team appointments can't be opened
                    if (item.read_only) return;
                    if (item.kind === "appt") router.push(`/appointment/${item.id}`);
                    else if (item.contact_id) router.push(`/contact/${item.contact_id}`);
                  }}
                  style={[styles.card, item.read_only && styles.cardReadOnly]}
                >
                  <View style={[styles.leftBar, { backgroundColor: eventColor(item) }]} />
                  <View style={{ flex: 1, padding: 12 }}>
                    <View style={styles.row}>
                      <Text style={styles.time}>{item.start_at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text>
                      {item.kind === "birthday" ? <Ionicons name="gift" size={14} color={eventColor(item)} /> : null}
                      {item.is_phone ? <Ionicons name="call" size={14} color={eventColor(item)} /> : null}
                      {/* V50.z79 — Meteo badge (icona + temperatura) */}
                      {(() => {
                        const w = weatherByAppt[item.id];
                        if (!w) return null;
                        const iconMap: Record<string, keyof typeof Ionicons.glyphMap> = {
                          sunny: "sunny", partly_cloudy: "partly-sunny", cloudy: "cloud",
                          fog: "cloud-outline", drizzle: "rainy-outline", rain: "rainy",
                          rain_heavy: "thunderstorm", snow: "snow", snow_heavy: "snow",
                          thunderstorm: "thunderstorm-outline",
                        };
                        return (
                          <View style={styles.wxBadge}>
                            <Ionicons name={iconMap[w.icon] || "cloud"} size={11} color="#0369A1" />
                            <Text style={styles.wxBadgeTxt}>{Math.round(w.temp)}°</Text>
                          </View>
                        );
                      })()}
                      {/* V38T — Collaborator badge on non-own events */}
                      {item.kind === "appt" && !item.is_mine && item.created_by_name && (
                        <View style={[styles.creatorBadge, { backgroundColor: item.created_by_color || theme.color.muted }]}>
                          <Ionicons name="person" size={9} color="#FFF" />
                          <Text style={styles.creatorBadgeTxt} numberOfLines={1}>
                            {(item.created_by_name || "").split(" ")[0]}
                          </Text>
                        </View>
                      )}
                      {/* V38T — Read-only lock hint */}
                      {item.read_only && (
                        <Ionicons name="lock-closed" size={11} color={theme.color.muted} />
                      )}
                    </View>
                    <Text style={[styles.apptTitle, item.done && { textDecorationLine: "line-through", color: theme.color.muted }]}>{item.title}</Text>
                    {item.location ? <Text style={styles.loc} numberOfLines={1}><Ionicons name="location-outline" size={11} color={theme.color.muted} /> {item.location}</Text> : null}
                  </View>
                  {/* Only show call / done for OWN appointments */}
                  {item.kind === "appt" && item.is_mine !== false && (() => {
                    const contact = item.contact_id ? contacts.find((c) => c.contact_id === item.contact_id) : null;
                    const hasPhone = !!(contact?.phone || item.original?.notes?.match(/(\+?\d[\d\s]{6,})/));
                    return (
                      <>
                        {hasPhone ? (
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
                        ) : null}
                        <Pressable testID={`appt-done-${item.id}`} onPress={() => toggleDone(item.id, !!item.done)} style={styles.checkBtn}>
                          <Ionicons name={item.done ? "checkmark-circle" : "ellipse-outline"} size={26} color={item.done ? theme.color.success : theme.color.muted} />
                        </Pressable>
                      </>
                    );
                  })()}
                </Pressable>
              ))}
            </View>
          )}

          {/* v2.19 — Persistent backlog of my non-done appointments (today + past) */}
          {backlogItems.length > 0 && (
            <View style={{ marginTop: 12, marginBottom: 20 }}>
              <View style={styles.backlogHdr}>
                <Ionicons name="alarm" size={16} color="#B45309" />
                <Text style={styles.backlogTitle}>Da recuperare · {backlogItems.length}</Text>
              </View>
              <Text style={styles.backlogHint}>Appuntamenti miei non ancora fatti (oggi + arretrati). Restano visibili finché non li segni come fatti o li riprogrammi.</Text>
              {backlogItems.map((item) => {
                const dt = new Date(item.start_at);
                const dateFmt = dt.toLocaleDateString("it-IT", { day: "2-digit", month: "short" });
                const timeFmt = dt.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
                const daysAgo = Math.floor((Date.now() - dt.getTime()) / 86400000);
                const isPast = daysAgo > 0;
                return (
                  <Pressable
                    key={`bk-${item.id}`}
                    testID={`backlog-item-${item.id}`}
                    onPress={() => router.push(`/appointment/${item.id}` as any)}
                    style={[styles.backlogItem, isPast && styles.backlogItemPast]}
                  >
                    <View style={[styles.backlogDot, { backgroundColor: colorFor(item) }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.backlogItemTitle} numberOfLines={1}>{item.title}</Text>
                      <Text style={styles.backlogItemMeta}>
                        {dateFmt} · {timeFmt}{isPast ? ` · ${daysAgo} ${daysAgo === 1 ? "giorno" : "giorni"} fa` : " · oggi"}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={theme.color.muted} />
                  </Pressable>
                );
              })}
            </View>
          )}
        </ScrollView>
      )}
      <CallActionSheet
        visible={!!callTarget}
        target={callTarget}
        onClose={() => setCallTarget(null)}
        onCompleted={(res) => {
          const contactId = callTarget?.contact_id || null;
          setCallTarget(null);
          load();
          if (res?.outcome_id === "call_appointment" && contactId) {
            router.push(`/appointment/new?contact_id=${contactId}`);
          }
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 12 },
  title: { fontSize: 24, fontWeight: "700", color: theme.color.onSurface },
  // V29.bb — Stile Optima
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.color.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.9)",
    shadowColor: "#000",
    shadowOpacity: 0.20,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  // V38S — Long green "Aggiungi Appuntamento" button (replaces round FAB)
  greenAddBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#16A34A", marginHorizontal: 14, marginTop: 8, paddingVertical: 12, borderRadius: 10 },
  greenAddTxt: { color: "#FFF", fontSize: 14, fontWeight: "800" },
  // V38T — Scope tab bar (Mine / Team / All)
  scopeBar: { flexDirection: "row", marginHorizontal: 16, marginTop: 10, marginBottom: 4, backgroundColor: "#FFF", borderWidth: 1, borderColor: theme.color.border, borderRadius: 10, padding: 3 },
  scopeBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 8, borderRadius: 8 },
  scopeBtnOn: { backgroundColor: theme.color.brandPrimary },
  scopeTxt: { color: theme.color.muted, fontWeight: "700", fontSize: 12 },
  scopeTxtOn: { color: "#FFF" },
  daysRow: { paddingHorizontal: 16, gap: 8, paddingVertical: 4 },
  filtersRow: { paddingHorizontal: 16, gap: 8, paddingBottom: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: theme.radius.pill, backgroundColor: "#FFF", borderWidth: 1, borderColor: theme.color.border, flexShrink: 0 },
  chipActive: { backgroundColor: theme.color.brandPrimary, borderColor: theme.color.brandPrimary },
  chipTxt: { color: theme.color.onSurfaceTertiary, fontWeight: "600", fontSize: 12 },
  chipTxtActive: { color: "#FFF" },
  // V38T — Member (collaborator) chip
  memberChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: theme.radius.pill, backgroundColor: "#FFF", borderWidth: 1, borderColor: theme.color.border, flexShrink: 0, maxWidth: 140 },
  memberDot: { width: 8, height: 8, borderRadius: 4 },
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
  cardReadOnly: { opacity: 0.85, backgroundColor: "#F8FAFC" },
  leftBar: { width: 3, alignSelf: "stretch" },
  row: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  time: { fontSize: 11, color: theme.color.muted, fontWeight: "600" },
  // V50.z79 — Meteo badge accanto all'orario
  wxBadge: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, backgroundColor: "#E0F2FE", borderWidth: 1, borderColor: "#BAE6FD" },
  wxBadgeTxt: { fontSize: 10, fontWeight: "700", color: "#0369A1" },
  apptTitle: { fontSize: 13, fontWeight: "700", color: theme.color.onSurface, marginTop: 2 },
  loc: { fontSize: 10, color: theme.color.muted, marginTop: 2 },
  checkBtn: { padding: 10 },
  callBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#16A34A",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 4,
    alignSelf: "center",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.9)",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  // V38T — Creator badge on team appointments
  creatorBadge: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10, maxWidth: 90 },
  creatorBadgeTxt: { color: "#FFF", fontSize: 10, fontWeight: "700" },
  segment: { flexDirection: "row", marginHorizontal: 16, marginBottom: 8, backgroundColor: theme.color.surfaceTertiary, borderRadius: 20, padding: 3 },
  segBtn: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 16 },
  segBtnOn: { backgroundColor: theme.color.brandPrimary },
  segTxt: { color: theme.color.muted, fontWeight: "700", fontSize: 12 },
  segTxtOn: { color: "#FFF" },
  navRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, marginTop: 4, marginBottom: 8 },
  navTitle: { fontSize: 17, fontWeight: "800", color: theme.color.onSurface, textTransform: "capitalize" },
  // V29.bb — Stile Optima
  navBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.color.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.85)",
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
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
  // v2.19 — Stats link + backlog
  statsLink: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingVertical: 10, paddingHorizontal: 14,
    backgroundColor: "#EEF2FF", borderRadius: 10, marginTop: 10, marginBottom: 4,
  },
  statsLinkTxt: { flex: 1, fontSize: 13, fontWeight: "800", color: theme.color.brandPrimary },
  backlogHdr: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  backlogTitle: { fontSize: 14, fontWeight: "800", color: "#B45309", textTransform: "uppercase", letterSpacing: 0.4 },
  backlogHint: { fontSize: 11, color: theme.color.muted, marginBottom: 8, lineHeight: 15 },
  backlogItem: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingVertical: 10, paddingHorizontal: 12,
    backgroundColor: "#FFF7ED", borderRadius: 10, borderWidth: 1, borderColor: "#FED7AA",
    marginBottom: 6,
  },
  backlogItemPast: { backgroundColor: "#FEF2F2", borderColor: "#FCA5A5" },
  backlogDot: { width: 10, height: 10, borderRadius: 5 },
  backlogItemTitle: { fontSize: 13, fontWeight: "700", color: theme.color.onSurface },
  backlogItemMeta: { fontSize: 11, color: theme.color.muted, marginTop: 2 },
  yearDots: { flexDirection: "row", gap: 3, marginTop: 4 },
});

// ============ MonthGrid ============
function MonthGrid({
  selectedDate,
  onSelectDay,
  items,
  colorFor,
  eventColor,
  onNavMonth,
}: {
  selectedDate: Date;
  onSelectDay: (d: Date) => void;
  items: CalItem[];
  colorFor: (area: string) => string;
  eventColor: (it: any) => string;
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
              const dots = Array.from(new Set(dayEvents.map((e) => eventColor(e)))).slice(0, 3);
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
    <ScrollView contentContainerStyle={{ paddingBottom: 180 }}>
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

// Corporate Gym — pagina principale (Blocco 1): banner header, sottosezioni Gym Obiezioni / Gym WIN-WIN,
// le mie sessioni (completa / elimina), nuova sessione (auto-assegnazione; Titolare/Admin anche ad altri),
// quadro team (Titolare/Admin).
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, RefreshControl, Modal, TextInput, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { useAuth } from "@/src/auth";
import { notify } from "@/src/utils/notify";
import { usePageBottomPadding, useBottomSheetPadding } from "@/src/utils/bottomSheetInsets";
import { CgymHeaderBanner } from "@/src/corporate-gym/CgymHeaderBanner";
import { CgymTileIcon } from "@/src/corporate-gym/CgymTileIcon";
import { cgymApi, CgymSession, CgymType, CgymTeamRow, CGYM_TYPE_META, CGYM_ORANGE, fmtCgymDate, isPast } from "@/src/corporate-gym/api";

type Member = { user_id: string; name?: string; email?: string; role?: string };

const DAY_OPTS = [
  { label: "Oggi", days: 0 },
  { label: "Domani", days: 1 },
  { label: "+3 gg", days: 3 },
  { label: "+7 gg", days: 7 },
];
const TIME_OPTS = ["09:00", "11:00", "15:00", "17:00"];

export default function CorporateGymHome() {
  const router = useRouter();
  const { user } = useAuth();
  const pagePad = usePageBottomPadding();
  const sheetPad = useBottomSheetPadding();
  const isAdmin = !!user && (user.role === "admin" || (user.role === "owner" && !user.parent_user_id));

  const [sessions, setSessions] = useState<CgymSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<"todo" | "done">("todo");
  const [team, setTeam] = useState<CgymTeamRow[] | null>(null);
  const [teamOpen, setTeamOpen] = useState(false);

  // Nuova sessione
  const [newOpen, setNewOpen] = useState(false);
  const [nType, setNType] = useState<CgymType>("obiezioni");
  const [nDay, setNDay] = useState(0);
  const [nTime, setNTime] = useState("09:00");
  const [nTitle, setNTitle] = useState("");
  const [nMandatory, setNMandatory] = useState(false);
  const [nUser, setNUser] = useState<string | null>(null); // null = io
  const [members, setMembers] = useState<Member[]>([]);
  const [saving, setSaving] = useState(false);

  const loadTeam = useCallback(() => {
    if (!isAdmin) return;
    cgymApi.teamOverview().then((t) => setTeam(t.items || [])).catch(() => setTeam(null));
  }, [isAdmin]);

  const load = useCallback(async () => {
    try {
      const r = await cgymApi.list({ scope: "mine" });
      setSessions(r.items || []);
      loadTeam();
    } catch (e: any) {
      notify("Corporate Gym", e?.message || "Errore di caricamento");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [loadTeam]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    if (!newOpen || !isAdmin) return;
    api<{ items: Member[] }>("/team/members").then((r) => setMembers(r.items || [])).catch(() => setMembers([]));
  }, [newOpen, isAdmin]);

  const visible = useMemo(
    () => sessions.filter((s) => (filter === "done" ? s.status === "completata" : s.status !== "completata")),
    [sessions, filter],
  );
  const todoCount = sessions.filter((s) => s.status !== "completata").length;
  const mandatoryPending = sessions.filter((s) => s.status !== "completata" && s.mandatory).length;

  const setStatus = async (s: CgymSession, status: CgymSession["status"]) => {
    try {
      const upd = await cgymApi.update(s.session_id, { status });
      setSessions((prev) => prev.map((p) => (p.session_id === s.session_id ? { ...p, ...upd } : p)));
      loadTeam();
    } catch (e: any) {
      notify("Errore", e?.message || "");
    }
  };
  const remove = async (s: CgymSession) => {
    try {
      await cgymApi.remove(s.session_id);
      setSessions((prev) => prev.filter((p) => p.session_id !== s.session_id));
      loadTeam();
    } catch (e: any) {
      notify("Errore", e?.message || "");
    }
  };

  const openNew = (type?: CgymType) => {
    if (type) setNType(type);
    setNDay(0); setNTime("09:00"); setNTitle(""); setNMandatory(false); setNUser(null);
    setNewOpen(true);
  };

  const saveNew = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const d = new Date();
      d.setDate(d.getDate() + nDay);
      const [hh, mm] = nTime.split(":").map((x) => parseInt(x, 10));
      d.setHours(hh, mm, 0, 0);
      await cgymApi.create({
        type: nType,
        scheduled_at: d.toISOString(),
        title: nTitle.trim() || undefined,
        mandatory: nMandatory,
        user_id: nUser || undefined,
      });
      setNewOpen(false);
      notify("Corporate Gym", nUser ? "Sessione assegnata" : "Sessione creata");
      load();
    } catch (e: any) {
      notify("Errore", e?.message || "");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable testID="cgym-back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/home" as any))} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.title}>Corporate Gym</Text>
        <Pressable testID="cgym-new" onPress={() => openNew()} hitSlop={10} style={styles.headBtn}>
          <Ionicons name="add" size={20} color="#FFF" />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 14, paddingBottom: pagePad }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      >
        <CgymHeaderBanner subtitle={mandatoryPending > 0 ? `${mandatoryPending} obbligatorie da completare` : todoCount > 0 ? `${todoCount} sessioni da fare` : "Allenati sulle obiezioni e sulla negoziazione"} />

        {/* Sottosezioni */}
        <View style={styles.grid}>
          {(Object.keys(CGYM_TYPE_META) as CgymType[]).map((t) => {
            const m = CGYM_TYPE_META[t];
            const n = sessions.filter((s) => s.type === t && s.status !== "completata").length;
            return (
              <Pressable key={t} style={styles.tile} onPress={() => router.push(m.route as any)} testID={`cgym-tile-${t}`}>
                <CgymTileIcon type={t} size={72} />
                <Text style={styles.tileTitle}>{m.label}</Text>
                <Text style={styles.tileSub}>{n > 0 ? `${n} da fare` : "Nessuna in sospeso"}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Le mie sessioni */}
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Le mie sessioni</Text>
          <View style={styles.segment}>
            {(["todo", "done"] as const).map((f) => (
              <Pressable key={f} onPress={() => setFilter(f)} style={[styles.segBtn, filter === f && styles.segBtnOn]} testID={`cgym-filter-${f}`}>
                <Text style={[styles.segTxt, filter === f && styles.segTxtOn]}>{f === "todo" ? `Da fare (${todoCount})` : `Completate (${sessions.length - todoCount})`}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {loading ? (
          <ActivityIndicator color={CGYM_ORANGE} style={{ marginVertical: 20 }} />
        ) : visible.length === 0 ? (
          <View style={styles.empty} testID="cgym-empty">
            <Ionicons name="barbell-outline" size={28} color={theme.color.muted} />
            <Text style={styles.emptyTxt}>{filter === "todo" ? "Nessuna sessione da fare" : "Nessuna sessione completata"}</Text>
            {filter === "todo" && (
              <Pressable onPress={() => openNew()} style={styles.emptyBtn} testID="cgym-empty-new">
                <Text style={styles.emptyBtnTxt}>Nuova sessione</Text>
              </Pressable>
            )}
          </View>
        ) : (
          visible.map((s) => {
            const m = CGYM_TYPE_META[s.type];
            const late = s.status !== "completata" && isPast(s.scheduled_at);
            return (
              <View key={s.session_id} style={[styles.row, s.mandatory && s.status !== "completata" && { borderLeftColor: CGYM_ORANGE, borderLeftWidth: 3 }]} testID={`cgym-session-${s.session_id}`}>
                <View style={[styles.rowIcon, { backgroundColor: m.color + "22" }]}>
                  <Ionicons name={m.icon as any} size={18} color={m.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{s.title || m.label}</Text>
                  <Text style={[styles.rowSub, late && { color: theme.color.error }]}>
                    {late ? "In ritardo · " : ""}{fmtCgymDate(s.scheduled_at)}
                    {s.mandatory ? " · Obbligatoria" : ""}
                    {s.status === "in_corso" ? " · In corso" : ""}
                    {s.status === "completata" && s.score != null ? ` · Score ${s.score}` : ""}
                  </Text>
                </View>
                {s.status !== "completata" ? (
                  <>
                    {(s.status === "assegnata" || s.type === "obiezioni") && (
                      <Pressable
                        onPress={() => (s.type === "obiezioni"
                          ? router.push({ pathname: "/corporate-gym/roleplay", params: { session_id: s.session_id } } as any)
                          : setStatus(s, "in_corso"))}
                        hitSlop={6}
                        style={[styles.rowBtn, s.type === "obiezioni" && { backgroundColor: CGYM_ORANGE }]}
                        testID={`cgym-start-${s.session_id}`}
                        accessibilityLabel={s.type === "obiezioni" ? "Avvia role-play" : "Inizia"}
                      >
                        <Ionicons name={s.type === "obiezioni" ? "mic" : "play"} size={16} color={s.type === "obiezioni" ? "#FFF" : theme.color.brandPrimary} />
                      </Pressable>
                    )}
                    <Pressable onPress={() => setStatus(s, "completata")} hitSlop={6} style={[styles.rowBtn, { backgroundColor: theme.color.success + "22" }]} testID={`cgym-done-${s.session_id}`} accessibilityLabel="Completa">
                      <Ionicons name="checkmark" size={18} color={theme.color.success} />
                    </Pressable>
                  </>
                ) : (
                  <Pressable onPress={() => setStatus(s, "assegnata")} hitSlop={6} style={styles.rowBtn} testID={`cgym-reopen-${s.session_id}`} accessibilityLabel="Riapri">
                    <Ionicons name="refresh" size={16} color={theme.color.muted} />
                  </Pressable>
                )}
                {(isAdmin || s.assigned_by === s.user_id) && (
                  <Pressable onPress={() => remove(s)} hitSlop={6} style={styles.rowBtn} testID={`cgym-del-${s.session_id}`} accessibilityLabel="Elimina">
                    <Ionicons name="trash-outline" size={16} color={theme.color.error} />
                  </Pressable>
                )}
              </View>
            );
          })
        )}

        {/* Quadro team (Titolare/Admin) */}
        {isAdmin && (
          <View style={styles.card} testID="cgym-team-card">
            <Pressable style={styles.cardHead} onPress={() => setTeamOpen((v) => !v)} testID="cgym-team-toggle">
              <Ionicons name="people" size={18} color="#EAB308" />
              <Text style={styles.cardTitle}>Quadro team</Text>
              <Ionicons name={teamOpen ? "chevron-up" : "chevron-down"} size={18} color={theme.color.muted} />
            </Pressable>
            {teamOpen && (
              team == null ? (
                <ActivityIndicator color={CGYM_ORANGE} style={{ marginVertical: 10 }} />
              ) : team.length === 0 ? (
                <Text style={styles.emptyTxt}>Nessun membro</Text>
              ) : (
                team.map((r) => (
                  <View key={r.user_id} style={styles.teamRow} testID={`cgym-team-${r.user_id}`}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle} numberOfLines={1}>{r.name}{r.user_id === user?.user_id ? " (io)" : ""}</Text>
                      <Text style={styles.rowSub}>
                        {r.assegnata} assegnate · {r.in_corso} in corso · {r.completata} completate
                        {r.avg_score != null ? ` · media ${r.avg_score}` : ""}
                      </Text>
                    </View>
                    {r.mandatory_pending > 0 && (
                      <View style={styles.pill}><Text style={styles.pillTxt}>{r.mandatory_pending} obbl.</Text></View>
                    )}
                  </View>
                ))
              )
            )}
          </View>
        )}
      </ScrollView>

      {/* Nuova sessione */}
      <Modal visible={newOpen} transparent animationType="slide" onRequestClose={() => setNewOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.sheetBg}>
          <Pressable style={{ flex: 1 }} onPress={() => setNewOpen(false)} />
          <View style={[styles.sheet, { paddingBottom: sheetPad }]} testID="cgym-new-sheet">
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Nuova sessione</Text>
              <Pressable onPress={() => setNewOpen(false)} hitSlop={10} testID="cgym-new-close"><Ionicons name="close" size={22} color={theme.color.onSurface} /></Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 460 }}>
              <Text style={styles.lbl}>Tipo</Text>
              <View style={styles.chips}>
                {(Object.keys(CGYM_TYPE_META) as CgymType[]).map((t) => (
                  <Pressable key={t} onPress={() => setNType(t)} style={[styles.chip, nType === t && { backgroundColor: CGYM_TYPE_META[t].color, borderColor: CGYM_TYPE_META[t].color }]} testID={`cgym-new-type-${t}`}>
                    <Text style={[styles.chipTxt, nType === t && { color: "#FFF" }]}>{CGYM_TYPE_META[t].label}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.lbl}>Giorno</Text>
              <View style={styles.chips}>
                {DAY_OPTS.map((o) => (
                  <Pressable key={o.days} onPress={() => setNDay(o.days)} style={[styles.chip, nDay === o.days && styles.chipOn]} testID={`cgym-new-day-${o.days}`}>
                    <Text style={[styles.chipTxt, nDay === o.days && { color: "#FFF" }]}>{o.label}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.lbl}>Ora</Text>
              <View style={styles.chips}>
                {TIME_OPTS.map((t) => (
                  <Pressable key={t} onPress={() => setNTime(t)} style={[styles.chip, nTime === t && styles.chipOn]} testID={`cgym-new-time-${t.replace(":", "")}`}>
                    <Text style={[styles.chipTxt, nTime === t && { color: "#FFF" }]}>{t}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.lbl}>Titolo (opzionale)</Text>
              <TextInput value={nTitle} onChangeText={setNTitle} placeholder={CGYM_TYPE_META[nType].label} placeholderTextColor={theme.color.muted} style={styles.input} testID="cgym-new-title" />
              <Pressable onPress={() => setNMandatory((v) => !v)} style={styles.toggleRow} testID="cgym-new-mandatory">
                <Ionicons name={nMandatory ? "checkbox" : "square-outline"} size={22} color={nMandatory ? CGYM_ORANGE : theme.color.muted} />
                <Text style={styles.toggleTxt}>Obbligatoria (avviso in Home fino al completamento)</Text>
              </Pressable>
              {isAdmin && (
                <>
                  <Text style={styles.lbl}>Assegna a</Text>
                  <View style={styles.chips}>
                    <Pressable onPress={() => setNUser(null)} style={[styles.chip, nUser === null && styles.chipOn]} testID="cgym-new-user-me">
                      <Text style={[styles.chipTxt, nUser === null && { color: "#FFF" }]}>Io stesso</Text>
                    </Pressable>
                    {members.map((m) => (
                      <Pressable key={m.user_id} onPress={() => setNUser(m.user_id)} style={[styles.chip, nUser === m.user_id && styles.chipOn]} testID={`cgym-new-user-${m.user_id}`}>
                        <Text style={[styles.chipTxt, nUser === m.user_id && { color: "#FFF" }]} numberOfLines={1}>{m.name || m.email}</Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              )}
            </ScrollView>
            <Pressable onPress={saveNew} disabled={saving} style={[styles.saveBtn, saving && { opacity: 0.6 }]} testID="cgym-new-save">
              {saving ? <ActivityIndicator color="#FFF" /> : <Text style={styles.saveTxt}>{nUser ? "Assegna sessione" : "Crea sessione"}</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.color.border, backgroundColor: theme.color.surfaceSecondary },
  title: { fontSize: 18, fontWeight: "800", color: theme.color.onSurface },
  headBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: CGYM_ORANGE, alignItems: "center", justifyContent: "center" },
  grid: { flexDirection: "row", gap: 10, marginBottom: 16 },
  tile: { flex: 1, backgroundColor: theme.color.surfaceSecondary, borderRadius: 14, borderWidth: 1, borderColor: theme.color.border, padding: 12, gap: 6 },
  tileTitle: { fontSize: 14, fontWeight: "800", color: theme.color.onSurface },
  tileSub: { fontSize: 12, color: theme.color.muted },
  sectionHead: { gap: 8, marginBottom: 10 },
  sectionTitle: { fontSize: 16, fontWeight: "800", color: theme.color.onSurface },
  segment: { flexDirection: "row", backgroundColor: theme.color.surfaceTertiary, borderRadius: 999, padding: 3 },
  segBtn: { flex: 1, paddingVertical: 7, borderRadius: 999, alignItems: "center" },
  segBtnOn: { backgroundColor: theme.color.surfaceSecondary },
  segTxt: { fontSize: 12, fontWeight: "700", color: theme.color.muted },
  segTxtOn: { color: theme.color.onSurface },
  empty: { alignItems: "center", padding: 24, gap: 8, backgroundColor: theme.color.surfaceSecondary, borderRadius: 14, borderWidth: 1, borderColor: theme.color.border, marginBottom: 14 },
  emptyTxt: { color: theme.color.muted, fontSize: 13, textAlign: "center" },
  emptyBtn: { marginTop: 4, backgroundColor: CGYM_ORANGE, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999 },
  emptyBtnTxt: { color: "#FFF", fontWeight: "800", fontSize: 13 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: theme.color.surfaceSecondary, borderRadius: 12, borderWidth: 1, borderColor: theme.color.border, padding: 10, marginBottom: 8 },
  rowIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  rowTitle: { fontSize: 14, fontWeight: "700", color: theme.color.onSurface },
  rowSub: { fontSize: 12, color: theme.color.muted, marginTop: 2 },
  rowBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: theme.color.surfaceTertiary },
  card: { backgroundColor: theme.color.surfaceSecondary, borderRadius: 14, borderWidth: 1, borderColor: theme.color.border, padding: 12, marginTop: 8 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { flex: 1, fontSize: 15, fontWeight: "800", color: theme.color.onSurface },
  teamRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: theme.color.divider, marginTop: 8 },
  pill: { backgroundColor: CGYM_ORANGE, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  pillTxt: { color: "#FFF", fontSize: 11, fontWeight: "800" },
  sheetBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { backgroundColor: theme.color.surfaceSecondary, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16 },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  sheetTitle: { fontSize: 17, fontWeight: "800", color: theme.color.onSurface },
  lbl: { fontSize: 12, fontWeight: "800", color: theme.color.muted, marginTop: 12, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surface, maxWidth: "100%" },
  chipOn: { backgroundColor: theme.color.brandPrimary, borderColor: theme.color.brandPrimary },
  chipTxt: { fontSize: 13, fontWeight: "700", color: theme.color.onSurface },
  input: { borderWidth: 1, borderColor: theme.color.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: theme.color.onSurface, backgroundColor: theme.color.surface },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 14, minHeight: 44 },
  toggleTxt: { flex: 1, fontSize: 13, color: theme.color.onSurface, fontWeight: "600" },
  saveBtn: { marginTop: 14, backgroundColor: CGYM_ORANGE, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  saveTxt: { color: "#FFF", fontWeight: "800", fontSize: 15 },
});

// Corporate Gym — Blocco 3: assegnazioni del Master (agente o tutto il team, tipo, frequenza 1/2/3 al giorno, scadenza).
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, TextInput, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { notify, confirmAsync } from "@/src/utils/notify";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { CgymTileIcon } from "@/src/corporate-gym/CgymTileIcon";
import { cgymAssignApi, CgymAssignment, CgymType, CGYM_TYPE_META, CGYM_ORANGE, toYMD } from "@/src/corporate-gym/api";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

type Member = { user_id: string; name?: string; email?: string; role?: string };

const DUE_OPTS = [
  { label: "Oggi", days: 0 },
  { label: "+3 gg", days: 3 },
  { label: "+7 gg", days: 7 },
  { label: "+14 gg", days: 14 },
  { label: "+30 gg", days: 30 },
];

export default function CgymAssignScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const pagePad = usePageBottomPadding();
  const isAdmin = !!user && (user.role === "admin" || (user.role === "owner" && !user.parent_user_id));

  const [members, setMembers] = useState<Member[]>([]);
  const [plans, setPlans] = useState<CgymAssignment[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [team, setTeam] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [type, setType] = useState<CgymType>("obiezioni");
  const [perDay, setPerDay] = useState(1);
  const [dueDays, setDueDays] = useState(7);
  const [dueCustom, setDueCustom] = useState(""); // GG/MM/AAAA opzionale
  const [title, setTitle] = useState("");
  const [openPlan, setOpenPlan] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [m, p] = await Promise.all([api<{ items: Member[] }>("/team/members"), cgymAssignApi.list()]);
      setMembers(m.items || []);
      setPlans(p.items || []);
    } catch (e: any) {
      notify("Assegnazioni", e?.message || "Errore di caricamento");
      setPlans([]);
    } finally {
      setRefreshing(false);
    }
  }, []);
  useFocusEffect(useCallback(() => { if (isAdmin) load(); }, [load, isAdmin]));

  useEffect(() => { if (!isAdmin && user) router.replace("/corporate-gym" as any); }, [isAdmin, user, router]);

  const dueDate = useMemo(() => {
    const m = dueCustom.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
      if (!isNaN(d.getTime())) return d;
    }
    const d = new Date(); d.setDate(d.getDate() + dueDays); return d;
  }, [dueCustom, dueDays]);
  const days = Math.max(1, Math.floor((new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate()).getTime() - new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).getTime()) / 86400000) + 1);
  const nTargets = team ? Math.max(1, members.length) : selected.length;
  const total = nTargets * days * perDay;

  const toggleUser = (id: string) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const create = async () => {
    if (saving) return;
    if (!team && selected.length === 0) { notify("Assegnazioni", "Seleziona almeno un collaboratore"); return; }
    if (total > 300) { notify("Assegnazioni", `Troppe sessioni (${total}): riduci scadenza, frequenza o destinatari`); return; }
    setSaving(true);
    try {
      const r = await cgymAssignApi.create({ target: team ? "team" : "users", user_ids: team ? [] : selected, type, per_day: perDay, due_date: toYMD(dueDate), title: title.trim() || undefined });
      notify("Assegnazioni", `Create ${r.sessions_total} sessioni`);
      setTitle(""); setSelected([]);
      load();
    } catch (e: any) {
      notify("Errore", e?.message || "");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p: CgymAssignment) => {
    const ok = await confirmAsync("Elimina piano", `Rimuovere il piano "${p.title}"? Le sessioni non completate verranno cancellate, quelle completate restano.`);
    if (!ok) return;
    try {
      await cgymAssignApi.remove(p.assignment_id);
      setPlans((prev) => (prev || []).filter((x) => x.assignment_id !== p.assignment_id));
    } catch (e: any) {
      notify("Errore", e?.message || "");
    }
  };

  const fmtDue = (ymd: string) => { const [y, m, d] = ymd.split("-"); return `${d}/${m}/${y}`; };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable testID="cgym-assign-back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/corporate-gym" as any))} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={HT.text} />
        </Pressable>
        <Text style={styles.title}>Assegna sessioni</Text>
        <View style={{ width: 26 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: pagePad }} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
        <View style={styles.card} testID="cgym-assign-form">
          <Text style={styles.lbl}>A chi</Text>
          <View style={styles.chips}>
            <Pressable onPress={() => setTeam(true)} style={[styles.chip, team && styles.chipOn]} testID="cgym-assign-team">
              <Ionicons name="people" size={14} color={team ? "#FFF" : HT.text} />
              <Text style={[styles.chipTxt, team && { color: "#FFF" }]}>Tutto il team ({members.length})</Text>
            </Pressable>
            {members.map((m) => {
              const on = !team && selected.includes(m.user_id);
              return (
                <Pressable key={m.user_id} onPress={() => { setTeam(false); toggleUser(m.user_id); }} style={[styles.chip, on && styles.chipOn]} testID={`cgym-assign-user-${m.user_id}`}>
                  <Text style={[styles.chipTxt, on && { color: "#FFF" }]} numberOfLines={1}>{m.name || m.email}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.lbl}>Tipo di sessione</Text>
          <View style={styles.chips}>
            {(Object.keys(CGYM_TYPE_META) as CgymType[]).map((t) => (
              <Pressable key={t} onPress={() => setType(t)} style={[styles.typeChip, type === t && { borderColor: CGYM_TYPE_META[t].color, backgroundColor: CGYM_TYPE_META[t].color + "14" }]} testID={`cgym-assign-type-${t}`}>
                <CgymTileIcon type={t} size={34} />
                <Text style={styles.chipTxt}>{CGYM_TYPE_META[t].label}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.lbl}>Frequenza</Text>
          <View style={styles.chips}>
            {[1, 2, 3].map((n) => (
              <Pressable key={n} onPress={() => setPerDay(n)} style={[styles.chip, perDay === n && styles.chipOn]} testID={`cgym-assign-perday-${n}`}>
                <Text style={[styles.chipTxt, perDay === n && { color: "#FFF" }]}>{n} al giorno</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.hint}>Orari: {perDay === 1 ? "09:00" : perDay === 2 ? "09:00 · 15:00" : "09:00 · 13:00 · 17:00"}</Text>

          <Text style={styles.lbl}>Scadenza</Text>
          <View style={styles.chips}>
            {DUE_OPTS.map((o) => (
              <Pressable key={o.days} onPress={() => { setDueDays(o.days); setDueCustom(""); }} style={[styles.chip, !dueCustom && dueDays === o.days && styles.chipOn]} testID={`cgym-assign-due-${o.days}`}>
                <Text style={[styles.chipTxt, !dueCustom && dueDays === o.days && { color: "#FFF" }]}>{o.label}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput value={dueCustom} onChangeText={setDueCustom} placeholder="oppure data GG/MM/AAAA" placeholderTextColor={HT.muted} style={styles.input} keyboardType="numbers-and-punctuation" testID="cgym-assign-due-custom" />

          <Text style={styles.lbl}>Titolo (opzionale)</Text>
          <TextInput value={title} onChangeText={setTitle} placeholder={CGYM_TYPE_META[type].label} placeholderTextColor={HT.muted} style={styles.input} testID="cgym-assign-title" />

          <View style={styles.preview} testID="cgym-assign-preview">
            <Ionicons name="calculator-outline" size={16} color={HT.brand} />
            <Text style={styles.previewTxt}>
              {nTargets} {nTargets === 1 ? "collaboratore" : "collaboratori"} × {days} {days === 1 ? "giorno" : "giorni"} × {perDay}/gg = <Text style={{ fontWeight: "900" }}>{total} sessioni</Text> · scadenza {toYMD(dueDate).split("-").reverse().join("/")}
            </Text>
          </View>
          <Pressable onPress={create} disabled={saving} style={[styles.saveBtn, saving && { opacity: 0.6 }]} testID="cgym-assign-save">
            {saving ? <ActivityIndicator color="#FFF" /> : (<><Ionicons name="send" size={16} color="#FFF" /><Text style={styles.saveTxt}>Assegna</Text></>)}
          </Pressable>
        </View>

        <Text style={styles.sectionTitle}>Piani attivi</Text>
        {plans == null ? (
          <ActivityIndicator color={CGYM_ORANGE} style={{ marginVertical: 16 }} />
        ) : plans.length === 0 ? (
          <Text style={styles.emptyTxt} testID="cgym-assign-empty">Nessun piano assegnato</Text>
        ) : (
          plans.map((p) => {
            const pct = p.sessions_total > 0 ? p.sessions_done / p.sessions_total : 0;
            const open = openPlan === p.assignment_id;
            return (
              <View key={p.assignment_id} style={styles.plan} testID={`cgym-plan-${p.assignment_id}`}>
                <Pressable style={styles.planHead} onPress={() => setOpenPlan(open ? null : p.assignment_id)}>
                  <CgymTileIcon type={p.type} size={36} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.planTitle} numberOfLines={1}>{p.title}</Text>
                    <Text style={[styles.planSub, p.overdue && { color: HT.danger }]}>
                      {p.target === "team" ? "Tutto il team" : `${p.user_ids.length} collaborator${p.user_ids.length === 1 ? "e" : "i"}`} · {p.per_day}/gg · scad. {fmtDue(p.due_date)}{p.overdue ? " · in ritardo" : ""}
                    </Text>
                  </View>
                  <Text style={[styles.planPct, pct >= 1 && { color: HT.success }]}>{p.sessions_done}/{p.sessions_total}</Text>
                  <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color={HT.muted} />
                </Pressable>
                <View style={styles.barBg}><View style={[styles.barFill, { width: `${Math.round(pct * 100)}%`, backgroundColor: pct >= 1 ? HT.success : CGYM_ORANGE }]} /></View>
                {open && (
                  <View style={{ marginTop: 8, gap: 6 }}>
                    {(p.per_user || []).map((u) => (
                      <View key={u.user_id} style={styles.userRow}>
                        <Ionicons name={u.done >= u.total && u.total > 0 ? "checkmark-circle" : "ellipse-outline"} size={16} color={u.done >= u.total && u.total > 0 ? HT.success : HT.muted} />
                        <Text style={styles.userName} numberOfLines={1}>{u.name}</Text>
                        <Text style={styles.userPct}>{u.done}/{u.total}</Text>
                      </View>
                    ))}
                    <Pressable onPress={() => remove(p)} style={styles.delBtn} testID={`cgym-plan-del-${p.assignment_id}`}>
                      <Ionicons name="trash-outline" size={15} color={HT.danger} />
                      <Text style={styles.delTxt}>Elimina piano</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: HT.card2 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: HT.border, backgroundColor: HT.card2 },
  title: { fontSize: 18, fontWeight: "800", color: HT.text },
  card: { backgroundColor: HT.card2, borderRadius: 16, borderWidth: 1, borderColor: HT.border, padding: 14, marginBottom: 18 },
  lbl: { fontSize: 12, fontWeight: "800", color: HT.muted, marginTop: 10, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.4 },
  hint: { fontSize: 11, color: HT.muted, marginTop: 6 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: HT.border, backgroundColor: HT.card2, minHeight: 40, maxWidth: "100%" },
  chipOn: { backgroundColor: HT.brand, borderColor: HT.brand },
  chipTxt: { fontSize: 13, fontWeight: "700", color: HT.text },
  typeChip: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14, borderWidth: 2, borderColor: HT.border, backgroundColor: HT.card2 },
  input: { borderWidth: 1, borderColor: HT.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: HT.text, backgroundColor: HT.card2, marginTop: 8, minHeight: 44 },
  preview: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: HT.brandTint, borderRadius: 10, padding: 10, marginTop: 14 },
  previewTxt: { flex: 1, fontSize: 12, color: HT.brand, fontWeight: "700", lineHeight: 17 },
  saveBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 12, backgroundColor: CGYM_ORANGE, borderRadius: 12, paddingVertical: 14, minHeight: 48 },
  saveTxt: { color: "#FFF", fontWeight: "800", fontSize: 15 },
  sectionTitle: { fontSize: 16, fontWeight: "800", color: HT.text, marginBottom: 10 },
  emptyTxt: { color: HT.muted, fontSize: 13, textAlign: "center", paddingVertical: 12 },
  plan: { backgroundColor: HT.card2, borderRadius: 14, borderWidth: 1, borderColor: HT.border, padding: 12, marginBottom: 10 },
  planHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  planTitle: { fontSize: 14, fontWeight: "800", color: HT.text },
  planSub: { fontSize: 12, color: HT.muted, marginTop: 2 },
  planPct: { fontSize: 14, fontWeight: "900", color: CGYM_ORANGE },
  barBg: { height: 5, borderRadius: 3, backgroundColor: HT.card2, marginTop: 10, overflow: "hidden" },
  barFill: { height: 5, borderRadius: 3 },
  userRow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 28 },
  userName: { flex: 1, fontSize: 13, color: HT.text, fontWeight: "600" },
  userPct: { fontSize: 12, color: HT.muted, fontWeight: "800" },
  delBtn: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingVertical: 8, paddingHorizontal: 4, minHeight: 40 },
  delTxt: { color: HT.danger, fontWeight: "800", fontSize: 12 },
});

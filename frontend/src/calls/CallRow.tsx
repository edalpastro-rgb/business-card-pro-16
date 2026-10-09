// CallRow.tsx — V50.z506 — Riga di una call (appuntamento di tipo telefonata): spunta fatta/da fare, orario, chiama, apri, sposta data.
// Il reschedule converte la call in RITELEFONATA alla nuova data (POST /calls/{id}/reschedule): l'appuntamento resta in Agenda
// marcato «spostata in ritelefonata» e sparisce dal modulo Call.
import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, Platform, Linking, Modal } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import DateTimePicker from "@react-native-community/datetimepicker";
import { HT } from "@/src/homeTheme";
import { notify } from "@/src/utils/notify";
import { CallItem, fmtCallDay, fmtCallTime, rescheduleCall, toggleCallDone } from "@/src/calls/callsApi";

export function CallRow({ c, onChanged, compact }: { c: CallItem; onChanged: () => void; compact?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const color = c.area === "network" ? HT.axon : HT.brand;
  const tel = (c.phone_mobile || "").replace(/[^\d+]/g, "");

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    try { await toggleCallDone(c); onChanged(); }
    catch (e: any) { notify("Errore", e?.message || "Impossibile aggiornare la call"); }
    finally { setBusy(false); }
  };

  return (
    <View style={[s.row, c.done && s.rowDone, c.overdue && !c.done && s.rowOverdue]} testID={`call-row-${c.appointment_id}`}>
      <Pressable onPress={toggle} style={s.check} hitSlop={8} testID={`call-toggle-${c.appointment_id}`} accessibilityLabel={c.done ? "Segna da fare" : "Segna fatta"}>
        <Ionicons name={c.done ? "checkmark-circle" : "ellipse-outline"} size={26} color={c.done ? HT.success : color} />
      </Pressable>
      <Pressable style={{ flex: 1, minWidth: 0 }} onPress={() => router.push(`/appointment/${c.appointment_id}` as any)} testID={`call-open-${c.appointment_id}`}>
        <Text style={[s.title, c.done && s.titleDone]} numberOfLines={1}>{c.title}</Text>
        <View style={s.meta}>
          <Ionicons name="time-outline" size={12} color={HT.muted} />
          <Text style={s.metaTxt}>{c.overdue ? `${fmtCallDay(c.start_at)} · ` : ""}{fmtCallTime(c.start_at)}</Text>
          {c.overdue && !c.done ? <View style={s.pillOver}><Text style={s.pillOverTxt}>da fare · arretrata</Text></View> : null}
          {!c.done && !c.overdue ? <View style={[s.pill, { backgroundColor: color + "22" }]}><Text style={[s.pillTxt, { color }]}>da fare</Text></View> : null}
          {c.done ? <View style={[s.pill, { backgroundColor: HT.successTint }]}><Text style={[s.pillTxt, { color: HT.success }]}>fatta</Text></View> : null}
        </View>
      </Pressable>
      {tel ? (
        <Pressable onPress={() => Linking.openURL(`tel:${tel}`).catch(() => {})} style={[s.iconBtn, { backgroundColor: color }]} hitSlop={4} testID={`call-dial-${c.appointment_id}`} accessibilityLabel="Chiama">
          <Ionicons name="call" size={16} color="#FFFFFF" />
        </Pressable>
      ) : null}
      {!c.done ? (
        <Pressable onPress={() => setMoveOpen(true)} style={s.iconBtn} hitSlop={4} testID={`call-move-${c.appointment_id}`} accessibilityLabel="Sposta a un altro giorno (diventa ritelefonata)">
          <Ionicons name="calendar-outline" size={16} color={HT.text} />
        </Pressable>
      ) : null}
      {moveOpen ? <MoveCallSheet c={c} onClose={() => setMoveOpen(false)} onDone={() => { setMoveOpen(false); onChanged(); }} /> : null}
      {compact ? null : null}
    </View>
  );
}

function MoveCallSheet({ c, onClose, onDone }: { c: CallItem; onClose: () => void; onDone: () => void }) {
  const init = new Date(c.start_at); init.setDate(init.getDate() + 1);
  const [when, setWhen] = useState<Date>(init);
  const [picker, setPicker] = useState<"date" | "time" | null>(null);
  const [saving, setSaving] = useState(false);
  const quick = (days: number) => { const d = new Date(c.start_at); d.setDate(d.getDate() + days); if (d.getTime() < Date.now()) { const n = new Date(); n.setDate(n.getDate() + days); n.setHours(d.getHours(), d.getMinutes(), 0, 0); setWhen(n); } else setWhen(d); };
  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await rescheduleCall(c, when);
      notify("Call spostata", `Ora è una ritelefonata per ${when.toLocaleDateString("it-IT")} alle ${when.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}: la trovi nel modulo Ritelefonate.`);
      onDone();
    } catch (e: any) { notify("Errore", e?.message || "Impossibile spostare la call"); }
    finally { setSaving(false); }
  };
  const pad = (n: number) => String(n).padStart(2, "0");
  const localVal = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}`;
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.sheet} onPress={() => {}} testID="call-move-sheet">
          <Text style={s.sheetTitle}>Sposta la call</Text>
          <Text style={s.sheetSub}>La call non effettuata diventa una <Text style={{ fontWeight: "800", color: HT.text }}>ritelefonata</Text> alla nuova data e compare nel modulo Ritelefonate. L&apos;appuntamento originale resta in Agenda segnato come «spostata in ritelefonata».</Text>
          <View style={s.quickRow}>
            {[{ l: "Domani", d: 1 }, { l: "+2 giorni", d: 2 }, { l: "+1 settimana", d: 7 }].map((q) => (
              <Pressable key={q.d} onPress={() => quick(q.d)} style={s.quickChip} testID={`call-move-quick-${q.d}`}><Text style={s.quickTxt}>{q.l}</Text></Pressable>
            ))}
          </View>
          {Platform.OS === "web" ? (
            React.createElement("input", {
              type: "datetime-local", value: localVal, "data-testid": "call-move-input",
              onChange: (e: any) => { const d = new Date(e.target.value); if (!isNaN(d.getTime())) setWhen(d); },
              style: { width: "100%", backgroundColor: HT.card2, border: `1px solid ${HT.border}`, borderRadius: 12, padding: "12px 14px", fontSize: 15, color: HT.text, fontFamily: "inherit", outline: "none", boxSizing: "border-box" },
            })
          ) : (
            <View style={s.quickRow}>
              <Pressable onPress={() => setPicker("date")} style={s.dateBtn}><Ionicons name="calendar-outline" size={16} color={HT.brand} /><Text style={s.dateTxt}>{when.toLocaleDateString("it-IT")}</Text></Pressable>
              <Pressable onPress={() => setPicker("time")} style={s.dateBtn}><Ionicons name="time-outline" size={16} color={HT.brand} /><Text style={s.dateTxt}>{when.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}</Text></Pressable>
              {picker ? <DateTimePicker value={when} mode={picker} onChange={(_e, d) => { setPicker(null); if (!d) return; const n = new Date(when); if (picker === "date") n.setFullYear(d.getFullYear(), d.getMonth(), d.getDate()); else n.setHours(d.getHours(), d.getMinutes()); setWhen(n); }} /> : null}
            </View>
          )}
          <View style={s.actions}>
            <Pressable onPress={onClose} style={[s.btn, s.btnGhost]} testID="call-move-cancel"><Text style={s.btnGhostTxt}>Annulla</Text></Pressable>
            <Pressable onPress={save} style={[s.btn, saving && { opacity: 0.6 }]} disabled={saving} testID="call-move-save"><Ionicons name="repeat" size={16} color="#FFFFFF" /><Text style={s.btnTxt}>Sposta in ritelefonata</Text></Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  row: { ...HT.cardShadow, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border, borderRadius: 14, padding: 10, marginBottom: 8 },
  rowDone: { opacity: 0.7 },
  rowOverdue: { borderColor: HT.warning },
  check: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { color: HT.text, fontWeight: "800", fontSize: 14 },
  titleDone: { textDecorationLine: "line-through", color: HT.muted },
  meta: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3, flexWrap: "wrap" },
  metaTxt: { color: HT.muted, fontSize: 12, fontWeight: "600" },
  pill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999 },
  pillTxt: { fontSize: 10.5, fontWeight: "800" },
  pillOver: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: HT.warningTint },
  pillOverTxt: { fontSize: 10.5, fontWeight: "800", color: HT.warning },
  iconBtn: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: HT.card2, borderWidth: 1, borderColor: HT.border },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end", padding: 16 },
  sheet: { backgroundColor: HT.card, borderRadius: 20, padding: 18, gap: 12, borderWidth: 1, borderColor: HT.border, maxWidth: 520, width: "100%", alignSelf: "center" },
  sheetTitle: { color: HT.text, fontWeight: "900", fontSize: 18 },
  sheetSub: { color: HT.muted, fontSize: 13, lineHeight: 18 },
  quickRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  quickChip: { paddingHorizontal: 12, paddingVertical: 8, minHeight: 36, borderRadius: 999, backgroundColor: HT.card2, borderWidth: 1, borderColor: HT.border },
  quickTxt: { color: HT.text, fontWeight: "700", fontSize: 13 },
  dateBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 10, minHeight: 44, borderRadius: 12, backgroundColor: HT.card2, borderWidth: 1, borderColor: HT.border },
  dateTxt: { color: HT.text, fontWeight: "700" },
  actions: { flexDirection: "row", gap: 10, justifyContent: "flex-end", marginTop: 4 },
  btn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: HT.brand, paddingHorizontal: 16, paddingVertical: 12, minHeight: 44, borderRadius: 12 },
  btnTxt: { color: "#FFFFFF", fontWeight: "800" },
  btnGhost: { backgroundColor: HT.card2, borderWidth: 1, borderColor: HT.border },
  btnGhostTxt: { color: HT.text, fontWeight: "800" },
});

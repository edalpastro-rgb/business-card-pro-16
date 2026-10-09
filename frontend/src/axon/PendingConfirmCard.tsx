// PendingConfirmCard.tsx — V50.z507 — BUG 4: la conferma «doppione» di Axon resta visibile e attiva finché l'utente non sceglie.
// Stato sul server (GET /axon/agent/pending, 48 h): sopravvive al cambio pagina e al riavvio dell'app. Tre bottoni: Conferma ·
// Modifica (nuova data/ora) · Cancella — oppure a voce «sì» / «annulla» / «modifica: giovedì alle 10». Usata in Axon Drive, chat Axon e Home.
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Platform, DeviceEventEmitter } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useFocusEffect } from "expo-router";
import { api } from "@/src/api";
import { HT } from "@/src/homeTheme";
import { notify } from "@/src/utils/notify";

export type AxonPending = { run_id: string; action: string; label?: string; contact?: string; question: string; start_at?: string; is_phone?: boolean };
export const AXON_PENDING_EVENT = "axon-pending-changed";
export const refreshAxonPending = () => DeviceEventEmitter.emit(AXON_PENDING_EVENT);

export function useAxonPending() {
  const [pending, setPending] = useState<AxonPending | null>(null);
  const load = useCallback(() => { api<{ pending: AxonPending | null }>("/axon/agent/pending").then((r) => setPending(r?.pending || null)).catch(() => {}); }, []);
  useEffect(() => { load(); const sub = DeviceEventEmitter.addListener(AXON_PENDING_EVENT, load); return () => sub.remove(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  return { pending, reload: load, setPending };
}

export function PendingConfirmCard({ onResolved, dark }: { onResolved?: (reply: string) => void; dark?: boolean }) {
  const { pending, setPending } = useAxonPending();
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [when, setWhen] = useState<Date>(new Date());
  const [picker, setPicker] = useState<"date" | "time" | null>(null);

  useEffect(() => { if (pending?.start_at) { const d = new Date(pending.start_at); if (!isNaN(d.getTime())) setWhen(d); } setEditing(false); }, [pending?.run_id, pending?.start_at]);
  if (!pending) return null;

  const resolve = async (action: "confirm" | "cancel" | "modify") => {
    if (busy) return;
    setBusy(action);
    try {
      const pad = (n: number) => String(n).padStart(2, "0");
      const body: any = { action };
      if (action === "modify") body.new_start_at = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}`;
      const r = await api<{ reply: string; status: string; pending: AxonPending | null }>(`/axon/agent/pending/${pending.run_id}`, { method: "POST", body });
      setPending(r.pending || null);
      setEditing(false);
      refreshAxonPending();
      onResolved?.(r.reply);
      if (!r.pending) notify(action === "cancel" ? "Annullato" : "Fatto", (r.reply || "").split("\n").slice(1).join(" ").replace(/\*\*/g, "").slice(0, 180) || (action === "cancel" ? "Nessun appuntamento creato." : "Appuntamento salvato."));
    } catch (e: any) { notify("Errore", e?.message || "Operazione non riuscita"); }
    finally { setBusy(null); }
  };

  const c = dark ? DARK : LIGHT;
  const pad = (n: number) => String(n).padStart(2, "0");
  const localVal = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}`;

  return (
    <View style={[s.card, { backgroundColor: c.bg, borderColor: c.border }]} testID="axon-pending-card">
      <View style={s.head}>
        <View style={s.orb}><Ionicons name="alert" size={18} color="#FFFFFF" /></View>
        <View style={{ flex: 1 }}>
          <Text style={[s.title, { color: c.text }]}>Axon chiede conferma</Text>
          <Text style={[s.sub, { color: c.muted }]}>{pending.label || pending.action}</Text>
        </View>
      </View>
      <Text style={[s.question, { color: c.text }]} testID="axon-pending-question">{pending.question}</Text>
      {editing ? (
        <View style={s.editBox}>
          <Text style={[s.sub, { color: c.muted, marginBottom: 6 }]}>Nuova data e ora</Text>
          {Platform.OS === "web" ? (
            React.createElement("input", {
              type: "datetime-local", value: localVal, "data-testid": "axon-pending-datetime",
              onChange: (e: any) => { const d = new Date(e.target.value); if (!isNaN(d.getTime())) setWhen(d); },
              style: { width: "100%", backgroundColor: c.input, border: `1px solid ${c.border}`, borderRadius: 12, padding: "12px 14px", fontSize: 15, color: c.text, fontFamily: "inherit", outline: "none", boxSizing: "border-box" },
            })
          ) : (
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable onPress={() => setPicker("date")} style={[s.dateBtn, { backgroundColor: c.input, borderColor: c.border }]}><Ionicons name="calendar-outline" size={16} color={HT.brand} /><Text style={[s.dateTxt, { color: c.text }]}>{when.toLocaleDateString("it-IT")}</Text></Pressable>
              <Pressable onPress={() => setPicker("time")} style={[s.dateBtn, { backgroundColor: c.input, borderColor: c.border }]}><Ionicons name="time-outline" size={16} color={HT.brand} /><Text style={[s.dateTxt, { color: c.text }]}>{when.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}</Text></Pressable>
              {picker ? <DateTimePicker value={when} mode={picker} onChange={(_e, d) => { setPicker(null); if (!d) return; const n = new Date(when); if (picker === "date") n.setFullYear(d.getFullYear(), d.getMonth(), d.getDate()); else n.setHours(d.getHours(), d.getMinutes()); setWhen(n); }} /> : null}
            </View>
          )}
          <View style={s.btnRow}>
            <Pressable onPress={() => setEditing(false)} style={[s.btn, s.btnGhost, { borderColor: c.border }]} testID="axon-pending-edit-back"><Text style={[s.btnGhostTxt, { color: c.text }]}>Indietro</Text></Pressable>
            <Pressable onPress={() => resolve("modify")} style={[s.btn, { backgroundColor: HT.brand }]} disabled={!!busy} testID="axon-pending-modify-save">
              {busy === "modify" ? <ActivityIndicator color="#FFF" size="small" /> : <Ionicons name="save-outline" size={16} color="#FFF" />}<Text style={s.btnTxt}>Salva con la nuova data</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={s.btnRow}>
          <Pressable onPress={() => resolve("confirm")} style={[s.btn, { backgroundColor: HT.success }]} disabled={!!busy} testID="axon-pending-confirm">
            {busy === "confirm" ? <ActivityIndicator color="#FFF" size="small" /> : <Ionicons name="checkmark" size={18} color="#FFF" />}<Text style={s.btnTxt}>Conferma</Text>
          </Pressable>
          <Pressable onPress={() => setEditing(true)} style={[s.btn, { backgroundColor: HT.brand }]} disabled={!!busy} testID="axon-pending-modify">
            <Ionicons name="create-outline" size={18} color="#FFF" /><Text style={s.btnTxt}>Modifica</Text>
          </Pressable>
          <Pressable onPress={() => resolve("cancel")} style={[s.btn, { backgroundColor: HT.danger }]} disabled={!!busy} testID="axon-pending-cancel">
            {busy === "cancel" ? <ActivityIndicator color="#FFF" size="small" /> : <Ionicons name="close" size={18} color="#FFF" />}<Text style={s.btnTxt}>Cancella</Text>
          </Pressable>
        </View>
      )}
      <Text style={[s.hint, { color: c.muted }]}>A voce: «sì» · «annulla» · «modifica: giovedì alle 10». Resta qui finché non scegli.</Text>
    </View>
  );
}

const LIGHT = { bg: HT.warningTint, border: HT.warning, text: HT.text, muted: HT.muted, input: HT.card };
const DARK = { bg: "rgba(251,191,36,0.14)", border: "rgba(251,191,36,0.6)", text: "#FFFFFF", muted: "rgba(255,255,255,0.7)", input: "rgba(255,255,255,0.08)" };

const s = StyleSheet.create({
  card: { borderWidth: 1.5, borderRadius: 16, padding: 14, gap: 10, marginHorizontal: 16, marginTop: 10 },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  orb: { width: 34, height: 34, borderRadius: 17, backgroundColor: HT.warning, alignItems: "center", justifyContent: "center" },
  title: { fontWeight: "900", fontSize: 15 },
  sub: { fontSize: 12, fontWeight: "600" },
  question: { fontSize: 14.5, lineHeight: 21, fontWeight: "600" },
  editBox: { gap: 8 },
  btnRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  btn: { flex: 1, minWidth: 110, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, paddingHorizontal: 10, minHeight: 48, borderRadius: 12 },
  btnTxt: { color: "#FFFFFF", fontWeight: "800", fontSize: 14 },
  btnGhost: { backgroundColor: "transparent", borderWidth: 1 },
  btnGhostTxt: { fontWeight: "800" },
  dateBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 10, minHeight: 44, borderRadius: 12, borderWidth: 1 },
  dateTxt: { fontWeight: "700" },
  hint: { fontSize: 11.5, lineHeight: 16 },
});

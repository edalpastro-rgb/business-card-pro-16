import { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, Modal, Pressable, ScrollView, TextInput, Alert, Platform, Linking,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { api } from "@/src/api";
import { cancelByTag } from "@/src/notifs";

import { useBottomSheetPadding } from "@/src/utils/bottomSheetInsets";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium
export type CallOutcome = {
  id: string;
  name: string;
  color: string;
  icon: string;
};

export type CallTarget = {
  phone?: string | null;
  contact_id?: string | null;
  callback_id?: string | null;
  appointment_id?: string | null;
  display_name?: string;
};

type Props = {
  visible: boolean;
  target: CallTarget | null;
  onClose: () => void;
  onCompleted?: (result: { new_callback_id?: string | null; outcome_id: string }) => void;
};

const QUICK_DELTAS: { label: string; min: number }[] = [
  { label: "+15 min", min: 15 },
  { label: "+30 min", min: 30 },
  { label: "+1 ora", min: 60 },
  { label: "+3 ore", min: 180 },
  { label: "Domani 9:00", min: -1 },     // special: tomorrow 9am
];

function tomorrow9AM(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d;
}

export function CallActionSheet({ visible, target, onClose, onCompleted }: Props) {
  const [step, setStep] = useState<"call" | "outcome" | "reschedule" | "done">("call");
  const bottomPad = useBottomSheetPadding();
  const [outcomes, setOutcomes] = useState<CallOutcome[]>([]);
  const [chosen, setChosen] = useState<CallOutcome | null>(null);
  const [note, setNote] = useState("");
  const [rescheduleAt, setRescheduleAt] = useState<Date | null>(null);
  const [showPicker, setShowPicker] = useState<null | "date">(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setStep("call");
    setChosen(null);
    setNote("");
    setRescheduleAt(null);
    (async () => {
      try {
        const s = await api<any>("/settings");
        setOutcomes(s.call_outcomes || []);
      } catch {}
    })();
  }, [visible]);

  if (!visible || !target) return null;

  const dial = () => {
    if (!target.phone) {
      Alert.alert("Nessun numero", "Il contatto non ha un numero di telefono");
      return;
    }
    const num = target.phone.replace(/[^\d+]/g, "");
    Linking.openURL(`tel:${num}`).catch(() => {});
    // After dial, show outcome picker
    setStep("outcome");
  };

  const pickOutcome = (o: CallOutcome) => {
    setChosen(o);
    // If the outcome id contains "recall" or matches "richiamare" -> go to reschedule
    const shouldReschedule = /recall|later|non_?risp|no_answer|busy/i.test(o.id) || /richiamare|non risponde|occupato/i.test(o.name);
    if (shouldReschedule) {
      setStep("reschedule");
    } else {
      // Save directly
      save(o, null);
    }
  };

  const applyDelta = (min: number) => {
    if (min === -1) {
      setRescheduleAt(tomorrow9AM());
    } else {
      setRescheduleAt(new Date(Date.now() + min * 60 * 1000));
    }
  };

  const save = async (outcome: CallOutcome, when: Date | null) => {
    if (busy) return;
    setBusy(true);
    try {
      const payload: any = {
        contact_id: target.contact_id || null,
        callback_id: target.callback_id || null,
        appointment_id: target.appointment_id || null,
        phone: target.phone || null,
        outcome_id: outcome.id,
        note: note.trim(),
      };
      if (when) payload.reschedule_at = when.toISOString();
      const r = await api<{ log: any; new_callback: any }>("/calls/log", { method: "POST", body: payload });

      // If old callback marked done, cancel its notification
      if (target.callback_id) {
        await cancelByTag(`cb_${target.callback_id}`);
      }
      onCompleted?.({
        new_callback_id: r.new_callback?.callback_id || null,
        outcome_id: outcome.id,
      });
      onClose();
    } catch (e: any) {
      Alert.alert("Errore", e.message || "Impossibile salvare l'esito");
    } finally { setBusy(false); }
  };

  const confirmReschedule = () => {
    if (!chosen) return;
    if (!rescheduleAt) {
      Alert.alert("Manca l'orario", "Scegli un orario per la richiamata");
      return;
    }
    save(chosen, rescheduleAt);
  };

  const skipReschedule = () => {
    if (!chosen) return;
    save(chosen, null);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.wrap}>
        <View style={[styles.card, { paddingBottom: bottomPad }]}>
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>
                {step === "call" ? "Chiamata" : step === "outcome" ? "Esito chiamata" : "Rischeduling"}
              </Text>
              {!!target.display_name && <Text style={styles.sub}>{target.display_name}</Text>}
              {!!target.phone && <Text style={styles.phone}>{target.phone}</Text>}
            </View>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={22} color={HT.text} />
            </Pressable>
          </View>

          {step === "call" && (
            <View style={{ padding: 16, gap: 12 }}>
              <Pressable testID="call-dial-btn" onPress={dial} style={styles.callBtn} disabled={!target.phone}>
                <Ionicons name="call" size={22} color="#FFF" />
                <Text style={styles.callBtnTxt}>Chiama ora</Text>
              </Pressable>
              <Pressable testID="call-skip-btn" onPress={() => setStep("outcome")} style={styles.linkBtn}>
                <Text style={styles.linkBtnTxt}>Salta e registra solo l&apos;esito</Text>
              </Pressable>
            </View>
          )}

          {step === "outcome" && (
            <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
              <Text style={styles.hint}>Com&apos;è andata?</Text>
              {outcomes.map((o) => (
                <Pressable
                  key={o.id}
                  testID={`call-outcome-${o.id}`}
                  onPress={() => pickOutcome(o)}
                  style={[styles.outcomeBtn, { borderColor: o.color }]}
                >
                  <View style={[styles.outcomeIcon, { backgroundColor: o.color }]}>
                    <Ionicons name={o.icon as any} size={16} color="#FFF" />
                  </View>
                  <Text style={styles.outcomeTxt}>{o.name}</Text>
                  <Ionicons name="chevron-forward" size={16} color={HT.muted} />
                </Pressable>
              ))}
              <TextInput
                testID="call-note-input"
                value={note}
                onChangeText={setNote}
                placeholder="Nota (opzionale)"
                placeholderTextColor={HT.muted}
                multiline
                style={styles.noteInput}
              />
              <Pressable onPress={() => setStep("call")} style={styles.linkBtn}>
                <Text style={styles.linkBtnTxt}>← Indietro</Text>
              </Pressable>
            </ScrollView>
          )}

          {step === "reschedule" && (
            <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
              <Text style={styles.hint}>Quando ri-chiamare?</Text>
              <View style={styles.quickRow}>
                {QUICK_DELTAS.map((q) => {
                  const targetTime = q.min === -1 ? tomorrow9AM() : new Date(Date.now() + q.min * 60 * 1000);
                  const active = rescheduleAt && Math.abs(rescheduleAt.getTime() - targetTime.getTime()) < 60000;
                  return (
                    <Pressable
                      key={q.label}
                      testID={`quick-${q.label}`}
                      onPress={() => applyDelta(q.min)}
                      style={[styles.quickBtn, active && styles.quickBtnOn]}
                    >
                      <Text style={[styles.quickTxt, active && { color: "#FFF" }]}>{q.label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {Platform.OS === "web" ? (
                <View>
                  <Text style={styles.label}>Oppure data e ora personalizzati</Text>
                  {/* @ts-expect-error web-only */}
                  <input
                    type="datetime-local"
                    value={
                      rescheduleAt
                        ? new Date(rescheduleAt.getTime() - rescheduleAt.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
                        : ""
                    }
                    onChange={(e: any) => {
                      const v = e.target.value;
                      if (!v) { setRescheduleAt(null); return; }
                      setRescheduleAt(new Date(v));
                    }}
                    style={webInputStyle}
                  />
                </View>
              ) : (
                <>
                  <Pressable onPress={() => setShowPicker("date")} style={styles.dateBtn}>
                    <Ionicons name="calendar" size={16} color={HT.brand} />
                    <Text style={styles.dateBtnTxt}>
                      {rescheduleAt
                        ? rescheduleAt.toLocaleString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
                        : "Scegli data e ora"}
                    </Text>
                  </Pressable>
                  {showPicker && (
                    <DateTimePicker
                      value={rescheduleAt || new Date(Date.now() + 15 * 60 * 1000)}
                      mode="datetime"
                      display={Platform.OS === "ios" ? "spinner" : "default"}
                      onChange={(_e, d) => {
                        if (Platform.OS === "android") setShowPicker(null);
                        if (d) setRescheduleAt(d);
                      }}
                    />
                  )}
                </>
              )}

              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="Nota (opzionale)"
                placeholderTextColor={HT.muted}
                multiline
                style={styles.noteInput}
              />

              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable onPress={skipReschedule} style={[styles.secondaryBtn, { flex: 1 }]}>
                  <Text style={styles.secondaryBtnTxt}>Solo registra</Text>
                </Pressable>
                <Pressable testID="call-reschedule-confirm" onPress={confirmReschedule} style={[styles.primaryBtn, { flex: 1 }]}>
                  <Ionicons name="checkmark" size={18} color="#FFF" />
                  <Text style={styles.primaryBtnTxt}>Programma richiamata</Text>
                </Pressable>
              </View>
              <Pressable onPress={() => setStep("outcome")} style={styles.linkBtn}>
                <Text style={styles.linkBtnTxt}>← Cambia esito</Text>
              </Pressable>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  card: { backgroundColor: HT.card2, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "88%" },
  head: { flexDirection: "row", alignItems: "center", padding: 16, borderBottomWidth: 1, borderBottomColor: HT.border, gap: 8 },
  title: { fontSize: 17, fontWeight: "800", color: HT.text },
  sub: { fontSize: 13, color: HT.muted, marginTop: 2 },
  phone: { fontSize: 14, color: HT.brand, marginTop: 4, fontWeight: "600" },
  callBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: '#16A34A', paddingVertical: 16, borderRadius: 14 },
  callBtnTxt: { color: "#FFF", fontWeight: "800", fontSize: 17 },
  hint: { fontSize: 13, color: HT.muted, fontWeight: "600" },
  outcomeBtn: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 12, padding: 12, backgroundColor: HT.card },
  outcomeIcon: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  outcomeTxt: { flex: 1, color: HT.text, fontWeight: "700", fontSize: 14 },
  noteInput: { backgroundColor: HT.card, borderRadius: 12, borderWidth: 1, borderColor: HT.border, padding: 12, minHeight: 60, textAlignVertical: "top", color: HT.text },
  linkBtn: { alignItems: "center", paddingVertical: 8 },
  linkBtnTxt: { color: HT.brand, fontWeight: "600", fontSize: 13 },
  quickRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  quickBtn: { paddingHorizontal: 14, paddingVertical: 10, backgroundColor: HT.card2, borderRadius: 20 },
  quickBtnOn: { backgroundColor: HT.brand },
  quickTxt: { color: HT.text, fontWeight: "700", fontSize: 13 },
  label: { fontSize: 12, color: HT.text2, fontWeight: "700", marginBottom: 6 },
  dateBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: HT.card2, padding: 12, borderRadius: 12 },
  dateBtnTxt: { color: HT.text, fontWeight: "600" },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: HT.brand, paddingVertical: 12, borderRadius: 12 },
  primaryBtnTxt: { color: "#FFF", fontWeight: "800" },
  secondaryBtn: { alignItems: "center", justifyContent: "center", paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: HT.border, backgroundColor: HT.card },
  secondaryBtnTxt: { color: HT.text, fontWeight: "700" },
});

const webInputStyle: any = {
  width: "100%",
  backgroundColor: HT.card2,
  border: `1px solid ${HT.border}`,
  borderRadius: 12,
  padding: "12px 14px",
  fontSize: 15,
  color: HT.text,
  fontFamily: "inherit",
  outline: "none",
};

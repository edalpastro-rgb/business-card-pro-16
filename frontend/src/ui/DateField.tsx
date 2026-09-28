// DateField.tsx — V50.z388 — REGOLA GLOBALE: ogni campo data apre il CALENDARIO NATIVO del sistema al tocco (mai solo tastiera).
// Uso: <DateField value={iso} onChange={setIso} placeholder="Data" /> — `value`/`onChange` in ISO (AAAA-MM-GG) oppure
// `format="it"` per GG/MM/AAAA. Android → dialog nativo (DateTimePickerAndroid) · iOS → picker inline in un foglio ·
// Web → calendario in-app (DatePickerSheet, lo stesso di Axon Lab).
import React, { useState } from "react";
import { Pressable, Text, StyleSheet, Platform, Modal, View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { DatePickerSheet } from "@/src/axonlab/DatePickerSheet";
import { HT } from "@/src/homeTheme";

type Props = {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  format?: "iso" | "it";
  style?: StyleProp<ViewStyle>;
  testID?: string;
  disabled?: boolean;
};

const pad = (n: number) => String(n).padStart(2, "0");
const isoToIt = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v.split("-").reverse().join("/") : v);
const itToIso = (v: string) => (/^\d{2}\/\d{2}\/\d{4}$/.test(v) ? v.split("/").reverse().join("-") : v);
const toDate = (it: string): Date => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(it || ""); const d = m ? new Date(+m[3], +m[2] - 1, +m[1]) : new Date(); return isNaN(d.getTime()) ? new Date() : d; };
const fromDate = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;

export function DateField({ value, onChange, placeholder = "Data", format = "iso", style, testID, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [iosTmp, setIosTmp] = useState<Date>(new Date());
  const shown = format === "iso" ? isoToIt(value || "") : value || "";
  const emit = (it: string) => onChange(format === "iso" ? itToIso(it) : it);

  const openPicker = () => {
    if (disabled) return;
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({ value: toDate(shown), mode: "date", onChange: (ev, d) => { if (ev?.type === "dismissed" || !d) return; emit(fromDate(d)); } });
      return;
    }
    setIosTmp(toDate(shown)); setOpen(true);
  };

  return (
    <>
      <Pressable
        onPress={openPicker}
        style={[s.field, style, disabled && { opacity: 0.6 }]}
        accessibilityRole="button"
        accessibilityLabel={`${placeholder}: ${shown || "non impostata"} — tocca per aprire il calendario`}
        testID={testID}
      >
        <Ionicons name="calendar-outline" size={16} color={shown ? HT.text : HT.muted} />
        <Text style={[s.txt, !shown && { color: HT.muted }]} numberOfLines={1}>{shown || placeholder}</Text>
        {shown ? (
          <Pressable onPress={() => onChange("")} hitSlop={8} accessibilityLabel="Cancella data" testID={testID ? `${testID}-clear` : undefined}>
            <Ionicons name="close-circle" size={16} color={HT.muted} />
          </Pressable>
        ) : null}
      </Pressable>
      {Platform.OS === "ios" ? (
        <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
          <Pressable style={s.backdrop} onPress={() => setOpen(false)} />
          <View style={s.sheet} testID={testID ? `${testID}-ios-sheet` : undefined}>
            <View style={s.sheetHead}>
              <Pressable onPress={() => setOpen(false)} hitSlop={10}><Text style={s.cancel}>Annulla</Text></Pressable>
              <Text style={s.sheetTitle}>{placeholder}</Text>
              <Pressable onPress={() => { emit(fromDate(iosTmp)); setOpen(false); }} hitSlop={10}><Text style={s.ok}>Fatto</Text></Pressable>
            </View>
            <DateTimePicker value={iosTmp} mode="date" display="spinner" locale="it-IT" onChange={(_e, d) => { if (d) setIosTmp(d); }} style={{ alignSelf: "center" }} />
          </View>
        </Modal>
      ) : Platform.OS === "web" ? (
        <DatePickerSheet visible={open} value={shown} onClose={() => setOpen(false)} onPick={(v) => { emit(v); setOpen(false); }} />
      ) : null}
    </>
  );
}

const s = StyleSheet.create({
  field: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 46, borderWidth: 1, borderColor: HT.border, borderRadius: 12, paddingHorizontal: 12, backgroundColor: HT.card },
  txt: { flex: 1, color: HT.text, fontSize: 15 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { backgroundColor: HT.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 28 },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: HT.border },
  sheetTitle: { fontSize: 15, fontWeight: "800", color: HT.text },
  cancel: { fontSize: 15, color: HT.muted, fontWeight: "700" },
  ok: { fontSize: 15, color: HT.violet, fontWeight: "800" },
});

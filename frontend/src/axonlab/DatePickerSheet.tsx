/**
 * V50.z354 — Compilazione CRT · Step 6 · Calendario libero (date passate, odierna e future) senza dipendenze esterne.
 * Restituisce la data nel formato GG/MM/AAAA atteso da /lab/practices/{id}/sign.
 */
import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, Modal, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HT } from "@/src/homeTheme";

const MONTHS = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];
const DOW = ["L", "M", "M", "G", "V", "S", "D"];
const pad = (n: number) => String(n).padStart(2, "0");
export const fmtIt = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
const parseIt = (s: string): Date | null => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((s || "").trim()); if (!m) return null; const d = new Date(+m[3], +m[2] - 1, +m[1]); return isNaN(d.getTime()) ? null : d; };

export function DatePickerSheet({ visible, value, onClose, onPick }: { visible: boolean; value: string; onClose: () => void; onPick: (v: string) => void }) {
  const insets = useSafeAreaInsets();
  const today = new Date();
  const initial = parseIt(value) || today;
  const [ym, setYm] = useState({ y: initial.getFullYear(), m: initial.getMonth() });
  const sel = parseIt(value);

  const cells = useMemo(() => {
    const first = new Date(ym.y, ym.m, 1);
    const lead = (first.getDay() + 6) % 7; // lunedì = 0
    const days = new Date(ym.y, ym.m + 1, 0).getDate();
    const out: (number | null)[] = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= days; d++) out.push(d);
    while (out.length % 7) out.push(null);
    return out;
  }, [ym]);

  const shift = (n: number) => setYm(({ y, m }) => { const d = new Date(y, m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const isSame = (a: Date, d: number) => a.getFullYear() === ym.y && a.getMonth() === ym.m && a.getDate() === d;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={[s.sheet, { paddingBottom: insets.bottom + 14 }]} onPress={() => {}} testID="lab-date-picker">
          <View style={s.head}>
            <Pressable onPress={() => shift(-12)} hitSlop={8} style={s.nav} testID="lab-date-prev-year"><Ionicons name="play-back" size={16} color={HT.text2} /></Pressable>
            <Pressable onPress={() => shift(-1)} hitSlop={8} style={s.nav} testID="lab-date-prev"><Ionicons name="chevron-back" size={20} color={HT.text} /></Pressable>
            <Text style={s.title}>{MONTHS[ym.m]} {ym.y}</Text>
            <Pressable onPress={() => shift(1)} hitSlop={8} style={s.nav} testID="lab-date-next"><Ionicons name="chevron-forward" size={20} color={HT.text} /></Pressable>
            <Pressable onPress={() => shift(12)} hitSlop={8} style={s.nav} testID="lab-date-next-year"><Ionicons name="play-forward" size={16} color={HT.text2} /></Pressable>
          </View>
          <View style={s.row}>{DOW.map((d, i) => <Text key={i} style={s.dow}>{d}</Text>)}</View>
          <View style={s.grid}>
            {cells.map((d, i) => {
              const on = d != null && sel ? isSame(sel, d) : false;
              const isToday = d != null && isSame(today, d);
              return (
                <Pressable key={i} disabled={d == null} onPress={() => d != null && onPick(fmtIt(new Date(ym.y, ym.m, d)))} style={[s.cell, on && s.cellOn, isToday && !on && s.cellToday]} testID={d != null ? `lab-date-day-${d}` : undefined}>
                  {d != null ? <Text style={[s.cellTxt, on && { color: HT.white }, isToday && !on && { color: HT.brand }]}>{d}</Text> : null}
                </Pressable>
              );
            })}
          </View>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
            <Pressable onPress={() => onPick(fmtIt(today))} style={s.quick} testID="lab-date-today"><Ionicons name="today" size={15} color={HT.brand} /><Text style={s.quickTxt}>Oggi</Text></Pressable>
            <Pressable onPress={() => onPick("")} style={s.quick} testID="lab-date-clear"><Ionicons name="close-circle-outline" size={15} color={HT.text2} /><Text style={[s.quickTxt, { color: HT.text2 }]}>Nessuna data</Text></Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: HT.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, borderWidth: 1, borderColor: HT.border, gap: 6 },
  head: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 6 },
  nav: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, textAlign: "center", color: HT.text, fontWeight: "900", fontSize: 16 },
  row: { flexDirection: "row" },
  dow: { flex: 1, textAlign: "center", color: HT.muted, fontWeight: "800", fontSize: 11 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: "center", justifyContent: "center", borderRadius: 999 },
  cellOn: { backgroundColor: HT.brand },
  cellToday: { borderWidth: 1, borderColor: HT.brand },
  cellTxt: { color: HT.text, fontWeight: "700", fontSize: 14 },
  quick: { flex: 1, minHeight: 42, borderRadius: 999, backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  quickTxt: { color: HT.brand, fontWeight: "800", fontSize: 12.5 },
});

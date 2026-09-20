// CrtSignDate.tsx — V50.z286 — Data firma della pratica CRT: calendario nativo (Android/iOS) o <input type="date"> su web.
// Facoltativa e mai vincolante: vuota = data di compilazione; può essere retroattiva o posticipata.
import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, Platform, ActivityIndicator } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/src/theme";

const toIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fromIso = (v: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || ""); return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null; };

export function CrtSignDate({ value, effective, onChange, busy }: { value: string; effective: string; onChange: (iso: string) => void; busy?: boolean }) {
  const [show, setShow] = useState(false);
  const parsed = fromIso(value);
  const today = new Date();
  const rel = parsed ? Math.round((parsed.getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86400000) : 0;
  const relTxt = !parsed ? "data di compilazione (oggi)" : rel === 0 ? "oggi" : rel < 0 ? `retroattiva · ${-rel} g fa` : `posticipata · tra ${rel} g`;
  return (
    <View style={{ gap: 6 }} testID="crt-sign-date">
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        {Platform.OS === "web" ? (
          <View style={[s.box, { flex: 1 }]}>
            <Ionicons name="calendar" size={18} color={theme.color.brandPrimary} />
            {/* @ts-expect-error web-only */}
            <input type="date" data-testid="crt-sign-date-web" value={value || ""} onChange={(e: any) => onChange(e.target.value || "")} style={{ flex: 1, border: "none", background: "transparent", fontSize: 15, color: "#0F172A", outline: "none", fontFamily: "inherit" }} />
          </View>
        ) : (
          <Pressable onPress={() => setShow(true)} style={[s.box, { flex: 1 }]} testID="crt-sign-date-open">
            <Ionicons name="calendar" size={18} color={theme.color.brandPrimary} />
            <Text style={{ flex: 1, fontSize: 15, color: theme.color.onSurface }}>{effective}</Text>
            <Ionicons name="chevron-down" size={16} color={theme.color.muted} />
          </Pressable>
        )}
        {busy ? <ActivityIndicator color={theme.color.brandPrimary} /> : value ? (
          <Pressable onPress={() => onChange("")} hitSlop={6} style={s.clear} testID="crt-sign-date-clear" accessibilityLabel="Usa la data di compilazione"><Ionicons name="close-circle" size={22} color={theme.color.muted} /></Pressable>
        ) : null}
      </View>
      <Text style={s.hint}>{effective} · {relTxt}</Text>
      {show && Platform.OS !== "web" ? (
        <DateTimePicker
          testID="crt-sign-date-picker"
          value={parsed || today}
          mode="date"
          display={Platform.OS === "ios" ? "spinner" : "calendar"}
          onChange={(_ev, selected) => { setShow(false); if (selected) onChange(toIso(selected)); }}
        />
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  box: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#FFF", borderWidth: 1, borderColor: theme.color.border, borderRadius: 10, paddingHorizontal: 10, minHeight: 44 },
  clear: { width: 40, height: 44, alignItems: "center", justifyContent: "center" },
  hint: { fontSize: 12, color: theme.color.muted },
});

// CallChips.tsx — V50.z454 — «Chiama dal numero»: tasto «Chiama» accanto a ogni numero di telefono trovato nella risposta di Axon
import React from "react";
import { View, Text, Pressable, Linking, StyleSheet, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { CT } from "@/src/assistant/chatTheme";

// Numeri italiani (fisso 0xxx, mobile 3xx, verdi 800/803, +39 / 0039) con spazi, punti o trattini come separatori. Esclude date, importi, POD, IBAN.
const PHONE_RX = /(?:(?:\+|00)39[\s.-]?)?(?:0\d{1,3}|3\d{2}|80[03])[\s.-]?\d{2,4}(?:[\s.-]?\d{2,4}){1,2}\b/g;

export function extractPhoneNumbers(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of (text || "").matchAll(PHONE_RX)) {
    const raw = m[0];
    // scarta contesti non telefonici (date 12/05/2026, importi 1.234,56 €, codici POD/IBAN, percentuali)
    const before = (text || "").slice(Math.max(0, (m.index || 0) - 6), m.index || 0);
    const after = (text || "").slice((m.index || 0) + raw.length, (m.index || 0) + raw.length + 4);
    if (/[€%]/.test(after) || /(IT\d{2}|POD|PDR|IBAN|CF)\s*$/i.test(before) || /[/,]\d/.test(raw)) continue;
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 9 || digits.length > 13) continue;
    const tel = raw.startsWith("+") ? "+" + digits : digits.startsWith("0039") ? "+" + digits.slice(2) : digits;
    if (seen.has(tel)) continue;
    seen.add(tel);
    out.push(tel);
    if (out.length >= 3) break;
  }
  return out;
}

export function CallChips({ text }: { text: string }) {
  const numbers = extractPhoneNumbers(text);
  if (!numbers.length) return null;
  return (
    <View style={styles.row}>
      {numbers.map((n) => (
        <Pressable
          key={n}
          onPress={() => { Linking.openURL(`tel:${n}`).catch(() => {}); }}
          style={({ pressed }) => [styles.chip, pressed && { opacity: 0.75 }]}
          accessibilityRole="button"
          accessibilityLabel={`Chiama ${n}`}
          testID={`call-chip-${n}`}
        >
          <Ionicons name="call" size={14} color="#FFF" />
          <Text style={styles.txt}>Chiama{numbers.length > 1 ? ` ${n}` : ""}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  chip: {
    flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: CT.accent, borderRadius: 8,
    paddingHorizontal: 14, minHeight: Platform.OS === "android" ? 44 : 40,
  },
  txt: { color: "#FFF", fontWeight: "900", fontSize: 12.5 },
});

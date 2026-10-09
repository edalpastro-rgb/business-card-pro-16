// ContactActionChips.tsx — V50.z487 — Bottoni azione AUTOMATICI sotto ogni risposta di Axon:
//   • numero di telefono → «Chiama» (tel:) + «WhatsApp» (wa.me precompilato)
//   • indirizzo / luogo  → «Waze» + «Google Maps» con destinazione precompilata
// Sostituisce CallChips (V50.z454). V50.z488: Waze/Maps con coordinate precise (GPS letto al tap + destinazione via Google Places). Rilevamento lato client sul testo pulito della bolla: funziona per qualsiasi risposta,
// anche quando il modello non ha emesso marker [[ACTION]].
import React, { useState } from "react";
import { View, Text, Pressable, Linking, StyleSheet, Platform, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { CT } from "@/src/assistant/chatTheme";
import { openNavigation, type NavApp } from "@/src/utils/navLinks"; // V50.z488 — coordinate precise (GPS ora + Google Places)

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

/** Numero per wa.me: solo cifre con prefisso internazionale (default Italia). */
export function waNumber(tel: string): string {
  const d = tel.replace(/\D/g, "");
  if (tel.startsWith("+")) return d;
  if (d.startsWith("0039")) return d.slice(2);
  return "39" + d;
}

// Indirizzi italiani: «Via Roma 10, 36061 Bassano del Grappa (VI)», «Piazza Duomo 1 Milano», «Corso Italia, 25 - Torino»…
const STREET = "(?:Via|Viale|V\\.le|Piazza|P\\.zza|Piazzale|P\\.le|Corso|C\\.so|Largo|Vicolo|Vico|Strada|Str\\.|Contrada|C\\.da|Localit[àa]|Loc\\.|Borgo|Lungomare|Lungolago|Salita|Discesa|Calle|Fondamenta|Riva|Galleria|Rotonda|Traversa|Frazione|Fraz\\.|Zona Industriale|Z\\.I\\.|S\\.S\\.|SS|S\\.P\\.|SP|Regione|Rione|Quartiere)";
const ADDR_RX = new RegExp(
  `\\b${STREET}\\s+[A-Za-zÀ-ÿ'’.\\-]+(?:\\s+[A-Za-zÀ-ÿ'’.\\-]+){0,5}?[,\\s]+(?:n\\.?\\s*|n°\\s*|civico\\s*)?\\d{1,4}(?:\\/[A-Za-z0-9]{1,3}|\\s?[A-Za-z](?![A-Za-zÀ-ÿ]))?` +
  `(?:[,\\s-]+\\d{5})?(?:[,\\s-]+[A-ZÀ-Ü][A-Za-zÀ-ÿ'’]+(?:\\s+(?:[a-zÀ-ÿ']{1,3}\\s+)?[A-ZÀ-Ü][A-Za-zÀ-ÿ'’]+){0,3})?(?:\\s*\\([A-Z]{2}\\))?`,
  "g",
);

export function extractAddresses(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of (text || "").matchAll(ADDR_RX)) {
    let a = m[0].replace(/\s+/g, " ").replace(/[\s,.-]+$/, "").trim();
    // niente «Via» troppo corte o senza civico reale
    if (a.length < 8 || a.length > 110 || !/\d/.test(a)) continue;
    const key = a.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
    if (out.length >= 3) break;
  }
  return out;
}

const open = (url: string) => { Linking.openURL(url).catch(() => {}); };

/** V50.z488 — Waze / Google Maps con coordinate precise: GPS letto ORA + destinazione risolta via Google Places (backend). */
function NavPair({ address }: { address: string }) {
  const [busy, setBusy] = useState<NavApp | null>(null);
  const go = async (app: NavApp) => {
    if (busy) return;
    setBusy(app);
    try { await openNavigation(app, { address }); } finally { setBusy(null); }
  };
  return (
    <View style={styles.row}>
      <Pressable onPress={() => go("waze")} disabled={!!busy} style={({ pressed }) => [styles.chip, styles.waze, (pressed || busy === "waze") && styles.pressed]} accessibilityRole="button" accessibilityLabel={`Naviga con Waze verso ${address}`} testID="waze-chip">
        {busy === "waze" ? <ActivityIndicator size="small" color="#FFF" /> : <Ionicons name="navigate" size={14} color="#FFF" />}
        <Text style={styles.txt}>Waze</Text>
      </Pressable>
      <Pressable onPress={() => go("google")} disabled={!!busy} style={({ pressed }) => [styles.chip, styles.gmaps, (pressed || busy === "google") && styles.pressed]} accessibilityRole="button" accessibilityLabel={`Apri Google Maps verso ${address}`} testID="gmaps-chip">
        {busy === "google" ? <ActivityIndicator size="small" color="#FFF" /> : <Ionicons name="map" size={14} color="#FFF" />}
        <Text style={styles.txt}>Google Maps</Text>
      </Pressable>
    </View>
  );
}

export function ContactActionChips({ text }: { text: string }) {
  const numbers = extractPhoneNumbers(text);
  const addresses = extractAddresses(text);
  if (!numbers.length && !addresses.length) return null;
  const many = numbers.length > 1;
  const manyAddr = addresses.length > 1;
  return (
    <View style={styles.wrap} testID="contact-action-chips">
      {numbers.map((n) => (
        <View key={n} style={styles.row}>
          <Pressable onPress={() => open(`tel:${n}`)} style={({ pressed }) => [styles.chip, styles.call, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={`Chiama ${n}`} testID={`call-chip-${n}`}>
            <Ionicons name="call" size={14} color="#FFF" />
            <Text style={styles.txt}>Chiama{many ? ` ${n}` : ""}</Text>
          </Pressable>
          <Pressable onPress={() => open(`https://wa.me/${waNumber(n)}`)} style={({ pressed }) => [styles.chip, styles.wa, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={`WhatsApp ${n}`} testID={`wa-chip-${n}`}>
            <Ionicons name="logo-whatsapp" size={14} color="#FFF" />
            <Text style={styles.txt}>WhatsApp{many ? ` ${n}` : ""}</Text>
          </Pressable>
        </View>
      ))}
      {addresses.map((a) => (
        <View key={a} style={styles.addrBlock}>
          {manyAddr ? <Text style={styles.addrLbl} numberOfLines={1}>📍 {a}</Text> : null}
          <NavPair address={a} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6, marginTop: 4 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  addrBlock: { gap: 4 },
  addrLbl: { color: CT.muted, fontSize: 11.5, fontWeight: "700" },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 8, paddingHorizontal: 14, minHeight: Platform.OS === "android" ? 44 : 40 },
  pressed: { opacity: 0.75 },
  call: { backgroundColor: CT.accent },
  wa: { backgroundColor: "#25D366" }, // brand WhatsApp
  waze: { backgroundColor: "#33CCFF" }, // brand Waze
  gmaps: { backgroundColor: "#34A853" }, // brand Google Maps
  txt: { color: "#FFF", fontWeight: "900", fontSize: 12.5 },
});

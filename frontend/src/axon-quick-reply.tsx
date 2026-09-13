// axon-quick-reply.tsx — V50.z207 — Pulsanti ✅ Sì / ❌ No / ❓ Forse sotto le domande CHIUSE di AxonOS (modulo ISOLATO)
// Regole: compaiono solo su domande chiuse (riconoscimento euristico sul testo dell'ultima risposta), un tap invia la risposta
// automaticamente, toast «Risposta registrata ✓», spariscono dopo il tap o dopo 60 s di inattività, disabilitati sotto 320 px.
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, useWindowDimensions } from "react-native";
import { api } from "@/src/api";

const AXON_DARK = "#6D28D9";
const HIDE_AFTER_MS = 60_000;
const MIN_WIDTH = 320;

export const QUICK_REPLY_OPTIONS = [
  { key: "yes", label: "✅ Sì", text: "Sì" },
  { key: "no", label: "❌ No", text: "No" },
  { key: "maybe", label: "❓ Forse / Aspetta", text: "Forse, aspetta un momento" },
] as const;
export type QuickReplyKey = (typeof QUICK_REPLY_OPTIONS)[number]["key"];

// Domanda chiusa = ultima riga con «?» che contiene una formula di conferma/scelta binaria e NON inizia con un interrogativo aperto.
const CLOSED_RE = /\b(procediamo|procedo|proseguo|continuo|ti va( bene)?|va bene|vuoi( che)?|vuole|confermi|confermo|posso|devo|dobbiamo|cancello|elimino|salvo|salviamo|aggiorno|invio|mando|creo|sposto|programmo|imposto|stesso orario|d'accordo|è corretto|corretto|giusto|lo faccio|facciamo|andiamo avanti|ok)\b/i;
const OPEN_RE = /^\s*[-*•]?\s*(che|cosa|quale|quali|quando|dove|come|perch[éè]|chi|quant[oiae]|a che ora)\b/i;

export function isClosedQuestion(content?: string): boolean {
  if (!content) return false;
  const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return false;
  const last = lines[lines.length - 1].replace(/[*_`>#]/g, "").trim();
  if (!last.endsWith("?") || last.length > 220) return false;
  if (OPEN_RE.test(last)) return false;
  return CLOSED_RE.test(last) || /^\S+(\s\S+){0,3}\?$/.test(last); // frasi brevissime tipo «Procediamo?» «Domani stesso orario?»
}

type Props = {
  question: string;
  messageId?: string;
  options?: ReadonlyArray<{ key: string; label: string; text: string }>;
  onSelect: (text: string) => void;
};

export function QuickReplyButtons({ question, messageId, options = QUICK_REPLY_OPTIONS, onSelect }: Props) {
  const { width } = useWindowDimensions();
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setHidden(true), HIDE_AFTER_MS);
    return () => clearTimeout(t);
  }, []);

  if (width < MIN_WIDTH || hidden) return null;

  const pick = (o: { key: string; text: string }) => {
    setHidden(true);
    void api("/axon/quick-reply", { method: "POST", body: { answer: o.key, text: o.text, question: question.slice(-400), message_id: messageId } }).catch(() => {});
    onSelect(o.text);
  };

  return (
    <View style={styles.wrap} testID="quick-reply">
      <View style={styles.row}>
        {options.map((o) => (
          <Pressable key={o.key} onPress={() => pick(o)} style={[styles.chip, o.key === "yes" ? styles.yes : o.key === "no" ? styles.no : styles.maybe]} testID={`quick-reply-${o.key}`} accessibilityRole="button">
            <Text style={[styles.txt, o.key === "yes" && { color: "#FFF" }]}>{o.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/** Toast «Risposta registrata ✓» — reso dal genitore (resta visibile anche mentre Axon elabora la risposta). */
export function QuickReplyToast({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <View style={styles.toastWrap} testID="quick-reply-toast">
      <View style={styles.toast}><Text style={styles.toastTxt}>Risposta registrata ✓</Text></View>
    </View>
  );
}

export const QUICK_REPLY_TOAST_MS = 1800;

const styles = StyleSheet.create({
  wrap: { paddingLeft: 30, marginTop: 6 },
  row: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  chip: { borderRadius: 20, paddingHorizontal: 14, minHeight: 44, justifyContent: "center", alignItems: "center" },
  yes: { backgroundColor: AXON_DARK },
  no: { backgroundColor: "#FEF2F2", borderWidth: 1, borderColor: "#FECACA" },
  maybe: { backgroundColor: "#F5F3FF", borderWidth: 1, borderColor: "#DDD6FE" },
  txt: { fontWeight: "800", fontSize: 13, color: AXON_DARK },
  toastWrap: { paddingLeft: 30, marginTop: 6 },
  toast: { alignSelf: "flex-start", backgroundColor: "#ECFDF5", borderWidth: 1, borderColor: "#A7F3D0", borderRadius: 20, paddingHorizontal: 14, minHeight: 36, justifyContent: "center" },
  toastTxt: { color: "#065F46", fontWeight: "800", fontSize: 12.5 },
});

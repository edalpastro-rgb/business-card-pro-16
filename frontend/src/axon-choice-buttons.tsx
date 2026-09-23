// src/axon-choice-buttons.tsx — V50.z304 — PULSANTI DI SCELTA/AZIONE automatici sotto l'ultima risposta di Axon.
// Pattern riconosciuti nel testo dell'assistente: opzioni «A) …» «B) …» (una per riga o sulla stessa riga separate da / · |),
// parole-azione in maiuscolo tra virgolette «ORA» «DOPO» «MODIFICA» «CANCELLA» «INVIA» «CONFERMA» «ANNULLA» (o «ORA / DOPO»).
// Tap → il testo dell'opzione viene inviato come messaggio utente (Axon lo capisce senza ambiguità).
import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

export type Choice = { key: string; label: string; text: string };

const ACTION_WORDS = ["ORA", "ADESSO", "DOPO", "MODIFICA", "CANCELLA", "ELIMINA", "INVIA", "CONFERMA", "ANNULLA", "PROCEDI", "SALVA", "AGGIORNA", "CONTINUA", "STOP"];
const RX_LINE_OPT = /^\s*(?:[-•*]\s*)?(?:\*\*)?\(?([A-F])[\)\.:]\**\s+(.{1,90}?)\s*$/;
const RX_INLINE_OPT = /\(?\b([A-F])\)\s*([^/|·\n]{1,80}?)(?=\s*(?:[/|·]|\s[A-F]\)|$))/g;
const RX_QUOTED_ACTION = /«\s*([A-ZÀ-Ü][A-ZÀ-Ü\s]{1,18})\s*»|"([A-Z]{2,12})"/g;

function clean(s: string): string {
  return s.replace(/\*\*/g, "").replace(/[.;:]+$/, "").trim();
}

/** Estrae le scelte dall'ultimo messaggio di Axon; [] se non ce ne sono (min 2 opzioni, o ≥1 azione). */
export function extractChoices(content?: string): Choice[] {
  const text = (content || "").replace(/\[\[(NAV|ACTION):[^\]]*\]\]/g, "");
  if (!text.trim()) return [];
  const out: Choice[] = [];
  const seen = new Set<string>();
  const push = (key: string, label: string, sendText: string) => {
    const k = key.toUpperCase();
    if (seen.has(k) || out.length >= 6) return;
    seen.add(k); out.push({ key: k, label, text: sendText });
  };
  // 1) opzioni una per riga
  for (const line of text.split("\n")) {
    const m = RX_LINE_OPT.exec(line);
    if (m) push(m[1], `${m[1]}) ${clean(m[2])}`, `${m[1]}) ${clean(m[2])}`);
  }
  // 2) opzioni sulla stessa riga «A) … / B) …»
  if (out.length < 2) {
    for (const line of text.split("\n")) {
      if (!/[A-F]\).*[A-F]\)/.test(line)) continue;
      let m: RegExpExecArray | null;
      RX_INLINE_OPT.lastIndex = 0;
      while ((m = RX_INLINE_OPT.exec(line))) push(m[1], `${m[1]}) ${clean(m[2])}`, `${m[1]}) ${clean(m[2])}`);
    }
  }
  const letters = out.filter((o) => o.key.length === 1);
  if (letters.length === 1) out.splice(out.indexOf(letters[0]), 1); // una sola lettera = non è una scelta
  // 3) parole-azione in maiuscolo tra virgolette
  let m: RegExpExecArray | null;
  RX_QUOTED_ACTION.lastIndex = 0;
  while ((m = RX_QUOTED_ACTION.exec(text))) {
    const w = (m[1] || m[2] || "").trim().toUpperCase();
    const first = w.split(/\s+/)[0];
    if (ACTION_WORDS.includes(first) && w.length <= 20) push(w, w, w);
  }
  return out;
}

export function ChoiceButtons({ choices, onSelect }: { choices: Choice[]; onSelect: (text: string) => void }) {
  if (!choices.length) return null;
  return (
    <View style={s.wrap} testID="choice-buttons">
      {choices.map((c) => {
        const isAction = c.key.length > 1;
        return (
          <Pressable key={c.key} onPress={() => onSelect(c.text)} style={[s.btn, isAction && s.btnAction]} accessibilityRole="button" testID={`choice-${c.key.replace(/\s+/g, "_")}`}>
            <Text style={[s.txt, isAction && s.txtAction]} numberOfLines={2}>{c.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginLeft: 36, marginTop: -2, marginBottom: 6 },
  btn: { minHeight: 40, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, borderWidth: 1.5, borderColor: '#7C3AED', backgroundColor: HT.violetTint, maxWidth: "100%", justifyContent: "center" },
  btnAction: { backgroundColor: '#7C3AED', borderColor: '#7C3AED' },
  txt: { color: HT.violet, fontWeight: "800", fontSize: 14 },
  txtAction: { color: "#FFF" },
});

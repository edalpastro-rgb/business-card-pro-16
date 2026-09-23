// TourStories.tsx — V50.z244 — Tour Guidato: 4 storie utente in prima persona (nessun elenco di feature) + riga finale
// brand copy LOCKED «Non aggiungi un'app alla tua vita. Togli il caos.» — DO NOT CHANGE.
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

export const TOUR_CLOSING_LINE = "Non aggiungi un'app alla tua vita. Togli il caos."; // brand copy locked — DO NOT CHANGE

export const TOUR_STORIES: { id: string; emoji: string; title: string; text: string; color: string }[] = [
  {
    id: "trasferta", emoji: "🚗", color: "#FF6B35", title: "Il commerciale in trasferta",
    text: "Sono in auto, ho 3 appuntamenti oggi. AdvisorOS mi mostra i clienti nel raggio di 5 km, mi ricorda che Rossi ha una trattativa aperta da 12 giorni e che Bianchi festeggia il compleanno domani. Zero tempo perso a cercare, zero dettagli dimenticati.",
  },
  {
    id: "scadenza", emoji: "⏰", color: "#7C3AED", title: "La scadenza che non arriva mai",
    text: "Il bollo della mia auto scadeva ieri. AdvisorOS lo sapeva da 30 giorni e me lo aveva ricordato 3 volte. Ho pagato in 2 minuti senza cercare nulla. Nessuna multa, nessuno stress.",
  },
  {
    id: "documento", emoji: "📄", color: "#0EA5E9", title: "Il documento che non trovi mai",
    text: "Il cliente chiede la polizza firmata l'anno scorso. La cerco su AdvisorOS, la trovo in 8 secondi, la mando via WhatsApp direttamente dall'app. La riunione non si ferma.",
  },
  {
    id: "followup", emoji: "💬", color: "#10B981", title: "Il follow-up che non fai mai",
    text: "Lunedì mattina AdvisorOS mi dice: hai 4 clienti che non senti da più di 60 giorni. Con un tap preparo il messaggio, lo personalizzo, lo mando. In 3 minuti ho fatto quello che normalmente rimandavo per settimane.",
  },
];

export function TourStories() {
  return (
    <View testID="tour-stories">
      {TOUR_STORIES.map((s, i) => (
        <View key={s.id} style={styles.card} testID={`tour-story-${s.id}`}>
          <View style={[styles.stripe, { backgroundColor: s.color }]} />
          <View style={styles.body}>
            <View style={styles.head}>
              <View style={[styles.emojiWrap, { backgroundColor: s.color + "22" }]}><Text style={styles.emoji}>{s.emoji}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.kicker, { color: s.color }]}>Storia {i + 1}</Text>
                <Text style={styles.title}>{s.title}</Text>
              </View>
            </View>
            <Text style={styles.text}>“{s.text}”</Text>
          </View>
        </View>
      ))}
      <Text style={styles.closing} testID="tour-closing-line">{TOUR_CLOSING_LINE}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 12, marginTop: 14, backgroundColor: HT.card, borderRadius: 16, overflow: "hidden", flexDirection: "row", shadowColor: HT.text, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 3 },
  stripe: { width: 6 },
  body: { flex: 1, padding: 16 },
  head: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
  emojiWrap: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
  emoji: { fontSize: 24 },
  kicker: { fontSize: 11, fontWeight: "800", letterSpacing: 1.2, textTransform: "uppercase" },
  title: { fontSize: 17, fontWeight: "900", color: HT.text, letterSpacing: -0.3, marginTop: 2 },
  text: { fontSize: 14.5, lineHeight: 23, color: HT.text, fontStyle: "italic" },
  closing: { marginHorizontal: 24, marginTop: 26, marginBottom: 6, color: "#FFF", fontSize: 19, lineHeight: 28, fontWeight: "900", textAlign: "center", letterSpacing: -0.3 },
});

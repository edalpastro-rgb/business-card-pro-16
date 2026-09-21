// TourInterestForm.tsx — V50.z284 — Form spuntabile del tour: 20 domande Sì/No sulle aree di AdvisorOS → in fondo
// «È tutto o vuoi rispondere ad altre domande?» [SÌ → altre 20 domande nuove (AI)] [NO → salva profilo interessi e prosegue].
// Le risposte finiscono in user_settings.axon_interest_profile e vengono usate da Axon (prompt) per personalizzare e suggerire scorciatoie.
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";

const NAVY = "#0B1B33"; const SKY = "#38BDF8"; const MUTED = "#94A3B8"; const WHITE = "#FFFFFF";

type Q = { id: string; feature: string; text: string };
type Answer = { id: string; text: string; answer: boolean | null; feature?: string; note?: string };
type DoneResult = { features: { id: string; name: string }[]; reply: string };

export function InterestForm({ freeAnswers, onDone, onBack }: { freeAnswers: string[]; onDone: (r: DoneResult) => void; onBack: () => void }) {
  const [rounds, setRounds] = useState<Q[][]>([]);
  const [round, setRound] = useState(1);
  const [ans, setAns] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState<Record<string, string>>({}); // V50.z295 — nota/precisazione per domanda
  const [noteOpen, setNoteOpen] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"next" | "done" | null>(null);

  useEffect(() => {
    api<{ round: number; questions: Q[] }>("/tour/interest-questions")
      .then((r) => { setRounds([r.questions]); setRound(r.round || 1); })
      .catch((e: any) => notify("Axon", e?.message || "Domande non disponibili"))
      .finally(() => setLoading(false));
  }, []);

  const all = rounds.flat();
  const total = all.length;
  const answered = all.filter((q) => ans[q.id] !== undefined).length;
  const missing = total - answered;
  // V50.z295 — SÌ/NO sempre attivi: le domande senza risposta vengono saltate (non bloccano più il form)
  const answersList = (): Answer[] => all.filter((q) => ans[q.id] !== undefined || (notes[q.id] || "").trim()).map((q) => ({ id: q.id, text: q.text, answer: ans[q.id] ?? null, feature: q.feature, note: (notes[q.id] || "").trim() || undefined }));

  const more = async () => {
    setBusy("next");
    try {
      const r = await api<{ round: number; questions: Q[] }>("/tour/interest-questions/next", { method: "POST", body: { answers: answersList(), round } });
      if (!r.questions?.length) { notify("Axon", "Non ho altre domande: procediamo!"); await finish(); return; }
      setRounds((rs) => [...rs, r.questions]); setRound(r.round);
    } catch (e: any) { notify("Axon", e?.message || "Non riesco a preparare altre domande, riprova"); } finally { setBusy(null); }
  };
  const finish = async () => {
    setBusy("done");
    try {
      const r = await api<DoneResult>("/tour/interest-profile", { method: "POST", body: { answers: answersList(), free_answers: freeAnswers } });
      onDone(r);
    } catch (e: any) { notify("Axon", e?.message || "Salvataggio non riuscito"); } finally { setBusy(null); }
  };

  if (loading) return <View style={{ alignItems: "center", gap: 10, padding: 24 }}><ActivityIndicator color={SKY} /><Text style={s.hint}>Preparo le domande…</Text></View>;

  return (
    <View style={{ gap: 12 }} testID="tour-interest-form">
      <View style={s.bubble}>
        <Text style={s.bubbleTxt}>Spunta <Text style={{ fontWeight: "900", color: SKY }}>Sì</Text> o <Text style={{ fontWeight: "900" }}>No</Text>: così capisco subito cosa ti serve davvero e ti mostro le scorciatoie giuste.</Text>
      </View>
      <View style={s.progressWrap} testID="tour-interest-progress">
        <View style={s.progressBar}><View style={[s.progressFill, { width: `${total ? Math.round((answered / total) * 100) : 0}%` }]} /></View>
        <Text style={s.progressTxt}>{answered} di {total} risposte</Text>
      </View>
      {rounds.map((qs, ri) => (
        <View key={ri} style={{ gap: 10 }}>
          {rounds.length > 1 ? <Text style={s.roundLbl}>Domande {ri * 20 + 1}–{ri * 20 + qs.length}</Text> : null}
          {qs.map((q, i) => {
            const v = ans[q.id];
            return (
              <View key={q.id} style={[s.card, v !== undefined && s.cardDone]} testID={`tour-iq-${q.id}`}>
                <Text style={s.qNum}>{ri * 20 + i + 1}</Text>
                <Text style={s.qTxt}>{q.text}</Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Pressable onPress={() => setAns((a) => ({ ...a, [q.id]: true }))} style={[s.chip, v === true && s.chipYes]} testID={`tour-iq-${q.id}-yes`}>
                    <Ionicons name={v === true ? "checkbox" : "square-outline"} size={18} color={v === true ? NAVY : SKY} /><Text style={[s.chipTxt, v === true && { color: NAVY }]}>Sì</Text>
                  </Pressable>
                  <Pressable onPress={() => setAns((a) => ({ ...a, [q.id]: false }))} style={[s.chip, v === false && s.chipNo]} testID={`tour-iq-${q.id}-no`}>
                    <Ionicons name={v === false ? "checkbox" : "square-outline"} size={18} color={v === false ? WHITE : MUTED} /><Text style={[s.chipTxt, v === false && { color: WHITE }]}>No</Text>
                  </Pressable>
                </View>
                {/* V50.z295 — nota facoltativa: «Sì/No non basta» → precisazione registrata da Axon (es. soglie) */}
                {noteOpen[q.id] || notes[q.id] ? (
                  <TextInput
                    value={notes[q.id] || ""}
                    onChangeText={(txt) => setNotes((n) => ({ ...n, [q.id]: txt }))}
                    placeholder="Es. 2 settimane no, ma oltre un mese sì"
                    placeholderTextColor={MUTED}
                    multiline
                    autoFocus={!!noteOpen[q.id] && !notes[q.id]}
                    style={s.noteInput}
                    testID={`tour-iq-${q.id}-note`}
                  />
                ) : (
                  <Pressable onPress={() => setNoteOpen((o) => ({ ...o, [q.id]: true }))} style={s.noteBtn} hitSlop={6} testID={`tour-iq-${q.id}-note-open`}>
                    <Text style={s.noteBtnTxt}>Aggiungi nota 🪄 clicca qui</Text>
                  </Pressable>
                )}
              </View>
            );
          })}
        </View>
      ))}
      {/* Fondo pagina: domanda ben visibile SÌ / NO */}
      <View style={s.ask} testID="tour-interest-ask">
        <Ionicons name="help-circle" size={26} color={SKY} />
        <Text style={s.askTitle}>È tutto o vuoi rispondere ad altre domande?</Text>
        <Text style={s.askHint}>SÌ = altre 20 domande nuove (quante ne vuoi) · NO = proseguo con la configurazione{missing > 0 ? ` · ${missing} senza risposta verranno saltate` : ""}</Text>
        <View style={{ flexDirection: "row", gap: 10, width: "100%" }}>
          <Pressable onPress={more} disabled={!!busy} style={[s.bigBtn, s.bigBtnYes]} testID="tour-interest-more">
            {busy === "next" ? <ActivityIndicator color={NAVY} /> : <><Ionicons name="add-circle" size={20} color={NAVY} /><Text style={s.bigBtnTxt}>SÌ, altre domande</Text></>}
          </Pressable>
          <Pressable onPress={finish} disabled={!!busy} style={[s.bigBtn, s.bigBtnNo]} testID="tour-interest-done">
            {busy === "done" ? <ActivityIndicator color={WHITE} /> : <><Ionicons name="checkmark-circle" size={20} color={WHITE} /><Text style={[s.bigBtnTxt, { color: WHITE }]}>NO, è tutto</Text></>}
          </Pressable>
        </View>
        {busy === "next" ? <Text style={s.askHint}>Axon prepara altre 20 domande su misura…</Text> : null}
      </View>
      <Pressable onPress={onBack} style={s.back} testID="tour-interest-back"><Ionicons name="mic-outline" size={14} color={MUTED} /><Text style={s.backTxt}>Torna alle domande a voce</Text></Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  bubble: { backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 18, padding: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)" },
  bubbleTxt: { color: WHITE, fontSize: 16, lineHeight: 23 },
  hint: { color: MUTED, fontSize: 13, textAlign: "center" },
  progressWrap: { gap: 6 }, progressBar: { height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.12)", overflow: "hidden" }, progressFill: { height: 6, backgroundColor: SKY },
  progressTxt: { color: MUTED, fontSize: 12, fontWeight: "800", textAlign: "right" },
  roundLbl: { color: SKY, fontSize: 12, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.6, marginTop: 6 },
  card: { backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 16, padding: 14, gap: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.10)" },
  cardDone: { borderColor: "rgba(56,189,248,0.45)" },
  qNum: { color: SKY, fontSize: 11, fontWeight: "900" }, qTxt: { color: WHITE, fontSize: 15, lineHeight: 21 },
  chip: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.18)", backgroundColor: "rgba(255,255,255,0.04)" },
  chipYes: { backgroundColor: SKY, borderColor: SKY }, chipNo: { backgroundColor: "rgba(148,163,184,0.35)", borderColor: MUTED },
  chipTxt: { color: WHITE, fontSize: 15, fontWeight: "900" },
  ask: { alignItems: "center", gap: 10, padding: 16, borderRadius: 18, borderWidth: 2, borderColor: SKY, backgroundColor: "rgba(56,189,248,0.12)", marginTop: 6 },
  askTitle: { color: WHITE, fontSize: 18, fontWeight: "900", textAlign: "center", lineHeight: 24 }, askHint: { color: MUTED, fontSize: 12, textAlign: "center" },
  bigBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 54, borderRadius: 14, paddingHorizontal: 8 },
  bigBtnYes: { backgroundColor: SKY }, bigBtnNo: { backgroundColor: "#15803D" },
  bigBtnTxt: { color: NAVY, fontWeight: "900", fontSize: 14 },
  noteBtn: { minHeight: 32, justifyContent: "center", alignSelf: "flex-start" }, noteBtnTxt: { color: SKY, fontSize: 12, fontWeight: "800" },
  noteInput: { backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(56,189,248,0.45)", borderRadius: 10, padding: 10, color: WHITE, fontSize: 14, minHeight: 44, lineHeight: 20 },
  back: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 44 }, backTxt: { color: MUTED, fontSize: 13, fontWeight: "700" },
});

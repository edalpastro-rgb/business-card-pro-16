// CourseExtras.tsx — V50.z274 — Area Corsi Fase 2: Test/Quiz (editor creatore + svolgimento collaboratore + statistiche)
// e Relazione vocale di fine corso (dettatura → Axon organizza → editor inline → visibilità ai partecipanti).
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, Switch } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { VoiceDictationButton } from "@/src/VoiceDictationButton";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

type Q = { id?: string; text: string; type: "mcq" | "open"; options: string[]; correct?: number | null };
type Quiz = { questions: Q[]; reminder_days?: number; my_response?: { score: number; total: number; timestamp: string } | null; stats?: { responses: number; avg_score_pct: number | null; avg_duration_s: number; by_user: Record<string, { name?: string; score: number; total: number; open_answers: Record<string, string> }> } };

export function CourseQuizSection({ courseId, isCreator }: { courseId: string; isCreator: boolean }) {
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [editing, setEditing] = useState(false);
  const [qs, setQs] = useState<Q[]>([]);
  const [reminder, setReminder] = useState(3);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [started, setStarted] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { try { const r = await api<Quiz>(`/courses/${courseId}/test`); setQuiz(r); setQs(r.questions || []); setReminder(r.reminder_days ?? 3); } catch {} }, [courseId]);
  useEffect(() => { void load(); }, [load]);
  if (!quiz) return null;

  const saveQuiz = async () => {
    setBusy(true);
    try { await api(`/courses/${courseId}/test`, { method: "PUT", body: { questions: qs, reminder_days: reminder } }); setEditing(false); await load(); notify("Test", "Test salvato"); }
    catch (e: any) { notify("Test", e?.message || ""); } finally { setBusy(false); }
  };
  const submit = async () => {
    const missing = quiz.questions.filter((q) => answers[q.id!] === undefined || answers[q.id!] === "");
    if (missing.length) { notify("Test", `Rispondi a tutte le domande (${missing.length} mancanti)`); return; }
    setBusy(true);
    try { const r = await api<{ score: number; total: number }>(`/courses/${courseId}/test/submit`, { method: "POST", body: { answers, duration_s: started ? Math.round((Date.now() - started) / 1000) : 0 } }); notify("Test completato", `Risposte corrette: ${r.score}/${r.total}`); await load(); }
    catch (e: any) { notify("Test", e?.message || ""); } finally { setBusy(false); }
  };
  const upd = (i: number, patch: Partial<Q>) => setQs((l) => l.map((q, k) => (k === i ? { ...q, ...patch } : q)));

  // --- Creatore ---
  if (isCreator) {
    return (
      <View style={s.card} testID="course-quiz-creator">
        <View style={s.rowH}><Text style={s.section}>📝 Test / Quiz</Text>{!editing ? <Pressable onPress={() => { if (!qs.length) setQs([{ text: "", type: "mcq", options: ["", ""], correct: 0 }]); setEditing(true); }} style={s.miniBtn} testID="quiz-edit"><Ionicons name={qs.length ? "create-outline" : "add"} size={16} color="#7C3AED" /><Text style={s.miniTxt}>{qs.length ? "Modifica" : "Crea test"}</Text></Pressable> : null}</View>
        {editing ? (
          <View style={{ gap: 10 }}>
            {qs.map((q, i) => (
              <View key={i} style={s.qBox}>
                <View style={s.rowH}><Text style={s.qNum}>Domanda {i + 1}</Text><Pressable onPress={() => upd(i, { type: q.type === "mcq" ? "open" : "mcq" })} style={s.miniBtn}><Text style={s.miniTxt}>{q.type === "mcq" ? "Scelta multipla" : "Risposta aperta"}</Text></Pressable><Pressable onPress={() => setQs((l) => l.filter((_, k) => k !== i))} hitSlop={8}><Ionicons name="trash-outline" size={18} color="#DC2626" /></Pressable></View>
                <TextInput value={q.text} onChangeText={(v) => upd(i, { text: v })} placeholder="Testo della domanda" placeholderTextColor={HT.muted} style={s.input} multiline testID={`quiz-q-${i}`} />
                {q.type === "mcq" ? (<>
                  {q.options.map((o, k) => (
                    <View key={k} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Pressable onPress={() => upd(i, { correct: k })} hitSlop={6} testID={`quiz-q-${i}-correct-${k}`}><Ionicons name={q.correct === k ? "checkmark-circle" : "ellipse-outline"} size={22} color={q.correct === k ? "#059669" : HT.muted} /></Pressable>
                      <TextInput value={o} onChangeText={(v) => upd(i, { options: q.options.map((x, j) => (j === k ? v : x)) })} placeholder={`Opzione ${k + 1}`} placeholderTextColor={HT.muted} style={[s.input, { flex: 1, minHeight: 40 }]} testID={`quiz-q-${i}-opt-${k}`} />
                      {q.options.length > 2 ? <Pressable onPress={() => upd(i, { options: q.options.filter((_, j) => j !== k), correct: q.correct === k ? 0 : q.correct })} hitSlop={6}><Ionicons name="close" size={18} color={HT.muted} /></Pressable> : null}
                    </View>
                  ))}
                  {q.options.length < 8 ? <Pressable onPress={() => upd(i, { options: [...q.options, ""] })} style={s.miniBtn}><Ionicons name="add" size={14} color="#7C3AED" /><Text style={s.miniTxt}>Opzione</Text></Pressable> : null}
                  <Text style={s.hint}>Tocca il cerchio per indicare la risposta corretta.</Text>
                </>) : <Text style={s.hint}>Risposta libera del collaboratore (non valutata automaticamente).</Text>}
              </View>
            ))}
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable onPress={() => setQs((l) => [...l, { text: "", type: "mcq", options: ["", ""], correct: 0 }])} style={s.miniBtn} testID="quiz-add-mcq"><Ionicons name="add" size={16} color="#7C3AED" /><Text style={s.miniTxt}>Scelta multipla</Text></Pressable>
              <Pressable onPress={() => setQs((l) => [...l, { text: "", type: "open", options: [] }])} style={s.miniBtn} testID="quiz-add-open"><Ionicons name="add" size={16} color="#7C3AED" /><Text style={s.miniTxt}>Risposta aperta finale</Text></Pressable>
            </View>
            <Text style={s.hint}>Reminder se non completato:</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>{[0, 1, 3, 7].map((d) => <Pressable key={d} onPress={() => setReminder(d)} style={[s.chip, reminder === d && s.chipOn]}><Text style={[s.chipTxt, reminder === d && { color: "#FFF" }]}>{d === 0 ? "Off" : `${d} gg`}</Text></Pressable>)}</View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable onPress={() => { setEditing(false); setQs(quiz.questions); }} style={[s.btn, { backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border }]}><Text style={{ fontWeight: "800", color: HT.muted }}>Annulla</Text></Pressable>
              <Pressable onPress={saveQuiz} disabled={busy} style={[s.btn, { flex: 1, backgroundColor: '#7C3AED' }]} testID="quiz-save">{busy ? <ActivityIndicator color="#FFF" /> : <Text style={{ fontWeight: "900", color: "#FFF" }}>Salva test</Text>}</Pressable>
            </View>
          </View>
        ) : qs.length === 0 ? <Text style={s.hint}>Nessun test: crea domande a scelta multipla con una risposta aperta finale.</Text> : (
          <View style={{ gap: 6 }} testID="quiz-stats">
            <Text style={s.hint}>{qs.length} domande · reminder {reminder ? `${reminder} gg` : "off"}</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={s.stat}><Text style={s.statN}>{quiz.stats?.responses ?? 0}</Text><Text style={s.statL}>completati</Text></View>
              <View style={s.stat}><Text style={s.statN}>{quiz.stats?.avg_score_pct != null ? `${quiz.stats.avg_score_pct}%` : "—"}</Text><Text style={s.statL}>corrette (media)</Text></View>
              <View style={s.stat}><Text style={s.statN}>{quiz.stats?.avg_duration_s ? `${Math.round(quiz.stats.avg_duration_s / 60)}'${String(quiz.stats.avg_duration_s % 60).padStart(2, "0")}` : "—"}</Text><Text style={s.statL}>tempo medio</Text></View>
            </View>
            {Object.entries(quiz.stats?.by_user || {}).map(([uid, r]) => (
              <View key={uid} style={s.qBox}>
                <Text style={{ fontWeight: "800", color: HT.text }}>{r.name || uid} · {r.score}/{r.total}</Text>
                {Object.entries(r.open_answers || {}).map(([qid, a]) => <Text key={qid} style={s.hint}>💬 {qs.find((q) => q.id === qid)?.text}: <Text style={{ color: HT.text }}>{a}</Text></Text>)}
              </View>
            ))}
          </View>
        )}
      </View>
    );
  }

  // --- Collaboratore ---
  if (!quiz.questions.length) return null;
  if (quiz.my_response) return <View style={s.card} testID="course-quiz-done"><Text style={s.section}>📝 Test completato</Text><Text style={s.hint}>Risposte corrette: {quiz.my_response.score}/{quiz.my_response.total}</Text></View>;
  return (
    <View style={s.card} testID="course-quiz-take">
      <Text style={s.section}>📝 Test del corso ({quiz.questions.length} domande)</Text>
      {quiz.questions.map((q, i) => (
        <View key={q.id} style={s.qBox}>
          <Text style={{ fontWeight: "800", color: HT.text }}>{i + 1}. {q.text}</Text>
          {q.type === "mcq" ? q.options.map((o, k) => (
            <Pressable key={k} onPress={() => { if (!started) setStarted(Date.now()); setAnswers((a) => ({ ...a, [q.id!]: k })); }} style={[s.opt, answers[q.id!] === k && s.optOn]} testID={`quiz-answer-${i}-${k}`}>
              <Ionicons name={answers[q.id!] === k ? "radio-button-on" : "radio-button-off"} size={18} color="#7C3AED" /><Text style={{ flex: 1, color: HT.text }}>{o}</Text>
            </Pressable>
          )) : <TextInput value={answers[q.id!] || ""} onChangeText={(v) => { if (!started) setStarted(Date.now()); setAnswers((a) => ({ ...a, [q.id!]: v })); }} placeholder="La tua risposta" placeholderTextColor={HT.muted} style={[s.input, { minHeight: 70 }]} multiline testID={`quiz-open-${i}`} />}
        </View>
      ))}
      <Pressable onPress={submit} disabled={busy} style={[s.btn, { backgroundColor: '#7C3AED' }]} testID="quiz-submit">{busy ? <ActivityIndicator color="#FFF" /> : <Text style={{ fontWeight: "900", color: "#FFF" }}>Invia risposte</Text>}</Pressable>
    </View>
  );
}

type Report = { transcript?: string; summary: string; highlights: string[]; actions: string[]; feedback: string; proposals: string[]; visible_to_recipients?: boolean; author?: string };

export function CourseReportSection({ courseId }: { courseId: string }) {
  const [rep, setRep] = useState<Report | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(false);
  const load = useCallback(async () => { try { const r = await api<{ report: Report | null; can_edit: boolean }>(`/courses/${courseId}/report`); setRep(r.report); setCanEdit(r.can_edit); if (r.report?.transcript) setTranscript(r.report.transcript); } catch {} }, [courseId]);
  useEffect(() => { void load(); }, [load]);
  if (!canEdit && !rep) return null;

  const organize = async () => {
    if (transcript.trim().length < 10) { notify("Relazione", "Registra o scrivi la relazione prima"); return; }
    setBusy(true);
    try { const r = await api<{ report: Report }>(`/courses/${courseId}/report/organize`, { method: "POST", body: { transcript } }); setRep(r.report); setEdit(false); }
    catch (e: any) { notify("Relazione", e?.message || ""); } finally { setBusy(false); }
  };
  const save = async (patch: Partial<Report>) => { try { const r = await api<{ report: Report }>(`/courses/${courseId}/report`, { method: "PUT", body: patch }); setRep(r.report); } catch (e: any) { notify("Relazione", e?.message || ""); } };
  const listEdit = (key: "highlights" | "actions" | "proposals", label: string) => (
    <View style={{ gap: 4 }}>
      <Text style={s.lbl}>{label}</Text>
      {(rep?.[key] || []).map((x, i) => edit ? <TextInput key={i} value={x} onChangeText={(v) => setRep((r) => r ? { ...r, [key]: r[key].map((y, k) => (k === i ? v : y)) } : r)} style={[s.input, { minHeight: 40 }]} multiline /> : <Text key={i} style={s.li}>• {x}</Text>)}
      {edit ? <Pressable onPress={() => setRep((r) => r ? { ...r, [key]: [...r[key], ""] } : r)} style={s.miniBtn}><Ionicons name="add" size={14} color="#7C3AED" /><Text style={s.miniTxt}>Aggiungi</Text></Pressable> : null}
    </View>
  );

  return (
    <View style={s.card} testID="course-report">
      <View style={s.rowH}><Text style={s.section}>🎙️ Relazione fine corso</Text>{rep && canEdit ? <Pressable onPress={() => { if (edit) { void save({ summary: rep.summary, highlights: rep.highlights.filter(Boolean), actions: rep.actions.filter(Boolean), feedback: rep.feedback, proposals: rep.proposals.filter(Boolean) }); } setEdit(!edit); }} style={s.miniBtn} testID="report-edit"><Ionicons name={edit ? "checkmark" : "create-outline"} size={16} color="#7C3AED" /><Text style={s.miniTxt}>{edit ? "Fine modifica" : "Correggi"}</Text></Pressable> : null}</View>
      {canEdit ? (
        <View style={{ gap: 8 }}>
          <Text style={s.hint}>Registra a voce la relazione: Axon la trascrive, poi la organizza in riassunto, punti salienti, azioni, feedback e proposte. Puoi correggere tutto.</Text>
          <VoiceDictationButton label={transcript ? "Registra ancora (aggiunge)" : "Registra relazione"} onTranscript={(t) => setTranscript((x) => (x ? x + " " + t : t))} testID="report-dictate" />
          <TextInput value={transcript} onChangeText={setTranscript} placeholder="Trascrizione (modificabile)…" placeholderTextColor={HT.muted} style={[s.input, { minHeight: 90 }]} multiline testID="report-transcript" />
          <Pressable onPress={organize} disabled={busy} style={[s.btn, { backgroundColor: '#7C3AED' }]} testID="report-organize">{busy ? <ActivityIndicator color="#FFF" /> : <><Ionicons name="sparkles" size={16} color="#FFF" /><Text style={{ fontWeight: "900", color: "#FFF" }}>{rep ? "Riorganizza con Axon" : "Organizza con Axon"}</Text></>}</Pressable>
        </View>
      ) : null}
      {rep ? (
        <View style={{ gap: 10 }} testID="report-content">
          <Text style={s.lbl}>Riassunto</Text>
          {edit ? <TextInput value={rep.summary} onChangeText={(v) => setRep((r) => r ? { ...r, summary: v } : r)} style={[s.input, { minHeight: 90 }]} multiline testID="report-summary" /> : <Text style={s.body}>{rep.summary}</Text>}
          {listEdit("highlights", "Punti salienti")}
          {listEdit("actions", "Azioni / follow-up")}
          <Text style={s.lbl}>Feedback</Text>
          {edit ? <TextInput value={rep.feedback} onChangeText={(v) => setRep((r) => r ? { ...r, feedback: v } : r)} style={[s.input, { minHeight: 60 }]} multiline /> : <Text style={s.body}>{rep.feedback || "—"}</Text>}
          {listEdit("proposals", "Proposte")}
          {canEdit ? <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}><Switch value={!!rep.visible_to_recipients} onValueChange={(v) => save({ visible_to_recipients: v })} testID="report-visible" /><Text style={s.hint}>Visibile ai partecipanti del corso</Text></View> : <Text style={s.hint}>Relazione di {rep.author}</Text>}
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: HT.card, borderRadius: 14, borderWidth: 1, borderColor: '#E9D5FF', padding: 12, gap: 10 },
  rowH: { flexDirection: "row", alignItems: "center", gap: 8 }, section: { flex: 1, fontSize: 14, fontWeight: "900", color: HT.text },
  hint: { fontSize: 12, color: HT.muted, lineHeight: 17 }, lbl: { fontSize: 12, fontWeight: "900", color: "#6B21A8", textTransform: "uppercase" },
  body: { fontSize: 14, color: HT.text, lineHeight: 20 }, li: { fontSize: 14, color: HT.text, lineHeight: 20 },
  miniBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, minHeight: 34, borderRadius: 8, backgroundColor: '#F3E8FF' }, miniTxt: { fontSize: 12, fontWeight: "800", color: "#7C3AED" },
  qBox: { backgroundColor: '#FAF5FF', borderRadius: 10, padding: 10, gap: 6 }, qNum: { flex: 1, fontWeight: "900", color: "#6B21A8" },
  input: { backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border, borderRadius: 8, paddingHorizontal: 10, minHeight: 44, fontSize: 14, color: HT.text },
  chip: { paddingHorizontal: 12, minHeight: 36, borderRadius: 18, borderWidth: 1, borderColor: HT.border, alignItems: "center", justifyContent: "center", backgroundColor: HT.card }, chipOn: { backgroundColor: '#7C3AED', borderColor: '#7C3AED' }, chipTxt: { fontSize: 12, fontWeight: "800", color: HT.text },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 46, borderRadius: 12, paddingHorizontal: 14 },
  stat: { flex: 1, backgroundColor: '#FAF5FF', borderRadius: 10, padding: 10, alignItems: "center" }, statN: { fontSize: 18, fontWeight: "900", color: "#6B21A8" }, statL: { fontSize: 10, color: HT.muted, textAlign: "center" },
  opt: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: HT.border, backgroundColor: HT.card, minHeight: 44 }, optOn: { borderColor: '#7C3AED', backgroundColor: HT.violetTint },
});

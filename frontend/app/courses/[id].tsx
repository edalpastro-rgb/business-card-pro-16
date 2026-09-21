// courses/[id].tsx — V50.z273 — Dettaglio cartella corso. Collaboratore: apertura = lettura registrata (stop lampeggio),
// materiali scaricabili, bottoni ✅ Partecipo / ❌ Non partecipo (+ motivo). Creatore: lista partecipanti (lettura, stato,
// motivazioni espandibili), export Excel / PDF, archivia/elimina.
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Linking, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Print from "expo-print";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";
import { shareDataUri } from "@/src/share";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { CourseQuizSection, CourseReportSection } from "@/src/CourseExtras"; // V50.z274
import { CourseSlidesSection } from "@/src/CourseSlides"; // V50.z275

type Participant = { user_id: string; name: string; read_at?: string | null; status: "yes" | "no" | "pending"; notes?: string; answered_at?: string | null; certificate_eligible?: boolean; certificate_issued?: boolean; certificate_id?: string | null };
type Course = {
  course_id: string; title: string; description?: string; body_text?: string; course_date?: string; course_time?: string; location?: string; maps_url?: string; status: string; creator_name?: string; reminder_days: number;
  pre_reminders?: number[]; certificates_issued?: number; // V50.z300
  is_creator: boolean; is_new: boolean; my_participation: "yes" | "no" | "pending"; my_notes: string; recipient_count: number; read_count: number; yes_count: number; no_count: number;
  files: { file_id: string; name: string; mime: string; size?: number }[]; participants?: Participant[];
  has_test?: boolean; my_certificate?: { eligible: boolean; cert_id?: string; issued_at?: string }; // V50.z276
};
const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const PRE_REMINDERS: [number, string][] = [[7, "7 gg prima"], [3, "3 gg prima"], [1, "1 gg prima"], [0, "Giorno stesso"]]; // V50.z300
const preLabel = (d: number) => (d === 0 ? "il giorno stesso" : d === 1 ? "1 giorno prima" : `${d} giorni prima`);

export default function CourseDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const pagePad = usePageBottomPadding();
  const [c, setC] = useState<Course | null>(null);
  const [notes, setNotes] = useState("");
  const [askNo, setAskNo] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const r = await api<Course>(`/courses/${id}`); setC(r); setNotes(r.my_notes || ""); if (!r.is_creator && r.is_new) { await api(`/courses/${id}/read`, { method: "POST" }).catch(() => {}); } }
    catch (e: any) { notify("Corso", e?.message || ""); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const participate = async (status: "yes" | "no") => {
    if (status === "no" && !askNo) { setAskNo(true); return; }
    setBusy("part");
    try { await api(`/courses/${id}/participation`, { method: "POST", body: { status, notes: status === "no" ? notes : "" } }); setAskNo(false); await load(); notify("Partecipazione", status === "yes" ? "Registrato: partecipi ✅" : "Registrato: non partecipi ❌ (motivo inviato)"); }
    catch (e: any) { notify("Partecipazione", e?.message || ""); } finally { setBusy(null); }
  };
  const openFile = async (fid: string) => {
    setBusy(fid);
    try { const r = await api<{ name: string; mime: string; data_base64: string }>(`/courses/${id}/files/${fid}`); await shareDataUri(`data:${r.mime};base64,${r.data_base64}`, r.name, r.mime); }
    catch (e: any) { notify("File", e?.message || ""); } finally { setBusy(null); }
  };
  // V50.z276 — Attestato PDF (mio, oppure di un partecipante se creatore)
  const certificate = async (userId?: string) => {
    setBusy(`cert-${userId || "me"}`);
    try { const r = await api<{ name: string; mime: string; data_base64: string }>(`/courses/${id}/certificate`, { query: userId ? { user_id: userId } : undefined }); await shareDataUri(`data:${r.mime};base64,${r.data_base64}`, r.name, r.mime); }
    catch (e: any) { notify("Attestato", e?.message || ""); } finally { setBusy(null); }
  };
  const exportList = async (kind: "xlsx" | "pdf") => {
    setBusy("export");
    try {
      if (kind === "xlsx") { const r = await api<{ name: string; mime: string; data_base64: string }>(`/courses/${id}/export`, { query: { fmt: "xlsx" } }); await shareDataUri(`data:${r.mime};base64,${r.data_base64}`, r.name, r.mime); }
      else { const r = await api<{ html: string }>(`/courses/${id}/export`, { query: { fmt: "html" } }); await Print.printAsync({ html: r.html }); }
    } catch (e: any) { notify("Export", e?.message || ""); } finally { setBusy(null); }
  };
  const archive = async () => { try { await api(`/courses/${id}`, { method: "PUT", body: { status: c?.status === "archived" ? "active" : "archived" } }); await load(); } catch (e: any) { notify("Corso", e?.message || ""); } };
  const remove = async () => { try { await api(`/courses/${id}`, { method: "DELETE" }); router.back(); } catch (e: any) { notify("Corso", e?.message || ""); } };
  // V50.z300 — Fase 5: promemoria pre-lezione (creatore) + rilascio attestati a tutti i partecipanti ✅
  const togglePre = async (d: number) => {
    if (!c) return;
    const cur = c.pre_reminders || [];
    const next = cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d];
    setC({ ...c, pre_reminders: next });
    try { await api(`/courses/${id}`, { method: "PUT", body: { pre_reminders: next } }); } catch (e: any) { notify("Promemoria", e?.message || ""); await load(); }
  };
  const issueAll = async () => {
    setBusy("issue-all");
    try { const r = await api<{ issued: number; total_certificates: number }>(`/courses/${id}/certificates/issue-all`, { method: "POST" }); await load(); notify("Attestati", r.issued ? `Rilasciati ${r.issued} attestati: i partecipanti sono stati avvisati 🎓` : "Nessun nuovo attestato da rilasciare (tutti i partecipanti ✅ lo hanno già)."); }
    catch (e: any) { notify("Attestati", e?.message || ""); } finally { setBusy(null); }
  };

  if (!c) return <SafeAreaView style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.color.surface }}><ActivityIndicator color="#7C3AED" /></SafeAreaView>;
  const pending = c.recipient_count - c.yes_count - c.no_count;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.color.surface }}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={s.hBtn}><Ionicons name="chevron-back" size={24} color={theme.color.onSurface} /></Pressable>
        <View style={{ flex: 1 }}><Text style={s.title} numberOfLines={1}>{c.title}</Text><Text style={s.sub}>{c.course_date ? `📅 ${c.course_date.split("-").reverse().join("/")}${c.course_time ? ` ${c.course_time}` : ""}  ` : ""}{c.location ? `📍 ${c.location}` : ""}{c.creator_name ? `  · di ${c.creator_name}` : ""}</Text></View>
      </View>
      <ScrollView contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: pagePad }}>
        {c.description ? <View style={s.card}><Text style={s.body}>{c.description}</Text></View> : null}
        {c.maps_url ? <Pressable onPress={() => Linking.openURL(c.maps_url!)} style={s.link}><Ionicons name="navigate" size={16} color="#2563EB" /><Text style={s.linkTxt}>Apri in Maps / Waze</Text></Pressable> : null}
        {c.body_text ? <View style={s.card}><Text style={s.section}>Appunti</Text><Text style={s.body}>{c.body_text}</Text></View> : null}

        <Text style={s.section}>Materiali ({c.files.length})</Text>
        {c.files.length === 0 ? <Text style={s.hint}>Nessun allegato</Text> : c.files.map((f) => (
          <Pressable key={f.file_id} onPress={() => openFile(f.file_id)} style={s.row} testID={`course-file-${f.file_id}`}>
            <Ionicons name={f.mime.startsWith("image/") ? "image" : f.mime.startsWith("audio/") ? "musical-notes" : f.name.toLowerCase().endsWith(".pptx") ? "easel" : "document-text"} size={20} color="#7C3AED" />
            <Text style={{ flex: 1, color: theme.color.onSurface, fontWeight: "600" }} numberOfLines={1}>{f.name}</Text>
            {busy === f.file_id ? <ActivityIndicator color="#7C3AED" size="small" /> : <Ionicons name="download-outline" size={18} color={theme.color.muted} />}
          </Pressable>
        ))}

        {/* V50.z275 — Presentazione PowerPoint (AI / manuale) */}
        <CourseSlidesSection courseId={c.course_id} isCreator={c.is_creator} />

        {/* V50.z274 — Test/Quiz e Relazione fine corso */}
        <CourseQuizSection courseId={c.course_id} isCreator={c.is_creator} />
        <CourseReportSection courseId={c.course_id} />

        {!c.is_creator ? (
          <>
          {/* V50.z276 — Attestato di partecipazione */}
          <View style={[s.card, { borderColor: c.my_certificate?.eligible ? "#FCD34D" : theme.color.border, backgroundColor: c.my_certificate?.eligible ? "#FFFBEB" : "#FFF" }]} testID="course-certificate">
            <Text style={s.section}>🎓 Attestato di partecipazione</Text>
            {c.my_certificate?.eligible ? (
              <>
                <Text style={s.hint}>Complimenti! Hai completato il corso{c.has_test ? " e il test" : ""}. Il tuo attestato PDF è pronto{c.my_certificate.cert_id ? ` (n. ${c.my_certificate.cert_id})` : ""}.</Text>
                <Pressable onPress={() => certificate()} disabled={busy === "cert-me"} style={[s.pBtn, { backgroundColor: "#D97706", borderColor: "#D97706", flexDirection: "row", gap: 8 }]} testID="course-certificate-download">
                  {busy === "cert-me" ? <ActivityIndicator color="#FFF" /> : <><Ionicons name="ribbon" size={18} color="#FFF" /><Text style={[s.pTxt, { color: "#FFF" }]}>Scarica attestato PDF</Text></>}
                </Pressable>
              </>
            ) : <Text style={s.hint}>Lo ricevi automaticamente quando rispondi ✅ Partecipo{c.has_test ? " e completi il test del corso" : ""}.</Text>}
          </View>
          <View style={[s.card, { borderColor: "#C4B5FD" }]} testID="course-participation">
            <Text style={s.section}>Partecipi al corso?</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable onPress={() => participate("yes")} disabled={busy === "part"} style={[s.pBtn, { backgroundColor: c.my_participation === "yes" ? "#059669" : "#ECFDF5", borderColor: "#A7F3D0" }]} testID="course-yes"><Text style={[s.pTxt, { color: c.my_participation === "yes" ? "#FFF" : "#059669" }]}>✅ Partecipo</Text></Pressable>
              <Pressable onPress={() => participate("no")} disabled={busy === "part"} style={[s.pBtn, { backgroundColor: c.my_participation === "no" ? "#DC2626" : "#FEF2F2", borderColor: "#FECACA" }]} testID="course-no"><Text style={[s.pTxt, { color: c.my_participation === "no" ? "#FFF" : "#DC2626" }]}>❌ Non partecipo</Text></Pressable>
            </View>
            {askNo || c.my_participation === "no" ? (
              <View style={{ gap: 8 }}>
                <TextInput value={notes} onChangeText={setNotes} placeholder="Motivo assenza (obbligatorio per il Master)" placeholderTextColor={theme.color.muted} style={s.input} multiline testID="course-no-notes" />
                {askNo ? <Pressable onPress={() => participate("no")} style={[s.pBtn, { backgroundColor: "#DC2626", borderColor: "#DC2626" }]} testID="course-no-send"><Text style={[s.pTxt, { color: "#FFF" }]}>Invia motivazione</Text></Pressable> : null}
              </View>
            ) : null}
            {c.my_participation !== "pending" && !askNo ? <Text style={s.hint}>Risposta inviata al Master. Puoi cambiarla in qualsiasi momento.</Text> : null}
            {c.course_date && (c.pre_reminders || []).length && c.my_participation !== "no" ? <Text style={s.hint} testID="course-pre-reminder-hint">🔔 Riceverai un promemoria {(c.pre_reminders || []).map(preLabel).join(", ")}.</Text> : null}
          </View>
          </>
        ) : (
          <View style={[s.card, { borderColor: "#C4B5FD" }]} testID="course-participants">
            <Text style={s.section}>Partecipanti · 👀 {c.read_count}/{c.recipient_count} letto · ✅ {c.yes_count} · ❌ {c.no_count} · ⏳ {pending}</Text>
            {(c.participants || []).some((p) => p.certificate_eligible) ? <Text style={s.hint}>🎓 = attestato disponibile: tocca il nastro per scaricare il PDF del collaboratore.</Text> : null}
            {(c.participants || []).map((p) => (
              <View key={p.user_id} style={s.pRow}>
                <Pressable onPress={() => setOpen(open === p.user_id ? null : p.user_id)} style={{ flexDirection: "row", alignItems: "center", gap: 8 }} testID={`course-participant-${p.user_id}`}>
                  <Ionicons name={p.status === "yes" ? "checkmark-circle" : p.status === "no" ? "close-circle" : "time"} size={20} color={p.status === "yes" ? "#059669" : p.status === "no" ? "#DC2626" : "#D97706"} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: "800", color: theme.color.onSurface }}>{p.name}</Text>
                    <Text style={s.hint}>{p.read_at ? `✅ letto ${fmt(p.read_at)}` : "⏳ non letto"} · {p.status === "yes" ? "partecipa" : p.status === "no" ? "non partecipa" : "in attesa"}</Text>
                  </View>
                  {p.certificate_eligible ? <Pressable onPress={() => certificate(p.user_id)} hitSlop={8} disabled={busy === `cert-${p.user_id}`} testID={`course-cert-${p.user_id}`}>{busy === `cert-${p.user_id}` ? <ActivityIndicator size="small" color="#D97706" /> : <Ionicons name={p.certificate_issued ? "ribbon" : "ribbon-outline"} size={20} color="#D97706" />}</Pressable> : null}
                  {p.notes ? <Ionicons name={open === p.user_id ? "chevron-up" : "chatbox-ellipses-outline"} size={18} color="#7C3AED" /> : null}
                </Pressable>
                {open === p.user_id && p.notes ? <Text style={s.notes}>📝 {p.notes}</Text> : null}
              </View>
            ))}
            <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
              <Pressable onPress={() => exportList("xlsx")} disabled={busy === "export"} style={s.exp} testID="course-export-xlsx"><Ionicons name="grid-outline" size={16} color="#059669" /><Text style={[s.expTxt, { color: "#059669" }]}>Excel</Text></Pressable>
              <Pressable onPress={() => exportList("pdf")} disabled={busy === "export"} style={s.exp} testID="course-export-pdf"><Ionicons name="print-outline" size={16} color="#DC2626" /><Text style={[s.expTxt, { color: "#DC2626" }]}>PDF / Stampa</Text></Pressable>
            </View>
            <Text style={s.hint}>Reminder automatico: {c.reminder_days ? `dopo ${c.reminder_days} giorni se non apre o non risponde` : "disattivato"}</Text>
            {/* V50.z300 — Fase 5: promemoria pre-lezione + rilascio attestati */}
            <Text style={s.section}>🔔 Promemoria prima della lezione</Text>
            {c.course_date ? (
              <>
                <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                  {PRE_REMINDERS.map(([d, label]) => { const on = (c.pre_reminders || []).includes(d); return (
                    <Pressable key={d} onPress={() => togglePre(d)} style={[s.chip, on && s.chipOn]} testID={`course-pre-reminder-${d}`}><Text style={[s.chipTxt, on && { color: "#FFF" }]}>{label}</Text></Pressable>); })}
                </View>
                <Text style={s.hint}>{(c.pre_reminders || []).length ? `Avviso a chi partecipa o non ha risposto (mai a chi ha detto ❌) e riepilogo presenze a te, alle 08:45 ${(c.pre_reminders || []).map(preLabel).join(", ")}. Il giorno dopo la lezione: attestati automatici agli idonei e riepilogo.` : "Disattivati: nessun avviso pre-lezione."}</Text>
              </>
            ) : <Text style={s.hint}>Imposta la data del corso per attivare i promemoria pre-lezione.</Text>}
            <Pressable onPress={issueAll} disabled={busy === "issue-all" || c.yes_count === 0} style={[s.pBtn, { backgroundColor: c.yes_count ? "#D97706" : "#F1F5F9", borderColor: c.yes_count ? "#D97706" : theme.color.border, flexDirection: "row", gap: 8, minHeight: 44 }]} testID="course-issue-all">
              {busy === "issue-all" ? <ActivityIndicator color="#FFF" /> : <><Ionicons name="ribbon" size={18} color={c.yes_count ? "#FFF" : theme.color.muted} /><Text style={[s.pTxt, { color: c.yes_count ? "#FFF" : theme.color.muted }]}>Rilascia attestati a tutti i ✅ ({c.certificates_issued || 0}/{c.yes_count})</Text></>}
            </Pressable>
            <Text style={s.hint}>{"Emette l'attestato anche a chi non ha completato il test e avvisa ogni partecipante «🎓 Attestato pronto»."}</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable onPress={archive} style={s.exp} testID="course-archive"><Ionicons name="archive-outline" size={16} color="#7C3AED" /><Text style={[s.expTxt, { color: "#7C3AED" }]}>{c.status === "archived" ? "Riattiva" : "Archivia"}</Text></Pressable>
              <Pressable onPress={remove} style={[s.exp, { borderColor: "#FECACA" }]} testID="course-delete"><Ionicons name="trash-outline" size={16} color="#DC2626" /><Text style={[s.expTxt, { color: "#DC2626" }]}>Elimina</Text></Pressable>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  hBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 17, fontWeight: "900", color: theme.color.onSurface }, sub: { fontSize: 12, color: theme.color.muted },
  card: { backgroundColor: "#FFF", borderRadius: 14, borderWidth: 1, borderColor: theme.color.border, padding: 12, gap: 8 },
  body: { fontSize: 14, color: theme.color.onSurface, lineHeight: 20 }, section: { fontSize: 14, fontWeight: "900", color: theme.color.onSurface }, hint: { fontSize: 12, color: theme.color.muted },
  link: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 40 }, linkTxt: { color: "#2563EB", fontWeight: "800" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 10, backgroundColor: "#FFF", borderWidth: 1, borderColor: theme.color.border, minHeight: 48 },
  pBtn: { flex: 1, minHeight: 48, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" }, pTxt: { fontWeight: "900", fontSize: 14 },
  input: { backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: theme.color.border, borderRadius: 10, paddingHorizontal: 12, minHeight: 60, fontSize: 14, color: theme.color.onSurface },
  pRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.color.border, gap: 6 },
  notes: { fontSize: 13, color: theme.color.onSurface, backgroundColor: "#FEF3C7", borderRadius: 8, padding: 8, marginLeft: 28 },
  exp: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 42, borderRadius: 10, borderWidth: 1, borderColor: theme.color.border, backgroundColor: "#FFF" }, expTxt: { fontWeight: "800", fontSize: 13 },
  chip: { paddingHorizontal: 12, minHeight: 40, borderRadius: 20, borderWidth: 1, borderColor: theme.color.border, alignItems: "center", justifyContent: "center", backgroundColor: "#FFF" },
  chipOn: { backgroundColor: "#7C3AED", borderColor: "#7C3AED" }, chipTxt: { fontSize: 13, fontWeight: "800", color: theme.color.onSurface },
});

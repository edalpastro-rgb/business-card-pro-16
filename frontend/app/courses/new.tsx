// courses/new.tsx — V50.z273 — Nuova cartella corso (Master/Manager): titolo, descrizione, data, luogo, link mappa,
// destinatari (singoli o tutti), reminder (0/3/7/14 gg), allegati (PDF, foto, audio, testo) da dispositivo.
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { uriToBase64DataUrl } from "@/src/utils/media";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

type Member = { user_id: string; name: string };
type F = { name: string; mime: string; data_base64: string };
const PRE_REMINDERS: [number, string][] = [[7, "7 gg prima"], [3, "3 gg prima"], [1, "1 gg prima"], [0, "Giorno stesso"]]; // V50.z300

export default function NewCourseScreen() {
  const router = useRouter();
  const pagePad = usePageBottomPadding();
  const [team, setTeam] = useState<Member[]>([]);
  const [title, setTitle] = useState(""); const [desc, setDesc] = useState(""); const [body, setBody] = useState("");
  const [date, setDate] = useState(""); const [time, setTime] = useState(""); const [loc, setLoc] = useState(""); const [maps, setMaps] = useState("");
  const [all, setAll] = useState(true); const [sel, setSel] = useState<string[]>([]);
  const [reminder, setReminder] = useState(3);
  const [preRem, setPreRem] = useState<number[]>([1]); // V50.z300 — promemoria prima della lezione
  const [files, setFiles] = useState<F[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => { api<{ team: Member[] }>("/courses/can-manage").then((r) => setTeam(r.team || [])).catch(() => {}); }, []);

  const pick = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true, type: ["application/pdf", "image/*", "audio/*", "text/*", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"] });
      if (res.canceled) return;
      const out: F[] = [];
      for (const a of res.assets || []) out.push({ name: a.name || "file", mime: a.mimeType || "application/octet-stream", data_base64: await uriToBase64DataUrl(a.uri, a.mimeType || "application/octet-stream") });
      setFiles((f) => [...f, ...out]);
    } catch (e: any) { notify("Allegati", e?.message || "Impossibile leggere il file"); }
  };
  const save = async () => {
    if (!title.trim()) { notify("Corso", "Inserisci il titolo"); return; }
    if (!all && sel.length === 0) { notify("Corso", "Scegli almeno un destinatario"); return; }
    setSaving(true);
    try {
      const r = await api<{ course_id: string }>("/courses", { method: "POST", body: { title, description: desc, body_text: body, course_date: date, course_time: time, location: loc, maps_url: maps, recipients: all ? [] : sel, reminder_days: reminder, pre_reminders: preRem, files } });
      router.replace(`/courses/${r.course_id}` as any);
    } catch (e: any) { notify("Corso", e?.message || "Creazione non riuscita"); } finally { setSaving(false); }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: HT.card2 }}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={s.hBtn}><Ionicons name="chevron-back" size={24} color={HT.text} /></Pressable>
        <Text style={[s.title, { flex: 1 }]}>Nuova cartella corso</Text>
        <Pressable onPress={save} disabled={saving} style={[s.saveBtn, saving && { opacity: 0.6 }]} testID="course-save">{saving ? <ActivityIndicator color="#FFF" size="small" /> : <Text style={s.saveTxt}>Crea</Text>}</Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: pagePad }} keyboardShouldPersistTaps="handled">
        <TextInput value={title} onChangeText={setTitle} placeholder="Titolo del corso *" placeholderTextColor={HT.muted} style={s.input} testID="course-title" />
        <TextInput value={desc} onChangeText={setDesc} placeholder="Descrizione / indicazioni" placeholderTextColor={HT.muted} style={[s.input, { minHeight: 70 }]} multiline testID="course-desc" />
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TextInput value={date} onChangeText={setDate} placeholder="Data (AAAA-MM-GG)" placeholderTextColor={HT.muted} style={[s.input, { flex: 1.4 }]} testID="course-date" />
          <TextInput value={time} onChangeText={setTime} placeholder="Ora (HH:MM)" placeholderTextColor={HT.muted} style={[s.input, { flex: 1 }]} keyboardType="numbers-and-punctuation" testID="course-time" />
        </View>
        <TextInput value={loc} onChangeText={setLoc} placeholder="Luogo" placeholderTextColor={HT.muted} style={s.input} testID="course-location" />
        <TextInput value={maps} onChangeText={setMaps} placeholder="Link Google Maps / Waze (opzionale)" placeholderTextColor={HT.muted} style={s.input} autoCapitalize="none" />
        <TextInput value={body} onChangeText={setBody} placeholder="Appunti / testo libero del corso" placeholderTextColor={HT.muted} style={[s.input, { minHeight: 110 }]} multiline />

        <Text style={s.section}>Destinatari</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable onPress={() => setAll(true)} style={[s.chip, all && s.chipOn]} testID="course-recipients-all"><Text style={[s.chipTxt, all && { color: "#FFF" }]}>Tutti i collaboratori ({team.length})</Text></Pressable>
          <Pressable onPress={() => setAll(false)} style={[s.chip, !all && s.chipOn]} testID="course-recipients-pick"><Text style={[s.chipTxt, !all && { color: "#FFF" }]}>Scegli</Text></Pressable>
        </View>
        {!all ? team.map((m) => { const on = sel.includes(m.user_id); return (
          <Pressable key={m.user_id} onPress={() => setSel((l) => on ? l.filter((x) => x !== m.user_id) : [...l, m.user_id])} style={s.row} testID={`course-recipient-${m.user_id}`}>
            <Ionicons name={on ? "checkbox" : "square-outline"} size={20} color="#7C3AED" /><Text style={{ flex: 1, color: HT.text, fontWeight: "600" }}>{m.name}</Text>
          </Pressable>); }) : null}

        <Text style={s.section}>Reminder automatico se non apre / non risponde</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {[0, 3, 7, 14].map((d) => <Pressable key={d} onPress={() => setReminder(d)} style={[s.chip, reminder === d && s.chipOn]} testID={`course-reminder-${d}`}><Text style={[s.chipTxt, reminder === d && { color: "#FFF" }]}>{d === 0 ? "Off" : `${d} gg`}</Text></Pressable>)}
        </View>

        <Text style={s.section}>Promemoria ai partecipanti prima della lezione</Text>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          {PRE_REMINDERS.map(([d, label]) => { const on = preRem.includes(d); return (
            <Pressable key={d} onPress={() => setPreRem((l) => on ? l.filter((x) => x !== d) : [...l, d])} style={[s.chip, on && s.chipOn]} testID={`course-pre-reminder-${d}`}><Text style={[s.chipTxt, on && { color: "#FFF" }]}>{label}</Text></Pressable>); })}
        </View>
        <Text style={s.hint}>{date ? (preRem.length ? "Avviso a chi partecipa (o non ha ancora risposto) e riepilogo presenze a te. Il giorno dopo: attestati agli idonei." : "Nessun promemoria pre-lezione.") : "Inserisci la data del corso per attivare i promemoria."}</Text>

        <Text style={s.section}>Allegati (PDF, Excel, foto, audio, testo)</Text>
        {files.map((f, i) => <View key={i} style={s.row}><Ionicons name="document" size={18} color="#7C3AED" /><Text style={{ flex: 1, color: HT.text }} numberOfLines={1}>{f.name}</Text><Pressable onPress={() => setFiles((l) => l.filter((_, k) => k !== i))} hitSlop={8}><Ionicons name="close-circle" size={18} color={HT.muted} /></Pressable></View>)}
        <Pressable onPress={pick} style={s.pick} testID="course-add-file"><Ionicons name="attach" size={18} color="#7C3AED" /><Text style={{ color: "#7C3AED", fontWeight: "800" }}>Aggiungi file {Platform.OS === "web" ? "dal computer" : "dal dispositivo"}</Text></Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderBottomWidth: 1, borderBottomColor: HT.border },
  hBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" }, title: { fontSize: 18, fontWeight: "900", color: HT.text },
  saveBtn: { backgroundColor: '#7C3AED', borderRadius: 10, paddingHorizontal: 16, minHeight: 40, alignItems: "center", justifyContent: "center" }, saveTxt: { color: "#FFF", fontWeight: "900" },
  input: { backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border, borderRadius: 10, paddingHorizontal: 12, minHeight: 46, fontSize: 14, color: HT.text },
  section: { fontSize: 14, fontWeight: "900", color: HT.text, marginTop: 6 },
  hint: { fontSize: 12, color: HT.muted },
  chip: { paddingHorizontal: 12, minHeight: 40, borderRadius: 20, borderWidth: 1, borderColor: HT.border, alignItems: "center", justifyContent: "center", backgroundColor: HT.card },
  chipOn: { backgroundColor: '#7C3AED', borderColor: '#7C3AED' }, chipTxt: { fontSize: 13, fontWeight: "800", color: HT.text },
  row: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 10, backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border, minHeight: 46 },
  pick: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 46, borderRadius: 10, borderWidth: 1, borderStyle: "dashed", borderColor: '#C4B5FD', backgroundColor: '#FAF5FF' },
});

// TranscriptReviewSheet.tsx — V50.z389 — FUNZIONALITÀ 4 (globale): revisione/lettura della trascrizione pulita di un audio.
// • chi ha caricato (o Master): bozza → «Vuoi modificare qualcosa prima di salvare?» → modifica → «Salva e pubblica»
// • utenti autorizzati: testo pubblicato in SOLA LETTURA (nessun download/condivisione)
// • stato «transcribing»: polling ogni 4 s finché la bozza è pronta.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Modal, View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, ScrollView, Platform } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { HT } from "@/src/homeTheme";

export type AudioTranscript = {
  transcript_id: string; title: string; status: "transcribing" | "draft" | "published" | "failed"; text: string | null; raw_text?: string | null;
  error?: string | null; can_edit: boolean; source_kind: string; source_id: string; created_at: string; published_at?: string | null; uploaded_by: string;
};

export const transcriptApi = {
  get: (id: string) => api<AudioTranscript>(`/audio-transcripts/${id}`),
  list: (q: { source_kind?: string; source_id?: string }) => api<{ items: AudioTranscript[]; is_master: boolean }>("/audio-transcripts", { query: q as any }),
  save: (id: string, body: { text?: string; title?: string; publish?: boolean }) => api<AudioTranscript>(`/audio-transcripts/${id}`, { method: "PUT", body }),
  retry: (id: string) => api<AudioTranscript>(`/audio-transcripts/${id}/retry`, { method: "POST" }),
  unpublish: (id: string) => api(`/audio-transcripts/${id}/unpublish`, { method: "POST" }),
};

export const TRANSCRIPT_STATUS_LABEL: Record<AudioTranscript["status"], string> = { transcribing: "Trascrizione in corso…", draft: "Bozza da confermare", published: "Pubblicata", failed: "Trascrizione non riuscita" };

export function TranscriptReviewBody({ transcriptId, onDone, onPublished }: { transcriptId: string; onDone: () => void; onPublished?: (t: AudioTranscript) => void }) {
  const [t, setT] = useState<AudioTranscript | null>(null);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await transcriptApi.get(transcriptId); setT(r); setErr(null);
      if (r.text != null) setText((prev) => prev || r.text || "");
      if (r.status === "transcribing") timer.current = setTimeout(load, 4000);
    } catch (e: any) { setErr(e?.message || "Trascrizione non disponibile"); }
  }, [transcriptId]);
  useEffect(() => { void load(); return () => { if (timer.current) clearTimeout(timer.current); }; }, [load]);

  const publish = async () => {
    if (!text.trim()) { notify("Il testo è vuoto"); return; }
    setBusy("pub");
    try { const r = await transcriptApi.save(transcriptId, { text, publish: true }); setT(r); notify("Trascrizione salvata: ora è leggibile dagli utenti autorizzati"); onPublished?.(r); onDone(); }
    catch (e: any) { notify(e?.message || "Salvataggio non riuscito"); } finally { setBusy(null); }
  };
  const saveDraft = async () => {
    setBusy("draft");
    try { const r = await transcriptApi.save(transcriptId, { text }); setT(r); notify("Bozza salvata (non ancora visibile agli altri)"); onDone(); }
    catch (e: any) { notify(e?.message || "Salvataggio non riuscito"); } finally { setBusy(null); }
  };
  const retry = async () => {
    setBusy("retry");
    try { const r = await transcriptApi.retry(transcriptId); setT(r); setText(r.text || ""); }
    catch (e: any) { notify(e?.message || "Riprova non riuscita"); } finally { setBusy(null); }
  };

  if (err) return <View style={s.center} testID="transcript-error"><Ionicons name="alert-circle" size={36} color={HT.danger} /><Text style={s.muted}>{err}</Text></View>;
  if (!t) return <View style={s.center}><ActivityIndicator color={HT.violet} /></View>;
  if (t.status === "transcribing") return <View style={s.center} testID="transcript-transcribing"><ActivityIndicator color={HT.violet} /><Text style={s.muted}>Sto trascrivendo e ripulendo l'audio… Per file lunghi possono servire alcuni minuti: ti avviso appena la bozza è pronta.</Text></View>;
  if (t.status === "failed") return (
    <View style={s.center} testID="transcript-failed"><Ionicons name="alert-circle" size={36} color={HT.danger} /><Text style={s.muted}>{t.error || "Trascrizione non riuscita"}</Text>
      {t.can_edit && t.raw_text ? <Pressable onPress={retry} style={s.primary} disabled={!!busy}>{busy ? <ActivityIndicator color="#FFF" /> : <Text style={s.primaryTxt}>Riprova la pulizia</Text>}</Pressable> : null}
    </View>
  );

  const editable = t.can_edit && t.status !== "published";
  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }} keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        {editable ? (
          <View style={s.askBox} testID="transcript-ask"><Ionicons name="create-outline" size={18} color={HT.violet} /><Text style={s.askTxt}>Vuoi modificare qualcosa prima di salvare?</Text></View>
        ) : (
          <Text style={s.muted}>{t.status === "published" ? "Testo pubblicato · sola lettura in app" : TRANSCRIPT_STATUS_LABEL[t.status]}</Text>
        )}
        {editable ? (
          <TextInput value={text} onChangeText={setText} multiline textAlignVertical="top" style={s.editor} placeholder="Testo della trascrizione" placeholderTextColor={HT.muted} testID="transcript-editor" />
        ) : (
          <View style={s.reader} testID="transcript-reader"><Text style={s.readerTxt} selectable={false}>{t.text || ""}</Text></View>
        )}
        {t.can_edit && t.raw_text ? (
          <Pressable onPress={() => setShowRaw((v) => !v)} style={s.ghost} testID="transcript-toggle-raw"><Ionicons name={showRaw ? "eye-off" : "eye"} size={16} color={HT.violet} /><Text style={s.ghostTxt}>{showRaw ? "Nascondi trascrizione grezza" : "Confronta con la trascrizione grezza"}</Text></Pressable>
        ) : null}
        {showRaw && t.raw_text ? <View style={[s.reader, { backgroundColor: HT.card2 }]}><Text style={[s.readerTxt, { color: HT.muted }]}>{t.raw_text}</Text></View> : null}
        {editable ? (
          <View style={{ gap: 8 }}>
            <Pressable onPress={publish} disabled={!!busy} style={s.primary} testID="transcript-publish">{busy === "pub" ? <ActivityIndicator color="#FFF" /> : <><Ionicons name="checkmark-circle" size={18} color="#FFF" /><Text style={s.primaryTxt}>Salva e rendi leggibile</Text></>}</Pressable>
            <Pressable onPress={saveDraft} disabled={!!busy} style={s.ghost} testID="transcript-save-draft">{busy === "draft" ? <ActivityIndicator color={HT.violet} /> : <Text style={s.ghostTxt}>Salva bozza, decido dopo</Text>}</Pressable>
          </View>
        ) : t.can_edit && t.status === "published" ? (
          <Pressable onPress={async () => { setBusy("unpub"); try { await transcriptApi.unpublish(t.transcript_id); await load(); } catch (e: any) { notify(e?.message || "Errore"); } finally { setBusy(null); } }} style={s.ghost} disabled={!!busy} testID="transcript-unpublish"><Ionicons name="pencil" size={16} color={HT.violet} /><Text style={s.ghostTxt}>Riporta in bozza per modificare</Text></Pressable>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function TranscriptReviewSheet({ transcriptId, title, onClose, onPublished }: { transcriptId: string | null; title?: string; onClose: () => void; onPublished?: (t: AudioTranscript) => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={!!transcriptId} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={[s.root, { paddingTop: Platform.OS === "android" ? insets.top : 8, paddingBottom: insets.bottom }]} testID="transcript-sheet">
        <View style={s.head}>
          <Ionicons name="document-text" size={20} color={HT.violet} />
          <Text style={s.title} numberOfLines={1}>{title || "Trascrizione"}</Text>
          <Pressable onPress={onClose} hitSlop={10} testID="transcript-close"><Ionicons name="close" size={24} color={HT.text} /></Pressable>
        </View>
        {transcriptId ? <TranscriptReviewBody transcriptId={transcriptId} onDone={onClose} onPublished={onPublished} /> : null}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: HT.bg },
  head: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: HT.border },
  title: { flex: 1, fontSize: 16, fontWeight: "900", color: HT.text },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  muted: { color: HT.muted, fontSize: 13, textAlign: "center", lineHeight: 19 },
  askBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: HT.violetTint, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: HT.violet + "55" },
  askTxt: { flex: 1, color: HT.text, fontWeight: "800", fontSize: 14 },
  editor: { minHeight: 260, borderWidth: 1, borderColor: HT.border, borderRadius: 14, padding: 12, color: HT.text, fontSize: 15, lineHeight: 22, backgroundColor: HT.card },
  reader: { borderWidth: 1, borderColor: HT.border, borderRadius: 14, padding: 14, backgroundColor: HT.card },
  readerTxt: { color: HT.text, fontSize: 15, lineHeight: 23 },
  primary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 48, borderRadius: 14, backgroundColor: HT.violet }, primaryTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
  ghost: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: HT.violet + "66", backgroundColor: HT.violetTint }, ghostTxt: { color: HT.violet, fontWeight: "800", fontSize: 13 },
});

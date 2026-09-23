// src/wizard/Step4ParlaNeo.tsx — V50.z215 — BLOCCO 4 · Step 4 «Parla a Neo»: tre input NON esclusivi (testo libero · file · audio).
// File: multipart a chunk (mai base64), max 50 MB, salvato nei Master Files. Audio: registrazione → Whisper → Neo.
// Neo estrae proposte (mail → «Mail principale», indirizzo → anagrafica, telefono, nome…) e fatti: UN tap per confermare ciascuna.
// «Completa» con materiale non inviato / proposte in sospeso → popup «Vuoi inviare così com'è o completare?» (due bottoni).
import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TextInput, Pressable, Modal, ActivityIndicator, Platform, Alert, Linking } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { useAudioRecorder, AudioModule, RecordingPresets, setAudioModeAsync } from "expo-audio"; // V50.z255 — fix «undefined is not a function»: expo-audio non esporta createAudioRecorder
import { api, apiUpload } from "@/src/api";
import type { StepBinder } from "@/src/wizard/Step1Anagrafica";
import { PrivacyNote } from "@/src/wizard/PrivacyNote"; // V50.z217
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

const PURPLE = "#7C3AED";
const MAX_FILE = 50 * 1024 * 1024;
const PLACEHOLDER = "Raccontami qualcosa di te, della tua vita, del tuo lavoro. Imparo da quello che scrivi.";

type Proposal = { id: string; field: string; label: string; value: string; why?: string; current?: string | null; status: "pending" | "accepted" | "rejected" };
type Fact = { id: string; section: string; text: string; status: "pending" | "accepted" | "rejected" };
type Analysis = { summary?: string; proposals?: Proposal[]; facts?: Fact[]; transcript?: string; file?: { name: string; size: number }; empty?: boolean; message?: string; queued?: boolean; job?: { id: string; name: string } };
type Job = { id: string; kind: string; name: string; status: "running" | "done" | "error"; error?: string | null };
type TalkState = { proposals: Proposal[]; facts: Fact[]; inputs: { summary: string; kind?: string; transcript?: string }[]; jobs: Job[] };
type Picked = { uri: string; name: string; mime: string; size: number; blob?: Blob };

const fmtSize = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function Step4ParlaNeo({ bind }: { bind: StepBinder }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<null | "text" | "file" | "audio">(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [error, setError] = useState("");
  const [summaries, setSummaries] = useState<string[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [transcript, setTranscript] = useState("");
  const [rec, setRec] = useState(false);
  const [sec, setSec] = useState(0);
  const [askIncomplete, setAskIncomplete] = useState(false);
  const [reading, setReading] = useState<Job[]>([]); // V50.z216 — job file/audio in background
  const pollRef = useRef<any>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);
  const timer = useRef<any>(null); const secRef = useRef(0);
  const webRec = useRef<any>(null); const chunks = useRef<Blob[]>([]); const stream = useRef<MediaStream | null>(null);
  // V50.z255 — Nativo (iOS/Android): recorder expo-audio via hook (come VoiceDictationButton); prima si usava
  // `AudioMod.createAudioRecorder(...)` che NON esiste nel pacchetto → «undefined is not a function» al tap su Registra.
  const nativeRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const nativeRecording = useRef(false);
  const stateRef = useRef({ text, picked, rec, proposals, facts, busy, reading }); stateRef.current = { text, picked, rec, proposals, facts, busy, reading };

  // Stato dal server (anche al rientro): proposte, fatti, riassunti, job in corso → se ci sono job attivi continua il polling
  const syncTalk = useCallback(async (): Promise<boolean> => {
    try {
      const r = await api<TalkState>("/axon/setup/talk");
      setProposals(r.proposals || []); setFacts(r.facts || []);
      setSummaries((r.inputs || []).map((i) => i.summary).filter(Boolean));
      const lastAudio = [...(r.inputs || [])].reverse().find((i) => i.kind === "audio" && i.transcript);
      if (lastAudio?.transcript) setTranscript(lastAudio.transcript);
      const running = (r.jobs || []).filter((j) => j.status === "running");
      setReading(running);
      const errs = (r.jobs || []).filter((j) => j.status === "error").slice(-1);
      if (!running.length && errs.length && errs[0].error) setError(`${errs[0].name}: ${errs[0].error}`);
      return running.length > 0;
    } catch { return false; }
  }, []);
  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => { const still = await syncTalk(); if (!still && pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } }, 3500);
  }, [syncTalk]);
  useEffect(() => {
    void syncTalk().then((still) => { if (still) startPolling(); });
    return () => { if (timer.current) clearInterval(timer.current); if (pollRef.current) clearInterval(pollRef.current); try { stream.current?.getTracks().forEach((t) => t.stop()); } catch {} };
  }, [syncTalk, startPolling]);

  const absorb = (a: Analysis) => {
    if (a.queued) { if (a.job) setReading((r) => [...r, { ...a.job!, kind: "file", status: "running" }]); startPolling(); return; }
    if (a.summary) setSummaries((s) => [...s, a.summary as string]);
    setProposals((p) => [...p, ...(a.proposals || [])]);
    setFacts((f) => [...f, ...(a.facts || [])]);
    if (a.transcript) setTranscript(a.transcript);
    if (a.empty && a.message) setError(a.message);
  };

  // ── 1) Testo libero
  const sendText = async () => {
    const t = text.trim();
    if (t.length < 10) { setError("Scrivi almeno una frase: Neo impara da quello che racconti."); return; }
    setBusy("text"); setError("");
    try { absorb(await api<Analysis>("/axon/setup/talk/analyze", { method: "POST", body: { text: t } })); setText(""); }
    catch (e: any) { setError(e?.message || "Neo non è riuscito a leggere il testo"); } finally { setBusy(null); }
  };

  // ── 2) File (multipart, max 50 MB)
  const pickFile = async () => {
    setError("");
    const r = await DocumentPicker.getDocumentAsync({ multiple: false, copyToCacheDirectory: true, type: ["application/pdf", "image/*", "text/*", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.presentationml.presentation", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/msword"] });
    if (r.canceled || !r.assets?.[0]) return;
    const a = r.assets[0];
    const size = a.size ?? (a.file as any)?.size ?? 0;
    if (size > MAX_FILE) { setError(`«${a.name}» pesa ${fmtSize(size)}: il limite è 50 MB.`); return; }
    setPicked({ uri: a.uri, name: a.name || "file", mime: a.mimeType || "application/octet-stream", size, blob: (a.file as any) || undefined });
  };
  const sendFile = async () => {
    if (!picked) return;
    setBusy("file"); setError("");
    try {
      const form = new FormData();
      if (Platform.OS === "web") {
        const blob = picked.blob || (await (await fetch(picked.uri)).blob());
        form.append("file", new File([blob], picked.name, { type: picked.mime || blob.type }));
      } else form.append("file", { uri: picked.uri, name: picked.name, type: picked.mime } as any);
      absorb(await apiUpload<Analysis>("/axon/setup/talk/upload", form));
      setPicked(null);
    } catch (e: any) { setError(e?.message || "Caricamento non riuscito"); } finally { setBusy(null); }
  };

  // ── 3) Audio → Whisper → Neo
  const tick = () => { secRef.current = 0; setSec(0); timer.current = setInterval(() => { secRef.current += 1; setSec(secRef.current); if (secRef.current >= 300) void stopRec(); }, 1000); };
  const sendAudio = async (form: FormData) => {
    setBusy("audio"); setError("");
    try { absorb(await apiUpload<Analysis>("/axon/setup/talk/audio", form)); }
    catch (e: any) { setError(e?.message || "Trascrizione non riuscita"); } finally { setBusy(null); }
  };
  const startRec = async () => {
    setError("");
    if (Platform.OS !== "web") {
      try {
        let perm = await AudioModule.getRecordingPermissionsAsync();
        if (!perm?.granted) {
          if (perm?.canAskAgain === false) { Alert.alert("Microfono disattivato", "Per parlare a Neo abilita il microfono nelle impostazioni.", [{ text: "Annulla", style: "cancel" }, { text: "Apri impostazioni", onPress: () => Linking.openSettings() }]); return; }
          perm = await AudioModule.requestRecordingPermissionsAsync();
          if (!perm?.granted) { setError("Senza microfono non posso ascoltarti: puoi scrivere o caricare un file."); return; }
        }
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await nativeRecorder.prepareToRecordAsync();
        nativeRecorder.record();
        nativeRecording.current = true; tick(); setRec(true);
      } catch (e: any) { setError(e?.message || String(e)); }
      return;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.current = s;
      const MR: any = (globalThis as any).MediaRecorder;
      let mime = "audio/webm;codecs=opus";
      if (MR?.isTypeSupported && !MR.isTypeSupported(mime)) mime = MR.isTypeSupported("audio/webm") ? "audio/webm" : MR.isTypeSupported("audio/mp4") ? "audio/mp4" : "";
      const r = mime ? new MR(s, { mimeType: mime }) : new MR(s); webRec.current = r; chunks.current = [];
      r.ondataavailable = (ev: BlobEvent) => { if (ev.data?.size) chunks.current.push(ev.data); };
      r.onstop = async () => {
        s.getTracks().forEach((t) => t.stop()); stream.current = null;
        const blob = new Blob(chunks.current, { type: r.mimeType || "audio/webm" });
        if (blob.size < 1024) { setError("Registrazione troppo corta: parla per almeno un secondo."); return; }
        const form = new FormData(); const m = blob.type || "audio/webm";
        form.append("file", new File([blob], `neo.${m.includes("mp4") ? "m4a" : "webm"}`, { type: m })); form.append("mime", m);
        await sendAudio(form);
      };
      r.start(); tick(); setRec(true);
    } catch (e: any) { setError(e?.name === "NotAllowedError" ? "Permesso microfono negato dal browser." : (e?.message || String(e))); }
  };
  const stopRec = async () => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    setRec(false);
    if (Platform.OS !== "web") {
      try {
        if (!nativeRecording.current) return;
        nativeRecording.current = false;
        await nativeRecorder.stop();
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
        const uri: string | undefined = nativeRecorder.uri || undefined; if (!uri) return;
        if (secRef.current < 1) { setError("Registrazione troppo corta: parla per almeno un secondo."); return; }
        const form = new FormData(); form.append("file", { uri, name: "neo.m4a", type: "audio/m4a" } as any); form.append("mime", "audio/m4a");
        await sendAudio(form);
      } catch (e: any) { setError(e?.message || String(e)); }
      return;
    }
    try { if (webRec.current && webRec.current.state !== "inactive") webRec.current.stop(); } catch {}
  };

  // ── Proposte / fatti: un tap
  const decide = async (kind: "proposal" | "fact", id: string, accept: boolean) => {
    const status = accept ? "accepted" : "rejected";
    if (kind === "proposal") setProposals((p) => p.map((x) => (x.id === id ? { ...x, status } : x))); else setFacts((f) => f.map((x) => (x.id === id ? { ...x, status } : x)));
    try { await api("/axon/setup/talk/confirm", { method: "POST", body: kind === "proposal" ? { proposal_id: id, accept } : { fact_id: id, accept } }); }
    catch (e: any) { setError(e?.message || "Non sono riuscito a salvare"); }
  };

  // ── «Completa»: materiale non inviato o proposte in sospeso → popup
  const submit = useCallback(async (): Promise<boolean> => {
    const s = stateRef.current;
    const incomplete = s.text.trim().length > 0 || !!s.picked || s.rec || !!s.busy || s.reading.length > 0 || s.proposals.some((p) => p.status === "pending") || s.facts.some((f) => f.status === "pending");
    if (!incomplete) return true;
    return new Promise<boolean>((res) => { resolver.current = res; setAskIncomplete(true); });
  }, []);
  useEffect(() => { bind(submit); }, [bind, submit]);
  const answer = (ok: boolean) => { setAskIncomplete(false); resolver.current?.(ok); resolver.current = null; };

  const pending = proposals.filter((p) => p.status === "pending").sort((a, b) => Number(b.field === "primary_email") - Number(a.field === "primary_email"));
  const decidedN = proposals.length - pending.length;
  const pendingFacts = facts.filter((f) => f.status === "pending");

  return (
    <View style={{ gap: 14 }} testID="step4-parla-neo">
      <Text style={styles.lead}>Scrivi, carica o parla: puoi usare tutti e tre i canali. Neo compila da solo i campi dell'app e ti chiede un tap per confermare.</Text>

      {/* 1 · Testo libero */}
      <View style={styles.card}>
        <View style={styles.cardHead}><Ionicons name="create" size={18} color={PURPLE} /><Text style={styles.cardTitle}>Testo libero</Text></View>
        <TextInput value={text} onChangeText={setText} placeholder={PLACEHOLDER} placeholderTextColor={HT.muted} multiline style={styles.textarea} textAlignVertical="top" testID="neo-text-input" />
        <Pressable onPress={sendText} disabled={!!busy} style={[styles.btn, (!text.trim() || !!busy) && styles.btnDim]} testID="neo-text-send">
          {busy === "text" ? <ActivityIndicator color="#FFF" size="small" /> : <Ionicons name="paper-plane" size={16} color="#FFF" />}<Text style={styles.btnTxt}>{busy === "text" ? "Neo sta leggendo…" : "Invia a Neo"}</Text>
        </Pressable>
      </View>

      {/* 2 · File */}
      <View style={styles.card}>
        <View style={styles.cardHead}><Ionicons name="document-attach" size={18} color={PURPLE} /><Text style={styles.cardTitle}>Carica un file</Text><Text style={styles.cardHint}>CV, documenti, foto, presentazioni · max 50 MB</Text></View>
        {picked ? (
          <View style={styles.fileRow} testID="neo-file-picked">
            <Ionicons name="document" size={20} color={PURPLE} />
            <View style={{ flex: 1 }}><Text style={styles.fileName} numberOfLines={1}>{picked.name}</Text><Text style={styles.fileMeta}>{fmtSize(picked.size)}</Text></View>
            <Pressable onPress={() => setPicked(null)} hitSlop={8} disabled={busy === "file"} testID="neo-file-remove"><Ionicons name="close-circle" size={22} color={HT.muted} /></Pressable>
          </View>
        ) : null}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable onPress={pickFile} disabled={!!busy} style={[styles.btn, styles.btnAlt, { flex: 1 }]} testID="neo-file-pick"><Ionicons name="folder-open" size={16} color={PURPLE} /><Text style={[styles.btnTxt, { color: PURPLE }]}>{picked ? "Cambia file" : "Scegli file"}</Text></Pressable>
          {picked && (
            <Pressable onPress={sendFile} disabled={!!busy} style={[styles.btn, { flex: 1 }, !!busy && styles.btnDim]} testID="neo-file-send">
              {busy === "file" ? <ActivityIndicator color="#FFF" size="small" /> : <Ionicons name="cloud-upload" size={16} color="#FFF" />}<Text style={styles.btnTxt}>{busy === "file" ? "Carico…" : "Invia a Neo"}</Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* 3 · Audio */}
      <View style={styles.card}>
        <View style={styles.cardHead}><Ionicons name="mic" size={18} color={PURPLE} /><Text style={styles.cardTitle}>Parla con la voce</Text><Text style={styles.cardHint}>Trascritto da Whisper, capito da Neo</Text></View>
        <Pressable onPress={() => (rec ? void stopRec() : void startRec())} disabled={!!busy && !rec} style={[styles.btn, rec && { backgroundColor: '#DC2626' }, !!busy && !rec && styles.btnDim]} testID="neo-audio-btn">
          {busy === "audio" ? <ActivityIndicator color="#FFF" size="small" /> : <Ionicons name={rec ? "stop" : "mic"} size={16} color="#FFF" />}
          <Text style={styles.btnTxt}>{busy === "audio" ? "Neo sta ascoltando…" : rec ? `Ferma · ${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}` : "Registra"}</Text>
        </Pressable>
        {!!transcript && <Text style={styles.transcript} testID="neo-transcript">🗣️ “{transcript}”</Text>}
        <Text style={styles.cardHint}>File e audio vengono letti in background: puoi continuare subito.</Text>
      </View>

      {!!error && <Text style={styles.err} testID="neo-error">{error}</Text>}
      {reading.length > 0 && (
        <View style={styles.readingPill} testID="neo-reading">
          <ActivityIndicator size="small" color={PURPLE} />
          <Text style={styles.readingTxt}>AxonOS sta leggendo i tuoi file… puoi continuare, ti propongo io cosa ho trovato.</Text>
        </View>
      )}

      {/* Cosa ha capito Neo */}
      {summaries.length > 0 && (
        <View style={styles.neoBox} testID="neo-summary">
          <Text style={styles.neoTitle}>🧠 Neo ha capito</Text>
          <Text style={styles.neoTxt}>{summaries[summaries.length - 1]}</Text>
        </View>
      )}

      {pending.length > 0 && (
        <View style={{ gap: 8 }} testID="neo-proposals">
          <Text style={styles.section}>Proposte · un tap per confermare</Text>
          {pending.map((p) => (
            <View key={p.id} style={[styles.prop, p.field === "primary_email" && styles.propStar]} testID={`neo-prop-${p.id}`}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.propLabel}>{p.field === "primary_email" ? "⭐ " : ""}{p.label}</Text>
                <Text style={styles.propValue}>{p.value}</Text>
                {p.current ? <Text style={styles.propCur}>Attuale: {p.current}</Text> : null}
                {p.why ? <Text style={styles.propWhy}>{p.why}</Text> : null}
              </View>
              <Pressable onPress={() => decide("proposal", p.id, false)} style={styles.noBtn} hitSlop={6} testID={`neo-prop-no-${p.id}`}><Ionicons name="close" size={18} color={HT.muted} /></Pressable>
              <Pressable onPress={() => decide("proposal", p.id, true)} style={styles.yesBtn} hitSlop={6} testID={`neo-prop-yes-${p.id}`}><Ionicons name="checkmark" size={20} color="#FFF" /></Pressable>
            </View>
          ))}
        </View>
      )}
      {pendingFacts.length > 0 && (
        <View style={{ gap: 8 }} testID="neo-facts">
          <Text style={styles.section}>Neo ha imparato · conferma cosa è vero</Text>
          {pendingFacts.map((f) => (
            <View key={f.id} style={styles.prop} testID={`neo-fact-${f.id}`}>
              <Text style={[styles.propValue, { flex: 1, fontSize: 13.5 }]}>{f.text}</Text>
              <Pressable onPress={() => decide("fact", f.id, false)} style={styles.noBtn} hitSlop={6} testID={`neo-fact-no-${f.id}`}><Ionicons name="close" size={18} color={HT.muted} /></Pressable>
              <Pressable onPress={() => decide("fact", f.id, true)} style={styles.yesBtn} hitSlop={6} testID={`neo-fact-yes-${f.id}`}><Ionicons name="checkmark" size={20} color="#FFF" /></Pressable>
            </View>
          ))}
        </View>
      )}
      {decidedN > 0 && pending.length === 0 && <Text style={styles.doneTxt} testID="neo-all-decided">✓ {decidedN} {decidedN === 1 ? "proposta gestita" : "proposte gestite"}: i campi dell'app sono aggiornati.</Text>}

      {/* V50.z217 — privacy, sempre visibile prima del tasto «Completa» */}
      <PrivacyNote />

      {/* Popup «file incompleto» */}
      <Modal visible={askIncomplete} transparent animationType="fade" onRequestClose={() => answer(false)}>
        <View style={styles.backdrop}><View style={styles.sheet} testID="neo-incomplete-popup">
          <Text style={styles.sheetTitle}>Vuoi inviare così com'è o completare?</Text>
          <Text style={styles.sheetSub}>
            {stateRef.current.rec || stateRef.current.busy || stateRef.current.reading.length ? "AxonOS sta ancora leggendo o ricevendo qualcosa. " : ""}
            {stateRef.current.text.trim() ? "Hai un testo non ancora inviato a Neo. " : ""}
            {stateRef.current.picked ? "Hai un file scelto ma non caricato. " : ""}
            {pending.length + pendingFacts.length > 0 ? `Ci sono ${pending.length + pendingFacts.length} proposte senza risposta.` : ""}
          </Text>
          <Pressable onPress={() => answer(false)} style={styles.sheetPrimary} testID="neo-incomplete-complete"><Ionicons name="create" size={18} color="#FFF" /><Text style={styles.sheetPrimaryTxt}>Completa</Text></Pressable>
          <Pressable onPress={() => answer(true)} style={styles.sheetSecondary} testID="neo-incomplete-send"><Text style={styles.sheetSecondaryTxt}>Invia così com'è</Text></Pressable>
        </View></View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  lead: { fontSize: 13.5, color: HT.text2, lineHeight: 19 },
  card: { backgroundColor: HT.card2, borderRadius: 16, padding: 12, gap: 10, borderWidth: 1, borderColor: HT.border },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  cardTitle: { fontSize: 15, fontWeight: "900", color: HT.text },
  cardHint: { fontSize: 11, color: HT.muted, flexBasis: "100%" },
  textarea: { minHeight: 110, maxHeight: 220, backgroundColor: HT.card, borderRadius: 12, borderWidth: 1, borderColor: HT.border, padding: 12, fontSize: 15, color: HT.text, lineHeight: 21 },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: PURPLE, borderRadius: 12, minHeight: 46, paddingHorizontal: 14 },
  btnAlt: { backgroundColor: HT.card, borderWidth: 1.5, borderColor: PURPLE },
  btnDim: { opacity: 0.55 },
  btnTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
  fileRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: HT.card, borderRadius: 12, padding: 10, borderWidth: 1, borderColor: HT.violet + '66' },
  fileName: { fontSize: 13.5, fontWeight: "700", color: HT.text },
  fileMeta: { fontSize: 11.5, color: HT.muted },
  transcript: { fontSize: 12.5, color: HT.text2, fontStyle: "italic", lineHeight: 17 },
  err: { fontSize: 12.5, color: "#DC2626", fontWeight: "700" },
  readingPill: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: HT.violetTint, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: HT.violet + '66' },
  readingTxt: { flex: 1, fontSize: 12.5, fontWeight: "700", color: HT.violet },
  neoBox: { backgroundColor: HT.violetTint, borderRadius: 14, padding: 12, gap: 4, borderWidth: 1, borderColor: HT.violet + '66' },
  neoTitle: { fontSize: 12.5, fontWeight: "900", color: HT.violet },
  neoTxt: { fontSize: 13.5, color: HT.text, lineHeight: 19 },
  section: { fontSize: 12, fontWeight: "800", color: PURPLE, textTransform: "uppercase", letterSpacing: 0.6 },
  prop: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: HT.card, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: HT.border },
  propStar: { borderColor: '#F59E0B', backgroundColor: HT.warningTint },
  propLabel: { fontSize: 11.5, fontWeight: "800", color: HT.muted, textTransform: "uppercase" },
  propValue: { fontSize: 15, fontWeight: "700", color: HT.text },
  propCur: { fontSize: 11.5, color: HT.warning },
  propWhy: { fontSize: 11.5, color: HT.muted },
  yesBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#059669', alignItems: "center", justifyContent: "center" },
  noBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: HT.card2, alignItems: "center", justifyContent: "center" },
  doneTxt: { fontSize: 12.5, color: "#059669", fontWeight: "700" },
  backdrop: { flex: 1, backgroundColor: "rgba(15,23,42,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: HT.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 32, gap: 12 },
  sheetTitle: { fontSize: 18, fontWeight: "900", color: HT.text },
  sheetSub: { fontSize: 13, color: HT.muted, lineHeight: 18 },
  sheetPrimary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: PURPLE, borderRadius: 14, minHeight: 50 },
  sheetPrimaryTxt: { color: "#FFF", fontWeight: "900", fontSize: 15 },
  sheetSecondary: { alignItems: "center", justifyContent: "center", minHeight: 48, borderRadius: 14, borderWidth: 1.5, borderColor: HT.borderStrong },
  sheetSecondaryTxt: { color: HT.text, fontWeight: "800", fontSize: 15 },
});

import React, { useCallback, useEffect, useState, useRef } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, Image, Platform, Modal } from "react-native";
import { KScrollView } from "@/src/ui/keyboard"; // V50.z374 — tastiera: campo attivo sempre visibile
import { SafeAreaView } from "react-native-safe-area-context";
import { AndroidKeyboardPadding } from "@/src/keyboard/AndroidKeyboardPadding"; // V50.z186 — tastiera Android dentro Modal
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import DateTimePicker from "@react-native-community/datetimepicker";
import { AudioModule, useAudioRecorder, useAudioPlayer, RecordingPresets } from "expo-audio";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { notify, confirmAsync } from "@/src/utils/notify";
import { uriToBase64 } from "@/src/utils/media";
import { launchLibraryUniversal } from "@/src/utils/imagePickerCompat";
import { ModuleErrorBoundary } from "@/src/shared";

import { useBottomSheetPadding } from "@/src/utils/bottomSheetInsets";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium
import { acquireMicLease } from "@/src/utils/micLease"; // V50.z483 — pausa wake-word mentre si registra
import { ensureDevicePermission } from "@/src/permissions/devicePermissions"; // V50.z484 — alert permesso di sistema mancante
let _micRelease: null | (() => void) = null;
// ---------- Types ----------
type EventBanner = {
  event_id: string;
  title: string;
  event_at: string;
  cover_mime?: string;
  visibility_kind: "all" | "specific";
  visible_user_ids?: string[];
  visible_contact_ids?: string[];
  visible_group_ids?: string[];
  public_token?: string;
  created_at?: string;
};

type TeamMember = { user_id: string; name: string; email?: string; role?: string };
type ContactLite = { contact_id: string; first_name: string; last_name: string };
type GroupLite = { group_id: string; name: string };

// ---------- Route ----------
export default function EventBannersRoute() {
  return (
    <ModuleErrorBoundary moduleName="events">
      <EventBannersScreen />
    </ModuleErrorBoundary>
  );
}

function EventBannersScreen() {
  const router = useRouter();
  const [items, setItems] = useState<EventBanner[]>([]);
  const bottomPad = useBottomSheetPadding();
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<null | Partial<EventBanner> & { cover_base64?: string; program_pdf_base64?: string; program_pdf_name?: string }>(null);

  // Options
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [contacts, setContacts] = useState<ContactLite[]>([]);
  const [groups, setGroups] = useState<GroupLite[]>([]);

  // Form state (mirrors `editing`)
  const [title, setTitle] = useState("");
  const [dateStr, setDateStr] = useState(""); // yyyy-mm-dd
  const [timeStr, setTimeStr] = useState(""); // HH:mm
  // v2.18 — optional end date/time
  const [endDateStr, setEndDateStr] = useState("");
  const [endTimeStr, setEndTimeStr] = useState("");
  const [description, setDescription] = useState(""); // v2.18
  const [cover, setCover] = useState<{ base64: string; mime: string } | null>(null);
  const [visibilityKind, setVisibilityKind] = useState<"all" | "specific">("all");
  const [selUsers, setSelUsers] = useState<Set<string>>(new Set());
  const [selContacts, setSelContacts] = useState<Set<string>>(new Set());
  const [selGroups, setSelGroups] = useState<Set<string>>(new Set());
  const [programPdf, setProgramPdf] = useState<{ base64: string; name: string } | null>(null);
  const [aiDesc, setAiDesc] = useState("");
  const [aiDuration, setAiDuration] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  // v2.18 — Audio attachment (record or upload)
  const [audio, setAudio] = useState<{ base64: string; name: string; mime: string } | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const audioPlayer = useAudioPlayer(audio ? `data:${audio.mime};base64,${audio.base64}` : undefined);
  const recSecRef = useRef<any>(null);
  // v2.18 — Native DateTimePicker triggers
  const [dtPicker, setDtPicker] = useState<null | { field: "start-date" | "start-time" | "end-date" | "end-time"; value: Date }>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: EventBanner[] }>("/event-banners");
      setItems(r.items || []);
    } catch (e: any) {
      notify("Errore", e?.message || "");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = async () => {
    setTitle(""); setDateStr(""); setTimeStr(""); setEndDateStr(""); setEndTimeStr("");
    setDescription(""); setCover(null); setAudio(null);
    setVisibilityKind("all");
    setSelUsers(new Set()); setSelContacts(new Set()); setSelGroups(new Set());
    setProgramPdf(null); setAiDesc(""); setAiDuration("");
    setEditing({});
    // Load options in parallel
    try {
      const [tm, ct, gr] = await Promise.all([
        api<{ items: TeamMember[] }>("/team/members").catch(() => ({ items: [] })),
        api<{ items: ContactLite[] }>("/contacts").catch(() => ({ items: [] })),
        api<{ items: GroupLite[] }>("/groups").catch(() => ({ items: [] })),
      ]);
      setTeam(tm.items || []);
      setContacts(ct.items || []);
      setGroups(gr.items || []);
    } catch {}
  };

  const openEdit = async (b: EventBanner) => {
    // Fetch full (with cover base64)
    try {
      const full = await api<any>(`/event-banners/${b.event_id}`);
      setTitle(full.title || "");
      const dt = new Date(full.event_at);
      const y = dt.getFullYear(), m = String(dt.getMonth() + 1).padStart(2, "0"), d = String(dt.getDate()).padStart(2, "0");
      const hh = String(dt.getHours()).padStart(2, "0"), mm = String(dt.getMinutes()).padStart(2, "0");
      // v2.13 — Show dates in Italian format DD.MM.YYYY / HH:MM (matches placeholders)
      setDateStr(`${d}.${m}.${y}`);
      setTimeStr(`${hh}:${mm}`);
      // v2.18 — end date/time (optional)
      if (full.event_end_at) {
        const edt = new Date(full.event_end_at);
        const ey = edt.getFullYear(), em = String(edt.getMonth() + 1).padStart(2, "0"), ed = String(edt.getDate()).padStart(2, "0");
        const ehh = String(edt.getHours()).padStart(2, "0"), emm = String(edt.getMinutes()).padStart(2, "0");
        setEndDateStr(`${ed}.${em}.${ey}`);
        setEndTimeStr(`${ehh}:${emm}`);
      } else { setEndDateStr(""); setEndTimeStr(""); }
      setDescription(full.description || "");
      // v2.18 — audio: fetch lazily only if the event has one, keep null otherwise
      setAudio(null);
      if (full.has_audio) {
        try {
          const a = await api<{ name: string; mime: string; data_base64: string }>(`/event-banners/${b.event_id}/audio`);
          setAudio({ base64: a.data_base64, name: a.name, mime: a.mime });
        } catch {}
      }
      setCover(full.cover_base64 ? { base64: full.cover_base64, mime: full.cover_mime || "image/jpeg" } : null);
      setVisibilityKind(full.visibility_kind || "all");
      setSelUsers(new Set(full.visible_user_ids || []));
      setSelContacts(new Set(full.visible_contact_ids || []));
      setSelGroups(new Set(full.visible_group_ids || []));
      setProgramPdf(full.program_pdf_base64 ? { base64: full.program_pdf_base64, name: full.program_pdf_name || "programma.pdf" } : null);
      setEditing({ event_id: full.event_id });
      const [tm, ct, gr] = await Promise.all([
        api<{ items: TeamMember[] }>("/team/members").catch(() => ({ items: [] })),
        api<{ items: ContactLite[] }>("/contacts").catch(() => ({ items: [] })),
        api<{ items: GroupLite[] }>("/groups").catch(() => ({ items: [] })),
      ]);
      setTeam(tm.items || []); setContacts(ct.items || []); setGroups(gr.items || []);
    } catch (e: any) {
      notify("Errore", e?.message || "");
    }
  };

  const pickCover = async () => {
    try {
      const res = await launchLibraryUniversal({ mediaTypes: "images", allowsEditing: true, quality: 0.85, base64: true, aspect: [16, 9] });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      let b64 = (a as any).base64 as string | undefined;
      if (!b64) b64 = await uriToBase64(a.uri);
      if (!b64) { notify("Errore", "Impossibile leggere l'immagine"); return; }
      const bytes = Math.round((b64.length * 3) / 4);
      if (bytes > 6 * 1024 * 1024) {
        notify("Immagine troppo grande", "Massimo 6MB. Riduci la qualità o ritaglia.");
        return;
      }
      setCover({ base64: b64, mime: (a as any).mimeType || "image/jpeg" });
    } catch (e: any) {
      notify("Errore", e?.message || "");
    }
  };

  const pickProgramPdf = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: "application/pdf", multiple: false, copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      const b64 = await uriToBase64(a.uri);
      const bytes = Math.round((b64.length * 3) / 4);
      if (bytes > 10 * 1024 * 1024) { notify("PDF troppo grande", "Max 10MB."); return; }
      setProgramPdf({ base64: b64, name: a.name || "programma.pdf" });

      // v2.11 — Auto-extract the most significant image from the PDF and use
      // it as banner cover — but only if the event is already saved AND the
      // user hasn't already picked a cover manually (avoid overriding intent).
      if (editing?.event_id && !cover?.base64) {
        try {
          // Persist the PDF first so the extractor can access it
          await api(`/event-banners/${editing.event_id}`, {
            method: "PUT",
            body: { program_pdf_base64: b64, program_pdf_name: a.name || "programma.pdf" },
          });
          const r = await api<{ cover_base64: string; cover_mime: string }>(
            `/event-banners/${editing.event_id}/extract-cover-from-pdf`,
            { method: "POST", body: { apply: true } },
          );
          if (r?.cover_base64) {
            setCover({ base64: r.cover_base64, mime: r.cover_mime || "image/jpeg" });
            notify("Copertina generata ✅", "L'AI ha estratto l'immagine più significativa dal PDF come copertina.");
          }
        } catch (e: any) {
          // Non-blocking — user can still choose a cover manually
          console.warn("PDF cover extraction failed:", e?.message);
        }
      }
    } catch (e: any) {
      notify("Errore", e?.message || "");
    }
  };

  const extractCoverFromPdfNow = async () => {
    if (!editing?.event_id) {
      notify("Salva prima l'evento", "Prima crea l'evento e carica il PDF, poi estrai la copertina.");
      return;
    }
    if (!programPdf) {
      notify("PDF mancante", "Carica prima il PDF del programma per estrarre la copertina.");
      return;
    }
    try {
      const r = await api<{ cover_base64: string; cover_mime: string }>(
        `/event-banners/${editing.event_id}/extract-cover-from-pdf`,
        { method: "POST", body: { apply: true } },
      );
      if (r?.cover_base64) {
        setCover({ base64: r.cover_base64, mime: r.cover_mime || "image/jpeg" });
        notify("Copertina aggiornata ✅", "L'immagine più significativa del PDF è ora la copertina.");
      }
    } catch (e: any) {
      notify("Estrazione fallita", e?.message || "Il PDF potrebbe non contenere immagini estraibili.");
    }
  };

  const runAiProgram = async () => {
    if (!editing?.event_id) { notify("Salva prima l'evento", "Prima crea l'evento, poi genera il programma con AI."); return; }
    setAiBusy(true);
    try {
      await api(`/event-banners/${editing.event_id}/generate-program`, {
        method: "POST",
        body: { description: aiDesc.trim(), duration_hint: aiDuration.trim() || null },
      });
      notify("Programma generato ✅", "Il programma AI è stato salvato sull'evento.");
    } catch (e: any) {
      notify("Errore AI", e?.message || "");
    } finally { setAiBusy(false); }
  };

  // v2.13 — Parse Italian date/time formats: DD.MM.YYYY (or DD/MM/YYYY, DD-MM-YYYY)
  // and HH.MM (or HH:MM). Accepts also the ISO short form YYYY-MM-DD for backwards compat.
  // Returns an ISO 8601 UTC string or null if invalid.
  const parseItalianDateTime = (d: string, t: string): string | null => {
    const dTrim = (d || "").trim();
    const tTrim = (t || "").trim();
    if (!dTrim || !tTrim) return null;

    // Parse date: accept 27.08.2036 | 27/08/2036 | 27-08-2036 | 2036-08-27
    let day: number, month: number, year: number;
    const isoMatch = dTrim.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    const itMatch = dTrim.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
    if (isoMatch) {
      year = parseInt(isoMatch[1], 10);
      month = parseInt(isoMatch[2], 10);
      day = parseInt(isoMatch[3], 10);
    } else if (itMatch) {
      day = parseInt(itMatch[1], 10);
      month = parseInt(itMatch[2], 10);
      year = parseInt(itMatch[3], 10);
      if (year < 100) year += 2000; // 2-digit year → 20xx
    } else {
      return null;
    }

    // Parse time: accept 20.30 | 20:30 | 20,30
    const timeMatch = tTrim.match(/^(\d{1,2})[.:,]?(\d{2})$/);
    if (!timeMatch) return null;
    const hours = parseInt(timeMatch[1], 10);
    const minutes = parseInt(timeMatch[2], 10);

    // Validate ranges
    if (
      year < 1970 || year > 3000 ||
      month < 1 || month > 12 ||
      day < 1 || day > 31 ||
      hours < 0 || hours > 23 ||
      minutes < 0 || minutes > 59
    ) return null;

    const dt = new Date(year, month - 1, day, hours, minutes, 0, 0);
    if (isNaN(dt.getTime())) return null;
    // Sanity re-check (e.g. 31 feb → JS wraps; verify components round-trip)
    if (
      dt.getFullYear() !== year ||
      dt.getMonth() !== month - 1 ||
      dt.getDate() !== day
    ) return null;
    return dt.toISOString();
  };

  const save = async () => {
    if (!title.trim()) { notify("Titolo mancante", "Inserisci un titolo per l'evento."); return; }
    if (!dateStr || !timeStr) { notify("Data mancante", "Inserisci data e ora dell'evento."); return; }
    if (!cover?.base64 && !editing?.event_id) { notify("Copertina mancante", "Carica un'immagine di copertina."); return; }
    const iso = parseItalianDateTime(dateStr, timeStr);
    if (!iso) {
      notify("Data o ora non valida", "Usa il formato GG.MM.AAAA (es. 27.08.2036) e HH:MM (es. 20:30).");
      return;
    }
    // v2.18 — parse optional end date/time
    let endIso: string | null = null;
    if (endDateStr || endTimeStr) {
      endIso = parseItalianDateTime(endDateStr || dateStr, endTimeStr || timeStr);
      if (!endIso) { notify("Data fine non valida", "Usa GG.MM.AAAA e HH:MM anche per la data fine."); return; }
      if (new Date(endIso).getTime() < new Date(iso).getTime()) {
        notify("Range non valido", "La data fine deve essere dopo la data inizio.");
        return;
      }
    }
    setSaving(true);
    try {
      const body: any = {
        title: title.trim(),
        event_at: iso,
        event_end_at: endIso,  // v2.18
        description: description.trim() || null,  // v2.18
        visibility_kind: visibilityKind,
        visible_user_ids: Array.from(selUsers),
        visible_contact_ids: Array.from(selContacts),
        visible_group_ids: Array.from(selGroups),
      };
      if (cover?.base64) { body.cover_base64 = cover.base64; body.cover_mime = cover.mime; }
      if (programPdf) { body.program_pdf_base64 = programPdf.base64; body.program_pdf_name = programPdf.name; }
      if (audio) {  // v2.18
        body.audio_base64 = audio.base64;
        body.audio_mime = audio.mime;
        body.audio_name = audio.name;
      }

      if (editing?.event_id) {
        await api(`/event-banners/${editing.event_id}`, { method: "PUT", body });
      } else {
        const r = await api<{ event_id: string }>("/event-banners", { method: "POST", body });
        // Set the new event_id so AI generate button becomes active
        setEditing({ event_id: r.event_id });
      }
      await load();
      notify("Evento salvato ✅", "L'evento è ora visibile nei destinatari selezionati.");
      if (!editing?.event_id) return; // stay in modal so user can generate AI program
      setEditing(null);
    } catch (e: any) {
      notify("Errore salvataggio", e?.message || "");
    } finally { setSaving(false); }
  };

  const del = async (b: EventBanner) => {
    const ok = await confirmAsync("Elimina evento", `Vuoi eliminare "${b.title}"? L'operazione è irreversibile.`);
    if (!ok) return;
    try {
      await api(`/event-banners/${b.event_id}`, { method: "DELETE" });
      await load();
    } catch (e: any) { notify("Errore", e?.message || ""); }
  };

  // v2.18 — Audio: start recording (native only; on web, prompt to upload)
  const startRec = async () => {
    if (Platform.OS === "web") {
      notify("Registrazione non disponibile", "Su web, usa 'Carica audio' per allegare un file esistente.");
      return;
    }
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        notify("Permesso negato", "Autorizza l'accesso al microfono nelle impostazioni.");
        return;
      }
      await AudioModule.setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      if (!(await ensureDevicePermission("microphone"))) return; // V50.z484
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record(); _micRelease?.(); _micRelease = acquireMicLease(); // V50.z483
      setRecording(true);
      setRecordSeconds(0);
      recSecRef.current = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    } catch (e: any) {
      notify("Errore registrazione", e?.message || "");
    }
  };

  const stopRec = async () => {
    if (recSecRef.current) { clearInterval(recSecRef.current); recSecRef.current = null; }
    try {
      await audioRecorder.stop(); _micRelease?.(); _micRelease = null; // V50.z483
      setRecording(false);
      const uri = audioRecorder.uri;
      if (!uri) return;
      const b64 = await uriToBase64(uri);
      const bytes = Math.round((b64.length * 3) / 4);
      if (bytes > 20 * 1024 * 1024) {
        notify("Audio troppo lungo", "La registrazione supera i 20MB. Registra un audio più breve.");
        return;
      }
      setAudio({ base64: b64, name: `registrazione-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.m4a`, mime: "audio/mp4" });
    } catch (e: any) {
      setRecording(false);
      notify("Errore stop", e?.message || "");
    }
  };

  const pickAudioFile = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ["audio/mpeg", "audio/mp4", "audio/m4a", "audio/wav", "audio/x-wav", "audio/aac", "audio/ogg", "audio/*"],
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      const b64 = await uriToBase64(a.uri);
      const bytes = Math.round((b64.length * 3) / 4);
      if (bytes > 20 * 1024 * 1024) { notify("File troppo grande", "Max 20 MB per l'audio."); return; }
      setAudio({ base64: b64, name: a.name || "audio.mp3", mime: a.mimeType || "audio/mpeg" });
    } catch (e: any) {
      notify("Errore", e?.message || "");
    }
  };

  const clearAudio = async () => {
    const ok = await confirmAsync("Rimuovi audio", "Vuoi rimuovere l'audio allegato?");
    if (!ok) return;
    try { audioPlayer?.pause(); } catch {}
    setAudio(null);
  };

  const togglePlayAudio = () => {
    if (!audio) return;
    try {
      if (audioPlayer.playing) audioPlayer.pause();
      else { audioPlayer.seekTo(0); audioPlayer.play(); }
    } catch (e: any) {
      notify("Errore riproduzione", e?.message || "");
    }
  };

  // v2.18 — DateTimePicker helpers (native + web fallback to text input)
  const parseCurrentDT = (dStr: string, tStr: string): Date => {
    const iso = parseItalianDateTime(dStr || `01.01.${new Date().getFullYear()}`, tStr || "09:00");
    return iso ? new Date(iso) : new Date();
  };

  const openDtPicker = (field: "start-date" | "start-time" | "end-date" | "end-time") => {
    if (Platform.OS === "web") return; // web falls back to plain TextInput
    const isEnd = field.startsWith("end");
    setDtPicker({ field, value: parseCurrentDT(isEnd ? endDateStr : dateStr, isEnd ? endTimeStr : timeStr) });
  };

  const onDtChange = (event: any, selected?: Date) => {
    // Android auto-dismisses; iOS keeps modal open until user taps Done
    if (Platform.OS === "android") setDtPicker(null);
    if (event?.type === "dismissed" || !selected) return;
    if (!dtPicker) return;
    const y = selected.getFullYear(), m = String(selected.getMonth() + 1).padStart(2, "0"), d = String(selected.getDate()).padStart(2, "0");
    const hh = String(selected.getHours()).padStart(2, "0"), mm = String(selected.getMinutes()).padStart(2, "0");
    if (dtPicker.field === "start-date") setDateStr(`${d}.${m}.${y}`);
    else if (dtPicker.field === "start-time") setTimeStr(`${hh}:${mm}`);
    else if (dtPicker.field === "end-date") setEndDateStr(`${d}.${m}.${y}`);
    else if (dtPicker.field === "end-time") setEndTimeStr(`${hh}:${mm}`);
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable testID="back-btn" onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={HT.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Banner Evento</Text>
        <Pressable testID="event-add-btn" onPress={openCreate} hitSlop={10}>
          <Ionicons name="add-circle" size={26} color={HT.brand} />
        </Pressable>
      </View>

      <KScrollView contentContainerStyle={{ padding: 16, paddingBottom: 140 }}>
        <View style={styles.introCard}>
          <Ionicons name="megaphone" size={22} color="#F59E0B" />
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={styles.introTitle}>Banner Evento</Text>
            <Text style={styles.introTxt}>Crea eventi con copertina, data e programma. Appariranno nella home dei destinatari selezionati con countdown live e link al programma condivisibile.</Text>
          </View>
        </View>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 20 }} color={HT.brand} />
        ) : items.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="calendar-outline" size={40} color={HT.muted} />
            <Text style={styles.emptyTxt}>Nessun evento creato. Tocca + in alto a destra per iniziare.</Text>
          </View>
        ) : (
          items.map((b) => {
            const when = new Date(b.event_at);
            const past = when.getTime() < Date.now();
            return (
              <View key={b.event_id} style={styles.card} testID={`event-card-${b.event_id}`}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle} numberOfLines={1}>{b.title}</Text>
                  <Text style={styles.cardWhen}>
                    {when.toLocaleString("it-IT", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </Text>
                  <View style={{ flexDirection: "row", gap: 6, marginTop: 6 }}>
                    <View style={[styles.pill, past ? { backgroundColor: HT.dangerTint } : { backgroundColor: HT.successTint }]}>
                      <Text style={[styles.pillTxt, past ? { color: HT.danger } : { color: HT.success }]}>
                        {past ? "Passato" : "Prossimo"}
                      </Text>
                    </View>
                    <View style={[styles.pill, { backgroundColor: HT.violetTint }]}>
                      <Text style={[styles.pillTxt, { color: HT.axon }]}>
                        {b.visibility_kind === "all" ? "Tutti" : "Selezione"}
                      </Text>
                    </View>
                  </View>
                </View>
                <View style={{ flexDirection: "row", gap: 6 }}>
                  <Pressable testID={`event-edit-${b.event_id}`} onPress={() => openEdit(b)} style={styles.iconBtn}>
                    <Ionicons name="pencil" size={16} color={HT.brand} />
                  </Pressable>
                  <Pressable testID={`event-del-${b.event_id}`} onPress={() => del(b)} style={styles.iconBtn}>
                    <Ionicons name="trash" size={16} color="#DC2626" />
                  </Pressable>
                </View>
              </View>
            );
          })
        )}
      </KScrollView>

      {/* Create/Edit modal */}
      <Modal visible={!!editing} animationType="slide" transparent onRequestClose={() => setEditing(null)}>
        <AndroidKeyboardPadding><View style={styles.modalBack}>
          <View style={[styles.modalCard, { paddingBottom: bottomPad }]}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>{editing?.event_id ? "Modifica evento" : "Nuovo evento"}</Text>
              <Pressable onPress={() => setEditing(null)} hitSlop={8}>
                <Ionicons name="close" size={22} color={HT.text} />
              </Pressable>
            </View>

            <KScrollView style={{ maxHeight: 560 }} contentContainerStyle={{ padding: 14, paddingBottom: 140 }}>
              {/* Cover */}
              <Text style={styles.lbl}>Copertina</Text>
              <Pressable testID="event-cover-pick" onPress={pickCover} style={styles.coverBox}>
                {cover?.base64 ? (
                  <Image
                    source={{ uri: `data:${cover.mime};base64,${cover.base64}` }}
                    style={StyleSheet.absoluteFill}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={styles.coverEmpty}>
                    <Ionicons name="image-outline" size={30} color={HT.muted} />
                    <Text style={{ color: HT.muted, fontSize: 12, marginTop: 4 }}>Tocca per scegliere</Text>
                  </View>
                )}
              </Pressable>

              {/* Title */}
              <Text style={styles.lbl}>Titolo</Text>
              <TextInput
                testID="event-title"
                value={title}
                onChangeText={setTitle}
                placeholder="Es. Convention 2026, Aperitivo Rete…"
                placeholderTextColor={HT.muted}
                style={styles.input}
              />

              {/* Date + time (inizio + fine opzionale) — v2.18 native DateTimePicker */}
              <Text style={styles.lbl}>Data inizio</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Pressable
                    testID="event-date-picker"
                    onPress={() => openDtPicker("start-date")}
                    style={[styles.input, { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]}
                  >
                    <Text style={{ color: dateStr ? HT.text : HT.muted, fontSize: 13 }}>
                      {dateStr || "GG.MM.AAAA"}
                    </Text>
                    <Ionicons name="calendar-outline" size={16} color={HT.muted} />
                  </Pressable>
                  {Platform.OS === "web" && (
                    <TextInput
                      testID="event-date"
                      value={dateStr}
                      onChangeText={setDateStr}
                      placeholder="GG.MM.AAAA"
                      placeholderTextColor={HT.muted}
                      style={[styles.input, { marginTop: 4 }]}
                    />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Pressable
                    testID="event-time-picker"
                    onPress={() => openDtPicker("start-time")}
                    style={[styles.input, { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]}
                  >
                    <Text style={{ color: timeStr ? HT.text : HT.muted, fontSize: 13 }}>
                      {timeStr || "HH:MM"}
                    </Text>
                    <Ionicons name="time-outline" size={16} color={HT.muted} />
                  </Pressable>
                  {Platform.OS === "web" && (
                    <TextInput
                      testID="event-time"
                      value={timeStr}
                      onChangeText={setTimeStr}
                      placeholder="HH:MM"
                      placeholderTextColor={HT.muted}
                      style={[styles.input, { marginTop: 4 }]}
                    />
                  )}
                </View>
              </View>

              <Text style={styles.lbl}>Data fine (opzionale — per eventi multi-giorno)</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Pressable
                    testID="event-end-date-picker"
                    onPress={() => openDtPicker("end-date")}
                    style={[styles.input, { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]}
                  >
                    <Text style={{ color: endDateStr ? HT.text : HT.muted, fontSize: 13 }}>
                      {endDateStr || "GG.MM.AAAA"}
                    </Text>
                    <Ionicons name="calendar-outline" size={16} color={HT.muted} />
                  </Pressable>
                  {Platform.OS === "web" && (
                    <TextInput
                      testID="event-end-date"
                      value={endDateStr}
                      onChangeText={setEndDateStr}
                      placeholder="GG.MM.AAAA"
                      placeholderTextColor={HT.muted}
                      style={[styles.input, { marginTop: 4 }]}
                    />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Pressable
                    testID="event-end-time-picker"
                    onPress={() => openDtPicker("end-time")}
                    style={[styles.input, { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]}
                  >
                    <Text style={{ color: endTimeStr ? HT.text : HT.muted, fontSize: 13 }}>
                      {endTimeStr || "HH:MM"}
                    </Text>
                    <Ionicons name="time-outline" size={16} color={HT.muted} />
                  </Pressable>
                  {Platform.OS === "web" && (
                    <TextInput
                      testID="event-end-time"
                      value={endTimeStr}
                      onChangeText={setEndTimeStr}
                      placeholder="HH:MM"
                      placeholderTextColor={HT.muted}
                      style={[styles.input, { marginTop: 4 }]}
                    />
                  )}
                </View>
                {(endDateStr || endTimeStr) && (
                  <Pressable
                    testID="event-end-clear"
                    onPress={() => { setEndDateStr(""); setEndTimeStr(""); }}
                    style={[styles.input, { paddingHorizontal: 10, justifyContent: "center", alignItems: "center", flex: 0 }]}
                  >
                    <Ionicons name="close-circle" size={18} color="#DC2626" />
                  </Pressable>
                )}
              </View>

              {/* v2.18 — Descrizione libera */}
              <Text style={styles.lbl}>Descrizione evento</Text>
              <TextInput
                testID="event-description"
                value={description}
                onChangeText={setDescription}
                placeholder="Aggiungi dettagli, temi, relatori, dress code o istruzioni…"
                placeholderTextColor={HT.muted}
                style={[styles.input, { minHeight: 80, textAlignVertical: "top" }]}
                multiline
                maxLength={1000}
              />

              {/* v2.18 — Audio attachment */}
              <Text style={styles.lbl}>Audio evento (opzionale — condivisibile con la locandina)</Text>
              {audio ? (
                <View style={{ backgroundColor: HT.card2, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: HT.border }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Pressable
                      testID="event-audio-play"
                      onPress={togglePlayAudio}
                      style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: HT.brand, alignItems: "center", justifyContent: "center" }}
                    >
                      <Ionicons name={audioPlayer?.playing ? "pause" : "play"} size={16} color="#FFF" />
                    </Pressable>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 13, fontWeight: "700", color: HT.text }} numberOfLines={1}>{audio.name}</Text>
                      <Text style={{ fontSize: 11, color: HT.muted }}>{Math.round((audio.base64.length * 3) / 4 / 1024)} KB · {audio.mime}</Text>
                    </View>
                    <Pressable testID="event-audio-clear" onPress={clearAudio} style={{ padding: 6 }}>
                      <Ionicons name="trash-outline" size={18} color="#DC2626" />
                    </Pressable>
                  </View>
                </View>
              ) : (
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {recording ? (
                    <Pressable
                      testID="event-audio-stop"
                      onPress={stopRec}
                      style={[styles.uploadBtn, { flex: 1, borderColor: '#DC2626', backgroundColor: HT.dangerTint }]}
                    >
                      <Ionicons name="stop-circle" size={18} color="#DC2626" />
                      <Text style={[styles.uploadTxt, { color: "#DC2626" }]}>Registrando… {Math.floor(recordSeconds / 60).toString().padStart(2, "0")}:{(recordSeconds % 60).toString().padStart(2, "0")} · Tocca per fermare</Text>
                    </Pressable>
                  ) : (
                    <>
                      {Platform.OS !== "web" && (
                        <Pressable testID="event-audio-record" onPress={startRec} style={[styles.uploadBtn, { flex: 1, borderColor: '#DC2626' }]}>
                          <Ionicons name="mic" size={16} color="#DC2626" />
                          <Text style={[styles.uploadTxt, { color: "#DC2626" }]}>Registra audio</Text>
                        </Pressable>
                      )}
                      <Pressable testID="event-audio-upload" onPress={pickAudioFile} style={[styles.uploadBtn, { flex: 1, borderColor: '#0891B2' }]}>
                        <Ionicons name="cloud-upload-outline" size={16} color="#0891B2" />
                        <Text style={[styles.uploadTxt, { color: "#0891B2" }]}>Carica audio</Text>
                      </Pressable>
                    </>
                  )}
                </View>
              )}

              {/* Visibility */}
              <Text style={styles.lbl}>Visibilità</Text>
              <View style={{ flexDirection: "row", gap: 6, marginBottom: 6 }}>
                <VisibilityChip active={visibilityKind === "all"} label="Tutti" onPress={() => setVisibilityKind("all")} testID="event-vis-all" />
                <VisibilityChip active={visibilityKind === "specific"} label="Solo selezionati" onPress={() => setVisibilityKind("specific")} testID="event-vis-specific" />
              </View>

              {visibilityKind === "specific" && (
                <>
                  {team.length > 0 && (
                    <>
                      <Text style={styles.subLbl}>Collaboratori ({selUsers.size})</Text>
                      <View style={styles.pillRow}>
                        {team.map((m) => {
                          const on = selUsers.has(m.user_id);
                          return (
                            <Pressable
                              key={m.user_id}
                              testID={`event-user-${m.user_id}`}
                              onPress={() => setSelUsers((s) => { const n = new Set(s); on ? n.delete(m.user_id) : n.add(m.user_id); return n; })}
                              style={[styles.chip, on && styles.chipOn]}
                            >
                              <Text style={[styles.chipTxt, on && styles.chipTxtOn]}>{m.name || m.email}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </>
                  )}
                  {groups.length > 0 && (
                    <>
                      <Text style={styles.subLbl}>Gruppi contatti ({selGroups.size})</Text>
                      <View style={styles.pillRow}>
                        {groups.map((g) => {
                          const on = selGroups.has(g.group_id);
                          return (
                            <Pressable
                              key={g.group_id}
                              testID={`event-group-${g.group_id}`}
                              onPress={() => setSelGroups((s) => { const n = new Set(s); on ? n.delete(g.group_id) : n.add(g.group_id); return n; })}
                              style={[styles.chip, on && styles.chipOn]}
                            >
                              <Text style={[styles.chipTxt, on && styles.chipTxtOn]}>{g.name}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </>
                  )}
                  {contacts.length > 0 && (
                    <>
                      <Text style={styles.subLbl}>Contatti singoli ({selContacts.size}) — usa il link pubblico per condividere</Text>
                      <View style={styles.pillRow}>
                        {contacts.slice(0, 60).map((c) => {
                          const on = selContacts.has(c.contact_id);
                          const nm = `${c.first_name} ${c.last_name}`.trim();
                          return (
                            <Pressable
                              key={c.contact_id}
                              testID={`event-contact-${c.contact_id}`}
                              onPress={() => setSelContacts((s) => { const n = new Set(s); on ? n.delete(c.contact_id) : n.add(c.contact_id); return n; })}
                              style={[styles.chip, on && styles.chipOn]}
                            >
                              <Text style={[styles.chipTxt, on && styles.chipTxtOn]}>{nm || "(senza nome)"}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </>
                  )}
                </>
              )}

              {/* Program */}
              <Text style={styles.lbl}>Programma evento</Text>
              <Pressable testID="event-program-pick" onPress={pickProgramPdf} style={[styles.uploadBtn, { borderColor: '#7C3AED' }]}>
                <Ionicons name="cloud-upload-outline" size={16} color="#7C3AED" />
                <Text style={[styles.uploadTxt, { color: "#7C3AED" }]}>
                  {programPdf ? `PDF: ${programPdf.name}` : "Carica PDF del programma"}
                </Text>
              </Pressable>
              {programPdf && (
                <Pressable
                  testID="event-extract-cover-btn"
                  onPress={extractCoverFromPdfNow}
                  style={[styles.uploadBtn, { borderColor: '#F59E0B', backgroundColor: HT.brandTint, paddingVertical: 8 }]}
                >
                  <Ionicons name="sparkles" size={14} color="#F59E0B" />
                  <Text style={[styles.uploadTxt, { color: HT.warning, fontSize: 12 }]}>
                    Estrai copertina dal PDF con AI
                  </Text>
                </Pressable>
              )}

              <Text style={[styles.subLbl, { marginTop: 8 }]}>Oppure genera con AI</Text>
              <TextInput
                testID="event-ai-desc"
                value={aiDesc}
                onChangeText={setAiDesc}
                placeholder="Descrizione libera (es. workshop energie rinnovabili + aperitivo networking)"
                placeholderTextColor={HT.muted}
                multiline
                style={[styles.input, { minHeight: 60, textAlignVertical: "top" }]}
              />
              <TextInput
                testID="event-ai-duration"
                value={aiDuration}
                onChangeText={setAiDuration}
                placeholder="Durata (es. mezza giornata, sera, weekend)"
                placeholderTextColor={HT.muted}
                style={styles.input}
              />
              <Pressable
                testID="event-ai-generate"
                onPress={runAiProgram}
                disabled={aiBusy || !editing?.event_id}
                style={[styles.uploadBtn, { borderColor: '#059669', backgroundColor: editing?.event_id ? "#ECFDF5" : "#F1F5F9", opacity: (!editing?.event_id || aiBusy) ? 0.6 : 1 }]}
              >
                {aiBusy ? (
                  <ActivityIndicator color="#059669" />
                ) : (
                  <>
                    <Ionicons name="sparkles" size={16} color="#059669" />
                    <Text style={[styles.uploadTxt, { color: "#059669" }]}>Genera programma con AI</Text>
                  </>
                )}
              </Pressable>
              {!editing?.event_id && (
                <Text style={{ fontSize: 11, color: HT.muted, marginTop: 4, fontStyle: "italic" }}>
                  Salva prima l&apos;evento per abilitare la generazione AI.
                </Text>
              )}
            </KScrollView>

            <View style={styles.modalFooter}>
              <Pressable onPress={() => setEditing(null)} style={[styles.btn, { backgroundColor: HT.card2 }]}>
                <Text style={{ color: HT.text, fontWeight: "700" }}>Chiudi</Text>
              </Pressable>
              <Pressable
                testID="event-save-btn"
                onPress={save}
                disabled={saving}
                style={[styles.btn, { backgroundColor: HT.brand, flex: 2 }]}
              >
                {saving ? (
                  <ActivityIndicator color="#FFF" />
                ) : (
                  <Text style={{ color: "#FFF", fontWeight: "800" }}>Salva evento</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View></AndroidKeyboardPadding>
      </Modal>

      {/* v2.18 — Native DateTimePicker (iOS/Android). Web uses TextInput fallback above. */}
      {dtPicker && Platform.OS !== "web" && (
        <DateTimePicker
          testID="event-dt-picker"
          value={dtPicker.value}
          mode={dtPicker.field.endsWith("date") ? "date" : "time"}
          is24Hour
          display={Platform.OS === "ios" ? "spinner" : "default"}
          onChange={onDtChange}
        />
      )}
    </SafeAreaView>
  );
}

function VisibilityChip({ active, label, onPress, testID }: { active: boolean; label: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable testID={testID} onPress={onPress} style={[styles.visChip, active && styles.visChipOn]}>
      <Ionicons name={active ? "checkbox" : "square-outline"} size={16} color={active ? "#FFF" : HT.muted} />
      <Text style={[styles.visChipTxt, active && { color: "#FFF" }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: HT.border, backgroundColor: HT.card2 },
  headerTitle: { fontSize: 18, fontWeight: "800", color: HT.text },
  introCard: { flexDirection: "row", backgroundColor: HT.brandTint, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: HT.brandLine, marginBottom: 16 },
  introTitle: { fontSize: 14, fontWeight: "800", color: "#FDBA74" },
  introTxt: { fontSize: 12, color: "#FDBA74", marginTop: 4, lineHeight: 17 },
  emptyCard: { alignItems: "center", padding: 30, backgroundColor: HT.card2, borderRadius: 12, borderWidth: 1, borderColor: HT.border, borderStyle: "dashed" },
  emptyTxt: { color: HT.muted, fontSize: 13, textAlign: "center", marginTop: 10, maxWidth: 300 },
  card: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, backgroundColor: HT.card2, borderRadius: 12, borderWidth: 1, borderColor: HT.border, marginBottom: 8 },
  cardTitle: { fontSize: 14, fontWeight: "800", color: HT.text },
  cardWhen: { fontSize: 11, color: HT.muted, marginTop: 2 },
  pill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  pillTxt: { fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.4 },
  iconBtn: { padding: 8, backgroundColor: HT.card2, borderRadius: 8 },
  modalBack: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: HT.card2, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "94%" },
  modalHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 1, borderBottomColor: HT.border },
  modalTitle: { fontSize: 17, fontWeight: "800", color: HT.text },
  modalFooter: { flexDirection: "row", gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: HT.border },
  btn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: "center", justifyContent: "center", flexDirection: "row" },
  lbl: { fontSize: 12, fontWeight: "700", color: HT.muted, textTransform: "uppercase", letterSpacing: 0.4, marginTop: 12, marginBottom: 4 },
  subLbl: { fontSize: 11, fontWeight: "700", color: HT.muted, marginTop: 10, marginBottom: 4 },
  input: { backgroundColor: HT.card2, borderRadius: 8, paddingHorizontal: 10, paddingVertical: Platform.OS === "ios" ? 10 : 8, fontSize: 13, color: HT.text },
  coverBox: { height: 140, borderRadius: 10, overflow: "hidden", backgroundColor: HT.card2, borderWidth: 2, borderColor: HT.border, borderStyle: "dashed" },
  coverEmpty: { flex: 1, alignItems: "center", justifyContent: "center" },
  visChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: HT.border, backgroundColor: HT.card },
  visChipOn: { backgroundColor: HT.brand, borderColor: HT.brand },
  visChipTxt: { fontSize: 12, fontWeight: "700", color: HT.text },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: HT.border, backgroundColor: HT.card },
  chipOn: { backgroundColor: HT.violetTint, borderColor: HT.brand },
  chipTxt: { fontSize: 11, color: HT.text, fontWeight: "600" },
  chipTxtOn: { color: HT.brand, fontWeight: "800" },
  uploadBtn: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8, borderWidth: 2, borderStyle: "dashed", borderRadius: 10, padding: 12, marginBottom: 8 },
  uploadTxt: { fontWeight: "700", fontSize: 13 },
});

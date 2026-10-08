import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Platform, Animated, Easing, Modal, ScrollView, TextInput } from "react-native";
import { KScrollView } from "@/src/ui/keyboard"; // V50.z374 — tastiera: campo attivo sempre visibile
import { useAudioRecorder, RecordingPresets } from "expo-audio"; // V50.z255 — hook ufficiale (createAudioRecorder non esiste in expo-audio)
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { useSafeBottom } from "@/src/hooks/useSafeBottom";

import { useBottomSheetPadding } from "@/src/utils/bottomSheetInsets";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium
import { KModalBody } from "@/src/ui/keyboard"; // V50.z397 — tastiera: campo attivo sempre visibile nelle Modal
import { acquireMicLease } from "@/src/utils/micLease"; // V50.z483 — pausa wake-word mentre si registra
let _micRelease: null | (() => void) = null;
type Contact = { contact_id: string; first_name: string; last_name: string; contact_code?: string; phone?: string };
type Group = { group_id: string; name: string; color: string; member_count?: number };

type Phase = "idle" | "recording" | "review";

/**
 * Master voice recorder — single-review flow with multi-destination + rename support.
 * The file never "disappears" during interactions: it stays visible at the top of the review modal
 * with play/retry controls, and the destinations are checkboxes that can combine multiple targets
 * (personal + clients + groups) at once.
 */
export function MasterVoiceRecorder({
  hideTrigger,
  startSignal,
  stopSignal,
  onPhaseChange,
}: {
  hideTrigger?: boolean;
  startSignal?: number;
  stopSignal?: number;
  onPhaseChange?: (phase: Phase) => void;
} = {}) {
  const safeBottom = useSafeBottom(); // V29.aq
  const [phase, setPhase] = useState<Phase>("idle");
  const bottomPad = useBottomSheetPadding();
  const [duration, setDuration] = useState(0);
  const [audioB64, setAudioB64] = useState<string | null>(null);
  const [audioMime, setAudioMime] = useState<string>("audio/webm");
  const [audioSize, setAudioSize] = useState(0);

  // Destinations (multi-select)
  const [savePersonal, setSavePersonal] = useState<boolean>(true);
  const [pickedContactIds, setPickedContactIds] = useState<Set<string>>(new Set());
  const [pickedGroupIds, setPickedGroupIds] = useState<Set<string>>(new Set());
  const [showContacts, setShowContacts] = useState(false);
  const [showGroups, setShowGroups] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [searchC, setSearchC] = useState("");
  const [searchG, setSearchG] = useState("");

  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<any>(null);
  const durationRef = useRef(0);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (phase !== "recording") { pulse.setValue(1); return; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.25, duration: 700, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        Animated.timing(pulse, { toValue: 1.0, duration: 700, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [phase, pulse]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (mediaRecRef.current && mediaRecRef.current.state !== "inactive") { try { mediaRecRef.current.stop(); } catch {} }
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
      stopPlayback();
    };
  }, []);

  // External trigger — parent can increment startSignal to begin recording
  useEffect(() => {
    if (typeof startSignal === "number" && startSignal > 0 && phase === "idle") {
      void startRecording();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startSignal]);

  // External trigger — parent can increment stopSignal to stop recording
  useEffect(() => {
    if (typeof stopSignal === "number" && stopSignal > 0 && phase === "recording") {
      stopRecording();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopSignal]);

  // Notify parent of phase changes
  useEffect(() => {
    onPhaseChange?.(phase);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // V50.r — Supporto nativo Android/iOS via expo-audio (prima solo web).
  const supported =
    (Platform.OS === "web" && typeof navigator !== "undefined" && !!navigator.mediaDevices && typeof (globalThis as any).MediaRecorder !== "undefined")
    || (Platform.OS !== "web");

  // Native recorder refs (expo-audio)
  const nativeRecorderRef = useRef<any>(null);
  const nativeRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY); // V50.z255

  const startRecording = async () => {
    if (!supported) { notify("Non supportato", "La registrazione non è disponibile su questo dispositivo."); return; }
    // V50.r — Path nativo Android/iOS
    if (Platform.OS !== "web") {
      try {
        const AudioMod: any = await import("expo-audio");
        const perm = await AudioMod.AudioModule.requestRecordingPermissionsAsync();
        if (!perm?.granted) {
          notify("Microfono", "Permesso microfono negato. Vai in Impostazioni per abilitarlo.");
          return;
        }
        const recorder = nativeRecorder; // V50.z255 — prima: AudioMod.createAudioRecorder(...) → «undefined is not a function»
        await recorder.prepareToRecordAsync();
        recorder.record(); _micRelease?.(); _micRelease = acquireMicLease(); // V50.z483
        nativeRecorderRef.current = recorder;
        durationRef.current = 0; setDuration(0);
        timerRef.current = setInterval(() => {
          durationRef.current += 1; setDuration(durationRef.current);
          if (durationRef.current >= 600) stopRecording();
        }, 1000);
        setPhase("recording");
      } catch (e: any) {
        notify("Microfono", e?.message || String(e));
      }
      return;
    }
    // Web path (esistente)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      let mime = "audio/webm;codecs=opus";
      const MR: any = (globalThis as any).MediaRecorder;
      if (MR?.isTypeSupported && !MR.isTypeSupported(mime)) {
        if (MR.isTypeSupported("audio/webm")) mime = "audio/webm";
        else if (MR.isTypeSupported("audio/mp4")) mime = "audio/mp4";
        else mime = "";
      }
      const rec = mime ? new MR(stream, { mimeType: mime }) : new MR(stream);
      mediaRecRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (ev: BlobEvent) => { if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data); };
      rec.onstop = () => { void handleStop(rec.mimeType); };
      rec.start(); _micRelease?.(); _micRelease = acquireMicLease(); // V50.z483
      durationRef.current = 0; setDuration(0);
      timerRef.current = setInterval(() => {
        durationRef.current += 1; setDuration(durationRef.current);
        if (durationRef.current >= 600) stopRecording();
      }, 1000);
      setPhase("recording");
    } catch (e: any) {
      notify("Microfono", e?.name === "NotAllowedError" ? "Permesso microfono negato" : (e?.message || "Errore"));
    }
  };

  const stopRecording = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    // V50.r — Native path
    if (Platform.OS !== "web" && nativeRecorderRef.current) {
      (async () => {
        try {
          await nativeRecorderRef.current.stop(); _micRelease?.(); _micRelease = null; // V50.z483
          const uri: string | undefined = nativeRecorderRef.current.uri;
          const AudioMod: any = await import("expo-audio");
          const FS: any = await import("expo-file-system/legacy");
          if (uri) {
            const b64 = await FS.readAsStringAsync(uri, { encoding: FS.EncodingType.Base64 });
            // Build data URL fake mime for handleStop
            const fakeBlob = { size: b64.length } as any;
            chunksRef.current = [fakeBlob];
            (globalThis as any).__lastNativeAudioB64 = b64;
            (globalThis as any).__lastNativeAudioMime = "audio/m4a";
          }
          nativeRecorderRef.current = null;
          void handleStop("audio/m4a");
        } catch (e: any) {
          notify("Errore stop", e?.message || String(e));
        }
      })();
      return;
    }
    try { if (mediaRecRef.current && mediaRecRef.current.state !== "inactive") mediaRecRef.current.stop(); } catch {}
  };

  const handleStop = async (mime: string) => {
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; } _micRelease?.(); _micRelease = null; // V50.z483
    // V50.r — Native path: audio già letto in globals durante stopRecording
    if (Platform.OS !== "web") {
      const nb64 = (globalThis as any).__lastNativeAudioB64 as string | undefined;
      const nmime = ((globalThis as any).__lastNativeAudioMime as string | undefined) || "audio/m4a";
      (globalThis as any).__lastNativeAudioB64 = undefined;
      if (!nb64) { setPhase("idle"); return; }
      const approxSize = Math.floor(nb64.length * 0.75);
      if (approxSize < 512) { notify("Registrazione troppo corta"); setPhase("idle"); return; }
      setAudioB64(nb64);
      setAudioMime(nmime);
      setAudioSize(approxSize);
      try {
        const [ct, gr] = await Promise.all([
          api<{ items: Contact[] }>("/contacts").catch(() => ({ items: [] as Contact[] })),
          api<{ items: Group[] }>("/groups").catch(() => ({ items: [] as Group[] })),
        ]);
        setContacts(ct.items || []);
        setGroups(gr.items || []);
      } catch {}
      const now = new Date();
      const defaultTitle = `Audio ${String(now.getDate()).padStart(2, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${now.getFullYear()} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      setTitle(defaultTitle);
      setPhase("review");
      return;
    }
    const parts = chunksRef.current;
    chunksRef.current = [];
    if (parts.length === 0) { setPhase("idle"); return; }
    const blob = new Blob(parts, { type: mime || parts[0].type || "audio/webm" });
    if (blob.size < 512) { notify("Registrazione troppo corta"); setPhase("idle"); return; }
    const b64 = await blobToBase64(blob);
    setAudioB64(b64);
    setAudioMime(blob.type || "audio/webm");
    setAudioSize(blob.size);
    // Preload contacts and groups
    try {
      const [ct, gr] = await Promise.all([
        api<{ items: Contact[] }>("/contacts").catch(() => ({ items: [] as Contact[] })),
        api<{ items: Group[] }>("/groups").catch(() => ({ items: [] as Group[] })),
      ]);
      setContacts(ct.items || []);
      setGroups(gr.items || []);
    } catch {}
    // Default filename: "Audio DD-MM-YYYY HH:MM"
    const now = new Date();
    const defaultTitle = `Audio ${String(now.getDate()).padStart(2, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${now.getFullYear()} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    setTitle(defaultTitle);
    setSavePersonal(true);
    setPickedContactIds(new Set());
    setPickedGroupIds(new Set());
    setPhase("review");
  };

  const playAudio = () => {
    if (!audioB64) return;
    try {
      if (Platform.OS !== "web") return;
      stopPlayback();
      const win: any = globalThis as any;
      const el = new win.Audio(`data:${audioMime};base64,${audioB64}`);
      audioElRef.current = el;
      el.onended = () => setPlaying(false);
      el.onerror = () => { setPlaying(false); notify("Errore playback"); };
      el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    } catch {}
  };

  const stopPlayback = () => {
    if (audioElRef.current) { try { audioElRef.current.pause(); } catch {} audioElRef.current = null; }
    setPlaying(false);
  };

  const retry = () => {
    stopPlayback();
    setAudioB64(null); setDuration(0); setTitle(""); setAudioSize(0);
    setSavePersonal(true); setPickedContactIds(new Set()); setPickedGroupIds(new Set());
    setPhase("idle");
    setTimeout(() => startRecording(), 300);
  };

  const discardAll = () => {
    stopPlayback();
    setAudioB64(null); setDuration(0); setTitle(""); setAudioSize(0);
    setSavePersonal(true); setPickedContactIds(new Set()); setPickedGroupIds(new Set());
    setConfirmClose(false);
    setPhase("idle");
  };

  const totalTargets = (savePersonal ? 1 : 0) + pickedContactIds.size + pickedGroupIds.size;

  const save = async () => {
    if (!audioB64) return;
    if (totalTargets === 0) { notify("Nessuna destinazione", "Seleziona almeno una destinazione."); return; }
    try {
      setSaving(true);
      const cleanTitle = title.trim() || null;
      const promises: Promise<any>[] = [];
      if (savePersonal) {
        promises.push(api("/audio-records", { method: "POST", body: { target_type: "personal", audio_base64: audioB64, mime: audioMime, duration_sec: duration, title: cleanTitle } }));
      }
      pickedContactIds.forEach((cid) => {
        promises.push(api("/audio-records", { method: "POST", body: { target_type: "contact", target_id: cid, audio_base64: audioB64, mime: audioMime, duration_sec: duration, title: cleanTitle } }));
      });
      pickedGroupIds.forEach((gid) => {
        promises.push(api("/audio-records", { method: "POST", body: { target_type: "group", target_id: gid, audio_base64: audioB64, mime: audioMime, duration_sec: duration, title: cleanTitle } }));
      });
      const results = await Promise.allSettled(promises);
      const ok = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.length - ok;
      if (failed > 0 && ok === 0) {
        notify("Errore salvataggio", "Nessuna destinazione salvata con successo.");
      } else if (failed > 0) {
        notify("Salvato parzialmente", `${ok} destinazioni OK, ${failed} fallite.`);
      } else {
        notify("Audio salvato", `Salvato su ${ok} destinazion${ok === 1 ? "e" : "i"}.`);
      }
      if (ok > 0) discardAll();
    } catch (e: any) {
      notify("Errore", e?.message || "");
    } finally {
      setSaving(false);
    }
  };

  const toggleContact = (id: string) => setPickedContactIds((s) => { const ns = new Set(s); if (ns.has(id)) ns.delete(id); else ns.add(id); return ns; });
  const toggleGroup = (id: string) => setPickedGroupIds((s) => { const ns = new Set(s); if (ns.has(id)) ns.delete(id); else ns.add(id); return ns; });

  const filteredContacts = contacts.filter((c) => {
    const q = searchC.trim().toLowerCase();
    if (!q) return true;
    return `${c.first_name} ${c.last_name} ${c.contact_code || ""} ${c.phone || ""}`.toLowerCase().includes(q);
  });
  const filteredGroups = groups.filter((g) => {
    const q = searchG.trim().toLowerCase();
    if (!q) return true;
    return g.name.toLowerCase().includes(q);
  });

  const mmss = `${String(Math.floor(duration / 60)).padStart(2, "0")}:${String(duration % 60).padStart(2, "0")}`;
  const sizeKb = audioSize > 0 ? `${Math.round(audioSize / 1024)} KB` : "";

  return (
    <View style={styles.wrap}>
      {!hideTrigger && (
        <>
          <Animated.View style={{ transform: [{ scale: pulse }] }}>
            <Pressable
              onPress={phase === "recording" ? stopRecording : startRecording}
              disabled={phase !== "idle" && phase !== "recording"}
              style={[styles.fab, { backgroundColor: phase === "recording" ? "#DC2626" : "#7C3AED" }, (phase !== "idle" && phase !== "recording") && { opacity: 0.6 }]}
              testID="master-voice-fab"
            >
              <Ionicons name={phase === "recording" ? "stop" : "mic"} size={30} color="#FFF" />
            </Pressable>
          </Animated.View>
          <Text style={styles.fabHint}>
            {phase === "recording" ? `In registrazione… ${mmss}` : phase === "idle" ? "Registra audio" : "Elaborazione…"}
          </Text>
        </>
      )}

      {/* When trigger is hidden the parent controls the UI — no inline indicator needed. */}

      {/* Review + destinations modal (single modal, file always visible) */}
      <Modal transparent visible={phase === "review"} onRequestClose={() => setConfirmClose(true)} animationType="slide"><KModalBody>
        <View style={styles.modalRoot}>
          <View style={[styles.reviewSheet, { paddingBottom: bottomPad }]}>
            <View style={styles.reviewHeader}>
              <Text style={styles.reviewTitle}>Salva registrazione</Text>
              <Pressable onPress={() => setConfirmClose(true)} testID="voice-close-btn"><Ionicons name="close" size={22} color={HT.text} /></Pressable>
            </View>

            <KScrollView contentContainerStyle={{ paddingBottom: 20 }} keyboardShouldPersistTaps="handled">
              {/* Audio card (always visible) */}
              <View style={styles.audioCard} testID="voice-audio-card">
                <Pressable onPress={playing ? stopPlayback : playAudio} style={[styles.circleBtn, { backgroundColor: playing ? "#DC2626" : "#6366F1" }]} testID="voice-play-btn">
                  <Ionicons name={playing ? "pause" : "play"} size={22} color="#FFF" />
                </Pressable>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.audioName} numberOfLines={1}>{title || "Nota vocale"}</Text>
                  <Text style={styles.audioMeta}>Durata {mmss}{sizeKb ? ` · ${sizeKb}` : ""}</Text>
                </View>
                <Pressable onPress={retry} style={[styles.circleBtn, { backgroundColor: '#F59E0B' }]} testID="voice-retry-btn">
                  <Ionicons name="refresh" size={20} color="#FFF" />
                </Pressable>
              </View>

              {/* Rename field (always visible, doesn't hide the file) */}
              <Text style={styles.label}>Nome file</Text>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder="Es. Chiamata cliente Rossi"
                style={styles.input}
                testID="voice-title-input"
                autoCorrect={false}
                autoCapitalize="sentences"
                returnKeyType="done"
              />

              {/* Destinations (multi-select) */}
              <Text style={styles.label}>Destinazioni ({totalTargets})</Text>
              <Text style={styles.hint}>Puoi selezionarne più di una — l&apos;audio verrà salvato in ognuna.</Text>

              {/* Personal */}
              <Pressable
                onPress={() => setSavePersonal((v) => !v)}
                style={[styles.destRow, savePersonal && styles.destRowActive]}
                testID="dest-personal"
              >
                <Checkbox checked={savePersonal} color="#7C3AED" />
                <Ionicons name="folder" size={20} color="#7C3AED" style={{ marginLeft: 10 }} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={styles.destLabel}>Cartella personale del Master</Text>
                  <Text style={styles.destHint}>Solo tu potrai ascoltarlo</Text>
                </View>
              </Pressable>

              {/* Contacts */}
              <Pressable onPress={() => setShowContacts((v) => !v)} style={styles.destGroupHeader} testID="dest-contacts-toggle">
                <Ionicons name="person" size={20} color="#0891B2" />
                <Text style={styles.destGroupTitle}>Clienti {pickedContactIds.size > 0 ? `· ${pickedContactIds.size} selezionati` : ""}</Text>
                <Ionicons name={showContacts ? "chevron-up" : "chevron-down"} size={20} color={HT.muted} />
              </Pressable>
              {showContacts && (
                <View style={styles.destBox}>
                  <TextInput
                    value={searchC}
                    onChangeText={setSearchC}
                    placeholder="Cerca cliente…"
                    style={[styles.input, { marginTop: 4, marginBottom: 8 }]}
                    testID="dest-contact-search"
                  />
                  <ScrollView style={{ maxHeight: 200 }} nestedScrollEnabled>
                    {filteredContacts.slice(0, 60).map((c) => {
                      const checked = pickedContactIds.has(c.contact_id);
                      return (
                        <Pressable key={c.contact_id} onPress={() => toggleContact(c.contact_id)} style={[styles.pickRow, checked && styles.pickRowActive]} testID={`dest-contact-${c.contact_id}`}>
                          <Checkbox checked={checked} color="#0891B2" />
                          <View style={{ flex: 1, marginLeft: 10 }}>
                            <Text style={styles.pickName}>{c.first_name} {c.last_name}</Text>
                            <Text style={styles.pickSub}>{c.contact_code || ""}{c.phone ? ` · ${c.phone}` : ""}</Text>
                          </View>
                        </Pressable>
                      );
                    })}
                    {filteredContacts.length === 0 && <Text style={styles.emptyLine}>Nessun cliente</Text>}
                  </ScrollView>
                </View>
              )}

              {/* Groups */}
              <Pressable onPress={() => setShowGroups((v) => !v)} style={styles.destGroupHeader} testID="dest-groups-toggle">
                <Ionicons name="people" size={20} color="#059669" />
                <Text style={styles.destGroupTitle}>Gruppi {pickedGroupIds.size > 0 ? `· ${pickedGroupIds.size} selezionati` : ""}</Text>
                <Ionicons name={showGroups ? "chevron-up" : "chevron-down"} size={20} color={HT.muted} />
              </Pressable>
              {showGroups && (
                <View style={styles.destBox}>
                  <TextInput
                    value={searchG}
                    onChangeText={setSearchG}
                    placeholder="Cerca gruppo…"
                    style={[styles.input, { marginTop: 4, marginBottom: 8 }]}
                    testID="dest-group-search"
                  />
                  <ScrollView style={{ maxHeight: 200 }} nestedScrollEnabled>
                    {filteredGroups.map((g) => {
                      const checked = pickedGroupIds.has(g.group_id);
                      return (
                        <Pressable key={g.group_id} onPress={() => toggleGroup(g.group_id)} style={[styles.pickRow, checked && styles.pickRowActive]} testID={`dest-group-${g.group_id}`}>
                          <Checkbox checked={checked} color="#059669" />
                          <View style={{ flex: 1, marginLeft: 10 }}>
                            <Text style={styles.pickName}>{g.name}</Text>
                            <Text style={styles.pickSub}>{g.member_count ? `${g.member_count} membri` : ""}</Text>
                          </View>
                        </Pressable>
                      );
                    })}
                    {filteredGroups.length === 0 && <Text style={styles.emptyLine}>Nessun gruppo</Text>}
                  </ScrollView>
                </View>
              )}
            </KScrollView>

            {/* Bottom actions */}
            <View style={[styles.footer, { paddingBottom: 12 + safeBottom }]}>
              <Pressable onPress={() => setConfirmClose(true)} disabled={saving} style={[styles.footerBtn, { backgroundColor: HT.card2 }]} testID="voice-cancel-btn">
                <Ionicons name="trash-outline" size={18} color="#DC2626" />
                <Text style={[styles.footerTxt, { color: "#DC2626" }]}>Scarta</Text>
              </Pressable>
              <Pressable
                onPress={save}
                disabled={saving || totalTargets === 0}
                style={[styles.footerBtn, { backgroundColor: totalTargets === 0 ? HT.muted : "#16A34A", flex: 2 }]}
                testID="voice-save-btn"
              >
                {saving ? <ActivityIndicator color="#FFF" /> : (
                  <>
                    <Ionicons name="checkmark-circle" size={20} color="#FFF" />
                    <Text style={[styles.footerTxt, { color: "#FFF" }]}>
                      Salva{totalTargets > 0 ? ` (${totalTargets})` : ""}
                    </Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </KModalBody></Modal>

      {/* Confirm close/discard modal */}
      <Modal transparent visible={confirmClose} animationType="fade" onRequestClose={() => setConfirmClose(false)}>
        <View style={styles.confirmRoot}>
          <View style={styles.confirmBox}>
            <Ionicons name="alert-circle" size={44} color="#F59E0B" style={{ alignSelf: "center" }} />
            <Text style={styles.confirmT}>Scartare la registrazione?</Text>
            <Text style={styles.confirmSub}>L&apos;audio non salvato andrà perso.</Text>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
              <Pressable onPress={() => setConfirmClose(false)} style={[styles.footerBtn, { backgroundColor: HT.card2, flex: 1 }]} testID="confirm-keep">
                <Text style={[styles.footerTxt, { color: HT.text }]}>Torna indietro</Text>
              </Pressable>
              <Pressable onPress={discardAll} style={[styles.footerBtn, { backgroundColor: '#DC2626', flex: 1 }]} testID="confirm-discard">
                <Text style={[styles.footerTxt, { color: "#FFF" }]}>Scarta</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Checkbox({ checked, color }: { checked: boolean; color: string }) {
  return (
    <View style={[styles.cbox, { borderColor: color }, checked && { backgroundColor: color }]}>
      {checked && <Ionicons name="checkmark" size={14} color="#FFF" />}
    </View>
  );
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const res = fr.result as string;
      const i = res.indexOf(",");
      resolve(i >= 0 ? res.slice(i + 1) : res);
    };
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", marginTop: 16, marginBottom: 20 },
  recIndicator: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: '#DC2626',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginTop: 4,
    alignSelf: "center",
  },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: HT.card },
  recIndicatorTxt: { color: "#FFF", fontWeight: "700", fontSize: 12 },
  fab: {
    width: 76, height: 76, borderRadius: 38, alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  fabHint: { marginTop: 10, fontSize: 12, color: HT.muted, fontWeight: "600", fontVariant: ["tabular-nums"] },
  modalRoot: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  reviewSheet: { backgroundColor: HT.card, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, paddingBottom: 24, maxHeight: "90%" },
  reviewHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  reviewTitle: { fontSize: 17, fontWeight: "800", color: HT.text },
  audioCard: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: HT.violetTint, borderRadius: 14, padding: 12,
    borderWidth: 2, borderColor: HT.violet + '66',
  },
  circleBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  audioName: { fontSize: 14, fontWeight: "800", color: HT.text },
  audioMeta: { fontSize: 11, color: HT.muted, marginTop: 2, fontVariant: ["tabular-nums"] },
  label: { fontSize: 12, fontWeight: "700", color: HT.muted, marginTop: 16, marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 },
  hint: { fontSize: 11, color: HT.muted, marginBottom: 10 },
  input: { borderWidth: 1, borderColor: HT.border, borderRadius: 10, padding: 12, fontSize: 14, color: HT.text, backgroundColor: HT.card2 },
  destRow: { flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 12, marginBottom: 8, backgroundColor: HT.card2, borderWidth: 1.5, borderColor: HT.border },
  destRowActive: { borderColor: '#7C3AED', backgroundColor: HT.violetTint },
  destLabel: { fontSize: 13, fontWeight: "800", color: HT.text },
  destHint: { fontSize: 11, color: HT.muted, marginTop: 2 },
  destGroupHeader: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, marginBottom: 4, backgroundColor: HT.card2, borderWidth: 1, borderColor: HT.border },
  destGroupTitle: { flex: 1, fontSize: 13, fontWeight: "800", color: HT.text },
  destBox: { backgroundColor: HT.card2, padding: 10, borderRadius: 12, marginBottom: 8, borderWidth: 1, borderColor: HT.border },
  pickRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, paddingHorizontal: 6, borderRadius: 8 },
  pickRowActive: { backgroundColor: HT.card },
  pickName: { fontSize: 13, fontWeight: "700", color: HT.text },
  pickSub: { fontSize: 11, color: HT.muted, marginTop: 1 },
  cbox: { width: 22, height: 22, borderRadius: 5, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  emptyLine: { textAlign: "center", padding: 12, fontSize: 12, color: HT.muted, fontStyle: "italic" },
  footer: { flexDirection: "row", gap: 10, marginTop: 10 },
  footerBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", padding: 14, borderRadius: 12, gap: 6 },
  footerTxt: { fontWeight: "800", fontSize: 14 },
  confirmRoot: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: 20 },
  confirmBox: { backgroundColor: HT.card, borderRadius: 18, padding: 20 },
  confirmT: { fontSize: 17, fontWeight: "800", color: HT.text, textAlign: "center", marginTop: 10 },
  confirmSub: { fontSize: 12, color: HT.muted, textAlign: "center", marginTop: 6 },
});

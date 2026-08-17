import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Platform, Animated, Easing, Modal, ScrollView, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { theme } from "@/src/theme";

type Contact = { contact_id: string; first_name: string; last_name: string; contact_code?: string; phone?: string };
type Group = { group_id: string; name: string; color: string; member_count?: number };

type Target = { type: "personal" | "contact" | "group"; id?: string; label: string };

type Phase = "idle" | "recording" | "picking-target" | "picking-contact" | "picking-group" | "confirming";

/**
 * Round FAB voice recorder for Master screen.
 * - Idle: purple mic
 * - Recording: pulsating red stop button with timer
 * - On stop: picker "Dove salvare?" (personal / contact / group)
 * - Then confirmation modal (Play / Riprova / Salva / Annulla)
 * NO transcription or voice recognition.
 */
export function MasterVoiceRecorder() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [duration, setDuration] = useState(0);
  const [audioB64, setAudioB64] = useState<string | null>(null);
  const [audioMime, setAudioMime] = useState<string>("audio/webm");
  const [target, setTarget] = useState<Target | null>(null);
  const [saving, setSaving] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [search, setSearch] = useState("");
  const [title, setTitle] = useState("");
  const [playing, setPlaying] = useState(false);

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
      // cleanup
      if (timerRef.current) clearInterval(timerRef.current);
      if (mediaRecRef.current && mediaRecRef.current.state !== "inactive") { try { mediaRecRef.current.stop(); } catch {} }
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
      if (audioElRef.current) { try { audioElRef.current.pause(); } catch {} audioElRef.current = null; }
    };
  }, []);

  const supported = Platform.OS === "web" && typeof navigator !== "undefined" && !!navigator.mediaDevices && typeof (globalThis as any).MediaRecorder !== "undefined";

  const startRecording = async () => {
    if (!supported) {
      notify("Non supportato", "La registrazione vocale funziona nei browser. Su iOS Safari 14.5+ / Chrome.");
      return;
    }
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
      rec.start();
      durationRef.current = 0; setDuration(0);
      timerRef.current = setInterval(() => {
        durationRef.current += 1; setDuration(durationRef.current);
        if (durationRef.current >= 600) stopRecording(); // 10 min cap
      }, 1000);
      setPhase("recording");
    } catch (e: any) {
      const msg = e?.name === "NotAllowedError" ? "Permesso microfono negato" : e?.message || "Errore microfono";
      notify("Microfono", msg);
    }
  };

  const stopRecording = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    try { if (mediaRecRef.current && mediaRecRef.current.state !== "inactive") mediaRecRef.current.stop(); } catch {}
  };

  const handleStop = async (mime: string) => {
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    const parts = chunksRef.current;
    chunksRef.current = [];
    if (parts.length === 0) { setPhase("idle"); return; }
    const blob = new Blob(parts, { type: mime || parts[0].type || "audio/webm" });
    if (blob.size < 512) { notify("Registrazione troppo corta"); setPhase("idle"); return; }
    const b64 = await blobToBase64(blob);
    setAudioB64(b64);
    setAudioMime(blob.type || "audio/webm");
    // Preload contacts & groups for pickers
    try {
      const [ct, gr] = await Promise.all([
        api<{ items: Contact[] }>("/contacts").catch(() => ({ items: [] as Contact[] })),
        api<{ items: Group[] }>("/groups").catch(() => ({ items: [] as Group[] })),
      ]);
      setContacts(ct.items || []);
      setGroups(gr.items || []);
    } catch {}
    setPhase("picking-target");
  };

  const pickTarget = (t: Target) => {
    setTarget(t);
    if (t.type === "personal") setPhase("confirming");
    else if (t.type === "contact") setPhase("picking-contact");
    else setPhase("picking-group");
  };

  const pickContact = (c: Contact) => {
    setTarget({ type: "contact", id: c.contact_id, label: `${c.first_name} ${c.last_name}` });
    setPhase("confirming");
    setSearch("");
  };

  const pickGroup = (g: Group) => {
    setTarget({ type: "group", id: g.group_id, label: g.name });
    setPhase("confirming");
    setSearch("");
  };

  const playAudio = () => {
    if (!audioB64) return;
    try {
      if (Platform.OS === "web") {
        const win: any = globalThis as any;
        if (audioElRef.current) { audioElRef.current.pause(); audioElRef.current = null; }
        const el = new win.Audio(`data:${audioMime};base64,${audioB64}`);
        audioElRef.current = el;
        el.onended = () => setPlaying(false);
        el.onerror = () => { setPlaying(false); notify("Errore", "Impossibile riprodurre l'audio"); };
        el.play().then(() => setPlaying(true)).catch((err: any) => notify("Errore playback", err?.message || ""));
      }
    } catch (e: any) { notify("Errore", e?.message || ""); }
  };

  const stopPlay = () => {
    if (audioElRef.current) { try { audioElRef.current.pause(); } catch {} audioElRef.current = null; }
    setPlaying(false);
  };

  const retry = () => {
    stopPlay();
    setAudioB64(null); setDuration(0); setTarget(null); setTitle("");
    setPhase("idle");
    setTimeout(() => startRecording(), 300);
  };

  const cancelAll = () => {
    stopPlay();
    setAudioB64(null); setDuration(0); setTarget(null); setTitle("");
    setPhase("idle");
  };

  const save = async () => {
    if (!audioB64 || !target) return;
    try {
      setSaving(true);
      await api("/audio-records", {
        method: "POST",
        body: {
          target_type: target.type,
          target_id: target.id,
          audio_base64: audioB64,
          mime: audioMime,
          duration_sec: duration,
          title: title.trim() || null,
        },
      });
      notify("Audio salvato", target.type === "personal" ? "Salvato nella tua cartella personale" : target.type === "contact" ? `Allegato a ${target.label}` : `Inviato al gruppo ${target.label}`);
      cancelAll();
    } catch (e: any) {
      notify("Errore salvataggio", e?.message || "");
    } finally {
      setSaving(false);
    }
  };

  const filteredContacts = contacts.filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return `${c.first_name} ${c.last_name} ${c.contact_code || ""} ${c.phone || ""}`.toLowerCase().includes(q);
  }).slice(0, 60);

  const filteredGroups = groups.filter((g) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return g.name.toLowerCase().includes(q);
  });

  const mmss = `${String(Math.floor(duration / 60)).padStart(2, "0")}:${String(duration % 60).padStart(2, "0")}`;

  return (
    <View style={styles.wrap}>
      {/* FAB */}
      <Animated.View style={{ transform: [{ scale: pulse }] }}>
        <Pressable
          onPress={phase === "recording" ? stopRecording : startRecording}
          disabled={phase !== "idle" && phase !== "recording"}
          style={[
            styles.fab,
            { backgroundColor: phase === "recording" ? "#DC2626" : "#7C3AED" },
            (phase !== "idle" && phase !== "recording") && { opacity: 0.6 },
          ]}
          testID="master-voice-fab"
        >
          <Ionicons name={phase === "recording" ? "stop" : "mic"} size={30} color="#FFF" />
        </Pressable>
      </Animated.View>
      <Text style={styles.fabHint}>
        {phase === "recording" ? `In registrazione… ${mmss}` : phase === "idle" ? "Registra audio" : "Elaborazione…"}
      </Text>

      {/* Target picker modal */}
      <Modal transparent visible={phase === "picking-target"} onRequestClose={cancelAll} animationType="slide">
        <Pressable style={styles.backdrop} onPress={cancelAll}>
          <View style={styles.sheet} onStartShouldSetResponder={() => true}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>Dove vuoi salvare l&apos;audio?</Text>
            <Text style={styles.sheetSub}>Durata registrata: {mmss}</Text>
            <TargetOption icon="folder" color="#7C3AED" label="Cartella audio personale" hint="Solo tu potrai ascoltarlo" onPress={() => pickTarget({ type: "personal", label: "Personale" })} testID="target-personal" />
            <TargetOption icon="person" color="#0891B2" label="Cartella audio di un cliente" hint="Allega a un contatto specifico" onPress={() => pickTarget({ type: "contact", label: "" })} testID="target-contact" />
            <TargetOption icon="people" color="#059669" label="Invia a un gruppo di collaboratori" hint="Condividi con un team" onPress={() => pickTarget({ type: "group", label: "" })} testID="target-group" />
            <Pressable onPress={cancelAll} style={styles.cancel}><Text style={styles.cancelTxt}>Annulla e scarta</Text></Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* Contact picker */}
      <Modal transparent visible={phase === "picking-contact"} onRequestClose={() => setPhase("picking-target")} animationType="slide">
        <Pressable style={styles.backdrop} onPress={() => setPhase("picking-target")}>
          <View style={[styles.sheet, { maxHeight: "80%" }]} onStartShouldSetResponder={() => true}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>Seleziona cliente</Text>
            <TextInput value={search} onChangeText={setSearch} placeholder="Cerca cliente…" style={styles.searchInput} testID="voice-contact-search" />
            <ScrollView style={{ maxHeight: 420 }}>
              {filteredContacts.map((c) => (
                <Pressable key={c.contact_id} onPress={() => pickContact(c)} style={styles.rowItem} testID={`voice-pick-contact-${c.contact_id}`}>
                  <View style={[styles.avatar, { backgroundColor: "#0891B222" }]}><Ionicons name="person" size={16} color="#0891B2" /></View>
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={styles.rowTitle}>{c.first_name} {c.last_name}</Text>
                    <Text style={styles.rowSub}>{c.contact_code || ""} {c.phone ? `· ${c.phone}` : ""}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={theme.color.muted} />
                </Pressable>
              ))}
              {filteredContacts.length === 0 && <Text style={styles.empty}>Nessun cliente trovato.</Text>}
            </ScrollView>
            <Pressable onPress={() => setPhase("picking-target")} style={styles.cancel}><Text style={styles.cancelTxt}>← Indietro</Text></Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* Group picker */}
      <Modal transparent visible={phase === "picking-group"} onRequestClose={() => setPhase("picking-target")} animationType="slide">
        <Pressable style={styles.backdrop} onPress={() => setPhase("picking-target")}>
          <View style={[styles.sheet, { maxHeight: "80%" }]} onStartShouldSetResponder={() => true}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>Seleziona gruppo</Text>
            <TextInput value={search} onChangeText={setSearch} placeholder="Cerca gruppo…" style={styles.searchInput} testID="voice-group-search" />
            <ScrollView style={{ maxHeight: 420 }}>
              {filteredGroups.map((g) => (
                <Pressable key={g.group_id} onPress={() => pickGroup(g)} style={styles.rowItem} testID={`voice-pick-group-${g.group_id}`}>
                  <View style={[styles.avatar, { backgroundColor: g.color + "22" }]}><Ionicons name="people" size={16} color={g.color} /></View>
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={styles.rowTitle}>{g.name}</Text>
                    <Text style={styles.rowSub}>{g.member_count ? `${g.member_count} membri` : "Gruppo"}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={theme.color.muted} />
                </Pressable>
              ))}
              {filteredGroups.length === 0 && <Text style={styles.empty}>Nessun gruppo. Crea un gruppo dalla schermata Contatti.</Text>}
            </ScrollView>
            <Pressable onPress={() => setPhase("picking-target")} style={styles.cancel}><Text style={styles.cancelTxt}>← Indietro</Text></Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* Confirmation modal */}
      <Modal transparent visible={phase === "confirming"} onRequestClose={cancelAll} animationType="fade">
        <Pressable style={styles.backdrop} onPress={cancelAll}>
          <View style={styles.confirmBox} onStartShouldSetResponder={() => true}>
            <Text style={styles.confirmTitle}>Conferma salvataggio</Text>
            <View style={styles.destBadge}>
              <Ionicons name={target?.type === "personal" ? "folder" : target?.type === "contact" ? "person" : "people"} size={16} color="#7C3AED" />
              <Text style={styles.destTxt}>
                {target?.type === "personal" ? "Personale" : target?.type === "contact" ? `Cliente: ${target.label}` : `Gruppo: ${target?.label}`}
              </Text>
            </View>
            <Text style={styles.confirmDuration}>Durata: {mmss}</Text>

            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Titolo (opzionale)"
              style={styles.titleInput}
              testID="voice-title-input"
            />

            <View style={styles.playRow}>
              <Pressable onPress={playing ? stopPlay : playAudio} style={[styles.playBtn, { backgroundColor: playing ? "#DC2626" : "#6366F1" }]} testID="voice-play-btn">
                <Ionicons name={playing ? "pause" : "play"} size={22} color="#FFF" />
                <Text style={styles.playTxt}>{playing ? "Ferma" : "Riascolta"}</Text>
              </Pressable>
              <Pressable onPress={retry} style={[styles.playBtn, { backgroundColor: "#F59E0B" }]} testID="voice-retry-btn">
                <Ionicons name="refresh" size={22} color="#FFF" />
                <Text style={styles.playTxt}>Riprova</Text>
              </Pressable>
            </View>

            <View style={styles.actionsRow}>
              <Pressable onPress={cancelAll} disabled={saving} style={[styles.actBtn, { backgroundColor: "#F1F5F9" }]} testID="voice-cancel-btn">
                <Ionicons name="trash-outline" size={18} color="#DC2626" />
                <Text style={[styles.actTxt, { color: "#DC2626" }]}>Elimina</Text>
              </Pressable>
              <Pressable onPress={save} disabled={saving} style={[styles.actBtn, { backgroundColor: "#16A34A" }]} testID="voice-save-btn">
                {saving ? <ActivityIndicator color="#FFF" /> : (<>
                  <Ionicons name="checkmark-circle" size={18} color="#FFF" />
                  <Text style={[styles.actTxt, { color: "#FFF" }]}>Salva</Text>
                </>)}
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function TargetOption({ icon, color, label, hint, onPress, testID }: { icon: keyof typeof Ionicons.glyphMap; color: string; label: string; hint: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable style={styles.targetOpt} onPress={onPress} testID={testID}>
      <View style={[styles.targetIcon, { backgroundColor: color + "22" }]}><Ionicons name={icon} size={22} color={color} /></View>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={styles.targetLabel}>{label}</Text>
        <Text style={styles.targetHint}>{hint}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={theme.color.muted} />
    </Pressable>
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
  fab: {
    width: 76, height: 76, borderRadius: 38, alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  fabHint: { marginTop: 10, fontSize: 12, color: theme.color.muted, fontWeight: "600", fontVariant: ["tabular-nums"] },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#FFF", borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, paddingBottom: 30 },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: "#CBD5E1", marginBottom: 12 },
  sheetTitle: { fontSize: 16, fontWeight: "800", color: theme.color.onSurface, marginBottom: 4 },
  sheetSub: { fontSize: 12, color: theme.color.muted, marginBottom: 14 },
  searchInput: { borderWidth: 1, borderColor: theme.color.border, borderRadius: 10, padding: 12, fontSize: 14, marginBottom: 10, color: theme.color.onSurface, backgroundColor: theme.color.surface },
  targetOpt: { flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 12, marginBottom: 8, backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: theme.color.border },
  targetIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  targetLabel: { fontSize: 14, fontWeight: "800", color: theme.color.onSurface },
  targetHint: { fontSize: 11, color: theme.color.muted, marginTop: 2 },
  cancel: { alignSelf: "center", padding: 12, marginTop: 8 },
  cancelTxt: { color: theme.color.muted, fontWeight: "700" },
  rowItem: { flexDirection: "row", alignItems: "center", padding: 10, borderRadius: 8, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  rowTitle: { fontSize: 14, fontWeight: "700", color: theme.color.onSurface },
  rowSub: { fontSize: 11, color: theme.color.muted, marginTop: 2 },
  empty: { textAlign: "center", padding: 30, color: theme.color.muted, fontStyle: "italic", fontSize: 12 },
  confirmBox: { margin: 16, backgroundColor: "#FFF", borderRadius: 20, padding: 20, alignSelf: "center", width: "92%" },
  confirmTitle: { fontSize: 17, fontWeight: "800", color: theme.color.onSurface, marginBottom: 12 },
  destBadge: { flexDirection: "row", alignItems: "center", backgroundColor: "#F5F3FF", padding: 10, borderRadius: 10, gap: 8 },
  destTxt: { fontSize: 13, fontWeight: "700", color: "#5B21B6" },
  confirmDuration: { fontSize: 12, color: theme.color.muted, marginTop: 8 },
  titleInput: { borderWidth: 1, borderColor: theme.color.border, borderRadius: 10, padding: 12, fontSize: 14, marginTop: 14, marginBottom: 12, color: theme.color.onSurface },
  playRow: { flexDirection: "row", gap: 10, marginTop: 4 },
  playBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", padding: 12, borderRadius: 10, gap: 6 },
  playTxt: { color: "#FFF", fontWeight: "800", fontSize: 13 },
  actionsRow: { flexDirection: "row", gap: 10, marginTop: 14 },
  actBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", padding: 14, borderRadius: 12, gap: 8 },
  actTxt: { fontWeight: "800", fontSize: 14 },
});

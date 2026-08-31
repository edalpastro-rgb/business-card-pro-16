import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Platform, TextInput, Modal } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";

type AudioRecord = {
  audio_id: string;
  target_type: string;
  mime?: string;
  duration_sec?: number;
  size_bytes?: number;
  title?: string | null;
  created_at: string;
};

export default function MyAudiosScreen() {
  const router = useRouter();
  const [items, setItems] = useState<AudioRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [renameFor, setRenameFor] = useState<AudioRecord | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: AudioRecord[] }>("/audio-records?target_type=personal");
      setItems(r.items);
    } catch (e) { console.warn(e); } finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    return () => {
      if (audioElRef.current) { try { audioElRef.current.pause(); } catch {} audioElRef.current = null; }
    };
  }, []);

  const stopPlayback = () => {
    if (audioElRef.current) { try { audioElRef.current.pause(); } catch {} audioElRef.current = null; }
    setPlayingId(null);
  };

  const play = async (rec: AudioRecord) => {
    if (playingId === rec.audio_id) { stopPlayback(); return; }
    stopPlayback();
    if (Platform.OS !== "web") { notify("Solo web", "Playback disponibile nel browser per ora."); return; }
    try {
      setBusyId(rec.audio_id);
      const r = await api<{ audio_base64: string; mime?: string }>(`/audio-records/${rec.audio_id}`);
      let b64 = r.audio_base64 || "";
      if (b64.startsWith("data:")) b64 = b64.split(",", 1)[1] || b64;
      const win: any = globalThis as any;
      const el = new win.Audio(`data:${r.mime || rec.mime || "audio/webm"};base64,${b64}`);
      audioElRef.current = el;
      el.onended = () => setPlayingId(null);
      el.onerror = () => { setPlayingId(null); notify("Errore", "Playback fallito"); };
      await el.play();
      setPlayingId(rec.audio_id);
    } catch (e: any) { notify("Errore", e?.message || ""); } finally { setBusyId(null); }
  };

  const remove = (rec: AudioRecord) => notify("Elimina audio", `Rimuovere "${rec.title || 'Nota vocale'}"?`, [
    { text: "Annulla", style: "cancel" },
    { text: "Elimina", style: "destructive", onPress: async () => {
      try { if (playingId === rec.audio_id) stopPlayback(); await api(`/audio-records/${rec.audio_id}`, { method: "DELETE" }); await load(); }
      catch (e: any) { notify("Errore", e?.message || ""); }
    }},
  ]);

  const openRename = (rec: AudioRecord) => { setRenameFor(rec); setRenameVal(rec.title || ""); };
  const saveRename = async () => {
    if (!renameFor) return;
    try {
      // Since backend has no PATCH for audio-records yet, re-post is not ideal.
      // We use direct DB update via a lightweight endpoint. If not available, we simply update via delete+create.
      // Simpler: call PUT /audio-records/{id}/title if available; else skip.
      await api(`/audio-records/${renameFor.audio_id}/title`, { method: "PUT", body: { title: renameVal.trim() } });
      setRenameFor(null);
      await load();
    } catch (e: any) {
      notify("Errore rinomina", e?.message || "");
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.color.background }} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn}><Ionicons name="chevron-back" size={22} color={theme.color.onSurface} /></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>I miei audio</Text>
          <Text style={styles.headerSub}>Cartella personale del Master · {items.length} file</Text>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={theme.color.brandPrimary} />
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="folder-open-outline" size={54} color={theme.color.muted} />
          <Text style={styles.emptyTitle}>Nessun audio personale</Text>
          <Text style={styles.emptyTxt}>Registra un audio dall&apos;Interfaccia Master e scegli &quot;Cartella personale&quot; come destinazione.</Text>
          <Pressable onPress={() => router.push("/master" as any)} style={styles.recordBtn}>
            <Ionicons name="mic" size={18} color="#FFF" />
            <Text style={styles.recordTxt}>Registra ora</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
          {items.map((rec) => {
            const isPlaying = playingId === rec.audio_id;
            const isBusy = busyId === rec.audio_id;
            return (
              <View key={rec.audio_id} style={styles.card} testID={`my-audio-${rec.audio_id}`}>
                <Pressable onPress={() => play(rec)} disabled={isBusy} style={[styles.playBtn, { backgroundColor: isPlaying ? "#DC2626" : "#7C3AED" }]} testID={`my-audio-play-${rec.audio_id}`}>
                  {isBusy ? <ActivityIndicator color="#FFF" size="small" /> : <Ionicons name={isPlaying ? "pause" : "play"} size={22} color="#FFF" />}
                </Pressable>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.title} numberOfLines={1}>{rec.title || "Nota vocale"}</Text>
                  <View style={styles.metaRow}>
                    <Ionicons name="calendar-outline" size={12} color={theme.color.muted} />
                    <Text style={styles.metaTxt}>{fmtDateTime(rec.created_at)}</Text>
                    {typeof rec.duration_sec === "number" && rec.duration_sec > 0 && (
                      <>
                        <Text style={styles.metaSep}>·</Text>
                        <Ionicons name="time-outline" size={12} color={theme.color.muted} />
                        <Text style={styles.metaTxt}>{fmtDuration(rec.duration_sec)}</Text>
                      </>
                    )}
                  </View>
                  {isPlaying && <Text style={styles.playingHint}>▸ In riproduzione…</Text>}
                </View>
                <Pressable onPress={() => openRename(rec)} style={styles.iconBtn} testID={`my-audio-rename-${rec.audio_id}`}>
                  <Ionicons name="create-outline" size={18} color="#0891B2" />
                </Pressable>
                <Pressable onPress={() => remove(rec)} style={styles.iconBtn} testID={`my-audio-delete-${rec.audio_id}`}>
                  <Ionicons name="trash-outline" size={18} color="#DC2626" />
                </Pressable>
              </View>
            );
          })}
        </ScrollView>
      )}

      <Modal transparent visible={!!renameFor} animationType="fade" onRequestClose={() => setRenameFor(null)}>
        <View style={styles.modalRoot}>
          <View style={styles.modalBox}>
            <Text style={styles.modalT}>Rinomina audio</Text>
            <TextInput value={renameVal} onChangeText={setRenameVal} style={styles.input} autoFocus placeholder="Nome file" testID="rename-input" />
            <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
              <Pressable onPress={() => setRenameFor(null)} style={[styles.modalBtn, { backgroundColor: "#F1F5F9", flex: 1 }]} testID="rename-cancel">
                <Text style={[styles.modalBtnTxt, { color: theme.color.onSurface }]}>Annulla</Text>
              </Pressable>
              <Pressable onPress={saveRename} style={[styles.modalBtn, { backgroundColor: "#7C3AED", flex: 1 }]} testID="rename-save">
                <Text style={[styles.modalBtnTxt, { color: "#FFF" }]}>Salva</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function fmtDateTime(iso?: string) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" })
      + " · " + d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}
function fmtDuration(s: number) {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", padding: 14, gap: 10, borderBottomWidth: 1, borderBottomColor: theme.color.border, backgroundColor: theme.color.surface },
  // V29.bc — Stile Optima
  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.9)",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  headerTitle: { fontSize: 16, fontWeight: "800", color: theme.color.onSurface },
  headerSub: { fontSize: 11, color: theme.color.muted, marginTop: 1 },
  empty: { alignItems: "center", padding: 40, marginTop: 40 },
  emptyTitle: { fontSize: 16, fontWeight: "800", color: theme.color.onSurface, marginTop: 14 },
  emptyTxt: { fontSize: 12, color: theme.color.muted, marginTop: 6, textAlign: "center", lineHeight: 16 },
  recordBtn: { marginTop: 24, flexDirection: "row", gap: 8, alignItems: "center", backgroundColor: "#7C3AED", paddingHorizontal: 18, paddingVertical: 12, borderRadius: 12 },
  recordTxt: { color: "#FFF", fontWeight: "800", fontSize: 13 },
  card: { flexDirection: "row", alignItems: "center", backgroundColor: theme.color.surface, borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: theme.color.border },
  playBtn: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 3, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  title: { fontSize: 13, fontWeight: "700", color: theme.color.onSurface },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 4 },
  metaTxt: { fontSize: 11, color: theme.color.muted },
  metaSep: { fontSize: 11, color: theme.color.muted, marginHorizontal: 4 },
  playingHint: { fontSize: 10, color: "#DC2626", fontWeight: "800", marginTop: 3 },
  iconBtn: { padding: 8 },
  modalRoot: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", padding: 20 },
  modalBox: { backgroundColor: "#FFF", borderRadius: 16, padding: 18 },
  modalT: { fontSize: 15, fontWeight: "800", color: theme.color.onSurface, marginBottom: 12 },
  input: { borderWidth: 1, borderColor: theme.color.border, borderRadius: 10, padding: 12, fontSize: 14, color: theme.color.onSurface, backgroundColor: theme.color.surface },
  modalBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", padding: 12, borderRadius: 10 },
  modalBtnTxt: { fontWeight: "800", fontSize: 13 },
});

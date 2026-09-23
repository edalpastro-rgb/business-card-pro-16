import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

type AudioRecord = {
  audio_id: string;
  target_type: string;
  target_id?: string;
  mime?: string;
  duration_sec?: number;
  size_bytes?: number;
  title?: string | null;
  created_at: string;
  created_by?: string;
};

/**
 * "Audio e Note Vocali" section — dedicated tab on contact detail.
 * Lists all audio_records where target_type=contact and target_id=<contact_id>.
 * Shows date/time + duration + play/pause + delete.
 */
export function ContactAudioSection({ contactId }: { contactId: string }) {
  const [items, setItems] = useState<AudioRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: AudioRecord[] }>(`/audio-records?target_type=contact&target_id=${contactId}`);
      setItems(r.items);
    } catch (e) {
      console.warn("audio load", e);
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    return () => {
      if (audioElRef.current) { try { audioElRef.current.pause(); } catch {} audioElRef.current = null; }
    };
  }, []);

  const stopPlayback = () => {
    if (audioElRef.current) { try { audioElRef.current.pause(); } catch {} audioElRef.current = null; }
    setPlayingId(null);
  };

  const playAudio = async (rec: AudioRecord) => {
    if (playingId === rec.audio_id) { stopPlayback(); return; }
    stopPlayback();
    if (Platform.OS !== "web") {
      notify("Solo web", "La riproduzione audio richiede il browser per ora.");
      return;
    }
    try {
      setBusyId(rec.audio_id);
      const r = await api<{ audio_base64: string; mime?: string }>(`/audio-records/${rec.audio_id}`);
      let b64 = r.audio_base64 || "";
      if (b64.startsWith("data:")) b64 = b64.split(",", 1)[1] || b64;
      const dataUrl = `data:${r.mime || rec.mime || "audio/webm"};base64,${b64}`;
      const win: any = globalThis as any;
      const el = new win.Audio(dataUrl);
      audioElRef.current = el;
      el.onended = () => setPlayingId(null);
      el.onerror = () => { setPlayingId(null); notify("Errore", "Impossibile riprodurre l'audio"); };
      await el.play();
      setPlayingId(rec.audio_id);
    } catch (e: any) {
      notify("Errore playback", e?.message || "");
    } finally {
      setBusyId(null);
    }
  };

  const remove = (rec: AudioRecord) => {
    notify("Elimina audio", `Vuoi rimuovere questa nota vocale del ${fmtDate(rec.created_at)}?`, [
      { text: "Annulla", style: "cancel" },
      { text: "Elimina", style: "destructive", onPress: async () => {
        try {
          if (playingId === rec.audio_id) stopPlayback();
          await api(`/audio-records/${rec.audio_id}`, { method: "DELETE" });
          await load();
        } catch (e: any) { notify("Errore", e?.message || ""); }
      }},
    ]);
  };

  if (loading) return <ActivityIndicator style={{ marginTop: 30 }} color={HT.brand} />;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
      <View style={styles.introCard}>
        <Ionicons name="mic" size={20} color="#7C3AED" />
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={styles.introTitle}>Audio e Note Vocali</Text>
          <Text style={styles.introTxt}>
            Note vocali registrate dal Master e assegnate a questo cliente. Registra nuovi audio dall&apos;Interfaccia Master.
          </Text>
        </View>
      </View>

      {items.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="mic-outline" size={48} color={HT.muted} />
          <Text style={styles.emptyTitle}>Nessuna nota vocale</Text>
          <Text style={styles.emptyTxt}>
            Vai su &quot;Interfaccia Master&quot; → tocca il microfono → scegli &quot;Cartella audio di un cliente&quot; e seleziona questo contatto.
          </Text>
        </View>
      ) : (
        items.map((rec) => {
          const isPlaying = playingId === rec.audio_id;
          const isBusy = busyId === rec.audio_id;
          return (
            <View key={rec.audio_id} style={styles.card} testID={`audio-card-${rec.audio_id}`}>
              <Pressable
                onPress={() => playAudio(rec)}
                disabled={isBusy}
                style={[styles.playBtn, { backgroundColor: isPlaying ? "#DC2626" : "#7C3AED" }]}
                testID={`audio-play-${rec.audio_id}`}
              >
                {isBusy ? <ActivityIndicator color="#FFF" size="small" /> : (
                  <Ionicons name={isPlaying ? "pause" : "play"} size={22} color="#FFF" />
                )}
              </Pressable>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.title} numberOfLines={1}>
                  {rec.title || "Nota vocale"}
                </Text>
                <View style={styles.metaRow}>
                  <Ionicons name="calendar-outline" size={12} color={HT.muted} />
                  <Text style={styles.metaTxt}>{fmtDateTime(rec.created_at)}</Text>
                  {typeof rec.duration_sec === "number" && rec.duration_sec > 0 && (
                    <>
                      <Text style={styles.metaSep}>·</Text>
                      <Ionicons name="time-outline" size={12} color={HT.muted} />
                      <Text style={styles.metaTxt}>{fmtDuration(rec.duration_sec)}</Text>
                    </>
                  )}
                </View>
                {isPlaying && <Text style={styles.playingHint}>▸ In riproduzione…</Text>}
              </View>
              <Pressable onPress={() => remove(rec)} style={styles.trashBtn} testID={`audio-delete-${rec.audio_id}`}>
                <Ionicons name="trash-outline" size={18} color="#DC2626" />
              </Pressable>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

function fmtDate(iso?: string) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return iso; }
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
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

const styles = StyleSheet.create({
  introCard: { flexDirection: "row", alignItems: "flex-start", backgroundColor: HT.violetTint, padding: 12, borderRadius: 12, marginBottom: 16 },
  introTitle: { fontSize: 13, fontWeight: "800", color: "#7C3AED" },
  introTxt: { fontSize: 11, color: HT.muted, marginTop: 2, lineHeight: 15 },
  empty: { alignItems: "center", padding: 40, marginTop: 20 },
  emptyTitle: { fontSize: 15, fontWeight: "800", color: HT.text, marginTop: 12 },
  emptyTxt: { fontSize: 12, color: HT.muted, marginTop: 6, textAlign: "center", lineHeight: 16 },
  card: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: HT.card2, borderRadius: 12, padding: 12, marginBottom: 10,
    borderWidth: 1, borderColor: HT.border,
  },
  playBtn: {
    width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 3, shadowOffset: { width: 0, height: 2 }, elevation: 3,
  },
  title: { fontSize: 13, fontWeight: "700", color: HT.text },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 4 },
  metaTxt: { fontSize: 11, color: HT.muted },
  metaSep: { fontSize: 11, color: HT.muted, marginHorizontal: 4 },
  playingHint: { fontSize: 10, color: "#DC2626", fontWeight: "800", marginTop: 3 },
  trashBtn: { padding: 8 },
});

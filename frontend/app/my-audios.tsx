import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Platform, TextInput, Modal } from "react-native";
import { KScrollView, KModalBody } from "@/src/ui/keyboard"; // V50.z374 — tastiera: campo attivo sempre visibile
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { api, buildFileUrl } from "@/src/api";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

// V50.z205 — Fase 4 Spazio Personale: sfera (Privata/Aziendale) + trascrizione automatica (Whisper + Haiku)
type Sphere = "business" | "home" | "unclassified";
const SPHERE_ICON: Record<Sphere, string> = { business: "🔵", home: "🟢", unclassified: "⚪" };
const SPHERE_LABEL: Record<Sphere, string> = { business: "Aziendale", home: "Privata", unclassified: "Da classificare" };
const SPHERE_COLOR: Record<Sphere, string> = { business: "#2563EB", home: "#059669", unclassified: HT.muted };
const FILTERS: Array<{ key: "all" | Sphere; label: string }> = [
  { key: "all", label: "Tutti" }, { key: "home", label: "🟢 Private" }, { key: "business", label: "🔵 Aziendali" }, { key: "unclassified", label: "⚪ Da classificare" },
];

type AudioRecord = {
  audio_id: string;
  target_type: string;
  mime?: string;
  duration_sec?: number;
  size_bytes?: number;
  title?: string | null;
  created_at: string;
  sphere?: Sphere;
  transcribe_status?: "pending" | "processing" | "ready" | "error" | null;
  transcript?: string | null;
  summary?: string | null;
  tags?: string[];
  actions?: string[];
  suggested_sphere?: Sphere | null;
  transcribe_error?: string | null;
};

export default function MyAudiosScreen() {
  const router = useRouter();
  const [items, setItems] = useState<AudioRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [renameFor, setRenameFor] = useState<AudioRecord | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [filter, setFilter] = useState<"all" | Sphere>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const audioElRef = useRef<any>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: AudioRecord[] }>("/audio-records?target_type=personal");
      setItems(r.items);
    } catch (e) { console.warn(e); } finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Polling leggero finché c'è una trascrizione in corso
  const processing = items.some((i) => i.transcribe_status === "processing" || i.transcribe_status === "pending");
  useEffect(() => {
    if (!processing) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [processing, load]);

  useEffect(() => {
    return () => {
      if (audioElRef.current) { try { audioElRef.current.pause?.(); audioElRef.current.remove?.(); } catch {} audioElRef.current = null; }
    };
  }, []);

  const stopPlayback = () => {
    if (audioElRef.current) { try { audioElRef.current.pause?.(); audioElRef.current.remove?.(); } catch {} audioElRef.current = null; }
    setPlayingId(null);
  };

  const play = async (rec: AudioRecord) => {
    if (playingId === rec.audio_id) { stopPlayback(); return; }
    stopPlayback();
    try {
      setBusyId(rec.audio_id);
      const url = await buildFileUrl(`/audio-records/${rec.audio_id}/file`);
      if (Platform.OS === "web") {
        const el = new (globalThis as any).Audio(url);
        audioElRef.current = el;
        el.onended = () => setPlayingId(null);
        el.onerror = () => { setPlayingId(null); notify("Errore", "Playback fallito"); };
        await el.play();
      } else {
        const AudioMod: any = await import("expo-audio");
        const player = AudioMod.createAudioPlayer({ uri: url });
        audioElRef.current = player;
        player.addListener?.("playbackStatusUpdate", (s: any) => { if (s?.didJustFinish) setPlayingId(null); });
        player.play();
      }
      setPlayingId(rec.audio_id);
    } catch (e: any) { notify("Errore", e?.message || ""); } finally { setBusyId(null); }
  };

  const setSphere = async (rec: AudioRecord, sphere: Sphere) => {
    try {
      const r = await api<{ reply: string }>(`/audio-records/${rec.audio_id}/sphere`, { method: "PUT", body: { sphere } });
      setItems((prev) => prev.map((i) => (i.audio_id === rec.audio_id ? { ...i, sphere } : i)));
      notify("Axon", r.reply);
    } catch (e: any) { notify("Errore", e?.message || ""); }
  };

  const transcribe = async (rec: AudioRecord) => {
    try {
      await api(`/audio-records/${rec.audio_id}/transcribe`, { method: "POST" });
      setItems((prev) => prev.map((i) => (i.audio_id === rec.audio_id ? { ...i, transcribe_status: "processing" } : i)));
    } catch (e: any) { notify("Errore", e?.message || ""); }
  };

  const visible = filter === "all" ? items : items.filter((i) => (i.sphere || "unclassified") === filter);
  const counts = items.reduce((acc, i) => { const k = (i.sphere || "unclassified") as Sphere; acc[k] = (acc[k] || 0) + 1; return acc; }, {} as Record<Sphere, number>);

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
        <Pressable onPress={() => router.back()} style={styles.headerBtn}><Ionicons name="chevron-back" size={22} color={HT.text} /></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>I miei audio</Text>
          <Text style={styles.headerSub}>🟢 Spazio Personale · {items.length} note vocali · trascrizione automatica</Text>
        </View>
        <Pressable onPress={() => router.push("/spazio-personale" as any)} style={styles.headerBtn} hitSlop={6} testID="my-audios-hub">
          <Ionicons name="home-outline" size={18} color="#059669" />
        </Pressable>
      </View>

      {!loading && items.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {FILTERS.map((f) => {
            const on = filter === f.key;
            const n = f.key === "all" ? items.length : counts[f.key] || 0;
            return (
              <Pressable key={f.key} onPress={() => setFilter(f.key)} style={[styles.chip, on && styles.chipOn]} testID={`my-audios-filter-${f.key}`}>
                <Text style={[styles.chipTxt, on && styles.chipTxtOn]}>{f.label} · {n}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={HT.brand} />
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="folder-open-outline" size={54} color={HT.muted} />
          <Text style={styles.emptyTitle}>Nessun audio personale</Text>
          <Text style={styles.emptyTxt}>Registra un audio dall&apos;Interfaccia Master e scegli &quot;Cartella personale&quot; come destinazione. Axon lo trascrive automaticamente.</Text>
          <Pressable onPress={() => router.push("/master" as any)} style={styles.recordBtn}>
            <Ionicons name="mic" size={18} color="#FFF" />
            <Text style={styles.recordTxt}>Registra ora</Text>
          </Pressable>
        </View>
      ) : (
        <KScrollView contentContainerStyle={{ padding: 16, paddingBottom: 140 }}>
          {visible.length === 0 && <Text style={styles.noneTxt}>Nessun audio in questa sfera.</Text>}
          {visible.map((rec) => {
            const isPlaying = playingId === rec.audio_id;
            const isBusy = busyId === rec.audio_id;
            const sphere = (rec.sphere || "unclassified") as Sphere;
            const st = rec.transcribe_status;
            const expanded = expandedId === rec.audio_id;
            return (
              <View key={rec.audio_id} style={styles.card} testID={`my-audio-${rec.audio_id}`}>
                <View style={styles.cardRow}>
                  <Pressable onPress={() => play(rec)} disabled={isBusy} style={[styles.playBtn, { backgroundColor: isPlaying ? "#DC2626" : "#7C3AED" }]} testID={`my-audio-play-${rec.audio_id}`}>
                    {isBusy ? <ActivityIndicator color="#FFF" size="small" /> : <Ionicons name={isPlaying ? "pause" : "play"} size={22} color="#FFF" />}
                  </Pressable>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.title} numberOfLines={1}>{rec.title || "Nota vocale"}</Text>
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
                  <Pressable onPress={() => openRename(rec)} style={styles.iconBtn} testID={`my-audio-rename-${rec.audio_id}`}>
                    <Ionicons name="create-outline" size={18} color="#0891B2" />
                  </Pressable>
                  <Pressable onPress={() => remove(rec)} style={styles.iconBtn} testID={`my-audio-delete-${rec.audio_id}`}>
                    <Ionicons name="trash-outline" size={18} color="#DC2626" />
                  </Pressable>
                </View>

                {/* Sfera: un tap per classificare */}
                <View style={styles.sphereRow}>
                  <Text style={[styles.sphereNow, { color: SPHERE_COLOR[sphere] }]}>{SPHERE_ICON[sphere]} {SPHERE_LABEL[sphere]}</Text>
                  {(["home", "business"] as Sphere[]).filter((s) => s !== sphere).map((s) => (
                    <Pressable key={s} onPress={() => setSphere(rec, s)} style={[styles.sphereBtn, { borderColor: SPHERE_COLOR[s] }]} testID={`my-audio-sphere-${s}-${rec.audio_id}`}>
                      <Text style={[styles.sphereBtnTxt, { color: SPHERE_COLOR[s] }]}>{SPHERE_ICON[s]} {sphere === "unclassified" ? SPHERE_LABEL[s] : `Sposta in ${SPHERE_LABEL[s]}`}</Text>
                    </Pressable>
                  ))}
                  {sphere === "unclassified" && rec.suggested_sphere && (
                    <Text style={styles.suggestTxt}>Axon suggerisce: {SPHERE_ICON[rec.suggested_sphere]} {SPHERE_LABEL[rec.suggested_sphere]}</Text>
                  )}
                </View>

                {/* Trascrizione */}
                {st === "processing" || st === "pending" ? (
                  <View style={styles.trRow}><ActivityIndicator size="small" color="#7C3AED" /><Text style={styles.trHint}>Axon sta trascrivendo…</Text></View>
                ) : st === "ready" ? (
                  <Pressable onPress={() => setExpandedId(expanded ? null : rec.audio_id)} style={styles.trBox} testID={`my-audio-transcript-${rec.audio_id}`}>
                    {rec.summary ? <Text style={styles.trSummary} numberOfLines={expanded ? undefined : 2}>{rec.summary}</Text> : null}
                    {expanded && rec.transcript ? <Text style={styles.trText}>{rec.transcript}</Text> : null}
                    {expanded && rec.actions && rec.actions.length > 0 && (
                      <Text style={styles.trActions}>Da fare: {rec.actions.join(" · ")}</Text>
                    )}
                    {rec.tags && rec.tags.length > 0 && <Text style={styles.trTags}>{rec.tags.map((t) => `#${t}`).join("  ")}</Text>}
                    <Text style={styles.trMore}>{expanded ? "▴ Riduci" : "▾ Leggi trascrizione"}</Text>
                  </Pressable>
                ) : (
                  <Pressable onPress={() => transcribe(rec)} style={styles.trRow} testID={`my-audio-transcribe-${rec.audio_id}`}>
                    <Ionicons name="text-outline" size={14} color="#7C3AED" />
                    <Text style={[styles.trHint, { color: "#7C3AED", fontWeight: "800" }]}>{st === "error" ? "Trascrizione non riuscita · Riprova" : "Trascrivi con Axon"}</Text>
                  </Pressable>
                )}
              </View>
            );
          })}
        </KScrollView>
      )}

      <Modal transparent visible={!!renameFor} animationType="fade" onRequestClose={() => setRenameFor(null)}><KModalBody>
        <View style={styles.modalRoot}>
          <View style={styles.modalBox}>
            <Text style={styles.modalT}>Rinomina audio</Text>
            <TextInput value={renameVal} onChangeText={setRenameVal} style={styles.input} autoFocus placeholder="Nome file" testID="rename-input" />
            <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
              <Pressable onPress={() => setRenameFor(null)} style={[styles.modalBtn, { backgroundColor: HT.card2, flex: 1 }]} testID="rename-cancel">
                <Text style={[styles.modalBtnTxt, { color: HT.text }]}>Annulla</Text>
              </Pressable>
              <Pressable onPress={saveRename} style={[styles.modalBtn, { backgroundColor: '#7C3AED', flex: 1 }]} testID="rename-save">
                <Text style={[styles.modalBtnTxt, { color: "#FFF" }]}>Salva</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </KModalBody></Modal>
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
  header: { flexDirection: "row", alignItems: "center", padding: 14, gap: 10, borderBottomWidth: 1, borderBottomColor: HT.border, backgroundColor: HT.card2 },
  // V29.bc — Stile Optima
  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: HT.card2,
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
  headerTitle: { fontSize: 16, fontWeight: "800", color: HT.text },
  headerSub: { fontSize: 11, color: HT.muted, marginTop: 1 },
  empty: { alignItems: "center", padding: 40, marginTop: 40 },
  emptyTitle: { fontSize: 16, fontWeight: "800", color: HT.text, marginTop: 14 },
  emptyTxt: { fontSize: 12, color: HT.muted, marginTop: 6, textAlign: "center", lineHeight: 16 },
  recordBtn: { marginTop: 24, flexDirection: "row", gap: 8, alignItems: "center", backgroundColor: '#7C3AED', paddingHorizontal: 18, paddingVertical: 12, borderRadius: 12 },
  recordTxt: { color: "#FFF", fontWeight: "800", fontSize: 13 },
  card: { backgroundColor: HT.card2, borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: HT.border },
  cardRow: { flexDirection: "row", alignItems: "center" },
  filterRow: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  chip: { paddingHorizontal: 12, minHeight: 36, borderRadius: 999, backgroundColor: HT.card2, justifyContent: "center", borderWidth: 1, borderColor: HT.border },
  chipOn: { backgroundColor: HT.successTint, borderColor: '#059669' },
  chipTxt: { fontSize: 12, fontWeight: "700", color: HT.text2 },
  chipTxtOn: { color: HT.success },
  noneTxt: { textAlign: "center", color: HT.muted, fontSize: 12.5, marginTop: 30 },
  sphereRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 10 },
  sphereNow: { fontSize: 12, fontWeight: "800" },
  sphereBtn: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, minHeight: 32, justifyContent: "center", backgroundColor: HT.card },
  sphereBtnTxt: { fontSize: 11.5, fontWeight: "800" },
  suggestTxt: { fontSize: 11, color: "#7C3AED", fontStyle: "italic" },
  trRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10, minHeight: 36 },
  trHint: { fontSize: 12, color: HT.muted },
  trBox: { marginTop: 10, backgroundColor: HT.violetTint, borderRadius: 10, padding: 10, gap: 6 },
  trSummary: { fontSize: 13, color: HT.text, lineHeight: 18 },
  trText: { fontSize: 12.5, color: HT.text2, lineHeight: 18, borderTopWidth: 1, borderTopColor: '#E9D5FF', paddingTop: 6 },
  trActions: { fontSize: 12, color: HT.warning, fontWeight: "700" },
  trTags: { fontSize: 11, color: "#7C3AED", fontWeight: "700" },
  trMore: { fontSize: 11, color: "#7C3AED", fontWeight: "800", textAlign: "right" },
  playBtn: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 3, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  title: { fontSize: 13, fontWeight: "700", color: HT.text },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 4 },
  metaTxt: { fontSize: 11, color: HT.muted },
  metaSep: { fontSize: 11, color: HT.muted, marginHorizontal: 4 },
  playingHint: { fontSize: 10, color: "#DC2626", fontWeight: "800", marginTop: 3 },
  iconBtn: { padding: 8 },
  modalRoot: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", padding: 20 },
  modalBox: { backgroundColor: HT.card, borderRadius: 16, padding: 18 },
  modalT: { fontSize: 15, fontWeight: "800", color: HT.text, marginBottom: 12 },
  input: { borderWidth: 1, borderColor: HT.border, borderRadius: 10, padding: 12, fontSize: 14, color: HT.text, backgroundColor: HT.card2 },
  modalBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", padding: 12, borderRadius: 10 },
  modalBtnTxt: { fontWeight: "800", fontSize: 13 },
});

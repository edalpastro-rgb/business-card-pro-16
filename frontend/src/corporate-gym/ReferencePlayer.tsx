// ReferencePlayer.tsx — V50.z388 — Player AUDIO nativo in app (expo-audio) per le registrazioni "Trattativa reale":
// prima l'audio veniva aperto in una WebView (su Android non riproduce i file audio → «non riproducibile»).
// Solo riproduzione: nessun download. Il video continua a usare il webviewer (player nativo del sistema).
import React, { useEffect } from "react";
import { Modal, View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { HT } from "@/src/homeTheme";

const fmt = (sec: number) => { const s = Math.max(0, Math.floor(sec || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

export function ReferencePlayer({ url, title, color, onClose }: { url: string | null; title: string; color?: string; onClose: () => void }) {
  const player = useAudioPlayer(url ? { uri: url } : null, { updateInterval: 250 });
  const st = useAudioPlayerStatus(player);
  const accent = color || HT.violet;

  useEffect(() => { if (url) { try { player.play(); } catch { /* autoplay negato: l'utente preme play */ } } }, [url]); // eslint-disable-line react-hooks/exhaustive-deps

  const skip = (d: number) => { void player.seekTo(Math.max(0, Math.min(st.duration || 0, (st.currentTime || 0) + d))); };
  const pct = st.duration ? Math.min(100, (st.currentTime / st.duration) * 100) : 0;

  return (
    <Modal visible={!!url} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} testID="cgym-player-backdrop" />
      <View style={s.sheet} testID="cgym-player">
        <View style={s.head}>
          <Ionicons name="musical-notes" size={20} color={accent} />
          <Text style={s.title} numberOfLines={2}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={10} testID="cgym-player-close"><Ionicons name="close" size={24} color={HT.text} /></Pressable>
        </View>
        {!st.isLoaded ? (
          <View style={s.loading}><ActivityIndicator color={accent} /><Text style={s.meta}>Carico l'audio…</Text></View>
        ) : (
          <>
            <View style={s.track}><View style={[s.fill, { width: `${pct}%`, backgroundColor: accent }]} /></View>
            <View style={s.times}><Text style={s.meta}>{fmt(st.currentTime)}</Text><Text style={s.meta}>{fmt(st.duration)}</Text></View>
            <View style={s.controls}>
              <Pressable onPress={() => skip(-15)} style={s.side} hitSlop={8} testID="cgym-player-back15"><Ionicons name="play-back" size={26} color={HT.text} /><Text style={s.sideTxt}>15s</Text></Pressable>
              <Pressable onPress={() => (st.playing ? player.pause() : player.play())} style={[s.play, { backgroundColor: accent }]} testID="cgym-player-toggle">
                <Ionicons name={st.playing ? "pause" : "play"} size={32} color="#FFF" />
              </Pressable>
              <Pressable onPress={() => skip(15)} style={s.side} hitSlop={8} testID="cgym-player-fwd15"><Ionicons name="play-forward" size={26} color={HT.text} /><Text style={s.sideTxt}>15s</Text></Pressable>
            </View>
          </>
        )}
        <Text style={s.note}>Solo riproduzione in app · non scaricabile</Text>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { backgroundColor: HT.card, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18, paddingBottom: 34, gap: 12 },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { flex: 1, fontSize: 15, fontWeight: "800", color: HT.text },
  loading: { alignItems: "center", gap: 8, paddingVertical: 20 },
  track: { height: 6, borderRadius: 3, backgroundColor: HT.card2, overflow: "hidden" }, fill: { height: 6, borderRadius: 3 },
  times: { flexDirection: "row", justifyContent: "space-between" },
  meta: { fontSize: 12, color: HT.muted, fontWeight: "700" },
  controls: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 28, marginTop: 4 },
  play: { width: 68, height: 68, borderRadius: 34, alignItems: "center", justifyContent: "center" },
  side: { alignItems: "center", minWidth: 48, minHeight: 48, justifyContent: "center" }, sideTxt: { fontSize: 10, color: HT.muted, fontWeight: "800" },
  note: { fontSize: 11, color: HT.muted, textAlign: "center" },
});

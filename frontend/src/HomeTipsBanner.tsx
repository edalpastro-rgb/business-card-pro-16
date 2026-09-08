// V50.z104 — Banner "CONSIGLI UTILIZZO" per la home.
// Mostra i suggerimenti/broadcast attivi con dismiss.

import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Linking } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { theme } from "@/src/theme";

type Tip = {
  tip_id: string;
  feature: string;
  feature_label: string;
  video_url: string;
  message: string;
  kind: "auto" | "broadcast" | string;
  created_at: string;
};

export function HomeTipsBanner() {
  const [tips, setTips] = useState<Tip[]>([]);
  const [dismissing, setDismissing] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: Tip[] }>(`/tips/home`);
      setTips(r?.items || []);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, 60_000);
    return () => clearInterval(iv);
  }, [load]);

  const dismiss = async (tip_id: string) => {
    setDismissing(tip_id);
    try {
      await api(`/tips/${tip_id}/dismiss`, { method: "POST", body: { dismissed: true } });
      setTips(prev => prev.filter(t => t.tip_id !== tip_id));
    } catch { /* silent */ } finally {
      setDismissing(null);
    }
  };

  if (tips.length === 0) return null;
  const tip = tips[0];
  const isBroadcast = tip.kind === "broadcast";

  return (
    <View style={styles.wrap} testID="home-tips-banner">
      <View style={styles.header}>
        <View style={[styles.iconBox, { backgroundColor: isBroadcast ? "#8B5CF6" : "#F59E0B" }]}>
          <Ionicons name={isBroadcast ? "megaphone" : "bulb"} size={16} color="#FFF" />
        </View>
        <Text style={styles.headerTxt}>
          {isBroadcast ? "AGGIORNAMENTO" : "CONSIGLI UTILIZZO"}
          {tips.length > 1 ? ` (${tips.length})` : ""}
        </Text>
        <Pressable
          onPress={() => dismiss(tip.tip_id)}
          disabled={dismissing === tip.tip_id}
          style={styles.dismissBtn}
          testID="dismiss-tip"
          hitSlop={10}
        >
          <Ionicons name="close" size={16} color={theme.color.muted} />
        </Pressable>
      </View>
      {tip.feature_label && isBroadcast ? (
        <Text style={styles.subject}>{tip.feature_label}</Text>
      ) : null}
      <Text style={styles.msg}>{tip.message}</Text>
      {tip.video_url ? (
        <Pressable
          style={styles.videoBtn}
          onPress={() => Linking.openURL(tip.video_url)}
          testID="tip-video-btn"
        >
          <Ionicons name="play-circle" size={16} color="#FFF" />
          <Text style={styles.videoBtnTxt}>Guarda tutorial</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: 12,
    marginBottom: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: theme.color.surfaceSecondary,
    borderWidth: 1,
    borderColor: "#F59E0B44",
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  iconBox: {
    width: 24, height: 24, borderRadius: 6,
    alignItems: "center", justifyContent: "center",
  },
  headerTxt: { flex: 1, fontSize: 11, fontWeight: "800", color: theme.color.onSurface, letterSpacing: 0.4 },
  dismissBtn: { padding: 4 },
  subject: { fontSize: 14, fontWeight: "800", color: theme.color.onSurface, marginBottom: 4 },
  msg: { fontSize: 13, color: theme.color.onSurface, lineHeight: 18 },
  videoBtn: {
    marginTop: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 8, borderRadius: 8, backgroundColor: theme.color.brandPrimary,
    alignSelf: "flex-start", paddingHorizontal: 14,
  },
  videoBtnTxt: { color: "#FFF", fontWeight: "700", fontSize: 12 },
});

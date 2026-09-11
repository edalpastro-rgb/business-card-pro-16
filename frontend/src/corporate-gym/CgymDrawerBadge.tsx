// Corporate Gym — indicatore di completamento nel drawer ("3/7" sessioni assegnate); nascosto se nulla è assegnato.
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { cgymApi, CGYM_ORANGE } from "@/src/corporate-gym/api";

export function CgymDrawerBadge() {
  const [v, setV] = useState<{ done: number; total: number } | null>(null);
  useEffect(() => {
    cgymApi.summary()
      .then((s) => setV(s.assigned_total > 0 ? { done: s.assigned_done, total: s.assigned_total } : null))
      .catch(() => setV(null));
  }, []);
  if (!v) return null;
  const complete = v.done >= v.total;
  return (
    <View style={[styles.badge, complete && styles.badgeDone]} testID="cgym-drawer-badge">
      <Text style={styles.txt}>{v.done}/{v.total}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { backgroundColor: CGYM_ORANGE, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, marginRight: 6 },
  badgeDone: { backgroundColor: "#0F9D58" },
  txt: { color: "#FFF", fontSize: 11, fontWeight: "800" },
});

export default CgymDrawerBadge;

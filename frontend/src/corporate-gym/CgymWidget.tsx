// Corporate Gym — widget Home: sessioni in scadenza (7 gg) + progress del giorno.
import React, { useCallback, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { theme } from "@/src/theme";
import { cgymApi, CgymSummary, CGYM_TYPE_META, fmtCgymDate, isPast, CGYM_ORANGE } from "@/src/corporate-gym/api";

export function CgymWidget() {
  const router = useRouter();
  const [data, setData] = useState<CgymSummary | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await cgymApi.summary());
      setError(false);
    } catch {
      setError(true);
    }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const total = data?.today_total ?? 0;
  const done = data?.today_done ?? 0;
  const pct = total > 0 ? Math.min(1, done / total) : 0;
  const upcoming = (data?.due_soon || []).slice(0, 3);

  return (
    <Pressable style={styles.card} onPress={() => router.push("/corporate-gym" as any)} testID="widget-cgym">
      <View style={styles.head}>
        <View style={[styles.iconWrap, { backgroundColor: CGYM_ORANGE + "22" }]}>
          <Ionicons name="barbell" size={18} color={CGYM_ORANGE} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Corporate Gym</Text>
          <Text style={styles.sub}>
            {error ? "Non disponibile" : total > 0 ? `Oggi: ${done}/${total} sessioni completate` : "Nessuna sessione oggi"}
          </Text>
        </View>
        {data && data.mandatory_pending > 0 ? (
          <View style={styles.badge} testID="widget-cgym-mandatory">
            <Text style={styles.badgeTxt}>{data.mandatory_pending} obbl.</Text>
          </View>
        ) : null}
        <Ionicons name="chevron-forward" size={18} color={theme.color.muted} />
      </View>

      {total > 0 && (
        <View style={styles.barBg} testID="widget-cgym-progress">
          <View style={[styles.barFill, { width: `${Math.round(pct * 100)}%`, backgroundColor: pct >= 1 ? theme.color.success : CGYM_ORANGE }]} />
        </View>
      )}

      {data && data.assigned_total > 0 && (
        <View style={styles.assignedRow} testID="widget-cgym-assigned">
          <Ionicons name="person-circle-outline" size={14} color={theme.color.brandPrimary} />
          <Text style={styles.assignedTxt}>Assegnate dal Master: {data.assigned_done}/{data.assigned_total} completate</Text>
          <View style={styles.assignedBarBg}>
            <View style={[styles.assignedBarFill, { width: `${Math.round((data.assigned_done / data.assigned_total) * 100)}%` }]} />
          </View>
        </View>
      )}

      {upcoming.length > 0 ? (
        <View style={styles.list}>
          <Text style={styles.listHead}>In scadenza (7 giorni) · {data?.due_soon_count}</Text>
          {upcoming.map((s) => {
            const meta = CGYM_TYPE_META[s.type];
            const late = isPast(s.scheduled_at);
            return (
              <View key={s.session_id} style={styles.row} testID={`widget-cgym-row-${s.session_id}`}>
                <Ionicons name={meta.icon as any} size={14} color={meta.color} />
                <Text style={styles.rowTitle} numberOfLines={1}>{s.title || meta.label}</Text>
                {s.mandatory ? <Ionicons name="alert-circle" size={13} color={CGYM_ORANGE} /> : null}
                <Text style={[styles.rowDate, late && { color: theme.color.error }]}>{late ? "In ritardo · " : ""}{fmtCgymDate(s.scheduled_at)}</Text>
              </View>
            );
          })}
        </View>
      ) : (
        !error && <Text style={styles.empty}>Nessuna sessione in scadenza nei prossimi 7 giorni</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: 12,
    marginBottom: 10,
  },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  iconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 14, fontWeight: "800", color: theme.color.onSurface },
  sub: { fontSize: 12, color: theme.color.muted, marginTop: 1 },
  badge: { backgroundColor: CGYM_ORANGE, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  badgeTxt: { color: "#FFF", fontSize: 11, fontWeight: "800" },
  barBg: { height: 6, borderRadius: 3, backgroundColor: theme.color.surfaceTertiary, marginTop: 10, overflow: "hidden" },
  barFill: { height: 6, borderRadius: 3 },
  assignedRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10, flexWrap: "wrap" },
  assignedTxt: { fontSize: 12, color: theme.color.onSurface, fontWeight: "700", flex: 1 },
  assignedBarBg: { width: "100%", height: 4, borderRadius: 2, backgroundColor: theme.color.surfaceTertiary, overflow: "hidden" },
  assignedBarFill: { height: 4, borderRadius: 2, backgroundColor: theme.color.brandPrimary },
  list: { marginTop: 10, gap: 6 },
  listHead: { fontSize: 11, fontWeight: "800", color: theme.color.muted, textTransform: "uppercase", letterSpacing: 0.4 },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  rowTitle: { flex: 1, flexShrink: 1, fontSize: 13, color: theme.color.onSurface, fontWeight: "600" },
  rowDate: { fontSize: 11, color: theme.color.muted, fontWeight: "700", flexShrink: 0 },
  empty: { fontSize: 12, color: theme.color.muted, marginTop: 8 },
});

export default CgymWidget;

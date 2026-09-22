import { useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/src/theme";

/**
 * Small header widget that shows the current date + time synchronised
 * with the device clock (updates every 30 seconds). Uses Intl for
 * automatic locale/timezone formatting.
 */
export function NowBadge({ compact = false }: { compact?: boolean }) {
  const [now, setNow] = useState<Date>(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  const date = now.toLocaleDateString("it-IT", {
    weekday: compact ? "short" : "long",
    day: "2-digit",
    month: compact ? "short" : "long",
  });
  const time = now.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });

  if (compact) {
    return (
      <View style={styles.compact}>
        <Ionicons name="time" size={12} color={theme.color.muted} />
        <Text style={styles.compactText}>{date} · {time}</Text>
      </View>
    );
  }
  return (
    <View style={styles.wrap}>
      <View style={styles.iconRing}>
        <Ionicons name="time" size={14} color="#FFF" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.date}>{date}</Text>
        <Text style={styles.time}>{time}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: theme.color.brandTertiary, borderRadius: 20, alignSelf: "flex-start" },
  iconRing: { width: 24, height: 24, borderRadius: 12, backgroundColor: theme.color.brandPrimary, alignItems: "center", justifyContent: "center" },
  date: { fontSize: 11, color: theme.color.onSurfaceSecondary, fontWeight: "600", textTransform: "capitalize" },
  time: { fontSize: 13, color: theme.color.brandPrimary, fontWeight: "800" },
  compact: { flexDirection: "row", alignItems: "center", gap: 4 },
  compactText: { fontSize: 11, color: theme.color.muted, fontWeight: "600", textTransform: "capitalize" },
});

// Badge "non lette" delle notifiche AxonOS nel drawer (V50.z181); nascosto se 0.
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useAxnUnread } from "@/src/axonNotifications";

export function AxnDrawerBadge() {
  const { unread } = useAxnUnread(true);
  if (!unread) return null;
  return (
    <View style={styles.badge} testID="axn-drawer-badge">
      <Text style={styles.txt}>{unread > 99 ? "99+" : unread}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { backgroundColor: "#DC2626", borderRadius: 999, minWidth: 22, paddingHorizontal: 6, paddingVertical: 2, marginRight: 6, alignItems: "center" },
  txt: { color: "#FFF", fontSize: 11, fontWeight: "900" },
});

/** Sincronizza il badge dell'icona app con le non lette (montato una volta nel layout radice, dopo il login). */
export function AxnBadgeSync({ enabled }: { enabled: boolean }) {
  useAxnUnread(enabled);
  return null;
}

export default AxnDrawerBadge;

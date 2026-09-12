// V50.z192 — Card "Memoria AxonOS · Cosa sa Axon di me" (Profilo → Memoria AxonOS) — componente isolato.
import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

export function AxonMemoryEntryCard() {
  const router = useRouter();
  return (
    <Pressable onPress={() => router.push("/axon-memory" as any)} style={styles.card} testID="profile-axon-memory">
      <View style={styles.icon}><Ionicons name="sparkles" size={20} color="#FFF" /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>Memoria AxonOS</Text>
        <Text style={styles.sub}>Cosa sa Axon di me · preferenze, clienti chiave, stile di lavoro. Vedi, correggi o cancella tutto.</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color="#7C3AED" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#F5F3FF", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#DDD6FE" },
  icon: { width: 40, height: 40, borderRadius: 12, backgroundColor: "#7C3AED", alignItems: "center", justifyContent: "center" },
  title: { fontSize: 15, fontWeight: "800", color: "#1B2B4B" },
  sub: { fontSize: 12, color: "#64748B", marginTop: 2, lineHeight: 16 },
});

// tour-features.tsx — V50.z257 — «Scopri tutte le funzioni»: elenco pulito, solo nomi (nessuna spiegazione).
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";

const NAVY = "#0B1B33"; const SKY = "#38BDF8"; const MUTED = "#94A3B8";
type Group = { group: string; items: { id: string; name: string }[] };

export default function TourFeaturesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [groups, setGroups] = useState<Group[] | null>(null);
  useEffect(() => { api<{ groups: Group[] }>("/tour/features").then((r) => setGroups(r.groups || [])).catch(() => setGroups([])); }, []);
  return (
    <View style={[styles.root, { paddingTop: insets.top + 8, paddingBottom: insets.bottom }]} testID="tour-features">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back} testID="tour-features-back"><Ionicons name="arrow-back" size={22} color="#FFF" /></Pressable>
        <Text style={styles.title}>Tutte le funzioni</Text>
      </View>
      {!groups ? <ActivityIndicator color={SKY} style={{ marginTop: 40 }} /> : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 40, gap: 22 }}>
          {groups.map((g) => (
            <View key={g.group} style={{ gap: 6 }}>
              <Text style={styles.group}>{g.group}</Text>
              {g.items.map((it) => (
                <View key={it.id} style={styles.row} testID={`tour-feature-${it.id}`}><View style={styles.dot} /><Text style={styles.name}>{it.name}</Text></View>
              ))}
            </View>
          ))}
          <Text style={styles.foot}>Quello che non trovi, chiedi ad Axon.</Text>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: NAVY },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 10 },
  back: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.08)" },
  title: { color: "#FFF", fontSize: 20, fontWeight: "900" },
  group: { color: SKY, fontSize: 12, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 36 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: SKY },
  name: { color: "#FFF", fontSize: 16, fontWeight: "600" },
  foot: { color: MUTED, fontSize: 13, textAlign: "center", marginTop: 10 },
});

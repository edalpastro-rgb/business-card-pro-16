// win-win.tsx — V50.z400 — STRUTTURA UNICA: la sezione «winwin» usa la pagina AREA (sessione viso a viso con Axon, manuale,
// analisi registrazione, materiali) come ANT. Questa rotta storica reindirizza all'area corrispondente.
import React, { useEffect } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { cgaApi } from "@/src/corporate-gym/areasApi";
import { HT } from "@/src/homeTheme";

export default function Redirect() {
  const router = useRouter();
  useEffect(() => {
    cgaApi.areas().then((r) => {
      const a = r.items.find((x) => x.key === "winwin") || r.items[0];
      router.replace((a ? `/corporate-gym/area/${a.area_id}` : "/corporate-gym") as any);
    }).catch(() => router.replace("/corporate-gym" as any));
  }, [router]);
  return <View style={styles.root}><ActivityIndicator color={HT.violet} /></View>;
}

const styles = StyleSheet.create({ root: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: HT.bg } });

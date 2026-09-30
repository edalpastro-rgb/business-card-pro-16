// wake-word-training.tsx — V50.z410 — Voce «Addestramento wake-word Axon» (Home grid, menu, Axon Hub).
// Master/Super Master → pannello /admin/wake-samples (parole, statistiche, link condivisibile); collaboratori → pagina pubblica /wake-training.
import React, { useEffect } from "react";
import { View, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/src/auth";
import { HT } from "@/src/homeTheme";

export default function WakeWordTrainingRoute() {
  const router = useRouter();
  const { user, loading } = useAuth();
  useEffect(() => {
    if (loading) return;
    router.replace((user && !user.parent_user_id ? "/admin/wake-samples" : "/wake-training") as any);
  }, [loading, user, router]);
  return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: HT.bg }}><ActivityIndicator color={HT.violet} /></View>;
}

import { View, ActivityIndicator, StyleSheet } from "react-native";
import { Redirect } from "expo-router";
import { useAuth } from "@/src/auth";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

// V50.z540 — la route /landing è stata rimossa: all'avvio l'app va DIRETTAMENTE a /login (web e mobile), a /home se già autenticati.
export default function Index() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <View style={styles.center} testID="app-loading">
        <ActivityIndicator size="large" color={HT.brand} />
      </View>
    );
  }
  if (!user) return <Redirect href="/login" />;
  return <Redirect href="/(tabs)/home" />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: HT.card2 },
});

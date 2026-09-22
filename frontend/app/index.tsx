import { useEffect, useState } from "react";
import { View, ActivityIndicator, StyleSheet, Platform } from "react-native";
import { Redirect } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "@/src/auth";
import { theme } from "@/src/theme";
import { LANDING_SEEN_KEY } from "@/src/landing/landingSeen";

export default function Index() {
  const { user, loading } = useAuth();
  // V50.z314 — su telefono la landing pubblica si mostra al PRIMO avvio (prima del login); dalla seconda volta → login
  const [landingSeen, setLandingSeen] = useState<boolean | null>(Platform.OS === "web" ? false : null);
  useEffect(() => {
    if (Platform.OS === "web") return;
    AsyncStorage.getItem(LANDING_SEEN_KEY).then((v) => setLandingSeen(v === "1")).catch(() => setLandingSeen(true));
  }, []);

  if (loading || (!user && landingSeen === null)) {
    return (
      <View style={styles.center} testID="app-loading">
        <ActivityIndicator size="large" color={theme.color.brandPrimary} />
      </View>
    );
  }
  if (!user) {
    // Web: sempre la landing pubblica. Mobile: landing solo al primo avvio, poi direttamente il login.
    if (Platform.OS === "web" || !landingSeen) return <Redirect href="/landing" />;
    return <Redirect href="/login" />;
  }
  return <Redirect href="/(tabs)/home" />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.color.surface },
});

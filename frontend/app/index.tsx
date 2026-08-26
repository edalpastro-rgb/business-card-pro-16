import { useEffect } from "react";
import { View, ActivityIndicator, StyleSheet, Platform } from "react-native";
import { Redirect } from "expo-router";
import { useAuth } from "@/src/auth";
import { theme } from "@/src/theme";

export default function Index() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <View style={styles.center} testID="app-loading">
        <ActivityIndicator size="large" color={theme.color.brandPrimary} />
      </View>
    );
  }
  if (!user) {
    // Su web mostriamo la landing pubblica; su mobile andiamo direttamente al login
    if (Platform.OS === "web") return <Redirect href="/landing" />;
    return <Redirect href="/login" />;
  }
  return <Redirect href="/(tabs)/home" />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.color.surface },
});

// V50.z107 — WebViewer come route in (tabs) → mantiene bottom nav visibile
// Accessibile via router.push("/webviewer?url=...&title=...")

import React from "react";
import { View, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { InAppWebViewer } from "@/src/InAppWebViewer";

export default function WebViewerTab() {
  const router = useRouter();
  const params = useLocalSearchParams<{ url?: string; title?: string; contactId?: string }>();
  const url = decodeURIComponent(String(params.url || ""));
  const title = decodeURIComponent(String(params.title || "Link"));
  const contactId = params.contactId ? String(params.contactId) : undefined;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <InAppWebViewer
        url={url}
        title={title}
        contactId={contactId}
        hideFab
        onClose={() => {
          try { router.back(); } catch { router.replace("/(tabs)/home" as any); }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
});

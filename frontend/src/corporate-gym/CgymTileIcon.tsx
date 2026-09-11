// Corporate Gym — icona ufficiale di un'area (immagine remota con fallback Ionicons).
import React, { useState } from "react";
import { View, Image, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { CgymType, CGYM_TYPE_META } from "@/src/corporate-gym/api";

export function CgymTileIcon({ type, size = 64 }: { type: CgymType; size?: number }) {
  const meta = CGYM_TYPE_META[type];
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <View style={[styles.fallback, { width: size, height: size, borderRadius: size * 0.3, backgroundColor: meta.color + "22" }]}>
        <Ionicons name={meta.icon as any} size={size * 0.5} color={meta.color} />
      </View>
    );
  }
  return (
    <Image
      source={{ uri: meta.image }}
      style={{ width: size, height: size, borderRadius: size * 0.2 }}
      resizeMode="contain"
      onError={() => setFailed(true)}
      testID={`cgym-tile-icon-${type}`}
    />
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: "center", justifyContent: "center" },
});

export default CgymTileIcon;

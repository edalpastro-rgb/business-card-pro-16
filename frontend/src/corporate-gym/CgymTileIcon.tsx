// Corporate Gym — icona ufficiale di un'area (immagine remota, sempre intera e centrata; fallback Ionicons).
import React, { useState } from "react";
import { View, Image, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { CgymType, CGYM_TYPE_META } from "@/src/corporate-gym/api";

/** `fill`: occupa tutta la larghezza del contenitore (altezza = size) con l'immagine intera centrata (resizeMode contain). */
export function CgymTileIcon({ type, size = 64, fill = false }: { type: CgymType; size?: number; fill?: boolean }) {
  const meta = CGYM_TYPE_META[type];
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <View style={[styles.fallback, { width: fill ? "100%" : size, height: size, borderRadius: size * 0.3, backgroundColor: meta.color + "22" }]}>
        <Ionicons name={meta.icon as any} size={size * 0.5} color={meta.color} />
      </View>
    );
  }
  return (
    <View style={[styles.wrap, { width: fill ? "100%" : size, height: size }]}>
      <Image
        source={{ uri: meta.image }}
        style={{ width: "100%", height: "100%" }}
        resizeMode="contain"
        onError={() => setFailed(true)}
        testID={`cgym-tile-icon-${type}`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center", alignSelf: "center" },
  fallback: { alignItems: "center", justifyContent: "center", alignSelf: "center" },
});

export default CgymTileIcon;

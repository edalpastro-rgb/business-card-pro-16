// Corporate Gym — banner header (immagine fornita dall'utente) riutilizzato in tutte le pagine del modulo.
import React, { useState } from "react";
import { View, Image, StyleSheet, Text, ActivityIndicator } from "react-native";
import { CGYM_HEADER_IMAGE, CGYM_ORANGE } from "@/src/corporate-gym/api";

export function CgymHeaderBanner({ subtitle }: { subtitle?: string }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <View style={styles.wrap} testID="cgym-header-banner">
      {!failed ? (
        <Image
          source={{ uri: CGYM_HEADER_IMAGE }}
          style={styles.img}
          resizeMode="cover"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      ) : (
        <View style={[styles.img, styles.fallback]}>
          <Text style={styles.fallbackTxt}>CORPORATE GYM</Text>
        </View>
      )}
      {!loaded && !failed && (
        <View style={styles.loading} pointerEvents="none">
          <ActivityIndicator color={CGYM_ORANGE} />
        </View>
      )}
      {subtitle ? (
        <View style={styles.subWrap}>
          <Text style={styles.sub}>{subtitle}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: 16, overflow: "hidden", backgroundColor: "#0B1220", marginBottom: 14 },
  img: { width: "100%", aspectRatio: 2.2 },
  fallback: { alignItems: "center", justifyContent: "center", backgroundColor: "#0B1220" },
  fallbackTxt: { color: "#FFF", fontWeight: "900", fontSize: 22, letterSpacing: 2 },
  loading: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  subWrap: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.45)", paddingHorizontal: 12, paddingVertical: 6 },
  sub: { color: "#FFF", fontWeight: "800", fontSize: 12 },
});

export default CgymHeaderBanner;

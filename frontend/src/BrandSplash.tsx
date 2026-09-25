// src/BrandSplash.tsx — V50.z351 — Splash LEGGERA: fondo navy fisso di brand (identico allo splash nativo → nessun flash)
// e SOLO il logo AdvisorOS in dissolvenza (~1,2 s totali). Nessun anello, puntino, AxonOS o tagline.
// • Colori FISSI: mai colori tema qui (la regressione V50.z340 aveva reso lo sfondo bianco usando HT.text).
// • Prima apertura dopo l'installazione (nessun token salvato) → la splash viene saltata: login → Tour → nucleo Axon.
// • Una sola volta per sessione JS (ref a livello modulo).
import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Image } from "react-native";
import { getToken } from "@/src/api";

const _played = { current: false };
export const SPLASH_NAVY = "#0F2438"; // = expo.splash.backgroundColor in app.json
const LOGO_IN_MS = 380;
const HOLD_MS = 520;
const FADE_OUT_MS = 320;

export function BrandSplash({ onDone }: { onDone?: () => void }) {
  const [visible, setVisible] = useState(!_played.current);
  const overlay = useRef(new Animated.Value(1)).current;
  const logo = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (_played.current) return;
    let cancelled = false;
    const finish = () => { _played.current = true; if (!cancelled) { setVisible(false); onDone?.(); } };
    (async () => {
      let hasToken = false;
      try { hasToken = !!(await getToken()); } catch { hasToken = false; }
      if (cancelled) return;
      if (!hasToken) { finish(); return; } // primo avvio / utente non loggato → nessuna splash
      Animated.sequence([
        Animated.timing(logo, { toValue: 1, duration: LOGO_IN_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.delay(HOLD_MS),
        Animated.timing(overlay, { toValue: 0, duration: FADE_OUT_MS, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]).start(finish);
    })();
    return () => { cancelled = true; };
  }, [logo, overlay, onDone]);

  if (!visible) return null;
  return (
    <Animated.View style={[styles.root, { opacity: overlay }]} pointerEvents="none" testID="brand-splash">
      <Animated.View style={{ opacity: logo, transform: [{ scale: Animated.add(0.94, Animated.multiply(logo, 0.06)) }] }}>
        <Image source={require("@/assets/images/advisoros-logo-transparent.png")} style={styles.logo} resizeMode="contain" />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, zIndex: 9999, elevation: 9999, backgroundColor: SPLASH_NAVY, alignItems: "center", justifyContent: "center" },
  logo: { width: 240, height: 52 },
});

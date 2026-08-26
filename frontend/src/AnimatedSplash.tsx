import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View, Image } from "react-native";
import { ADVISOROS_LOGO_URI } from "@/src/BrandLogos";

/**
 * V29.o — AnimatedSplash.
 * Overlay full-screen mostrato UNA SOLA VOLTA per sessione app subito dopo
 * l'hide dello splash nativo di Expo. Micro-animazione di brand:
 *  1) Fondo navy brand (stesso colore dello splash nativo → nessun flash)
 *  2) Anello orbitale che ruota attorno al logo (idea "orbit" del brand)
 *  3) Logo AdvisorOS entra con scale-spring
 *  4) Wordmark "AdvisorOS" + tagline "CRM per consulenti energetici" con fade-up
 *  5) Fade-out totale dell'overlay dopo ~2.2s
 *
 * Zero blocco funzionale: pointerEvents="none" durante il fade-out finale.
 */

// module-level ref: garantisce che l'animazione parta SOLO una volta per sessione
const _splashPlayedRef = { current: false };

const NAVY = "#0F2438";
const ORANGE = "#FF6B35";
const CREAM = "#FFF7F1";

export function AnimatedSplash({ onDone }: { onDone?: () => void }) {
  const [alreadyPlayed] = useState(_splashPlayedRef.current);
  const [visible, setVisible] = useState(!_splashPlayedRef.current);

  const overlayOpacity = useRef(new Animated.Value(1)).current;
  const logoScale = useRef(new Animated.Value(0.6)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const wordOpacity = useRef(new Animated.Value(0)).current;
  const wordTranslate = useRef(new Animated.Value(12)).current;
  const taglineOpacity = useRef(new Animated.Value(0)).current;
  const ringRotate = useRef(new Animated.Value(0)).current;
  const ringOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (alreadyPlayed) return;

    // loop di rotazione anello (2s per giro, continuo mentre visibile)
    const ringLoop = Animated.loop(
      Animated.timing(ringRotate, {
        toValue: 1,
        duration: 2200,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    ringLoop.start();

    Animated.sequence([
      // Anello fade-in veloce
      Animated.timing(ringOpacity, {
        toValue: 1,
        duration: 250,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      // Logo pop-in con spring
      Animated.parallel([
        Animated.spring(logoScale, {
          toValue: 1,
          friction: 5.5,
          tension: 90,
          useNativeDriver: true,
        }),
        Animated.timing(logoOpacity, {
          toValue: 1,
          duration: 420,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
      // Wordmark AdvisorOS fade-up
      Animated.parallel([
        Animated.timing(wordOpacity, {
          toValue: 1,
          duration: 380,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(wordTranslate, {
          toValue: 0,
          duration: 420,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      // Tagline soft fade
      Animated.timing(taglineOpacity, {
        toValue: 1,
        duration: 320,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      // Piccola pausa per far respirare il brand
      Animated.delay(500),
      // Fade-out overlay
      Animated.timing(overlayOpacity, {
        toValue: 0,
        duration: 480,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(() => {
      _splashPlayedRef.current = true;
      ringLoop.stop();
      setVisible(false);
      onDone?.();
    });

    return () => {
      ringLoop.stop();
    };
  }, [alreadyPlayed, onDone, overlayOpacity, logoScale, logoOpacity, wordOpacity, wordTranslate, taglineOpacity, ringOpacity, ringRotate]);

  if (!visible) return null;

  const spin = ringRotate.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  return (
    <Animated.View
      pointerEvents={overlayOpacity.__getValue?.() < 0.05 ? "none" : "auto"}
      style={[styles.root, { opacity: overlayOpacity }]}
      testID="animated-splash"
    >
      <View style={styles.stage}>
        {/* Anello orbitale rotante */}
        <Animated.View
          style={[
            styles.ring,
            {
              opacity: ringOpacity,
              transform: [{ rotate: spin }],
            },
          ]}
        >
          <View style={[styles.orbitDot, styles.orbitDotTop]} />
          <View style={[styles.orbitDot, styles.orbitDotRight]} />
        </Animated.View>

        {/* Logo AdvisorOS con spring */}
        <Animated.View
          style={[
            styles.logoWrap,
            {
              opacity: logoOpacity,
              transform: [{ scale: logoScale }],
            },
          ]}
        >
          <Image
            source={{ uri: ADVISOROS_LOGO_URI }}
            style={styles.logo}
            resizeMode="contain"
          />
        </Animated.View>
      </View>

      <View style={styles.captionWrap}>
        <Animated.Text
          style={[
            styles.word,
            {
              opacity: wordOpacity,
              transform: [{ translateY: wordTranslate }],
            },
          ]}
        >
          Advisor<Text style={styles.wordAccent}>OS</Text>
        </Animated.Text>
        <Animated.Text style={[styles.tagline, { opacity: taglineOpacity }]}>
          CRM per consulenti energetici
        </Animated.Text>
      </View>
    </Animated.View>
  );
}

const RING_SIZE = 176;
const DOT_SIZE = 10;

const styles = StyleSheet.create({
  root: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: NAVY,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
    elevation: 9999,
  },
  stage: {
    width: RING_SIZE,
    height: RING_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  ring: {
    position: "absolute",
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    borderWidth: 1.5,
    borderColor: "rgba(255,107,53,0.35)",
  },
  orbitDot: {
    position: "absolute",
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    backgroundColor: ORANGE,
    shadowColor: ORANGE,
    shadowOpacity: 0.9,
    shadowRadius: 8,
  },
  orbitDotTop: {
    top: -DOT_SIZE / 2,
    left: RING_SIZE / 2 - DOT_SIZE / 2,
  },
  orbitDotRight: {
    bottom: -DOT_SIZE / 2,
    left: RING_SIZE / 2 - DOT_SIZE / 2,
    backgroundColor: "#FFFFFF",
    shadowColor: "#FFFFFF",
  },
  logoWrap: {
    width: 108,
    height: 108,
    borderRadius: 26,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  logo: { width: 92, height: 92 },
  captionWrap: {
    marginTop: 34,
    alignItems: "center",
    gap: 8,
  },
  word: {
    fontSize: 28,
    fontWeight: "900",
    color: CREAM,
    letterSpacing: -0.5,
  },
  wordAccent: {
    color: ORANGE,
  },
  tagline: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
});

export default AnimatedSplash;

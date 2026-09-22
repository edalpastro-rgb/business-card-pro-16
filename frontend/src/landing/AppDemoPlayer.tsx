// V50.z313 — «Video» demo di 15 secondi: animazione dell'app in azione (4 scene da ~3,75 s in loop)
// dentro una cornice telefono. Nessun file video: tutto disegnato con View + reanimated (leggero, nitido, web/native).
import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import Animated, { FadeIn, FadeInUp, FadeInRight, ZoomIn, useSharedValue, useAnimatedStyle, withRepeat, withTiming, interpolate } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { LP } from "@/src/landing/palette";
import { ScanLine, AutoField, LiveDot } from "@/src/landing/LandingFx";

const SCENE_MS = 3750;
const SCENES = [
  { n: 1, title: "Scatti la bolletta", sub: "Una foto. Niente da scrivere." },
  { n: 2, title: "Axon legge e capisce", sub: "POD, consumi, fornitore: estratti in un attimo." },
  { n: 3, title: "Compila il contratto", sub: "Ogni campo al posto giusto, da solo." },
  { n: 4, title: "Pronto per la firma", sub: "Archiviato nella scheda cliente." },
];
const TOTAL_MS = SCENE_MS * SCENES.length;

function TypingDots() {
  const p = useSharedValue(0);
  useEffect(() => { p.value = withRepeat(withTiming(1, { duration: 600 }), -1, true); }, [p]);
  const a = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0, 1], [0.3, 1]) }));
  const b = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0, 1], [1, 0.3]) }));
  const c = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0, 1], [0.3, 1]) }));
  return (
    <View style={{ flexDirection: "row", gap: 4, paddingVertical: 4 }}>
      {[a, b, c].map((st, i) => <Animated.View key={i} style={[{ width: 6, height: 6, borderRadius: 3, backgroundColor: LP.axon }, st]} />)}
    </View>
  );
}

function Scene1() {
  return (
    <Animated.View entering={FadeIn.duration(300)} style={d.scene}>
      <View style={d.camHud}><Ionicons name="camera" size={14} color={LP.onSurface} /><Text style={d.camTxt}>Fotocamera · Bolletta</Text></View>
      <View style={d.paper}>
        <ScanLine height={168} />
        <View style={[d.pLine, { width: "55%", backgroundColor: LP.borderStrong }]} />
        <View style={[d.pLine, { width: "85%" }]} />
        <View style={[d.pLine, { width: "70%" }]} />
        <View style={[d.pLine, { width: "40%" }]} />
        <View style={[d.pLine, { width: "78%" }]} />
        <View style={[d.pLine, { width: "62%" }]} />
      </View>
      <Animated.View entering={ZoomIn.delay(2400).duration(250)} style={d.shutterOk}>
        <Ionicons name="checkmark" size={16} color={LP.onBrand} /><Text style={d.shutterTxt}>Foto acquisita</Text>
      </Animated.View>
    </Animated.View>
  );
}

function Scene2() {
  const [typed, setTyped] = useState(false);
  useEffect(() => { const t = setTimeout(() => setTyped(true), 1100); return () => clearTimeout(t); }, []);
  return (
    <Animated.View entering={FadeIn.duration(300)} style={d.scene}>
      <View style={d.chatHead}><LiveDot /><Text style={d.chatHeadTxt}>Axon</Text></View>
      <Animated.View entering={FadeInRight.duration(350)} style={d.userBubble}>
        <Ionicons name="image" size={14} color={LP.onSurface} /><Text style={d.userTxt}>bolletta.jpg</Text>
      </Animated.View>
      <View style={d.axonBubble}>
        {!typed ? <TypingDots /> : (
          <Animated.Text entering={FadeIn.duration(250)} style={d.axonTxt}>
            Ho letto la bolletta di <Text style={d.bold}>Rossi Mario</Text>: POD <Text style={d.bold}>IT001E12345678</Text>, consumo <Text style={d.bold}>3.250 kWh/anno</Text>, fornitore attuale rilevato. Preparo il contratto?
          </Animated.Text>
        )}
      </View>
      {typed ? (
        <Animated.View entering={FadeInUp.delay(300).duration(300)} style={d.quickRow}>
          <View style={[d.quick, d.quickOn]}><Text style={[d.quickTxt, { color: LP.onBrand }]}>Sì, prepara</Text></View>
          <View style={d.quick}><Text style={d.quickTxt}>Dopo</Text></View>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

function Scene3() {
  return (
    <Animated.View entering={FadeIn.duration(300)} style={d.scene}>
      <View style={d.formHead}><Ionicons name="document-text" size={14} color={LP.axon} /><Text style={d.formHeadTxt}>Nuovo contratto · Luce</Text></View>
      <View style={{ gap: 8 }}>
        <AutoField label="Cliente" value="Rossi Mario" delay={150} />
        <AutoField label="Codice POD" value="IT001E12345678" delay={650} />
        <AutoField label="Consumo annuo" value="3.250 kWh" delay={1150} />
        <AutoField label="Potenza" value="3 kW" delay={1650} />
      </View>
      <Animated.View entering={FadeIn.delay(2600).duration(250)} style={d.autoTag}>
        <Ionicons name="flash" size={12} color={LP.axon} /><Text style={d.autoTagTxt}>4 campi compilati da Axon</Text>
      </Animated.View>
    </Animated.View>
  );
}

function Scene4() {
  return (
    <Animated.View entering={FadeIn.duration(300)} style={[d.scene, { alignItems: "center", justifyContent: "center", gap: 12 }]}>
      <Animated.View entering={ZoomIn.duration(450)} style={d.okRing}>
        <Ionicons name="checkmark" size={38} color={LP.onBrand} />
      </Animated.View>
      <Animated.Text entering={FadeInUp.delay(250).duration(350)} style={d.okTitle}>Contratto pronto</Animated.Text>
      <Animated.Text entering={FadeInUp.delay(400).duration(350)} style={d.okSub}>Archiviato nella scheda di Rossi Mario.{"\n"}Da 20 minuti a 20 secondi.</Animated.Text>
      <Animated.View entering={FadeInUp.delay(600).duration(350)} style={d.signBtn}>
        <Ionicons name="create" size={14} color={LP.onBrand} /><Text style={d.signTxt}>Firma</Text>
      </Animated.View>
    </Animated.View>
  );
}

export function AppDemoPlayer({ width = 280 }: { width?: number }) {
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(true);
  const last = useRef(Date.now());
  useEffect(() => {
    if (!playing) return;
    last.current = Date.now();
    const iv = setInterval(() => {
      const now = Date.now();
      setElapsed((e) => (e + (now - last.current)) % TOTAL_MS);
      last.current = now;
    }, 100);
    return () => clearInterval(iv);
  }, [playing]);
  const idx = Math.min(SCENES.length - 1, Math.floor(elapsed / SCENE_MS));
  const inScene = (elapsed - idx * SCENE_MS) / SCENE_MS;
  const scene = SCENES[idx];
  const h = Math.round(width * 1.62);

  return (
    <View style={{ alignItems: "center", gap: 14 }} testID="landing-demo-player">
      <View style={[d.phone, { width, height: h }]}>
        <View style={d.notch} />
        <View style={d.progressRow}>
          {SCENES.map((sc, i) => (
            <View key={sc.n} style={d.segTrack}>
              <View style={[d.segFill, { width: i < idx ? "100%" : i === idx ? `${Math.round(inScene * 100)}%` : "0%" }]} />
            </View>
          ))}
        </View>
        <View style={d.screen}>
          {idx === 0 ? <Scene1 key="s1" /> : idx === 1 ? <Scene2 key="s2" /> : idx === 2 ? <Scene3 key="s3" /> : <Scene4 key="s4" />}
        </View>
        <Pressable onPress={() => setPlaying((p) => !p)} style={d.playBtn} hitSlop={8} testID="landing-demo-toggle" accessibilityRole="button" accessibilityLabel={playing ? "Pausa" : "Riproduci"}>
          <Ionicons name={playing ? "pause" : "play"} size={16} color={LP.onSurface} />
        </Pressable>
      </View>
      <Animated.View key={scene.n} entering={FadeIn.duration(300)} style={{ alignItems: "center", gap: 2 }}>
        <Text style={d.capTitle} testID="landing-demo-caption">{scene.n}/4 · {scene.title}</Text>
        <Text style={d.capSub}>{scene.sub}</Text>
      </Animated.View>
    </View>
  );
}

const d = StyleSheet.create({
  phone: { borderRadius: 36, backgroundColor: LP.surface, borderWidth: 6, borderColor: LP.surface3, overflow: "hidden", padding: 12, paddingTop: 30, shadowColor: LP.axon, shadowOpacity: 0.35, shadowRadius: 40, shadowOffset: { width: 0, height: 10 }, elevation: 12 },
  notch: { position: "absolute", top: 8, alignSelf: "center", width: 90, height: 18, borderRadius: 9, backgroundColor: LP.surface3 },
  progressRow: { flexDirection: "row", gap: 4, marginBottom: 10 },
  segTrack: { flex: 1, height: 3, borderRadius: 2, backgroundColor: LP.border, overflow: "hidden" },
  segFill: { height: 3, backgroundColor: LP.brand },
  screen: { flex: 1, borderRadius: 18, backgroundColor: LP.surface2, borderWidth: 1, borderColor: LP.border, overflow: "hidden" },
  playBtn: { position: "absolute", right: 16, bottom: 16, width: 34, height: 34, borderRadius: 17, backgroundColor: LP.surface3, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: LP.borderStrong },
  scene: { flex: 1, padding: 12, gap: 10 },
  capTitle: { color: LP.onSurface, fontSize: 15, fontWeight: "900", letterSpacing: -0.3 },
  capSub: { color: LP.onSurface2, fontSize: 13 },

  camHud: { flexDirection: "row", alignItems: "center", gap: 6 },
  camTxt: { color: LP.onSurface2, fontSize: 11, fontWeight: "700" },
  paper: { height: 168, borderRadius: 12, backgroundColor: LP.onSurface, padding: 14, gap: 12, overflow: "hidden", position: "relative" },
  pLine: { height: 7, borderRadius: 4, backgroundColor: LP.onSurface2 },
  shutterOk: { alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: LP.brand },
  shutterTxt: { color: LP.onBrand, fontSize: 12, fontWeight: "800" },

  chatHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  chatHeadTxt: { color: LP.onSurface, fontSize: 13, fontWeight: "900" },
  userBubble: { alignSelf: "flex-end", flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14, borderBottomRightRadius: 4, backgroundColor: LP.axonInk },
  userTxt: { color: LP.onSurface, fontSize: 12, fontWeight: "700" },
  axonBubble: { alignSelf: "flex-start", maxWidth: "94%", paddingHorizontal: 12, paddingVertical: 10, borderRadius: 14, borderBottomLeftRadius: 4, backgroundColor: LP.surface3, borderWidth: 1, borderColor: LP.axonLineSoft },
  axonTxt: { color: LP.onSurface2, fontSize: 12, lineHeight: 17 },
  bold: { color: LP.onSurface, fontWeight: "800" },
  quickRow: { flexDirection: "row", gap: 8 },
  quick: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: LP.borderStrong },
  quickOn: { backgroundColor: LP.brand, borderColor: LP.brand },
  quickTxt: { color: LP.onSurface2, fontSize: 12, fontWeight: "800" },

  formHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  formHeadTxt: { color: LP.onSurface, fontSize: 12, fontWeight: "800" },
  autoTag: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: LP.axonTint, borderWidth: 1, borderColor: LP.axonLine },
  autoTagTxt: { color: LP.axon, fontSize: 11, fontWeight: "800" },

  okRing: { width: 72, height: 72, borderRadius: 36, backgroundColor: LP.brand, alignItems: "center", justifyContent: "center", shadowColor: LP.brand, shadowOpacity: 0.7, shadowRadius: 24, shadowOffset: { width: 0, height: 0 } },
  okTitle: { color: LP.onSurface, fontSize: 18, fontWeight: "900", letterSpacing: -0.4 },
  okSub: { color: LP.onSurface2, fontSize: 12, lineHeight: 17, textAlign: "center" },
  signBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 18, paddingVertical: 9, borderRadius: 999, backgroundColor: LP.axonDeep },
  signTxt: { color: LP.onBrand, fontSize: 13, fontWeight: "900" },
});

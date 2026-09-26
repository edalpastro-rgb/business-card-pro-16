// MicCalibrationCard.tsx — V50.z367 — Impostazioni → Voce → «Calibrazione microfono»: livello dB ambiente in tempo reale con
// barra visiva, «Calibra ora» (10 s di ambiente → soglia ottimale automatica), profilo rilevato (silenzioso/normale/rumoroso).
// Solo app nativa (metering expo-audio). Permesso microfono: check → richiesta contestuale → «Apri impostazioni» se bloccato.
import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, Platform, Linking } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AudioModule, RecordingPresets } from "expo-audio";
import { notify } from "@/src/utils/notify";
import { NOISE_PROFILES, bandForAmbient, toAmbientDb, buildCalibration, loadCalibration, saveCalibration, MicCalibration } from "@/src/violawake/noiseProfile";
import { HT } from "@/src/homeTheme";

const BAND_COLOR = { silent: "#16A34A", normal: "#0EA5E9", noisy: "#DC2626" } as const;

export function MicCalibrationCard() {
  const [perm, setPerm] = useState<"unknown" | "granted" | "denied" | "blocked">("unknown");
  const [live, setLive] = useState<number | null>(null);      // dB ambiente
  const [calib, setCalib] = useState<MicCalibration | null>(null);
  const [calibrating, setCalibrating] = useState<number | null>(null); // secondi rimanenti
  const recRef = useRef<any>(null);
  const calibratingRef = useRef(false);
  const samplesRef = useRef<number[]>([]);
  const native = Platform.OS !== "web";

  useEffect(() => { loadCalibration().then(setCalib); }, []);

  const checkPerm = async (ask: boolean) => {
    try {
      let p = await AudioModule.getRecordingPermissionsAsync();
      if (!p.granted && ask && p.canAskAgain) p = await AudioModule.requestRecordingPermissionsAsync();
      const st = p.granted ? "granted" : p.canAskAgain ? "denied" : "blocked";
      setPerm(st); return st;
    } catch { setPerm("denied"); return "denied"; }
  };

  // Meter live: parte quando il permesso è concesso; si ferma allo smontaggio.
  useEffect(() => {
    if (!native || perm !== "granted") return;
    let stopped = false; let poll: ReturnType<typeof setInterval> | null = null;
    (async () => {
      try {
        await AudioModule.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        const rec: any = new AudioModule.AudioRecorder({ ...RecordingPresets.LOW_QUALITY, isMeteringEnabled: true });
        await rec.prepareToRecordAsync(); rec.record(); recRef.current = rec;
        poll = setInterval(() => {
          if (stopped) return;
          try {
            const st = rec.getStatus(); const db = typeof st?.metering === "number" ? st.metering : null;
            if (db == null) return;
            setLive(toAmbientDb(db));
            if (calibratingRef.current) samplesRef.current.push(db);
          } catch { /* noop */ }
        }, 120);
      } catch { setLive(null); }
    })();
    return () => {
      stopped = true; if (poll) clearInterval(poll);
      try { recRef.current?.stop?.(); recRef.current?.release?.(); } catch { /* noop */ } recRef.current = null;
    };
  }, [native, perm]);

  const calibrate = async () => {
    if (calibrating != null) return;
    const st = perm === "granted" ? "granted" : await checkPerm(true);
    if (st !== "granted") { notify(st === "blocked" ? "Microfono bloccato: aprilo dalle impostazioni" : "Serve il microfono per calibrare"); return; }
    samplesRef.current = []; calibratingRef.current = true;
    for (let s = 10; s > 0; s--) { setCalibrating(s); await new Promise((r) => setTimeout(r, 1000)); }
    calibratingRef.current = false; setCalibrating(null);
    const c = buildCalibration(samplesRef.current);
    if (!c) { notify("Misura non riuscita: riprova tenendo il telefono fermo"); return; }
    await saveCalibration(c); setCalib(c);
    notify(`Calibrato: ambiente ${c.ambientDb} dB · profilo ${NOISE_PROFILES[c.band].label}`);
  };

  const band = live != null ? bandForAmbient(live) : calib?.band || null;
  const pct = live != null ? Math.min(100, Math.max(0, (live / 100) * 100)) : 0;

  return (
    <View style={styles.card} testID="mic-calibration-card">
      <View style={styles.row}>
        <View style={styles.icon}><Ionicons name="mic" size={18} color={HT.violet} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Calibrazione microfono</Text>
          <Text style={styles.sub}>ViolaWake adatta da solo le soglie a tre scenari: silenzioso (&lt;40 dB), normale (40–65 dB), rumoroso (&gt;65 dB). Calibra dove lavori di solito per partire già regolato.</Text>
        </View>
      </View>

      {!native ? <Text style={styles.warn}>Disponibile solo nell’app installata (misura del microfono).</Text> : perm !== "granted" ? (
        <View style={{ gap: 8 }}>
          <Text style={styles.warn}>Per misurare il rumore ambiente serve il microfono{perm === "blocked" ? " (bloccato nelle impostazioni del telefono)" : ""}.</Text>
          <Pressable onPress={() => (perm === "blocked" ? Linking.openSettings() : checkPerm(true))} style={styles.btn} testID="mic-calibration-perm">
            <Ionicons name={perm === "blocked" ? "settings" : "mic"} size={16} color="#FFF" /><Text style={styles.btnTxt}>{perm === "blocked" ? "Apri impostazioni" : "Consenti microfono"}</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <View style={styles.meterRow}>
            <Text style={[styles.db, { color: band ? BAND_COLOR[band] : HT.text }]} testID="mic-calibration-live">{live != null ? `${live} dB` : "— dB"}</Text>
            <Text style={styles.bandTxt}>{band ? NOISE_PROFILES[band].label : "In misura…"}</Text>
          </View>
          <View style={styles.bar}>
            <View style={[styles.fill, { width: `${pct}%`, backgroundColor: band ? BAND_COLOR[band] : HT.violet }]} />
            <View style={[styles.tick, { left: "40%" }]} /><View style={[styles.tick, { left: "65%" }]} />
            {calib ? <View style={[styles.marker, { left: `${Math.min(100, calib.ambientDb)}%` }]} /> : null}
          </View>
          <View style={styles.scale}><Text style={styles.scaleTxt}>0</Text><Text style={styles.scaleTxt}>40</Text><Text style={styles.scaleTxt}>65</Text><Text style={styles.scaleTxt}>100 dB</Text></View>
          <Pressable onPress={calibrate} disabled={calibrating != null} style={[styles.btn, calibrating != null && { backgroundColor: HT.muted }]} testID="mic-calibration-start">
            <Ionicons name={calibrating != null ? "hourglass" : "options"} size={16} color="#FFF" />
            <Text style={styles.btnTxt}>{calibrating != null ? `Ascolto l’ambiente… ${calibrating}s (resta in silenzio)` : "Calibra ora (10 secondi)"}</Text>
          </Pressable>
        </>
      )}
      {calib ? (
        <View style={styles.result} testID="mic-calibration-result">
          <Ionicons name="checkmark-circle" size={16} color={BAND_COLOR[calib.band]} />
          <Text style={styles.resultTxt}>Calibrato il {calib.measuredAt.slice(0, 10)}: ambiente {calib.ambientDb} dB · {NOISE_PROFILES[calib.band].label} · soglia voce {Math.round(calib.thresholdDbfs)} dBFS</Text>
          <Pressable onPress={async () => { await saveCalibration(null); setCalib(null); }} hitSlop={8}><Ionicons name="close-circle" size={18} color={HT.muted} /></Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: HT.card, borderRadius: 16, borderWidth: 1, borderColor: HT.border, padding: 14, gap: 12 },
  row: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  icon: { width: 36, height: 36, borderRadius: 10, backgroundColor: HT.violetTint, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 15, fontWeight: "900", color: HT.text }, sub: { fontSize: 12, color: HT.muted, lineHeight: 17, marginTop: 2 },
  warn: { fontSize: 12, color: HT.text2, fontStyle: "italic" },
  meterRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  db: { fontSize: 28, fontWeight: "900" }, bandTxt: { fontSize: 12, fontWeight: "800", color: HT.text2 },
  bar: { height: 14, borderRadius: 7, backgroundColor: HT.card2, overflow: "hidden", position: "relative" },
  fill: { height: 14, borderRadius: 7 },
  tick: { position: "absolute", top: 0, width: 2, height: 14, backgroundColor: HT.border },
  marker: { position: "absolute", top: 2, width: 4, height: 10, marginLeft: -2, borderRadius: 2, backgroundColor: HT.text },
  scale: { flexDirection: "row", justifyContent: "space-between" }, scaleTxt: { fontSize: 10, color: HT.muted },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 46, borderRadius: 12, backgroundColor: HT.violet, paddingHorizontal: 14 },
  btnTxt: { color: "#FFF", fontWeight: "800", fontSize: 13 },
  result: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: HT.card2, borderRadius: 10, padding: 10 }, resultTxt: { flex: 1, fontSize: 12, color: HT.text, fontWeight: "600" },
});

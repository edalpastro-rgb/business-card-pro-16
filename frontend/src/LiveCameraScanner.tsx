/**
 * Bug 11 — Live in-app camera scanner (continuous mode).
 *
 * Cosa fa:
 *  - Apre una `CameraView` (expo-camera) a schermo intero con AUTOFOCUS continuo
 *    (prop `autofocus="on"`), così la messa a fuoco è sempre attiva senza tap.
 *  - Permette di scattare N foto senza mai chiudere la camera (modalità continua).
 *  - Ogni scatto viene subito mostrato come thumbnail nella strip in basso; in
 *    parallelo invia la foto a `POST /api/scanner/autocrop-preview` per ottenere
 *    la versione ritagliata automaticamente e sostituisce la thumbnail (badge ✂️).
 *  - Al tap su "Fine (N)" chiude la camera e restituisce l'array di pagine al
 *    componente parent (DocumentScannerModal).
 *
 * Web: `CameraView` di expo-camera è supportato via WebRTC; se non permesso,
 * il componente mostra un fallback che rimanda al picker OS.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Image,
  ActivityIndicator,
  Modal,
  Platform,
  ScrollView,
  AppState,
  Linking,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Polygon, Circle } from "react-native-svg";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { ManualCropEditor } from "@/src/ManualCropEditor";

export type LiveScannedPage = {
  data_base64: string;
  mime: string;
  preview_uri: string; // data:image/jpeg;base64,...
  cropped?: boolean; // true = version returned by /scanner/autocrop-preview
  blurry?: boolean; // Bug 11.d — true if backend flagged low sharpness
  original_base64?: string; // scatto originale (per il ritaglio manuale)
  manual?: boolean; // true = ritaglio manuale dell'utente (non sovrascrivere con l'autocrop)
  id?: string; // V50.z139 — id univoco dello scatto (l'autocrop asincrono aggiorna per id, non per indice)
  processed?: boolean; // V50.z139 — true quando /scanner/autocrop-preview ha risposto (ok o fallback)
};

type Props = {
  visible: boolean;
  onClose: () => void;
  onDone: (pages: LiveScannedPage[]) => void;
  enhance?: boolean;
  grayscale?: boolean;
  /** V50.z139 — "Foto singola": dopo il primo scatto confermato ("Usa questa") chiude e restituisce 1 pagina. */
  singleShot?: boolean;
};

export function LiveCameraScanner({ visible, onClose, onDone, enhance = true, grayscale = false, singleShot = false }: Props) {
  // V50.z139 — Gestione permessi robusta (Android 16 / patch 2025-09: `requestPermission`
  // può NON risolvere mai se il permesso è già concesso → la schermata "Serve l'accesso"
  // restava per sempre). Regole: 1) rileggere SEMPRE lo stato con `getPermission` quando
  // il modal si apre (lo stato dell'hook può essere stale: concesso altrove); 2) chiedere
  // solo se non concesso e `canAskAgain`; 3) la richiesta ha un timeout e viene sempre
  // seguita da una rilettura; 4) al ritorno in foreground (chiusura dialog di sistema)
  // rileggere lo stato.
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const [permBusy, setPermBusy] = useState(false);
  const permAskedRef = useRef(false);
  const cameraRef = useRef<CameraView | null>(null);
  const [pages, setPages] = useState<LiveScannedPage[]>([]);
  const pagesRef = useRef<LiveScannedPage[]>([]);
  pagesRef.current = pages;
  // V50.z9 — Preview post-scatto: obbliga review prima della pagina successiva
  const [reviewIdx, setReviewIdx] = useState<number | null>(null);
  // Ritaglio manuale della pagina in revisione (originale non ritagliato se disponibile)
  const [cropOpen, setCropOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [torch, setTorch] = useState<"on" | "off">("off");
  const [facing, setFacing] = useState<"back" | "front">("back");
  const [processingCount, setProcessingCount] = useState(0);
  // Bug 11.b — Live edge detection state.
  // Corners are stored NORMALIZED (0..1) so we can map them to the current
  // overlay size (which we measure via onLayout).
  const [liveCorners, setLiveCorners] = useState<[number, number][] | null>(null);
  const [overlaySize, setOverlaySize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [edgeDetectOn, setEdgeDetectOn] = useState(true);
  const detectBusyRef = useRef(false); // prevents overlapping requests
  const lastCornersRef = useRef<[number, number][] | null>(null); // for EMA smoothing
  // Bug 11.c — Auto-shutter: fire capture when the document is stable for
  // AUTO_STABLE_MS. State machine per-detection: unstable → stable → captured
  // (cool-down for AUTO_COOLDOWN_MS so we don't take two shots in a row).
  // V50.z5 — Auto-shutter DISATTIVATO di default: l'utente vuole scattare
  // manualmente per avere il tempo di posizionare bene il foglio.
  // Può riattivarlo dal pulsante ⚡ in basso a destra.
  const [autoShutter, setAutoShutter] = useState(false);
  const [autoCountdown, setAutoCountdown] = useState<number | null>(null); // 0..1 progress
  const stableSinceRef = useRef<number | null>(null); // ms timestamp when doc became stable
  const cooldownUntilRef = useRef<number>(0); // ms timestamp until which no auto-shot allowed
  // Bug 11.d — Anti motion-blur: sharpness score (variance of Laplacian)
  // returned by /scanner/detect-corners. If below threshold we block the
  // auto-shutter and warn the user.
  const [sharpness, setSharpness] = useState<number | null>(null);
  const SHARPNESS_THRESHOLD = 90; // empirical (backend returns Laplacian var on 400px gray)

  // Reset state when modal is closed
  useEffect(() => {
    if (!visible) {
      setPages([]);
      setReviewIdx(null);
      setCropOpen(false);
      setBusy(false);
      setTorch("off");
      setProcessingCount(0);
      setLiveCorners(null);
      lastCornersRef.current = null;
      detectBusyRef.current = false;
      stableSinceRef.current = null;
      cooldownUntilRef.current = 0;
      setAutoCountdown(null);
      setSharpness(null);
    }
  }, [visible]);

  // V50.z139 — Richiesta permesso robusta (vedi commento in testa al componente).
  const askPermission = useCallback(async () => {
    setPermBusy(true);
    try {
      // 1) Rileggi lo stato reale (l'hook può essere stale)
      const cur = await getPermission().catch(() => null);
      if (cur?.granted) return true;
      if (cur && !cur.canAskAgain) return false;
      // 2) Richiedi con timeout: su Android 16 la promise può non risolvere mai
      //    se il permesso risulta già concesso a livello di sistema.
      const res = await Promise.race([
        requestPermission().catch(() => null),
        new Promise<null>((r) => setTimeout(() => r(null), 12000)),
      ]);
      if (res?.granted) return true;
      // 3) Rileggi comunque: `get` risolve sempre, anche quando `request` si è bloccata
      const after = await getPermission().catch(() => null);
      return !!after?.granted;
    } finally {
      setPermBusy(false);
    }
  }, [getPermission, requestPermission]);

  useEffect(() => {
    if (!visible) {
      permAskedRef.current = false;
      return;
    }
    if (permAskedRef.current) return;
    permAskedRef.current = true;
    askPermission();
  }, [visible, askPermission]);

  // Al ritorno in foreground (dialog di sistema chiuso / rientro dalle Impostazioni) rileggi lo stato.
  useEffect(() => {
    if (!visible) return;
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") getPermission().catch(() => {});
    });
    return () => sub.remove();
  }, [visible, getPermission]);

  // Bug 11.b — Live edge detection loop.
  // Every SAMPLE_INTERVAL ms, we grab a low-quality frame with takePictureAsync
  // and POST it to /scanner/detect-corners. If corners are detected we apply
  // exponential moving average smoothing (alpha=0.5) to avoid jitter, then
  // update `liveCorners` for the overlay to redraw.
  //
  // Bug 11.c — Auto-shutter: when the document is detected AND corners are
  // stable (max normalized delta < STABILITY_THRESHOLD) for AUTO_STABLE_MS,
  // we automatically trigger takeShot(). Cool-down prevents duplicates.
  useEffect(() => {
    if (!visible || !edgeDetectOn) return;
    if (!permission?.granted) return;
    // V50.z162 — Stop del campionamento live mentre è aperta l'anteprima e, in
    // modalità scatto singolo, dopo il primo scatto: prima il loop continuava a
    // chiamare takePictureAsync (suono/flash otturatore ogni 0,9s) e l'auto-scatto
    // poteva ripartire dopo il cooldown → "continua a scattare".
    if (reviewIdx != null) return;
    if (singleShot && pages.length > 0) return;
    let cancelled = false;
    const SAMPLE_INTERVAL = 900; // faster sampling so auto-shutter feels responsive
    const ALPHA = 0.55; // 0 = no smoothing, 1 = only new value
    const STABILITY_THRESHOLD = 0.025; // stricter: rileva anche piccoli movimenti
    const AUTO_STABLE_MS = 2500; // V50.z5: hold time più lungo (2.5s) per dare tempo al fuoco
    const AUTO_COOLDOWN_MS = 2500; // grace period after auto/manual shot

    const smooth = (
      next: [number, number][],
      prev: [number, number][] | null,
    ): [number, number][] => {
      if (!prev) return next;
      return next.map(([x, y], i) => {
        const [px, py] = prev[i] || [x, y];
        return [px + (x - px) * ALPHA, py + (y - py) * ALPHA] as [number, number];
      });
    };

    const maxDelta = (a: [number, number][], b: [number, number][]): number => {
      let m = 0;
      for (let i = 0; i < 4; i++) {
        const dx = Math.abs(a[i][0] - b[i][0]);
        const dy = Math.abs(a[i][1] - b[i][1]);
        m = Math.max(m, dx, dy);
      }
      return m;
    };

    const tick = async () => {
      if (cancelled) return;
      if (detectBusyRef.current) return;
      if (busy) return; // don't sample while user is capturing
      if (!cameraRef.current) return;
      detectBusyRef.current = true;
      try {
        const snap = await cameraRef.current.takePictureAsync({
          base64: true,
          quality: 0.1,
          skipProcessing: true,
          exif: false,
          shutterSound: false, // V50.z162 — campionamento silenzioso (Android)
        } as any);
        if (cancelled) return;
        if (!snap?.base64) return;
        const r = await api<{ detected: boolean; corners: [number, number][] | null; sharpness?: number }>(
          "/scanner/detect-corners",
          { method: "POST", body: { data_base64: snap.base64, mime: "image/jpeg" } },
        );
        if (cancelled) return;
        const now = Date.now();
        const sh = typeof r?.sharpness === "number" ? r.sharpness : null;
        setSharpness(sh);
        const isSharp = sh == null ? true : sh >= SHARPNESS_THRESHOLD;
        if (r?.detected && r.corners && r.corners.length === 4) {
          const smoothed = smooth(r.corners, lastCornersRef.current);
          // Stability = delta between raw new corners and previous smoothed
          const stable = lastCornersRef.current
            ? maxDelta(r.corners, lastCornersRef.current) < STABILITY_THRESHOLD
            : false;
          lastCornersRef.current = smoothed;
          setLiveCorners(smoothed);

          // Auto-shutter state machine (blocked if image is blurry)
          if (autoShutter && now >= cooldownUntilRef.current) {
            if (stable && isSharp) {
              if (stableSinceRef.current == null) {
                stableSinceRef.current = now;
                setAutoCountdown(0);
              } else {
                const held = now - stableSinceRef.current;
                if (held >= AUTO_STABLE_MS) {
                  // Fire!
                  stableSinceRef.current = null;
                  cooldownUntilRef.current = now + AUTO_COOLDOWN_MS;
                  setAutoCountdown(null);
                  // release the guard before calling takeShot which sets busy=true
                  detectBusyRef.current = false;
                  takeShot();
                  return;
                } else {
                  setAutoCountdown(Math.min(1, held / AUTO_STABLE_MS));
                }
              }
            } else {
              // moved OR blurry → reset countdown
              stableSinceRef.current = null;
              setAutoCountdown(null);
            }
          } else {
            setAutoCountdown(null);
          }
        } else {
          lastCornersRef.current = null;
          setLiveCorners(null);
          stableSinceRef.current = null;
          setAutoCountdown(null);
        }
      } catch {
        // ignore transient errors — the loop will retry next tick
      } finally {
        detectBusyRef.current = false;
      }
    };

    // First sample fires after a short delay so camera has time to warm up
    const initial = setTimeout(tick, 800);
    const iv = setInterval(tick, SAMPLE_INTERVAL);
    return () => {
      cancelled = true;
      clearTimeout(initial);
      clearInterval(iv);
    };
    // Note: takeShot is stable via useCallback below; adding it here would cause a re-subscribe cycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, edgeDetectOn, permission?.granted, busy, autoShutter, reviewIdx, singleShot, pages.length]);

  const applyAutocropAsync = useCallback(
    async (pageId: string, data_base64: string) => {
      setProcessingCount((c) => c + 1);
      try {
        const r = await api<{ detected: boolean; data_base64: string; mime: string; sharpness?: number }>(
          "/scanner/autocrop-preview",
          {
            method: "POST",
            body: { data_base64, mime: "image/jpeg", enhance, grayscale },
          },
        );
        // Bug 11.d — Motion-blur detection on the actual captured frame.
        // On the FULL-res image the Laplacian variance is much higher than
        // the sampling frame (400px). Threshold ~250 empirically differentiates
        // sharp vs. hand-shake blurry on typical phone cameras.
        const isBlurry = typeof r?.sharpness === "number" && r.sharpness < 250;
        if (r?.data_base64) {
          // detected=true → versione ritagliata; altrimenti teniamo comunque la versione
          // migliorata (contrasto/nitidezza) — V50.z139: aggiornamento per id pagina.
          setPages((prev) => prev.map((p) => {
            if (p.id !== pageId || p.manual) return p;
            return {
              ...p,
              original_base64: p.original_base64 || data_base64,
              data_base64: r.data_base64,
              mime: r.mime || "image/jpeg",
              preview_uri: `data:${r.mime || "image/jpeg"};base64,${r.data_base64}`,
              cropped: !!r.detected,
              blurry: isBlurry,
            };
          }));
        }
      } catch {
        // Silently keep original page — user can still crop server-side on save
      } finally {
        setPages((prev) => prev.map((p) => (p.id === pageId ? { ...p, processed: true } : p)));
        setProcessingCount((c) => Math.max(0, c - 1));
      }
    },
    [enhance, grayscale],
  );

  const takeShot = useCallback(async () => {
    if (busy || !cameraRef.current) return;
    if (singleShot && pagesRef.current.length > 0) return; // V50.z162 — un solo scatto
    stableSinceRef.current = null;
    setAutoCountdown(null);
    setBusy(true);
    try {
      // V50.z5 — Piccolo delay pre-scatto per dare tempo all'autofocus di
      // agganciare il documento (evita scatti sfocati in modalità manuale).
      await new Promise((res) => setTimeout(res, 350));
      const photo = await cameraRef.current.takePictureAsync({
        base64: true,
        quality: 0.9,
        skipProcessing: false,
        exif: false,
      });
      if (!photo?.base64) {
        notify("Errore", "Foto non acquisita — riprova.");
        return;
      }
      const preview_uri = photo.uri || `data:image/jpeg;base64,${photo.base64}`;
      // Add page immediately so the user sees a thumbnail
      const pageId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const newIndex = pagesRef.current.length;
      setPages((prev) => [
        ...prev,
        {
          id: pageId,
          data_base64: photo.base64!,
          mime: "image/jpeg",
          preview_uri,
          cropped: false,
          processed: false,
        },
      ]);
      // Fire-and-forget autocrop in background (aggiorna la pagina per id)
      setTimeout(() => applyAutocropAsync(pageId, photo.base64!), 0);
      // V50.z9 — Apri preview OBBLIGATORIA prima di scattare la prossima
      setReviewIdx(newIndex);
    } catch (e: any) {
      notify("Errore fotocamera", e?.message || "");
    } finally {
      setBusy(false);
    }
  }, [busy, applyAutocropAsync, singleShot]);

  const removePage = (idx: number) => {
    setPages((prev) => prev.filter((_, i) => i !== idx));
  };

  const finish = () => {
    if (!pages.length) {
      onClose();
      return;
    }
    onDone(pages);
  };

  if (!visible) return null;

  // Permission gate — finché il permesso non è confermato mostra una UI amichevole
  // (V50.z139: anche mentre lo stato è ancora sconosciuto / in verifica, per non montare
  // la CameraView senza permesso).
  if (!permission || !permission.granted) {
    const checking = permBusy || !permission;
    return (
      <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
        <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
          <View style={styles.permWrap}>
            <Ionicons name="camera-outline" size={64} color="#F1F5F9" />
            <Text style={styles.permTitle}>
              {checking ? "Verifica accesso alla fotocamera…" : "Serve l'accesso alla fotocamera"}
            </Text>
            <Text style={styles.permSub}>
              {checking
                ? "Se compare la richiesta di sistema, tocca “Consenti”."
                : singleShot
                  ? "Per scattare e ritagliare automaticamente il documento l'app deve accedere alla fotocamera del dispositivo."
                  : "Per scansionare documenti in modalità continua l'app deve accedere alla fotocamera del dispositivo. Nessun dato viene inviato senza il tuo consenso."}
            </Text>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 20 }}>
              <Pressable onPress={onClose} style={[styles.permBtn, { backgroundColor: "#334155" }]} testID="live-scan-perm-cancel">
                <Text style={{ color: "#FFF", fontWeight: "700" }}>Annulla</Text>
              </Pressable>
              {checking ? (
                <View style={[styles.permBtn, { backgroundColor: "#FF6B35", flexDirection: "row", alignItems: "center", gap: 8 }]}>
                  <ActivityIndicator color="#FFF" size="small" />
                  <Text style={{ color: "#FFF", fontWeight: "800" }}>Attendi…</Text>
                </View>
              ) : permission.canAskAgain ? (
                <Pressable
                  onPress={askPermission}
                  style={[styles.permBtn, { backgroundColor: "#FF6B35" }]}
                  testID="live-scan-perm-allow"
                >
                  <Text style={{ color: "#FFF", fontWeight: "800" }}>Consenti</Text>
                </Pressable>
              ) : (
                <Pressable
                  onPress={() => {
                    if (Platform.OS !== "web") Linking.openSettings?.();
                  }}
                  style={[styles.permBtn, { backgroundColor: "#FF6B35" }]}
                  testID="live-scan-perm-settings"
                >
                  <Text style={{ color: "#FFF", fontWeight: "800" }}>Apri impostazioni</Text>
                </Pressable>
              )}
            </View>
            {!checking && (
              <Pressable onPress={() => getPermission().catch(() => {})} style={{ marginTop: 18 }} hitSlop={8} testID="live-scan-perm-recheck">
                <Text style={{ color: "#94A3B8", fontSize: 12, textDecorationLine: "underline" }}>
                  Ho già concesso il permesso · ricontrolla
                </Text>
              </Pressable>
            )}
            {/* V50.z156 — Diagnostica: stato reale del permesso. Se Android risponde
                subito "denied + non richiedibile" senza mai mostrare il popup, la build
                installata NON dichiara CAMERA nel manifest (problema di build, non di app). */}
            {!checking && (
              <Text style={{ color: "#64748B", fontSize: 11, marginTop: 14, textAlign: "center" }} testID="live-scan-perm-diag">
                Diagnostica · stato: {permission.status} · richiedibile: {permission.canAskAgain ? "sì" : "no"}
                {"\n"}
                {!permission.canAskAgain
                  ? "Se in Impostazioni → Autorizzazioni la voce “Fotocamera” NON compare, la build installata non include il permesso: serve una nuova build."
                  : "Tocca “Consenti” e accetta il popup di sistema."}
              </Text>
            )}
          </View>
        </SafeAreaView>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <CameraView
          ref={(r) => {
            cameraRef.current = r;
          }}
          style={StyleSheet.absoluteFillObject}
          facing={facing}
          enableTorch={torch === "on"}
          autofocus="on"
          animateShutter={false}
        />

        {/* Bug 11.b — Live edge detection overlay (SVG polygon + corner dots) */}
        <View
          pointerEvents="none"
          style={StyleSheet.absoluteFillObject}
          onLayout={(e) => {
            const { width, height } = e.nativeEvent.layout;
            if (Math.abs(width - overlaySize.w) > 1 || Math.abs(height - overlaySize.h) > 1) {
              setOverlaySize({ w: Math.round(width), h: Math.round(height) });
            }
          }}
        >
          {edgeDetectOn && liveCorners && overlaySize.w > 0 && overlaySize.h > 0 && (
            <Svg width={overlaySize.w} height={overlaySize.h} pointerEvents="none">
              <Polygon
                points={liveCorners
                  .map(([nx, ny]) => `${(nx * overlaySize.w).toFixed(1)},${(ny * overlaySize.h).toFixed(1)}`)
                  .join(" ")}
                fill="rgba(34,197,94,0.18)"
                stroke="#22C55E"
                strokeWidth={3}
                strokeLinejoin="round"
              />
              {liveCorners.map(([nx, ny], i) => (
                <Circle
                  key={`c-${i}`}
                  cx={nx * overlaySize.w}
                  cy={ny * overlaySize.h}
                  r={7}
                  fill="#22C55E"
                  stroke="#FFF"
                  strokeWidth={2}
                />
              ))}
            </Svg>
          )}
        </View>

        {/* Overlay corner-guides to help user frame the document */}
        <View pointerEvents="none" style={styles.guides}>
          <View style={[styles.corner, styles.cornerTL]} />
          <View style={[styles.corner, styles.cornerTR]} />
          <View style={[styles.corner, styles.cornerBL]} />
          <View style={[styles.corner, styles.cornerBR]} />
        </View>

        {/* Top bar */}
        <SafeAreaView edges={["top"]} style={styles.topBar} pointerEvents="box-none">
          <View style={styles.topBarInner}>
            <Pressable onPress={onClose} hitSlop={12} style={styles.circleBtn} testID="live-scan-close">
              <Ionicons name="close" size={22} color="#FFF" />
            </Pressable>
            <Pressable
              onPress={() => setEdgeDetectOn((v) => !v)}
              hitSlop={12}
              style={styles.topBadge}
              testID="live-scan-edge-toggle"
            >
              <Ionicons
                name={
                  edgeDetectOn
                    ? sharpness !== null && sharpness < SHARPNESS_THRESHOLD && liveCorners
                      ? "warning"
                      : liveCorners
                        ? "checkmark-circle"
                        : "scan-outline"
                    : "scan-outline"
                }
                size={13}
                color={
                  edgeDetectOn && liveCorners
                    ? sharpness !== null && sharpness < SHARPNESS_THRESHOLD
                      ? "#F59E0B"
                      : "#22C55E"
                    : "#FFF"
                }
              />
              <Text style={styles.topBadgeTxt}>
                {edgeDetectOn
                  ? liveCorners && sharpness !== null && sharpness < SHARPNESS_THRESHOLD
                    ? "Immagine mossa · tieni fermo per fuoco"
                    : autoCountdown !== null
                      ? `Scatto tra ${Math.max(0, Math.ceil((1 - autoCountdown) * 1))}s…`
                      : liveCorners
                        ? autoShutter
                          ? "Rilevato · tieni fermo per lo scatto"
                          : "Documento rilevato · tocca per scattare"
                        : "Cerco i bordi… inquadra il foglio"
                  : "Autofocus attivo · rilevamento OFF"}
                {processingCount > 0 ? ` · ${processingCount}` : ""}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setAutoShutter((v) => !v);
                stableSinceRef.current = null;
                setAutoCountdown(null);
              }}
              hitSlop={12}
              style={[styles.circleBtn, autoShutter && { backgroundColor: "#22C55E" }]}
              testID="live-scan-auto-toggle"
              accessibilityLabel={autoShutter ? "Passa a scatto manuale" : "Passa a scatto automatico"}
            >
              <Ionicons name={autoShutter ? "flash-outline" : "hand-left-outline"} size={18} color="#FFF" />
            </Pressable>
            <Pressable
              onPress={() => setTorch((t) => (t === "on" ? "off" : "on"))}
              hitSlop={12}
              style={[styles.circleBtn, torch === "on" && { backgroundColor: "#FF6B35" }]}
              testID="live-scan-torch"
            >
              <Ionicons name={torch === "on" ? "flash" : "flash-off"} size={20} color="#FFF" />
            </Pressable>
          </View>
        </SafeAreaView>

        {/* Bottom controls */}
        <SafeAreaView edges={["bottom"]} style={styles.bottomBar} pointerEvents="box-none">
          {/* Thumbnails strip (non in modalità Foto singola) */}
          {!singleShot && pages.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.stripInner}
              style={styles.strip}
            >
              {pages.map((p, i) => (
                <View key={`page-${i}`} style={styles.thumbWrap} testID={`live-scan-thumb-${i}`}>
                  <Image source={{ uri: p.preview_uri }} style={styles.thumb} resizeMode="cover" />
                  {p.cropped && (
                    <View style={styles.thumbBadge}>
                      <Ionicons name="cut" size={10} color="#FFF" />
                    </View>
                  )}
                  {p.blurry && (
                    <View style={styles.thumbBlurBadge} testID={`live-scan-thumb-blurry-${i}`}>
                      <Ionicons name="warning" size={10} color="#FFF" />
                    </View>
                  )}
                  <Pressable
                    onPress={() => removePage(i)}
                    style={styles.thumbDel}
                    testID={`live-scan-thumb-del-${i}`}
                    hitSlop={6}
                  >
                    <Ionicons name="close" size={12} color="#FFF" />
                  </Pressable>
                  <View style={styles.thumbNum}>
                    <Text style={styles.thumbNumTxt}>{i + 1}</Text>
                  </View>
                </View>
              ))}
            </ScrollView>
          )}

          {/* Shutter row */}
          <View style={styles.shutterRow}>
            <Pressable
              onPress={() => setFacing((f) => (f === "back" ? "front" : "back"))}
              hitSlop={12}
              style={styles.sideBtn}
              testID="live-scan-flip"
            >
              <Ionicons name="camera-reverse-outline" size={26} color="#FFF" />
            </Pressable>

            <Pressable
              onPress={takeShot}
              disabled={busy}
              style={[styles.shutter, busy && { opacity: 0.6 }, autoCountdown !== null && { borderColor: "#22C55E" }]}
              testID="live-scan-shutter"
              accessibilityLabel="Scatta"
            >
              {/* Auto-shutter progress ring: a green quadrant that grows around the shutter */}
              {autoCountdown !== null && autoCountdown > 0 && (
                <View
                  pointerEvents="none"
                  style={[
                    styles.shutterRing,
                    {
                      // Simulate progress with a rotating border sweep: grow diameter as fill
                      opacity: 0.75,
                      transform: [{ scale: 0.55 + 0.45 * autoCountdown }],
                    },
                  ]}
                />
              )}
              <View style={styles.shutterInner}>
                {busy ? (
                  <ActivityIndicator color="#FF6B35" />
                ) : autoCountdown !== null ? (
                  <Ionicons name="hourglass" size={26} color="#22C55E" />
                ) : (
                  <Ionicons name="camera" size={26} color="#FF6B35" />
                )}
              </View>
            </Pressable>

            {singleShot ? (
              <View style={[styles.sideBtn, { backgroundColor: "transparent" }]} pointerEvents="none">
                <Text style={[styles.doneTxt, { color: "rgba(255,255,255,0.7)" }]}>1 foto</Text>
              </View>
            ) : (
            <Pressable
              onPress={finish}
              hitSlop={12}
              style={[styles.sideBtn, pages.length > 0 && styles.sideBtnDone]}
              testID="live-scan-done"
            >
              {pages.length > 0 ? (
                <>
                  <Ionicons name="checkmark" size={18} color="#FFF" />
                  <Text style={styles.doneTxt}>Fine ({pages.length})</Text>
                </>
              ) : (
                <Text style={styles.doneTxt}>Fine</Text>
              )}
            </Pressable>
            )}
          </View>

        </SafeAreaView>

        {/* V50.z9 — Preview post-scatto obbligatoria (V50.z139: a schermo intero, fuori dalla barra inferiore) */}
        {reviewIdx !== null && pages[reviewIdx] && (
          <SafeAreaView style={styles.reviewOverlay} edges={["top", "bottom"]}>
            <View style={styles.reviewHeader}>
              <Text style={styles.reviewTitle}>{singleShot ? "Anteprima" : `Pagina ${reviewIdx + 1}`}</Text>
              {pages[reviewIdx].cropped ? (
                <View style={styles.cropBadge}>
                  <Ionicons name="checkmark-circle" size={14} color="#0F9D58" />
                  <Text style={styles.cropBadgeTxt}>Ritagliata automaticamente</Text>
                </View>
              ) : pages[reviewIdx].processed ? (
                <View style={styles.cropBadgeWarn}>
                  <Ionicons name="information-circle" size={14} color="#F59E0B" />
                  <Text style={styles.cropBadgeTxtWarn}>Bordi non rilevati · usa Ritaglia</Text>
                </View>
              ) : (
                <View style={styles.cropBadgeWarn}>
                  <ActivityIndicator size="small" color="#F59E0B" />
                  <Text style={styles.cropBadgeTxtWarn}>Ritaglio in corso…</Text>
                </View>
              )}
            </View>
            <View style={styles.reviewImgWrap}>
              <Image
                source={{ uri: pages[reviewIdx].preview_uri || `data:image/jpeg;base64,${pages[reviewIdx].data_base64}` }}
                style={styles.reviewImg}
                resizeMode="contain"
              />
            </View>
            <View style={styles.reviewActions}>
              <Pressable
                onPress={() => {
                  // Rifai: rimuovi pagina + torna alla camera
                  setPages((prev) => prev.filter((_, i) => i !== reviewIdx));
                  setReviewIdx(null);
                }}
                style={[styles.reviewBtn, { backgroundColor: "#DC2626" }]}
              >
                <Ionicons name="refresh" size={20} color="#FFF" />
                <Text style={styles.reviewBtnTxt}>Rifai</Text>
              </Pressable>
              <Pressable
                onPress={() => setCropOpen(true)}
                style={[styles.reviewBtn, { backgroundColor: "#FF6B35" }]}
                testID="live-review-crop"
              >
                <Ionicons name="crop" size={20} color="#FFF" />
                <Text style={styles.reviewBtnTxt}>Ritaglia</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  if (singleShot) {
                    // V50.z139 — Foto singola: restituisci subito la pagina (già ritagliata) e chiudi
                    const pg = pages[reviewIdx];
                    setReviewIdx(null);
                    if (pg) onDone([pg]);
                    return;
                  }
                  setReviewIdx(null);
                }}
                disabled={singleShot && !pages[reviewIdx].processed}
                style={[styles.reviewBtn, { backgroundColor: "#0F9D58" }, singleShot && !pages[reviewIdx].processed && { opacity: 0.55 }]}
                testID="live-review-ok"
              >
                {singleShot && !pages[reviewIdx].processed ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Ionicons name="checkmark" size={22} color="#FFF" />
                )}
                <Text style={styles.reviewBtnTxt}>{singleShot && !pages[reviewIdx].processed ? "Ritaglio…" : "Usa questa"}</Text>
              </Pressable>
            </View>
          </SafeAreaView>
        )}
      </View>
      {reviewIdx !== null && pages[reviewIdx] && (
        <ManualCropEditor
          visible={cropOpen}
          imageBase64={pages[reviewIdx].original_base64 || pages[reviewIdx].data_base64}
          enhance={enhance}
          grayscale={grayscale}
          onCancel={() => setCropOpen(false)}
          onDone={(r) => {
            setPages((prev) => prev.map((p, i) => (i === reviewIdx ? {
              ...p,
              original_base64: p.original_base64 || p.data_base64,
              data_base64: r.data_base64,
              mime: r.mime,
              preview_uri: r.preview_uri,
              cropped: true,
              manual: true,
            } : p)));
            setCropOpen(false);
          }}
        />
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  // V50.z9 — Preview post-scatto
  reviewOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#050505",
    padding: 14,
    paddingTop: 14,
    zIndex: 100,
    elevation: 100,
  },
  reviewHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  reviewTitle: { color: "#FFF", fontSize: 17, fontWeight: "900" },
  cropBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(15,157,88,0.2)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  cropBadgeTxt: { color: "#0F9D58", fontSize: 11, fontWeight: "800" },
  cropBadgeWarn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(245,158,11,0.2)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  cropBadgeTxtWarn: { color: "#F59E0B", fontSize: 11, fontWeight: "800" },
  reviewImgWrap: { flex: 1, backgroundColor: "#111", borderRadius: 8, overflow: "hidden", marginBottom: 12 },
  reviewImg: { width: "100%", height: "100%" },
  reviewActions: { flexDirection: "row", gap: 10, paddingBottom: 20 },
  reviewBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 999 },
  reviewBtnTxt: { color: "#FFF", fontSize: 15, fontWeight: "900" },
  guides: {
    position: "absolute",
    top: "18%",
    bottom: "22%",
    left: "8%",
    right: "8%",
  },
  corner: {
    position: "absolute",
    width: 32,
    height: 32,
    borderColor: "#FF6B35",
  },
  cornerTL: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 6 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 6 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 6 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 6 },

  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
  },
  topBarInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 10,
  },
  circleBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
  },
  topBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    flexShrink: 1,
  },
  topBadgeTxt: { color: "#FFF", fontSize: 11, fontWeight: "700" },

  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingTop: 8,
  },
  strip: { maxHeight: 84 },
  stripInner: { paddingHorizontal: 12, gap: 8, paddingVertical: 6 },
  thumbWrap: { position: "relative", width: 64, height: 64, borderRadius: 8, overflow: "visible" },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: 8,
    backgroundColor: "#111",
    borderWidth: 2,
    borderColor: "#FFF",
  },
  thumbBadge: {
    position: "absolute",
    top: -4,
    left: -4,
    backgroundColor: "#10B981",
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "#FFF",
  },
  thumbBlurBadge: {
    position: "absolute",
    top: 22,
    left: -4,
    backgroundColor: "#F59E0B",
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "#FFF",
  },
  thumbDel: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#DC2626",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "#FFF",
  },
  thumbNum: {
    position: "absolute",
    bottom: 2,
    right: 2,
    backgroundColor: "rgba(0,0,0,0.75)",
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 6,
  },
  thumbNumTxt: { color: "#FFF", fontSize: 10, fontWeight: "800" },

  shutterRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  sideBtn: {
    minWidth: 72,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.14)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    flexDirection: "row",
    gap: 6,
  },
  sideBtnDone: { backgroundColor: "#FF6B35" },
  doneTxt: { color: "#FFF", fontWeight: "800", fontSize: 13 },
  shutter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: "#FFF",
    alignItems: "center",
    justifyContent: "center",
  },
  shutterRing: {
    position: "absolute",
    top: -6,
    left: -6,
    right: -6,
    bottom: -6,
    borderRadius: 44,
    borderWidth: 4,
    borderColor: "#22C55E",
  },
  shutterInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#FFF",
    alignItems: "center",
    justifyContent: "center",
  },

  permWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 30, backgroundColor: "#0B1220" },
  permTitle: { color: "#F1F5F9", fontSize: 18, fontWeight: "800", marginTop: 16, textAlign: "center" },
  permSub: { color: "#94A3B8", fontSize: 13, textAlign: "center", marginTop: 8, lineHeight: 19 },
  permBtn: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12 },
});

export default LiveCameraScanner;

// corporate-gym/area/[id].tsx — V50.z365 — Pagina area: blocchi, MATERIALI (Master carica · tutti aprono/scaricano),
// REGISTRAZIONE TRATTATIVA REALE (Master carica audio/video · consulenti solo riproduzione in app), Sessione live con Axon,
// analisi di una propria registrazione, storico valutazioni.
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import * as FileSystem from "expo-file-system/legacy";
import { getToken } from "@/src/api"; // V50.z387
import * as Sharing from "expo-sharing";
import { notify } from "@/src/utils/notify";
import { pickCommonFile } from "@/src/utils/filePicker";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { cgaApi, CgaArea, CgaMaterial, CgaReference, RATING_COLOR, type CgaLevel, CGA_LEVEL_LABEL, CGA_LEVEL_HINT } from "@/src/corporate-gym/areasApi";
import { CgymAreaLogo } from "@/src/corporate-gym/CgymAreasGrid";
import { ReferencePlayer } from "@/src/corporate-gym/ReferencePlayer";
import { saveToAndroidDownloads } from "@/src/corporate-gym/manualsApi"; // V50.z395 — download in cartella Download (Android)
import { TranscriptReviewSheet, transcriptApi, TRANSCRIPT_STATUS_LABEL, type AudioTranscript } from "@/src/audio/TranscriptReviewSheet"; // V50.z389
import { HT } from "@/src/homeTheme";

const fmtSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export default function CgymAreaScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const pad = usePageBottomPadding();
  const [area, setArea] = useState<CgaArea | null>(null);
  const [master, setMaster] = useState(false);
  const [mats, setMats] = useState<CgaMaterial[]>([]);
  const [refs, setRefs] = useState<CgaReference[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [level, setLevel] = useState<CgaLevel>("base"); // V50.z387 — livello di addestramento scelto prima della sessione
  const [playing, setPlaying] = useState<{ url: string; title: string } | null>(null); // V50.z388 — player audio in app
  const [review, setReview] = useState<{ id: string; title: string } | null>(null); // V50.z389 — revisione/lettura trascrizione
  const [transcripts, setTranscripts] = useState<Record<string, AudioTranscript>>({}); // per ref_id

  const [loadError, setLoadError] = useState<string | null>(null); // V50.z389 — mai spinner infinito
  const load = useCallback(async () => {
    setLoadError(null);
    const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error("Il server non risponde (timeout 15 s). Controlla la connessione e riprova.")), 15000));
    try {
      const [a, m, r] = await Promise.race([Promise.all([cgaApi.areas(), cgaApi.materials(String(id)), cgaApi.references(String(id))]), timeout]);
      const found = a.items.find((x) => x.area_id === id) || null;
      setArea(found); setMaster(a.is_master); setMats(m.items); setRefs(r.items);
      if (!found) setLoadError("Area non trovata o non più disponibile.");
      // V50.z389 — stato trascrizioni (pubblicate per tutti · bozze solo per chi le ha caricate / Master)
      try { const t = await transcriptApi.list({ source_kind: "cgym_reference" }); setTranscripts(Object.fromEntries(t.items.map((x) => [x.source_id, x]))); } catch { /* opzionale */ }
    } catch (e: any) { setLoadError(String(e?.message || "Errore caricamento")); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  // V50.z394 — finché una trascrizione è in corso, aggiorno ogni 6 s così il testo compare da solo sotto l'audio
  useEffect(() => {
    if (!Object.values(transcripts).some((t) => t.status === "transcribing")) return;
    const iv = setInterval(() => { transcriptApi.list({ source_kind: "cgym_reference" }).then((t) => setTranscripts(Object.fromEntries(t.items.map((x) => [x.source_id, x])))).catch(() => {}); }, 6000);
    return () => clearInterval(iv);
  }, [transcripts]);

  const addMaterial = async () => {
    const { asset, error, base64 } = await pickCommonFile();
    if (error) { notify(error); return; }
    if (!asset) return;
    setBusy("mat");
    try {
      const b64 = base64 || (asset.uri && !asset.uri.startsWith("data:") ? await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 }) : (asset.uri || "").split(",")[1]);
      await cgaApi.addMaterial(String(id), { name: asset.name || "documento", mime: asset.mimeType || "application/pdf", data_base64: b64 || "" });
      notify("Materiale caricato (compresso)"); await load();
    } catch (e: any) { notify(e?.message || "Errore upload"); } finally { setBusy(null); }
  };

  const openMaterial = async (m: CgaMaterial, download: boolean) => {
    setBusy(m.material_id);
    try {
      const c = await cgaApi.materialContent(String(id), m.material_id);
      if (Platform.OS === "web") {
        const bin = atob(c.data_base64); const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        const url = URL.createObjectURL(new Blob([arr], { type: c.mime }));
        if (download) { const a = document.createElement("a"); a.href = url; a.download = c.name; a.click(); } else window.open(url, "_blank");
        return;
      }
      if (download && Platform.OS === "android") { await saveToAndroidDownloads(c.name.replace(/[^\w.\-àèéìòù ]+/gi, "_"), c.mime, c.data_base64); notify("Salvato nella cartella Download"); return; } // V50.z395 — niente pannello condivisione
      const path = `${FileSystem.cacheDirectory}cgym_${m.material_id}_${c.name.replace(/[^\w.\-]+/g, "_")}`;
      await FileSystem.writeAsStringAsync(path, c.data_base64, { encoding: FileSystem.EncodingType.Base64 });
      await Sharing.shareAsync(path, { mimeType: c.mime, dialogTitle: download ? "Salva su File" : c.name });
    } catch (e: any) { notify(e?.message || "Impossibile aprire il file"); } finally { setBusy(null); }
  };

  const addReference = async () => {
    const DocumentPicker = await import("expo-document-picker");
    const res = await DocumentPicker.getDocumentAsync({ type: ["audio/*", "video/*"], multiple: false, copyToCacheDirectory: true });
    const a = res.assets?.[0];
    if (!a) return;
    setBusy("ref");
    try {
      // V50.z387 — «Network request failed» con file audio/video da Google Drive: su nativo l'upload usa
      // FileSystem.uploadAsync (multipart nativo, gestisce content:// e file grandi) invece del FormData JS.
      const sizeMb = a.size ? a.size / (1024 * 1024) : 0;
      if (sizeMb > 200) throw new Error(`File troppo grande (${sizeMb.toFixed(0)} MB): il limite è 200 MB. Riduci la durata o la qualità della registrazione.`);
      let created: CgaReference | null = null;
      if (Platform.OS === "web") {
        const form = new FormData();
        const blob = await (await fetch(a.uri)).blob(); form.append("file", blob, a.name || "trattativa");
        form.append("title", a.name || "Trattativa reale");
        created = await cgaApi.addReference(String(id), form);
      } else {
        const token = await getToken();
        const up = await FileSystem.uploadAsync(`${process.env.EXPO_PUBLIC_BACKEND_URL}/api/cgym/areas/${id}/references`, a.uri, {
          httpMethod: "POST", uploadType: FileSystem.FileSystemUploadType.MULTIPART, fieldName: "file",
          mimeType: a.mimeType || "audio/m4a", parameters: { title: a.name || "Trattativa reale" },
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (up.status >= 400) {
          let msg = `Errore server (HTTP ${up.status})`;
          try { const j = JSON.parse(up.body || "{}"); msg = typeof j.detail === "string" ? j.detail : msg; } catch {}
          throw new Error(msg);
        }
        try { created = JSON.parse(up.body || "null"); } catch { created = null; }
      }
      notify("Registrazione caricata · la compressione avviene in background"); await load();
      setTimeout(() => { void load(); }, 25000); // aggiorna dimensione quando la compressione è finita
      // V50.z389 — FUNZ. 4: audio → apro subito la revisione della trascrizione (polling finché la bozza è pronta)
      if (created?.transcript_id) setReview({ id: created.transcript_id, title: created.title });
    } catch (e: any) {
      const m = String(e?.message || "");
      notify(/Network request failed|network|ECONN|timed? ?out/i.test(m)
        ? "File non raggiungibile: se viene da Google Drive verifica che sia scaricato/disponibile offline e che la connessione sia stabile, poi riprova."
        : (m || "Errore upload registrazione"));
    } finally { setBusy(null); }
  };

  const playReference = async (r: CgaReference) => {
    setBusy(r.ref_id);
    try {
      const l = await cgaApi.referenceLink(r.ref_id);
      if (r.kind === "audio") { setPlaying({ url: l.url, title: r.title }); return; } // V50.z388 — player audio nativo in app
      router.push(`/webviewer?url=${encodeURIComponent(l.url)}&title=${encodeURIComponent(r.title)}` as any); // video: riproduzione inline, nessun download
    } catch (e: any) { notify(e?.message || "Riproduzione non disponibile"); } finally { setBusy(null); }
  };

  const analyzeMine = async () => {
    const DocumentPicker = await import("expo-document-picker");
    const res = await DocumentPicker.getDocumentAsync({ type: ["audio/*"], multiple: false, copyToCacheDirectory: true });
    const a = res.assets?.[0];
    if (!a) return;
    setBusy("analyze");
    try {
      const b64 = a.uri.startsWith("data:") ? a.uri.split(",")[1] : await FileSystem.readAsStringAsync(a.uri, { encoding: FileSystem.EncodingType.Base64 });
      const s = await cgaApi.fromRecording({ area_id: String(id), audio_base64: b64, mime: a.mimeType || "audio/m4a", title: a.name, training_level: level });
      router.push(`/corporate-gym/live?session=${s.session_id}` as any);
    } catch (e: any) { notify(e?.message || "Analisi non riuscita"); } finally { setBusy(null); }
  };

  if (!area) return (
    <SafeAreaView style={[styles.root, { alignItems: "center", justifyContent: "center", padding: 24, gap: 12 }]} edges={["top"]}>
      {loadError ? (<>
        <Ionicons name="cloud-offline-outline" size={40} color={HT.muted} />
        <Text style={{ color: HT.muted, textAlign: "center" }} testID="cgym-area-error">{loadError}</Text>
        <Pressable onPress={() => { void load(); }} style={[styles.cta, { backgroundColor: HT.violet, paddingHorizontal: 18 }]} testID="cgym-area-retry"><Ionicons name="refresh" size={18} color="#FFF" /><Text style={styles.ctaTxt}>Riprova</Text></Pressable>
        <Pressable onPress={() => router.back()} style={{ minHeight: 44, justifyContent: "center" }}><Text style={{ color: HT.muted, fontWeight: "700" }}>Indietro</Text></Pressable>
      </>) : (<><ActivityIndicator color={HT.violet} /><Text style={{ color: HT.muted }}>Carico l'area…</Text></>)}
    </SafeAreaView>
  );
  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} testID="cgym-area-back"><Ionicons name="chevron-back" size={24} color={HT.text} /></Pressable>
        <CgymAreaLogo a={area} size={44} />
        <View style={{ flex: 1 }}><Text style={styles.title} numberOfLines={1}>{area.name}</Text><Text style={styles.sub} numberOfLines={1}>{area.description || `${area.blocks.length} blocchi`}</Text></View>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: pad }}>
        {/* V50.z387 — Livello di addestramento (scelto PRIMA di iniziare): BASE · MEDIO · ESPERTO */}
        <View style={{ gap: 6 }} testID="cgym-level-picker">
          <View style={{ flexDirection: "row", gap: 8 }}>
            {(["base", "medio", "esperto"] as CgaLevel[]).map((lv) => (
              <Pressable key={lv} onPress={() => setLevel(lv)} style={[styles.ghost, { flex: 1, alignItems: "center", borderColor: level === lv ? area.color : HT.border, borderWidth: 2 }]} testID={`cgym-level-${lv}`}>
                <Text style={[styles.ghostTxt, level === lv && { color: area.color }]}>{CGA_LEVEL_LABEL[lv]}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={{ color: HT.muted, fontSize: 12 }}>{CGA_LEVEL_HINT[level]}</Text>
        </View>
        <Pressable onPress={() => router.push(`/corporate-gym/live?area=${area.area_id}&level=${level}` as any)} style={[styles.cta, { backgroundColor: area.color }]} testID="cgym-live-start">
          <Ionicons name="videocam" size={20} color="#FFF" /><Text style={styles.ctaTxt}>Sessione live viso a viso con Axon</Text>
        </Pressable>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Pressable onPress={analyzeMine} disabled={busy === "analyze"} style={[styles.ghost, { flex: 1 }]} testID="cgym-analyze-recording">
            {busy === "analyze" ? <ActivityIndicator color={HT.violet} /> : <Ionicons name="mic-circle" size={18} color={HT.violet} />}<Text style={styles.ghostTxt}>Analizza una mia registrazione</Text>
          </Pressable>
          <Pressable onPress={() => router.push(`/corporate-gym/ratings?area_id=${area.area_id}` as any)} style={[styles.ghost, { flex: 1 }]} testID="cgym-area-ratings">
            <Ionicons name="trending-up" size={18} color={HT.violet} /><Text style={styles.ghostTxt}>Storico valutazioni</Text>
          </Pressable>
        </View>
        {area.my_last_rating ? <Text style={[styles.rating, { color: RATING_COLOR[area.my_last_rating] }]}>Ultima valutazione: {area.my_last_rating}</Text> : null}

        <View style={styles.card}>
          <Text style={styles.cardHead}>Blocchi della trattativa</Text>
          {area.blocks.map((b, i) => <View key={i} style={styles.row}><View style={[styles.num, { backgroundColor: area.color }]}><Text style={styles.numTxt}>{i + 1}</Text></View><Text style={styles.rowTxt}>{b}</Text></View>)}
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeadRow}><Text style={styles.cardHead}>Materiali di riferimento</Text>{master ? <Pressable onPress={addMaterial} disabled={busy === "mat"} style={styles.miniBtn} testID="cgym-material-add">{busy === "mat" ? <ActivityIndicator color="#FFF" size="small" /> : <Ionicons name="add" size={16} color="#FFF" />}<Text style={styles.miniTxt}>Carica</Text></Pressable> : null}</View>
          {mats.length === 0 ? <Text style={styles.empty}>Nessun materiale{master ? ": carica PDF o immagini per i consulenti" : ""}.</Text> : mats.map((m) => (
            <View key={m.material_id} style={styles.row} testID={`cgym-material-${m.material_id}`}>
              <Ionicons name={m.mime.includes("pdf") ? "document-text" : "image"} size={20} color={HT.violet} />
              <View style={{ flex: 1 }}><Text style={styles.rowTxt} numberOfLines={1}>{m.name}</Text><Text style={styles.meta}>{fmtSize(m.size)}</Text></View>
              {busy === m.material_id ? <ActivityIndicator color={HT.violet} size="small" /> : (<>
                <Pressable onPress={() => openMaterial(m, false)} hitSlop={8} style={styles.iconBtn}><Ionicons name="eye" size={18} color={HT.text} /></Pressable>
                <Pressable onPress={() => openMaterial(m, true)} hitSlop={8} style={styles.iconBtn}><Ionicons name="download" size={18} color={HT.text} /></Pressable>
                {master ? <Pressable onPress={async () => { await cgaApi.delMaterial(String(id), m.material_id); load(); }} hitSlop={8} style={styles.iconBtn}><Ionicons name="trash" size={18} color={HT.danger} /></Pressable> : null}
              </>)}
            </View>
          ))}
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeadRow}><Text style={styles.cardHead}>Trattativa reale (campione)</Text>{master ? <Pressable onPress={addReference} disabled={busy === "ref"} style={styles.miniBtn} testID="cgym-reference-add">{busy === "ref" ? <ActivityIndicator color="#FFF" size="small" /> : <Ionicons name="cloud-upload" size={16} color="#FFF" />}<Text style={styles.miniTxt}>Audio/Video</Text></Pressable> : null}</View>
          <Text style={styles.meta}>{master ? "Registrazioni sul campo caricate dal Master · audio riservato al Master, i consulenti leggono la trascrizione in app." : "Video: riproduzione in app · Audio: trascrizione in sola lettura, l'originale resta al Master."}</Text>
          {refs.length === 0 ? <Text style={styles.empty}>Nessuna registrazione{master ? ": carica un audio o un video di una trattativa reale" : ""}.</Text> : null}
          {refs.map((r) => {
            const tr = transcripts[r.ref_id];
            const canPlay = r.kind === "video" || master;
            return (
            <View key={r.ref_id} style={{ gap: 6 }} testID={`cgym-reference-${r.ref_id}`}>
              <View style={styles.row}>
                <Ionicons name={r.kind === "video" ? "videocam" : "musical-notes"} size={20} color={HT.violet} />
                <View style={{ flex: 1 }}><Text style={styles.rowTxt} numberOfLines={1}>{r.title}</Text><Text style={styles.meta}>{r.kind} · {fmtSize(r.size)}{r.compressing ? " · compressione in corso…" : ""}{tr ? ` · ${TRANSCRIPT_STATUS_LABEL[tr.status]}` : ""}</Text></View>
                {canPlay ? <Pressable onPress={() => playReference(r)} disabled={busy === r.ref_id} style={[styles.miniBtn, { backgroundColor: area.color }]} testID={`cgym-reference-play-${r.ref_id}`}>{busy === r.ref_id ? <ActivityIndicator color="#FFF" size="small" /> : <Ionicons name="play" size={14} color="#FFF" />}<Text style={styles.miniTxt}>Riproduci</Text></Pressable> : null}
                {master ? <Pressable onPress={async () => { try { await cgaApi.delReference(r.ref_id); } catch (e: any) { notify(e?.message || "Eliminazione non riuscita"); } load(); }} hitSlop={8} style={styles.iconBtn}><Ionicons name="trash" size={18} color={HT.danger} /></Pressable> : null}
              </View>
              {r.kind === "audio" && (tr || r.transcript_id) ? (
                <Pressable onPress={() => setReview({ id: tr?.transcript_id || String(r.transcript_id), title: r.title })} style={[styles.ghost, { alignSelf: "flex-start", minHeight: 36 }, tr?.status === "draft" && tr.can_edit && { borderColor: "#F59E0B", backgroundColor: HT.warningTint }]} testID={`cgym-reference-transcript-${r.ref_id}`}>
                  <Ionicons name={tr?.status === "draft" && tr.can_edit ? "create-outline" : "document-text-outline"} size={16} color={tr?.status === "draft" && tr.can_edit ? "#D97706" : HT.violet} />
                  <Text style={[styles.ghostTxt, tr?.status === "draft" && tr.can_edit && { color: "#D97706" }]}>{tr?.status === "draft" && tr.can_edit ? "Rivedi e conferma la trascrizione" : tr?.status === "published" ? "Apri la trascrizione" : tr?.status === "failed" ? "Trascrizione non riuscita" : "Trascrizione in corso…"}</Text>
                </Pressable>
              ) : null}
              {/* V50.z394 — il testo trascritto è visibile DIRETTAMENTE sotto il file audio (pubblicato per tutti · bozza per chi l'ha caricato/Master) */}
              {r.kind === "audio" && tr?.text ? (
                <View style={styles.transcriptBox} testID={`cgym-reference-transcript-text-${r.ref_id}`}>
                  <Text style={styles.transcriptLbl}>Trascrizione:{tr.status === "draft" ? " (bozza, visibile solo a te finché non la confermi)" : ""}</Text>
                  <Text style={styles.transcriptTxt} selectable={false}>{tr.text}</Text>
                </View>
              ) : r.kind === "audio" && tr?.status === "transcribing" ? (
                <View style={styles.transcriptBox}><Text style={styles.transcriptLbl}>Trascrizione:</Text><View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><ActivityIndicator size="small" color={HT.violet} /><Text style={styles.meta}>in elaborazione, appare qui appena pronta…</Text></View></View>
              ) : null}
            </View>
            );
          })}
        </View>
      </ScrollView>
      <ReferencePlayer url={playing?.url || null} title={playing?.title || ""} color={area.color} onClose={() => setPlaying(null)} />
      <TranscriptReviewSheet transcriptId={review?.id || null} title={review?.title} onClose={() => { setReview(null); void load(); }} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: HT.bg },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: HT.border, backgroundColor: HT.card },
  title: { fontSize: 17, fontWeight: "900", color: HT.text }, sub: { fontSize: 12, color: HT.muted },
  cta: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, minHeight: 52, borderRadius: 14 }, ctaTxt: { color: "#FFF", fontWeight: "900", fontSize: 15 },
  ghost: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: HT.violet + "66", backgroundColor: HT.violetTint, paddingHorizontal: 8 },
  transcriptBox: { backgroundColor: HT.card2, borderRadius: 12, padding: 12, gap: 6, borderLeftWidth: 3, borderLeftColor: HT.violet },
  transcriptLbl: { fontSize: 12, fontWeight: "900", color: HT.violet, textTransform: "uppercase", letterSpacing: 0.4 },
  transcriptTxt: { fontSize: 14, lineHeight: 21, color: HT.text },
  ghostTxt: { color: HT.violet, fontWeight: "800", fontSize: 12, flexShrink: 1 },
  rating: { fontSize: 13, fontWeight: "900", textAlign: "center" },
  card: { backgroundColor: HT.card, borderRadius: 16, borderWidth: 1, borderColor: HT.border, padding: 14, gap: 10 },
  cardHead: { fontSize: 13, fontWeight: "900", color: HT.muted, textTransform: "uppercase", letterSpacing: 0.4 },
  cardHeadRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 40 },
  num: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" }, numTxt: { color: "#FFF", fontWeight: "900", fontSize: 12 },
  rowTxt: { flex: 1, fontSize: 14, color: HT.text, fontWeight: "600" }, meta: { fontSize: 11, color: HT.muted },
  empty: { fontSize: 13, color: HT.muted },
  miniBtn: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 34, paddingHorizontal: 10, borderRadius: 10, backgroundColor: HT.violet }, miniTxt: { color: "#FFF", fontWeight: "800", fontSize: 12 },
  iconBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
});

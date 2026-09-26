// corporate-gym/area/[id].tsx — V50.z365 — Pagina area: blocchi, MATERIALI (Master carica · tutti aprono/scaricano),
// REGISTRAZIONE TRATTATIVA REALE (Master carica audio/video · consulenti solo riproduzione in app), Sessione live con Axon,
// analisi di una propria registrazione, storico valutazioni.
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { notify } from "@/src/utils/notify";
import { pickCommonFile } from "@/src/utils/filePicker";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { cgaApi, CgaArea, CgaMaterial, CgaReference, RATING_COLOR } from "@/src/corporate-gym/areasApi";
import { CgymAreaLogo } from "@/src/corporate-gym/CgymAreasGrid";
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

  const load = useCallback(async () => {
    try {
      const [a, m, r] = await Promise.all([cgaApi.areas(), cgaApi.materials(String(id)), cgaApi.references(String(id))]);
      setArea(a.items.find((x) => x.area_id === id) || null); setMaster(a.is_master); setMats(m.items); setRefs(r.items);
    } catch (e: any) { notify(e?.message || "Errore caricamento"); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

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
      const path = `${FileSystem.cacheDirectory}cgym_${m.material_id}_${c.name.replace(/[^\w.\-]+/g, "_")}`;
      await FileSystem.writeAsStringAsync(path, c.data_base64, { encoding: FileSystem.EncodingType.Base64 });
      await Sharing.shareAsync(path, { mimeType: c.mime, dialogTitle: download ? "Salva / condividi" : c.name });
    } catch (e: any) { notify(e?.message || "Impossibile aprire il file"); } finally { setBusy(null); }
  };

  const addReference = async () => {
    const DocumentPicker = await import("expo-document-picker");
    const res = await DocumentPicker.getDocumentAsync({ type: ["audio/*", "video/*"], multiple: false, copyToCacheDirectory: true });
    const a = res.assets?.[0];
    if (!a) return;
    setBusy("ref");
    try {
      const form = new FormData();
      if (Platform.OS === "web") { const blob = await (await fetch(a.uri)).blob(); form.append("file", blob, a.name || "trattativa"); }
      else form.append("file", { uri: a.uri, name: a.name || "trattativa", type: a.mimeType || "audio/m4a" } as any);
      form.append("title", a.name || "Trattativa reale");
      await cgaApi.addReference(String(id), form);
      notify("Registrazione caricata e compressa"); await load();
    } catch (e: any) { notify(e?.message || "Errore upload registrazione"); } finally { setBusy(null); }
  };

  const playReference = async (r: CgaReference) => {
    try {
      const l = await cgaApi.referenceLink(r.ref_id);
      router.push(`/webviewer?url=${encodeURIComponent(l.url)}&title=${encodeURIComponent(r.title)}` as any); // riproduzione inline, nessun download
    } catch (e: any) { notify(e?.message || "Riproduzione non disponibile"); }
  };

  const analyzeMine = async () => {
    const DocumentPicker = await import("expo-document-picker");
    const res = await DocumentPicker.getDocumentAsync({ type: ["audio/*"], multiple: false, copyToCacheDirectory: true });
    const a = res.assets?.[0];
    if (!a) return;
    setBusy("analyze");
    try {
      const b64 = a.uri.startsWith("data:") ? a.uri.split(",")[1] : await FileSystem.readAsStringAsync(a.uri, { encoding: FileSystem.EncodingType.Base64 });
      const s = await cgaApi.fromRecording({ area_id: String(id), audio_base64: b64, mime: a.mimeType || "audio/m4a", title: a.name });
      router.push(`/corporate-gym/live?session=${s.session_id}` as any);
    } catch (e: any) { notify(e?.message || "Analisi non riuscita"); } finally { setBusy(null); }
  };

  if (!area) return <SafeAreaView style={styles.root}><ActivityIndicator color={HT.violet} style={{ marginTop: 40 }} /></SafeAreaView>;
  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} testID="cgym-area-back"><Ionicons name="chevron-back" size={24} color={HT.text} /></Pressable>
        <CgymAreaLogo a={area} size={44} />
        <View style={{ flex: 1 }}><Text style={styles.title} numberOfLines={1}>{area.name}</Text><Text style={styles.sub} numberOfLines={1}>{area.description || `${area.blocks.length} blocchi`}</Text></View>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: pad }}>
        <Pressable onPress={() => router.push(`/corporate-gym/live?area=${area.area_id}` as any)} style={[styles.cta, { backgroundColor: area.color }]} testID="cgym-live-start">
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
          <Text style={styles.meta}>Registrazioni sul campo caricate dal Master · solo riproduzione in app, non scaricabili.</Text>
          {refs.map((r) => (
            <View key={r.ref_id} style={styles.row} testID={`cgym-reference-${r.ref_id}`}>
              <Ionicons name={r.kind === "video" ? "videocam" : "musical-notes"} size={20} color={HT.violet} />
              <View style={{ flex: 1 }}><Text style={styles.rowTxt} numberOfLines={1}>{r.title}</Text><Text style={styles.meta}>{r.kind} · {fmtSize(r.size)}</Text></View>
              <Pressable onPress={() => playReference(r)} style={[styles.miniBtn, { backgroundColor: area.color }]}><Ionicons name="play" size={14} color="#FFF" /><Text style={styles.miniTxt}>Riproduci</Text></Pressable>
              {master ? <Pressable onPress={async () => { await cgaApi.delReference(r.ref_id); load(); }} hitSlop={8} style={styles.iconBtn}><Ionicons name="trash" size={18} color={HT.danger} /></Pressable> : null}
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: HT.bg },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: HT.border, backgroundColor: HT.card },
  title: { fontSize: 17, fontWeight: "900", color: HT.text }, sub: { fontSize: 12, color: HT.muted },
  cta: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, minHeight: 52, borderRadius: 14 }, ctaTxt: { color: "#FFF", fontWeight: "900", fontSize: 15 },
  ghost: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: HT.violet + "66", backgroundColor: HT.violetTint, paddingHorizontal: 8 },
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

// axon-media.tsx — V50.z199 — BLOCCO 8 · Fase 3: Archivio intelligente foto / audio / video (schermata ISOLATA)
// Cattura (foto, video, nota vocale) o allega → Axon trascrive/descrive in background → chiede «Privata o aziendale?».
// Sfere 🔵 Business / 🟢 Home / ⚪ Non classificato (mai mescolate). Ricerca nel testo trascritto, descrizioni, OCR e tag.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Platform, Alert, Linking, TextInput, Modal, Image } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { useInsetsSafe } from "@/src/hooks/useSafeBottom";
import { api, buildFileUrl } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { MediaVoiceRecorder } from "@/src/MediaVoiceRecorder";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

type Sphere = "business" | "home" | "unclassified";
type Kind = "photo" | "audio" | "video";
type Media = {
  media_id: string; kind: Kind; sphere: Sphere; title: string; mime: string; size: number; duration_sec?: number | null; status: "processing" | "ready" | "error";
  transcript?: string | null; summary?: string | null; description?: string | null; ocr_text?: string | null; tags?: string[]; actions?: string[]; suggested_sphere?: Sphere | null;
  note?: string | null; error?: string | null; created_at: string; sphere_icon: string; sphere_label: string;
};
type ListResp = { items: Media[]; counts: Record<Sphere, number>; processing: number };

const COLOR: Record<Sphere, string> = { business: "#2563EB", home: "#059669", unclassified: HT.muted };
const ICON: Record<Sphere, string> = { business: "🔵", home: "🟢", unclassified: "⚪" };
const LABEL: Record<Sphere, string> = { business: "Business", home: "Home (privata)", unclassified: "Da classificare" };
const KIND_ICON: Record<Kind, any> = { photo: "image", audio: "mic", video: "videocam" };
const KIND_LABEL: Record<Kind, string> = { photo: "Foto", audio: "Audio", video: "Video" };

async function ensureCamera(): Promise<boolean> {
  const perm = await ImagePicker.getCameraPermissionsAsync();
  if (perm.granted) return true;
  const r = perm.canAskAgain ? await ImagePicker.requestCameraPermissionsAsync() : perm;
  if (r.granted) return true;
  if (!r.canAskAgain) Alert.alert("Fotocamera disattivata", "Per scattare foto e video abilita la fotocamera nelle impostazioni.", [{ text: "Annulla", style: "cancel" }, { text: "Apri impostazioni", onPress: () => Linking.openSettings() }]);
  return false;
}

async function uriToB64(uri: string): Promise<string> {
  const blob = await (await fetch(uri)).blob();
  return new Promise((resolve) => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result).split(",")[1] || ""); fr.readAsDataURL(blob); });
}

type Picked = { kind: Kind; data_base64: string; mime: string; name: string; duration_sec?: number };

async function capture(kind: "photo" | "video"): Promise<Picked | null> {
  if (!(await ensureCamera())) return null;
  const res = await ImagePicker.launchCameraAsync(kind === "photo" ? { mediaTypes: ["images"], quality: 0.7, base64: true } : { mediaTypes: ["videos"], videoMaxDuration: 60, quality: 0.5 as any });
  if (res.canceled || !res.assets?.[0]) return null;
  const a = res.assets[0];
  const b64 = a.base64 || (await uriToB64(a.uri));
  return { kind, data_base64: b64, mime: a.mimeType || (kind === "photo" ? "image/jpeg" : "video/mp4"), name: a.fileName || `${kind}.${kind === "photo" ? "jpg" : "mp4"}`, duration_sec: a.duration ? a.duration / 1000 : undefined };
}

async function attach(): Promise<Picked | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: ["image/*", "video/*", "audio/*"], copyToCacheDirectory: true });
  if (res.canceled || !res.assets?.[0]) return null;
  const a = res.assets[0];
  const mime = a.mimeType || "";
  const kind: Kind = mime.startsWith("video") ? "video" : mime.startsWith("audio") ? "audio" : "photo";
  if ((a.size || 0) > 25 * 1024 * 1024) { notify("File troppo grande", "Massimo 25 MB per elemento."); return null; }
  return { kind, data_base64: await uriToB64(a.uri), mime: mime || "application/octet-stream", name: a.name || "file" };
}

export default function AxonMediaScreen() {
  const router = useRouter();
  const insets = useInsetsSafe();
  const params = useLocalSearchParams<{ sphere?: string }>();
  const [sphere, setSphere] = useState<Sphere>(params.sphere === "home" ? "home" : params.sphere === "unclassified" ? "unclassified" : "business");
  const [q, setQ] = useState("");
  const [data, setData] = useState<ListResp | null>(null);
  const [busy, setBusy] = useState<string>("");
  const [recording, setRecording] = useState(false);
  const [askFor, setAskFor] = useState<Media | null>(null);
  const [open, setOpen] = useState<Media | null>(null);
  const [fileUrl, setFileUrl] = useState<string>("");
  const audioRef = useRef<any>(null);
  const [playing, setPlaying] = useState(false);
  const color = COLOR[sphere];

  const load = useCallback(async (silent = false) => {
    try { setData(await api<ListResp>("/axon/media", { query: { sphere, q: q.trim() || undefined } })); }
    catch (e: any) { if (!silent) notify("Archivio media", e?.message || String(e)); }
  }, [sphere, q]);
  useEffect(() => { const t = setTimeout(() => void load(), q ? 350 : 0); return () => clearTimeout(t); }, [load, q]);
  useEffect(() => {   // poll finché Axon sta trascrivendo
    if (!data?.processing) return;
    const t = setInterval(() => void load(true), 4000);
    return () => clearInterval(t);
  }, [data?.processing, load]);
  useEffect(() => () => { stopAudio(); }, []);

  const stopAudio = () => { try { audioRef.current?.pause?.(); audioRef.current?.remove?.(); } catch {} audioRef.current = null; setPlaying(false); };

  const send = async (pp: Picked | null | Promise<Picked | null>) => {
    const p = await pp;
    if (!p) return;
    setBusy("upload");
    try {
      const r = await api<{ media: Media; ask_sphere: boolean; reply: string }>("/axon/media", { method: "POST", body: { kind: p.kind, data_base64: p.data_base64, mime: p.mime, name: p.name, duration_sec: p.duration_sec } });
      setAskFor(r.media);
      await load(true);
    } catch (e: any) { notify("Axon", e?.message || String(e)); } finally { setBusy(""); }
  };

  const classify = async (m: Media, s: Sphere) => {
    try {
      const r = await api<{ media: Media; reply?: string }>(`/axon/media/${m.media_id}`, { method: "PUT", body: { sphere: s } });
      if (askFor?.media_id === m.media_id) setAskFor(null);
      if (open?.media_id === m.media_id) setOpen({ ...open, sphere: s });
      notify(`${ICON[s]} Classificato`, r.reply || "");
      await load(true);
    } catch (e: any) { notify("Axon", e?.message || String(e)); }
  };

  const remove = (m: Media) => {
    const go = async () => { if (open?.media_id === m.media_id) { stopAudio(); setOpen(null); } await api(`/axon/media/${m.media_id}`, { method: "DELETE" }); await load(true); };
    if (Platform.OS === "web") { if ((globalThis as any).window.confirm(`Eliminare «${m.title}»?`)) void go(); return; }
    Alert.alert("Elimina", `«${m.title}»`, [{ text: "Annulla", style: "cancel" }, { text: "Elimina", style: "destructive", onPress: () => void go() }]);
  };

  const openDetail = async (m: Media) => {
    stopAudio();
    try {
      const full = await api<Media>(`/axon/media/${m.media_id}`);
      setFileUrl(await buildFileUrl(`/axon/media/${m.media_id}/file`));
      setOpen(full);
    } catch (e: any) { notify("Axon", e?.message || String(e)); }
  };

  const togglePlay = async () => {
    if (!open) return;
    if (playing) { stopAudio(); return; }
    try {
      if (Platform.OS === "web") {
        const el = new (globalThis as any).Audio(fileUrl); audioRef.current = el;
        el.onended = () => setPlaying(false); el.onerror = () => { setPlaying(false); notify("Errore", "Riproduzione non riuscita"); };
        await el.play(); setPlaying(true);
      } else {
        const AudioMod: any = await import("expo-audio");
        const player = AudioMod.createAudioPlayer({ uri: fileUrl }); audioRef.current = player;
        player.addListener?.("playbackStatusUpdate", (s: any) => { if (s?.didJustFinish) setPlaying(false); });
        player.play(); setPlaying(true);
      }
    } catch (e: any) { notify("Riproduzione", e?.message || String(e)); }
  };

  const openExternal = () => {
    if (Platform.OS === "web") (globalThis as any).window.open(fileUrl, "_blank");
    else router.push({ pathname: "/(tabs)/webviewer", params: { url: fileUrl, title: open?.title || "Media" } } as any);
  };

  const items = data?.items || [];
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: color }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} testID="axm-back"><Ionicons name="arrow-back" size={22} color="#FFF" /></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Archivio foto, audio e video</Text>
          <Text style={styles.sub}>{ICON[sphere]} {LABEL[sphere]} — {sphere === "unclassified" ? "Axon aspetta la tua risposta" : "AxonOS opera solo in questa sfera"}</Text>
        </View>
      </View>

      <View style={styles.sphereRow}>
        {(["business", "home", "unclassified"] as Sphere[]).map((s) => (
          <Pressable key={s} onPress={() => { setSphere(s); setOpen(null); }} style={[styles.sphereBtn, sphere === s && { backgroundColor: COLOR[s], borderColor: COLOR[s] }]} testID={`axm-sphere-${s}`}>
            <Text style={[styles.sphereTxt, sphere === s && { color: "#FFF" }]} numberOfLines={1}>{ICON[s]} {s === "business" ? "Business" : s === "home" ? "Home" : "Da classificare"}{data?.counts?.[s] ? ` · ${data.counts[s]}` : ""}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: insets.bottom + 120 }} keyboardShouldPersistTaps="handled">
        <View style={styles.actions}>
          <Pressable onPress={() => void send(capture("photo"))} disabled={!!busy || recording} style={[styles.big, { backgroundColor: color }]} testID="axm-capture-photo">
            <Ionicons name="camera" size={22} color="#FFF" /><Text style={styles.bigTxt}>Foto</Text>
          </Pressable>
          <Pressable onPress={() => void send(capture("video"))} disabled={!!busy || recording} style={[styles.big, { backgroundColor: color }]} testID="axm-capture-video">
            <Ionicons name="videocam" size={22} color="#FFF" /><Text style={styles.bigTxt}>Video</Text>
          </Pressable>
          <MediaVoiceRecorder color={color} disabled={!!busy} onRecordingChange={setRecording} onDone={(b64, mime, dur) => void send({ kind: "audio", data_base64: b64, mime, name: `nota-vocale.${mime.includes("webm") ? "webm" : "m4a"}`, duration_sec: dur })} />
          <Pressable onPress={() => void send(attach())} disabled={!!busy || recording} style={[styles.big, styles.ghost, { borderColor: color }]} testID="axm-attach">
            <Ionicons name="attach" size={22} color={color} /><Text style={[styles.bigTxt, { color }]}>Allega</Text>
          </Pressable>
        </View>
        {busy === "upload" && <View style={styles.progress}><ActivityIndicator color={color} /><Text style={styles.progressTxt}>Sto salvando e avvio la trascrizione…</Text></View>}
        <Text style={styles.hint}>Axon trascrive audio e video, descrive le foto e legge il testo che contengono: tutto ricercabile qui sotto. Video max 60 s (25 MB).</Text>

        <View style={styles.search}>
          <Ionicons name="search" size={18} color={HT.muted} />
          <TextInput value={q} onChangeText={setQ} placeholder="Cerca in trascrizioni, descrizioni, testo, tag…" placeholderTextColor={HT.muted} style={styles.searchInput} returnKeyType="search" testID="axm-search" />
          {q ? <Pressable onPress={() => setQ("")} hitSlop={8}><Ionicons name="close-circle" size={18} color={HT.muted} /></Pressable> : null}
        </View>

        {!data ? <ActivityIndicator color={color} /> : items.length === 0 ? (
          <Text style={styles.empty}>{q ? `Nessun risultato per «${q}» in ${LABEL[sphere]}.` : sphere === "unclassified" ? "Nessun elemento in attesa: tutto classificato ✓" : "Nessun elemento in questa sfera. Scatta una foto, registra una nota vocale o allega un file."}</Text>
        ) : items.map((m) => (
          <Pressable key={m.media_id} onPress={() => void openDetail(m)} style={styles.row} testID={`axm-item-${m.media_id}`}>
            <View style={[styles.kindIcon, { backgroundColor: COLOR[m.sphere] + "22" }]}><Ionicons name={KIND_ICON[m.kind]} size={20} color={COLOR[m.sphere]} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle} numberOfLines={1}>{m.title}</Text>
              <Text style={styles.rowMeta}>{new Date(m.created_at).toLocaleString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} · {KIND_LABEL[m.kind]}{m.duration_sec ? ` · ${fmtDur(m.duration_sec)}` : ""} · {ICON[m.sphere]} {m.sphere_label}</Text>
              {m.status === "processing" ? <Text style={[styles.status, { color }]}>⏳ Axon sta {m.kind === "photo" ? "analizzando" : "trascrivendo"}…</Text>
                : m.status === "error" ? <Text style={[styles.status, { color: HT.warning }]}>⚠️ Elaborazione non riuscita</Text>
                : (m.summary || m.description || m.transcript) ? <Text style={styles.snippet} numberOfLines={2}>{m.summary || m.description || m.transcript}</Text> : null}
              {!!m.tags?.length && <View style={styles.tags}>{m.tags.slice(0, 4).map((t) => <Text key={t} style={styles.tag}>#{t}</Text>)}</View>}
            </View>
            {m.sphere === "unclassified" ? (
              <View style={{ gap: 6 }}>
                <Pressable onPress={() => void classify(m, "home")} hitSlop={4} style={[styles.miniBtn, { borderColor: COLOR.home }]} testID={`axm-cls-home-${m.media_id}`}><Text style={[styles.miniTxt, { color: COLOR.home }]}>🟢 Privata</Text></Pressable>
                <Pressable onPress={() => void classify(m, "business")} hitSlop={4} style={[styles.miniBtn, { borderColor: COLOR.business }]} testID={`axm-cls-business-${m.media_id}`}><Text style={[styles.miniTxt, { color: COLOR.business }]}>🔵 Aziendale</Text></Pressable>
              </View>
            ) : <Ionicons name="chevron-forward" size={16} color={HT.muted} />}
          </Pressable>
        ))}
      </ScrollView>

      {/* «Privata o aziendale?» — Axon chiede subito dopo la cattura */}
      <Modal visible={!!askFor} transparent animationType="fade" onRequestClose={() => setAskFor(null)}>
        <View style={styles.modalRoot}>
          <View style={styles.modalBox} testID="axm-ask-sphere">
            <Text style={styles.modalT}>📂 {askFor ? KIND_LABEL[askFor.kind] : ""} salvat{askFor?.kind === "photo" ? "a" : "o"} — AxonOS chiede:</Text>
            <Text style={styles.modalQ}>È privata o aziendale?</Text>
            <Text style={styles.modalHint}>Sto già {askFor?.kind === "photo" ? "analizzando la foto" : "trascrivendo"} in background. Se non rispondi resta in ⚪ Non classificato e te lo ricordo tra 2 ore.</Text>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
              <Pressable onPress={() => askFor && void classify(askFor, "home")} style={[styles.modalBtn, { backgroundColor: COLOR.home }]} testID="axm-ask-home"><Text style={styles.modalBtnTxt}>🟢 Privata</Text></Pressable>
              <Pressable onPress={() => askFor && void classify(askFor, "business")} style={[styles.modalBtn, { backgroundColor: COLOR.business }]} testID="axm-ask-business"><Text style={styles.modalBtnTxt}>🔵 Aziendale</Text></Pressable>
            </View>
            <Pressable onPress={() => setAskFor(null)} style={styles.later} testID="axm-ask-later"><Text style={styles.laterTxt}>Dopo (resta da classificare)</Text></Pressable>
          </View>
        </View>
      </Modal>

      {/* Dettaglio */}
      <Modal visible={!!open} transparent animationType="slide" onRequestClose={() => { stopAudio(); setOpen(null); }}>
        <View style={styles.sheetRoot}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} testID="axm-detail">
            {open && (
              <ScrollView contentContainerStyle={{ gap: 10 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Ionicons name={KIND_ICON[open.kind]} size={20} color={COLOR[open.sphere]} />
                  <Text style={[styles.rowTitle, { flex: 1, fontSize: 16 }]}>{open.title}</Text>
                  <Pressable onPress={() => { stopAudio(); setOpen(null); }} hitSlop={8} testID="axm-detail-close"><Ionicons name="close" size={22} color={HT.muted} /></Pressable>
                </View>
                <Text style={styles.rowMeta}>{new Date(open.created_at).toLocaleString("it-IT")} · {KIND_LABEL[open.kind]}{open.duration_sec ? ` · ${fmtDur(open.duration_sec)}` : ""} · {open.size >= 1024 * 1024 ? `${(open.size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(open.size / 1024))} KB`}</Text>
                <View style={styles.sphereRowSm}>
                  {(["business", "home"] as Sphere[]).map((s) => (
                    <Pressable key={s} onPress={() => void classify(open, s)} style={[styles.sphereBtn, open.sphere === s && { backgroundColor: COLOR[s], borderColor: COLOR[s] }]} testID={`axm-detail-sphere-${s}`}>
                      <Text style={[styles.sphereTxt, open.sphere === s && { color: "#FFF" }]}>{ICON[s]} {s === "business" ? "Aziendale" : "Privata"}</Text>
                    </Pressable>
                  ))}
                </View>
                {open.suggested_sphere && open.sphere === "unclassified" && <Text style={styles.hint}>💡 Axon suggerisce: {ICON[open.suggested_sphere]} {LABEL[open.suggested_sphere]}</Text>}
                {open.kind === "photo" && !!fileUrl && <Image source={{ uri: fileUrl }} style={styles.preview} resizeMode="contain" />}
                {open.kind !== "photo" && (
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    {open.kind === "audio" && <Pressable onPress={togglePlay} style={[styles.pdfBtn, { backgroundColor: COLOR[open.sphere], flex: 1 }]} testID="axm-play"><Ionicons name={playing ? "pause" : "play"} size={18} color="#FFF" /><Text style={styles.pdfTxt}>{playing ? "Pausa" : "Ascolta"}</Text></Pressable>}
                    <Pressable onPress={openExternal} style={[styles.pdfBtn, styles.ghost, { borderColor: COLOR[open.sphere], flex: 1 }]} testID="axm-open-file"><Ionicons name="open-outline" size={18} color={COLOR[open.sphere]} /><Text style={[styles.pdfTxt, { color: COLOR[open.sphere] }]}>{open.kind === "video" ? "Guarda il video" : "Apri file"}</Text></Pressable>
                  </View>
                )}
                {open.status === "processing" && <View style={styles.progress}><ActivityIndicator color={COLOR[open.sphere]} /><Text style={styles.progressTxt}>Axon sta elaborando… (si aggiorna da solo)</Text></View>}
                {open.status === "error" && <Pressable onPress={async () => { await api(`/axon/media/${open.media_id}/reprocess`, { method: "POST" }); setOpen({ ...open, status: "processing" }); await load(true); }} style={[styles.pdfBtn, { backgroundColor: '#B45309' }]}><Ionicons name="refresh" size={16} color="#FFF" /><Text style={styles.pdfTxt}>Riprova elaborazione</Text></Pressable>}
                {!!(open.summary || open.description) && <View style={styles.card}><Text style={styles.secTitle}>{open.kind === "photo" ? "Descrizione" : "Riassunto di Axon"}</Text><Text style={styles.body}>{open.summary || open.description}</Text></View>}
                {!!open.actions?.length && <View style={styles.card}><Text style={styles.secTitle}>Cose da fare citate</Text>{open.actions.map((a, i) => <Text key={i} style={styles.body}>• {a}</Text>)}</View>}
                {!!open.transcript && <View style={styles.card}><Text style={styles.secTitle}>Trascrizione</Text><Text style={styles.body} selectable>{open.transcript}</Text></View>}
                {!!open.ocr_text && <View style={styles.card}><Text style={styles.secTitle}>Testo nella foto</Text><Text style={styles.body} selectable>{open.ocr_text}</Text></View>}
                {!!open.tags?.length && <View style={styles.tags}>{open.tags.map((t) => <Text key={t} style={styles.tag}>#{t}</Text>)}</View>}
                <Pressable onPress={() => remove(open)} style={styles.delBtn} testID="axm-detail-delete"><Ionicons name="trash-outline" size={16} color="#DC2626" /><Text style={styles.delTxt}>Elimina dall&apos;archivio</Text></Pressable>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function fmtDur(s: number) { const m = Math.floor(s / 60), sec = Math.floor(s % 60); return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`; }

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F4F5FA' },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  title: { color: "#FFF", fontWeight: "800", fontSize: 17 }, sub: { color: "#FFFFFFCC", fontSize: 12 },
  sphereRow: { flexDirection: "row", gap: 8, padding: 12, paddingBottom: 4 },
  sphereRowSm: { flexDirection: "row", gap: 8 },
  sphereBtn: { flex: 1, minHeight: 44, borderRadius: 12, borderWidth: 1.5, borderColor: HT.border, backgroundColor: HT.card, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  sphereTxt: { fontWeight: "800", color: HT.text, fontSize: 12.5 },
  actions: { flexDirection: "row", gap: 8 },
  big: { flex: 1, minHeight: 64, borderRadius: 16, alignItems: "center", justifyContent: "center", gap: 4, paddingHorizontal: 4 },
  ghost: { backgroundColor: HT.card, borderWidth: 1.5 },
  bigTxt: { color: "#FFF", fontWeight: "800", fontSize: 12, textAlign: "center" },
  progress: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: HT.card, borderRadius: 12, padding: 12 },
  progressTxt: { fontSize: 13, color: HT.text, fontWeight: "600", flex: 1 },
  hint: { fontSize: 12, color: HT.muted, lineHeight: 17 },
  search: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: HT.card, borderRadius: 12, borderWidth: 1, borderColor: HT.border, paddingHorizontal: 12, minHeight: 46 },
  searchInput: { flex: 1, fontSize: 14, color: HT.text, paddingVertical: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: HT.card, borderRadius: 12, borderWidth: 1, borderColor: '#EEF0F6', padding: 10, minHeight: 64 },
  kindIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  rowTitle: { fontSize: 14, fontWeight: "700", color: HT.text }, rowMeta: { fontSize: 11.5, color: HT.muted, marginTop: 1 },
  status: { fontSize: 12, fontWeight: "700", marginTop: 3 }, snippet: { fontSize: 12.5, color: HT.text2, marginTop: 3, lineHeight: 17 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 }, tag: { fontSize: 11, color: HT.text2, backgroundColor: HT.card2, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  miniBtn: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 8, minHeight: 32, alignItems: "center", justifyContent: "center", backgroundColor: HT.card }, miniTxt: { fontSize: 11.5, fontWeight: "800" },
  empty: { fontSize: 13, color: HT.muted, fontStyle: "italic", textAlign: "center", paddingVertical: 12 },
  modalRoot: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", padding: 20 },
  modalBox: { backgroundColor: HT.card, borderRadius: 18, padding: 18 },
  modalT: { fontSize: 13, fontWeight: "700", color: HT.muted }, modalQ: { fontSize: 20, fontWeight: "900", color: HT.text, marginTop: 6 }, modalHint: { fontSize: 12, color: HT.muted, marginTop: 8, lineHeight: 17 },
  modalBtn: { flex: 1, minHeight: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" }, modalBtnTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
  later: { alignItems: "center", marginTop: 12, minHeight: 40, justifyContent: "center" }, laterTxt: { color: HT.muted, fontWeight: "700", fontSize: 13 },
  sheetRoot: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { backgroundColor: '#F4F5FA', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, maxHeight: "90%" },
  preview: { width: "100%", height: 260, borderRadius: 12, backgroundColor: HT.border },
  pdfBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 46, borderRadius: 12 }, pdfTxt: { color: "#FFF", fontWeight: "800", fontSize: 13.5 },
  card: { backgroundColor: HT.card, borderRadius: 14, borderWidth: 1, borderColor: '#EEF0F6', padding: 12, gap: 6 },
  secTitle: { fontSize: 12, fontWeight: "800", color: HT.muted, textTransform: "uppercase", letterSpacing: 0.4 },
  body: { fontSize: 13.5, color: HT.text, lineHeight: 19 },
  delBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 44 }, delTxt: { color: "#DC2626", fontWeight: "800", fontSize: 13 },
});

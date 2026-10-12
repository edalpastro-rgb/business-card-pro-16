// knowledge-base.tsx — V50.z529 — «La mia Knowledge Base»: libri, appunti e documenti personali che Axon ricorda nel tempo
// (RAG locale: ChromaDB per utente + embedding MiniLM sul server, zero costi API). Carica PDF/TXT o incolla testo; elenco documenti
// con stato indicizzazione; elimina; anteprima «Cosa troverebbe Axon» (stessa ricerca usata nel prompt della chat).
import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, Platform, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import * as FileSystem from "expo-file-system/legacy";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { pickCommonFile } from "@/src/utils/filePicker";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { KScrollView } from "@/src/ui/keyboard";
import { HT } from "@/src/homeTheme";
import { theme } from "@/src/theme";

type KbDoc = { doc_id: string; title: string; source_type: "pdf" | "docx" | "xlsx" | "image" | "txt" | "text"; status: "indexing" | "ready" | "error"; stage?: "ocr" | "embedding" | null; ocr?: boolean; chunks: number; chars: number; pages?: number; size_bytes: number; created_at: string; error?: string; truncated?: boolean };
const KB_DOC_ICON: Record<string, React.ComponentProps<typeof Ionicons>["name"]> = { pdf: "document-text", docx: "document", xlsx: "grid", image: "image", txt: "reader", text: "reader" };
type KbList = { items: KbDoc[]; usage: { docs: number; chunks: number }; limits: { max_file_mb: number; max_docs: number; max_chunks: number }; embedder_ready: boolean; ocr_ready?: boolean };
type Hit = { title: string; idx: number; similarity: number; text: string };

async function readPickedBase64(asset: { uri: string }, base64?: string): Promise<string> {
  if (base64) return base64;
  if (asset.uri.startsWith("data:")) return asset.uri.slice(asset.uri.indexOf(",") + 1);
  if (Platform.OS === "web") {
    const blob = await (await fetch(asset.uri)).blob();
    return new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onerror = () => rej(new Error("FileReader error"));
      r.onload = () => { const s = String(r.result || ""); res(s.slice(s.indexOf(",") + 1)); };
      r.readAsDataURL(blob);
    });
  }
  return FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
}

const fmtSize = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`);

export default function KnowledgeBaseScreen() {
  const router = useRouter();
  const bottomPad = usePageBottomPadding();
  const [data, setData] = useState<KbList | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteTitle, setPasteTitle] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [searching, setSearching] = useState(false);

  const load = useCallback(() => api<KbList>("/kb/documents").then(setData).catch((e: any) => notify("Knowledge Base", e?.message || "Errore di caricamento")), []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // polling finché c'è qualcosa in indicizzazione
  const indexing = !!data?.items.some((d) => d.status === "indexing");
  React.useEffect(() => {
    if (!indexing) return;
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, [indexing, load]);

  const addDocument = async (body: Record<string, unknown>) => {
    setUploading(true);
    try {
      const r = await api<{ document: KbDoc; estimated_chunks: number; ocr?: boolean }>("/kb/documents", { method: "POST", body });
      notify("Documento aggiunto", r.ocr ? `«${r.document.title}»: OCR locale in corso, poi indicizzazione. Può richiedere qualche minuto per i PDF lunghi.` : `«${r.document.title}» in indicizzazione (~${r.estimated_chunks} frammenti). Axon lo userà nelle risposte.`);
      await load();
      return true;
    } catch (e: any) { notify("Knowledge Base", e?.message || "Caricamento non riuscito"); return false; }
    finally { setUploading(false); }
  };

  const pickFile = async () => {
    const { asset, error, base64 } = await pickCommonFile({ multiple: false });
    if (error || !asset) { if (error) notify("Errore", error); return; }
    const maxMb = data?.limits.max_file_mb ?? 20;
    if (asset.size && asset.size > maxMb * 1048576) { notify("File troppo grande", `Il limite è ${maxMb} MB per file.`); return; }
    try {
      const b64 = await readPickedBase64(asset, base64);
      await addDocument({ filename: asset.name, mime: asset.mimeType || "application/octet-stream", data_base64: b64 });
    } catch (e: any) { notify("Errore lettura file", e?.message || String(e)); }
  };

  const savePaste = async () => {
    if (pasteText.trim().length < 20) { notify("Testo troppo corto", "Incolla almeno qualche riga."); return; }
    if (await addDocument({ title: pasteTitle.trim() || undefined, text: pasteText })) { setPasteOpen(false); setPasteTitle(""); setPasteText(""); }
  };

  const remove = (d: KbDoc) => {
    const go = async () => {
      try { await api(`/kb/documents/${d.doc_id}`, { method: "DELETE" }); setHits(null); await load(); }
      catch (e: any) { notify("Knowledge Base", e?.message || "Eliminazione non riuscita"); }
    };
    if (Platform.OS === "web") { if (window.confirm(`Eliminare «${d.title}»? Axon non lo ricorderà più.`)) void go(); return; }
    Alert.alert("Elimina documento", `Eliminare «${d.title}»? Axon non lo ricorderà più.`, [{ text: "Annulla", style: "cancel" }, { text: "Elimina", style: "destructive", onPress: () => void go() }]);
  };

  const runSearch = async () => {
    if (query.trim().length < 2) return;
    setSearching(true);
    try { setHits((await api<{ hits: Hit[] }>("/kb/search", { method: "POST", body: { query: query.trim(), k: 3 } })).hits); }
    catch (e: any) { notify("Ricerca", e?.message || "Errore"); }
    finally { setSearching(false); }
  };

  const usage = data?.usage; const limits = data?.limits;
  const pctChunks = usage && limits ? Math.min(1, usage.chunks / limits.max_chunks) : 0;

  return (
    <SafeAreaView style={s.root} edges={["top"]} testID="kb-screen">
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} testID="back-btn"><Ionicons name="chevron-back" size={26} color={HT.text} /></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>La mia Knowledge Base</Text>
          <Text style={s.sub}>Libri, appunti e documenti che Axon ricorda · privata, solo tua</Text>
        </View>
      </View>
      <KScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: bottomPad }}>
        <View style={s.card} testID="kb-usage">
          <View style={s.row}>
            <View style={s.iconWrap}><Ionicons name="library" size={20} color={HT.violet} /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.cardTitle}>Memoria documentale di Axon</Text>
              <Text style={s.muted}>Quando fai una domanda, Axon cerca i 3 passaggi più pertinenti nei tuoi documenti e li usa per rispondere. Elaborazione sul server, senza costi AI aggiuntivi.</Text>
            </View>
          </View>
          {data ? (
            <>
              <View style={[s.row, { justifyContent: "space-between", marginTop: 4 }]}>
                <Text style={s.lbl}>Documenti {usage!.docs}/{limits!.max_docs}</Text>
                <Text style={s.lbl}>Frammenti {usage!.chunks}/{limits!.max_chunks}</Text>
              </View>
              <View style={s.track}><View style={[s.fill, { width: `${Math.round(pctChunks * 100)}%` }]} /></View>
              {!data.embedder_ready ? <Text style={[s.muted, { color: HT.danger, fontWeight: "800" }]}>Motore di embedding non disponibile sul server: contatta l&apos;assistenza.</Text> : null}
              <Text style={s.muted} testID="kb-formats">Formati: PDF (anche scansionati), DOCX, XLSX, TXT, MD, CSV, immagini JPG/PNG{data.ocr_ready ? " · OCR locale attivo (ita+eng)" : " · OCR non disponibile sul server"} · max {limits!.max_file_mb} MB</Text>
            </>
          ) : <ActivityIndicator color={HT.violet} />}
        </View>

        <View style={{ flexDirection: "row", gap: 10 }}>
          <Pressable onPress={pickFile} disabled={uploading || !data?.embedder_ready} style={[s.btn, (uploading || !data?.embedder_ready) && { opacity: 0.6 }]} testID="kb-upload-btn">
            {uploading ? <ActivityIndicator color="#FFF" /> : <Ionicons name="cloud-upload" size={18} color="#FFF" />}
            <Text style={s.btnTxt}>Carica file</Text>
          </Pressable>
          <Pressable onPress={() => setPasteOpen((v) => !v)} disabled={!data?.embedder_ready} style={[s.btn, s.btnGhost]} testID="kb-paste-btn">
            <Ionicons name="clipboard" size={18} color={HT.violet} />
            <Text style={[s.btnTxt, { color: HT.violet }]}>Incolla testo</Text>
          </Pressable>
        </View>

        {pasteOpen ? (
          <View style={s.card} testID="kb-paste-card">
            <Text style={s.cardTitle}>Nuovo appunto</Text>
            <TextInput value={pasteTitle} onChangeText={setPasteTitle} placeholder="Titolo (opzionale)" placeholderTextColor={HT.muted} style={s.input} testID="kb-paste-title" />
            <TextInput value={pasteText} onChangeText={setPasteText} placeholder="Incolla qui il testo: appunti, capitoli, note di un corso…" placeholderTextColor={HT.muted} style={[s.input, { minHeight: 140, textAlignVertical: "top" }]} multiline testID="kb-paste-text" />
            <View style={{ flexDirection: "row", gap: 10, justifyContent: "flex-end" }}>
              <Pressable onPress={() => setPasteOpen(false)} style={[s.btn, s.btnGhost, { flex: 0 }]}><Text style={[s.btnTxt, { color: HT.violet }]}>Annulla</Text></Pressable>
              <Pressable onPress={savePaste} disabled={uploading} style={[s.btn, { flex: 0 }]} testID="kb-paste-save">{uploading ? <ActivityIndicator color="#FFF" /> : <Text style={s.btnTxt}>Salva e indicizza</Text>}</Pressable>
            </View>
          </View>
        ) : null}

        <Text style={s.section}>I tuoi documenti</Text>
        {data && data.items.length === 0 ? (
          <View style={[s.card, { alignItems: "center", gap: 6 }]} testID="kb-empty">
            <Ionicons name="book-outline" size={34} color={HT.muted} />
            <Text style={s.cardTitle}>Nessun documento ancora</Text>
            <Text style={[s.muted, { textAlign: "center" }]}>Carica un libro in PDF, un Word, un Excel, una foto di un documento o incolla un testo: Axon lo ricorderà e lo userà quando serve.</Text>
          </View>
        ) : null}
        {data?.items.map((d) => (
          <View key={d.doc_id} style={s.docRow} testID={`kb-doc-${d.doc_id}`}>
            <View style={[s.iconWrap, { width: 36, height: 36 }]}>
              <Ionicons name={KB_DOC_ICON[d.source_type] || "reader"} size={18} color={HT.violet} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.docTitle} numberOfLines={1}>{d.title}</Text>
              <Text style={s.muted} numberOfLines={2}>
                {d.status === "indexing" ? (d.stage === "ocr" ? "🔎 OCR in corso (lettura del testo dall'immagine)…" : "⏳ Indicizzazione in corso…") : d.status === "error" ? `⚠️ ${d.error || "Errore"}` : `✅ ${d.chunks} frammenti${d.truncated ? " (troncato al limite)" : ""}${d.ocr ? " · OCR" : ""}`}
                {d.pages ? ` · ${d.pages} pagine` : ""} · {fmtSize(d.size_bytes)} · {new Date(d.created_at).toLocaleDateString("it-IT")}
              </Text>
            </View>
            {d.status === "indexing" ? <ActivityIndicator color={HT.violet} /> : (
              <Pressable onPress={() => remove(d)} hitSlop={8} style={s.delBtn} accessibilityLabel="Elimina" testID={`kb-doc-del-${d.doc_id}`}><Ionicons name="trash-outline" size={18} color={HT.danger} /></Pressable>
            )}
          </View>
        ))}

        {data && data.items.some((d) => d.status === "ready") ? (
          <View style={s.card} testID="kb-search-card">
            <Text style={s.cardTitle}>Cosa troverebbe Axon</Text>
            <Text style={s.muted}>Prova una domanda: vedi i passaggi che Axon userebbe come contesto.</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TextInput value={query} onChangeText={setQuery} placeholder="Es. quando scade il contratto di…" placeholderTextColor={HT.muted} style={[s.input, { flex: 1 }]} returnKeyType="search" onSubmitEditing={runSearch} testID="kb-search-input" />
              <Pressable onPress={runSearch} disabled={searching} style={[s.btn, { flex: 0, paddingHorizontal: 14 }]} testID="kb-search-btn">{searching ? <ActivityIndicator color="#FFF" /> : <Ionicons name="search" size={18} color="#FFF" />}</Pressable>
            </View>
            {hits ? (hits.length === 0 ? <Text style={s.muted}>Nessun passaggio abbastanza pertinente.</Text> : hits.map((h, i) => (
              <View key={i} style={s.hit} testID={`kb-hit-${i}`}>
                <Text style={s.hitTitle}>«{h.title}» · frammento {h.idx + 1} · {Math.round(h.similarity * 100)}%</Text>
                <Text style={s.hitTxt} numberOfLines={5}>{h.text}</Text>
              </View>
            ))) : null}
          </View>
        ) : null}
      </KScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: HT.bg },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 10 },
  title: { color: HT.text, fontSize: 20, fontWeight: "900" },
  sub: { color: HT.muted, fontSize: 12, fontWeight: "600" },
  card: { backgroundColor: HT.card, borderRadius: theme.radius.md, padding: 14, borderWidth: 1, borderColor: HT.border, gap: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  iconWrap: { width: 40, height: 40, borderRadius: 12, backgroundColor: HT.violetTint, alignItems: "center", justifyContent: "center" },
  cardTitle: { color: HT.text, fontSize: 15, fontWeight: "800" },
  muted: { color: HT.muted, fontSize: 12, lineHeight: 16 },
  lbl: { color: HT.text2, fontSize: 12.5, fontWeight: "700" },
  track: { height: 8, borderRadius: 4, backgroundColor: HT.card2, borderWidth: 1, borderColor: HT.border, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 4, backgroundColor: HT.violet },
  btn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: HT.violet, borderRadius: 999, minHeight: 46, paddingHorizontal: 12 },
  btnGhost: { backgroundColor: HT.violetTint, borderWidth: 1, borderColor: HT.violet + "66" },
  btnTxt: { color: "#FFF", fontWeight: "800", fontSize: 13.5 },
  input: { backgroundColor: HT.card2, borderWidth: 1, borderColor: HT.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, color: HT.text, fontSize: 14, minHeight: 44 },
  section: { color: HT.text, fontSize: 15, fontWeight: "900", marginTop: 4 },
  docRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: HT.card, borderRadius: theme.radius.md, padding: 12, borderWidth: 1, borderColor: HT.border },
  docTitle: { color: HT.text, fontSize: 14, fontWeight: "800" },
  delBtn: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: HT.card2 },
  hit: { backgroundColor: HT.violetTint, borderRadius: 12, padding: 10, gap: 4 },
  hitTitle: { color: HT.violet, fontSize: 12, fontWeight: "800" },
  hitTxt: { color: HT.text, fontSize: 12.5, lineHeight: 17 },
});

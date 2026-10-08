// IdentityDocsSection.tsx — V50.z267 — Documenti di riconoscimento (CI / patente / passaporto / tessera sanitaria-CF)
// Scanner fronte/retro → OCR Gemini (/identity-documents/ocr) → campi precompilati (callback onExtracted) → salvataggio
// (/identity-documents) con foto riutilizzabili/condivisibili. Usato da: Tour (schermata 3), Anagrafica Master, scheda cliente.
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Image, ActivityIndicator, Platform, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { DateField } from "@/src/ui/DateField"; // V50.z388 — calendario nativo su ogni campo data
import { launchCameraUniversal, launchLibraryUniversal } from "@/src/utils/imagePickerCompat";
import { uriToBase64DataUrl } from "@/src/utils/media";
import { LiveCameraScanner, type LiveScannedPage } from "@/src/LiveCameraScanner"; // V50.z462 — fotocamera expo-camera (niente ImagePicker.launchCameraAsync)
import { isNativeScannerAvailable, scanWithNativeScanner } from "@/src/NativeDocScanner"; // V50.z462 — scanner di sistema se disponibile
import { shareDataUri } from "@/src/share";

export type IdDoc = {
  doc_id: string; doc_type: string; doc_type_label: string; document_number?: string; issue_date?: string; expiry_date?: string;
  issuing_authority?: string; holder_name?: string; has_front: boolean; has_back: boolean; days_left: number | null; extracted?: Record<string, string>;
};
export type IdDocExtracted = Record<string, string>;
export const ID_DOC_TYPES: { id: string; label: string; icon: any }[] = [
  { id: "id_card", label: "Carta d'identità", icon: "card" }, { id: "driving_license", label: "Patente", icon: "car" },
  { id: "passport", label: "Passaporto", icon: "airplane" }, { id: "health_card", label: "Tessera sanitaria / CF", icon: "medkit" },
];

// V50.z462 — Prompt 23.a: 4 modi per acquisire fronte/retro, stesso risultato (data URL → OCR → anagrafica).
export type DocSource = "camera" | "gallery" | "files" | "scanner";
export const DOC_SOURCES: { id: DocSource; label: string; icon: any; hint: string }[] = [
  { id: "camera", label: "Fotografa", icon: "camera", hint: "Fotocamera con messa a fuoco e ritaglio" },
  { id: "gallery", label: "Galleria", icon: "images", hint: "Una foto già scattata" },
  { id: "files", label: "File / Drive", icon: "folder-open", hint: "File locali o Google Drive" },
  { id: "scanner", label: "Scanner", icon: "scan", hint: "Scanner di sistema" },
];

async function assetToDataUrl(a: { uri?: string; base64?: string; mimeType?: string | null }): Promise<string | null> {
  if (!a?.uri && !a?.base64) return null;
  if (a.uri?.startsWith("data:")) return a.uri;
  if (a.base64) return `data:${a.mimeType || "image/jpeg"};base64,${a.base64}`;
  return uriToBase64DataUrl(a.uri!, a.mimeType || "image/jpeg");
}

/** Fallback fotocamera via ImagePicker (web o se la fotocamera live non è disponibile). */
export async function shootLegacy(): Promise<string | null> {
  const res = await launchCameraUniversal({ quality: 0.7, base64: Platform.OS !== "web" });
  if (res.canceled || !res.assets?.[0]) return null;
  return assetToDataUrl(res.assets[0]);
}

export async function pickFromGallery(): Promise<string | null> {
  const res = await launchLibraryUniversal({ mediaTypes: "images", quality: 0.8, base64: Platform.OS !== "web", allowsMultipleSelection: false });
  if (res.canceled || !res.assets?.[0]) return null;
  return assetToDataUrl(res.assets[0]);
}

export async function pickFromFiles(): Promise<string | null> {
  const DocumentPicker = await import("expo-document-picker"); // selettore di sistema (SAF/Files): include Google Drive e file locali
  const res = await DocumentPicker.getDocumentAsync({ type: ["image/*"], multiple: false, copyToCacheDirectory: true });
  const a = res.assets?.[0];
  if (!a) return null;
  const mime = a.mimeType || "image/jpeg";
  if (!mime.startsWith("image/")) throw new Error("Scegli un'immagine (JPG, PNG, HEIC): i PDF non sono supportati per il documento");
  return uriToBase64DataUrl(a.uri, mime);
}

export async function pickFromScanner(): Promise<string | null> {
  const pages = await scanWithNativeScanner(1);
  return pages[0] ? `data:${pages[0].mime};base64,${pages[0].data_base64}` : null;
}

export function expiryBadge(daysLeft: number | null): { label: string; color: string } | null {
  if (daysLeft === null || daysLeft === undefined) return null;
  if (daysLeft < 0) return { label: "SCADUTO", color: "#DC2626" };
  if (daysLeft <= 30) return { label: `Scade tra ${daysLeft} gg`, color: "#DC2626" };
  if (daysLeft <= 90) return { label: `Scade tra ${daysLeft} gg`, color: "#F59E0B" };
  return { label: "Valido", color: "#10B981" };
}

type Props = {
  subjectType: "user" | "contact"; subjectId?: string;
  /** chiamato dopo l'OCR con i dati letti (precompila i form del chiamante) */
  onExtracted?: (data: IdDocExtracted) => void;
  onDocsChange?: (docs: IdDoc[]) => void;
  dark?: boolean; title?: string; hideList?: boolean;
};

export function IdentityDocsSection({ subjectType, subjectId, onExtracted, onDocsChange, dark, title = "Documenti di riconoscimento", hideList }: Props) {
  const [docs, setDocs] = useState<IdDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [docType, setDocType] = useState("id_card");
  const [front, setFront] = useState<string | null>(null);
  const [back, setBack] = useState<string | null>(null);
  const [ocr, setOcr] = useState<IdDocExtracted | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pickFor, setPickFor] = useState<"front" | "back" | null>(null); // V50.z462 — lato per cui scegliere la sorgente
  const [camOpen, setCamOpen] = useState<"front" | "back" | null>(null); // V50.z462 — fotocamera live aperta
  const c = dark ? DARK : LIGHT;
  const scannerOk = Platform.OS !== "web" && isNativeScannerAvailable();

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: IdDoc[] }>("/identity-documents", { query: { subject_type: subjectType, subject_id: subjectId } });
      setDocs(r.items || []); onDocsChange?.(r.items || []);
    } catch { /* offline */ } finally { setLoading(false); }
  }, [subjectType, subjectId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);

  const capture = (side: "front" | "back") => setPickFor((p) => (p === side ? null : side)); // apre la scelta della sorgente

  const acquire = async (side: "front" | "back", source: DocSource) => {
    setPickFor(null);
    if (source === "camera" && Platform.OS !== "web") { setCamOpen(side); return; }
    try {
      const img = source === "camera" ? await shootLegacy() : source === "gallery" ? await pickFromGallery() : source === "files" ? await pickFromFiles() : await pickFromScanner();
      if (img) await onImage(side, img);
    } catch (e: any) { notify("Documento", e?.message || "Impossibile acquisire l'immagine"); }
  };

  const onLiveShot = async (pages: LiveScannedPage[]) => {
    const side = camOpen; setCamOpen(null);
    if (!side || !pages[0]) return;
    await onImage(side, pages[0].preview_uri || `data:${pages[0].mime};base64,${pages[0].data_base64}`);
  };

  const onImage = async (side: "front" | "back", img: string) => {
    try {
      if (side === "front") setFront(img); else setBack(img);
      const f = side === "front" ? img : front;
      if (!f) return;
      setBusy("Axon legge il documento…");
      try {
        const r = await api<{ document: IdDocExtracted }>("/identity-documents/ocr", { method: "POST", body: { front_base64: f, back_base64: side === "back" ? img : back, doc_type: docType } });
        const d = r.document || {};
        setOcr(d);
        if (d.doc_type && ID_DOC_TYPES.some((t) => t.id === d.doc_type)) setDocType(d.doc_type);
        onExtracted?.(d);
      } catch (e: any) { notify("Lettura documento", e?.message || "Non sono riuscito a leggere il documento: puoi compilare a mano."); setOcr((o) => o || {}); }
      finally { setBusy(null); }
    } catch (e: any) { notify("Fotocamera", e?.message || "Impossibile acquisire la foto"); }
  };

  const save = async () => {
    if (!front) { notify("Documento", "Serve almeno la foto del fronte"); return; }
    setBusy("Salvo il documento…");
    try {
      const d = ocr || {};
      await api("/identity-documents", { method: "POST", body: {
        subject_type: subjectType, subject_id: subjectId, doc_type: docType, document_number: d.document_number || "", issue_date: d.issue_date || "",
        expiry_date: d.expiry_date || "", issuing_authority: d.issuing_authority || "", holder_name: `${d.first_name || ""} ${d.last_name || ""}`.trim(),
        extracted: d, front_base64: front, back_base64: back,
      } });
      setAdding(false); setFront(null); setBack(null); setOcr(null);
      await load();
    } catch (e: any) { notify("Documento", e?.message || "Salvataggio non riuscito"); } finally { setBusy(null); }
  };

  const openThumb = async (doc: IdDoc, side: "front" | "back" = "front") => {
    const key = `${doc.doc_id}_${side}`;
    if (thumbs[key]) return thumbs[key];
    try { const r = await api<{ data_url: string }>(`/identity-documents/${doc.doc_id}/image/${side}`); setThumbs((t) => ({ ...t, [key]: r.data_url })); return r.data_url; } catch { return null; }
  };
  const toggle = async (doc: IdDoc) => { const nx = expanded === doc.doc_id ? null : doc.doc_id; setExpanded(nx); if (nx) { await openThumb(doc, "front"); if (doc.has_back) await openThumb(doc, "back"); } };
  const share = async (doc: IdDoc, side: "front" | "back") => {
    const u = await openThumb(doc, side); if (!u) { notify("Condividi", "Immagine non disponibile"); return; }
    const mime = u.startsWith("data:image/png") ? "image/png" : "image/jpeg";
    await shareDataUri(u, `${doc.doc_type_label.replace(/[^\w]+/g, "_")}_${side}.${mime === "image/png" ? "png" : "jpg"}`, mime);
  };
  const remove = async (doc: IdDoc) => { try { await api(`/identity-documents/${doc.doc_id}`, { method: "DELETE" }); await load(); } catch (e: any) { notify("Documento", e?.message || ""); } };

  return (
    <View style={{ gap: 10 }} testID="iddocs-section">
      {Platform.OS !== "web" ? <LiveCameraScanner visible={!!camOpen} singleShot onClose={() => setCamOpen(null)} onDone={(p) => void onLiveShot(p)} /> : null}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Ionicons name="id-card" size={18} color={c.accent} />
        <Text style={[st.title, { color: c.text }]}>{title}</Text>
        {!adding ? <Pressable onPress={() => setAdding(true)} style={[st.addBtn, { backgroundColor: c.accent }]} testID="iddoc-add"><Ionicons name="camera" size={14} color="#FFF" /><Text style={st.addTxt}>Scansiona</Text></Pressable> : null}
      </View>

      {adding ? (
        <View style={[st.card, { backgroundColor: c.card, borderColor: c.border }]} testID="iddoc-scanner">
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {ID_DOC_TYPES.map((t) => (
              <Pressable key={t.id} onPress={() => setDocType(t.id)} style={[st.chip, { borderColor: c.border }, docType === t.id && { backgroundColor: c.accent, borderColor: c.accent }]} testID={`iddoc-type-${t.id}`}>
                <Ionicons name={t.icon} size={13} color={docType === t.id ? "#FFF" : c.muted} /><Text style={[st.chipTxt, { color: docType === t.id ? "#FFF" : c.text }]}>{t.label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {(["front", "back"] as const).map((side) => {
              const img = side === "front" ? front : back;
              return (
                <Pressable key={side} onPress={() => capture(side)} disabled={!!busy} style={[st.shot, { borderColor: img ? c.accent : c.border, backgroundColor: c.input }]} testID={`iddoc-shot-${side}`}>
                  {img ? <Image source={{ uri: img }} style={st.shotImg} resizeMode="cover" /> : <Ionicons name="camera-outline" size={26} color={c.muted} />}
                  <Text style={[st.shotTxt, { color: img ? c.accent : c.muted }]}>{side === "front" ? "Fronte" : "Retro"}{img ? " ✓ (rifai)" : ""}</Text>
                </Pressable>
              );
            })}
          </View>
          {pickFor ? (
            <View style={{ gap: 6 }} testID="iddoc-sources">
              <Text style={[st.small, { color: c.muted }]}>Come vuoi caricare il {pickFor === "front" ? "fronte" : "retro"}?</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {DOC_SOURCES.filter((o) => o.id !== "scanner" || scannerOk).map((o) => (
                  <Pressable key={o.id} onPress={() => acquire(pickFor, o.id)} disabled={!!busy} style={[st.srcBtn, { borderColor: c.border, backgroundColor: c.input }]} testID={`iddoc-src-${o.id}`}>
                    <Ionicons name={o.icon} size={18} color={c.accent} />
                    <View style={{ flex: 1, minWidth: 0 }}><Text style={[st.srcTxt, { color: c.text }]} numberOfLines={1}>{o.label}</Text><Text style={[st.small, { color: c.muted }]} numberOfLines={1}>{o.hint}</Text></View>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
          {busy ? <View style={{ flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color={c.accent} /><Text style={{ color: c.muted, fontSize: 13 }}>{busy}</Text></View> : null}
          {ocr ? (
            <View style={{ gap: 6 }} testID="iddoc-ocr-result">
              <Text style={[st.small, { color: c.muted }]}>Dati letti (modificabili prima di salvare):</Text>
              {([["document_number", "N. documento"], ["expiry_date", "Scadenza"], ["issue_date", "Rilascio"], ["issuing_authority", "Rilasciato da"]] as [string, string][]).map(([k, l]) => (
                <View key={k} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={[st.small, { width: 92, color: c.muted }]}>{l}</Text>
                  {k === "expiry_date" || k === "issue_date" ? (
                    <DateField value={ocr[k] || ""} onChange={(v) => setOcr((o) => ({ ...(o || {}), [k]: v }))} placeholder={l} style={{ flex: 1, backgroundColor: c.input, borderColor: c.border }} testID={`iddoc-field-${k}`} />
                  ) : (
                  <TextInput value={ocr[k] || ""} onChangeText={(v) => setOcr((o) => ({ ...(o || {}), [k]: v }))} style={[st.input, { backgroundColor: c.input, color: c.text, borderColor: c.border }]} placeholder={l} placeholderTextColor={c.muted} testID={`iddoc-field-${k}`} />
                  )}
                </View>
              ))}
            </View>
          ) : null}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable onPress={() => { setAdding(false); setFront(null); setBack(null); setOcr(null); }} style={[st.btn, { borderColor: c.border, borderWidth: 1 }]} testID="iddoc-cancel"><Text style={{ color: c.muted, fontWeight: "700" }}>Annulla</Text></Pressable>
            <Pressable onPress={save} disabled={!front || !!busy} style={[st.btn, { flex: 1, backgroundColor: front ? c.accent : c.border }]} testID="iddoc-save"><Ionicons name="save" size={16} color="#FFF" /><Text style={{ color: "#FFF", fontWeight: "800" }}>Salva documento</Text></Pressable>
          </View>
        </View>
      ) : null}

      {!hideList ? (loading ? <ActivityIndicator color={c.accent} /> : docs.length === 0 ? (
        <Text style={[st.small, { color: c.muted, textAlign: "center" }]} testID="iddoc-empty">Nessun documento salvato</Text>
      ) : docs.map((d) => {
        const b = expiryBadge(d.days_left);
        const open = expanded === d.doc_id;
        return (
          <View key={d.doc_id} style={[st.card, { backgroundColor: c.card, borderColor: c.border }]} testID={`iddoc-${d.doc_id}`}>
            <Pressable onPress={() => toggle(d)} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Ionicons name={(ID_DOC_TYPES.find((t) => t.id === d.doc_type)?.icon || "card") as any} size={20} color={c.accent} />
              <View style={{ flex: 1 }}>
                <Text style={[st.docTitle, { color: c.text }]}>{d.doc_type_label}{d.document_number ? ` · ${d.document_number}` : ""}</Text>
                <Text style={[st.small, { color: c.muted }]}>{d.holder_name ? `${d.holder_name} · ` : ""}{d.expiry_date ? `Scad. ${d.expiry_date.split("-").reverse().join("/")}` : "Scadenza non indicata"}</Text>
              </View>
              {b ? <View style={[st.badge, { backgroundColor: b.color }]}><Text style={st.badgeTxt}>{b.label}</Text></View> : null}
              <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color={c.muted} />
            </Pressable>
            {open ? (
              <View style={{ gap: 8 }}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {(["front", "back"] as const).filter((s) => (s === "front" ? d.has_front : d.has_back)).map((s) => (
                    <View key={s} style={{ flex: 1, gap: 4 }}>
                      {thumbs[`${d.doc_id}_${s}`] ? <Image source={{ uri: thumbs[`${d.doc_id}_${s}`] }} style={st.preview} resizeMode="contain" /> : <ActivityIndicator color={c.accent} />}
                      <Pressable onPress={() => share(d, s)} style={[st.miniBtn, { borderColor: c.border }]} testID={`iddoc-share-${s}`}><Ionicons name="share-social-outline" size={14} color={c.accent} /><Text style={[st.small, { color: c.accent, fontWeight: "700" }]}>Condividi {s === "front" ? "fronte" : "retro"}</Text></Pressable>
                    </View>
                  ))}
                </View>
                <Pressable onPress={() => remove(d)} style={[st.miniBtn, { borderColor: "#FCA5A5", alignSelf: "flex-end" }]} testID="iddoc-delete"><Ionicons name="trash-outline" size={14} color="#DC2626" /><Text style={[st.small, { color: "#DC2626", fontWeight: "700" }]}>Elimina</Text></Pressable>
              </View>
            ) : null}
          </View>
        );
      })) : null}
    </View>
  );
}

const LIGHT = { text: "#0F172A", muted: "#64748B", accent: "#10B981", card: "#FFFFFF", border: "#E2E8F0", input: "#F8FAFC" };
const DARK = { text: "#FFFFFF", muted: "#94A3B8", accent: "#38BDF8", card: "rgba(255,255,255,0.06)", border: "rgba(255,255,255,0.14)", input: "rgba(255,255,255,0.08)" };
const st = StyleSheet.create({
  srcBtn: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, minHeight: 52, width: "100%" },
  srcTxt: { fontSize: 13, fontWeight: "700" },
  title: { flex: 1, fontSize: 14, fontWeight: "900" },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, minHeight: 34, borderRadius: 8 }, addTxt: { color: "#FFF", fontSize: 11, fontWeight: "900" },
  card: { borderRadius: 14, borderWidth: 1, padding: 12, gap: 10 },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, minHeight: 34, borderRadius: 17, borderWidth: 1 }, chipTxt: { fontSize: 12, fontWeight: "700" },
  shot: { flex: 1, minHeight: 96, borderRadius: 12, borderWidth: 1.5, borderStyle: "dashed", alignItems: "center", justifyContent: "center", overflow: "hidden", gap: 4 },
  shotImg: { width: "100%", height: 70 }, shotTxt: { fontSize: 12, fontWeight: "800" },
  small: { fontSize: 12 }, input: { flex: 1, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, minHeight: 38, fontSize: 13 },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 44, borderRadius: 10, paddingHorizontal: 14 },
  docTitle: { fontSize: 14, fontWeight: "800" }, badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 }, badgeTxt: { color: "#FFF", fontSize: 10, fontWeight: "900" },
  preview: { width: "100%", height: 130, borderRadius: 8, backgroundColor: "#0002" },
  miniBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, minHeight: 36, borderRadius: 8, borderWidth: 1, paddingHorizontal: 8 },
});

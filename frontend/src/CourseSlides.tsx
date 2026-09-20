// CourseSlides.tsx — V50.z275 — Area Corsi Fase 3: Presentazione PowerPoint.
// Creatore: genera bozza con AI dai materiali (appunti + allegati) oppure scrive le slide a mano; editor inline
// (titolo, punti, note relatore, riordino); scarica .pptx; aggiunge il file ai materiali; visibilità ai partecipanti.
// Collaboratore: anteprima slide + download .pptx se il Master le ha rese visibili.
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, Switch } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";
import { shareDataUri } from "@/src/share";
import { VoiceDictationButton } from "@/src/VoiceDictationButton";

type Slide = { title: string; bullets: string[]; notes?: string };
type Deck = { title: string; subtitle?: string; slides: Slide[]; source?: string; visible_to_recipients?: boolean; author?: string; updated_at?: string };
type Resp = { slides: Deck | null; can_edit: boolean };
type EditSlide = { title: string; bulletsText: string; notes: string };

const toEdit = (d: Deck): EditSlide[] => d.slides.map((s) => ({ title: s.title, bulletsText: s.bullets.join("\n"), notes: s.notes || "" }));
const fromEdit = (l: EditSlide[]): Slide[] => l.map((s) => ({ title: s.title, bullets: s.bulletsText.split("\n").map((b) => b.trim()).filter(Boolean), notes: s.notes }));

export function CourseSlidesSection({ courseId, isCreator }: { courseId: string; isCreator: boolean }) {
  const [deck, setDeck] = useState<Deck | null | undefined>(undefined);
  const [mode, setMode] = useState<"view" | "ai" | "edit">("view");
  const [nSlides, setNSlides] = useState(8);
  const [instr, setInstr] = useState("");
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [items, setItems] = useState<EditSlide[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<number | null>(null);

  const load = useCallback(async () => { try { const r = await api<Resp>(`/courses/${courseId}/slides`); setDeck(r.slides); } catch { setDeck(null); } }, [courseId]);
  useEffect(() => { void load(); }, [load]);
  if (deck === undefined) return null;
  if (!isCreator && !deck) return null;

  const startEdit = (d?: Deck | null) => { setTitle(d?.title || ""); setSubtitle(d?.subtitle || ""); setItems(d ? toEdit(d) : [{ title: "", bulletsText: "", notes: "" }]); setMode("edit"); };
  const generate = async () => {
    setBusy("ai");
    try { const r = await api<Resp & { materials_chars: number; images: number }>(`/courses/${courseId}/slides/generate`, { method: "POST", body: { n_slides: nSlides, instructions: instr } }); setDeck(r.slides); setMode("view"); notify("PowerPoint", `Bozza creata: ${r.slides?.slides.length || 0} slide. Puoi modificarla prima di scaricare.`); }
    catch (e: any) { notify("PowerPoint", e?.message || "Generazione non riuscita"); } finally { setBusy(null); }
  };
  const save = async () => {
    const slides = fromEdit(items).filter((s) => s.title || s.bullets.length);
    if (!slides.length) { notify("PowerPoint", "Aggiungi almeno una slide con titolo o punti"); return; }
    setBusy("save");
    try { const r = await api<Resp>(`/courses/${courseId}/slides`, { method: "PUT", body: { title, subtitle, slides } }); setDeck(r.slides); setMode("view"); notify("PowerPoint", "Slide salvate"); }
    catch (e: any) { notify("PowerPoint", e?.message || ""); } finally { setBusy(null); }
  };
  const download = async () => {
    setBusy("dl");
    try { const r = await api<{ name: string; mime: string; data_base64: string }>(`/courses/${courseId}/slides/pptx`); await shareDataUri(`data:${r.mime};base64,${r.data_base64}`, r.name, r.mime); }
    catch (e: any) { notify("PowerPoint", e?.message || ""); } finally { setBusy(null); }
  };
  const attach = async () => {
    setBusy("attach");
    try { await api(`/courses/${courseId}/slides/attach`, { method: "POST" }); notify("PowerPoint", "File .pptx aggiunto ai materiali del corso (visibile ai partecipanti)"); }
    catch (e: any) { notify("PowerPoint", e?.message || ""); } finally { setBusy(null); }
  };
  const toggleVisible = async (v: boolean) => {
    try { const r = await api<Resp>(`/courses/${courseId}/slides`, { method: "PUT", body: { visible_to_recipients: v } }); setDeck(r.slides); } catch (e: any) { notify("PowerPoint", e?.message || ""); }
  };
  const remove = async () => { try { await api(`/courses/${courseId}/slides`, { method: "DELETE" }); setDeck(null); setMode("view"); } catch (e: any) { notify("PowerPoint", e?.message || ""); } };
  const upd = (i: number, patch: Partial<EditSlide>) => setItems((l) => l.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  const move = (i: number, dir: -1 | 1) => setItems((l) => { const j = i + dir; if (j < 0 || j >= l.length) return l; const c = [...l]; [c[i], c[j]] = [c[j], c[i]]; return c; });

  // ---------- Editor manuale ----------
  if (mode === "edit") {
    return (
      <View style={s.card} testID="course-slides-editor">
        <Text style={s.section}>🎞️ Scrivi le slide</Text>
        <TextInput value={title} onChangeText={setTitle} placeholder="Titolo presentazione" placeholderTextColor={theme.color.muted} style={s.input} testID="slides-title" />
        <TextInput value={subtitle} onChangeText={setSubtitle} placeholder="Sottotitolo (opzionale)" placeholderTextColor={theme.color.muted} style={s.input} testID="slides-subtitle" />
        {items.map((it, i) => (
          <View key={i} style={s.slideBox}>
            <View style={s.rowH}>
              <Text style={s.num}>Slide {i + 1}</Text>
              <Pressable onPress={() => move(i, -1)} hitSlop={6} disabled={i === 0}><Ionicons name="arrow-up" size={18} color={i === 0 ? theme.color.border : "#7C3AED"} /></Pressable>
              <Pressable onPress={() => move(i, 1)} hitSlop={6} disabled={i === items.length - 1}><Ionicons name="arrow-down" size={18} color={i === items.length - 1 ? theme.color.border : "#7C3AED"} /></Pressable>
              <Pressable onPress={() => setItems((l) => l.filter((_, k) => k !== i))} hitSlop={6}><Ionicons name="trash-outline" size={18} color="#DC2626" /></Pressable>
            </View>
            <TextInput value={it.title} onChangeText={(v) => upd(i, { title: v })} placeholder="Titolo slide" placeholderTextColor={theme.color.muted} style={s.input} testID={`slide-${i}-title`} />
            <TextInput value={it.bulletsText} onChangeText={(v) => upd(i, { bulletsText: v })} placeholder={"Punti chiave — uno per riga"} placeholderTextColor={theme.color.muted} style={[s.input, { minHeight: 90 }]} multiline testID={`slide-${i}-bullets`} />
            <TextInput value={it.notes} onChangeText={(v) => upd(i, { notes: v })} placeholder="Note per il relatore (non visibili in proiezione)" placeholderTextColor={theme.color.muted} style={[s.input, { minHeight: 56 }]} multiline testID={`slide-${i}-notes`} />
          </View>
        ))}
        <Pressable onPress={() => setItems((l) => [...l, { title: "", bulletsText: "", notes: "" }])} style={s.miniBtn} testID="slides-add"><Ionicons name="add" size={16} color="#7C3AED" /><Text style={s.miniTxt}>Aggiungi slide</Text></Pressable>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable onPress={() => setMode("view")} style={[s.btn, s.btnGhost]}><Text style={{ fontWeight: "800", color: theme.color.muted }}>Annulla</Text></Pressable>
          <Pressable onPress={save} disabled={busy === "save"} style={[s.btn, { flex: 1, backgroundColor: "#7C3AED" }]} testID="slides-save">{busy === "save" ? <ActivityIndicator color="#FFF" /> : <Text style={{ fontWeight: "900", color: "#FFF" }}>Salva slide</Text>}</Pressable>
        </View>
      </View>
    );
  }

  // ---------- Generazione AI ----------
  if (mode === "ai") {
    return (
      <View style={s.card} testID="course-slides-ai">
        <Text style={s.section}>✨ Genera con AI dai materiali</Text>
        <Text style={s.hint}>Axon legge appunti, PDF, immagini e documenti allegati al corso e prepara una bozza di presentazione che potrai modificare. Puoi anche dettare a voce cosa vuoi nelle slide: Axon le crea al volo, anche senza materiali.</Text>
        <Text style={s.hint}>Numero di slide:</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>{[5, 8, 12, 16].map((n) => <Pressable key={n} onPress={() => setNSlides(n)} style={[s.chip, nSlides === n && s.chipOn]} testID={`slides-n-${n}`}><Text style={[s.chipTxt, nSlides === n && { color: "#FFF" }]}>{n}</Text></Pressable>)}</View>
        <VoiceDictationButton label={instr ? "Detta ancora (aggiunge)" : "🎤 Detta cosa vuoi nelle slide"} onTranscript={(t) => setInstr((x) => (x ? x + " " + t : t))} testID="slides-dictate" />
        <TextInput value={instr} onChangeText={setInstr} placeholder="Indicazioni per Axon (dettate o scritte): argomenti, struttura, tono, esempi da inserire…" placeholderTextColor={theme.color.muted} style={[s.input, { minHeight: 80 }]} multiline testID="slides-instructions" />
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable onPress={() => setMode("view")} style={[s.btn, s.btnGhost]} disabled={busy === "ai"}><Text style={{ fontWeight: "800", color: theme.color.muted }}>Annulla</Text></Pressable>
          <Pressable onPress={generate} disabled={busy === "ai"} style={[s.btn, { flex: 1, backgroundColor: "#7C3AED" }]} testID="slides-generate">{busy === "ai" ? <><ActivityIndicator color="#FFF" /><Text style={{ fontWeight: "800", color: "#FFF" }}>Axon sta leggendo i materiali…</Text></> : <Text style={{ fontWeight: "900", color: "#FFF" }}>Genera bozza</Text>}</Pressable>
        </View>
      </View>
    );
  }

  // ---------- Vista ----------
  return (
    <View style={s.card} testID="course-slides">
      <View style={s.rowH}><Text style={s.section}>🎞️ Presentazione PowerPoint</Text>{deck ? <Text style={s.badge}>{deck.slides.length} slide{deck.source?.startsWith("ai") ? " · AI" : ""}</Text> : null}</View>
      {!deck ? (
        <>
          <Text style={s.hint}>Crea la presentazione del corso: lascia che Axon la prepari dai materiali caricati, oppure scrivila tu slide per slide.</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable onPress={() => setMode("ai")} style={[s.btn, { flex: 1, backgroundColor: "#7C3AED" }]} testID="slides-start-ai"><Ionicons name="sparkles" size={16} color="#FFF" /><Text style={{ fontWeight: "900", color: "#FFF" }}>Genera con AI</Text></Pressable>
            <Pressable onPress={() => startEdit(null)} style={[s.btn, s.btnGhost, { flex: 1 }]} testID="slides-start-manual"><Ionicons name="create-outline" size={16} color="#7C3AED" /><Text style={{ fontWeight: "900", color: "#7C3AED" }}>Scrivi a mano</Text></Pressable>
          </View>
        </>
      ) : (
        <>
          <Text style={s.deckTitle}>{deck.title}</Text>
          {deck.subtitle ? <Text style={s.hint}>{deck.subtitle}</Text> : null}
          {deck.slides.map((sl, i) => (
            <Pressable key={i} onPress={() => setPreview(preview === i ? null : i)} style={s.prevRow} testID={`slide-preview-${i}`}>
              <View style={s.prevNum}><Text style={s.prevNumTxt}>{i + 1}</Text></View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={s.prevTitle} numberOfLines={preview === i ? undefined : 1}>{sl.title}</Text>
                {preview === i ? <>{sl.bullets.map((b, k) => <Text key={k} style={s.li}>•  {b}</Text>)}{sl.notes && isCreator ? <Text style={s.notes}>🗒 {sl.notes}</Text> : null}</> : <Text style={s.hint} numberOfLines={1}>{sl.bullets.join(" · ")}</Text>}
              </View>
              <Ionicons name={preview === i ? "chevron-up" : "chevron-down"} size={16} color={theme.color.muted} />
            </Pressable>
          ))}
          <Pressable onPress={download} disabled={busy === "dl"} style={[s.btn, { backgroundColor: "#D97706" }]} testID="slides-download">{busy === "dl" ? <ActivityIndicator color="#FFF" /> : <><Ionicons name="download-outline" size={18} color="#FFF" /><Text style={{ fontWeight: "900", color: "#FFF" }}>Scarica PowerPoint (.pptx)</Text></>}</Pressable>
          {isCreator ? (
            <>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable onPress={() => startEdit(deck)} style={[s.btn, s.btnGhost, { flex: 1 }]} testID="slides-edit"><Ionicons name="create-outline" size={16} color="#7C3AED" /><Text style={s.ghostTxt}>Modifica</Text></Pressable>
                <Pressable onPress={() => setMode("ai")} style={[s.btn, s.btnGhost, { flex: 1 }]} testID="slides-regen"><Ionicons name="sparkles" size={16} color="#7C3AED" /><Text style={s.ghostTxt}>Rigenera AI</Text></Pressable>
              </View>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable onPress={attach} disabled={busy === "attach"} style={[s.btn, s.btnGhost, { flex: 1 }]} testID="slides-attach">{busy === "attach" ? <ActivityIndicator color="#7C3AED" /> : <><Ionicons name="attach" size={16} color="#7C3AED" /><Text style={s.ghostTxt}>Aggiungi ai materiali</Text></>}</Pressable>
                <Pressable onPress={remove} style={[s.btn, s.btnGhost, { borderColor: "#FECACA" }]} testID="slides-delete"><Ionicons name="trash-outline" size={16} color="#DC2626" /></Pressable>
              </View>
              <View style={s.rowH}><Text style={[s.hint, { flex: 1 }]}>Visibile ai partecipanti (anteprima + download)</Text><Switch value={!!deck.visible_to_recipients} onValueChange={toggleVisible} trackColor={{ true: "#7C3AED" }} testID="slides-visible" /></View>
            </>
          ) : null}
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: "#FFF", borderRadius: 14, borderWidth: 1, borderColor: "#FDE68A", padding: 12, gap: 10 },
  rowH: { flexDirection: "row", alignItems: "center", gap: 8 }, section: { flex: 1, fontSize: 14, fontWeight: "900", color: theme.color.onSurface },
  hint: { fontSize: 12, color: theme.color.muted, lineHeight: 17 }, badge: { fontSize: 11, fontWeight: "800", color: "#92400E", backgroundColor: "#FEF3C7", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  input: { backgroundColor: "#FFF", borderWidth: 1, borderColor: theme.color.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, minHeight: 44, fontSize: 14, color: theme.color.onSurface },
  slideBox: { backgroundColor: "#FFFBEB", borderRadius: 10, padding: 10, gap: 6 }, num: { flex: 1, fontWeight: "900", color: "#92400E" },
  miniBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, minHeight: 36, borderRadius: 8, backgroundColor: "#F3E8FF", alignSelf: "flex-start" }, miniTxt: { fontSize: 12, fontWeight: "800", color: "#7C3AED" },
  chip: { paddingHorizontal: 14, minHeight: 36, borderRadius: 18, borderWidth: 1, borderColor: theme.color.border, alignItems: "center", justifyContent: "center", backgroundColor: "#FFF" }, chipOn: { backgroundColor: "#7C3AED", borderColor: "#7C3AED" }, chipTxt: { fontSize: 13, fontWeight: "800", color: theme.color.onSurface },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 46, borderRadius: 12, paddingHorizontal: 14 },
  btnGhost: { backgroundColor: "#FFF", borderWidth: 1, borderColor: theme.color.border }, ghostTxt: { fontWeight: "800", fontSize: 13, color: "#7C3AED" },
  deckTitle: { fontSize: 15, fontWeight: "900", color: "#92400E" },
  prevRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 8, borderRadius: 10, backgroundColor: "#FFFBEB", minHeight: 44 },
  prevNum: { width: 26, height: 26, borderRadius: 13, backgroundColor: "#D97706", alignItems: "center", justifyContent: "center" }, prevNumTxt: { color: "#FFF", fontWeight: "900", fontSize: 12 },
  prevTitle: { fontSize: 14, fontWeight: "800", color: theme.color.onSurface }, li: { fontSize: 13, color: theme.color.onSurface, lineHeight: 19 },
  notes: { fontSize: 12, color: "#6B21A8", backgroundColor: "#F3E8FF", borderRadius: 6, padding: 6, marginTop: 4 },
});

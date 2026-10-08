// V50.z459 — Prompt 20: TRASCRIZIONE CHIAMATE (tab «Chiamate» nella scheda cliente).
// Carica audio (mp3/m4a/wav/ogg) → Deepgram (Venditore/Cliente) → estrazione Anthropic → SCHERMATA DI CONFERMA con campi
// precompilati modificabili → un tap «Conferma e salva nel CRM». Al primo utilizzo: scelta profilo (Agente di Commercio,
// Consulente B2B, Libero Professionista) che decide campi e linguaggio. Campi non ricavabili = vuoti.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, TextInput, Platform, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import { api, apiUpload, getToken, BACKEND_URL } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { HT } from "@/src/homeTheme";

type Field = { key: string; label: string; type: "text" | "textarea" | "select" | "money" | "date"; options?: { key: string; label: string }[] };
type ProfilePayload = { profile: string | null; profiles: { key: string; label: string; desc: string }[]; fields: Field[] };
type Transcript = {
  id: string; status: "processing" | "ready" | "error"; stage?: string; error?: string; filename: string; created_at: string; duration_sec?: number;
  confirmed?: boolean; extracted?: Record<string, any>; transcript_text?: string; fields?: Field[]; confirmed_fields?: Record<string, any>;
};

const ACCENT = HT.axon;

function fmtDate(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function CallTranscriptSection({ contactId, onContactChanged }: { contactId: string; onContactChanged?: () => void }) {
  const [prof, setProf] = useState<ProfilePayload | null>(null);
  const [items, setItems] = useState<Transcript[]>([]);
  const [busy, setBusy] = useState<"upload" | "profile" | "confirm" | null>(null);
  const [open, setOpen] = useState<Transcript | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [showText, setShowText] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try { setItems(await api<Transcript[]>("/call-transcripts", { query: { contact_id: contactId } })); } catch {}
  }, [contactId]);

  useEffect(() => {
    api<ProfilePayload>("/call-transcripts/profile").then(setProf).catch(() => setProf({ profile: null, profiles: [], fields: [] }));
    load();
  }, [load]);

  // polling finché c'è una trascrizione in elaborazione
  useEffect(() => {
    const pending = items.some((t) => t.status === "processing");
    if (pending && !pollRef.current) pollRef.current = setInterval(load, 3000);
    if (!pending && pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [items, load]);

  const chooseProfile = async (key: string) => {
    setBusy("profile");
    try { setProf(await api<ProfilePayload>("/call-transcripts/profile", { method: "PUT", body: { profile: key } })); }
    catch (e: any) { notify("Errore", e?.message); } finally { setBusy(null); }
  };

  const upload = async () => {
    let a: { uri: string; name?: string; mimeType?: string | null; size?: number | null } | undefined;
    try {
      const DocumentPicker = await import("expo-document-picker");
      const res = await DocumentPicker.getDocumentAsync({ type: ["audio/*"], multiple: false, copyToCacheDirectory: true });
      a = res.assets?.[0];
    } catch { notify("File non raggiungibile. Riprova scegliendo un file locale."); return; }
    if (!a) return;
    const ext = (a.name || "").toLowerCase().split(".").pop() || "";
    if (!["mp3", "m4a", "wav", "ogg"].includes(ext)) { notify("Formato non supportato", "Usa mp3, m4a, wav o ogg."); return; }
    setBusy("upload");
    try {
      if (Platform.OS === "web") {
        const form = new FormData();
        form.append("file", await (await fetch(a.uri)).blob(), a.name || `chiamata.${ext}`);
        form.append("contact_id", contactId);
        await apiUpload("/call-transcripts", form);
      } else {
        const token = await getToken();
        const up = await FileSystem.uploadAsync(`${BACKEND_URL}/api/call-transcripts`, a.uri, {
          httpMethod: "POST", uploadType: FileSystem.FileSystemUploadType.MULTIPART, fieldName: "file",
          mimeType: a.mimeType || "audio/mpeg", parameters: { contact_id: contactId }, headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (up.status >= 400) { let msg = `Errore server (HTTP ${up.status})`; try { const j = JSON.parse(up.body || "{}"); msg = typeof j.detail === "string" ? j.detail : msg; } catch {} throw new Error(msg); }
      }
      notify("Audio caricato", "Axon sta trascrivendo la chiamata…");
      await load();
    } catch (e: any) { notify("Caricamento non riuscito", e?.message); } finally { setBusy(null); }
  };

  const openReview = async (t: Transcript) => {
    try {
      const full = await api<Transcript>(`/call-transcripts/${t.id}`);
      const src = full.confirmed ? (full.confirmed_fields || {}) : (full.extracted || {});
      const v: Record<string, string> = {};
      (full.fields || []).forEach((f) => { v[f.key] = src[f.key] == null ? "" : String(src[f.key]); });
      setVals(v); setOpen(full); setShowText(false);
    } catch (e: any) { notify("Errore", e?.message); }
  };

  const confirm = async () => {
    if (!open) return;
    setBusy("confirm");
    try {
      const fields: Record<string, any> = {};
      Object.entries(vals).forEach(([k, v]) => { fields[k] = v.trim() === "" ? null : v.trim(); });
      await api(`/call-transcripts/${open.id}/confirm`, { method: "POST", body: { fields } });
      notify("Scheda aggiornata ✅", "Nota, stato trattativa e prossimo contatto salvati nel CRM.");
      setOpen(null); await load(); onContactChanged?.();
    } catch (e: any) { notify("Salvataggio non riuscito", e?.message); } finally { setBusy(null); }
  };

  if (!prof) return <View style={s.center}><ActivityIndicator color={ACCENT} /></View>;

  // ---- primo accesso: scelta profilo
  if (!prof.profile) {
    return (
      <View style={s.card} testID="call-profile-picker">
        <Text style={s.title}>Come lavori?</Text>
        <Text style={s.sub}>Scegli il tuo profilo: Axon adatterà i campi estratti dalle chiamate e il suo linguaggio. Puoi cambiarlo quando vuoi.</Text>
        {prof.profiles.map((p) => (
          <Pressable key={p.key} onPress={() => chooseProfile(p.key)} disabled={busy === "profile"} style={s.profileRow} testID={`call-profile-${p.key}`}>
            <Ionicons name={p.key === "agente_commercio" ? "cart" : p.key === "consulente_b2b" ? "business" : "briefcase"} size={22} color={ACCENT} />
            <View style={{ flex: 1 }}><Text style={s.profileLbl}>{p.label}</Text><Text style={s.sub}>{p.desc}</Text></View>
            <Ionicons name="chevron-forward" size={18} color={HT.muted} />
          </Pressable>
        ))}
      </View>
    );
  }

  // ---- schermata di conferma
  if (open) {
    const fields = open.fields || [];
    return (
      <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 24 }} keyboardShouldPersistTaps="handled" testID="call-review">
        <View style={s.card}>
          <View style={s.head}>
            <Pressable onPress={() => setOpen(null)} hitSlop={10} testID="call-review-back"><Ionicons name="arrow-back" size={22} color={HT.text} /></Pressable>
            <View style={{ flex: 1 }}>
              <Text style={s.title}>{open.confirmed ? "Dati salvati" : "Verifica prima di salvare"}</Text>
              <Text style={s.sub}>{open.filename} · {fmtDate(open.created_at)}{open.duration_sec ? ` · ${Math.round(open.duration_sec / 60)} min` : ""}</Text>
            </View>
          </View>
          {!open.confirmed ? <Text style={s.hint}>Campi precompilati da Axon dalla chiamata. Quelli vuoti non erano ricavabili: puoi completarli o lasciarli vuoti.</Text> : null}
          {fields.map((f) => (
            <View key={f.key} style={{ gap: 6 }}>
              <Text style={s.lbl}>{f.label}</Text>
              {f.type === "select" ? (
                <View style={s.chips}>
                  {(f.options || []).map((o) => {
                    const on = vals[f.key] === o.key;
                    return (
                      <Pressable key={o.key} disabled={!!open.confirmed} onPress={() => setVals((v) => ({ ...v, [f.key]: on ? "" : o.key }))} style={[s.chip, on && s.chipOn]} testID={`call-field-${f.key}-${o.key}`}>
                        <Text style={[s.chipTxt, on && s.chipTxtOn]}>{o.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : (
                <TextInput
                  value={vals[f.key] || ""} editable={!open.confirmed} onChangeText={(t) => setVals((v) => ({ ...v, [f.key]: t }))}
                  placeholder={f.type === "date" ? "AAAA-MM-GG (solo se detta nella chiamata)" : f.type === "money" ? "es. circa 1.500 €/anno" : "—"}
                  placeholderTextColor={HT.muted} multiline={f.type === "textarea"} style={[s.input, f.type === "textarea" && { minHeight: 96, textAlignVertical: "top" }]}
                  testID={`call-field-${f.key}`}
                />
              )}
            </View>
          ))}
          {!open.confirmed ? (
            <Pressable onPress={confirm} disabled={busy === "confirm"} style={[s.btn, busy === "confirm" && { opacity: 0.5 }]} testID="call-confirm">
              {busy === "confirm" ? <ActivityIndicator color="#FFFFFF" /> : <Text style={s.btnTxt}>Conferma e salva nel CRM</Text>}
            </Pressable>
          ) : null}
        </View>
        <View style={s.card}>
          <Pressable onPress={() => setShowText((x) => !x)} style={s.head} testID="call-transcript-toggle">
            <Ionicons name={showText ? "chevron-down" : "chevron-forward"} size={18} color={HT.text} />
            <Text style={s.lbl}>Trascrizione completa (Venditore / Cliente)</Text>
          </Pressable>
          {showText ? <Text style={s.transcript} selectable>{open.transcript_text || "—"}</Text> : null}
        </View>
      </ScrollView>
    );
  }

  // ---- elenco + upload
  return (
    <View style={{ gap: 12 }} testID="call-transcripts">
      <View style={s.card}>
        <View style={s.head}>
          <View style={s.orb}><Ionicons name="call" size={18} color="#FFFFFF" /></View>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>Trascrizione chiamate</Text>
            <Text style={s.sub}>Profilo: {prof.profiles.find((p) => p.key === prof.profile)?.label} · <Text onPress={() => setProf({ ...prof, profile: null })} style={{ color: ACCENT, fontWeight: "700" }}>cambia</Text></Text>
          </View>
        </View>
        <Pressable onPress={upload} disabled={busy === "upload"} style={[s.btn, busy === "upload" && { opacity: 0.5 }]} testID="call-upload">
          {busy === "upload" ? <ActivityIndicator color="#FFFFFF" /> : <><Ionicons name="cloud-upload" size={18} color="#FFFFFF" /><Text style={s.btnTxt}>Carica audio chiamata</Text></>}
        </Pressable>
        <Text style={s.hint}>mp3, m4a, wav, ogg · max 80 MB. Nulla viene salvato nella scheda finché non confermi.</Text>
      </View>
      {items.length === 0 ? <Text style={[s.sub, { textAlign: "center" }]}>Nessuna chiamata trascritta per questo cliente.</Text> : null}
      {items.map((t) => (
        <Pressable key={t.id} onPress={() => (t.status === "ready" ? openReview(t) : undefined)} style={s.row} testID={`call-item-${t.id}`}>
          {t.status === "processing" ? <ActivityIndicator color={ACCENT} /> : <Ionicons name={t.status === "error" ? "alert-circle" : t.confirmed ? "checkmark-circle" : "document-text"} size={22} color={t.status === "error" ? HT.danger : t.confirmed ? HT.success : ACCENT} />}
          <View style={{ flex: 1 }}>
            <Text style={s.rowTitle} numberOfLines={1}>{t.filename}</Text>
            <Text style={s.sub}>
              {fmtDate(t.created_at)} · {t.status === "processing" ? (t.stage === "extracting" ? "Estraggo i dati…" : "Trascrivo con Deepgram…") : t.status === "error" ? `Errore: ${t.error || "sconosciuto"}` : t.confirmed ? "Salvata nel CRM" : "Pronta: tocca per verificare e salvare"}
            </Text>
          </View>
          {t.status === "ready" ? <Ionicons name="chevron-forward" size={18} color={HT.muted} /> : null}
        </Pressable>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  center: { padding: 24, alignItems: "center" },
  card: { backgroundColor: HT.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: HT.border, gap: 12 },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  orb: { width: 40, height: 40, borderRadius: 20, backgroundColor: ACCENT, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 15, fontWeight: "800", color: HT.text },
  sub: { fontSize: 12, color: HT.muted, marginTop: 2 },
  hint: { fontSize: 12, color: HT.muted, fontStyle: "italic" },
  lbl: { fontSize: 13, color: HT.text, fontWeight: "700" },
  input: { minHeight: 44, borderWidth: 1, borderColor: HT.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: HT.text, backgroundColor: HT.bg, fontSize: 15 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 12, minHeight: 38, justifyContent: "center", borderRadius: 999, borderWidth: 1, borderColor: ACCENT, backgroundColor: HT.card },
  chipOn: { backgroundColor: ACCENT },
  chipTxt: { color: ACCENT, fontWeight: "700", fontSize: 12.5 },
  chipTxtOn: { color: "#FFFFFF" },
  btn: { minHeight: 48, borderRadius: 12, backgroundColor: ACCENT, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  btnTxt: { color: "#FFFFFF", fontWeight: "800" },
  profileRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: HT.border, backgroundColor: HT.bg, minHeight: 64 },
  profileLbl: { fontSize: 15, fontWeight: "800", color: HT.text },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: HT.border, backgroundColor: HT.card, minHeight: 64 },
  rowTitle: { fontSize: 14, fontWeight: "700", color: HT.text },
  transcript: { fontSize: 13, color: HT.text, lineHeight: 20 },
});

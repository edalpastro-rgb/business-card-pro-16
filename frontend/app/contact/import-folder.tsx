// V50.z424 — IMPORT CLIENTE DA CARTELLA DOCUMENTI SCANSIONATI
// 1) selezione cartella (web: input webkitdirectory con sottocartelle; mobile: selezione multipla file) → 2) upload file per file
// con percorso relativo → 3) analisi (visura → anagrafica) → 4) anteprima: campi mancanti in rosso, cellulare+email obbligatori,
// stato cliente attivo + data attivazione (anche retroattiva) → 5) conferma → scheda creata con tutti i documenti (cartelle preservate).
import React, { useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Platform, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { Directory, File as FsFile } from "expo-file-system";
import { api, apiUpload } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { HT } from "@/src/homeTheme";
import { useResponsive } from "@/src/hooks/useResponsive";

type PickedFile = { name: string; relPath: string; size: number; mime: string; uri?: string; blob?: Blob; fsFile?: FsFile };
const DOC_EXT = /\.(pdf|jpe?g|png|heic|webp|tiff?)$/i;
const mimeFor = (name: string) => name.toLowerCase().endsWith(".pdf") ? "application/pdf" : /\.(jpe?g)$/i.test(name) ? "image/jpeg" : /\.png$/i.test(name) ? "image/png" : "application/octet-stream";

// V50.z425 — APP NATIVA: cartella scelta con il selettore di sistema (Android Storage Access Framework / iOS File) e
// navigazione ricorsiva di TUTTE le sottocartelle. Il permesso di accesso allo storage è concesso dall'utente proprio
// nel selettore (SAF): nessun permesso globale «tutti i file» richiesto, solo la cartella scelta (es. OKEN Scanner/Asolo Pneus).
function scanDirectory(dir: Directory, prefix: string, out: PickedFile[], depth = 0) {
  if (depth > 12 || out.length >= 150) return;
  let items: (Directory | FsFile)[] = [];
  try { items = dir.list(); } catch { return; }
  for (const it of items) {
    if (out.length >= 150) break;
    const name = (it as any).name as string;
    if (!name || name.startsWith(".")) continue;
    if (it instanceof Directory) { scanDirectory(it, `${prefix}${name}/`, out, depth + 1); continue; }
    if (!DOC_EXT.test(name)) continue;
    let size = 0;
    try { size = (it as FsFile).size || 0; } catch { size = 0; }
    out.push({ name, relPath: `${prefix}${name}`, size, mime: mimeFor(name), uri: it.uri, fsFile: it as FsFile });
  }
}
type FileMeta = { id: string; name: string; rel_path: string; folder: string; size: number; mime: string; pages?: number; scanned?: boolean; is_visura?: boolean };
type Analysis = { fields: Record<string, string>; sources: Record<string, string>; missing: string[]; required: string[]; labels: Record<string, string>; visura_file: string | null; files: FileMeta[]; warnings: string[] };
type Step = "pick" | "upload" | "analyze" | "preview" | "commit" | "done";
type Mode = "folder" | "csv" | "drive";
type DriveFolder = { id: string; name: string; path?: string };

const FIELD_ORDER = ["company", "legal_form", "vat_number", "fiscal_code", "address_street", "address_zip", "address_city", "address_province", "whatsapp", "email", "phone", "pec", "sdi_code", "bank_name", "iban", "legal_rep", "rea", "ateco"];
const todayIso = () => new Date().toISOString().slice(0, 10);
const fmtKb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export default function ContactImportFolderScreen() {
  const router = useRouter();
  const { isDesktop } = useResponsive();
  const [step, setStep] = useState<Step>("pick");
  const [picked, setPicked] = useState<PickedFile[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0, current: "" });
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [active, setActive] = useState(true);
  const [since, setSince] = useState(todayIso());
  const [result, setResult] = useState<{ contact_id: string; company: string; stats: { files: number; before: number; after: number; compressed: number; over_tolerance: number } } | null>(null);
  const webInputRef = useRef<any>(null);
  // V50.z426 — MODULO «IMPORTAZIONE CLIENTI»: tre modalità in un'unica schermata
  const [mode, setMode] = useState<Mode>("folder");
  const [drive, setDrive] = useState<{ connected: boolean; configured: boolean } | null>(null);
  const [driveParent, setDriveParent] = useState<{ id: string; name: string }[]>([{ id: "root", name: "Il mio Drive" }]);
  const [driveFolders, setDriveFolders] = useState<DriveFolder[]>([]);
  const [driveQ, setDriveQ] = useState("");
  const [driveLoading, setDriveLoading] = useState(false);
  const loadDriveFolders = async (parent: string, q = "") => {
    setDriveLoading(true);
    try {
      const r = await api<{ folders: DriveFolder[] }>(`/google-drive/folders/browse?parent=${encodeURIComponent(parent)}${q ? `&q=${encodeURIComponent(q)}` : ""}`);
      setDriveFolders(r.folders || []);
    } catch (e: any) { notify("Google Drive", e?.message || "Impossibile leggere le cartelle"); }
    finally { setDriveLoading(false); }
  };
  const openDriveMode = async () => {
    setMode("drive");
    try {
      const st = await api<{ connected: boolean; configured: boolean }>("/google-drive/status");
      setDrive(st);
      if (st.connected) await loadDriveFolders("root");
    } catch { setDrive({ connected: false, configured: false }); }
  };
  const importDriveFolder = async (f: DriveFolder) => {
    try {
      setStep("upload");
      setProgress({ done: 0, total: 1, current: `Google Drive › ${f.name}` });
      const sess = await api<{ session_id: string }>("/contacts/import-folder/session", { method: "POST" });
      setSessionId(sess.session_id);
      const r = await api<{ added: number; skipped: string[] }>(`/contacts/import-folder/${sess.session_id}/from-drive`, { method: "POST", body: { folder_id: f.id, folder_name: f.name } });
      if (!r.added) { notify("Nessun documento", "Nella cartella Drive scelta (e sottocartelle) non ci sono PDF o immagini."); setStep("pick"); return; }
      if (r.skipped?.length) notify("File ignorati", `${r.skipped.length} file non documentali o troppo grandi sono stati saltati.`);
      setStep("analyze");
      const a = await api<Analysis>(`/contacts/import-folder/${sess.session_id}/analyze`, { method: "POST" });
      setAnalysis(a); setFields({ ...a.fields }); setStep("preview");
    } catch (e: any) {
      notify("Errore import da Drive", e?.message || "Lettura non riuscita");
      setStep("pick");
    }
  };

  const rootFolder = useMemo(() => {
    const firsts = new Set(picked.map((p) => p.relPath.split("/")[0]).filter(Boolean));
    return firsts.size === 1 ? [...firsts][0] : "";
  }, [picked]);

  // ---- selezione ----
  const onWebFiles = (list: FileList | null) => {
    if (!list || !list.length) return;
    const out: PickedFile[] = [];
    for (let i = 0; i < list.length; i++) {
      const f = list[i] as File & { webkitRelativePath?: string };
      const rel = f.webkitRelativePath && f.webkitRelativePath.length ? f.webkitRelativePath : f.name;
      if (f.name.startsWith(".")) continue; // .DS_Store, Thumbs…
      out.push({ name: f.name, relPath: rel, size: f.size, mime: f.type || (f.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/octet-stream"), blob: f });
    }
    setPicked(out);
  };
  const pickWeb = (folder: boolean) => {
    if (typeof document === "undefined") return;
    const input = document.createElement("input");
    input.type = "file"; input.multiple = true;
    if (folder) { input.setAttribute("webkitdirectory", ""); input.setAttribute("directory", ""); }
    input.accept = ".pdf,image/*,application/pdf";
    input.onchange = () => onWebFiles(input.files);
    webInputRef.current = input;
    input.click();
  };
  const pickMobile = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: ["application/pdf", "image/*"], multiple: true, copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.length) return;
    setPicked(res.assets.map((a) => ({ name: a.name, relPath: a.name, size: a.size || 0, mime: a.mimeType || "application/pdf", uri: a.uri })));
  };
  const [permInfo, setPermInfo] = useState(false);
  const [scanning, setScanning] = useState(false);
  const pickMobileFolder = async () => {
    setPermInfo(false);
    try {
      let dir: Awaited<ReturnType<typeof Directory.pickDirectoryAsync>> | null = null;
      try {
        dir = await Directory.pickDirectoryAsync();
      } catch (e: any) {
        // V50.z470 — come Prompt 23.a (image-picker): launcher non ancora pronto → un solo secondo tentativo dopo 350 ms
        if (!/launcher|register|rejected/i.test(String(e?.message || e))) throw e;
        await new Promise((r) => setTimeout(r, 350));
        dir = await Directory.pickDirectoryAsync();
      }
      if (!dir) return;
      setScanning(true);
      const root = (dir as any).name || decodeURIComponent(dir.uri.split(/[/:]/).pop() || "Cartella");
      const out: PickedFile[] = [];
      scanDirectory(dir as unknown as Directory, `${root}/`, out);
      setScanning(false);
      if (!out.length) { notify("Nessun documento", "Nella cartella scelta (e sottocartelle) non ci sono PDF o immagini."); return; }
      setPicked(out);
    } catch (e: any) {
      setScanning(false);
      const msg = String(e?.message || e || "");
      if (/cancel|annull/i.test(msg)) return; // utente ha chiuso il selettore
      notify("Accesso alla cartella non riuscito", msg || "Riprova oppure usa «Scegli i documenti».");
    }
  };

  // ---- upload + analisi ----
  const startUpload = async () => {
    if (!picked.length) return;
    try {
      setStep("upload");
      const s = await api<{ session_id: string }>("/contacts/import-folder/session", { method: "POST" });
      setSessionId(s.session_id);
      setProgress({ done: 0, total: picked.length, current: "" });
      for (let i = 0; i < picked.length; i++) {
        const p = picked[i];
        setProgress({ done: i, total: picked.length, current: p.relPath });
        if (p.fsFile) {
          // nativo (SAF/iOS Files): lettura base64 dal File picker → JSON (i content:// non sono sempre accettati da FormData)
          const b64 = await p.fsFile.base64();
          await api(`/contacts/import-folder/${s.session_id}/file-b64`, { method: "POST", body: { name: p.name, rel_path: p.relPath, mime: p.mime, data_base64: b64 } });
          continue;
        }
        const form = new FormData();
        if (Platform.OS === "web" && p.blob) {
          form.append("file", new File([p.blob], p.name, { type: p.mime }));
        } else {
          form.append("file", { uri: p.uri, name: p.name, type: p.mime } as any);
        }
        form.append("rel_path", p.relPath);
        await apiUpload(`/contacts/import-folder/${s.session_id}/file`, form);
      }
      setProgress({ done: picked.length, total: picked.length, current: "" });
      setStep("analyze");
      const a = await api<Analysis>(`/contacts/import-folder/${s.session_id}/analyze`, { method: "POST" });
      setAnalysis(a);
      setFields({ ...a.fields });
      setStep("preview");
    } catch (e: any) {
      notify("Errore import", e?.message || "Caricamento non riuscito");
      setStep("pick");
    }
  };

  const missingNow = useMemo(() => FIELD_ORDER.filter((k) => !(fields[k] || "").trim()), [fields]);
  const missingRequired = useMemo(() => (analysis?.required || ["whatsapp", "email"]).filter((k) => !(fields[k] || "").trim()), [fields, analysis]);
  const sinceValid = /^\d{4}-\d{2}-\d{2}$/.test(since);

  const commit = async () => {
    if (!sessionId || missingRequired.length || !sinceValid) return;
    try {
      setStep("commit");
      const r = await api(`/contacts/import-folder/${sessionId}/commit`, { method: "POST", body: { fields, is_active_client: active, client_since: active ? since : null } });
      setResult(r);
      setStep("done");
    } catch (e: any) {
      notify("Errore", e?.message || "Creazione scheda non riuscita");
      setStep("preview");
    }
  };

  const labels = analysis?.labels || {};
  const wrap = isDesktop ? { maxWidth: 900, alignSelf: "center" as const, width: "100%" as const } : null;

  return (
    <SafeAreaView style={s.safe} edges={["top", "left", "right"]}>
      <View style={[s.header, wrap]}>
        <Pressable onPress={() => router.back()} style={s.back} testID="imp-back" hitSlop={10}><Ionicons name="chevron-back" size={24} color={HT.text} /></Pressable>
        <Text style={s.title}>Importazione clienti</Text>
      </View>
      <ScrollView contentContainerStyle={[s.body, wrap]} keyboardShouldPersistTaps="handled">
        {step === "pick" && (
          <View style={s.modes} testID="imp-modes">
            {([
              { k: "folder", icon: "folder-open-outline", t: "Cartella", d: "Documenti scansionati dal dispositivo" },
              { k: "csv", icon: "grid-outline", t: "CSV / Excel", d: "Tante anagrafiche in una volta" },
              { k: "drive", icon: "cloud-outline", t: "Google Drive", d: "Legge dal cloud, senza scaricare" },
            ] as { k: Mode; icon: any; t: string; d: string }[]).map((m) => (
              <Pressable key={m.k} testID={`imp-mode-${m.k}`} onPress={() => (m.k === "csv" ? router.push("/contacts-import" as any) : m.k === "drive" ? openDriveMode() : setMode("folder"))}
                style={[s.modeCard, mode === m.k && s.modeCardOn]}>
                <Ionicons name={m.icon} size={22} color={mode === m.k ? "#fff" : HT.violet} />
                <Text style={[s.modeT, mode === m.k && { color: "#fff" }]}>{m.t}</Text>
                <Text style={[s.modeD, mode === m.k && { color: "rgba(255,255,255,0.85)" }]}>{m.d}</Text>
              </Pressable>
            ))}
          </View>
        )}
        {step === "pick" && mode === "drive" && (
          <View style={s.card} testID="imp-drive">
            {!drive ? <ActivityIndicator color={HT.violet} /> : !drive.connected ? (
              <>
                <Text style={s.cardTitle}>Google Drive non collegato</Text>
                <Text style={s.lead}>Collega il tuo Google Drive una volta sola: AdvisorOS leggerà le cartelle dei clienti direttamente dal cloud, senza scaricare nulla sul dispositivo.</Text>
                <Pressable style={s.primary} onPress={() => router.push("/google-drive" as any)} testID="imp-drive-connect"><Ionicons name="link-outline" size={18} color="#fff" /><Text style={s.primaryTxt}>Collega Google Drive</Text></Pressable>
              </>
            ) : (
              <>
                <Text style={s.cardTitle}>Scegli la cartella del cliente su Drive</Text>
                <View style={s.row}>
                  <TextInput value={driveQ} onChangeText={setDriveQ} onSubmitEditing={() => loadDriveFolders(driveParent[driveParent.length - 1].id, driveQ.trim())} placeholder="Cerca cartella in tutto il Drive…" placeholderTextColor={HT.muted} style={[s.input, { flex: 1 }]} testID="imp-drive-search" returnKeyType="search" />
                </View>
                <View style={[s.row, { alignItems: "center" }]}>
                  {driveParent.map((p, i) => (
                    <Pressable key={p.id} onPress={() => { const np = driveParent.slice(0, i + 1); setDriveParent(np); setDriveQ(""); loadDriveFolders(p.id); }}>
                      <Text style={s.crumb}>{i > 0 ? "› " : ""}{p.name}</Text>
                    </Pressable>
                  ))}
                </View>
                {driveLoading ? <ActivityIndicator color={HT.violet} /> : driveFolders.length === 0 ? <Text style={s.muted}>Nessuna sottocartella qui.</Text> : driveFolders.map((f) => (
                  <View key={f.id} style={s.driveRow}>
                    <Pressable style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8 }} onPress={() => { setDriveParent([...driveParent, { id: f.id, name: f.name }]); setDriveQ(""); loadDriveFolders(f.id); }} testID={`imp-drive-open-${f.id}`}>
                      <Ionicons name="folder" size={18} color={HT.violet} />
                      <View style={{ flex: 1 }}><Text style={s.fileLine} numberOfLines={1}>{f.name}</Text>{f.path ? <Text style={s.muted} numberOfLines={1}>{f.path}</Text> : null}</View>
                    </Pressable>
                    <Pressable style={s.pick} onPress={() => importDriveFolder(f)} testID={`imp-drive-import-${f.id}`}><Text style={s.pickTxt}>Importa</Text></Pressable>
                  </View>
                ))}
                {driveParent.length > 1 && (
                  <Pressable style={[s.primary, { marginTop: 8 }]} onPress={() => importDriveFolder(driveParent[driveParent.length - 1])} testID="imp-drive-import-current">
                    <Ionicons name="cloud-download-outline" size={18} color="#fff" /><Text style={s.primaryTxt}>Importa «{driveParent[driveParent.length - 1].name}» (con sottocartelle)</Text>
                  </Pressable>
                )}
              </>
            )}
          </View>
        )}
        {step === "pick" && mode === "folder" && (
          <>
            <Text style={s.lead}>Seleziona la cartella del cliente con tutti i documenti scansionati (visura camerale, fatture, bollette, contratti…). Le sottocartelle vengono mantenute così come sono.</Text>
            <View style={s.row}>
              {Platform.OS === "web" ? (
                <>
                  <Pressable style={s.primary} onPress={() => pickWeb(true)} testID="imp-pick-folder"><Ionicons name="folder-open-outline" size={18} color="#fff" /><Text style={s.primaryTxt}>Scegli cartella</Text></Pressable>
                  <Pressable style={s.secondary} onPress={() => pickWeb(false)} testID="imp-pick-files"><Ionicons name="documents-outline" size={18} color={HT.violet} /><Text style={s.secondaryTxt}>Scegli file</Text></Pressable>
                </>
              ) : (
                <>
                  <Pressable style={s.primary} onPress={() => setPermInfo(true)} testID="imp-pick-folder"><Ionicons name="folder-open-outline" size={18} color="#fff" /><Text style={s.primaryTxt}>Scegli cartella</Text></Pressable>
                  <Pressable style={s.secondary} onPress={pickMobile} testID="imp-pick-files"><Ionicons name="documents-outline" size={18} color={HT.violet} /><Text style={s.secondaryTxt}>Scegli i documenti</Text></Pressable>
                </>
              )}
            </View>
            {permInfo && (
              <View style={s.card} testID="imp-perm-info">
                <Text style={s.cardTitle}>Accesso alla cartella del cliente</Text>
                <Text style={s.lead}>Per leggere visura e documenti, AdvisorOS chiede l&apos;accesso alla sola cartella che scegli nel selettore di sistema (es. OKEN Scanner › Asolo Pneus), comprese le sottocartelle. Nessun altro file del dispositivo viene letto.</Text>
                <View style={s.row}>
                  <Pressable style={s.primary} onPress={pickMobileFolder} testID="imp-perm-continue"><Ionicons name="shield-checkmark-outline" size={18} color="#fff" /><Text style={s.primaryTxt}>Continua e scegli la cartella</Text></Pressable>
                  <Pressable style={s.secondary} onPress={() => setPermInfo(false)}><Text style={s.secondaryTxt}>Non ora</Text></Pressable>
                </View>
              </View>
            )}
            {scanning && <View style={s.card}><ActivityIndicator color={HT.violet} /><Text style={s.progressTxt}>Lettura cartella e sottocartelle…</Text></View>}
            {picked.length > 0 && (
              <View style={s.card}>
                <Text style={s.cardTitle}>{rootFolder ? `Cartella «${rootFolder}»` : "File selezionati"} · {picked.length} file · {fmtKb(picked.reduce((a, p) => a + p.size, 0))}</Text>
                {picked.slice(0, 40).map((p) => (
                  <Text key={p.relPath} style={s.fileLine} numberOfLines={1}>📄 {p.relPath} <Text style={s.muted}>({fmtKb(p.size)})</Text></Text>
                ))}
                {picked.length > 40 && <Text style={s.muted}>… e altri {picked.length - 40} file</Text>}
                <Pressable style={[s.primary, { marginTop: 12 }]} onPress={startUpload} testID="imp-start"><Ionicons name="cloud-upload-outline" size={18} color="#fff" /><Text style={s.primaryTxt}>Carica e analizza</Text></Pressable>
              </View>
            )}
          </>
        )}

        {(step === "upload" || step === "analyze" || step === "commit") && (
          <View style={s.card}>
            <ActivityIndicator color={HT.violet} size="large" />
            <Text style={s.progressTxt}>
              {step === "upload" ? `Caricamento ${progress.done + 1}/${progress.total}…` : step === "analyze" ? "Lettura documenti, ricerca visura camerale ed estrazione dati…" : "Creazione scheda e compressione documenti…"}
            </Text>
            {step === "upload" && !!progress.current && <Text style={s.muted} numberOfLines={1}>{progress.current}</Text>}
            {step === "upload" && <View style={s.bar}><View style={[s.barFill, { width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }]} /></View>}
          </View>
        )}

        {step === "preview" && analysis && (
          <>
            {analysis.warnings.map((w) => <View key={w} style={s.warn}><Ionicons name="warning-outline" size={16} color={HT.warning} /><Text style={s.warnTxt}>{w}</Text></View>)}
            {analysis.visura_file && <Text style={s.okLine}>✓ Visura camerale trovata: {analysis.visura_file}</Text>}
            <Text style={s.sectionTitle}>Dati estratti — controlla e completa</Text>
            <Text style={s.muted}>In rosso i campi mancanti. Cellulare ed email sono obbligatori per confermare.</Text>
            <View style={s.card}>
              {FIELD_ORDER.map((k) => {
                const missing = !(fields[k] || "").trim();
                const req = (analysis.required || []).includes(k);
                return (
                  <View key={k} style={s.fieldRow}>
                    <Text style={[s.fieldLbl, missing && s.fieldLblMissing]}>{labels[k] || k}{req ? " *" : ""}</Text>
                    <TextInput
                      testID={`imp-field-${k}`}
                      value={fields[k] || ""}
                      onChangeText={(v) => setFields((f) => ({ ...f, [k]: v }))}
                      placeholder={missing ? "mancante — inserisci" : ""}
                      placeholderTextColor={HT.danger}
                      style={[s.input, missing && s.inputMissing]}
                      autoCapitalize={k === "iban" || k === "sdi_code" || k === "fiscal_code" ? "characters" : "none"}
                      keyboardType={k === "whatsapp" || k === "phone" ? "phone-pad" : k === "email" || k === "pec" ? "email-address" : "default"}
                    />
                    {!!analysis.sources[k] && !missing && <Text style={s.src} numberOfLines={1}>da {analysis.sources[k]}</Text>}
                  </View>
                );
              })}
            </View>

            <Text style={s.sectionTitle}>Stato cliente</Text>
            <View style={s.card}>
              <View style={s.rowBetween}>
                <Text style={s.fieldLbl}>Cliente attivo</Text>
                <Pressable onPress={() => setActive((a) => !a)} testID="imp-active" hitSlop={8}><Ionicons name={active ? "toggle" : "toggle-outline"} size={38} color={active ? HT.success : HT.muted} /></Pressable>
              </View>
              {active && (
                <View style={s.fieldRow}>
                  <Text style={s.fieldLbl}>Attivo dal (AAAA-MM-GG, anche retroattiva)</Text>
                  <TextInput testID="imp-since" value={since} onChangeText={setSince} style={[s.input, !sinceValid && s.inputMissing]} placeholder="2025-01-15" placeholderTextColor={HT.muted} />
                </View>
              )}
            </View>

            <Text style={s.sectionTitle}>Documenti ({analysis.files.length})</Text>
            <View style={s.card}>
              {analysis.files.map((f) => (
                <Text key={f.id} style={s.fileLine} numberOfLines={1}>{f.is_visura ? "🏛️" : "📄"} {f.rel_path} <Text style={s.muted}>({fmtKb(f.size)}{f.scanned ? " · scansione" : ""})</Text></Text>
              ))}
              <Text style={[s.muted, { marginTop: 6 }]}>I PDF scansionati vengono compressi verso 200 KB (tolleranza ~300 KB) senza rinominare né spostare nulla.</Text>
            </View>

            {missingRequired.length > 0 && <Text style={s.errLine}>Per confermare inserisci: {missingRequired.map((k) => labels[k] || k).join(", ")}</Text>}
            <View style={s.row}>
              <Pressable style={s.secondary} onPress={() => { setStep("pick"); setPicked([]); setAnalysis(null); }} testID="imp-cancel"><Text style={s.secondaryTxt}>Annulla</Text></Pressable>
              <Pressable style={[s.primary, (missingRequired.length > 0 || !sinceValid) && s.disabled]} disabled={missingRequired.length > 0 || !sinceValid} onPress={commit} testID="imp-confirm">
                <Ionicons name="checkmark-circle-outline" size={18} color="#fff" /><Text style={s.primaryTxt}>Crea scheda cliente{missingNow.length ? ` (${missingNow.length} campi vuoti)` : ""}</Text>
              </Pressable>
            </View>
          </>
        )}

        {step === "done" && result && (
          <View style={s.card}>
            <Text style={s.cardTitle}>✓ Scheda «{result.company}» creata</Text>
            <Text style={s.fileLine}>{result.stats.files} documenti allegati · {fmtKb(result.stats.before)} → {fmtKb(result.stats.after)} ({result.stats.compressed} compressi{result.stats.over_tolerance ? `, ${result.stats.over_tolerance} oltre 300 KB per restare leggibili` : ""})</Text>
            <Text style={s.muted}>I dati estratti sono già disponibili ad Axon per la compilazione automatica dei contratti.</Text>
            <Pressable style={[s.primary, { marginTop: 12 }]} onPress={() => router.replace(`/contact/${result.contact_id}` as any)} testID="imp-open-contact"><Ionicons name="person-outline" size={18} color="#fff" /><Text style={s.primaryTxt}>Apri la scheda</Text></Pressable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: HT.bg },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 18, fontWeight: "800", color: HT.text },
  body: { padding: 16, paddingBottom: 48, gap: 12 },
  lead: { color: HT.text2, fontSize: 14, lineHeight: 20 },
  row: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  primary: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: HT.violet, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, minHeight: 48 },
  primaryTxt: { color: "#fff", fontWeight: "800", fontSize: 14 },
  secondary: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: HT.violetTint, borderWidth: 1, borderColor: HT.violet + "55", paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, minHeight: 48 },
  secondaryTxt: { color: HT.violet, fontWeight: "800", fontSize: 14 },
  disabled: { opacity: 0.45 },
  card: { backgroundColor: HT.card, borderRadius: 14, borderWidth: 1, borderColor: HT.border, padding: 14, gap: 6 },
  cardTitle: { color: HT.text, fontWeight: "800", fontSize: 15 },
  fileLine: { color: HT.text2, fontSize: 13 },
  muted: { color: HT.muted, fontSize: 12 },
  progressTxt: { color: HT.text, fontWeight: "700", textAlign: "center", marginTop: 8 },
  bar: { height: 6, backgroundColor: HT.border, borderRadius: 3, overflow: "hidden", marginTop: 8 },
  barFill: { height: 6, backgroundColor: HT.violet },
  warn: { flexDirection: "row", gap: 8, alignItems: "center", backgroundColor: HT.warningTint, padding: 10, borderRadius: 10 },
  warnTxt: { color: HT.warning, fontSize: 13, flex: 1 },
  okLine: { color: HT.success, fontWeight: "700", fontSize: 13 },
  errLine: { color: HT.danger, fontWeight: "700", fontSize: 13 },
  sectionTitle: { color: HT.text, fontWeight: "800", fontSize: 15, marginTop: 6 },
  fieldRow: { gap: 4, marginBottom: 6 },
  fieldLbl: { color: HT.text2, fontSize: 12, fontWeight: "700" },
  fieldLblMissing: { color: HT.danger },
  input: { borderWidth: 1, borderColor: HT.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: HT.text, backgroundColor: HT.card2, minHeight: 44, fontSize: 14 },
  inputMissing: { borderColor: HT.danger, backgroundColor: HT.dangerTint },
  src: { color: HT.muted, fontSize: 11 },
  modes: { flexDirection: "row", gap: 10 },
  modeCard: { flex: 1, backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border, borderRadius: 14, padding: 12, gap: 4, minHeight: 96 },
  modeCardOn: { backgroundColor: HT.violet, borderColor: HT.violet },
  modeT: { color: HT.text, fontWeight: "800", fontSize: 14 },
  modeD: { color: HT.muted, fontSize: 11, lineHeight: 15 },
  crumb: { color: HT.violet, fontWeight: "700", fontSize: 12 },
  driveRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: HT.border },
  pick: { backgroundColor: HT.violetTint, borderWidth: 1, borderColor: HT.violet + "55", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, minHeight: 36, justifyContent: "center" },
  pickTxt: { color: HT.violet, fontWeight: "800", fontSize: 12 },
});

// FolderImportSheet.tsx — V50.z482 — «Carica cartella» con ANTEPRIMA e BARRA DI AVANZAMENTO, riusabile da tutti i punti di upload.
//   1) anteprima: elenco dei file trovati (nome · sottocartella · dimensione) con spunta per escluderne alcuni, Tutti/Nessuno,
//      file oltre il limite già deselezionati e marcati;
//   2) caricamento: barra «3 di 12 file» + nome del file corrente, invece della sola rotella.
// Uso: const folder = useFolderImport({ uploadOne: async (f) => {...}, onDone: (ok, failed) => {...} });
//      <Pressable onPress={folder.pick} …/>  …  {folder.sheet}
import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Modal, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { HT } from "@/src/homeTheme";
import { notify } from "@/src/utils/notify";
import { pickFolderFiles, folderSummary, type FolderFile } from "@/src/utils/folderPicker";

const fmtSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

type Opts = {
  uploadOne: (f: FolderFile) => Promise<void>;
  onDone?: (ok: number, failed: number) => void | Promise<void>;
  extRe?: RegExp;
  maxSize?: number; // byte; default 50 MB
  title?: string;
  emptyHint?: string;
};

export function useFolderImport(opts: Opts) {
  const [files, setFiles] = useState<FolderFile[] | null>(null);
  const pick = useCallback(async () => {
    try {
      const found = await pickFolderFiles({ extRe: opts.extRe });
      if (!found.length) { notify("Nessun documento", opts.emptyHint || "Nella cartella scelta (e sottocartelle) non ci sono file supportati."); return; }
      setFiles(found);
    } catch (e: any) {
      notify("Accesso alla cartella non riuscito", e?.message || "Riprova oppure carica i file singolarmente.");
    }
  }, [opts.extRe, opts.emptyHint]);
  const sheet = files ? <FolderImportSheet files={files} onClose={() => setFiles(null)} uploadOne={opts.uploadOne} onDone={opts.onDone} maxSize={opts.maxSize} title={opts.title} /> : null;
  return { pick, sheet };
}

export function FolderImportSheet({ files, onClose, uploadOne, onDone, maxSize = 50 * 1024 * 1024, title = "Carica cartella" }: { files: FolderFile[]; onClose: () => void } & Pick<Opts, "uploadOne" | "onDone" | "maxSize" | "title">) {
  const insets = useSafeAreaInsets();
  const [excluded, setExcluded] = useState<Set<number>>(() => new Set(files.map((f, i) => (f.size > maxSize ? i : -1)).filter((i) => i >= 0)));
  const [phase, setPhase] = useState<"preview" | "upload">("preview");
  const [prog, setProg] = useState({ done: 0, total: 0, current: "", failed: 0 });
  const selected = useMemo(() => files.filter((_, i) => !excluded.has(i)), [files, excluded]);
  const totalSize = selected.reduce((s, f) => s + f.size, 0);
  const root = useMemo(() => { const r = new Set(files.map((f) => f.relPath.split("/")[0])); return r.size === 1 ? [...r][0] : ""; }, [files]);
  const toggle = (i: number) => setExcluded((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });

  const start = async () => {
    if (!selected.length) return;
    setPhase("upload");
    let ok = 0, failed = 0;
    for (const f of selected) {
      setProg({ done: ok + failed, total: selected.length, current: f.name, failed });
      try { await uploadOne(f); ok++; } catch { failed++; }
    }
    setProg({ done: selected.length, total: selected.length, current: "", failed });
    try { await onDone?.(ok, failed); } catch { /* noop */ }
    notify("Cartella importata", folderSummary(ok, failed));
    onClose();
  };

  const pct = prog.total ? Math.round((100 * prog.done) / prog.total) : 0;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={() => { if (phase === "preview") onClose(); }}>
      <Pressable style={s.backdrop} onPress={() => { if (phase === "preview") onClose(); }} testID="folder-import-backdrop">
        <Pressable style={[s.sheet, { paddingBottom: insets.bottom + 14 }]} onPress={() => {}} testID="folder-import-sheet">
          <View style={s.handle} />
          <View style={s.head}>
            <Ionicons name="folder-open" size={20} color={HT.brand} />
            <Text style={s.title} numberOfLines={1}>{title}{root ? ` · ${root}` : ""}</Text>
          </View>
          {phase === "preview" ? (
            <>
              <Text style={s.sub}>{files.length} file trovati · {selected.length} selezionati · {fmtSize(totalSize)}</Text>
              <View style={s.row}>
                <Pressable onPress={() => setExcluded(new Set(files.map((f, i) => (f.size > maxSize ? i : -1)).filter((i) => i >= 0)))} style={s.chip} testID="folder-import-all"><Text style={s.chipTxt}>Tutti</Text></Pressable>
                <Pressable onPress={() => setExcluded(new Set(files.map((_, i) => i)))} style={s.chip} testID="folder-import-none"><Text style={s.chipTxt}>Nessuno</Text></Pressable>
              </View>
              <ScrollView style={{ maxHeight: 340 }} testID="folder-import-list">
                {files.map((f, i) => {
                  const tooBig = f.size > maxSize;
                  const on = !excluded.has(i);
                  const sub = f.relPath.includes("/") ? f.relPath.slice(0, f.relPath.lastIndexOf("/")) : "";
                  return (
                    <Pressable key={`${f.relPath}_${i}`} onPress={() => { if (!tooBig) toggle(i); }} style={[s.item, !on && { opacity: 0.55 }]} testID={`folder-import-item-${i}`}>
                      <Ionicons name={on ? "checkbox" : "square-outline"} size={22} color={on ? HT.brand : HT.muted} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={s.name} numberOfLines={1}>{f.name}</Text>
                        <Text style={s.meta} numberOfLines={1}>{sub ? `${sub} · ` : ""}{fmtSize(f.size)}{tooBig ? ` · troppo grande (max ${fmtSize(maxSize)})` : ""}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>
              <View style={s.row}>
                <Pressable onPress={onClose} style={[s.btn, s.btnGhost]} testID="folder-import-cancel"><Text style={[s.btnTxt, { color: HT.text2 }]}>Annulla</Text></Pressable>
                <Pressable onPress={start} disabled={!selected.length} style={[s.btn, { flex: 1, opacity: selected.length ? 1 : 0.5 }]} testID="folder-import-confirm">
                  <Ionicons name="cloud-upload" size={18} color="#FFF" />
                  <Text style={s.btnTxt}>Carica {selected.length} file</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <View style={{ gap: 10 }} testID="folder-import-progress">
              <Text style={s.sub}>{prog.done < prog.total ? `Caricamento ${prog.done + 1} di ${prog.total} file` : `Completato: ${prog.total} file`}{prog.failed ? ` · ${prog.failed} non riusciti` : ""}</Text>
              <View style={s.bar}><View style={[s.barFill, { width: `${pct}%` as any }]} /></View>
              <View style={s.row}>
                <ActivityIndicator size="small" color={HT.brand} />
                <Text style={s.meta} numberOfLines={1}>{prog.current || "Finalizzazione…"}</Text>
                <Text style={[s.meta, { marginLeft: "auto", fontWeight: "800", color: HT.text }]}>{pct}%</Text>
              </View>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { backgroundColor: HT.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, gap: 10, maxWidth: 720, width: "100%", alignSelf: "center" },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: HT.border, alignSelf: "center", marginBottom: 2 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, fontSize: 16, fontWeight: "800", color: HT.text },
  sub: { fontSize: 13, color: HT.text2 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  chip: { paddingHorizontal: 12, minHeight: 34, justifyContent: "center", borderRadius: 999, borderWidth: 1, borderColor: HT.border, backgroundColor: HT.card2 },
  chipTxt: { color: HT.text, fontWeight: "700", fontSize: 12.5 },
  item: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, minHeight: 44, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HT.border },
  name: { fontSize: 14, fontWeight: "700", color: HT.text },
  meta: { fontSize: 12, color: HT.muted },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 46, paddingHorizontal: 16, borderRadius: 12, backgroundColor: HT.brand },
  btnGhost: { backgroundColor: HT.card2, borderWidth: 1, borderColor: HT.border },
  btnTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
  bar: { height: 10, borderRadius: 5, backgroundColor: HT.card2, overflow: "hidden", borderWidth: 1, borderColor: HT.border },
  barFill: { height: "100%", backgroundColor: HT.brand },
});

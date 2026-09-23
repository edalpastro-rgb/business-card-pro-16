// V42 — "Documenti Axon" — knowledge base per la RAG dell'assistente.
// Il Master carica PDF (contratti, listini, brochure), Axon li legge e li usa
// per rispondere. Solo il Master (owner senza parent_user_id) può usare questa
// pagina. I collaboratori vedono un messaggio informativo.

import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { notify, confirmAsync } from "@/src/utils/notify";
import { pickCommonFile } from "@/src/utils/filePicker";
import { useBottomSheetPadding } from "@/src/utils/bottomSheetInsets";
import * as FileSystem from "expo-file-system/legacy";
import { KbEntryEditorModal, KB_CATEGORIES, type KbCategory } from "@/src/KbEntryEditorModal";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

type MasterDoc = {
  doc_id: string;
  name: string;
  mime?: string;
  size?: number;
  total_pages?: number;
  total_chunks?: number;
  created_at?: string;
  updated_at?: string;
  kind?: "pdf" | "text";       // V50.z144
  category?: KbCategory;       // V50.z144
};

const KIND_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  Documento: "document-text",
  FAQ: "help-circle",
  Dati: "stats-chart",
  Nota: "create",
};

export default function DocumentiAxonScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const bottomPad = useBottomSheetPadding(24);
  const isMaster = !user?.parent_user_id && (user?.role || "member") === "owner";

  const [items, setItems] = useState<MasterDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  // V50.z144 — editor voce KB (nuova FAQ/Dati/Nota o modifica/rinomina)
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorDoc, setEditorDoc] = useState<MasterDoc | null>(null);
  const [filterCat, setFilterCat] = useState<KbCategory | "all">("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api<{ items: MasterDoc[] }>("/master-docs");
      setItems(r?.items || []);
    } catch (e: any) {
      notify("Errore caricamento", e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  const upload = async () => {
    if (!isMaster) return;
    setUploading(true);
    try {
      const { asset, error, base64 } = await pickCommonFile({ multiple: false });
      if (error || !asset) {
        if (error) notify("Errore selezione", error);
        return;
      }
      const mime = (asset.mimeType || "").toLowerCase();
      const name = (asset.name || "documento.pdf").toString();
      const lower = name.toLowerCase();
      const isPdf = mime.includes("pdf") || lower.endsWith(".pdf");
      const isText = mime.startsWith("text/") || [".txt", ".md", ".csv"].some((e) => lower.endsWith(e));
      if (!isPdf && !isText) {
        notify("Formato non supportato", "Sono accettati PDF, TXT, MD e CSV. Per FAQ e dati usa «Nuova voce».");
        return;
      }
      let b64 = base64 || (asset as { _base64?: string })._base64 || "";
      if (!b64 && asset.uri) {
        try {
          if (asset.uri.startsWith("data:")) {
            const c = asset.uri.indexOf(",");
            if (c > 0) b64 = asset.uri.slice(c + 1);
          } else if (Platform.OS === "web") {
            const resp = await fetch(asset.uri);
            const blob = await resp.blob();
            b64 = await new Promise<string>((res, rej) => {
              const r = new FileReader();
              r.onerror = () => rej(new Error("FileReader error"));
              r.onload = () => {
                const s = String(r.result || "");
                const cc = s.indexOf(",");
                res(cc >= 0 ? s.slice(cc + 1) : s);
              };
              r.readAsDataURL(blob);
            });
          } else {
            b64 = await FileSystem.readAsStringAsync(asset.uri, {
              encoding: FileSystem.EncodingType.Base64,
            });
          }
        } catch (e: any) {
          notify("Errore lettura", e?.message || String(e));
          return;
        }
      }
      if (!b64) {
        notify("File vuoto", "Impossibile leggere il file selezionato.");
        return;
      }
      const stripped = name.replace(/\.(pdf|txt|md|csv)$/i, "");
      await api("/master-docs", {
        method: "POST",
        body: { name: stripped, mime: isPdf ? "application/pdf" : (mime || "text/plain"), data_base64: b64, category: "Documento" },
      });
      await load();
      notify(isPdf ? "PDF caricato" : "File caricato", "Axon ora userà questo documento nelle sue risposte.");
    } catch (e: any) {
      notify("Upload fallito", e?.message || String(e));
    } finally {
      setUploading(false);
    }
  };

  const remove = async (d: MasterDoc) => {
    const ok = await confirmAsync(
      "Eliminare questo documento?",
      `"${d.name}" verrà rimosso dalla memoria di Axon. Non potrà più usarlo per rispondere.`
    );
    if (!ok) return;
    try {
      await api(`/master-docs/${d.doc_id}`, { method: "DELETE" });
      setItems((arr) => arr.filter((x) => x.doc_id !== d.doc_id));
    } catch (e: any) {
      notify("Errore eliminazione", e?.message || String(e));
    }
  };

  const fmtSize = (bytes?: number) => {
    if (!bytes || bytes < 0) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const fmtDate = (iso?: string) => {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      return d.toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
    } catch {
      return iso;
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color="#FFF" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Knowledge Base Axon</Text>
          <Text style={styles.headerSub}>Documenti, FAQ e dati ricorrenti che Axon usa per rispondere</Text>
        </View>
        <Pressable onPress={() => router.push("/ai-teach" as any)} hitSlop={8} style={styles.rulesBtn} testID="kb-goto-rules">
          <Ionicons name="school" size={16} color="#FFF" />
          <Text style={styles.rulesBtnTxt}>Regole</Text>
        </Pressable>
      </View>

      {/* Info box */}
      <View style={styles.infoBox}>
        <View style={styles.infoIconWrap}>
          <Ionicons name="bulb" size={16} color={HT.warning} />
        </View>
        <Text style={styles.infoTxt}>
          Carica PDF/testi o scrivi FAQ, dati ricorrenti e note: prima di ogni risposta Axon cerca automaticamente
          le voci pertinenti alla domanda e le carica nel contesto. Le regole di comportamento (direttive PINNED) si
          gestiscono in «Regole».
        </Text>
      </View>

      {!isMaster && (
        <View style={styles.readonlyBox}>
          <Ionicons name="lock-closed" size={14} color={HT.muted} />
          <Text style={styles.readonlyTxt}>
            Solo il Master può caricare o eliminare documenti. Ma Axon userà comunque quelli caricati
            dal tuo Master per rispondere alle tue domande.
          </Text>
        </View>
      )}

      {/* V50.z144 — Filtro categoria */}
      {items.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 10, gap: 8 }}>
          {([{ key: "all", label: "Tutte" }, ...KB_CATEGORIES.map((c) => ({ key: c.key, label: c.key }))] as { key: KbCategory | "all"; label: string }[]).map((c) => {
            const on = filterCat === c.key;
            const n = c.key === "all" ? items.length : items.filter((d) => (d.category || "Documento") === c.key).length;
            if (c.key !== "all" && n === 0) return null;
            return (
              <Pressable key={c.key} onPress={() => setFilterCat(c.key)} style={[styles.filterChip, on && styles.filterChipOn]} testID={`kb-filter-${c.key}`}>
                <Text style={[styles.filterTxt, on && { color: "#FFF" }]}>{c.label} · {n}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 12 }}>
        {loading && (
          <View style={{ alignItems: "center", paddingVertical: 40 }}>
            <ActivityIndicator color={HT.brand} />
          </View>
        )}

        {!loading && items.length === 0 && (
          <View style={styles.emptyBox}>
            <Ionicons name="documents-outline" size={40} color={HT.muted} />
            <Text style={styles.emptyTitle}>Knowledge base vuota</Text>
            <Text style={styles.emptyTxt}>
              {isMaster
                ? "Tocca «Carica file» per un PDF/TXT oppure «Nuova voce» per una FAQ o un dato ricorrente."
                : "Il tuo Master non ha ancora caricato documenti Axon."}
            </Text>
          </View>
        )}

        {!loading &&
          items.filter((d) => filterCat === "all" || (d.category || "Documento") === filterCat).map((d) => {
            const cat = (d.category || "Documento") as KbCategory;
            const isText = (d.kind || "pdf") === "text";
            return (
            <Pressable
              key={d.doc_id}
              style={styles.docCard}
              testID={`doc-${d.doc_id}`}
              disabled={!isMaster}
              onPress={() => { setEditorDoc(d); setEditorOpen(true); }}
              accessibilityLabel={isMaster ? "Modifica voce" : undefined}
            >
              <View style={styles.docIcon}>
                <Ionicons name={KIND_ICON[cat] || "document-text"} size={22} color="#7C3AED" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.docName} numberOfLines={2}>{d.name}</Text>
                <View style={styles.docMeta}>
                  <View style={styles.catBadge}><Text style={styles.catBadgeTxt}>{cat}</Text></View>
                  <Text style={styles.docMetaTxt}>
                    {!isText && d.total_pages ? `${d.total_pages} pag · ` : ""}
                    {d.total_chunks ? `${d.total_chunks} chunk` : ""}
                    {d.size ? ` · ${fmtSize(d.size)}` : ""}
                  </Text>
                  {(d.updated_at || d.created_at) && (
                    <Text style={styles.docMetaTxt}>· {fmtDate(d.updated_at || d.created_at)}</Text>
                  )}
                </View>
              </View>
              {isMaster && (
                <View style={{ flexDirection: "row", gap: 6 }}>
                  <Pressable
                    onPress={() => { setEditorDoc(d); setEditorOpen(true); }}
                    hitSlop={8}
                    style={[styles.docDelBtn, { backgroundColor: '#F3E8FF' }]}
                    testID={`doc-edit-${d.doc_id}`}
                    accessibilityLabel={isText ? "Modifica voce" : "Rinomina documento"}
                  >
                    <Ionicons name="create-outline" size={18} color="#7C3AED" />
                  </Pressable>
                  <Pressable
                    onPress={() => void remove(d)}
                    hitSlop={8}
                    style={styles.docDelBtn}
                    testID={`doc-del-${d.doc_id}`}
                    accessibilityLabel="Elimina documento"
                  >
                    <Ionicons name="trash" size={18} color="#DC2626" />
                  </Pressable>
                </View>
              )}
            </Pressable>
            );
          })}
      </ScrollView>

      {/* FAB — Master only: Carica file + Nuova voce */}
      {isMaster && (
        <View style={[styles.fabRow, { bottom: 96 + bottomPad - 24 }]}>
          <Pressable
            onPress={() => { setEditorDoc(null); setEditorOpen(true); }}
            style={[styles.fab, { backgroundColor: '#1B2B4B', shadowColor: HT.text }]}
            testID="kb-new-entry-fab"
          >
            <Ionicons name="add-circle" size={20} color="#FFF" />
            <Text style={styles.fabTxt}>Nuova voce</Text>
          </Pressable>
          <Pressable
            onPress={upload}
            disabled={uploading}
            style={[styles.fab, uploading && { opacity: 0.6 }]}
            testID="doc-upload-fab"
          >
            {uploading ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <>
                <Ionicons name="cloud-upload" size={20} color="#FFF" />
                <Text style={styles.fabTxt}>Carica file</Text>
              </>
            )}
          </Pressable>
        </View>
      )}

      <KbEntryEditorModal visible={editorOpen} doc={editorDoc} onClose={() => setEditorOpen(false)} onSaved={load} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: HT.card2 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#7C3AED',
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { color: "#FFF", fontSize: 18, fontWeight: "800", letterSpacing: -0.2 },
  headerSub: { color: "rgba(255,255,255,0.85)", fontSize: 12, marginTop: 2 },
  infoBox: {
    marginTop: 12,
    marginHorizontal: 16,
    flexDirection: "row",
    gap: 10,
    backgroundColor: HT.warningTint,
    borderColor: HT.warning + '66',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    alignItems: "flex-start",
  },
  infoIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: HT.warningTint,
    borderColor: HT.warning + '66',
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  infoTxt: { flex: 1, fontSize: 12, color: "#FDBA74", lineHeight: 17 },
  readonlyBox: {
    marginTop: 8,
    marginHorizontal: 16,
    flexDirection: "row",
    gap: 8,
    backgroundColor: HT.card2,
    borderRadius: 12,
    padding: 10,
    alignItems: "center",
  },
  readonlyTxt: { flex: 1, fontSize: 11, color: HT.text2, lineHeight: 16 },
  emptyBox: {
    alignItems: "center",
    gap: 6,
    padding: 32,
    backgroundColor: HT.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: HT.border,
    borderStyle: "dashed",
  },
  emptyTitle: { fontSize: 15, fontWeight: "700", color: HT.text2, marginTop: 8 },
  emptyTxt: { fontSize: 12, color: HT.muted, textAlign: "center", maxWidth: 260 },
  docCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: HT.card,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#EEF2F7',
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  docIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#F3E8FF',
    alignItems: "center",
    justifyContent: "center",
  },
  docName: { fontSize: 14, fontWeight: "700", color: HT.text },
  docMeta: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", marginTop: 3 },
  docMetaTxt: { fontSize: 11, color: HT.muted, marginRight: 4 },
  docDelBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: HT.dangerTint,
    alignItems: "center",
    justifyContent: "center",
  },
  fab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: '#7C3AED',
    shadowColor: "#7C3AED",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
  },
  // V50.z144 — riga FAB (Nuova voce + Carica file)
  fabRow: { position: "absolute", right: 92, left: 16, flexDirection: "row", justifyContent: "flex-start", gap: 10 }, // right: 92 → non copre il FAB AxonOS
  fabTxt: { color: "#FFF", fontWeight: "800", fontSize: 14, letterSpacing: -0.2 },
  rulesBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, minHeight: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.18)" },
  rulesBtnTxt: { color: "#FFF", fontWeight: "800", fontSize: 12 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: HT.violet + '66', backgroundColor: HT.card, minHeight: 32, justifyContent: "center" },
  filterChipOn: { backgroundColor: '#7C3AED', borderColor: '#7C3AED' },
  filterTxt: { fontSize: 12, fontWeight: "700", color: "#7C3AED" },
  catBadge: { backgroundColor: '#F3E8FF', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1, marginRight: 6 },
  catBadgeTxt: { fontSize: 10, fontWeight: "800", color: "#7C3AED" },
});

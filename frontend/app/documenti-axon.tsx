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
import { theme } from "@/src/theme";
import { notify, confirmAsync } from "@/src/utils/notify";
import { pickCommonFile } from "@/src/utils/filePicker";
import { useBottomSheetPadding } from "@/src/utils/bottomSheetInsets";
import * as FileSystem from "expo-file-system/legacy";

type MasterDoc = {
  doc_id: string;
  name: string;
  mime?: string;
  size?: number;
  total_pages?: number;
  total_chunks?: number;
  created_at?: string;
};

export default function DocumentiAxonScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const bottomPad = useBottomSheetPadding(24);
  const isMaster = !user?.parent_user_id && (user?.role || "member") === "owner";

  const [items, setItems] = useState<MasterDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

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
      if (!mime.includes("pdf") && !name.toLowerCase().endsWith(".pdf")) {
        notify("Formato non supportato", "Al momento sono accettati solo file PDF.");
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
        notify("File vuoto", "Impossibile leggere il PDF selezionato.");
        return;
      }
      const stripped = name.replace(/\.pdf$/i, "");
      await api("/master-docs", {
        method: "POST",
        body: { name: stripped, mime: "application/pdf", data_base64: b64 },
      });
      await load();
      notify("PDF caricato", "Axon ora userà questo documento nelle sue risposte.");
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
          <Text style={styles.headerTitle}>Documenti Axon</Text>
          <Text style={styles.headerSub}>La base di conoscenza personale</Text>
        </View>
      </View>

      {/* Info box */}
      <View style={styles.infoBox}>
        <View style={styles.infoIconWrap}>
          <Ionicons name="bulb" size={16} color="#B45309" />
        </View>
        <Text style={styles.infoTxt}>
          Carica qui i tuoi PDF (contratti, listini, brochure, procedure): Axon li leggerà e li
          userà per rispondere in modo preciso alle tue domande e a quelle dei tuoi collaboratori.
        </Text>
      </View>

      {!isMaster && (
        <View style={styles.readonlyBox}>
          <Ionicons name="lock-closed" size={14} color="#64748B" />
          <Text style={styles.readonlyTxt}>
            Solo il Master può caricare o eliminare documenti. Ma Axon userà comunque quelli caricati
            dal tuo Master per rispondere alle tue domande.
          </Text>
        </View>
      )}

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 12 }}>
        {loading && (
          <View style={{ alignItems: "center", paddingVertical: 40 }}>
            <ActivityIndicator color={theme.color.brandPrimary} />
          </View>
        )}

        {!loading && items.length === 0 && (
          <View style={styles.emptyBox}>
            <Ionicons name="documents-outline" size={40} color="#94A3B8" />
            <Text style={styles.emptyTitle}>Nessun documento caricato</Text>
            <Text style={styles.emptyTxt}>
              {isMaster
                ? "Tocca «Carica PDF» per aggiungere il primo documento."
                : "Il tuo Master non ha ancora caricato documenti Axon."}
            </Text>
          </View>
        )}

        {!loading &&
          items.map((d) => (
            <View key={d.doc_id} style={styles.docCard} testID={`doc-${d.doc_id}`}>
              <View style={styles.docIcon}>
                <Ionicons name="document-text" size={22} color="#7C3AED" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.docName} numberOfLines={2}>{d.name}</Text>
                <View style={styles.docMeta}>
                  <Text style={styles.docMetaTxt}>
                    {d.total_pages ? `${d.total_pages} pag` : ""}
                    {d.total_pages && d.total_chunks ? " · " : ""}
                    {d.total_chunks ? `${d.total_chunks} chunk` : ""}
                    {(d.total_pages || d.total_chunks) && d.size ? " · " : ""}
                    {d.size ? fmtSize(d.size) : ""}
                  </Text>
                  {d.created_at && (
                    <Text style={styles.docMetaTxt}>· {fmtDate(d.created_at)}</Text>
                  )}
                </View>
              </View>
              {isMaster && (
                <Pressable
                  onPress={() => void remove(d)}
                  hitSlop={8}
                  style={styles.docDelBtn}
                  testID={`doc-del-${d.doc_id}`}
                  accessibilityLabel="Elimina documento"
                >
                  <Ionicons name="trash" size={18} color="#DC2626" />
                </Pressable>
              )}
            </View>
          ))}
      </ScrollView>

      {/* Upload FAB — Master only */}
      {isMaster && (
        <Pressable
          onPress={upload}
          disabled={uploading}
          style={[styles.fab, { bottom: 96 + bottomPad - 24 }, uploading && { opacity: 0.6 }]}
          testID="doc-upload-fab"
        >
          {uploading ? (
            <ActivityIndicator size="small" color="#FFF" />
          ) : (
            <>
              <Ionicons name="cloud-upload" size={20} color="#FFF" />
              <Text style={styles.fabTxt}>Carica PDF</Text>
            </>
          )}
        </Pressable>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: "#7C3AED",
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
    backgroundColor: "#FEF3C7",
    borderColor: "#FDE68A",
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    alignItems: "flex-start",
  },
  infoIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#FEF3C7",
    borderColor: "#FDE68A",
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  infoTxt: { flex: 1, fontSize: 12, color: "#78350F", lineHeight: 17 },
  readonlyBox: {
    marginTop: 8,
    marginHorizontal: 16,
    flexDirection: "row",
    gap: 8,
    backgroundColor: "#F1F5F9",
    borderRadius: 12,
    padding: 10,
    alignItems: "center",
  },
  readonlyTxt: { flex: 1, fontSize: 11, color: "#475569", lineHeight: 16 },
  emptyBox: {
    alignItems: "center",
    gap: 6,
    padding: 32,
    backgroundColor: "#FFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderStyle: "dashed",
  },
  emptyTitle: { fontSize: 15, fontWeight: "700", color: "#334155", marginTop: 8 },
  emptyTxt: { fontSize: 12, color: "#64748B", textAlign: "center", maxWidth: 260 },
  docCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#FFF",
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: "#EEF2F7",
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
    backgroundColor: "#F3E8FF",
    alignItems: "center",
    justifyContent: "center",
  },
  docName: { fontSize: 14, fontWeight: "700", color: "#0F172A" },
  docMeta: { flexDirection: "row", flexWrap: "wrap", marginTop: 2 },
  docMetaTxt: { fontSize: 11, color: "#64748B", marginRight: 4 },
  docDelBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#FEE2E2",
    alignItems: "center",
    justifyContent: "center",
  },
  fab: {
    position: "absolute",
    bottom: 96, // clear the bottom tab bar + Axon FAB
    right: 24,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 999,
    backgroundColor: "#7C3AED",
    shadowColor: "#7C3AED",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
  },
  fabTxt: { color: "#FFF", fontWeight: "800", fontSize: 14, letterSpacing: -0.2 },
});

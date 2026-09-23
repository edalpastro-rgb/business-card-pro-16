/**
 * V50.w — Import massivo Script da cartella Google Drive
 *
 * Flow:
 *  1) Naviga le cartelle Drive con breadcrumb (root iniziale)
 *  2) Ricerca globale come nel picker principale
 *  3) Tap "Importa questa cartella" → chiama /api/axon/scripts/import/drive
 *  4) Mostra risultato (file processati, script importati, errori) e torna indietro
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, FlatList, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useInsetsSafe } from "@/src/hooks/useSafeBottom";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

const GD_GREEN = "#0F9D58";

type Folder = { id: string; name: string; path?: string };
type Crumb = { id: string; name: string };

export default function AxonScriptsImportScreen() {
  const router = useRouter();
  const insets = useInsetsSafe(); // V50.z165 — fallback bottom dentro Modal
  const bottomInset = Math.max(insets.bottom, 12);

  const [crumbs, setCrumbs] = useState<Crumb[]>([{ id: "root", name: "My Drive" }]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [isGlobal, setIsGlobal] = useState(false);
  const [importing, setImporting] = useState<Folder | null>(null);
  const [status, setStatus] = useState("");
  const searchTimer = useRef<any>(null);

  const currentParent = crumbs[crumbs.length - 1];

  const load = useCallback(async (parentId: string, q?: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ parent: parentId });
      if (q?.trim()) params.set("q", q.trim());
      const r = await api<{ folders: Folder[]; global_search?: boolean }>(`/google-drive/folders/browse?${params.toString()}`);
      setFolders(Array.isArray(r?.folders) ? r.folders : []);
      setIsGlobal(!!r?.global_search);
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile leggere le cartelle Drive");
      setFolders([]);
      setIsGlobal(false);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load(currentParent.id);
    setQuery("");
  }, [currentParent.id, load]);

  const onSearch = (t: string) => {
    setQuery(t);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => load(currentParent.id, t), 350);
  };

  const enter = (f: Folder) => setCrumbs((prev) => [...prev, { id: f.id, name: f.name }]);
  const goCrumb = (i: number) => setCrumbs((prev) => prev.slice(0, i + 1));

  const startImport = (f: Folder) => {
    Alert.alert(
      "Importa da questa cartella?",
      `Axon leggerà tutti i file supportati (PDF/DOCX/TXT/Google Docs) dentro "${f.name}" e ti creerà gli script automaticamente.`,
      [
        { text: "Annulla", style: "cancel" },
        {
          text: "Importa tutto", onPress: async () => {
            setImporting(f);
            setStatus("Sto leggendo la cartella…");
            try {
              const r = await api<any>("/axon/scripts/import/drive", {
                method: "POST",
                body: { folder_id: f.id, folder_name: f.name },
              });
              const files = r?.files_processed || 0;
              const scripts = r?.scripts_imported || 0;
              const errs = (r?.errors || []).length;
              if (scripts > 0) {
                notify("Import completato ✅", `${scripts} script da ${files} file. Errori: ${errs}`);
              } else if (r?.message) {
                notify("Nessun import", r.message);
              } else {
                notify("Nessuno script creato", `${errs} file con errori. Controlla che siano PDF/DOCX/TXT/Google Docs con testo leggibile.`);
              }
              router.back();
            } catch (e: any) {
              notify("Errore import", e?.message || String(e));
              setImporting(null);
            }
          }
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.hBtn}>
          <Ionicons name="chevron-back" size={24} color="#FFF" />
        </Pressable>
        <Text style={styles.hTitle}>📥 Importa da Drive</Text>
        <View style={{ width: 30 }} />
      </View>

      {/* Breadcrumb */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.crumbBar} contentContainerStyle={{ paddingHorizontal: 12, gap: 6, alignItems: "center" }}>
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <React.Fragment key={c.id + i}>
              <Pressable onPress={() => !last && goCrumb(i)} style={[styles.crumb, last && styles.crumbActive]}>
                {i === 0 ? <Ionicons name="home" size={14} color={last ? "#FFF" : HT.muted} /> : null}
                <Text style={[styles.crumbTxt, last && styles.crumbTxtActive]} numberOfLines={1}>{c.name}</Text>
              </Pressable>
              {!last && <Ionicons name="chevron-forward" size={14} color={HT.muted} />}
            </React.Fragment>
          );
        })}
      </ScrollView>

      {/* Search */}
      <View style={styles.searchBox}>
        <Ionicons name="search" size={18} color={HT.muted} />
        <TextInput
          value={query}
          onChangeText={onSearch}
          placeholder="Cerca cartelle in tutto il Drive…"
          placeholderTextColor={HT.muted}
          style={styles.searchInput}
          autoCorrect={false}
          autoCapitalize="none"
        />
        {query.length > 0 && (
          <Pressable onPress={() => onSearch("")} hitSlop={10}>
            <Ionicons name="close-circle" size={18} color={HT.muted} />
          </Pressable>
        )}
      </View>

      {isGlobal && !loading && folders.length > 0 && (
        <View style={styles.globalHint}>
          <Ionicons name="globe-outline" size={13} color={GD_GREEN} />
          <Text style={styles.globalHintTxt}>Ricerca globale · {folders.length} risultati</Text>
        </View>
      )}

      {/* Info banner */}
      <View style={styles.infoBanner}>
        <Ionicons name="information-circle" size={18} color={GD_GREEN} />
        <Text style={styles.infoTxt}>
          Tocca il pulsante <Text style={{fontWeight:"900"}}>Importa</Text> di una cartella. Axon leggerà tutti i file (fino a 30) e creerà gli script automaticamente.
        </Text>
      </View>

      <View style={{ flex: 1 }}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={GD_GREEN} size="large" />
          </View>
        ) : folders.length === 0 ? (
          <View style={styles.center}>
            <Ionicons name="folder-open-outline" size={40} color={HT.muted} />
            <Text style={styles.centerTxt}>{query ? "Nessuna cartella trovata." : "Nessuna sottocartella qui."}</Text>
          </View>
        ) : (
          <FlatList
            data={folders}
            keyExtractor={(f) => f.id}
            contentContainerStyle={{ paddingBottom: 40 + bottomInset }}
            ItemSeparatorComponent={() => <View style={styles.sep} />}
            renderItem={({ item }) => (
              <View style={styles.row}>
                <Pressable onPress={() => enter(item)} style={styles.rowMain}>
                  <Ionicons name="folder" size={22} color={GD_GREEN} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowName} numberOfLines={1}>{item.name}</Text>
                    {!!item.path && <Text style={styles.rowPath} numberOfLines={1}>{item.path}</Text>}
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={HT.muted} />
                </Pressable>
                <Pressable onPress={() => startImport(item)} style={styles.importBtn}>
                  <Ionicons name="cloud-download" size={14} color="#FFF" />
                  <Text style={styles.importBtnTxt}>Importa</Text>
                </Pressable>
              </View>
            )}
          />
        )}
      </View>

      {/* Importing overlay */}
      {importing && (
        <View style={styles.overlay}>
          <View style={styles.overlayCard}>
            <ActivityIndicator size="large" color={GD_GREEN} />
            <Text style={styles.overlayTitle}>Importo da &quot;{importing.name}&quot;</Text>
            <Text style={styles.overlayTxt}>{status || "Elaboro i file con Axon…"}</Text>
            <Text style={styles.overlaySub}>Può richiedere qualche minuto per cartelle grandi. Non chiudere l&apos;app.</Text>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0F2438' },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 10, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.08)",
  },
  hBtn: { padding: 6, minWidth: 30 },
  hTitle: { color: "#FFF", fontSize: 16, fontWeight: "900" },
  crumbBar: {
    maxHeight: 44, backgroundColor: '#0B1B2C',
    borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.06)",
  },
  crumb: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  crumbActive: { backgroundColor: GD_GREEN },
  crumbTxt: { color: HT.muted, fontSize: 12, fontWeight: "700", maxWidth: 130 },
  crumbTxtActive: { color: "#FFF" },
  searchBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: 12, marginTop: 10, marginBottom: 6,
    paddingHorizontal: 12, height: 42, borderRadius: 12, backgroundColor: HT.card,
  },
  searchInput: { flex: 1, fontSize: 14, color: HT.text },
  globalHint: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 6,
    backgroundColor: "rgba(15,157,88,0.12)",
    marginHorizontal: 12, marginBottom: 4, borderRadius: 8,
  },
  globalHintTxt: { color: GD_GREEN, fontSize: 12, fontWeight: "700" },
  infoBanner: {
    flexDirection: "row", gap: 8, alignItems: "flex-start",
    marginHorizontal: 12, marginBottom: 8, padding: 10, borderRadius: 10,
    backgroundColor: "rgba(15,157,88,0.12)", borderWidth: 1, borderColor: "rgba(15,157,88,0.35)",
  },
  infoTxt: { flex: 1, color: "rgba(255,255,255,0.85)", fontSize: 12, lineHeight: 17 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 30, gap: 8 },
  centerTxt: { color: "rgba(255,255,255,0.75)", fontSize: 13, textAlign: "center" },
  row: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 10, backgroundColor: HT.card,
  },
  rowMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  rowName: { color: HT.text, fontWeight: "600", fontSize: 14 },
  rowPath: { fontSize: 11, color: HT.muted, marginTop: 2 },
  importBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 8, borderRadius: 999,
    backgroundColor: GD_GREEN,
  },
  importBtnTxt: { color: "#FFF", fontWeight: "900", fontSize: 11 },
  sep: { height: 1, backgroundColor: HT.border, marginLeft: 44 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.7)",
    alignItems: "center", justifyContent: "center", padding: 24,
  },
  overlayCard: {
    backgroundColor: '#0F2438', padding: 26, borderRadius: 16,
    alignItems: "center", gap: 10, maxWidth: 320,
    borderWidth: 1, borderColor: "rgba(15,157,88,0.4)",
  },
  overlayTitle: { color: "#FFF", fontWeight: "900", fontSize: 15, textAlign: "center" },
  overlayTxt: { color: "rgba(255,255,255,0.85)", fontSize: 13, textAlign: "center" },
  overlaySub: { color: "rgba(255,255,255,0.6)", fontSize: 11, textAlign: "center", marginTop: 4 },
});

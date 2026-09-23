/**
 * V50.t — Picker CARTELLE Drive NATIVO (RN, non WebView).
 *
 * Motivazione: il Google Picker web è inutilizzabile su mobile per
 *   selezionare cartelle (tap = navigazione dentro, checkbox invisibile).
 * Soluzione: costruiamo un picker nativo che usa Drive API via il nostro
 *   backend (endpoint /api/google-drive/folders/browse) con navigazione
 *   a breadcrumb + checkbox chiaro per multi-selezione.
 *
 * Flusso:
 *   1) Utente entra al livello "root" (My Drive)
 *   2) Vede le cartelle figlie
 *   3) Tap ROW → naviga dentro (breadcrumb si aggiorna)
 *   4) Tap CHECKBOX o pulsante ➕ → aggiunge alla selezione
 *   5) In fondo, sticky bar "Salva N cartelle"
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  ScrollView,
  FlatList,
  TextInput,
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

export default function GoogleDrivePickerNative() {
  const router = useRouter();
  const insets = useInsetsSafe(); // V50.z165 — fallback bottom dentro Modal
  const bottomInset = Math.max(insets.bottom, 16);

  // Breadcrumb: primo elemento sempre "root"
  const [crumbs, setCrumbs] = useState<Crumb[]>([{ id: "root", name: "My Drive" }]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [isGlobalSearch, setIsGlobalSearch] = useState(false);
  const [selected, setSelected] = useState<Record<string, Folder>>({});
  const [saving, setSaving] = useState(false);
  // Debounce ricerca
  const searchTimer = useRef<any>(null);

  const currentParent = crumbs[crumbs.length - 1];

  const load = useCallback(async (parentId: string, q?: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ parent: parentId });
      if (q?.trim()) params.set("q", q.trim());
      const r = await api<{ folders: Folder[]; global_search?: boolean }>(`/google-drive/folders/browse?${params.toString()}`);
      setFolders(Array.isArray(r?.folders) ? r.folders : []);
      setIsGlobalSearch(!!r?.global_search);
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile leggere le cartelle Drive");
      setFolders([]);
      setIsGlobalSearch(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Ricarica quando cambia il parent
    load(currentParent.id);
    setQuery(""); // reset ricerca al cambio livello
  }, [currentParent.id, load]);

  const onSearchChange = (txt: string) => {
    setQuery(txt);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      load(currentParent.id, txt);
    }, 350);
  };

  const enterFolder = (f: Folder) => {
    setCrumbs((prev) => [...prev, { id: f.id, name: f.name }]);
  };

  const goToCrumb = (index: number) => {
    setCrumbs((prev) => prev.slice(0, index + 1));
  };

  const toggleSelect = (f: Folder) => {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[f.id]) delete next[f.id];
      else next[f.id] = f;
      return next;
    });
  };

  const selectedList = useMemo(() => Object.values(selected), [selected]);

  const save = async () => {
    if (selectedList.length === 0) return;
    setSaving(true);
    try {
      const r = await api<{ added: number }>("/google-drive/folders", {
        method: "POST",
        body: { folders: selectedList.map((f) => ({ id: f.id, name: f.name })) },
      });
      notify("Cartelle salvate ✅", `${r?.added ?? selectedList.length} cartella/e aggiunta/e ad Axon`);
      router.back();
    } catch (e: any) {
      notify("Errore", e?.message || "Salvataggio fallito");
    } finally {
      setSaving(false);
    }
  };

  const renderFolder = ({ item }: { item: Folder }) => {
    const isSelected = !!selected[item.id];
    return (
      <View style={[styles.row, isSelected && styles.rowSelected]}>
        {/* Checkbox / area di selezione */}
        <Pressable onPress={() => toggleSelect(item)} hitSlop={10} style={styles.checkBox}>
          <Ionicons
            name={isSelected ? "checkbox" : "square-outline"}
            size={26}
            color={isSelected ? GD_GREEN : HT.muted}
          />
        </Pressable>
        {/* Nome + tap = naviga dentro */}
        <Pressable style={styles.rowMain} onPress={() => enterFolder(item)}>
          <Ionicons name="folder" size={22} color={GD_GREEN} />
          <View style={{ flex: 1 }}>
            <Text style={styles.rowName} numberOfLines={1}>
              {item.name}
            </Text>
            {!!item.path && (
              <Text style={styles.rowPath} numberOfLines={1}>
                {item.path}
              </Text>
            )}
          </View>
          <Ionicons name="chevron-forward" size={20} color={HT.muted} />
        </Pressable>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="close" size={26} color="#FFF" />
        </Pressable>
        <Text style={styles.headerTitle}>Scegli cartelle Axon</Text>
        <View style={{ width: 26 }} />
      </View>

      {/* Breadcrumb */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.crumbBar}
        contentContainerStyle={{ paddingHorizontal: 12, gap: 6, alignItems: "center" }}
      >
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <React.Fragment key={c.id + i}>
              <Pressable
                onPress={() => !last && goToCrumb(i)}
                style={[styles.crumb, last && styles.crumbActive]}
              >
                {i === 0 ? (
                  <Ionicons name="home" size={14} color={last ? "#FFF" : HT.muted} />
                ) : null}
                <Text style={[styles.crumbTxt, last && styles.crumbTxtActive]} numberOfLines={1}>
                  {c.name}
                </Text>
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
          onChangeText={onSearchChange}
          placeholder="Cerca cartelle in tutto il Drive…"
          placeholderTextColor={HT.muted}
          style={styles.searchInput}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
        />
        {query.length > 0 && (
          <Pressable onPress={() => onSearchChange("")} hitSlop={10}>
            <Ionicons name="close-circle" size={18} color={HT.muted} />
          </Pressable>
        )}
      </View>

      {isGlobalSearch && !loading && folders.length > 0 && (
        <View style={styles.globalHint}>
          <Ionicons name="globe-outline" size={13} color="#0F9D58" />
          <Text style={styles.globalHintTxt}>
            Ricerca globale · {folders.length} risultat{folders.length === 1 ? "o" : "i"}
          </Text>
        </View>
      )}

      {/* Lista */}
      <View style={{ flex: 1 }}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={GD_GREEN} size="large" />
            <Text style={styles.centerTxt}>Caricamento cartelle…</Text>
          </View>
        ) : folders.length === 0 ? (
          <View style={styles.center}>
            <Ionicons name="folder-open-outline" size={40} color={HT.muted} />
            <Text style={styles.centerTxt}>
              {query ? "Nessuna cartella trovata." : "Questa cartella non contiene sottocartelle."}
            </Text>
            {crumbs.length === 1 && (
              <Text style={[styles.centerTxt, { fontSize: 11, color: HT.muted }]}>
                Suggerimento: se non vedi cartelle, verifica di aver dato accesso al Drive giusto in Impostazioni → Google Drive.
              </Text>
            )}
          </View>
        ) : (
          <FlatList
            data={folders}
            keyExtractor={(f) => f.id}
            renderItem={renderFolder}
            contentContainerStyle={{ paddingBottom: 140 + bottomInset }}
            ItemSeparatorComponent={() => <View style={styles.sep} />}
          />
        )}
      </View>

      {/* Sticky footer */}
      <View style={[styles.footer, { paddingBottom: bottomInset + 10 }]}>
        <View style={styles.footerInfo}>
          <Ionicons name="checkbox" size={18} color={GD_GREEN} />
          <Text style={styles.footerCount}>
            {selectedList.length === 0
              ? "Nessuna cartella selezionata"
              : `${selectedList.length} cartella/e selezionata/e`}
          </Text>
        </View>
        <Pressable
          onPress={save}
          disabled={selectedList.length === 0 || saving}
          style={[
            styles.saveBtn,
            (selectedList.length === 0 || saving) && { opacity: 0.5 },
          ]}
          testID="picker-save-btn"
        >
          {saving ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <>
              <Ionicons name="checkmark-circle" size={18} color="#FFF" />
              <Text style={styles.saveBtnTxt}>Salva {selectedList.length > 0 ? `(${selectedList.length})` : ""}</Text>
            </>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0F2438' },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  headerTitle: { color: "#FFF", fontSize: 16, fontWeight: "900" },
  crumbBar: {
    maxHeight: 44,
    backgroundColor: '#0B1B2C',
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  crumb: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  crumbActive: { backgroundColor: GD_GREEN },
  crumbTxt: { color: HT.muted, fontSize: 12, fontWeight: "700", maxWidth: 130 },
  crumbTxtActive: { color: "#FFF" },
  searchBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: 12, marginTop: 10, marginBottom: 6,
    paddingHorizontal: 12,
    height: 42, borderRadius: 12,
    backgroundColor: HT.card,
  },
  searchInput: { flex: 1, fontSize: 14, color: HT.text },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 30, gap: 8 },
  centerTxt: { color: "rgba(255,255,255,0.75)", fontSize: 13, textAlign: "center" },
  row: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 12,
    backgroundColor: HT.card,
  },
  rowSelected: { backgroundColor: HT.successTint },
  checkBox: { padding: 4 },
  rowMain: {
    flex: 1, flexDirection: "row", alignItems: "center", gap: 10,
    paddingVertical: 4,
  },
  rowName: { flex: 1, fontSize: 14, color: HT.text, fontWeight: "600" },
  rowPath: { fontSize: 11, color: HT.muted, marginTop: 2 },
  sep: { height: 1, backgroundColor: HT.border, marginLeft: 44 },
  globalHint: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 6,
    backgroundColor: "rgba(15,157,88,0.12)",
    marginHorizontal: 12, marginBottom: 4,
    borderRadius: 8,
  },
  globalHintTxt: { color: "#0F9D58", fontSize: 12, fontWeight: "700" },
  footer: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    paddingHorizontal: 14, paddingTop: 10,
    backgroundColor: "rgba(15,36,56,0.98)",
    borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)",
    gap: 10,
  },
  footerInfo: { flexDirection: "row", alignItems: "center", gap: 8 },
  footerCount: { color: "rgba(255,255,255,0.85)", fontSize: 12.5, fontWeight: "700", flex: 1 },
  saveBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 14, borderRadius: 999,
    backgroundColor: GD_GREEN,
    shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  saveBtnTxt: { color: "#FFF", fontWeight: "900", fontSize: 14, letterSpacing: 0.3 },
});

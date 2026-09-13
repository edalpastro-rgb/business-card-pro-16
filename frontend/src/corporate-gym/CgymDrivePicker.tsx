// CgymDrivePicker.tsx — V50.z203 — Browser Drive del Master (cartelle E file) per il Pannello Master Coach.
// Naviga livello per livello, cerca globalmente, seleziona una CARTELLA («Collega questa cartella») o un FILE (tap → collega).
import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, Modal, TextInput, ActivityIndicator, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/src/theme";
import { cgymManualsApi, CgymManualFile, CgymManualRef } from "@/src/corporate-gym/manualsApi";

type Crumb = { id: string; name: string };

export function fileIcon(f: { mime?: string | null; is_folder?: boolean }): any {
  if (f.is_folder) return "folder";
  const m = f.mime || "";
  if (m.includes("pdf")) return "document-text";
  if (m.startsWith("image/")) return "image";
  if (m.includes("spreadsheet") || m.includes("sheet") || m.includes("csv")) return "grid";
  if (m.includes("presentation")) return "easel";
  if (m.includes("document") || m.includes("word")) return "document";
  if (m.startsWith("video/")) return "videocam";
  if (m.startsWith("audio/")) return "musical-notes";
  return "document-attach";
}

export function CgymDrivePicker({ visible, title, onClose, onPick, allowFiles = true, allowFolders = true }: {
  visible: boolean; title: string; onClose: () => void; onPick: (ref: CgymManualRef) => void; allowFiles?: boolean; allowFolders?: boolean;
}) {
  const [crumbs, setCrumbs] = useState<Crumb[]>([{ id: "root", name: "Il mio Drive" }]);
  const [items, setItems] = useState<CgymManualFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [global, setGlobal] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cur = crumbs[crumbs.length - 1];

  const load = useCallback(async (parent: string, query?: string) => {
    setLoading(true); setError(null);
    try {
      const r = await cgymManualsApi.browse(parent, query);
      setItems(r.items || []); setGlobal(!!r.global_search);
    } catch (e: any) { setError(e?.message || "Errore Drive"); setItems([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (visible) { setQ(""); void load(cur.id); } }, [visible, cur.id, load]);
  const onSearch = (txt: string) => {
    setQ(txt);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void load(cur.id, txt.trim() || undefined), 350);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={styles.sheet} testID="cgym-drive-picker">
          <View style={styles.head}>
            <Text style={styles.title} numberOfLines={1}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={10} testID="cgym-drive-picker-close"><Ionicons name="close" size={22} color={theme.color.onSurface} /></Pressable>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.crumbs}>
            {crumbs.map((c, i) => (
              <Pressable key={c.id} onPress={() => setCrumbs(crumbs.slice(0, i + 1))} style={styles.crumb} testID={`cgym-drive-crumb-${i}`}>
                <Text style={[styles.crumbTxt, i === crumbs.length - 1 && { fontWeight: "800", color: theme.color.onSurface }]} numberOfLines={1}>{c.name}</Text>
                {i < crumbs.length - 1 && <Ionicons name="chevron-forward" size={12} color={theme.color.muted} />}
              </Pressable>
            ))}
          </ScrollView>
          <View style={styles.search}>
            <Ionicons name="search" size={16} color={theme.color.muted} />
            <TextInput value={q} onChangeText={onSearch} placeholder="Cerca in tutto il Drive…" placeholderTextColor={theme.color.muted} style={styles.searchInput} testID="cgym-drive-search" />
          </View>
          {allowFolders && !global && (
            <Pressable onPress={() => onPick({ kind: "folder", id: cur.id, name: cur.name })} style={styles.pickFolder} testID="cgym-drive-pick-folder">
              <Ionicons name="folder-open" size={18} color="#FFF" />
              <Text style={styles.pickFolderTxt}>Collega questa cartella «{cur.name}» (tutti i file, anche nella radice)</Text>
            </Pressable>
          )}
          <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={{ paddingBottom: 12 }}>
            {loading ? <ActivityIndicator color={theme.color.brandPrimary} style={{ marginVertical: 20 }} /> : error ? (
              <Text style={styles.msg}>{error}</Text>
            ) : items.length === 0 ? (
              <Text style={styles.msg}>{q.trim() ? "Nessun risultato." : "Cartella vuota."}</Text>
            ) : items.map((f) => (
              <Pressable
                key={f.id}
                onPress={() => {
                  if (f.is_folder) { setCrumbs([...crumbs, { id: f.id, name: f.name }]); setQ(""); }
                  else if (allowFiles) onPick({ kind: "file", id: f.id, name: f.name, mime: f.mime });
                }}
                style={styles.row}
                testID={`cgym-drive-item-${f.id}`}
              >
                <Ionicons name={fileIcon(f)} size={20} color={f.is_folder ? "#F59E0B" : theme.color.brandPrimary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName} numberOfLines={1}>{f.name}</Text>
                  <Text style={styles.rowSub}>{f.is_folder ? "Cartella · apri" : `${(f.mime || "").split("/").pop()?.split(".").pop() || "file"}${f.size ? ` · ${(f.size / 1024 / 1024).toFixed(1)} MB` : ""} · tocca per collegare`}</Text>
                </View>
                <Ionicons name={f.is_folder ? "chevron-forward" : "link"} size={16} color={theme.color.muted} />
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { backgroundColor: theme.color.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 14, gap: 10, maxHeight: "88%" },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { flex: 1, fontSize: 16, fontWeight: "800", color: theme.color.onSurface },
  crumbs: { flexDirection: "row", alignItems: "center", gap: 4 },
  crumb: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 32, maxWidth: 160 },
  crumbTxt: { fontSize: 12.5, color: theme.color.muted },
  search: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: theme.color.border, borderRadius: 12, paddingHorizontal: 10, minHeight: 42 },
  searchInput: { flex: 1, fontSize: 14, color: theme.color.onSurface, paddingVertical: 8 },
  pickFolder: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#F59E0B", borderRadius: 12, padding: 10, minHeight: 44 },
  pickFolderTxt: { flex: 1, color: "#FFF", fontWeight: "800", fontSize: 12.5 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 50, borderBottomWidth: 1, borderBottomColor: theme.color.border, paddingVertical: 6 },
  rowName: { fontSize: 14, fontWeight: "700", color: theme.color.onSurface },
  rowSub: { fontSize: 11.5, color: theme.color.muted },
  msg: { textAlign: "center", color: theme.color.muted, fontSize: 13, marginVertical: 16 },
});

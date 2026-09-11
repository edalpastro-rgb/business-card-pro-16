// Corporate Gym — Manuali Google Drive: configurazione (SOLO Master) della cartella principale "Corporate Gym"
// con sottocartelle Obiezioni / WIN-WIN. Browser cartelle nativo via /google-drive/folders/browse (Drive del Master).
import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { theme } from "@/src/theme";
import { notify, confirmAsync } from "@/src/utils/notify";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { CgymHeaderBanner } from "@/src/corporate-gym/CgymHeaderBanner";
import { CGYM_ORANGE, CgymType } from "@/src/corporate-gym/api";
import { cgymManualsApi, CgymManualsConfig, DriveFolder, fmtManualDate } from "@/src/corporate-gym/manualsApi";

const GD_GREEN = "#0F9D58";
type Crumb = { id: string; name: string };

export default function CgymManualsConfigScreen() {
  const router = useRouter();
  const pagePad = usePageBottomPadding();
  const [cfg, setCfg] = useState<CgymManualsConfig | null>(null);
  const [drive, setDrive] = useState<{ connected: boolean; configured: boolean; google_email?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Browser cartelle
  const [picking, setPicking] = useState(false);
  const [crumbs, setCrumbs] = useState<Crumb[]>([{ id: "root", name: "My Drive" }]);
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [fLoading, setFLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [isGlobal, setIsGlobal] = useState(false);
  const timer = useRef<any>(null);
  const parent = crumbs[crumbs.length - 1];

  const load = useCallback(async () => {
    try {
      const [c, d] = await Promise.all([cgymManualsApi.config(), cgymManualsApi.driveStatus().catch(() => ({ connected: false, configured: false }))]);
      setCfg(c);
      setDrive(d);
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile leggere la configurazione");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const browse = useCallback(async (parentId: string, q?: string) => {
    setFLoading(true);
    try {
      const r = await cgymManualsApi.browseFolders(parentId, q?.trim() || undefined);
      setFolders(Array.isArray(r?.folders) ? r.folders : []);
      setIsGlobal(!!r?.global_search);
    } catch (e: any) {
      notify("Google Drive", e?.message || "Impossibile leggere le cartelle");
      setFolders([]);
    } finally {
      setFLoading(false);
    }
  }, []);

  useEffect(() => {
    if (picking) { setQuery(""); browse(parent.id); }
  }, [picking, parent.id, browse]);

  const onSearch = (txt: string) => {
    setQuery(txt);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => browse(parent.id, txt), 350);
  };

  const choose = async (f: DriveFolder) => {
    const ok = await confirmAsync("Cartella Corporate Gym", `Usare «${f.name}» come cartella principale dei manuali? Le sottocartelle Obiezioni e WIN-WIN verranno rilevate automaticamente.`);
    if (!ok) return;
    setSaving(true);
    try {
      const r = await cgymManualsApi.setConfig({ folder_id: f.id, folder_name: f.name });
      setCfg(r);
      setPicking(false);
      setCrumbs([{ id: "root", name: "My Drive" }]);
      const missing = r.missing_subfolders || [];
      if (missing.length) {
        notify("Cartella salvata", `Attenzione: non trovo la sottocartella ${missing.map((t) => (t === "obiezioni" ? "«Obiezioni»" : "«WIN-WIN»")).join(" e ")}. Creala su Drive dentro «${f.name}»: verrà riconosciuta automaticamente.`);
      } else {
        notify("Cartella salvata ✅", "Sottocartelle Obiezioni e WIN-WIN rilevate. I manuali sono disponibili a tutto il team.");
      }
    } catch (e: any) {
      notify("Errore", e?.message || "Salvataggio fallito");
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    const ok = await confirmAsync("Rimuovere la cartella?", "I collaboratori non vedranno più i manuali finché non ne imposti una nuova.");
    if (!ok) return;
    try {
      await cgymManualsApi.clearConfig();
      await load();
    } catch (e: any) {
      notify("Errore", e?.message || "Operazione non riuscita");
    }
  };

  const subLabel = (t: CgymType) => (t === "obiezioni" ? "Obiezioni" : "WIN-WIN");

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable testID="cgym-man-back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/corporate-gym" as any))} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.title}>Manuali · Google Drive</Text>
        <View style={{ width: 26 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: pagePad }} keyboardShouldPersistTaps="handled">
        <CgymHeaderBanner subtitle="Manuali" />

        {loading || !cfg ? (
          <ActivityIndicator color={CGYM_ORANGE} style={{ marginTop: 30 }} />
        ) : !cfg.can_edit ? (
          <View style={styles.card} testID="cgym-man-readonly">
            <Ionicons name="lock-closed" size={22} color={theme.color.muted} />
            <Text style={styles.cardSub}>Solo il Master può modificare la cartella dei manuali.</Text>
          </View>
        ) : (
          <>
            {/* Stato Drive del Master */}
            <View style={styles.card} testID="cgym-man-drive">
              <View style={styles.rowHead}>
                <Ionicons name="logo-google" size={18} color={GD_GREEN} />
                <Text style={styles.cardTitle}>Google Drive del Master</Text>
                <View style={[styles.dot, { backgroundColor: drive?.connected ? GD_GREEN : theme.color.error }]} />
              </View>
              <Text style={styles.cardSub}>
                {drive?.connected
                  ? `Collegato${drive.google_email ? ` (${drive.google_email})` : ""}. I collaboratori leggono i manuali tramite il tuo Drive: non serve che colleghino il loro.`
                  : "Non collegato. Collega il tuo Google Drive per rendere disponibili i manuali a tutto il team."}
              </Text>
              {!drive?.connected && (
                <Pressable onPress={() => router.push("/google-drive" as any)} style={[styles.btn, { backgroundColor: GD_GREEN }]} testID="cgym-man-connect-drive">
                  <Ionicons name="link" size={16} color="#FFF" />
                  <Text style={styles.btnTxt}>Collega Google Drive</Text>
                </Pressable>
              )}
            </View>

            {/* Cartella principale */}
            <View style={styles.card} testID="cgym-man-folder">
              <View style={styles.rowHead}>
                <Ionicons name="folder" size={18} color={CGYM_ORANGE} />
                <Text style={styles.cardTitle}>Cartella principale Corporate Gym</Text>
              </View>
              {cfg.configured ? (
                <>
                  <Text style={styles.folderName} testID="cgym-man-folder-name">{cfg.root_folder_name || cfg.root_folder_id}</Text>
                  {cfg.updated_at ? <Text style={styles.cardSub}>Impostata il {fmtManualDate(cfg.updated_at)}</Text> : null}
                  <View style={{ gap: 6, marginTop: 8 }}>
                    {cfg.types.map((t) => (
                      <View key={t.type} style={styles.subRow} testID={`cgym-man-sub-${t.type}`}>
                        <Ionicons name={t.subfolder ? "checkmark-circle" : "alert-circle"} size={18} color={t.subfolder ? GD_GREEN : theme.color.warning} />
                        <Text style={styles.subTxt}>
                          {subLabel(t.type)}: {t.subfolder ? <Text style={{ fontWeight: "800" }}>{t.subfolder.name}</Text> : "sottocartella non trovata (creala su Drive con questo nome)"}
                        </Text>
                      </View>
                    ))}
                  </View>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Pressable onPress={() => setPicking((v) => !v)} style={[styles.btn, { flex: 1 }]} testID="cgym-man-change">
                      <Ionicons name="swap-horizontal" size={16} color="#FFF" />
                      <Text style={styles.btnTxt}>{picking ? "Annulla" : "Cambia cartella"}</Text>
                    </Pressable>
                    <Pressable onPress={clear} style={[styles.btn, { backgroundColor: theme.color.surfaceTertiary }]} testID="cgym-man-clear">
                      <Ionicons name="trash-outline" size={16} color={theme.color.error} />
                    </Pressable>
                  </View>
                </>
              ) : (
                <>
                  <Text style={styles.cardSub}>
                    Scegli su Drive la cartella «Corporate Gym» che contiene le sottocartelle <Text style={{ fontWeight: "800" }}>Obiezioni</Text> e <Text style={{ fontWeight: "800" }}>WIN-WIN</Text> con i manuali PDF.
                    Basta farlo una volta: ogni aggiornamento dei file su Drive è subito visibile a tutti.
                  </Text>
                  <Pressable onPress={() => setPicking((v) => !v)} disabled={!drive?.connected} style={[styles.btn, !drive?.connected && { opacity: 0.5 }]} testID="cgym-man-pick">
                    <Ionicons name="folder-open" size={16} color="#FFF" />
                    <Text style={styles.btnTxt}>{picking ? "Annulla" : "Scegli cartella Drive"}</Text>
                  </Pressable>
                </>
              )}
            </View>

            {/* Browser cartelle */}
            {picking && (
              <View style={styles.card} testID="cgym-man-browser">
                <View style={styles.search}>
                  <Ionicons name="search" size={16} color={theme.color.muted} />
                  <TextInput value={query} onChangeText={onSearch} placeholder="Cerca cartella in tutto il Drive…" placeholderTextColor={theme.color.muted} style={styles.searchInput} testID="cgym-man-search" autoCorrect={false} />
                  {query ? <Pressable onPress={() => onSearch("")} hitSlop={8}><Ionicons name="close-circle" size={16} color={theme.color.muted} /></Pressable> : null}
                </View>
                {!isGlobal && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.crumbs}>
                    {crumbs.map((c, i) => {
                      const last = i === crumbs.length - 1;
                      return (
                        <View key={c.id} style={{ flexDirection: "row", alignItems: "center" }}>
                          {i > 0 && <Ionicons name="chevron-forward" size={14} color={theme.color.muted} />}
                          <Pressable disabled={last} onPress={() => setCrumbs((p) => p.slice(0, i + 1))} hitSlop={6}>
                            <Text style={[styles.crumb, last && styles.crumbLast]}>{c.name}</Text>
                          </Pressable>
                        </View>
                      );
                    })}
                  </ScrollView>
                )}
                {!isGlobal && parent.id !== "root" && (
                  <Pressable onPress={() => choose(parent)} style={[styles.btn, { backgroundColor: GD_GREEN }]} disabled={saving} testID="cgym-man-choose-current">
                    <Ionicons name="checkmark" size={16} color="#FFF" />
                    <Text style={styles.btnTxt}>Usa «{parent.name}» come cartella principale</Text>
                  </Pressable>
                )}
                {fLoading ? (
                  <ActivityIndicator color={GD_GREEN} style={{ marginVertical: 16 }} />
                ) : folders.length === 0 ? (
                  <Text style={[styles.cardSub, { textAlign: "center", marginVertical: 12 }]}>{query.trim() ? "Nessuna cartella trovata." : "Nessuna sottocartella qui."}</Text>
                ) : (
                  folders.map((f) => (
                    <View key={f.id} style={styles.fRow} testID={`cgym-man-folder-${f.id}`}>
                      <Pressable style={styles.fMain} onPress={() => { setCrumbs((p) => (isGlobal ? [{ id: "root", name: "My Drive" }, { id: f.id, name: f.name }] : [...p, { id: f.id, name: f.name }])); }}>
                        <Ionicons name="folder" size={22} color="#F59E0B" />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.fName} numberOfLines={1}>{f.name}</Text>
                          {f.path ? <Text style={styles.fPath} numberOfLines={1}>{f.path}</Text> : null}
                        </View>
                        <Ionicons name="chevron-forward" size={16} color={theme.color.muted} />
                      </Pressable>
                      <Pressable onPress={() => choose(f)} disabled={saving} style={styles.fPick} hitSlop={4} testID={`cgym-man-choose-${f.id}`} accessibilityLabel="Scegli">
                        <Ionicons name="checkmark-circle" size={26} color={GD_GREEN} />
                      </Pressable>
                    </View>
                  ))
                )}
                <Text style={styles.hint}>Tocca una cartella per entrare, il ✓ per sceglierla.</Text>
              </View>
            )}

            <View style={styles.info}>
              <Ionicons name="sparkles" size={16} color="#6D28D9" />
              <Text style={styles.infoTxt}>
                AxonOS legge i manuali direttamente da Drive quando un consulente tocca «Leggi Manuale»: nessuna copia, sempre l'ultima versione. Le sottocartelle sono riconosciute per nome (Obiezioni / WIN-WIN).
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.color.border, backgroundColor: theme.color.surfaceSecondary },
  title: { fontSize: 18, fontWeight: "800", color: theme.color.onSurface },
  card: { backgroundColor: theme.color.surfaceSecondary, borderRadius: 14, borderWidth: 1, borderColor: theme.color.border, padding: 14, marginTop: 12, gap: 8 },
  rowHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { flex: 1, fontSize: 15, fontWeight: "800", color: theme.color.onSurface },
  cardSub: { fontSize: 13, color: theme.color.muted, lineHeight: 19 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  folderName: { fontSize: 16, fontWeight: "900", color: theme.color.onSurface },
  subRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  subTxt: { flex: 1, fontSize: 13, color: theme.color.onSurface },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: CGYM_ORANGE, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, minHeight: 44, marginTop: 4 },
  btnTxt: { color: "#FFF", fontWeight: "800", fontSize: 13, flexShrink: 1 },
  search: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: theme.color.border, borderRadius: 10, paddingHorizontal: 10, backgroundColor: theme.color.surface, minHeight: 42 },
  searchInput: { flex: 1, fontSize: 14, color: theme.color.onSurface, paddingVertical: 8 },
  crumbs: { flexDirection: "row", alignItems: "center", gap: 2, paddingVertical: 4 },
  crumb: { fontSize: 13, color: theme.color.brandPrimary, fontWeight: "700", paddingHorizontal: 4 },
  crumbLast: { color: theme.color.onSurface },
  fRow: { flexDirection: "row", alignItems: "center", gap: 6, borderTopWidth: 1, borderTopColor: theme.color.divider, paddingVertical: 6 },
  fMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 },
  fName: { fontSize: 14, fontWeight: "700", color: theme.color.onSurface },
  fPath: { fontSize: 11, color: theme.color.muted, marginTop: 1 },
  fPick: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  hint: { fontSize: 11, color: theme.color.muted, textAlign: "center", marginTop: 4 },
  info: { flexDirection: "row", gap: 8, alignItems: "flex-start", marginTop: 14, padding: 12, backgroundColor: "#F5F3FF", borderRadius: 12 },
  infoTxt: { flex: 1, fontSize: 12, color: "#4C1D95", lineHeight: 18 },
});

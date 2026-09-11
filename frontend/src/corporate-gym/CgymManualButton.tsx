// Corporate Gym — bottone "Leggi Manuale" + sheet AxonOS che elenca i PDF della sottocartella Drive (letti live).
import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, Modal, TextInput, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";
import { useBottomSheetPadding } from "@/src/utils/bottomSheetInsets";
import { CgymType, CGYM_TYPE_META, CGYM_ORANGE } from "@/src/corporate-gym/api";
import { cgymManualsApi, CgymManualFile, CgymManualsList, CgymManualsConfig, fmtManualDate, fmtManualSize, openManual, downloadManual } from "@/src/corporate-gym/manualsApi";

const AXON_PURPLE = "#6D28D9";

export function CgymManualButton({ type }: { type: CgymType }) {
  const router = useRouter();
  const sheetPad = useBottomSheetPadding();
  const meta = CGYM_TYPE_META[type];
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<CgymManualsConfig | null>(null);
  const [data, setData] = useState<CgymManualsList | null>(null);
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const timer = useRef<any>(null);

  const load = useCallback(async (query?: string) => {
    setLoading(true);
    setError(null);
    try {
      const cfg = await cgymManualsApi.config();
      setConfig(cfg);
      if (!cfg.configured) { setData(null); return; }
      const r = await cgymManualsApi.list(type, query?.trim() || undefined);
      setData(r);
    } catch (e: any) {
      setError(e?.message || "Impossibile leggere i manuali da Google Drive");
    } finally {
      setLoading(false);
    }
  }, [type]);

  useEffect(() => {
    if (open) { setQ(""); load(); }
  }, [open, load]);

  const onSearch = (txt: string) => {
    setQ(txt);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => load(txt), 400);
  };

  const act = async (f: CgymManualFile, mode: "open" | "download") => {
    setBusyId(f.id + mode);
    try {
      const link = await cgymManualsApi.link(type, f.id);
      if (mode === "open") { openManual(router, link); setOpen(false); }
      else await downloadManual(link);
    } catch (e: any) {
      notify("Manuale", e?.message || "Operazione non riuscita");
    } finally {
      setBusyId(null);
    }
  };

  const goConfig = () => { setOpen(false); router.push("/corporate-gym/manuals-config" as any); };

  const items = (data?.items || []).filter((f) => !q.trim() || f.name.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <>
      <Pressable onPress={() => setOpen(true)} style={styles.btn} testID={`cgym-manual-btn-${type}`}>
        <View style={styles.btnIcon}><Ionicons name="book" size={20} color="#FFF" /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.btnTitle}>Leggi Manuale</Text>
          <Text style={styles.btnSub} numberOfLines={1}>AxonOS · manuale {meta.label} da Google Drive</Text>
        </View>
        <Ionicons name="sparkles" size={18} color={AXON_PURPLE} />
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.sheetBg}>
          <Pressable style={{ flex: 1 }} onPress={() => setOpen(false)} testID="cgym-manual-backdrop" />
          <View style={[styles.sheet, { paddingBottom: sheetPad }]} testID={`cgym-manual-sheet-${type}`}>
            <View style={styles.sheetHead}>
              <View style={styles.axonBadge}><Ionicons name="sparkles" size={14} color="#FFF" /><Text style={styles.axonBadgeTxt}>AxonOS</Text></View>
              <Text style={styles.sheetTitle} numberOfLines={1}>Manuali · {meta.label}</Text>
              <Pressable onPress={() => setOpen(false)} hitSlop={10} testID="cgym-manual-close"><Ionicons name="close" size={22} color={theme.color.onSurface} /></Pressable>
            </View>

            {config?.configured && (
              <View style={styles.search}>
                <Ionicons name="search" size={16} color={theme.color.muted} />
                <TextInput value={q} onChangeText={onSearch} placeholder="Cerca il PDF per nome…" placeholderTextColor={theme.color.muted} style={styles.searchInput} testID="cgym-manual-search" autoCorrect={false} />
                {q ? <Pressable onPress={() => onSearch("")} hitSlop={8}><Ionicons name="close-circle" size={16} color={theme.color.muted} /></Pressable> : null}
              </View>
            )}

            <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
              {loading && !data && <ActivityIndicator color={CGYM_ORANGE} style={{ marginVertical: 24 }} />}

              {!loading && error && (
                <View style={styles.msgBox} testID="cgym-manual-error">
                  <Ionicons name="cloud-offline" size={22} color={theme.color.error} />
                  <Text style={styles.msgTxt}>{error}</Text>
                  <Pressable onPress={() => load(q)} style={styles.msgBtn}><Text style={styles.msgBtnTxt}>Riprova</Text></Pressable>
                </View>
              )}

              {!loading && !error && config && !config.configured && (
                <View style={styles.msgBox} testID="cgym-manual-unconfigured">
                  <Ionicons name="folder-open" size={24} color={CGYM_ORANGE} />
                  <Text style={styles.msgTxt}>
                    {config.can_edit
                      ? "Non hai ancora impostato la cartella Google Drive «Corporate Gym» (con le sottocartelle Obiezioni e WIN-WIN)."
                      : "Il Master non ha ancora impostato la cartella Google Drive dei manuali. I manuali saranno disponibili appena configurata."}
                  </Text>
                  {config.can_edit && (
                    <Pressable onPress={goConfig} style={styles.msgBtn} testID="cgym-manual-go-config"><Text style={styles.msgBtnTxt}>Configura cartella Drive</Text></Pressable>
                  )}
                </View>
              )}

              {!loading && !error && data?.missing_subfolder && (
                <View style={styles.msgBox} testID="cgym-manual-missing-sub">
                  <Ionicons name="alert-circle" size={24} color={theme.color.warning} />
                  <Text style={styles.msgTxt}>
                    Nella cartella Drive «{data.root_folder_name || "Corporate Gym"}» non c&apos;è la sottocartella «{type === "obiezioni" ? "Obiezioni" : "WIN-WIN"}».
                    {config?.can_edit ? " Creala su Drive e riapri questa finestra." : " Segnalalo al Master."}
                  </Text>
                </View>
              )}

              {!loading && !error && data && !data.missing_subfolder && items.length === 0 && (
                <View style={styles.msgBox} testID="cgym-manual-empty">
                  <Ionicons name="document-outline" size={24} color={theme.color.muted} />
                  <Text style={styles.msgTxt}>{q.trim() ? `Nessun manuale con «${q.trim()}» nel nome.` : `Nessun PDF nella sottocartella «${data.subfolder?.name || ""}».`}</Text>
                </View>
              )}

              {items.map((f) => (
                <View key={f.id} style={styles.row} testID={`cgym-manual-row-${f.id}`}>
                  <View style={styles.rowIcon}><Ionicons name={f.exportable ? "document-text" : "document"} size={20} color="#DC2626" /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle} numberOfLines={2}>{f.name}</Text>
                    <Text style={styles.rowSub} numberOfLines={1}>
                      {[f.modified_time ? `Aggiornato ${fmtManualDate(f.modified_time)}` : null, fmtManualSize(f.size) || null].filter(Boolean).join(" · ")}
                    </Text>
                  </View>
                  <Pressable onPress={() => act(f, "download")} disabled={!!busyId} style={styles.rowBtn} hitSlop={4} testID={`cgym-manual-dl-${f.id}`} accessibilityLabel="Scarica">
                    {busyId === f.id + "download" ? <ActivityIndicator size="small" color={theme.color.brandPrimary} /> : <Ionicons name="download-outline" size={18} color={theme.color.brandPrimary} />}
                  </Pressable>
                  <Pressable onPress={() => act(f, "open")} disabled={!!busyId} style={[styles.rowBtn, styles.rowBtnOpen]} hitSlop={4} testID={`cgym-manual-open-${f.id}`} accessibilityLabel="Apri">
                    {busyId === f.id + "open" ? <ActivityIndicator size="small" color="#FFF" /> : <Ionicons name="open-outline" size={18} color="#FFF" />}
                  </Pressable>
                </View>
              ))}
            </ScrollView>

            <View style={styles.footer}>
              <Ionicons name="logo-google" size={13} color={theme.color.muted} />
              <Text style={styles.footerTxt} numberOfLines={2}>
                {data?.subfolder?.name ? `Drive › ${data.root_folder_name || "Corporate Gym"} › ${data.subfolder.name} · ` : ""}
                letti in tempo reale: vedi sempre l&apos;ultima versione.
              </Text>
              {config?.can_edit && config.configured && (
                <Pressable onPress={goConfig} hitSlop={8} testID="cgym-manual-config-link"><Ionicons name="settings-outline" size={18} color={theme.color.muted} /></Pressable>
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  btn: { flexDirection: "row", alignItems: "center", gap: 10, alignSelf: "stretch", backgroundColor: theme.color.surface, borderRadius: 14, borderWidth: 1, borderColor: theme.color.border, padding: 12, minHeight: 56, marginTop: 4 },
  btnIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: AXON_PURPLE, alignItems: "center", justifyContent: "center" },
  btnTitle: { fontSize: 14, fontWeight: "900", color: theme.color.onSurface },
  btnSub: { fontSize: 11, color: theme.color.muted, marginTop: 2 },
  sheetBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { backgroundColor: theme.color.surfaceSecondary, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16 },
  sheetHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  axonBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: AXON_PURPLE, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  axonBadgeTxt: { color: "#FFF", fontSize: 11, fontWeight: "900" },
  sheetTitle: { flex: 1, fontSize: 16, fontWeight: "800", color: theme.color.onSurface },
  search: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: theme.color.border, borderRadius: 10, paddingHorizontal: 10, backgroundColor: theme.color.surface, marginBottom: 8, minHeight: 42 },
  searchInput: { flex: 1, fontSize: 14, color: theme.color.onSurface, paddingVertical: 8 },
  msgBox: { alignItems: "center", gap: 8, padding: 18, backgroundColor: theme.color.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.color.border, marginVertical: 6 },
  msgTxt: { fontSize: 13, color: theme.color.onSurface, textAlign: "center", lineHeight: 19 },
  msgBtn: { marginTop: 4, backgroundColor: CGYM_ORANGE, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999 },
  msgBtnTxt: { color: "#FFF", fontWeight: "800", fontSize: 13 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: theme.color.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.color.border, padding: 10, marginBottom: 8 },
  rowIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: "#FEE2E2", alignItems: "center", justifyContent: "center" },
  rowTitle: { fontSize: 13, fontWeight: "700", color: theme.color.onSurface },
  rowSub: { fontSize: 11, color: theme.color.muted, marginTop: 2 },
  rowBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: theme.color.surfaceTertiary },
  rowBtnOpen: { backgroundColor: CGYM_ORANGE },
  footer: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: theme.color.divider },
  footerTxt: { flex: 1, fontSize: 11, color: theme.color.muted },
});

export default CgymManualButton;

// Corporate Gym — bottone "Leggi Manuale" + sheet AxonOS che elenca i PDF della sottocartella Drive (letti live).
import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, Modal, TextInput, ActivityIndicator, ScrollView } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller"; // V50.z374 — behavior "padding" valido su iOS e Android
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { notify } from "@/src/utils/notify";
import { useBottomSheetPadding } from "@/src/utils/bottomSheetInsets";
import { CgymType, CGYM_TYPE_META, CGYM_ORANGE } from "@/src/corporate-gym/api";
import { fileIcon } from "@/src/corporate-gym/CgymDrivePicker";
import { cgymManualsApi, CgymManualRef, CgymManualFile, CgymManualLink, CgymManualsList, CgymManualsConfig, fmtManualDate, fmtManualSize, downloadManual, openManual } from "@/src/corporate-gym/manualsApi";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

const AXON_PURPLE = HT.violet;

export function CgymManualButton({ type, manualRef, label }: { type: CgymType; manualRef?: CgymManualRef | null; label?: string }) {
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
      // V50.z203 — legge SOLO ciò che il Master ha collegato (sezione o fase). Mai errori bloccanti: soft_message.
      const r = manualRef ? await cgymManualsApi.listRef(manualRef, query?.trim() || undefined) : await cgymManualsApi.list(type, query?.trim() || undefined);
      setData(r);
    } catch (e: any) {
      setError(e?.message || "Manuali momentaneamente non leggibili da Google Drive");
    } finally {
      setLoading(false);
    }
  }, [type, manualRef]);

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
      const link = await cgymManualsApi.link(manualRef ? "any" : type, f.id);
      if (mode === "open") { openManual(router, link); }   // V50.z395 — apre nel browser esterno (la WebView interna dava net::ERR_FAILED sui PDF)
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
          <Text style={styles.btnTitle}>{label || "Leggi Manuale"}</Text>
          <Text style={styles.btnSub} numberOfLines={1}>AxonOS · {manualRef ? (manualRef.name || "riferimento Drive") : `manuale ${meta.label}`} da Google Drive</Text>
        </View>
        <Ionicons name="sparkles" size={18} color={AXON_PURPLE} />
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView behavior="padding" style={styles.sheetBg}>
          <Pressable style={{ flex: 1 }} onPress={() => setOpen(false)} testID="cgym-manual-backdrop" />
          <View style={[styles.sheet, { paddingBottom: sheetPad }]} testID={`cgym-manual-sheet-${type}`}>
            <View style={styles.sheetHead}>
              <View style={styles.axonBadge}><Ionicons name="sparkles" size={14} color="#FFF" /><Text style={styles.axonBadgeTxt}>AxonOS</Text></View>
              <Text style={styles.sheetTitle} numberOfLines={1}>Manuali · {manualRef ? (manualRef.name || meta.label) : meta.label}</Text>
              <Pressable onPress={() => setOpen(false)} hitSlop={10} testID="cgym-manual-close"><Ionicons name="close" size={22} color={HT.text} /></Pressable>
            </View>

            {config?.configured && (
              <View style={styles.search}>
                <Ionicons name="search" size={16} color={HT.muted} />
                <TextInput value={q} onChangeText={onSearch} placeholder="Cerca il PDF per nome…" placeholderTextColor={HT.muted} style={styles.searchInput} testID="cgym-manual-search" autoCorrect={false} />
                {q ? <Pressable onPress={() => onSearch("")} hitSlop={8}><Ionicons name="close-circle" size={16} color={HT.muted} /></Pressable> : null}
              </View>
            )}

            <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
              {loading && !data && <ActivityIndicator color={CGYM_ORANGE} style={{ marginVertical: 24 }} />}

              {!loading && error && (
                <View style={styles.msgBox} testID="cgym-manual-error">
                  <Ionicons name="cloud-offline" size={22} color={HT.danger} />
                  <Text style={styles.msgTxt}>{error}</Text>
                  <Pressable onPress={() => load(q)} style={styles.msgBtn}><Text style={styles.msgBtnTxt}>Riprova</Text></Pressable>
                </View>
              )}

              {/* V50.z203 — avviso SOFT, non bloccante: la sezione resta utilizzabile */}
              {!loading && !error && data && !data.linked && (
                <View style={styles.msgBox} testID="cgym-manual-unconfigured">
                  <Ionicons name="information-circle-outline" size={24} color={HT.muted} />
                  <Text style={styles.msgTxt}>{data.soft_message || "Nessun manuale collegato"}{config?.can_edit ? " — collega una cartella o un file Drive dal pannello Master Coach." : "."}</Text>
                  {config?.can_edit && (
                    <Pressable onPress={goConfig} style={styles.msgBtn} testID="cgym-manual-go-config"><Text style={styles.msgBtnTxt}>Collega manuale</Text></Pressable>
                  )}
                </View>
              )}

              {!loading && !error && data && data.linked && items.length === 0 && (
                <View style={styles.msgBox} testID="cgym-manual-empty">
                  <Ionicons name="document-outline" size={24} color={HT.muted} />
                  <Text style={styles.msgTxt}>{q.trim() ? `Nessun manuale con «${q.trim()}» nel nome.` : (data.soft_message || "Nessun file nella cartella collegata.")}</Text>
                </View>
              )}

              {items.map((f) => (
                <View key={f.id} style={styles.row} testID={`cgym-manual-row-${f.id}`}>
                  <View style={styles.rowIcon}><Ionicons name={fileIcon(f)} size={20} color={(f.mime || "").startsWith("image/") ? "#0F9D58" : "#DC2626"} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle} numberOfLines={2}>{f.name}</Text>
                    <Text style={styles.rowSub} numberOfLines={1}>
                      {[f.modified_time ? `Aggiornato ${fmtManualDate(f.modified_time)}` : null, fmtManualSize(f.size) || null].filter(Boolean).join(" · ")}
                    </Text>
                  </View>
                  <Pressable onPress={() => act(f, "download")} disabled={!!busyId} style={styles.rowBtn} hitSlop={4} testID={`cgym-manual-dl-${f.id}`} accessibilityLabel="Scarica">
                    {busyId === f.id + "download" ? <ActivityIndicator size="small" color={HT.brand} /> : <Ionicons name="download-outline" size={18} color={HT.brand} />}
                  </Pressable>
                  <Pressable onPress={() => act(f, "open")} disabled={!!busyId} style={[styles.rowBtn, styles.rowBtnOpen]} hitSlop={4} testID={`cgym-manual-open-${f.id}`} accessibilityLabel="Apri">
                    {busyId === f.id + "open" ? <ActivityIndicator size="small" color="#FFF" /> : <Ionicons name="open-outline" size={18} color="#FFF" />}
                  </Pressable>
                </View>
              ))}
            </ScrollView>

            <View style={styles.footer}>
              <Ionicons name="logo-google" size={13} color={HT.muted} />
              <Text style={styles.footerTxt} numberOfLines={2}>
                {data?.link?.name ? `Drive › ${data.link.name} · ` : ""}
                letti in tempo reale: vedi sempre l&apos;ultima versione.
              </Text>
              {config?.can_edit && config.configured && (
                <Pressable onPress={goConfig} hitSlop={8} testID="cgym-manual-config-link"><Ionicons name="settings-outline" size={18} color={HT.muted} /></Pressable>
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  btn: { flexDirection: "row", alignItems: "center", gap: 10, alignSelf: "stretch", backgroundColor: HT.card2, borderRadius: 14, borderWidth: 1, borderColor: HT.border, padding: 12, minHeight: 56, marginTop: 4 },
  btnIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: AXON_PURPLE, alignItems: "center", justifyContent: "center" },
  btnTitle: { fontSize: 14, fontWeight: "900", color: HT.text },
  btnSub: { fontSize: 11, color: HT.muted, marginTop: 2 },
  sheetBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { backgroundColor: HT.card2, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16 },
  sheetHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  axonBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: AXON_PURPLE, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  axonBadgeTxt: { color: "#FFF", fontSize: 11, fontWeight: "900" },
  sheetTitle: { flex: 1, fontSize: 16, fontWeight: "800", color: HT.text },
  search: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: HT.border, borderRadius: 10, paddingHorizontal: 10, backgroundColor: HT.card2, marginBottom: 8, minHeight: 42 },
  searchInput: { flex: 1, fontSize: 14, color: HT.text, paddingVertical: 8 },
  msgBox: { alignItems: "center", gap: 8, padding: 18, backgroundColor: HT.card2, borderRadius: 12, borderWidth: 1, borderColor: HT.border, marginVertical: 6 },
  msgTxt: { fontSize: 13, color: HT.text, textAlign: "center", lineHeight: 19 },
  msgBtn: { marginTop: 4, backgroundColor: CGYM_ORANGE, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999 },
  msgBtnTxt: { color: "#FFF", fontWeight: "800", fontSize: 13 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: HT.card2, borderRadius: 12, borderWidth: 1, borderColor: HT.border, padding: 10, marginBottom: 8 },
  rowIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: HT.dangerTint, alignItems: "center", justifyContent: "center" },
  rowTitle: { fontSize: 13, fontWeight: "700", color: HT.text },
  rowSub: { fontSize: 11, color: HT.muted, marginTop: 2 },
  rowBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: HT.card2 },
  rowBtnOpen: { backgroundColor: CGYM_ORANGE },
  footer: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: HT.border },
  footerTxt: { flex: 1, fontSize: 11, color: HT.muted },
});

export default CgymManualButton;

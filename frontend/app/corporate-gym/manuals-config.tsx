// Corporate Gym — Manuali Drive (Master Coach). V50.z203: collegamento MANUALE per sezione (cartella O file scelti dal Master),
// nessuna ricerca per nomi predefiniti, avvisi soft «Nessun manuale collegato» (mai bloccanti). Browser Drive con cartelle E file.
import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { notify, confirmAsync } from "@/src/utils/notify";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { CgymHeaderBanner } from "@/src/corporate-gym/CgymHeaderBanner";
import { CGYM_ORANGE, CgymType } from "@/src/corporate-gym/api";
import { cgymManualsApi, CgymManualsConfig, CgymManualRef, fmtManualDate } from "@/src/corporate-gym/manualsApi";
import { CgymDrivePicker } from "@/src/corporate-gym/CgymDrivePicker";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

export default function CgymManualsConfigScreen() {
  const router = useRouter();
  const pagePad = usePageBottomPadding();
  const [cfg, setCfg] = useState<CgymManualsConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [picking, setPicking] = useState<CgymType | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setCfg(await cgymManualsApi.config()); }
    catch (e: any) { notify("Manuali", e?.message || "Errore"); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const pick = async (type: CgymType, ref: CgymManualRef) => {
    setPicking(null); setSaving(true);
    try {
      setCfg(await cgymManualsApi.setLink({ type, kind: ref.kind, id: ref.id, name: ref.name || undefined }));
      notify("Collegato", `${ref.kind === "folder" ? "Cartella" : "File"} «${ref.name}» → ${type === "obiezioni" ? "Gym Obiezioni" : "Gym WIN-WIN"}. AxonOS leggerà solo questo.`);
    } catch (e: any) { notify("Collegamento", e?.message || "Errore"); }
    finally { setSaving(false); }
  };

  const unlink = async (type: CgymType) => {
    if (!(await confirmAsync("Scollegare?", "La sezione mostrerà «Nessun manuale collegato» finché non ne colleghi un altro."))) return;
    setSaving(true);
    try { await cgymManualsApi.clearLink(type); await load(); } catch (e: any) { notify("Manuali", e?.message || "Errore"); } finally { setSaving(false); }
  };

  const canEdit = !!cfg?.can_edit;
  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable testID="cgym-man-back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/corporate-gym" as any))} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={HT.text} />
        </Pressable>
        <Text style={styles.title}>Manuali su Drive</Text>
        <View style={{ width: 26 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: pagePad + 24, gap: 12 }}>
        <CgymHeaderBanner subtitle="Manuali · Google Drive" />
        {loading || !cfg ? <ActivityIndicator color={CGYM_ORANGE} style={{ marginTop: 30 }} /> : (
          <>
            {!cfg.drive_configured ? (
              <View style={[styles.card, styles.soft]}><Ionicons name="information-circle" size={18} color={HT.muted} /><Text style={styles.softTxt}>Google Drive non è configurato sul server: i manuali non sono disponibili, il resto del Gym funziona normalmente.</Text></View>
            ) : !cfg.master_drive_connected ? (
              <View style={[styles.card, styles.soft]}>
                <Ionicons name="information-circle" size={18} color={HT.muted} />
                <Text style={styles.softTxt}>Il Drive del Master non è collegato. {canEdit ? "Collegalo da Impostazioni → Google Drive per scegliere i manuali." : "Chiedi al Master di collegarlo."}</Text>
                {canEdit && <Pressable onPress={() => router.push("/google-drive" as any)} style={styles.linkBtn} testID="cgym-man-go-drive"><Text style={styles.linkBtnTxt}>Apri Google Drive</Text></Pressable>}
              </View>
            ) : null}

            <Text style={styles.hint}>Il Master Coach sceglie per ogni sezione la <Text style={{ fontWeight: "800" }}>cartella</Text> (tutti i file, anche nella radice) oppure il <Text style={{ fontWeight: "800" }}>singolo file</Text> Drive da usare come manuale. AxonOS legge esclusivamente ciò che è collegato qui.</Text>

            {cfg.types.map((t) => (
              <View key={t.type} style={styles.card} testID={`cgym-man-type-${t.type}`}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Ionicons name={t.type === "winwin" ? "briefcase" : "chatbubbles"} size={20} color={t.type === "winwin" ? "#0F9D58" : CGYM_ORANGE} />
                  <Text style={styles.cardTitle}>{t.label}</Text>
                </View>
                {t.link ? (
                  <View style={styles.linkRow}>
                    <Ionicons name={t.link.kind === "folder" ? "folder" : "document-text"} size={18} color="#F59E0B" />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.linkName} numberOfLines={1}>{t.link.name || t.link.id}</Text>
                      <Text style={styles.linkSub}>{t.link.kind === "folder" ? "Cartella collegata · tutti i file (PDF, immagini, DOCX, Google Docs…)" : "File collegato"}{cfg.updated_at ? ` · ${fmtManualDate(cfg.updated_at)}` : ""}</Text>
                    </View>
                  </View>
                ) : (
                  <View style={styles.softInline} testID={`cgym-man-soft-${t.type}`}>
                    <Ionicons name="information-circle-outline" size={16} color={HT.muted} />
                    <Text style={styles.softTxt}>{t.soft_message || "Nessun manuale collegato"} — la sezione resta utilizzabile.</Text>
                  </View>
                )}
                {canEdit && cfg.master_drive_connected && (
                  <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                    <Pressable onPress={() => setPicking(t.type)} disabled={saving} style={styles.primaryBtn} testID={`cgym-man-pick-${t.type}`}>
                      <Ionicons name="folder-open" size={16} color="#FFF" /><Text style={styles.primaryTxt}>{t.link ? "Cambia" : "Scegli cartella o file"}</Text>
                    </Pressable>
                    {t.link && <Pressable onPress={() => unlink(t.type)} disabled={saving} style={styles.ghostBtn} testID={`cgym-man-unlink-${t.type}`}><Text style={styles.ghostTxt}>Scollega</Text></Pressable>}
                  </View>
                )}
              </View>
            ))}

            {canEdit && (
              <Pressable onPress={() => router.push("/corporate-gym/coach-panel" as any)} style={[styles.card, { flexDirection: "row", alignItems: "center", gap: 10 }]} testID="cgym-man-go-coach">
                <Ionicons name="construct" size={22} color={CGYM_ORANGE} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>Pannello Master Coach</Text>
                  <Text style={styles.linkSub}>Personalizza ogni role-play (testo, immagine, durata, interventi, checklist, cliente simulato) e le fasi di sessione con i manuali per fase.</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={HT.muted} />
              </Pressable>
            )}
          </>
        )}
      </ScrollView>
      <CgymDrivePicker visible={!!picking} title={`Manuali · ${picking === "winwin" ? "Gym WIN-WIN" : "Gym Obiezioni"}`} onClose={() => setPicking(null)} onPick={(ref) => picking && pick(picking, ref)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: HT.card2 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 10 },
  title: { fontSize: 18, fontWeight: "800", color: HT.text },
  hint: { fontSize: 12.5, color: HT.muted, lineHeight: 18 },
  card: { backgroundColor: HT.card, borderRadius: 16, borderWidth: 1, borderColor: HT.border, padding: 14, gap: 10 },
  cardTitle: { fontSize: 15, fontWeight: "800", color: HT.text },
  soft: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: HT.card2 },
  softInline: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: HT.card2, borderRadius: 10, padding: 8 },
  softTxt: { flex: 1, fontSize: 12.5, color: HT.muted, lineHeight: 17 },
  linkRow: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: HT.warningTint, borderRadius: 10, padding: 8 },
  linkName: { fontSize: 13.5, fontWeight: "800", color: HT.text },
  linkSub: { fontSize: 11.5, color: HT.muted, lineHeight: 16 },
  primaryBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: CGYM_ORANGE, borderRadius: 12, paddingHorizontal: 12, minHeight: 44 },
  primaryTxt: { color: "#FFF", fontWeight: "800", fontSize: 13 },
  ghostBtn: { borderWidth: 1, borderColor: HT.border, borderRadius: 12, paddingHorizontal: 12, minHeight: 44, justifyContent: "center" },
  ghostTxt: { color: HT.muted, fontWeight: "800", fontSize: 13 },
  linkBtn: { minHeight: 36, justifyContent: "center", paddingHorizontal: 8 },
  linkBtnTxt: { color: HT.brand, fontWeight: "800", fontSize: 12.5 },
});

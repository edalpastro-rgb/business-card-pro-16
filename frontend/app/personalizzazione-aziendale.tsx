// app/personalizzazione-aziendale.tsx — V50.z232 — Pannello Master → Personalizzazione Aziendale
// (a) logo aziendale → sostituisce il logo AdvisorOS nell'header per tutti gli utenti dell'organizzazione;
// (b) ragione sociale, P.IVA, indirizzo (+ riga extra) → firma nei PDF, nei documenti generati e nelle comunicazioni automatiche di Axon.
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput, Image, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { api, apiUpload } from "@/src/api";
import { toFormPart } from "@/src/utils/upload";
import { notify } from "@/src/utils/notify";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { useOrgBranding, setOrgBrandingCache, type OrgBranding } from "@/src/BrandHeaderImage";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

const NAVY = HT.text;

export default function PersonalizzazioneAziendale() {
  const router = useRouter();
  const bottomPad = usePageBottomPadding();
  const cached = useOrgBranding();
  const [b, setB] = useState<OrgBranding | null>(cached);
  const [busy, setBusy] = useState("");
  useEffect(() => { api<OrgBranding>("/org/branding").then((r) => { setB(r); setOrgBrandingCache(r); }).catch((e: any) => notify("Personalizzazione", e?.message || String(e))); }, []);
  const set = (k: keyof OrgBranding, v: string) => setB((x) => (x ? { ...x, [k]: v } : x));

  const save = async () => {
    if (!b) return;
    setBusy("save");
    try { const r = await api<OrgBranding>("/org/branding", { method: "PUT", body: { company_name: b.company_name, vat: b.vat, address: b.address, extra: b.extra } }); setB(r); setOrgBrandingCache(r); notify("Salvato ✅", "La firma aziendale comparirà nei PDF, nei documenti e nelle comunicazioni generate."); }
    catch (e: any) { notify("Salvataggio", e?.message || String(e)); } finally { setBusy(""); }
  };
  const pickLogo = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: ["image/png", "image/jpeg", "image/webp"], multiple: false, copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      if ((a.size || 0) > 1_500_000) { notify("Logo troppo grande", "Max 1,5 MB (meglio un PNG trasparente)."); return; }
      setBusy("logo");
      const form = new FormData();
      form.append("file", await toFormPart({ uri: a.uri, name: a.name || "logo.png", mime: a.mimeType || "image/png" }));
      const r = await apiUpload<OrgBranding>("/org/branding/logo", form);
      setB(r); setOrgBrandingCache(r); notify("Logo aggiornato ✅", "Ora appare nell'header di tutti gli utenti della tua organizzazione.");
    } catch (e: any) { notify("Logo", e?.message || String(e)); } finally { setBusy(""); }
  };
  const removeLogo = async () => {
    setBusy("logo");
    try { const r = await api<OrgBranding>("/org/branding/logo", { method: "DELETE" }); setB(r); setOrgBrandingCache(r); } catch (e: any) { notify("Logo", e?.message || String(e)); } finally { setBusy(""); }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} testID="brand-back"><Ionicons name="chevron-back" size={26} color={NAVY} /></Pressable>
        <Text style={styles.hTitle}>Personalizzazione Aziendale</Text>
        <View style={{ width: 26 }} />
      </View>
      {!b ? <ActivityIndicator color={NAVY} style={{ marginTop: 30 }} /> : (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: bottomPad }} keyboardShouldPersistTaps="handled">
          {!b.can_edit && <Text style={styles.warn}>Solo il Master può modificare questi dati.</Text>}

          <View style={styles.card}>
            <Text style={styles.secTitle}>🏢 Logo aziendale</Text>
            <Text style={styles.hint}>Sostituisce il logo AdvisorOS nell&apos;header della Home e dell&apos;Interfaccia Master per tutti gli utenti della tua organizzazione. AxonOS resta come componente, in piccolo.</Text>
            <View style={styles.preview} testID="brand-logo-preview">
              {b.logo_data_uri ? <Image source={{ uri: b.logo_data_uri }} resizeMode="contain" style={{ width: "80%", height: 90 }} /> : <Text style={styles.previewTxt}>Nessun logo: viene usato AdvisorOS</Text>}
            </View>
            {b.can_edit && (
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable onPress={pickLogo} disabled={!!busy} style={[styles.btn, { backgroundColor: NAVY, flex: 1 }]} testID="brand-logo-upload">
                  {busy === "logo" ? <ActivityIndicator color="#FFF" /> : <><Ionicons name="cloud-upload" size={18} color="#FFF" /><Text style={styles.btnTxt}>{b.logo_data_uri ? "Cambia logo" : "Carica logo (PNG/JPG)"}</Text></>}
                </Pressable>
                {!!b.logo_data_uri && <Pressable onPress={removeLogo} disabled={!!busy} style={[styles.btn, { backgroundColor: '#DC2626' }]} testID="brand-logo-remove"><Ionicons name="trash-outline" size={18} color="#FFF" /></Pressable>}
              </View>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.secTitle}>✍️ Dati societari · firma</Text>
            <Text style={styles.hint}>Compaiono come firma nei report PDF, nei documenti generati e nelle comunicazioni automatiche (email, messaggi) preparate da Axon.</Text>
            {([["company_name", "Ragione sociale", "Es. Rossi Energia S.r.l."], ["vat", "Partita IVA", "Es. IT01234567890"], ["address", "Indirizzo", "Via, numero, CAP, Città"], ["extra", "Riga aggiuntiva (opzionale)", "Es. Tel. / email / PEC"]] as const).map(([k, label, ph]) => (
              <View key={k} style={{ gap: 4 }}>
                <Text style={styles.lbl}>{label}</Text>
                <TextInput value={b[k] || ""} onChangeText={(t) => set(k, t)} editable={!!b.can_edit} placeholder={ph} placeholderTextColor={HT.muted} style={styles.input} testID={`brand-field-${k}`} />
              </View>
            ))}
            {!!(b.company_name || b.vat || b.address) && (
              <View style={styles.sigBox} testID="brand-signature-preview">
                <Text style={styles.sigLbl}>Anteprima firma</Text>
                <Text style={styles.sigTxt}>{[b.company_name, b.vat ? `P.IVA ${b.vat}` : "", b.address, b.extra].filter(Boolean).join(" · ")}</Text>
              </View>
            )}
            {b.can_edit && (
              <Pressable onPress={save} disabled={!!busy} style={[styles.btn, { backgroundColor: '#16A34A' }]} testID="brand-save">
                {busy === "save" ? <ActivityIndicator color="#FFF" /> : <><Ionicons name="checkmark" size={18} color="#FFF" /><Text style={styles.btnTxt}>Salva dati societari</Text></>}
              </Pressable>
            )}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: HT.card2 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 12, backgroundColor: HT.card, borderBottomWidth: 1, borderBottomColor: HT.border },
  hTitle: { fontSize: 17, fontWeight: "900", color: NAVY },
  card: { backgroundColor: HT.card, borderRadius: 16, padding: 14, gap: 10, borderWidth: 1, borderColor: HT.border },
  secTitle: { fontSize: 15, fontWeight: "900", color: NAVY },
  hint: { fontSize: 12.5, color: HT.muted, lineHeight: 17 },
  preview: { height: 120, borderRadius: 12, backgroundColor: NAVY, alignItems: "center", justifyContent: "center" },
  previewTxt: { color: "#CBD5E1", fontWeight: "700", fontSize: 12.5 },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 48, borderRadius: 12, paddingHorizontal: 14 },
  btnTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
  lbl: { fontSize: 11.5, fontWeight: "800", color: HT.text2, textTransform: "uppercase", letterSpacing: 0.4 },
  input: { borderWidth: 1.5, borderColor: HT.border, borderRadius: 12, padding: 12, fontSize: 14.5, color: NAVY, backgroundColor: HT.card2 },
  sigBox: { backgroundColor: HT.card2, borderRadius: 12, padding: 10, gap: 2 },
  sigLbl: { fontSize: 11, fontWeight: "800", color: HT.muted, textTransform: "uppercase" },
  sigTxt: { fontSize: 12.5, color: NAVY, fontStyle: "italic" },
  warn: { color: HT.warning, fontWeight: "700", fontSize: 12.5, backgroundColor: HT.warningTint, borderRadius: 10, padding: 10 },
});

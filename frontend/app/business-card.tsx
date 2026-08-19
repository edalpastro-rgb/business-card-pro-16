import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, TextInput, Platform, Share, Image as RNImage } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as Clipboard from "expo-clipboard";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import QRCode from "react-native-qrcode-svg";
import { captureRef } from "react-native-view-shot";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";

type Card = {
  card_id?: string;
  display_name?: string;
  title?: string;
  company_name?: string;
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  tagline?: string;
  logo_base64?: string;
  photo_base64?: string;
  accent_color?: string;
  qr_type?: "app" | "website" | "text" | "vcard";
  qr_content?: string;
  demo_app_link?: string;
};

const QR_TYPES: { id: NonNullable<Card["qr_type"]>; label: string; hint: string }[] = [
  { id: "app", label: "Link app demo", hint: "URL della tua demo su Emergent" },
  { id: "website", label: "Sito web", hint: "https://…" },
  { id: "vcard", label: "vCard contatto", hint: "Genera automaticamente da nome/tel/email" },
  { id: "text", label: "Testo libero", hint: "Qualsiasi messaggio" },
];

export default function BusinessCardScreen() {
  const router = useRouter();
  const [card, setCard] = useState<Card>({ accent_color: "#6366F1", qr_type: "website" });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const cardPreviewRef = useRef<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api<Card>("/master/business-card");
      setCard({ accent_color: "#6366F1", qr_type: "website", ...r });
    } catch (e: any) {
      notify("Errore caricamento", e?.message || "");
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (patch?: Partial<Card>) => {
    const next = { ...card, ...patch };
    setCard(next);
    try {
      const saved = await api<Card>("/master/business-card", { method: "PUT", body: next });
      setCard({ ...next, ...saved });
      return saved;
    } catch (e: any) {
      notify("Errore salvataggio", e?.message || "");
      return null;
    }
  };
  const upd = (field: keyof Card) => (v: any) => setCard((c) => ({ ...c, [field]: v }));

  const pickImage = async (field: "logo_base64" | "photo_base64") => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7, allowsEditing: true });
    if (res.canceled || !res.assets?.[0]?.uri) return;
    setBusy(true);
    try {
      const a = res.assets[0];
      const b64 = await FileSystem.readAsStringAsync(a.uri, { encoding: FileSystem.EncodingType.Base64 });
      const dataUri = `data:${a.mimeType || "image/jpeg"};base64,${b64}`;
      await save({ [field]: dataUri } as any);
    } catch (e: any) { notify("Errore", e?.message || ""); }
    finally { setBusy(false); }
  };

  const qrValue = (() => {
    const t = card.qr_type || "website";
    if (t === "app") return card.demo_app_link || card.qr_content || "https://emergent.sh";
    if (t === "website") return card.website || card.qr_content || "https://example.com";
    if (t === "text") return card.qr_content || card.tagline || card.display_name || " ";
    // vcard
    const vcLines = ["BEGIN:VCARD", "VERSION:3.0"];
    if (card.display_name) vcLines.push(`FN:${card.display_name}`);
    if (card.company_name) vcLines.push(`ORG:${card.company_name}`);
    if (card.title) vcLines.push(`TITLE:${card.title}`);
    if (card.phone) vcLines.push(`TEL:${card.phone}`);
    if (card.email) vcLines.push(`EMAIL:${card.email}`);
    if (card.website) vcLines.push(`URL:${card.website}`);
    vcLines.push("END:VCARD");
    return vcLines.join("\n");
  })();

  const shareAsImage = async () => {
    if (!cardPreviewRef.current) return;
    setBusy(true);
    try {
      const uri = await captureRef(cardPreviewRef.current, { format: "png", quality: 1, result: "tmpfile" });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) await Sharing.shareAsync(uri, { mimeType: "image/png", dialogTitle: "Condividi biglietto da visita" });
      else await Share.share({ url: uri, title: "Biglietto da visita" });
    } catch (e: any) { notify("Errore condivisione", e?.message || ""); }
    finally { setBusy(false); }
  };

  const shareLink = async () => {
    // V38Q — ensure the card has been persisted at least once so we have a
    // card_id for the public read-only link. `save()` returns the saved doc
    // (with card_id populated on first insert) so we prefer that over the
    // async React state (which hasn't updated yet at this point).
    let cid = card.card_id;
    if (!cid) {
      const saved = await save();
      cid = saved?.card_id || card.card_id;
    }
    if (!cid) { notify("Card non salvata", "Salva prima le modifiche."); return; }
    const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL || (globalThis as any)?.location?.origin || "";
    const link = `${backendUrl}/api/master/business-card/public/${cid}`;
    try { await Clipboard.setStringAsync(link); } catch {}
    try {
      await Share.share({ message: `${card.display_name || "Biglietto"} - ${link}`, url: link, title: "Biglietto da visita" });
    } catch (e: any) { notify("Errore", e?.message || ""); }
  };

  const accent = card.accent_color || "#6366F1";
  if (loading) return <SafeAreaView style={styles.root}><ActivityIndicator style={{ marginTop: 40 }} color={accent} /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable testID="bc-back" onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={26} color={theme.color.onSurface} /></Pressable>
        <Text style={styles.title}>Biglietto da visita</Text>
        <Pressable testID="bc-save" onPress={() => save()} hitSlop={10}><Ionicons name="save" size={22} color={accent} /></Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
        {/* PREVIEW */}
        <View ref={cardPreviewRef} collapsable={false} style={[styles.preview, { backgroundColor: "#FFF", borderColor: accent }]}>
          <View style={[styles.previewBar, { backgroundColor: accent }]} />
          <View style={{ flexDirection: "row", padding: 16, gap: 14, alignItems: "center" }}>
            {card.logo_base64 ? (
              <View style={{ width: 64, height: 64, borderRadius: 12, overflow: "hidden", backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: accent }}>
                <ExpoImage uri={card.logo_base64} />
              </View>
            ) : null}
            <View style={{ flex: 1 }}>
              <Text style={[styles.pName, { color: accent }]} numberOfLines={2}>{card.display_name || "Il tuo nome"}</Text>
              {card.title ? <Text style={styles.pTitle} numberOfLines={1}>{card.title}</Text> : null}
              {card.company_name ? <Text style={styles.pCompany} numberOfLines={1}>{card.company_name}</Text> : null}
            </View>
          </View>
          <View style={{ paddingHorizontal: 16, paddingBottom: 10, gap: 3 }}>
            {card.phone ? <Text style={styles.pMeta}>📞 {card.phone}</Text> : null}
            {card.email ? <Text style={styles.pMeta}>✉️ {card.email}</Text> : null}
            {card.website ? <Text style={styles.pMeta}>🌐 {card.website}</Text> : null}
            {card.address ? <Text style={styles.pMeta}>📍 {card.address}</Text> : null}
          </View>
          {card.tagline ? <Text style={[styles.pTagline, { color: accent }]}>{card.tagline}</Text> : null}
          <View style={styles.qrBox}>
            <QRCode value={qrValue || " "} size={130} color={accent} backgroundColor="#FFF" />
            <Text style={styles.qrLabel}>{QR_TYPES.find((t) => t.id === (card.qr_type || "website"))?.label}</Text>
          </View>
        </View>

        {/* SHARE BUTTONS */}
        <View style={styles.shareRow}>
          <Pressable testID="bc-share-image" onPress={shareAsImage} disabled={busy} style={[styles.shareBtn, { backgroundColor: accent }]}>
            {busy ? <ActivityIndicator size="small" color="#FFF" /> : <Ionicons name="image" size={18} color="#FFF" />}
            <Text style={styles.shareTxt}>Condividi come immagine</Text>
          </Pressable>
          <Pressable testID="bc-share-link" onPress={shareLink} style={[styles.shareBtn, { backgroundColor: "#16A34A" }]}>
            <Ionicons name="link" size={18} color="#FFF" />
            <Text style={styles.shareTxt}>Condividi link</Text>
          </Pressable>
        </View>

        {/* FORM */}
        <Text style={styles.section}>Contenuti</Text>
        <Field label="Nome" testID="bc-name" value={card.display_name || ""} onChange={upd("display_name")} />
        <Field label="Ruolo / Qualifica" testID="bc-title" value={card.title || ""} onChange={upd("title")} />
        <Field label="Azienda" testID="bc-company" value={card.company_name || ""} onChange={upd("company_name")} />
        <Field label="Telefono" testID="bc-phone" value={card.phone || ""} onChange={upd("phone")} keyboardType="phone-pad" />
        <Field label="Email" testID="bc-email" value={card.email || ""} onChange={upd("email")} keyboardType="email-address" />
        <Field label="Sito web" testID="bc-website" value={card.website || ""} onChange={upd("website")} keyboardType="url" />
        <Field label="Indirizzo" testID="bc-address" value={card.address || ""} onChange={upd("address")} />
        <Field label="Tagline / Slogan" testID="bc-tagline" value={card.tagline || ""} onChange={upd("tagline")} />

        <Text style={styles.section}>Logo</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable testID="bc-pick-logo" onPress={() => pickImage("logo_base64")} style={[styles.imgBtn, { borderColor: accent }]}>
            <Ionicons name="image" size={18} color={accent} />
            <Text style={[styles.imgBtnTxt, { color: accent }]}>{card.logo_base64 ? "Cambia logo" : "Aggiungi logo"}</Text>
          </Pressable>
          {card.logo_base64 ? (
            <Pressable testID="bc-clear-logo" onPress={() => save({ logo_base64: "" })} style={styles.clearBtn}>
              <Ionicons name="trash" size={16} color="#DC2626" />
            </Pressable>
          ) : null}
        </View>

        <Text style={styles.section}>QR Code</Text>
        <View style={{ gap: 6 }}>
          {QR_TYPES.map((t) => {
            const on = (card.qr_type || "website") === t.id;
            return (
              <Pressable
                key={t.id}
                testID={`bc-qr-type-${t.id}`}
                onPress={() => save({ qr_type: t.id })}
                style={[styles.radioRow, on && { borderColor: accent, backgroundColor: accent + "12" }]}
              >
                <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={20} color={on ? accent : theme.color.muted} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.radioLbl, on && { color: accent }]}>{t.label}</Text>
                  <Text style={styles.radioHint}>{t.hint}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
        {(card.qr_type === "app" || card.qr_type === "text" || card.qr_type === "website") && (
          <Field
            label={card.qr_type === "app" ? "Link app demo" : card.qr_type === "website" ? "URL sito web" : "Testo libero"}
            testID="bc-qr-content"
            value={(card.qr_type === "app" ? card.demo_app_link : card.qr_content) || ""}
            onChange={(v) => card.qr_type === "app" ? upd("demo_app_link")(v) : upd("qr_content")(v)}
            multiline={card.qr_type === "text"}
          />
        )}

        <Text style={styles.section}>Colore accento</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {["#6366F1", "#0891B2", "#EA580C", "#DC2626", "#16A34A", "#7C3AED", "#DB2777", "#F59E0B"].map((c) => (
            <Pressable key={c} testID={`bc-color-${c}`} onPress={() => save({ accent_color: c })}
              style={[styles.swatch, { backgroundColor: c }, card.accent_color === c && styles.swatchOn]} />
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Field({ label, value, onChange, testID, keyboardType, multiline }: any) {
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChange}
        keyboardType={keyboardType}
        multiline={!!multiline}
        placeholderTextColor="#94A3B8"
        style={[styles.input, multiline && { minHeight: 80, textAlignVertical: "top" }]}
      />
    </View>
  );
}

// Tiny wrapper for RN Image with base64 uri
function ExpoImage({ uri }: { uri: string }) {
  return <RNImage source={{ uri }} style={{ width: "100%", height: "100%", resizeMode: "contain" }} />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.color.border, backgroundColor: theme.color.surface },
  title: { fontSize: 18, fontWeight: "800", color: theme.color.onSurface },
  preview: { borderRadius: 16, borderWidth: 2, overflow: "hidden", elevation: 3, shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 8 },
  previewBar: { height: 8 },
  pName: { fontSize: 20, fontWeight: "800" },
  pTitle: { fontSize: 13, color: "#475569", marginTop: 2 },
  pCompany: { fontSize: 12, color: "#64748B", marginTop: 2 },
  pMeta: { fontSize: 12, color: "#334155" },
  pTagline: { fontSize: 12, fontStyle: "italic", textAlign: "center", paddingHorizontal: 16, paddingBottom: 8 },
  qrBox: { alignItems: "center", padding: 14, borderTopWidth: 1, borderTopColor: "#F1F5F9", gap: 6 },
  qrLabel: { fontSize: 10, color: "#64748B", textTransform: "uppercase", letterSpacing: 0.5 },
  shareRow: { flexDirection: "row", gap: 8, marginTop: 14, marginBottom: 6 },
  shareBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, borderRadius: 10 },
  shareTxt: { color: "#FFF", fontWeight: "700", fontSize: 12 },
  section: { fontSize: 12, fontWeight: "800", color: theme.color.muted, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 20, marginBottom: 8 },
  label: { fontSize: 12, fontWeight: "600", color: theme.color.muted, marginBottom: 4 },
  input: { backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: Platform.OS === "ios" ? 10 : 8, fontSize: 14, color: theme.color.onSurface },
  imgBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderStyle: "dashed" },
  imgBtnTxt: { fontWeight: "700", fontSize: 13 },
  clearBtn: { width: 40, alignItems: "center", justifyContent: "center", borderRadius: 8, backgroundColor: "#FEE2E2" },
  radioRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surface },
  radioLbl: { fontSize: 13, fontWeight: "700", color: theme.color.onSurface },
  radioHint: { fontSize: 11, color: theme.color.muted, marginTop: 1 },
  swatch: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: "transparent" },
  swatchOn: { borderColor: "#0F172A" },
});

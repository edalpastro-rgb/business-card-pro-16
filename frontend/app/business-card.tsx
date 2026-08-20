import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, TextInput, Platform, Share, Image as RNImage, Animated } from "react-native";
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
  // V38V — Public page customization
  link_title?: string;
  visual_effect?: "none" | "shimmer" | "border";
};

const QR_TYPES: { id: NonNullable<Card["qr_type"]>; label: string; hint: string }[] = [
  { id: "app", label: "Link app demo", hint: "URL della tua demo su Emergent" },
  { id: "website", label: "Sito web", hint: "https://…" },
  { id: "vcard", label: "vCard contatto", hint: "Genera automaticamente da nome/tel/email" },
  { id: "text", label: "Testo libero", hint: "Qualsiasi messaggio" },
];

// V38W — Card palette (professional business card look)
const CARD_NAVY = "#1A2A6C";
const CARD_BLUE_MED = "#3A6BA5";
const CARD_GOLD = "#D4B26A";
const CARD_BACK_BG = "#FCFCFC";
const CARD_TEXT = "#0F172A";
const CARD_TEXT_MUTED = "#64748B";
// Ratio 1.75:1 for a classic business card look
const CARD_W = 340;
const CARD_H = Math.round(CARD_W / 1.75); // ≈ 194

export default function BusinessCardScreen() {
  const router = useRouter();
  const [card, setCard] = useState<Card>({ accent_color: CARD_NAVY, qr_type: "website" });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [flipped, setFlipped] = useState(false); // true = showing back
  const cardBackRef = useRef<any>(null); // native capture ref
  const flip = useRef(new Animated.Value(0)).current;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api<Card>("/master/business-card");
      setCard({ accent_color: CARD_NAVY, qr_type: "website", ...r });
    } catch (e: any) {
      notify("Errore caricamento", e?.message || "");
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    Animated.spring(flip, { toValue: flipped ? 1 : 0, useNativeDriver: true, friction: 8, tension: 10 }).start();
  }, [flipped, flip]);

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
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7, allowsEditing: true, base64: Platform.OS === "web" });
    if (res.canceled || !res.assets?.[0]?.uri) return;
    setBusy(true);
    try {
      const a = res.assets[0];
      let dataUri: string;
      if (Platform.OS === "web") {
        if (a.base64) {
          dataUri = `data:${a.mimeType || "image/jpeg"};base64,${a.base64}`;
        } else {
          const blob = await (await fetch(a.uri)).blob();
          dataUri = await new Promise<string>((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(fr.result as string);
            fr.onerror = () => reject(fr.error);
            fr.readAsDataURL(blob);
          });
        }
      } else {
        const b64 = await FileSystem.readAsStringAsync(a.uri, { encoding: FileSystem.EncodingType.Base64 });
        dataUri = `data:${a.mimeType || "image/jpeg"};base64,${b64}`;
      }
      await save({ [field]: dataUri } as any);
    } catch (e: any) { notify("Errore", e?.message || ""); }
    finally { setBusy(false); }
  };

  const qrValue = (() => {
    const t = card.qr_type || "website";
    if (t === "app") return card.demo_app_link || card.qr_content || "https://emergent.sh";
    if (t === "website") return card.website || card.qr_content || "https://example.com";
    if (t === "text") return card.qr_content || card.tagline || card.display_name || " ";
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

  // V38W — DOM IDs for html2canvas capture (back is the shareable side)
  const backWebId = "bc-back-web";

  const shareAsImage = async () => {
    setBusy(true);
    try {
      if (Platform.OS === "web") {
        const doc = (globalThis as any).document;
        const target = doc?.getElementById?.(backWebId);
        if (!target) { notify("Errore", "Preview non trovata"); return; }
        const mod = await import("html2canvas");
        const html2canvas = (mod as any).default || (mod as any);
        const canvas = await html2canvas(target, {
          backgroundColor: null,
          scale: 3, // higher DPI for print quality
          useCORS: true,
          logging: false,
        });
        const dataUri: string = canvas.toDataURL("image/png");
        const fileName = `biglietto-${(card.display_name || "master").replace(/\s+/g, "-")}.png`;
        try {
          const resp = await fetch(dataUri);
          const blob = await resp.blob();
          const file = new File([blob], fileName, { type: "image/png" });
          const anyNav: any = navigator;
          if (anyNav?.canShare && anyNav.canShare({ files: [file] })) {
            await anyNav.share({ files: [file], title: "Biglietto da visita" });
            return;
          }
        } catch {}
        const respFinal = await fetch(dataUri);
        const blobFinal = await respFinal.blob();
        const url = URL.createObjectURL(blobFinal);
        const link = doc.createElement("a");
        link.href = url;
        link.download = fileName;
        doc.body.appendChild(link);
        link.click();
        doc.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        return;
      }
      // Native — captureRef on the back-side ref
      if (!cardBackRef.current) { notify("Errore", "Preview non trovata"); return; }
      const uri = await captureRef(cardBackRef.current, { format: "png", quality: 1, result: "tmpfile" });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) await Sharing.shareAsync(uri, { mimeType: "image/png", dialogTitle: "Condividi biglietto da visita" });
      else await Share.share({ url: uri, title: "Biglietto da visita" });
    } catch (e: any) { notify("Errore condivisione", e?.message || ""); }
    finally { setBusy(false); }
  };

  const shareLink = async () => {
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

  const accent = card.accent_color || CARD_NAVY;
  if (loading) return <SafeAreaView style={styles.root}><ActivityIndicator style={{ marginTop: 40 }} color={accent} /></SafeAreaView>;

  const frontRotate = flip.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "180deg"] });
  const backRotate = flip.interpolate({ inputRange: [0, 1], outputRange: ["180deg", "360deg"] });

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable testID="bc-back" onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={26} color={theme.color.onSurface} /></Pressable>
        <Text style={styles.title}>Biglietto da visita</Text>
        <Pressable testID="bc-save" onPress={() => save()} hitSlop={10}><Ionicons name="save" size={22} color={CARD_NAVY} /></Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
        {/* HINT */}
        <View style={styles.flipHint}>
          <Ionicons name="sync-outline" size={14} color={theme.color.muted} />
          <Text style={styles.flipHintTxt}>Tocca il biglietto per ruotarlo • Attualmente: {flipped ? "Retro" : "Fronte"}</Text>
        </View>

        {/* PREVIEW — Flip card */}
        <Pressable
          testID="bc-flip"
          onPress={() => setFlipped((f) => !f)}
          style={styles.flipWrap}
        >
          <View style={styles.flipContainer}>
            {/* FRONT */}
            <Animated.View
              pointerEvents={flipped ? "none" : "auto"}
              style={[
                styles.cardFace,
                {
                  backgroundColor: CARD_NAVY,
                  transform: [{ perspective: 1000 }, { rotateY: frontRotate }],
                  opacity: flip.interpolate({ inputRange: [0, 0.5, 0.5001, 1], outputRange: [1, 1, 0, 0] }),
                },
              ]}
            >
              {/* Diagonal stripe pattern */}
              <View style={styles.stripesOverlay} pointerEvents="none">
                {Array.from({ length: 22 }).map((_, i) => (
                  <View
                    key={i}
                    style={{
                      position: "absolute",
                      top: -30,
                      left: i * 22 - 60,
                      width: 2,
                      height: CARD_H + 90,
                      backgroundColor: "rgba(255,255,255,0.06)",
                      transform: [{ rotate: "-32deg" }],
                    }}
                  />
                ))}
              </View>
              {/* Gold thin inner border */}
              <View style={styles.goldBorder} pointerEvents="none" />
              {/* Logo centered */}
              <View style={styles.logoWrap}>
                {card.logo_base64 ? (
                  <RNImage source={{ uri: card.logo_base64 }} style={styles.logoImg} resizeMode="contain" />
                ) : (
                  <View style={styles.logoPlaceholder}>
                    <Ionicons name="business" size={44} color="rgba(255,255,255,0.6)" />
                    <Text style={styles.logoPlaceholderTxt}>Logo Agenzia</Text>
                  </View>
                )}
              </View>
              {/* Simple shimmer streak (static approximation for RN native) */}
              <View style={styles.shimmerStreak} pointerEvents="none" />
            </Animated.View>

            {/* BACK (this is what gets captured on native via captureRef) */}
            <Animated.View
              ref={cardBackRef}
              collapsable={false}
              pointerEvents={flipped ? "auto" : "none"}
              style={[
                styles.cardFace,
                styles.cardBack,
                {
                  transform: [{ perspective: 1000 }, { rotateY: backRotate }],
                  opacity: flip.interpolate({ inputRange: [0, 0.4999, 0.5, 1], outputRange: [0, 0, 1, 1] }),
                },
              ]}
            >
              {/* Header — Name + title */}
              <View style={styles.backContent}>
                <Text style={styles.backName} numberOfLines={1}>{card.display_name || "Il tuo nome"}</Text>
                {card.title ? <Text style={styles.backTitle} numberOfLines={1}>{card.title}</Text> : null}
                <View style={styles.backSeparator} />
                {/* Contacts centered */}
                <View style={styles.backContacts}>
                  {card.phone ? (
                    <View style={styles.backContactRow}>
                      <Ionicons name="call" size={11} color={CARD_BLUE_MED} />
                      <Text style={styles.backContactTxt}>{card.phone}</Text>
                    </View>
                  ) : null}
                  {card.email ? (
                    <View style={styles.backContactRow}>
                      <Ionicons name="mail" size={11} color={CARD_BLUE_MED} />
                      <Text style={styles.backContactTxt}>{card.email}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
              {/* Footer — Agency + website with mid-line, QR bottom-right */}
              <View style={styles.backFooter}>
                <View style={{ flex: 1 }}>
                  {card.company_name ? <Text style={styles.backCompany} numberOfLines={1}>{card.company_name}</Text> : null}
                  {card.website ? <Text style={styles.backSite} numberOfLines={1}>{card.website}</Text> : null}
                </View>
                <View style={styles.backQr}>
                  <QRCode value={qrValue || " "} size={54} color={CARD_NAVY} backgroundColor="#FFFFFF" />
                </View>
              </View>
            </Animated.View>
          </View>
        </Pressable>

        {/* V38W — Hidden HTML mirrors for html2canvas on web (both sides available) */}
        {Platform.OS === "web" && (
          <View style={{ position: "absolute", left: -9999, top: -9999, width: CARD_W }} pointerEvents="none">
            {/* @ts-expect-error web-only */}
            <div id={backWebId} style={{
              width: CARD_W,
              height: CARD_H,
              background: CARD_BACK_BG,
              borderRadius: 14,
              overflow: "hidden",
              boxShadow: "0 12px 28px rgba(15,23,42,0.18), 0 2px 6px rgba(15,23,42,0.08)",
              border: "1px solid #E5E7EB",
              fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,sans-serif",
              position: "relative",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              padding: "18px 20px",
              color: CARD_TEXT,
            }}>
              {/* Header — name + title + separator + contacts */}
              {/* @ts-expect-error web-only */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                {/* @ts-expect-error web-only */}
                <div style={{ fontSize: 20, fontWeight: 800, color: CARD_NAVY, letterSpacing: 0.2, textAlign: "center" }}>
                  {card.display_name || "Il tuo nome"}
                </div>
                {card.title ? (
                  // @ts-expect-error web-only
                  <div style={{ fontSize: 12, fontStyle: "italic", color: CARD_BLUE_MED, marginTop: 1, textAlign: "center" }}>{card.title}</div>
                ) : null}
                {/* @ts-expect-error web-only */}
                <div style={{ width: 60, height: 1, background: CARD_BLUE_MED, marginTop: 6, marginBottom: 6, opacity: 0.5 }} />
                {/* @ts-expect-error web-only */}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                  {card.phone ? (
                    // @ts-expect-error web-only
                    <div style={{ fontSize: 11, color: CARD_TEXT, letterSpacing: 0.2 }}>
                      <span style={{ color: CARD_BLUE_MED, marginRight: 4 }}>☎</span>{card.phone}
                    </div>
                  ) : null}
                  {card.email ? (
                    // @ts-expect-error web-only
                    <div style={{ fontSize: 11, color: CARD_TEXT, letterSpacing: 0.2 }}>
                      <span style={{ color: CARD_BLUE_MED, marginRight: 4 }}>✉</span>{card.email}
                    </div>
                  ) : null}
                </div>
              </div>
              {/* Footer — company + website + QR */}
              {/* @ts-expect-error web-only */}
              <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10, borderTop: `1px solid ${CARD_BLUE_MED}40`, paddingTop: 8, marginTop: 6 }}>
                {/* @ts-expect-error web-only */}
                <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                  {card.company_name ? (
                    // @ts-expect-error web-only
                    <div style={{ fontSize: 12, fontWeight: 800, color: CARD_NAVY, letterSpacing: 0.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {card.company_name}
                    </div>
                  ) : null}
                  {card.website ? (
                    // @ts-expect-error web-only
                    <div style={{ fontSize: 10, color: CARD_TEXT_MUTED, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {card.website}
                    </div>
                  ) : null}
                </div>
                {/* @ts-expect-error web-only */}
                <div style={{ width: 62, height: 62, background: "#FFF", padding: 3, borderRadius: 4, boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qrValue || " ")}&size=120x120&color=1A2A6C&bgcolor=FFFFFF&margin=0`}
                    alt="qr"
                    width={56}
                    height={56}
                    style={{ display: "block" }}
                  />
                </div>
              </div>
            </div>
          </View>
        )}

        {/* SIDE INDICATOR */}
        <View style={styles.sideRow}>
          <Pressable testID="bc-side-front" onPress={() => setFlipped(false)} style={[styles.sideBtn, !flipped && styles.sideBtnOn]}>
            <Text style={[styles.sideBtnTxt, !flipped && styles.sideBtnTxtOn]}>Fronte</Text>
          </Pressable>
          <Pressable testID="bc-side-back" onPress={() => setFlipped(true)} style={[styles.sideBtn, flipped && styles.sideBtnOn]}>
            <Text style={[styles.sideBtnTxt, flipped && styles.sideBtnTxtOn]}>Retro</Text>
          </Pressable>
        </View>

        {/* SHARE BUTTONS */}
        <View style={styles.shareRow}>
          <Pressable testID="bc-share-image" onPress={shareAsImage} disabled={busy} style={[styles.shareBtn, { backgroundColor: CARD_NAVY }]}>
            {busy ? <ActivityIndicator size="small" color="#FFF" /> : <Ionicons name="image" size={18} color="#FFF" />}
            <Text style={styles.shareTxt}>Condividi retro</Text>
          </Pressable>
          <Pressable testID="bc-share-link" onPress={shareLink} style={[styles.shareBtn, { backgroundColor: "#16A34A" }]}>
            <Ionicons name="link" size={18} color="#FFF" />
            <Text style={styles.shareTxt}>Condividi link</Text>
          </Pressable>
        </View>

        {/* FORM */}
        <Text style={styles.section}>Contenuti</Text>
        <Field label="Nome consulente" testID="bc-name" value={card.display_name || ""} onChange={upd("display_name")} />
        <Field label="Titolo professionale (es. Consulente Energetico)" testID="bc-title" value={card.title || ""} onChange={upd("title")} />
        <Field label="Nome agenzia" testID="bc-company" value={card.company_name || ""} onChange={upd("company_name")} />
        <Field label="Telefono" testID="bc-phone" value={card.phone || ""} onChange={upd("phone")} keyboardType="phone-pad" />
        <Field label="Email" testID="bc-email" value={card.email || ""} onChange={upd("email")} keyboardType="email-address" />
        <Field label="Sito web" testID="bc-website" value={card.website || ""} onChange={upd("website")} keyboardType="url" />
        <Field label="Indirizzo (opzionale)" testID="bc-address" value={card.address || ""} onChange={upd("address")} />
        <Field label="Tagline / Slogan (opzionale)" testID="bc-tagline" value={card.tagline || ""} onChange={upd("tagline")} />

        <Text style={styles.section}>Logo agenzia (fronte)</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable testID="bc-pick-logo" onPress={() => pickImage("logo_base64")} style={[styles.imgBtn, { borderColor: CARD_NAVY }]}>
            <Ionicons name="image" size={18} color={CARD_NAVY} />
            <Text style={[styles.imgBtnTxt, { color: CARD_NAVY }]}>{card.logo_base64 ? "Cambia logo" : "Aggiungi logo"}</Text>
          </Pressable>
          {card.logo_base64 ? (
            <Pressable testID="bc-clear-logo" onPress={() => save({ logo_base64: "" })} style={styles.clearBtn}>
              <Ionicons name="trash" size={16} color="#DC2626" />
            </Pressable>
          ) : null}
        </View>
        <Text style={styles.helperTxt}>
          Il logo appare sul <Text style={{ fontWeight: "700" }}>fronte</Text>, grande e centrato in bianco sullo sfondo navy.
        </Text>

        <Text style={styles.section}>QR Code (retro)</Text>
        <View style={{ gap: 6 }}>
          {QR_TYPES.map((t) => {
            const on = (card.qr_type || "website") === t.id;
            return (
              <Pressable
                key={t.id}
                testID={`bc-qr-type-${t.id}`}
                onPress={() => save({ qr_type: t.id })}
                style={[styles.radioRow, on && { borderColor: CARD_NAVY, backgroundColor: CARD_NAVY + "12" }]}
              >
                <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={20} color={on ? CARD_NAVY : theme.color.muted} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.radioLbl, on && { color: CARD_NAVY }]}>{t.label}</Text>
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

        {/* V38V — Pagina pubblica: titolo personalizzato */}
        <Text style={styles.section}>Pagina pubblica (link condiviso)</Text>
        <Field
          label="Testo link (titolo della pagina)"
          testID="bc-link-title"
          value={card.link_title || ""}
          onChange={upd("link_title")}
        />
        <Text style={styles.helperTxt}>
          Es. &quot;Biglietto da visita digitale Emanuele Dal Pastro&quot;. Se vuoto, viene usato il tuo nome.
        </Text>

        {/* V38V — Effetto visivo della pagina pubblica */}
        <Text style={styles.section}>Effetto visivo pagina pubblica</Text>
        <View style={{ gap: 6 }}>
          {[
            { id: "none", label: "Nessuno", hint: "Card statica senza animazione" },
            { id: "shimmer", label: "Shimmer", hint: "Luce diagonale che scorre ogni 10s" },
            { id: "border", label: "Bordo luminoso", hint: "Filo di luce sul perimetro in loop" },
          ].map((e) => {
            const on = (card.visual_effect || "none") === e.id;
            return (
              <Pressable
                key={e.id}
                testID={`bc-effect-${e.id}`}
                onPress={() => save({ visual_effect: e.id as any })}
                style={[styles.radioRow, on && { borderColor: CARD_NAVY, backgroundColor: CARD_NAVY + "12" }]}
              >
                <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={20} color={on ? CARD_NAVY : theme.color.muted} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.radioLbl, on && { color: CARD_NAVY }]}>{e.label}</Text>
                  <Text style={styles.radioHint}>{e.hint}</Text>
                </View>
              </Pressable>
            );
          })}
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.color.border, backgroundColor: theme.color.surfaceSecondary },
  title: { fontSize: 18, fontWeight: "800", color: theme.color.onSurface },
  // Flip container
  flipHint: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 10 },
  flipHintTxt: { fontSize: 11, color: theme.color.muted, fontStyle: "italic" },
  flipWrap: { alignItems: "center", justifyContent: "center" },
  flipContainer: {
    width: CARD_W,
    height: CARD_H,
    // Shadow (native)
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 12,
    // Web-only extra shadow for realism
    ...(Platform.OS === "web" ? { boxShadow: "0 14px 30px rgba(15,23,42,0.25), 0 2px 6px rgba(15,23,42,0.10)" } as any : {}),
  },
  cardFace: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    borderRadius: 14,
    overflow: "hidden",
    backfaceVisibility: "hidden",
  },
  // ==== FRONT ====
  stripesOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  goldBorder: {
    position: "absolute",
    top: 8, left: 8, right: 8, bottom: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: CARD_GOLD,
  },
  logoWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20 },
  logoImg: { width: "70%", height: "70%", tintColor: undefined },
  logoPlaceholder: { alignItems: "center", justifyContent: "center", gap: 6, opacity: 0.7 },
  logoPlaceholderTxt: { color: "rgba(255,255,255,0.7)", fontSize: 11, fontWeight: "700", letterSpacing: 1.5, textTransform: "uppercase" },
  shimmerStreak: {
    position: "absolute",
    top: -20, left: -40,
    width: 90, height: CARD_H + 60,
    backgroundColor: "rgba(255,255,255,0.06)",
    transform: [{ rotate: "-24deg" }, { translateX: 60 }],
  },
  // ==== BACK ====
  cardBack: {
    backgroundColor: CARD_BACK_BG,
    borderWidth: 1, borderColor: "#E5E7EB",
    padding: 18,
    justifyContent: "space-between",
  },
  backContent: { alignItems: "center", gap: 3 },
  backName: { fontSize: 20, fontWeight: "800", color: CARD_NAVY, letterSpacing: 0.2, textAlign: "center" },
  backTitle: { fontSize: 12, fontStyle: "italic", color: CARD_BLUE_MED, marginTop: 1, textAlign: "center" },
  backSeparator: { width: 60, height: 1, backgroundColor: CARD_BLUE_MED, marginTop: 6, marginBottom: 6, opacity: 0.5 },
  backContacts: { alignItems: "center", gap: 2 },
  backContactRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  backContactTxt: { fontSize: 11, color: CARD_TEXT, letterSpacing: 0.2 },
  backFooter: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 10, borderTopWidth: 1, borderTopColor: CARD_BLUE_MED + "40", paddingTop: 8 },
  backCompany: { fontSize: 12, fontWeight: "800", color: CARD_NAVY, letterSpacing: 0.3 },
  backSite: { fontSize: 10, color: CARD_TEXT_MUTED, marginTop: 1 },
  backQr: { width: 62, height: 62, backgroundColor: "#FFF", padding: 3, borderRadius: 4 },
  // Side toggle & share
  sideRow: { flexDirection: "row", gap: 8, marginTop: 14, alignSelf: "center", backgroundColor: "#FFF", borderRadius: 8, padding: 3, borderWidth: 1, borderColor: theme.color.border },
  sideBtn: { paddingHorizontal: 20, paddingVertical: 6, borderRadius: 6 },
  sideBtnOn: { backgroundColor: CARD_NAVY },
  sideBtnTxt: { fontSize: 12, fontWeight: "700", color: theme.color.muted },
  sideBtnTxtOn: { color: "#FFF" },
  shareRow: { flexDirection: "row", gap: 8, marginTop: 14, marginBottom: 6 },
  shareBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, borderRadius: 10 },
  shareTxt: { color: "#FFF", fontWeight: "700", fontSize: 12 },
  // Form
  section: { fontSize: 12, fontWeight: "800", color: theme.color.muted, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 20, marginBottom: 8 },
  label: { fontSize: 12, fontWeight: "600", color: theme.color.muted, marginBottom: 4 },
  input: { backgroundColor: "#FFF", borderWidth: 1, borderColor: theme.color.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: Platform.OS === "ios" ? 10 : 8, fontSize: 14, color: theme.color.onSurface },
  imgBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderStyle: "dashed" },
  imgBtnTxt: { fontWeight: "700", fontSize: 13 },
  clearBtn: { width: 40, alignItems: "center", justifyContent: "center", borderRadius: 8, backgroundColor: "#FEE2E2" },
  radioRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: theme.color.border, backgroundColor: "#FFF" },
  radioLbl: { fontSize: 13, fontWeight: "700", color: theme.color.onSurface },
  radioHint: { fontSize: 11, color: theme.color.muted, marginTop: 1 },
  helperTxt: { fontSize: 11, color: theme.color.muted, marginTop: 6, fontStyle: "italic" },
});

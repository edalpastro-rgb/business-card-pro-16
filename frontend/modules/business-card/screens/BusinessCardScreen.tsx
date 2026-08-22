/**
 * BusinessCardScreen — main screen component of the Business Card module.
 * Behaves EXACTLY like the pre-refactor /business-card route: header,
 * flip preview, hidden HTML mirrors (for share PNG), form fields, QR settings.
 */
import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  TextInput,
  Platform,
  Share,
  Image as RNImage,
  Animated,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import * as Sharing from "expo-sharing";
import QRCode from "react-native-qrcode-svg";
import { captureRef } from "react-native-view-shot";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";
import { isError, isLoading } from "@/src/shared";
import type { BusinessCard, QrType, VisualEffect } from "../types";
import {
  CARD_NAVY,
  CARD_BLUE_MED,
  CARD_GOLD,
  CARD_BACK_BG,
  CARD_TEXT,
  CARD_TEXT_MUTED,
  CARD_W,
  CARD_H,
  QR_TYPES,
  VISUAL_EFFECTS,
} from "../constants";
import { useBusinessCard } from "../hooks/useBusinessCard";
import { injectAnimationCss } from "../lib/injectAnimationCss";
import { computeQrValue } from "../lib/vcard";
import { generateAndShareCardPng } from "../lib/generateShareImage";
import { getPublicShareUrl } from "../api";
import { CardHtmlMirrors } from "../components/CardHtmlMirrors";

export function BusinessCardScreen(): React.ReactElement {
  const router = useRouter();
  const { resource, card, busy, errorMsg, update, save, pickAndSaveLogo } = useBusinessCard();
  const [flipped, setFlipped] = useState(false);
  const [sharing, setSharing] = useState(false);
  // v2.15 — Re-entrance guard: prevents a second tap from running while a
  // share is already in flight (state updates lag one render cycle).
  const sharingRef = useRef(false);
  // v2.15 — Eagerly preload html2canvas on mount so the FIRST tap doesn't
  // pay the ~1s dynamic-import cost that breaks the browser's user-gesture
  // context and makes navigator.share() get denied by Chrome/Safari.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    import("html2canvas").catch(() => {
      /* pre-warm optional — silent fallback keeps the button responsive */
    });
  }, []);
  const cardBackRef = useRef<Animated.View | null>(null);
  const flip = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    injectAnimationCss();
  }, []);

  useEffect(() => {
    Animated.spring(flip, { toValue: flipped ? 1 : 0, useNativeDriver: true, friction: 8, tension: 10 }).start();
  }, [flipped, flip]);

  useEffect(() => {
    if (errorMsg) notify("Errore", errorMsg);
  }, [errorMsg]);

  if (isLoading(resource) || resource.status === "idle") {
    return (
      <SafeAreaView style={styles.root}>
        <ActivityIndicator style={{ marginTop: 40 }} color={CARD_NAVY} />
      </SafeAreaView>
    );
  }
  if (isError(resource)) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={{ padding: 30, alignItems: "center" }}>
          <Text style={{ color: theme.color.error, fontWeight: "700", marginBottom: 10 }}>Errore caricamento biglietto</Text>
          <Text style={{ color: theme.color.muted, textAlign: "center" }}>{resource.error}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const qrValue = computeQrValue(card);
  const frontRotate = flip.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "180deg"] });
  const backRotate = flip.interpolate({ inputRange: [0, 1], outputRange: ["180deg", "360deg"] });

  const shareAsImage = async (): Promise<void> => {
    // v2.15 — Re-entrance guard (state-updates lag by one render frame)
    if (sharingRef.current) return;
    sharingRef.current = true;
    setSharing(true);
    // v2.15 — Fail-safe: guarantee the spinner stops even if a share promise
    // never resolves (some browsers stall nav.share() after user completes).
    const safetyTimer = setTimeout(() => {
      sharingRef.current = false;
      setSharing(false);
    }, 30000);
    try {
      if (Platform.OS === "web") {
        const fileName = `biglietto-${(card.display_name || "master").replace(/\s+/g, "-")}`;
        const r = await generateAndShareCardPng({ fileName });
        if (!r.ok) notify("Errore condivisione", r.error);
        return;
      }
      // Native — captureRef of the back face (front+back combine unsupported on native)
      if (!cardBackRef.current) { notify("Errore", "Preview non trovata"); return; }
      const uri = await captureRef(cardBackRef.current, { format: "png", quality: 1, result: "tmpfile" });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) await Sharing.shareAsync(uri, { mimeType: "image/png", dialogTitle: "Condividi biglietto da visita" });
      else await Share.share({ url: uri, title: "Biglietto da visita" });
    } catch (e) {
      // AbortError = user canceled the native share sheet → NOT an error
      const err = e as Error & { name?: string };
      if (err?.name !== "AbortError") {
        notify("Errore condivisione", err?.message || "");
      }
    } finally {
      clearTimeout(safetyTimer);
      sharingRef.current = false;
      setSharing(false);
    }
  };

  const shareLink = async (): Promise<void> => {
    let cid = card.card_id;
    if (!cid) {
      const saved = await save();
      cid = saved?.card_id || card.card_id;
    }
    if (!cid) { notify("Card non salvata", "Salva prima le modifiche."); return; }
    const link = getPublicShareUrl(cid);
    try { await Clipboard.setStringAsync(link); } catch { /* clipboard optional */ }
    try {
      await Share.share({ message: `${card.display_name || "Biglietto"} - ${link}`, url: link, title: "Biglietto da visita" });
    } catch (e) {
      notify("Errore", e instanceof Error ? e.message : "");
    }
  };

  const upd = (field: keyof BusinessCard) => (v: unknown): void => update({ [field]: v } as Partial<BusinessCard>);

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable testID="bc-back" onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.title}>Biglietto da visita</Text>
        <Pressable testID="bc-save" onPress={() => save()} hitSlop={10}>
          <Ionicons name="save" size={22} color={CARD_NAVY} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
        <View style={styles.flipHint}>
          <Ionicons name="sync-outline" size={14} color={theme.color.muted} />
          <Text style={styles.flipHintTxt}>Tocca il biglietto per ruotarlo • Attualmente: {flipped ? "Retro" : "Fronte"}</Text>
        </View>

        <Pressable testID="bc-flip" onPress={() => setFlipped((f) => !f)} style={styles.flipWrap}>
          <View style={styles.flipContainer} dataSet={Platform.OS === "web" ? { bcGoldpulse: "1" } : undefined}>
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
              <View style={styles.stripesOverlay} pointerEvents="none">
                {Array.from({ length: 22 }).map((_, i) => (
                  <View
                    key={i}
                    style={{
                      position: "absolute", top: -30, left: i * 22 - 60,
                      width: 2, height: CARD_H + 90,
                      backgroundColor: "rgba(255,255,255,0.06)",
                      transform: [{ rotate: "-32deg" }],
                    }}
                  />
                ))}
              </View>
              <View style={styles.goldBorder} pointerEvents="none" />
              <View style={styles.logoWrap}>
                {card.logo_base64 ? (
                  Platform.OS === "web" ? (
                    // V2.2 — On web, use a native <img> tag with explicit transparent
                    // background/border so no implicit "white box" is drawn around the
                    // logo. React-Native-Web's Image renders as a <div> with
                    // background-image which caused a subtle box around the logo.
                    // @ts-expect-error web-only intrinsic
                    <img
                      src={card.logo_base64}
                      alt="logo"
                      style={{
                        width: "70%",
                        height: "70%",
                        objectFit: "contain",
                        background: "transparent",
                        backgroundColor: "transparent",
                        border: "none",
                        boxShadow: "none",
                        outline: "none",
                      }}
                    />
                  ) : (
                    <RNImage source={{ uri: card.logo_base64 }} style={styles.logoImg} resizeMode="contain" />
                  )
                ) : (
                  <View style={styles.logoPlaceholder}>
                    <Ionicons name="business" size={44} color="rgba(255,255,255,0.6)" />
                    <Text style={styles.logoPlaceholderTxt}>Logo Agenzia</Text>
                  </View>
                )}
              </View>
              <View style={styles.shimmerStreak} pointerEvents="none" dataSet={Platform.OS === "web" ? { bcShimmer: "1" } : undefined} />
            </Animated.View>

            {/* BACK */}
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
              <View style={styles.backContent}>
                <Text style={styles.backName} numberOfLines={1}>{card.display_name || "Il tuo nome"}</Text>
                {card.title ? <Text style={styles.backTitle} numberOfLines={1}>{card.title}</Text> : null}
                <View style={styles.backSeparator} />
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
              <View style={styles.backFooter}>
                <View style={{ flex: 1 }}>
                  {card.company_name ? <Text style={styles.backCompany} numberOfLines={1}>{card.company_name}</Text> : null}
                  {card.website ? <Text style={styles.backSite} numberOfLines={1}>{card.website}</Text> : null}
                </View>
                <View style={styles.backQr}>
                  <QRCode value={qrValue || " "} size={54} color={CARD_NAVY} backgroundColor="#FFFFFF" />
                </View>
              </View>
              <View style={styles.shimmerStreak} pointerEvents="none" dataSet={Platform.OS === "web" ? { bcShimmer: "1" } : undefined} />
            </Animated.View>
          </View>
        </Pressable>

        {/* Hidden HTML mirrors for html2canvas capture on web */}
        <CardHtmlMirrors card={card} />

        <View style={styles.sideRow}>
          <Pressable testID="bc-side-front" onPress={() => setFlipped(false)} style={[styles.sideBtn, !flipped && styles.sideBtnOn]}>
            <Text style={[styles.sideBtnTxt, !flipped && styles.sideBtnTxtOn]}>Fronte</Text>
          </Pressable>
          <Pressable testID="bc-side-back" onPress={() => setFlipped(true)} style={[styles.sideBtn, flipped && styles.sideBtnOn]}>
            <Text style={[styles.sideBtnTxt, flipped && styles.sideBtnTxtOn]}>Retro</Text>
          </Pressable>
        </View>

        <View style={styles.shareRow}>
          <Pressable testID="bc-share-image" onPress={shareAsImage} disabled={sharing || busy} style={[styles.shareBtn, { backgroundColor: CARD_NAVY }]}>
            {sharing ? <ActivityIndicator size="small" color="#FFF" /> : <Ionicons name="image" size={18} color="#FFF" />}
            <Text style={styles.shareTxt}>Condividi</Text>
          </Pressable>
          <Pressable testID="bc-share-link" onPress={shareLink} style={[styles.shareBtn, { backgroundColor: "#16A34A" }]}>
            <Ionicons name="link" size={18} color="#FFF" />
            <Text style={styles.shareTxt}>Condividi link</Text>
          </Pressable>
        </View>

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
          <Pressable testID="bc-pick-logo" onPress={() => pickAndSaveLogo("logo_base64")} style={[styles.imgBtn, { borderColor: CARD_NAVY }]}>
            <Ionicons name="image" size={18} color={CARD_NAVY} />
            <Text style={[styles.imgBtnTxt, { color: CARD_NAVY }]}>{card.logo_base64 ? "Cambia logo" : "Aggiungi logo"}</Text>
          </Pressable>
          {card.logo_base64 ? (
            <Pressable testID="bc-clear-logo" onPress={() => save({ logo_base64: "" })} style={styles.clearBtn}>
              <Ionicons name="trash" size={16} color="#DC2626" />
            </Pressable>
          ) : null}
        </View>
        <Text style={styles.helperTxt}>Il logo appare sul <Text style={{ fontWeight: "700" }}>fronte</Text>, grande e centrato in bianco sullo sfondo navy.</Text>

        <Text style={styles.section}>QR Code (retro)</Text>
        <View style={{ gap: 6 }}>
          {QR_TYPES.map((t) => {
            const on = (card.qr_type || "website") === t.id;
            return (
              <Pressable
                key={t.id}
                testID={`bc-qr-type-${t.id}`}
                onPress={() => save({ qr_type: t.id as QrType })}
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
            onChange={(v: string) => card.qr_type === "app" ? upd("demo_app_link")(v) : upd("qr_content")(v)}
            multiline={card.qr_type === "text"}
          />
        )}

        <Text style={styles.section}>Pagina pubblica (link condiviso)</Text>
        <Field label="Testo link (titolo della pagina)" testID="bc-link-title" value={card.link_title || ""} onChange={upd("link_title")} />
        <Text style={styles.helperTxt}>Es. &quot;Biglietto da visita digitale Emanuele Dal Pastro&quot;. Se vuoto, viene usato il tuo nome.</Text>

        <Text style={styles.section}>Effetto visivo pagina pubblica</Text>
        <View style={{ gap: 6 }}>
          {VISUAL_EFFECTS.map((e) => {
            const on = (card.visual_effect || "none") === e.id;
            return (
              <Pressable
                key={e.id}
                testID={`bc-effect-${e.id}`}
                onPress={() => save({ visual_effect: e.id as VisualEffect })}
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

type FieldProps = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  testID: string;
  keyboardType?: "default" | "phone-pad" | "email-address" | "url";
  multiline?: boolean;
};
function Field(props: FieldProps): React.ReactElement {
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput
        testID={props.testID}
        value={props.value}
        onChangeText={props.onChange}
        keyboardType={props.keyboardType}
        multiline={!!props.multiline}
        placeholderTextColor="#94A3B8"
        style={[styles.input, props.multiline && { minHeight: 80, textAlignVertical: "top" }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.color.border, backgroundColor: theme.color.surfaceSecondary },
  title: { fontSize: 18, fontWeight: "800", color: theme.color.onSurface },
  flipHint: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 10 },
  flipHintTxt: { fontSize: 11, color: theme.color.muted, fontStyle: "italic" },
  flipWrap: { alignItems: "center", justifyContent: "center" },
  flipContainer: {
    width: CARD_W,
    height: CARD_H,
    elevation: 10,
    shadowColor: CARD_NAVY,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 14,
    borderRadius: 14,
    ...(Platform.OS === "web" ? { boxShadow: "0 0 0 2px rgba(212,178,106,0.55), 0 0 22px 4px rgba(212,178,106,0.45), 0 14px 34px rgba(15,23,42,0.30), 0 2px 6px rgba(15,23,42,0.12)" } as object : {}),
  },
  cardFace: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: 14, overflow: "hidden", backfaceVisibility: "hidden" },
  stripesOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  goldBorder: { position: "absolute", top: 8, left: 8, right: 8, bottom: 8, borderRadius: 10, borderWidth: 1, borderColor: CARD_GOLD },
  logoWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20, backgroundColor: "transparent" },
  logoImg: { width: "70%", height: "70%", backgroundColor: "transparent" },
  logoPlaceholder: { alignItems: "center", justifyContent: "center", gap: 6, opacity: 0.7 },
  logoPlaceholderTxt: { color: "rgba(255,255,255,0.7)", fontSize: 11, fontWeight: "700", letterSpacing: 1.5, textTransform: "uppercase" },
  shimmerStreak: {
    position: "absolute", top: 0, bottom: 0, width: 90, left: 0,
    backgroundColor: "rgba(255,255,255,0.08)",
    transform: [{ rotate: "-24deg" }, { translateX: 60 }],
    ...(Platform.OS === "web" ? {
      width: "40%", height: "160%", top: -30, left: 0,
      backgroundColor: "transparent",
      backgroundImage: "linear-gradient(120deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.55) 45%, rgba(255,255,255,0.85) 50%, rgba(255,255,255,0.55) 55%, rgba(255,255,255,0) 100%)",
      transform: undefined,
      mixBlendMode: "overlay",
    } as object : {}),
  },
  cardBack: {
    backgroundColor: CARD_BACK_BG,
    borderWidth: 2, borderColor: CARD_NAVY,
    padding: 18,
    justifyContent: "space-between",
    ...(Platform.OS === "web" ? {
      backgroundImage: "linear-gradient(135deg, #FFFFFF 0%, #F5F7FA 55%, #EDEFF3 100%), repeating-linear-gradient(45deg, rgba(26,42,108,0.025) 0 1px, transparent 1px 6px)",
      backgroundBlendMode: "multiply",
    } as object : {}),
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
  sideRow: { flexDirection: "row", gap: 8, marginTop: 14, alignSelf: "center", backgroundColor: "#FFF", borderRadius: 8, padding: 3, borderWidth: 1, borderColor: theme.color.border },
  sideBtn: { paddingHorizontal: 20, paddingVertical: 6, borderRadius: 6 },
  sideBtnOn: { backgroundColor: CARD_NAVY },
  sideBtnTxt: { fontSize: 12, fontWeight: "700", color: theme.color.muted },
  sideBtnTxtOn: { color: "#FFF" },
  shareRow: { flexDirection: "row", gap: 8, marginTop: 14, marginBottom: 6 },
  shareBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, borderRadius: 10 },
  shareTxt: { color: "#FFF", fontWeight: "700", fontSize: 12 },
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

/**
 * V50.l — Libretto Informativo AdvisorOS + AxonOS
 *
 * Schermata full-page con guida operativa completa dell'app.
 * Include pulsante di export PDF (expo-print + expo-sharing) con logo brand.
 */
import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Image,
  ActivityIndicator,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system/legacy";
import { Asset } from "expo-asset";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";
import { LIBRETTO_SECTIONS, LIBRETTO_META, LibrettoSection } from "@/src/libretto/libretto-content";
import { useSafeBottom } from "@/src/hooks/useSafeBottom";

const ADVISOR_LOGO = require("@/assets/images/advisoros-logo-transparent.png");
const AXON_LOGO = require("@/assets/images/axonos-logo-transparent.png");
const ADVISOR_ICON = require("@/assets/images/advisoros-icon-1024.png");

/** Legge un asset locale come base64 per embedderlo nell'HTML del PDF. */
async function assetToBase64(mod: number): Promise<string> {
  try {
    const asset = Asset.fromModule(mod);
    await asset.downloadAsync();
    const uri = asset.localUri || asset.uri;
    if (!uri) return "";
    // Su web l'URI è già HTTP, expo-file-system non serve
    if (Platform.OS === "web") {
      try {
        const resp = await fetch(uri);
        const blob = await resp.blob();
        return await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const r = String(reader.result || "");
            const i = r.indexOf("base64,");
            resolve(i >= 0 ? r.slice(i + 7) : "");
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } catch { return ""; }
    }
    return await FileSystem.readAsStringAsync(uri, { encoding: "base64" as any });
  } catch {
    return "";
  }
}

function buildPdfHtml(logoAdvisorB64: string, logoAxonB64: string): string {
  const dataUri = (b64: string) => (b64 ? `data:image/png;base64,${b64}` : "");
  const cover = `
    <div class="cover">
      <div class="cover-logos">
        ${logoAdvisorB64 ? `<img class="cover-logo" src="${dataUri(logoAdvisorB64)}" />` : ""}
        ${logoAxonB64 ? `<img class="cover-logo" src="${dataUri(logoAxonB64)}" />` : ""}
      </div>
      <div class="cover-title">${LIBRETTO_META.title}</div>
      <div class="cover-sub">${LIBRETTO_META.subtitle}</div>
      <div class="cover-version">${LIBRETTO_META.version}</div>
      <div class="cover-footer">${LIBRETTO_META.footer}</div>
    </div>
  `;

  const toc = `
    <div class="toc page-break">
      <h2>Indice</h2>
      <ol>
        ${LIBRETTO_SECTIONS.map((s) => `<li><span class="toc-em">${s.emoji}</span> ${s.title}</li>`).join("")}
      </ol>
    </div>
  `;

  const sectionsHtml = LIBRETTO_SECTIONS.map((s) => {
    const tips = s.tips
      ? `<ul class="tips">${s.tips.map((t) => `<li><span class="tip-em">${t.emoji}</span> ${t.text}</li>`).join("")}</ul>`
      : "";
    const mockup = s.mockup
      ? `<div class="mockup">
           <div class="mockup-title">${s.mockup.title}</div>
           <pre class="mockup-body">${s.mockup.lines.map((l) => escapeHtml(l)).join("\n")}</pre>
         </div>`
      : "";
    const warning = s.warning ? `<div class="warning">⚠️ ${s.warning}</div>` : "";
    return `
      <section class="sec page-break" style="border-left-color:${s.color}">
        <div class="sec-header" style="background:${s.color}">
          <span class="sec-emoji">${s.emoji}</span>
          <div class="sec-titles">
            <div class="sec-title">${s.title}</div>
            ${s.subtitle ? `<div class="sec-sub">${s.subtitle}</div>` : ""}
          </div>
        </div>
        <div class="sec-body">
          ${s.paragraphs.map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br/>")}</p>`).join("")}
          ${mockup}
          ${tips}
          ${warning}
        </div>
      </section>
    `;
  }).join("");

  return `<!DOCTYPE html><html lang="it"><head><meta charset="utf-8"/>
<title>${LIBRETTO_META.title}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, "Segoe UI", Roboto, Helvetica, sans-serif; color: #0F172A; }
  .page-break { page-break-before: always; }
  .cover {
    width: 100%; min-height: 100vh; padding: 60px 40px;
    background: linear-gradient(160deg, #0F2438 0%, #1C4869 55%, #0F2438 100%);
    color: #FFF; display: flex; flex-direction: column; justify-content: center; align-items: center;
  }
  .cover-logos { display: flex; gap: 32px; align-items: center; margin-bottom: 46px; }
  .cover-logo { max-height: 96px; max-width: 240px; object-fit: contain; }
  .cover-title { font-size: 46px; font-weight: 900; letter-spacing: -1px; text-align: center; margin-bottom: 12px; }
  .cover-sub { font-size: 18px; opacity: 0.85; text-align: center; margin-bottom: 40px; }
  .cover-version { font-size: 13px; color: #FBBF24; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; }
  .cover-footer { position: absolute; bottom: 40px; font-size: 11px; opacity: 0.6; }
  .toc { padding: 40px; }
  .toc h2 { font-size: 30px; color: #1C4869; margin-bottom: 20px; }
  .toc ol { padding-left: 22px; line-height: 2; font-size: 14px; }
  .toc-em { display: inline-block; width: 24px; }
  .sec { border-left: 6px solid #1C4869; margin: 0; }
  .sec-header { padding: 22px 30px; color: #FFF; display: flex; align-items: center; gap: 16px; }
  .sec-emoji { font-size: 40px; line-height: 1; }
  .sec-title { font-size: 22px; font-weight: 900; letter-spacing: -0.3px; }
  .sec-sub { font-size: 13px; opacity: 0.9; margin-top: 4px; }
  .sec-body { padding: 22px 34px 30px; font-size: 13.5px; line-height: 1.65; }
  .sec-body p { margin: 0 0 12px 0; }
  .mockup { background: #0F172A; color: #E2E8F0; border-radius: 10px; padding: 14px 18px; margin: 14px 0; }
  .mockup-title { color: #FBBF24; font-size: 11px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 8px; }
  .mockup-body { font-family: "Menlo", "Consolas", monospace; font-size: 12px; margin: 0; white-space: pre-wrap; }
  .tips { list-style: none; padding: 0; margin: 14px 0 0; }
  .tips li { padding: 8px 12px; margin-bottom: 6px; background: #FEF3C7; border-radius: 8px; font-size: 12.5px; }
  .tip-em { display: inline-block; width: 22px; }
  .warning { margin-top: 14px; padding: 12px 16px; background: #FEF2F2; border-left: 4px solid #DC2626; color: #7F1D1D; font-size: 12.5px; border-radius: 4px; }
</style></head><body>
${cover}
${toc}
${sectionsHtml}
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export default function LibrettoScreen() {
  const router = useRouter();
  const [exporting, setExporting] = useState(false);
  const bottomPad = useSafeBottom();

  const onExport = useCallback(async () => {
    try {
      setExporting(true);
      // 1) Prepara i loghi in base64
      const [logoAdvisor, logoAxon] = await Promise.all([
        assetToBase64(ADVISOR_LOGO),
        assetToBase64(AXON_LOGO),
      ]);
      // 2) Costruisci HTML
      const html = buildPdfHtml(logoAdvisor, logoAxon);
      // 3) Genera PDF
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      // 4) Condividi
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, {
          mimeType: "application/pdf",
          dialogTitle: "Libretto Informativo AdvisorOS",
          UTI: "com.adobe.pdf",
        });
      } else if (Platform.OS === "web") {
        // Su web: apri in nuova tab
        (globalThis as any).window.open(uri, "_blank");
      } else {
        notify("PDF pronto", `Salvato in: ${uri}`);
      }
    } catch (e: any) {
      notify("Errore export", e?.message || "Impossibile creare il PDF");
    } finally {
      setExporting(false);
    }
  }, []);

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      {/* Header */}
      <View style={styles.headerBar}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color="#FFF" />
        </Pressable>
        <Text style={styles.headerTitle}>Libretto Informativo</Text>
        <Pressable
          onPress={onExport}
          disabled={exporting}
          style={[styles.pdfBtn, exporting && { opacity: 0.6 }]}
          testID="libretto-pdf-btn"
        >
          {exporting ? (
            <ActivityIndicator color="#FFF" size="small" />
          ) : (
            <>
              <Ionicons name="download" size={16} color="#FFF" />
              <Text style={styles.pdfBtnTxt}>PDF</Text>
            </>
          )}
        </Pressable>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPad + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Cover */}
        <View style={styles.cover}>
          <View style={styles.coverLogos}>
            <Image source={ADVISOR_LOGO} style={styles.coverLogo} resizeMode="contain" />
            <Image source={AXON_LOGO} style={styles.coverLogo} resizeMode="contain" />
          </View>
          <Text style={styles.coverTitle}>{LIBRETTO_META.title}</Text>
          <Text style={styles.coverSub}>{LIBRETTO_META.subtitle}</Text>
          <View style={styles.coverBadge}>
            <Text style={styles.coverBadgeTxt}>{LIBRETTO_META.version}</Text>
          </View>
        </View>

        {/* Sezioni */}
        {LIBRETTO_SECTIONS.map((s) => (
          <SectionCard key={s.id} section={s} />
        ))}

        {/* Footer */}
        <View style={styles.footerBox}>
          <Image source={ADVISOR_ICON} style={styles.footerIcon} resizeMode="contain" />
          <Text style={styles.footerTxt}>{LIBRETTO_META.footer}</Text>
          <Text style={styles.footerTxt}>Per assistenza: support@advisoros.it</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function SectionCard({ section }: { section: LibrettoSection }) {
  return (
    <View style={styles.sec}>
      <View style={[styles.secHeader, { backgroundColor: section.color }]}>
        <Text style={styles.secEmoji}>{section.emoji}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.secTitle}>{section.title}</Text>
          {section.subtitle ? <Text style={styles.secSub}>{section.subtitle}</Text> : null}
        </View>
      </View>
      <View style={styles.secBody}>
        {section.paragraphs.map((p, i) => (
          <Text key={i} style={styles.secP}>
            {p}
          </Text>
        ))}
        {section.mockup ? (
          <View style={styles.mockup}>
            <Text style={styles.mockupTitle}>{section.mockup.title}</Text>
            {section.mockup.lines.map((line, i) => (
              <Text key={i} style={styles.mockupLine}>
                {line}
              </Text>
            ))}
          </View>
        ) : null}
        {section.tips?.length ? (
          <View style={styles.tips}>
            {section.tips.map((t, i) => (
              <View key={i} style={styles.tip}>
                <Text style={styles.tipEmoji}>{t.emoji}</Text>
                <Text style={styles.tipTxt}>{t.text}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {section.warning ? (
          <View style={styles.warning}>
            <Ionicons name="warning" size={16} color="#DC2626" />
            <Text style={styles.warningTxt}>{section.warning}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0F2438" },
  headerBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#0F2438",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  backBtn: { padding: 6 },
  headerTitle: { color: "#FFF", fontSize: 16, fontWeight: "900" },
  pdfBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#EA580C",
    minWidth: 76,
    justifyContent: "center",
  },
  pdfBtnTxt: { color: "#FFF", fontWeight: "900", fontSize: 13 },
  scroll: { flex: 1, backgroundColor: "#F8FAFC" },
  scrollContent: { paddingBottom: 60 },
  // Cover
  cover: {
    paddingVertical: 40,
    paddingHorizontal: 24,
    backgroundColor: "#0F2438",
    alignItems: "center",
  },
  coverLogos: { flexDirection: "row", gap: 22, alignItems: "center", marginBottom: 28 },
  coverLogo: { width: 130, height: 60 },
  coverTitle: {
    color: "#FFF",
    fontSize: 30,
    fontWeight: "900",
    letterSpacing: -0.8,
    textAlign: "center",
  },
  coverSub: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 14,
    textAlign: "center",
    marginTop: 6,
    marginBottom: 20,
  },
  coverBadge: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(251,191,36,0.15)",
    borderWidth: 1,
    borderColor: "#FBBF24",
  },
  coverBadgeTxt: { color: "#FBBF24", fontSize: 11, fontWeight: "800", letterSpacing: 1.5 },
  // Sezioni
  sec: {
    marginHorizontal: 12,
    marginTop: 14,
    backgroundColor: "#FFF",
    borderRadius: 14,
    overflow: "hidden",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  secHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  secEmoji: { fontSize: 30 },
  secTitle: { color: "#FFF", fontSize: 17, fontWeight: "900", letterSpacing: -0.3 },
  secSub: { color: "rgba(255,255,255,0.9)", fontSize: 12, marginTop: 3 },
  secBody: { padding: 18 },
  secP: { fontSize: 13.5, lineHeight: 21, color: "#0F172A", marginBottom: 10 },
  mockup: {
    backgroundColor: "#0F172A",
    borderRadius: 10,
    padding: 14,
    marginTop: 8,
    marginBottom: 6,
  },
  mockupTitle: {
    color: "#FBBF24",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.5,
    marginBottom: 8,
    textTransform: "uppercase",
  },
  mockupLine: {
    color: "#E2E8F0",
    fontSize: 12,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    lineHeight: 18,
  },
  tips: { marginTop: 10, gap: 6 },
  tip: {
    flexDirection: "row",
    gap: 8,
    padding: 10,
    borderRadius: 10,
    backgroundColor: "#FEF3C7",
  },
  tipEmoji: { fontSize: 16 },
  tipTxt: { flex: 1, fontSize: 12.5, color: "#78350F", lineHeight: 18 },
  warning: {
    marginTop: 12,
    flexDirection: "row",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    backgroundColor: "#FEF2F2",
    borderLeftWidth: 4,
    borderLeftColor: "#DC2626",
    alignItems: "flex-start",
  },
  warningTxt: { flex: 1, fontSize: 12.5, color: "#7F1D1D", lineHeight: 18 },
  // Footer
  footerBox: {
    alignItems: "center",
    padding: 30,
    marginTop: 20,
    gap: 8,
  },
  footerIcon: { width: 60, height: 60, borderRadius: 12, marginBottom: 6 },
  footerTxt: { fontSize: 11, color: theme.color.muted, textAlign: "center" },
});

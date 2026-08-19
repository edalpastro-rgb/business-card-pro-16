import React, { useEffect, useState, useCallback, useRef } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView, Platform, Linking, TextInput, Modal } from "react-native";
import Svg, { Rect, Text as SvgText, Line } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as Print from "expo-print";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { notify, confirmAsync } from "@/src/utils/notify";
import { uriToBase64 } from "@/src/utils/media";
import { CalculatorFAB } from "@/src/CalculatorFAB";
import { VoiceDictationButton } from "@/src/VoiceDictationButton";
import { BillFieldRow } from "@/src/BillFieldRenderers";
import { SaveConfirmModal, suggestFileName } from "@/src/SaveConfirmModal";

type BillType = "luce" | "gas" | "telco";
export type QuickBillType = BillType;

type Bill = {
  bill_id: string;
  contact_id: string;
  bill_type: BillType;
  pdf_name: string;
  pdf_size?: number;
  status: "pending" | "analyzing" | "done" | "error" | "cancelled";
  error_message?: string | null;
  extracted?: Record<string, any> | null;
  analysis_params?: string[] | null;
  created_at: string;
  analyzed_at?: string | null;
};

type Grouped = { luce: Bill[]; gas: Bill[]; telco: Bill[] };

const SECTION_META: Record<BillType, { label: string; icon: any; color: string; emoji: string }> = {
  luce: { label: "Luce", icon: "flash", color: "#F59E0B", emoji: "💡" },
  gas: { label: "Gas", icon: "flame", color: "#DC2626", emoji: "🔥" },
  telco: { label: "Telco", icon: "call", color: "#0891B2", emoji: "📞" },
};

const STATUS_META = {
  pending: { label: "In coda…", color: "#6B7280", icon: "hourglass-outline" as const },
  analyzing: { label: "Analisi in corso…", color: "#0891B2", icon: "sync" as const },
  done: { label: "Analizzata", color: "#16A34A", icon: "checkmark-circle" as const },
  error: { label: "Errore", color: "#DC2626", icon: "warning" as const },
  cancelled: { label: "Annullata", color: "#78716C", icon: "close-circle" as const },
};

// V38 — Default analysis parameters per bill type. Each has: id, label, default checked
export type ParamDef = { id: string; label: string; defaultOn: boolean };
export const DEFAULT_PARAMS: Record<BillType, ParamDef[]> = {
  luce: [
    { id: "fornitore", label: "Fornitore", defaultOn: true },
    { id: "pod", label: "POD", defaultOn: true },
    { id: "spread", label: "Spread €/kWh", defaultOn: true },
    { id: "prezzo_energia", label: "Prezzo energia €/kWh", defaultOn: true },
    { id: "consumi_f1", label: "Consumi F1 (kWh)", defaultOn: true },
    { id: "consumi_f2", label: "Consumi F2 (kWh)", defaultOn: true },
    { id: "consumi_f3", label: "Consumi F3 (kWh)", defaultOn: true },
    { id: "consumo_annuo", label: "Consumo totale 12 mesi", defaultOn: true },
    { id: "potenza", label: "Potenza impegnata (kW)", defaultOn: true },
    { id: "tensione", label: "Tensione", defaultOn: false },
    { id: "costi_fissi", label: "Costi fissi mensili", defaultOn: true },
    { id: "iva", label: "IVA %", defaultOn: false },
    { id: "asos", label: "Oneri ASOS/ARIM", defaultOn: true },
    { id: "durata_contratto", label: "Durata contratto", defaultOn: true },
    { id: "penale_disdetta", label: "Penale disdetta", defaultOn: true },
    { id: "scadenza", label: "Data scadenza", defaultOn: true },
    { id: "importo_totale", label: "Importo totale", defaultOn: true },
  ],
  gas: [
    { id: "fornitore", label: "Fornitore", defaultOn: true },
    { id: "pdr", label: "PDR", defaultOn: true },
    { id: "spread", label: "Spread €/SMC", defaultOn: true },
    { id: "prezzo_gas", label: "Prezzo gas €/SMC", defaultOn: true },
    { id: "consumo_annuo_smc", label: "Consumo annuo SMC", defaultOn: true },
    { id: "accisa", label: "Accisa €/SMC", defaultOn: true },
    { id: "costi_fissi", label: "Costi fissi mensili", defaultOn: true },
    { id: "iva", label: "IVA %", defaultOn: false },
    { id: "durata_contratto", label: "Durata contratto", defaultOn: true },
    { id: "penale_disdetta", label: "Penale disdetta", defaultOn: true },
    { id: "scadenza", label: "Data scadenza", defaultOn: true },
    { id: "importo_totale", label: "Importo totale", defaultOn: true },
  ],
  telco: [
    { id: "fornitore", label: "Fornitore", defaultOn: true },
    { id: "numero_telefono", label: "Numero telefono", defaultOn: true },
    { id: "costo_mensile", label: "Costo mensile", defaultOn: true },
    { id: "costo_annuale", label: "Costo annuale", defaultOn: true },
    { id: "velocita_download", label: "Velocità download (Mbps)", defaultOn: true },
    { id: "velocita_upload", label: "Velocità upload (Mbps)", defaultOn: true },
    { id: "servizi_inclusi", label: "Servizi inclusi", defaultOn: true },
    { id: "durata_contratto", label: "Durata contratto", defaultOn: true },
    { id: "penale_disdetta", label: "Penale disdetta", defaultOn: true },
    { id: "codice_migrazione", label: "Codice migrazione", defaultOn: false },
    { id: "scadenza", label: "Data scadenza", defaultOn: true },
  ],
};

type Offer = {
  offer_id: string;
  bill_type: BillType;
  label: string;
  pdf_name: string;
  status: "pending" | "analyzing" | "done" | "error";
  error_message?: string | null;
  extracted?: Record<string, any> | null;
  created_at: string;
};

export function BillsSection({ contactId, contactName, onContactFilesChanged }: { contactId: string; contactName?: string; onContactFilesChanged?: () => void }) {
  const [grouped, setGrouped] = useState<Grouped>({ luce: [], gas: [], telco: [] });
  const [offers, setOffers] = useState<Offer[]>([]);
  const [showOffers, setShowOffers] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<BillType | null>(null);
  const [uploadingOffer, setUploadingOffer] = useState<BillType | null>(null);
  // V26.q — testo condizioni economiche manuale + microfono per categoria
  const [manualTxt, setManualTxt] = useState<Record<BillType, string>>({ luce: "", gas: "", telco: "" });
  const [savingManual, setSavingManual] = useState<BillType | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [reportBusy, setReportBusy] = useState(false);
  const [comparisonBusy, setComparisonBusy] = useState(false);
  // V38 — pending upload waiting for user parameter selection
  const [pendingUpload, setPendingUpload] = useState<null | { bill_type: BillType; asset: { name?: string; mimeType?: string; uri: string } }>(null);
  const [selectedParams, setSelectedParams] = useState<Set<string>>(new Set());
  const [customParam, setCustomParam] = useState("");
  const [customParams, setCustomParams] = useState<string[]>([]);
  // V38E — source picker (device vs contact files)
  const [sourcePickerBillType, setSourcePickerBillType] = useState<BillType | null>(null);
  const [contactFilesPicker, setContactFilesPicker] = useState<null | { bill_type: BillType }>(null);
  const [contactPdfFiles, setContactPdfFiles] = useState<any[]>([]);
  const [loadingContactFiles, setLoadingContactFiles] = useState(false);
  // V38I — Branding (logo + agency name) applied to generated PDFs
  const [branding, setBranding] = useState<{ agency_name: string; logo_base64: string }>({ agency_name: "", logo_base64: "" });
  // V38R — Save-confirm modal state (name confirmation before writing to files)
  const [saveConfirm, setSaveConfirm] = useState<null | {
    kind: "bill-analysis" | "report" | "comparison";
    defaultName: string;
    ext: string;
    color: string;
    subtitle: string;
    run: (name: string) => Promise<void>;
  }>(null);

  // Load user branding once — used in cover of comparison PDF and header of report PDF.
  useEffect(() => {
    api<{ user: any }>("/auth/me")
      .then((r) => {
        const u = r?.user || {};
        setBranding({
          agency_name: String(u.company_name || u.name || "").trim(),
          logo_base64: String(u.company_logo_base64 || "").trim(),
        });
      })
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    try {
      const [r, ro] = await Promise.all([
        api<{ grouped: Grouped }>(`/contacts/${contactId}/bills`),
        api<{ items: Offer[] }>(`/company-offers`),
      ]);
      setGrouped(r.grouped);
      setOffers(ro.items || []);
    } catch (e: any) {
      console.warn("bills load", e?.message);
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-refresh while any bill/offer is pending/analyzing
  useEffect(() => {
    const flatBills: Bill[] = [...grouped.luce, ...grouped.gas, ...grouped.telco];
    const anyActive = flatBills.some((b) => b.status === "pending" || b.status === "analyzing")
      || offers.some((o) => o.status === "pending" || o.status === "analyzing");
    if (!anyActive) return;
    const t = setInterval(load, 3500);
    return () => clearInterval(t);
  }, [grouped, offers, load]);

  // V38R — Removed auto-save on effect. Saving to the contact's file cabinet
  // is now an EXPLICIT action via the "Salva sul cliente" button per bill
  // (opens SaveConfirmModal so the user can rename before persisting).

  const uploadOffer = async (bill_type: BillType) => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: "application/pdf",
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      setUploadingOffer(bill_type);
      const b64 = await uriToBase64(asset.uri);
      const bytes = Math.round((b64.length * 3) / 4);
      if (bytes > 12 * 1024 * 1024) { notify("PDF troppo grande", "Max 12 MB."); setUploadingOffer(null); return; }
      await api(`/company-offers`, {
        method: "POST",
        body: {
          bill_type,
          pdf_base64: b64,
          pdf_name: asset.name || `offerta-${bill_type}.pdf`,
          pdf_mime: asset.mimeType || "application/pdf",
          label: asset.name?.replace(/\.pdf$/i, "") || `Offerta ${bill_type}`,
        },
      });
      await load();
    } catch (e: any) {
      notify("Errore caricamento offerta", e?.message || "");
    } finally {
      setUploadingOffer(null);
    }
  };

  // V26.q — salva un'offerta con testo manuale (senza PDF)
  const saveManualOffer = async (bill_type: BillType) => {
    const text = (manualTxt[bill_type] || "").trim();
    if (text.length < 20) {
      notify("Testo troppo corto", "Inserisci almeno 20 caratteri per l'analisi AI.");
      return;
    }
    setSavingManual(bill_type);
    try {
      await api("/company-offers", {
        method: "POST",
        body: {
          bill_type,
          manual_text: text,
          label: `Offerta ${bill_type} (manuale)`,
        },
      });
      setManualTxt((m) => ({ ...m, [bill_type]: "" }));
      await load();
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile salvare");
    } finally {
      setSavingManual(null);
    }
  };


  const deleteOffer = (offer: Offer) => {
    notify("Elimina offerta", `Rimuovere "${offer.label || offer.pdf_name}"?`, [
      { text: "Annulla", style: "cancel" },
      { text: "Elimina", style: "destructive", onPress: async () => {
        try { await api(`/company-offers/${offer.offer_id}`, { method: "DELETE" }); await load(); }
        catch (e: any) { notify("Errore", e?.message || ""); }
      }},
    ]);
  };

  // V38: Render HTML to PDF/print without opening any popup window.
  // On web: create an offscreen iframe, print, then remove. Also offer a download fallback.
  const printHtmlOnWeb = (html: string, downloadName: string) => {
    const win = (globalThis as any).window;
    const doc: any = win?.document;
    if (!win || !doc) return;
    const iframe = doc.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.setAttribute("aria-hidden", "true");
    doc.body.appendChild(iframe);
    const cw = iframe.contentWindow;
    const cd = iframe.contentDocument || cw?.document;
    if (!cd) { doc.body.removeChild(iframe); return; }
    cd.open();
    cd.write(html);
    cd.close();
    const doPrint = () => {
      try {
        cw?.focus();
        cw?.print();
      } catch {}
      // Remove after a longer delay to let print dialog settle
      setTimeout(() => { try { doc.body.removeChild(iframe); } catch {} }, 4000);
    };
    // Wait for content to load
    if (cd.readyState === "complete") {
      setTimeout(doPrint, 250);
    } else {
      iframe.onload = () => setTimeout(doPrint, 250);
    }
    // Also offer a download fallback in case the print dialog is blocked
    try {
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = doc.createElement("a");
      a.href = url;
      a.download = downloadName.replace(/\.pdf$/i, ".html");
      a.style.display = "none";
      doc.body.appendChild(a);
      // Only auto-download on browsers that block print — skip for now, user can use print dialog "save as PDF"
      setTimeout(() => { try { doc.body.removeChild(a); URL.revokeObjectURL(url); } catch {} }, 60_000);
    } catch {}
  };

  // V38G — Save a base64 file to the contact's files array ONLY if a file with
  // the same name doesn't already exist. Returns true if saved, false if skipped.
  const saveFileToContactIfNew = async (name: string, mime: string, data_base64: string): Promise<boolean> => {
    if (!contactId) return false;
    try {
      // Check existing files (uses the light /contacts/{id} GET which returns files)
      const c = await api<any>(`/contacts/${contactId}`);
      const existing: any[] = Array.isArray(c?.files) ? c.files : [];
      if (existing.some((f: any) => (f?.name || "").toLowerCase() === name.toLowerCase())) {
        return false;
      }
      const bytes = Math.round((data_base64.length * 3) / 4);
      await api(`/contacts/${contactId}/files`, {
        method: "POST",
        body: { name, mime, data_base64, size: bytes },
      });
      // Notify parent that contact.files changed so its state stays in sync.
      try { onContactFilesChanged?.(); } catch {}
      return true;
    } catch (e) {
      console.warn("saveFileToContactIfNew err", e);
      return false;
    }
  };

  // V38G — Build a printable HTML report of a single bill's AI extraction.
  const buildBillAnalysisHtml = (bill: Bill, name: string): string => {
    const ex = (bill.extracted || {}) as Record<string, any>;
    const btMeta = SECTION_META[bill.bill_type as BillType] || SECTION_META.luce;
    const generated = new Date(bill.analyzed_at || bill.created_at || Date.now()).toLocaleString("it-IT");

    const escHtml = (s: any) => String(s ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");

    const renderValue = (v: any): string => {
      if (v === null || v === undefined || v === "") return "—";
      if (typeof v === "boolean") return v ? "Sì" : "No";
      if (typeof v === "number") return String(v);
      if (Array.isArray(v)) {
        if (!v.length) return "—";
        return `<ul style="margin:0;padding-left:18px;">${v.map((it) => `<li>${typeof it === "object" ? escHtml(JSON.stringify(it)) : escHtml(it)}</li>`).join("")}</ul>`;
      }
      if (typeof v === "object") {
        const kv = Object.entries(v).map(([k, val]) => `<tr><td style="padding:4px 8px;color:#64748B;font-size:11px;">${escHtml(k)}</td><td style="padding:4px 8px;font-size:12px;">${renderValue(val)}</td></tr>`).join("");
        return `<table style="border-collapse:collapse;width:100%;">${kv}</table>`;
      }
      return escHtml(v);
    };

    const rows = Object.entries(ex)
      .filter(([k]) => !["raw_text_preview", "parse_error"].includes(k))
      .map(([k, v]) => {
        // V38Q — render monthly consumption as SVG chart embedded in the KV table.
        if ((k === "consumi_mensili_kwh" || k === "consumi_mensili_smc") && v) {
          const unit = k === "consumi_mensili_kwh" ? "kWh" : "SMC";
          const svg = renderConsumiSvg(v, unit, btMeta.color);
          if (svg) {
            const label = k.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
            return `<tr>
              <td style="padding:10px 12px;background:#F8FAFC;border-bottom:1px solid #E2E8F0;font-weight:700;color:#0F172A;font-size:12px;width:38%;vertical-align:top;">${escHtml(label)}</td>
              <td style="padding:10px 12px;background:#FFF;border-bottom:1px solid #E2E8F0;font-size:12px;color:#0F172A;vertical-align:top;">${svg}</td>
            </tr>`;
          }
        }
        // V38Q — render note_ai as bulleted list even in the saved analysis
        if (k === "note_ai") {
          const items = normalizeNotes(v);
          if (items.length > 0) {
            const ul = `<ul style="margin:0 0 0 18px;padding:0;">${items.map((it) => `<li style="font-size:11px;margin-bottom:3px;line-height:1.4;">${escHtml(it)}</li>`).join("")}</ul>`;
            const label = "Note AI";
            return `<tr>
              <td style="padding:10px 12px;background:#F8FAFC;border-bottom:1px solid #E2E8F0;font-weight:700;color:#0F172A;font-size:12px;width:38%;vertical-align:top;">${escHtml(label)}</td>
              <td style="padding:10px 12px;background:#FFF;border-bottom:1px solid #E2E8F0;font-size:12px;color:#0F172A;vertical-align:top;">${ul}</td>
            </tr>`;
          }
        }
        const label = k.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
        return `<tr>
          <td style="padding:10px 12px;background:#F8FAFC;border-bottom:1px solid #E2E8F0;font-weight:700;color:#0F172A;font-size:12px;width:38%;vertical-align:top;">${escHtml(label)}</td>
          <td style="padding:10px 12px;background:#FFF;border-bottom:1px solid #E2E8F0;font-size:12px;color:#0F172A;vertical-align:top;">${renderValue(v)}</td>
        </tr>`;
      }).join("");

    const params = Array.isArray(bill.analysis_params) ? bill.analysis_params : [];
    const paramsBadges = params.length
      ? `<div style="margin:14px 0 6px;">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#6B7280;margin-bottom:4px;">Parametri richiesti dall'operatore</div>
          <div style="display:flex;flex-wrap:wrap;gap:4px;">
            ${params.map((p: string) => `<span style="display:inline-block;padding:2px 8px;border-radius:10px;background:#EDE9FE;color:#5B21B6;font-size:10px;font-weight:700;">${escHtml(p)}</span>`).join("")}
          </div>
        </div>`
      : "";

    return `<!DOCTYPE html>
<html lang="it"><head><meta charset="UTF-8"/>
<title>Analisi Fattura ${escHtml(bill.bill_type.toUpperCase())} — ${escHtml(name)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; color: #0F172A; margin: 28px; }
  h1 { color: ${btMeta.color}; margin: 0 0 4px; font-size: 22px; }
  .subtitle { color: #6B7280; font-size: 12px; margin-bottom: 14px; }
  .banner { background: linear-gradient(135deg, ${btMeta.color}, ${btMeta.color}CC); color: #FFF; padding: 14px 18px; border-radius: 10px; margin-bottom: 18px; display: flex; align-items: center; gap: 12px; }
  .banner-emoji { font-size: 26px; }
  .banner-text { flex: 1; }
  .banner-title { font-size: 16px; font-weight: 900; }
  .banner-sub { font-size: 11px; opacity: 0.92; margin-top: 2px; }
  table.kv { width: 100%; border-collapse: collapse; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
  .footer { margin-top: 24px; padding-top: 12px; border-top: 1px solid #E5E7EB; font-size: 10px; color: #9CA3AF; text-align: center; }
</style>
</head>
<body>
  <h1>📄 Analisi Fattura ${escHtml(btMeta.label)}</h1>
  <div class="subtitle"><b>Cliente:</b> ${escHtml(name)} &nbsp;·&nbsp; <b>Documento:</b> ${escHtml(bill.pdf_name)} &nbsp;·&nbsp; <b>Analizzata:</b> ${escHtml(generated)}</div>
  <div class="banner">
    <div class="banner-emoji">${btMeta.emoji}</div>
    <div class="banner-text">
      <div class="banner-title">${escHtml(ex.fornitore || "—")}</div>
      <div class="banner-sub">${escHtml(ex.nome_offerta || ex.tipo_offerta || "Offerta non specificata")}</div>
    </div>
  </div>
  ${paramsBadges}
  ${rows ? `<table class="kv">${rows}</table>` : "<p><i>Nessun dato estratto.</i></p>"}
  <div class="footer">Report AI generato automaticamente con Claude Sonnet 5 · Dal Pastro CRM</div>
</body></html>`;
  };

  // V38G — Auto-save the analysis PDF of a bill (fires once per bill_id per session).
  // V38Q — mark the ref BEFORE the async save so concurrent effect fires don't
  // schedule the same save twice (previously the ref was updated after await,
  // causing duplicate copies to appear in the contact's file section).
  // V38R — Save the analysis HTML/PDF using a user-provided filename.
  // Called from the SaveConfirmModal ("Salva sul cliente" button).
  const analysisSavedRef = useRef<Set<string>>(new Set());
  const autoSaveGuardRef = useRef<Set<string>>(new Set());
  const saveBillAnalysisWithName = async (bill: Bill, chosenName: string) => {
    if (!contactId || bill.status !== "done") return false;
    // Do not trip the guard here — the modal is explicit, user may want to
    // re-save with a different name.
    try {
      if (Platform.OS === "web") {
        const html = buildBillAnalysisHtml(bill, contactName || "Cliente");
        const bytes = new TextEncoder().encode(html);
        let bin = "";
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        const b64 = (globalThis as any).btoa(bin);
        const name = chosenName.toLowerCase().endsWith(".html") ? chosenName : chosenName.replace(/\.pdf$/i, "") + ".html";
        const saved = await saveFileToContactIfNew(name, "text/html", b64);
        if (saved) notify("Analisi salvata ✅", `${name} è nei File del cliente.`);
        return saved;
      } else {
        const html = buildBillAnalysisHtml(bill, contactName || "Cliente");
        const { uri } = await Print.printToFileAsync({ html });
        const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        const name = chosenName.toLowerCase().endsWith(".pdf") ? chosenName : `${chosenName}.pdf`;
        const saved = await saveFileToContactIfNew(name, "application/pdf", b64);
        if (saved) notify("Analisi salvata ✅", `${name} è nei File del cliente.`);
        return saved;
      }
    } catch (e) {
      console.warn("saveBillAnalysisWithName err", e);
      notify("Errore salvataggio", (e as any)?.message || "");
      return false;
    }
  };

  // V38G legacy — kept as no-op fallback in case any external caller depended on it.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const autoSaveBillAnalysis = async (_bill: Bill) => { /* deprecated in V38R */ };

  // V38F — Save generated HTML/PDF to contact files.
  // V38R — Now accepts explicit filename (from SaveConfirmModal).
  const saveReportWithName = async (html: string, chosenName: string) => {
    if (!contactId) return false;
    try {
      if (Platform.OS === "web") {
        const enc = (globalThis as any).TextEncoder ? new TextEncoder() : null;
        let b64: string;
        if (enc) {
          const bytes = enc.encode(html);
          let bin = "";
          for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
          b64 = (globalThis as any).btoa(bin);
        } else {
          b64 = (globalThis as any).btoa(unescape(encodeURIComponent(html)));
        }
        const name = chosenName.toLowerCase().endsWith(".html") ? chosenName : `${chosenName.replace(/\.pdf$/i, "")}.html`;
        const saved = await saveFileToContactIfNew(name, "text/html", b64);
        if (saved) notify("Salvato ✅", `${name} è nei File del cliente.`);
        return saved;
      } else {
        const { uri } = await Print.printToFileAsync({ html });
        const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        const name = chosenName.toLowerCase().endsWith(".pdf") ? chosenName : `${chosenName}.pdf`;
        const saved = await saveFileToContactIfNew(name, "application/pdf", b64);
        if (saved) notify("Salvato ✅", `${name} è nei File del cliente.`);
        return saved;
      }
    } catch (e: any) {
      console.warn("saveReportWithName err", e);
      notify("Errore salvataggio", e?.message || "");
      return false;
    }
  };

  // Legacy no-op kept so nothing breaks (older calls become explicit modal flows)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const autoSaveToContactFiles = async (_html: string, _kind: "report" | "comparison") => { /* deprecated V38R */ };

  const generateComparison = async () => {
    try {
      setComparisonBusy(true);
      const rep = await api<any>(`/contacts/${contactId}/bills/comparison`);
      const html = buildComparisonHtml(rep, contactName, branding);
      // V38R — Ask user to confirm the filename before saving.
      setSaveConfirm({
        kind: "comparison",
        defaultName: suggestFileName(contactName, "Comparazione Fatture"),
        ext: Platform.OS === "web" ? ".html" : ".pdf",
        color: "#7C3AED",
        subtitle: "Salva questa comparazione nei File del cliente",
        run: async (name: string) => { await saveReportWithName(html, name); },
      });
      if (Platform.OS === "web") {
        printHtmlOnWeb(html, `confronto-${contactName || "cliente"}.pdf`);
        return;
      }
      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf" });
      }
    } catch (e: any) {
      notify("Errore comparazione", e?.message || "");
    } finally {
      setComparisonBusy(false);
    }
  };

  // V38E: Entry point — opens the source picker (device vs contact files).
  const uploadPdf = (bill_type: BillType) => {
    setSourcePickerBillType(bill_type);
  };

  // Legacy device pick flow (moved out of uploadPdf so we can reuse from source picker)
  const pickFromDevice = async (bill_type: BillType) => {
    setSourcePickerBillType(null);
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: "application/pdf",
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      openParamsModalFor(bill_type, { name: asset.name, mimeType: asset.mimeType, uri: asset.uri });
    } catch (e: any) {
      console.warn("upload bill err", e);
      notify("Errore caricamento", e?.message || "Impossibile caricare la fattura");
    }
  };

  const openParamsModalFor = (bill_type: BillType, asset: { name?: string; mimeType?: string; uri: string }) => {
    const defaults = new Set<string>(DEFAULT_PARAMS[bill_type].filter((p) => p.defaultOn).map((p) => p.label));
    setSelectedParams(defaults);
    setCustomParams([]);
    setCustomParam("");
    setPendingUpload({ bill_type, asset });
  };

  // V38E — Pick from files already attached to the contact
  const pickFromContactFiles = async (bill_type: BillType) => {
    setSourcePickerBillType(null);
    setContactFilesPicker({ bill_type });
    setLoadingContactFiles(true);
    try {
      const c = await api<any>(`/contacts/${contactId}`);
      const files: any[] = Array.isArray(c?.files) ? c.files : [];
      // Filter to PDFs only
      const pdfs = files.filter((f: any) => {
        const mime = String(f.mime || "").toLowerCase();
        const name = String(f.name || "").toLowerCase();
        return mime.includes("pdf") || name.endsWith(".pdf");
      });
      setContactPdfFiles(pdfs);
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile caricare i file del cliente");
      setContactPdfFiles([]);
    } finally {
      setLoadingContactFiles(false);
    }
  };

  const selectContactFileAsBill = (f: any) => {
    if (!contactFilesPicker) return;
    const bill_type = contactFilesPicker.bill_type;
    setContactFilesPicker(null);
    // Build a synthetic "asset" that carries the already-loaded base64 directly.
    // We stash the raw base64 in a special uri prefix so the confirm handler can pick it.
    const asset = {
      name: f.name || `fattura-${bill_type}.pdf`,
      mimeType: f.mime || "application/pdf",
      uri: `contactfile://${f.id}`,
      _base64: f.data_base64 || "",
    } as any;
    openParamsModalFor(bill_type, asset);
  };

  const toggleParam = (label: string) => {
    setSelectedParams((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label); else next.add(label);
      return next;
    });
  };

  const addCustomParam = () => {
    const p = customParam.trim();
    if (!p) return;
    if (customParams.includes(p) || selectedParams.has(p)) {
      setCustomParam("");
      return;
    }
    setCustomParams((prev) => [...prev, p]);
    setSelectedParams((prev) => new Set(prev).add(p));
    setCustomParam("");
  };

  const removeCustomParam = (p: string) => {
    setCustomParams((prev) => prev.filter((x) => x !== p));
    setSelectedParams((prev) => {
      const next = new Set(prev);
      next.delete(p);
      return next;
    });
  };

  const cancelPendingUpload = () => {
    setPendingUpload(null);
    setSelectedParams(new Set());
    setCustomParams([]);
    setCustomParam("");
  };

  const confirmUploadWithParams = async () => {
    if (!pendingUpload) return;
    const { bill_type, asset } = pendingUpload as { bill_type: BillType; asset: any };
    setPendingUpload(null);
    try {
      setUploading(bill_type);
      // V38E: if the asset already carries base64 (from contact files) use it directly
      const b64 = asset._base64 ? String(asset._base64) : await uriToBase64(asset.uri);
      const bytes = Math.round((b64.length * 3) / 4);
      if (bytes > 12 * 1024 * 1024) {
        notify("PDF troppo grande", "Massimo 12 MB per fattura.");
        setUploading(null);
        return;
      }
      const params = Array.from(selectedParams);
      const uploadName = asset.name || `fattura-${bill_type}.pdf`;
      await api(`/contacts/${contactId}/bills`, {
        method: "POST",
        body: {
          bill_type,
          pdf_base64: b64,
          pdf_name: uploadName,
          pdf_mime: asset.mimeType || "application/pdf",
          analysis_params: params.length ? params : undefined,
        },
      });
      // V38G — Also save the uploaded PDF into the contact's files array
      // (unless a file with the same name already exists there — e.g. when the
      // source was already "Da file cliente").
      void saveFileToContactIfNew(uploadName, asset.mimeType || "application/pdf", b64);
      await load();
    } catch (e: any) {
      console.warn("upload bill err", e);
      notify("Errore caricamento", e?.message || "Impossibile caricare la fattura");
    } finally {
      setUploading(null);
      setSelectedParams(new Set());
      setCustomParams([]);
      setCustomParam("");
    }
  };

  const cancelBillAnalysis = async (bill: Bill) => {
    try {
      await api(`/contacts/${contactId}/bills/${bill.bill_id}/cancel`, { method: "POST" });
      await load();
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile annullare l'analisi");
    }
  };

  const deleteBill = async (bill: Bill) => {
    const ok = await confirmAsync(
      "Elimina fattura",
      `Vuoi rimuovere "${bill.pdf_name}"? L'operazione è irreversibile.`
    );
    if (!ok) return;
    try {
      await api(`/contacts/${contactId}/bills/${bill.bill_id}`, { method: "DELETE" });
      await load();
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile eliminare la fattura");
    }
  };

  const reanalyze = async (bill: Bill) => {
    try {
      await api(`/contacts/${contactId}/bills/${bill.bill_id}/reanalyze`, { method: "POST" });
      await load();
    } catch (e: any) {
      notify("Errore", e?.message || "");
    }
  };

  const openBillPdf = async (bill: Bill) => {
    try {
      const r = await api<{ pdf_base64: string; pdf_mime: string; pdf_name: string }>(`/contacts/${contactId}/bills/${bill.bill_id}/pdf`);
      let b64 = r.pdf_base64 || "";
      if (b64.startsWith("data:")) b64 = b64.split(",", 1)[1] || b64;
      if (Platform.OS === "web") {
        // Convert base64 -> Blob -> object URL (avoids blank data-URL PDFs in modern browsers)
        try {
          const bin = atob(b64);
          const len = bin.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
          const blob = new Blob([bytes], { type: r.pdf_mime || "application/pdf" });
          const url = URL.createObjectURL(blob);
          const win = (globalThis as any).window;
          const tab = win?.open(url, "_blank");
          if (!tab) {
            // Popup blocked → fallback: force download
            const a = win.document.createElement("a");
            a.href = url;
            a.download = r.pdf_name || "fattura.pdf";
            win.document.body.appendChild(a);
            a.click();
            win.document.body.removeChild(a);
          }
          // Revoke later so the tab has time to load
          setTimeout(() => URL.revokeObjectURL(url), 60_000);
        } catch (er: any) {
          notify("Errore apertura PDF", er?.message || "Impossibile aprire il file");
        }
        return;
      }
      // Native: write to cache and share/preview
      const FileSystem = await import("expo-file-system/legacy");
      const path = `${FileSystem.cacheDirectory}${bill.pdf_name || "fattura.pdf"}`;
      await FileSystem.writeAsStringAsync(path, b64, { encoding: FileSystem.EncodingType.Base64 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, { mimeType: "application/pdf", UTI: "com.adobe.pdf" });
      } else {
        Linking.openURL(path);
      }
    } catch (e: any) {
      notify("Errore apertura PDF", e?.message || "");
    }
  };

  const generateReport = async () => {
    try {
      setReportBusy(true);
      const rep = await api<any>(`/contacts/${contactId}/bills/report`);
      const html = buildReportHtml(rep, contactName, branding);
      // V38R — Ask user to confirm the filename before saving.
      setSaveConfirm({
        kind: "report",
        defaultName: suggestFileName(contactName, "Report Fatture"),
        ext: Platform.OS === "web" ? ".html" : ".pdf",
        color: "#6366F1",
        subtitle: "Salva questo report nei File del cliente",
        run: async (name: string) => { await saveReportWithName(html, name); },
      });
      if (Platform.OS === "web") {
        printHtmlOnWeb(html, `report-fatture-${contactName || "cliente"}.pdf`);
        return;
      }
      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf" });
      } else {
        notify("Report generato", uri);
      }
    } catch (e: any) {
      notify("Errore report", e?.message || "");
    } finally {
      setReportBusy(false);
    }
  };

  if (loading) {
    return <ActivityIndicator style={{ marginTop: 30 }} color={theme.color.brandPrimary} />;
  }

  const totalDone = grouped.luce.filter((b) => b.status === "done").length
    + grouped.gas.filter((b) => b.status === "done").length
    + grouped.telco.filter((b) => b.status === "done").length;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
        <View style={styles.introCard}>
          <Ionicons name="sparkles" size={20} color={theme.color.brandPrimary} />
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={styles.introTitle}>Fatture Energia · AI Claude Sonnet 5</Text>
            <Text style={styles.introTxt}>Carica le fatture in PDF: Luce, Gas o Telco. L&apos;AI estrae automaticamente POD/PDR, consumi, offerte, scadenze, IVA e altro.</Text>
          </View>
        </View>

      {/* Company Offers accordion */}
      <View style={styles.offersCard}>
        <Pressable onPress={() => setShowOffers((v) => !v)} style={styles.offersHeader}>
          <Ionicons name="briefcase" size={18} color="#7C3AED" />
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={styles.offersTitle}>Offerte aziendali ({offers.length})</Text>
            <Text style={styles.offersSub}>Carica le condizioni economiche della tua offerta per confrontarla con quella attuale del cliente.</Text>
          </View>
          <Ionicons name={showOffers ? "chevron-up" : "chevron-down"} size={20} color="#7C3AED" />
        </Pressable>
        {showOffers && (
          <View style={{ padding: 12, paddingTop: 0 }}>
            {(Object.keys(SECTION_META) as BillType[]).map((bt) => {
              const meta = SECTION_META[bt];
              const myOffers = offers.filter((o) => o.bill_type === bt);
              return (
                <View key={bt} style={{ marginTop: 8 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
                    <Text style={{ fontWeight: "700", fontSize: 12, color: meta.color }}>{meta.emoji} {meta.label}</Text>
                    <Text style={{ fontSize: 10, color: theme.color.muted }}>({myOffers.length})</Text>
                  </View>
                  <Pressable
                    testID={`offer-upload-${bt}`}
                    onPress={() => uploadOffer(bt)}
                    disabled={uploadingOffer === bt}
                    style={[styles.uploadBtn, { borderColor: "#7C3AED", paddingVertical: 8 }]}
                  >
                    {uploadingOffer === bt ? (
                      <ActivityIndicator color="#7C3AED" />
                    ) : (
                      <>
                        <Ionicons name="cloud-upload-outline" size={16} color="#7C3AED" />
                        <Text style={[styles.uploadTxt, { color: "#7C3AED", fontSize: 12 }]}>Carica condizioni economiche</Text>
                      </>
                    )}
                  </Pressable>
                  {/* V26.q — Testo manuale + Dettatura vocale */}
                  <View style={{ marginTop: 8, gap: 6 }}>
                    <TextInput
                      testID={`offer-manual-text-${bt}`}
                      value={manualTxt[bt]}
                      onChangeText={(t) => setManualTxt((m) => ({ ...m, [bt]: t }))}
                      placeholder="…oppure inserisci qui le condizioni economiche (prezzi €/kWh, quota fissa, servizi extra, penali…)"
                      placeholderTextColor="#94A3B8"
                      style={{ backgroundColor: "#FFF", borderRadius: 8, padding: 8, borderWidth: 1, borderColor: "#DDD6FE", minHeight: 70, textAlignVertical: "top", color: theme.color.onSurface, fontSize: 12 }}
                      multiline
                    />
                    <View style={{ flexDirection: "row", gap: 6 }}>
                      <View style={{ flex: 1 }}>
                        <VoiceDictationButton
                          compact
                          testID={`offer-manual-mic-${bt}`}
                          label="Detta"
                          onTranscript={(txt) => setManualTxt((m) => ({ ...m, [bt]: (m[bt] ? m[bt] + " " : "") + txt }))}
                        />
                      </View>
                      <Pressable
                        testID={`offer-manual-save-${bt}`}
                        onPress={() => saveManualOffer(bt)}
                        disabled={savingManual === bt || !manualTxt[bt]?.trim()}
                        style={[styles.uploadBtn, { flex: 1, borderColor: "#16A34A", backgroundColor: manualTxt[bt]?.trim() ? "#16A34A" : "#94A3B8", paddingVertical: 8 }]}
                      >
                        {savingManual === bt ? (
                          <ActivityIndicator color="#FFF" />
                        ) : (
                          <>
                            <Ionicons name="save-outline" size={14} color="#FFF" />
                            <Text style={[styles.uploadTxt, { color: "#FFF", fontSize: 12 }]}>Salva testo</Text>
                          </>
                        )}
                      </Pressable>
                    </View>
                  </View>
                  {myOffers.map((o) => {
                    const st = STATUS_META[o.status] || STATUS_META.pending;
                    return (
                      <View key={o.offer_id} style={styles.offerCard}>
                        <Ionicons name="document-outline" size={16} color="#7C3AED" />
                        <View style={{ flex: 1, marginLeft: 8 }}>
                          <Text style={styles.offerCardTitle} numberOfLines={1}>{o.label || o.pdf_name}</Text>
                          <View style={styles.statusRow}>
                            <Ionicons name={st.icon} size={11} color={st.color} />
                            <Text style={[styles.statusTxt, { color: st.color }]}>{st.label}</Text>
                            {o.status === "done" && o.extracted?.fornitore ? (
                              <Text style={styles.metaTxt}> · {String(o.extracted.fornitore).slice(0, 22)}</Text>
                            ) : null}
                          </View>
                        </View>
                        <Pressable onPress={() => deleteOffer(o)} testID={`offer-delete-${o.offer_id}`} style={{ padding: 6 }}>
                          <Ionicons name="trash-outline" size={16} color="#DC2626" />
                        </Pressable>
                      </View>
                    );
                  })}
                </View>
              );
            })}
          </View>
        )}
      </View>

      {(Object.keys(SECTION_META) as BillType[]).map((bt) => {
        const meta = SECTION_META[bt];
        const bills = grouped[bt] || [];
        return (
          <View key={bt} style={styles.section}>
            <View style={[styles.sectionHeader, { backgroundColor: meta.color }]}>
              <Text style={styles.sectionTitle}>{meta.emoji} {meta.label}</Text>
              <Text style={styles.sectionCount}>{bills.length}</Text>
            </View>

            <Pressable
              testID={`bill-upload-${bt}`}
              onPress={() => uploadPdf(bt)}
              disabled={uploading === bt}
              style={[styles.uploadBtn, { borderColor: meta.color }]}
            >
              {uploading === bt ? (
                <ActivityIndicator color={meta.color} />
              ) : (
                <>
                  <Ionicons name="cloud-upload-outline" size={20} color={meta.color} />
                  <Text style={[styles.uploadTxt, { color: meta.color }]}>Carica fattura PDF</Text>
                </>
              )}
            </Pressable>

            {bills.length === 0 ? (
              <Text style={styles.emptyTxt}>Ancora nessuna fattura {meta.label.toLowerCase()}.</Text>
            ) : (
              bills.map((b) => {
                const st = STATUS_META[b.status] || STATUS_META.pending;
                const isOpen = !!expanded[b.bill_id];
                const ex = b.extracted || {};
                return (
                  <View key={b.bill_id} style={styles.billCard}>
                    <Pressable
                      onPress={() => setExpanded((s) => ({ ...s, [b.bill_id]: !s[b.bill_id] }))}
                      style={styles.billHeader}
                      testID={`bill-card-${b.bill_id}`}
                    >
                      <Ionicons name="document-text" size={22} color={meta.color} />
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text style={styles.billName} numberOfLines={1}>{b.pdf_name}</Text>
                        <View style={styles.statusRow}>
                          <Ionicons name={st.icon} size={12} color={st.color} />
                          <Text style={[styles.statusTxt, { color: st.color }]}>{st.label}</Text>
                          {b.status === "done" && ex.fornitore ? (
                            <Text style={styles.metaTxt}> · {String(ex.fornitore).slice(0, 22)}</Text>
                          ) : null}
                        </View>
                      </View>
                      {/* V38: Quick cancel button always available while analyzing */}
                      {(b.status === "pending" || b.status === "analyzing") && (
                        <Pressable
                          testID={`bill-cancel-header-${b.bill_id}`}
                          onPress={(e: any) => { e?.stopPropagation?.(); cancelBillAnalysis(b); }}
                          hitSlop={8}
                          style={{ padding: 6, marginRight: 4 }}
                        >
                          <Ionicons name="stop-circle" size={20} color="#EA580C" />
                        </Pressable>
                      )}
                      {/* V38: Quick delete button always available (any status, any bill count) */}
                      <Pressable
                        testID={`bill-delete-header-${b.bill_id}`}
                        onPress={(e: any) => { e?.stopPropagation?.(); deleteBill(b); }}
                        hitSlop={8}
                        style={{ padding: 6, marginRight: 4 }}
                      >
                        <Ionicons name="trash-outline" size={18} color="#DC2626" />
                      </Pressable>
                      <Ionicons name={isOpen ? "chevron-up" : "chevron-down"} size={18} color={theme.color.muted} />
                    </Pressable>

                    {isOpen && (
                      <View style={styles.billBody}>
                        {b.status === "error" && (
                          <View style={styles.errorBox}>
                            <Text style={styles.errorTxt}>{b.error_message || "Errore di analisi"}</Text>
                          </View>
                        )}

                        {b.status === "done" && (
                          <View style={styles.dataBox}>
                            {Object.entries(ex).map(([k, v]) => {
                              if (v === null || v === undefined || v === "") return null;
                              // V38P — delegate to shared BillFieldRow which
                              // renders consumi_mensili (top-level OR nested
                              // inside parametri_richiesti) as a bar chart,
                              // parametri_richiesti as sub-rows and note_ai
                              // as bulleted list. Fallback for all other keys.
                              if (k === "consumi_mensili_kwh" || k === "consumi_mensili_smc" || k === "parametri_richiesti" || k === "note_ai") {
                                return (
                                  <BillFieldRow
                                    key={k}
                                    name={k}
                                    value={v}
                                    accent={SECTION_META[b.bill_type]?.color || "#6366F1"}
                                  />
                                );
                              }
                              if (k === "servizi_inclusi" && Array.isArray(v)) {
                                return (
                                  <View key={k} style={styles.kvRow}>
                                    <Text style={styles.kvKey}>{humanKey(k)}</Text>
                                    <Text style={styles.kvVal}>{v.join(", ")}</Text>
                                  </View>
                                );
                              }
                              if (Array.isArray(v) || (typeof v === "object" && v !== null)) return null; // handled above
                              const value = String(v);
                              return (
                                <View key={k} style={styles.kvRow}>
                                  <Text style={styles.kvKey}>{humanKey(k)}</Text>
                                  <Text style={styles.kvVal}>{value}</Text>
                                </View>
                              );
                            })}
                            {Object.keys(ex).length === 0 && (
                              <Text style={styles.emptyTxt}>Nessun dato estratto.</Text>
                            )}
                          </View>
                        )}

                        <View style={styles.actionsRow}>
                          <Pressable testID={`bill-view-${b.bill_id}`} onPress={() => openBillPdf(b)} style={[styles.actBtn, { backgroundColor: "#F1F5F9" }]}>
                            <Ionicons name="eye-outline" size={14} color={theme.color.onSurface} />
                            <Text style={styles.actBtnTxt}>Apri PDF</Text>
                          </Pressable>
                          {(b.status === "pending" || b.status === "analyzing") && (
                            <Pressable
                              testID={`bill-cancel-${b.bill_id}`}
                              onPress={() => cancelBillAnalysis(b)}
                              style={[styles.actBtn, { backgroundColor: "#FEF3C7" }]}
                            >
                              <Ionicons name="stop-circle-outline" size={14} color="#B45309" />
                              <Text style={[styles.actBtnTxt, { color: "#B45309" }]}>Annulla analisi</Text>
                            </Pressable>
                          )}
                          {(b.status === "error" || b.status === "done" || b.status === "cancelled") && (
                            <Pressable testID={`bill-reanalyze-${b.bill_id}`} onPress={() => reanalyze(b)} style={[styles.actBtn, { backgroundColor: "#DBEAFE" }]}>
                              <Ionicons name="refresh" size={14} color="#1D4ED8" />
                              <Text style={[styles.actBtnTxt, { color: "#1D4ED8" }]}>Ri-analizza</Text>
                            </Pressable>
                          )}
                          {b.status === "done" && (
                            <Pressable
                              testID={`bill-save-analysis-${b.bill_id}`}
                              onPress={() => setSaveConfirm({
                                kind: "bill-analysis",
                                defaultName: suggestFileName(contactName, `Analisi ${SECTION_META[b.bill_type].label}`),
                                ext: Platform.OS === "web" ? ".html" : ".pdf",
                                color: "#16A34A",
                                subtitle: "Salva l'analisi nei File del cliente",
                                run: async (name: string) => { await saveBillAnalysisWithName(b, name); },
                              })}
                              style={[styles.actBtn, { backgroundColor: "#DCFCE7" }]}
                            >
                              <Ionicons name="save-outline" size={14} color="#166534" />
                              <Text style={[styles.actBtnTxt, { color: "#166534" }]}>Salva sul cliente</Text>
                            </Pressable>
                          )}
                          <Pressable testID={`bill-delete-${b.bill_id}`} onPress={() => deleteBill(b)} style={[styles.actBtn, { backgroundColor: "#FEE2E2" }]}>
                            <Ionicons name="trash-outline" size={14} color="#DC2626" />
                            <Text style={[styles.actBtnTxt, { color: "#DC2626" }]}>Elimina</Text>
                          </Pressable>
                        </View>
                      </View>
                    )}
                  </View>
                );
              })
            )}
          </View>
        );
      })}

      <Pressable
        testID="bills-report-btn"
        disabled={totalDone === 0 || reportBusy}
        onPress={generateReport}
        style={[styles.reportBtn, { opacity: totalDone === 0 || reportBusy ? 0.5 : 1 }]}
      >
        {reportBusy ? (
          <ActivityIndicator color="#FFF" />
        ) : (
          <>
            <Ionicons name="document-attach" size={20} color="#FFF" />
            <Text style={styles.reportBtnTxt}>Genera Report PDF ({totalDone} fatture)</Text>
          </>
        )}
      </Pressable>
      {totalDone === 0 && (
        <Text style={[styles.emptyTxt, { textAlign: "center", marginTop: 6 }]}>
          Il report sarà disponibile quando almeno una fattura sarà stata analizzata.
        </Text>
      )}

      {/* Comparison Button */}
      {(() => {
        const doneOffers = offers.filter((o) => o.status === "done");
        const canCompare = totalDone > 0 && doneOffers.length > 0;
        return (
          <>
            <Pressable
              testID="bills-compare-btn"
              disabled={!canCompare || comparisonBusy}
              onPress={generateComparison}
              style={[styles.compareBtn, { opacity: !canCompare || comparisonBusy ? 0.5 : 1 }]}
            >
              {comparisonBusy ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <>
                  <Ionicons name="git-compare" size={20} color="#FFF" />
                  <Text style={styles.reportBtnTxt}>Confronta con Offerta Aziendale</Text>
                </>
              )}
            </Pressable>
            {!canCompare && (
              <Text style={[styles.emptyTxt, { textAlign: "center", marginTop: 6 }]}>
                Serve almeno una fattura analizzata e un&apos;offerta aziendale analizzata (stesso tipo).
              </Text>
            )}
          </>
        );
      })()}
      </ScrollView>

      {/* V38 — Analysis parameters config modal */}
      <Modal visible={!!pendingUpload} animationType="slide" transparent onRequestClose={cancelPendingUpload}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" }}>
          <View style={{ backgroundColor: theme.color.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "90%" }}>
            {pendingUpload && (() => {
              const bt = pendingUpload.bill_type;
              const meta = SECTION_META[bt];
              const defs = DEFAULT_PARAMS[bt];
              return (
                <>
                  <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: theme.color.border }}>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <Text style={{ fontSize: 20 }}>{meta.emoji}</Text>
                        <View>
                          <Text style={{ fontSize: 15, fontWeight: "800", color: theme.color.onSurface }}>Parametri da estrarre</Text>
                          <Text style={{ fontSize: 11, color: theme.color.muted, marginTop: 1 }} numberOfLines={1}>{pendingUpload.asset.name || `fattura-${bt}.pdf`}</Text>
                        </View>
                      </View>
                      <Pressable onPress={cancelPendingUpload} hitSlop={8} testID="bill-config-close">
                        <Ionicons name="close" size={22} color={theme.color.onSurface} />
                      </Pressable>
                    </View>
                    <Text style={{ fontSize: 11, color: theme.color.muted, marginTop: 8, lineHeight: 15 }}>
                      Scegli quali parametri vuoi che l&apos;AI estragga con priorità. Puoi anche aggiungerne di personalizzati.
                    </Text>
                  </View>

                  <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ padding: 12 }}>
                    <Text style={{ fontSize: 12, fontWeight: "700", color: theme.color.muted, marginBottom: 6 }}>PARAMETRI STANDARD</Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                      {defs.map((p) => {
                        const on = selectedParams.has(p.label);
                        return (
                          <Pressable
                            key={p.id}
                            testID={`param-${p.id}`}
                            onPress={() => toggleParam(p.label)}
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              gap: 6,
                              paddingHorizontal: 10,
                              paddingVertical: 6,
                              borderRadius: 20,
                              borderWidth: 1,
                              borderColor: on ? meta.color : theme.color.border,
                              backgroundColor: on ? meta.color + "18" : "#FFF",
                            }}
                          >
                            <Ionicons name={on ? "checkbox" : "square-outline"} size={16} color={on ? meta.color : theme.color.muted} />
                            <Text style={{ fontSize: 12, color: on ? meta.color : theme.color.onSurface, fontWeight: on ? "700" : "500" }}>{p.label}</Text>
                          </Pressable>
                        );
                      })}
                    </View>

                    {customParams.length > 0 && (
                      <>
                        <Text style={{ fontSize: 12, fontWeight: "700", color: theme.color.muted, marginTop: 14, marginBottom: 6 }}>PARAMETRI PERSONALIZZATI</Text>
                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                          {customParams.map((p) => (
                            <View key={p} style={{
                              flexDirection: "row",
                              alignItems: "center",
                              gap: 6,
                              paddingHorizontal: 10,
                              paddingVertical: 6,
                              borderRadius: 20,
                              backgroundColor: "#F3E8FF",
                              borderWidth: 1,
                              borderColor: "#7C3AED",
                            }}>
                              <Ionicons name="sparkles" size={13} color="#7C3AED" />
                              <Text style={{ fontSize: 12, color: "#5B21B6", fontWeight: "700" }}>{p}</Text>
                              <Pressable onPress={() => removeCustomParam(p)} hitSlop={6}>
                                <Ionicons name="close-circle" size={14} color="#7C3AED" />
                              </Pressable>
                            </View>
                          ))}
                        </View>
                      </>
                    )}

                    <Text style={{ fontSize: 12, fontWeight: "700", color: theme.color.muted, marginTop: 14, marginBottom: 6 }}>AGGIUNGI PARAMETRO PERSONALIZZATO</Text>
                    <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                      <TextInput
                        testID="bill-config-custom-input"
                        value={customParam}
                        onChangeText={setCustomParam}
                        onSubmitEditing={addCustomParam}
                        placeholder="Es. Bonus sociale, Rateizzazione, IVA agevolata…"
                        placeholderTextColor={theme.color.muted}
                        style={{ flex: 1, backgroundColor: "#FFF", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: theme.color.border, fontSize: 13, color: theme.color.onSurface }}
                      />
                      <Pressable
                        onPress={addCustomParam}
                        disabled={!customParam.trim()}
                        testID="bill-config-add-custom"
                        style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: customParam.trim() ? "#7C3AED" : "#CBD5E1", flexDirection: "row", alignItems: "center", gap: 4 }}
                      >
                        <Ionicons name="add" size={16} color="#FFF" />
                        <Text style={{ color: "#FFF", fontWeight: "700", fontSize: 12 }}>Aggiungi</Text>
                      </Pressable>
                    </View>
                  </ScrollView>

                  <View style={{ padding: 12, borderTopWidth: 1, borderTopColor: theme.color.border, backgroundColor: "#FFF", gap: 8 }}>
                    <Text style={{ fontSize: 11, color: theme.color.muted, textAlign: "center" }}>
                      Selezionati: <Text style={{ fontWeight: "800", color: meta.color }}>{selectedParams.size}</Text> parametri
                    </Text>
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <Pressable onPress={cancelPendingUpload} style={{ flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: "#F1F5F9", alignItems: "center" }} testID="bill-config-cancel">
                        <Text style={{ color: theme.color.onSurface, fontWeight: "700", fontSize: 14 }}>Annulla</Text>
                      </Pressable>
                      <Pressable
                        onPress={confirmUploadWithParams}
                        disabled={selectedParams.size === 0}
                        style={{ flex: 2, paddingVertical: 12, borderRadius: 12, backgroundColor: selectedParams.size === 0 ? "#CBD5E1" : meta.color, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8 }}
                        testID="bill-config-confirm"
                      >
                        <Ionicons name="sparkles" size={16} color="#FFF" />
                        <Text style={{ color: "#FFF", fontWeight: "800", fontSize: 14 }}>Avvia analisi AI</Text>
                      </Pressable>
                    </View>
                  </View>
                </>
              );
            })()}
          </View>
        </View>
      </Modal>

      {/* V38E — Source picker: device vs contact files */}
      <Modal
        visible={sourcePickerBillType !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSourcePickerBillType(null)}
      >
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", padding: 24 }} onPress={() => setSourcePickerBillType(null)}>
          <Pressable style={{ backgroundColor: "#FFF", borderRadius: 16, padding: 20, width: "100%", maxWidth: 340, gap: 12 }} onPress={(e) => e.stopPropagation()}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={{ fontSize: 16, fontWeight: "800", color: theme.color.onSurface }}>
                Carica fattura {sourcePickerBillType ? SECTION_META[sourcePickerBillType].label : ""}
              </Text>
              <Pressable onPress={() => setSourcePickerBillType(null)} hitSlop={8}>
                <Ionicons name="close" size={22} color={theme.color.muted} />
              </Pressable>
            </View>
            <Text style={{ fontSize: 12, color: theme.color.muted, marginTop: -4 }}>
              Scegli la sorgente del PDF
            </Text>
            <Pressable
              testID="bill-source-device"
              onPress={() => sourcePickerBillType && pickFromDevice(sourcePickerBillType)}
              style={{ flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 12, borderWidth: 1, borderColor: theme.color.border, gap: 12 }}
            >
              <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: "#DBEAFE", justifyContent: "center", alignItems: "center" }}>
                <Ionicons name="cloud-upload-outline" size={22} color="#1D4ED8" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: "700", color: theme.color.onSurface }}>Dal dispositivo</Text>
                <Text style={{ fontSize: 11, color: theme.color.muted, marginTop: 2 }}>Scegli un PDF dai tuoi file locali</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={theme.color.muted} />
            </Pressable>
            <Pressable
              testID="bill-source-contact-files"
              onPress={() => sourcePickerBillType && pickFromContactFiles(sourcePickerBillType)}
              style={{ flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 12, borderWidth: 1, borderColor: theme.color.border, gap: 12 }}
            >
              <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: "#DCFCE7", justifyContent: "center", alignItems: "center" }}>
                <Ionicons name="folder-open-outline" size={22} color="#15803D" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: "700", color: theme.color.onSurface }}>Da file cliente</Text>
                <Text style={{ fontSize: 11, color: theme.color.muted, marginTop: 2 }}>Usa un PDF già presente nella scheda</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={theme.color.muted} />
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* V38E — Contact files picker (PDFs only) */}
      <Modal
        visible={contactFilesPicker !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setContactFilesPicker(null)}
      >
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" }}>
          <View style={{ backgroundColor: theme.color.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "80%" }}>
            <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: theme.color.border, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View>
                <Text style={{ fontSize: 16, fontWeight: "800", color: theme.color.onSurface }}>File del cliente (PDF)</Text>
                <Text style={{ fontSize: 11, color: theme.color.muted, marginTop: 2 }}>Seleziona un file già caricato</Text>
              </View>
              <Pressable onPress={() => setContactFilesPicker(null)} hitSlop={8} testID="bill-contact-files-close">
                <Ionicons name="close" size={22} color={theme.color.onSurface} />
              </Pressable>
            </View>
            {loadingContactFiles ? (
              <View style={{ padding: 30, alignItems: "center" }}>
                <ActivityIndicator color={theme.color.brandPrimary} />
                <Text style={{ marginTop: 8, color: theme.color.muted, fontSize: 12 }}>Carico i file…</Text>
              </View>
            ) : contactPdfFiles.length === 0 ? (
              <View style={{ padding: 30, alignItems: "center" }}>
                <Ionicons name="document-outline" size={40} color={theme.color.muted} />
                <Text style={{ marginTop: 8, color: theme.color.muted, fontSize: 13, textAlign: "center" }}>
                  Nessun PDF trovato nella scheda del cliente.{"\n"}Carica prima un file dalla tab File.
                </Text>
              </View>
            ) : (
              <ScrollView>
                {contactPdfFiles.map((f: any) => (
                  <Pressable
                    key={f.id}
                    testID={`bill-contact-file-${f.id}`}
                    onPress={() => selectContactFileAsBill(f)}
                    style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: theme.color.border, flexDirection: "row", alignItems: "center", gap: 12 }}
                  >
                    <Ionicons name="document-text" size={22} color="#DC2626" />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: "600", color: theme.color.onSurface }} numberOfLines={1}>{f.name}</Text>
                      <Text style={{ fontSize: 11, color: theme.color.muted, marginTop: 2 }}>
                        {f.size ? `${Math.round(f.size / 1024)} KB` : ""}
                        {f.created_at ? ` · ${new Date(f.created_at).toLocaleDateString("it-IT")}` : ""}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={theme.color.muted} />
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      <CalculatorFAB />

      {/* V38R — Save confirmation modal (rename before saving to contact) */}
      <SaveConfirmModal
        visible={!!saveConfirm}
        title="Conferma nome file"
        subtitle={saveConfirm?.subtitle}
        defaultName={saveConfirm?.defaultName || ""}
        extension={saveConfirm?.ext || ".pdf"}
        color={saveConfirm?.color}
        onCancel={() => setSaveConfirm(null)}
        onConfirm={async (name) => { const r = saveConfirm?.run; setSaveConfirm(null); if (r) await r(name); }}
      />
    </View>
  );
}

const MONTHS_IT = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"];

type ConsumoPoint = { mese: string; value: number };

function normalizeConsumi(raw: any, unit: string): ConsumoPoint[] {
  if (!raw) return [];
  const arr: any[] = Array.isArray(raw) ? raw : [];
  if (arr.length === 0) return [];
  const key = unit.toLowerCase(); // "kwh" | "smc"
  const points: ConsumoPoint[] = arr.map((it: any) => {
    if (typeof it === "number") return { mese: "", value: it };
    if (it && typeof it === "object") {
      const mese = String(it.mese ?? it.month ?? "").trim();
      let value = it[key] ?? it.value ?? it.consumo ?? it.kwh ?? it.smc ?? 0;
      value = Number(value);
      if (!isFinite(value)) value = 0;
      return { mese, value };
    }
    return { mese: "", value: 0 };
  });
  // Align to 12 months if we have less
  if (points.length < 12 && points.length > 0) {
    // pad with zeros keeping existing labels
    const padded = points.slice();
    while (padded.length < 12) padded.push({ mese: "", value: 0 });
    return padded.slice(0, 12);
  }
  return points.slice(0, 12);
}

function pointLabel(p: ConsumoPoint, idx: number): string {
  if (p.mese) {
    // Map italian short names like "gen"/"gennaio" to Gen etc
    const m = p.mese.slice(0, 3).toLowerCase();
    const match = MONTHS_IT.find((mm) => mm.toLowerCase() === m);
    if (match) return match;
    return p.mese.slice(0, 3).replace(/^\w/, (x) => x.toUpperCase());
  }
  return MONTHS_IT[idx] || "";
}

function ConsumoBarChart({ data, unit, color }: { data: any; unit: string; color: string }) {
  const points = normalizeConsumi(data, unit);
  if (points.length === 0) return <Text style={{ fontSize: 11, color: theme.color.muted }}>Nessun dato di consumo.</Text>;
  const width = 320;
  const height = 160;
  const padL = 30;
  const padR = 8;
  const padT = 10;
  const padB = 30;
  const chartW = width - padL - padR;
  const chartH = height - padT - padB;
  const max = Math.max(1, ...points.map((p) => p.value));
  // Compute nice Y ticks (4 levels)
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));
  const barGap = 3;
  const barW = (chartW / points.length) - barGap;
  return (
    <View style={{ backgroundColor: "#FFF", borderRadius: 8, padding: 6, borderWidth: 1, borderColor: theme.color.border }}>
      <Svg width={width} height={height}>
        {/* Y grid + labels */}
        {yTicks.map((t, i) => {
          const y = padT + chartH - (chartH * (t / max));
          return (
            <React.Fragment key={i}>
              <Line x1={padL} y1={y} x2={width - padR} y2={y} stroke="#E5E7EB" strokeWidth={1} />
              <SvgText x={padL - 4} y={y + 3} fontSize={8} fill="#6B7280" textAnchor="end">{t}</SvgText>
            </React.Fragment>
          );
        })}
        {/* Bars */}
        {points.map((p, i) => {
          const h = (p.value / max) * chartH;
          const x = padL + i * (barW + barGap);
          const y = padT + chartH - h;
          return (
            <React.Fragment key={i}>
              <Rect x={x} y={y} width={barW} height={h} fill={color} rx={2} />
              {/* Value label above bar */}
              {p.value > 0 && (
                <SvgText x={x + barW / 2} y={y - 2} fontSize={7} fill="#374151" textAnchor="middle">{p.value}</SvgText>
              )}
              {/* Month label */}
              <SvgText x={x + barW / 2} y={height - padB + 10} fontSize={8} fill="#6B7280" textAnchor="middle">{pointLabel(p, i)}</SvgText>
            </React.Fragment>
          );
        })}
      </Svg>
      <Text style={{ fontSize: 10, color: theme.color.muted, textAlign: "right", marginTop: 2 }}>Unità: {unit}</Text>
    </View>
  );
}

function normalizeNotes(v: any): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((x) => String(x)).filter((x) => x.trim().length > 0);
  const s = String(v).trim();
  if (!s) return [];
  // Split on bullets, newlines, semicolons, or numbered list markers
  const parts = s.split(/(?:\n|;|\u2022|\-\s|\d+\.\s)/).map((p) => p.trim()).filter(Boolean);
  return parts.length > 1 ? parts : [s];
}

function humanKey(k: string): string {
  const map: Record<string, string> = {
    fornitore: "Fornitore",
    cliente: "Cliente",
    codice_cliente: "Codice cliente",
    pod: "POD",
    pod_count: "Numero POD",
    pdr: "PDR",
    pdr_count: "Numero PDR",
    tensione: "Tensione",
    potenza_impegnata_kw: "Potenza impegnata (kW)",
    consumo_totale_12m_kwh: "Consumo totale 12 mesi (kWh)",
    consumo_medio_mensile_kwh: "Consumo medio mensile (kWh)",
    consumi_mensili_kwh: "Consumi mensili",
    consumo_totale_12m_smc: "Consumo totale 12 mesi (SMC)",
    consumo_medio_mensile_smc: "Consumo medio mensile (SMC)",
    consumi_mensili_smc: "Consumi mensili SMC",
    nome_offerta: "Nome offerta",
    data_attivazione: "Data attivazione",
    data_scadenza: "Data scadenza",
    durata_contratto_mesi: "Durata contratto (mesi)",
    iva_percentuale: "IVA %",
    accisa_eur_smc: "Accisa €/SMC",
    spread_eur_kwh: "Spread €/kWh",
    spread_eur_smc: "Spread €/SMC",
    prezzo_energia_eur_kwh: "Prezzo energia €/kWh",
    prezzo_gas_eur_smc: "Prezzo gas €/SMC",
    importo_totale_eur: "Importo totale €",
    periodo_fattura: "Periodo fattura",
    tipo_connessione: "Tipo connessione",
    velocita_download_mbps: "Velocità download (Mbps)",
    velocita_upload_mbps: "Velocità upload (Mbps)",
    numero_telefono: "Numero telefono",
    servizi_inclusi: "Servizi inclusi",
    costo_mensile_eur: "Costo mensile €",
    costo_annuale_eur: "Costo annuale €",
    codice_migrazione: "Codice migrazione",
    penale_disdetta_eur: "Penale disdetta €",
    note_ai: "Note AI",
    parse_error: "Errore parsing",
  };
  return map[k] || k.replace(/_/g, " ");
}

function esc(s: any): string {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderConsumiSvg(rawData: any, unit: string, color: string): string {
  const points = normalizeConsumi(rawData, unit);
  if (points.length === 0) return "";
  const width = 480;
  const height = 200;
  const padL = 40;
  const padR = 10;
  const padT = 14;
  const padB = 34;
  const chartW = width - padL - padR;
  const chartH = height - padT - padB;
  const max = Math.max(1, ...points.map((p) => p.value));
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));
  const barGap = 4;
  const barW = (chartW / points.length) - barGap;
  const grid = yTicks.map((t) => {
    const y = padT + chartH - (chartH * (t / max));
    return `<line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="#E5E7EB" stroke-width="1"/>
            <text x="${padL - 4}" y="${y + 3}" font-size="9" fill="#6B7280" text-anchor="end">${t}</text>`;
  }).join("");
  const bars = points.map((p, i) => {
    const h = (p.value / max) * chartH;
    const x = padL + i * (barW + barGap);
    const y = padT + chartH - h;
    const label = pointLabel(p, i);
    return `<rect x="${x}" y="${y}" width="${barW}" height="${h}" fill="${color}" rx="3"/>
            ${p.value > 0 ? `<text x="${x + barW / 2}" y="${y - 2}" font-size="8" fill="#374151" text-anchor="middle">${p.value}</text>` : ""}
            <text x="${x + barW / 2}" y="${height - padB + 12}" font-size="9" fill="#6B7280" text-anchor="middle">${esc(label)}</text>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${grid}${bars}<text x="${width - padR}" y="${height - 4}" font-size="9" fill="#6B7280" text-anchor="end">Unità: ${unit}</text></svg>`;
}

function renderExtractedTable(ex: Record<string, any>, sectionColor = "#6366F1"): string {
  const rows: string[] = [];
  let chartHtml = "";
  let notesHtml = "";
  const consumoKey = ex.consumi_mensili_kwh ? "consumi_mensili_kwh" : ex.consumi_mensili_smc ? "consumi_mensili_smc" : null;
  const consumoUnit = consumoKey?.endsWith("kwh") ? "kWh" : "SMC";
  Object.entries(ex).forEach(([k, v]) => {
    if (v === null || v === undefined || v === "") return;
    if (k === "consumi_mensili_kwh" || k === "consumi_mensili_smc") {
      const svg = renderConsumiSvg(v, consumoUnit, sectionColor);
      if (svg) chartHtml = `<div style="margin:8px 0;"><div style="font-size:11px;font-weight:600;color:#374151;margin-bottom:4px;">Consumi mensili (${consumoUnit})</div>${svg}</div>`;
      return;
    }
    if (k === "note_ai") {
      const items = normalizeNotes(v);
      if (items.length === 0) return;
      notesHtml = `<div style="margin:8px 0;"><div style="font-size:11px;font-weight:600;color:#374151;margin-bottom:4px;">Note AI</div><ul style="margin:0 0 0 18px;padding:0;">${items.map((it) => `<li style="font-size:11px;margin-bottom:3px;line-height:1.4;">${esc(it)}</li>`).join("")}</ul></div>`;
      return;
    }
    if (k === "servizi_inclusi" && Array.isArray(v)) {
      rows.push(`<tr><td style="padding:4px 8px;background:#F1F5F9;font-weight:600;font-size:11px;">${esc(humanKey(k))}</td><td style="padding:4px 8px;font-size:11px;">${esc(v.join(", "))}</td></tr>`);
      return;
    }
    if (Array.isArray(v) || (typeof v === "object" && v !== null)) return;
    const val = String(v);
    rows.push(`<tr><td style="padding:4px 8px;background:#F1F5F9;font-weight:600;font-size:11px;">${esc(humanKey(k))}</td><td style="padding:4px 8px;font-size:11px;">${esc(val)}</td></tr>`);
  });
  const tableHtml = rows.length ? `<table style="width:100%;border-collapse:collapse;margin-bottom:8px;border:1px solid #E5E7EB;">${rows.join("")}</table>` : "";
  return `${tableHtml}${chartHtml}${notesHtml}`;
}

function buildReportHtml(rep: any, contactName?: string, branding?: { agency_name?: string; logo_base64?: string }): string {
  const c = rep?.contact || {};
  const name = contactName || `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Cliente";
  const generated = new Date(rep?.generated_at || Date.now()).toLocaleString("it-IT");
  const s = rep?.ai_suggestions || {};
  const grouped = rep?.grouped || {};
  const agency = String(branding?.agency_name || "").trim();
  const logo = String(branding?.logo_base64 || "").trim();
  const brandingHeader = (agency || logo) ? `
    <div style="display:flex;align-items:center;gap:14px;padding:10px 0 14px;border-bottom:2px solid #6366F1;margin-bottom:16px;">
      ${logo ? `<img src="${logo}" alt="Logo" style="max-height:52px;max-width:120px;object-fit:contain;"/>` : ""}
      <div style="flex:1;">
        ${agency ? `<div style="font-size:16px;font-weight:800;color:#1F2937;">${esc(agency)}</div>` : ""}
        <div style="font-size:11px;color:#6B7280;">Report Fatture Energia · Consulenza Personalizzata</div>
      </div>
    </div>` : "";
  const sections: { key: "luce" | "gas" | "telco"; label: string; color: string; emoji: string }[] = [
    { key: "luce", label: "Luce", color: "#F59E0B", emoji: "💡" },
    { key: "gas", label: "Gas", color: "#DC2626", emoji: "🔥" },
    { key: "telco", label: "Telco", color: "#0891B2", emoji: "📞" },
  ];
  const sectionsHtml = sections.map((sec) => {
    const items = grouped[sec.key] || [];
    if (items.length === 0) return "";
    const cards = items.map((it: any) => `
      <div style="margin-bottom:16px;border:1px solid ${sec.color};border-radius:8px;overflow:hidden;padding-bottom:8px;">
        <div style="background:${sec.color};color:#FFF;padding:6px 10px;font-weight:700;font-size:12px;">${esc(it.pdf_name || "Fattura")}</div>
        <div style="padding:8px;">${renderExtractedTable(it.extracted || {}, sec.color)}</div>
      </div>`).join("");
    return `
      <h2 style="color:${sec.color};border-bottom:2px solid ${sec.color};padding-bottom:4px;">${sec.emoji} ${sec.label} (${items.length})</h2>
      ${cards}
    `;
  }).join("");

  const suggBlock = (list: any) => Array.isArray(list) && list.length
    ? `<ul style="margin:6px 0 12px 20px;padding:0;">${list.map((x: any) => `<li style="margin-bottom:4px;font-size:12px;">${esc(x)}</li>`).join("")}</ul>`
    : "";
  const prioColor = s.priorita_azione === "alta" ? "#DC2626" : s.priorita_azione === "media" ? "#F59E0B" : "#16A34A";
  const suggestionsHtml = s.riepilogo_generale || s.suggerimenti_luce || s.suggerimenti_gas || s.suggerimenti_telco ? `
    <div style="margin-top:24px;background:#F8FAFC;border-left:4px solid #6366F1;padding:14px;border-radius:6px;">
      <h2 style="margin:0 0 10px 0;color:#6366F1;">🤖 Analisi AI e suggerimenti</h2>
      ${s.riepilogo_generale ? (() => {
        const rItems = normalizeNotes(s.riepilogo_generale);
        return rItems.length > 1
          ? `<ul style="margin:6px 0 12px 20px;padding:0;">${rItems.map((it) => `<li style="font-size:12px;line-height:1.5;margin-bottom:4px;">${esc(it)}</li>`).join("")}</ul>`
          : `<p style="font-size:13px;line-height:1.5;">${esc(rItems[0] || "")}</p>`;
      })() : ""}
      ${s.punti_forza ? `<h3 style="color:#16A34A;font-size:13px;margin:10px 0 4px;">✓ Punti di forza</h3>${suggBlock(s.punti_forza)}` : ""}
      ${s.punti_debolezza ? `<h3 style="color:#DC2626;font-size:13px;margin:10px 0 4px;">✗ Criticità</h3>${suggBlock(s.punti_debolezza)}` : ""}
      ${s.suggerimenti_luce ? `<h3 style="color:#F59E0B;font-size:13px;margin:10px 0 4px;">💡 Consigli Luce</h3>${suggBlock(s.suggerimenti_luce)}` : ""}
      ${s.suggerimenti_gas ? `<h3 style="color:#DC2626;font-size:13px;margin:10px 0 4px;">🔥 Consigli Gas</h3>${suggBlock(s.suggerimenti_gas)}` : ""}
      ${s.suggerimenti_telco ? `<h3 style="color:#0891B2;font-size:13px;margin:10px 0 4px;">📞 Consigli Telco</h3>${suggBlock(s.suggerimenti_telco)}` : ""}
      ${s.risparmio_stimato_annuo_eur ? `<div style="margin-top:12px;padding:10px;background:#DCFCE7;border-radius:6px;"><b style="color:#166534;">Risparmio stimato annuo:</b> € ${esc(s.risparmio_stimato_annuo_eur)}</div>` : ""}
      ${s.priorita_azione ? `<div style="margin-top:8px;font-size:12px;"><b>Priorità azione:</b> <span style="color:${prioColor};text-transform:uppercase;font-weight:800;">${esc(s.priorita_azione)}</span></div>` : ""}
    </div>
  ` : "";

  return `<!DOCTYPE html>
<html lang="it"><head><meta charset="UTF-8"/>
<title>Report Fatture — ${esc(name)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; color: #0F172A; margin: 32px; }
  h1 { color: #1F2937; border-bottom: 3px solid #6366F1; padding-bottom: 8px; }
  h2 { margin-top: 20px; }
  .header-info { display: flex; justify-content: space-between; font-size: 12px; color: #6B7280; margin-bottom: 20px; }
</style>
</head>
<body>
  ${brandingHeader}
  <h1>📊 Report Fatture Energia</h1>
  <div class="header-info">
    <div><b>Cliente:</b> ${esc(name)}${c.contact_code ? ` (${esc(c.contact_code)})` : ""}</div>
    <div><b>Generato:</b> ${esc(generated)}</div>
  </div>
  ${sectionsHtml || "<p><i>Nessuna fattura analizzata.</i></p>"}
  ${suggestionsHtml}
  <div style="margin-top:36px;padding-top:10px;border-top:1px solid #E5E7EB;font-size:10px;color:#9CA3AF;text-align:center;">
    ${agency ? `A cura di <b>${esc(agency)}</b> · ` : ""}Report generato con analisi AI · Claude Sonnet 5
  </div>
</body></html>`;
}

function ulList(items: any): string {
  const list = normalizeNotes(items);
  if (list.length === 0) return "";
  return `<ul style="margin:4px 0 8px 20px;padding:0;">${list.map((it) => `<li style="font-size:12px;margin-bottom:3px;line-height:1.5;">${esc(it)}</li>`).join("")}</ul>`;
}

function renderSectionCard(title: string, color: string, emoji: string, bodyHtml: string): string {
  return `
    <div style="margin-top:14px;border:1px solid ${color};border-radius:10px;overflow:hidden;">
      <div style="background:${color};color:#FFF;padding:8px 12px;font-weight:800;font-size:13px;">${emoji} ${esc(title)}</div>
      <div style="padding:12px;background:#FFF;">${bodyHtml}</div>
    </div>`;
}

/* ============================================================================
 * V38B — Slide-style comparison report (A4 landscape, presentation-look)
 * Inspired by NotebookLM / Optima cover deck the user shared:
 *  - Cover: bold navy title + "Riservato alla Direzione: {NAME}"
 *  - Impronta Energetica: donut chart + big kWh number + F1/F2/F3 bars + profile callout
 *  - Dettaglio Analitico: table (Fascia | Orario | Incidenza | Volume)
 *  - Trasparenza: 3 orange info cards (current contract)
 *  - Proposta Migliorativa: 3 green cards
 *  - Calcolo risparmio + Matrice + Executive summary
 * ============================================================================ */

// Fixed slide palette
const SL = {
  navy: "#1E3A5F",
  navyDark: "#152A48",
  bg: "#F6F2E7",
  bgAlt: "#FFFFFF",
  orange: "#EE8B4A",
  orangeSoft: "#FCE9D7",
  green: "#2E9E5A",
  greenSoft: "#D4F0DC",
  blueF3: "#79ABC7",
  ink: "#0F172A",
  muted: "#5B6B7F",
  border: "#E3D9C4",
};

const FASCIA_ORARI: Record<string, string> = {
  F1: "Lun–Ven 08:00–19:00",
  F2: "Lun–Ven 07–08 / 19–23, Sab 07–23",
  F3: "Notte, Domenica e Festivi",
};

function slideOpen(title?: string): string {
  return `<section class="slide">
    <div class="slide-inner">
      ${title ? `<h2 class="slide-title">${esc(title)}</h2>` : ""}
      <div class="slide-body">`;
}
function slideClose(footer?: string): string {
  return `</div>
      ${footer ? `<div class="slide-footer">${footer}</div>` : ""}
    </div>
  </section>`;
}

function slideCover(name: string, contactCode: string, presenter: string, dateStr: string, totalSaving: number, items: number, logoData?: string): string {
  const logoHtml = logoData && logoData.trim().length > 0
    ? `<div style="position:absolute;top:20mm;right:20mm;background:#FFFFFFDD;padding:10px 14px;border-radius:12px;box-shadow:0 2px 8px rgba(30,58,95,0.15);z-index:5;">
        <img src="${logoData}" alt="Logo" style="max-height:60px;max-width:160px;object-fit:contain;display:block;"/>
      </div>`
    : "";
  return `<section class="slide slide-cover">
    <div class="cover-deco"></div>
    ${logoHtml}
    <div class="cover-card">
      <h1 class="cover-title">ANALISI STRATEGICA<br/>E DI OTTIMIZZAZIONE<br/>DEI COSTI ENERGETICI</h1>
      <div class="cover-subtitle">Audit Finanziario e Gestione Rischio</div>
      <div class="cover-recipient">Riservato alla Direzione: ${esc(String(name || "").toUpperCase())}${contactCode ? ` (${esc(contactCode)})` : ""}</div>
      <div class="cover-meta">
        <div>Data: ${esc(dateStr)}</div>
        <div>Presentato da: ${esc(presenter)}</div>
      </div>
      ${totalSaving > 0 ? `<div class="cover-saving-band">
        <span class="cover-saving-label">Risparmio annuo totale stimato</span>
        <span class="cover-saving-value">€ ${esc(Math.round(totalSaving).toLocaleString("it-IT"))}</span>
        <span class="cover-saving-note">${items} tipologia${items === 1 ? "" : "e"} analizzata${items === 1 ? "" : "e"}</span>
      </div>` : ""}
    </div>
  </section>`;
}

function donutChartSvg(f1: number, f2: number, f3: number): string {
  const items = [
    { l: "F1", v: Math.max(0, f1 || 0), c: SL.navy },
    { l: "F2", v: Math.max(0, f2 || 0), c: SL.orange },
    { l: "F3", v: Math.max(0, f3 || 0), c: SL.blueF3 },
  ];
  const total = items.reduce((a, b) => a + b.v, 0);
  const size = 320, cx = size / 2, cy = size / 2, r = 130, rInner = 78;
  if (total <= 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="#E5E7EB"/>
      <circle cx="${cx}" cy="${cy}" r="${rInner}" fill="#FFF"/>
      <text x="${cx}" y="${cy}" font-size="14" font-weight="700" fill="${SL.muted}" text-anchor="middle" dominant-baseline="central">Nessun dato</text>
    </svg>`;
  }
  let cumAngle = -Math.PI / 2;
  const arcs = items.filter((it) => it.v > 0).map((it) => {
    const angle = (it.v / total) * 2 * Math.PI;
    const a0 = cumAngle;
    const a1 = cumAngle + angle;
    cumAngle = a1;
    const x0 = cx + r * Math.cos(a0);
    const y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy + r * Math.sin(a1);
    const xi0 = cx + rInner * Math.cos(a0);
    const yi0 = cy + rInner * Math.sin(a0);
    const xi1 = cx + rInner * Math.cos(a1);
    const yi1 = cy + rInner * Math.sin(a1);
    const large = angle > Math.PI ? 1 : 0;
    const pct = (it.v / total) * 100;
    // Position for label just outside arc mid
    const mid = (a0 + a1) / 2;
    const lx = cx + (r + 22) * Math.cos(mid);
    const ly = cy + (r + 22) * Math.sin(mid);
    const anchor = Math.cos(mid) > 0.1 ? "start" : Math.cos(mid) < -0.1 ? "end" : "middle";
    return `<path d="M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} L ${xi1} ${yi1} A ${rInner} ${rInner} 0 ${large} 0 ${xi0} ${yi0} Z" fill="${it.c}"/>
      <text x="${lx}" y="${ly}" font-size="15" font-weight="700" fill="${SL.ink}" text-anchor="${anchor}" dominant-baseline="central">${pct.toFixed(1).replace(".", ",")}%</text>
      <text x="${cx + (r * 0.72) * Math.cos(mid)}" y="${cy + (r * 0.72) * Math.sin(mid)}" font-size="18" font-weight="800" fill="#FFF" text-anchor="middle" dominant-baseline="central">${it.l}</text>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    ${arcs}
    <text x="${cx}" y="${cy - 6}" font-size="14" font-weight="700" fill="${SL.navy}" text-anchor="middle">TOTALE</text>
    <text x="${cx}" y="${cy + 14}" font-size="14" font-weight="700" fill="${SL.navy}" text-anchor="middle">CONSUMI</text>
  </svg>`;
}

function fasceBarChartSvg(f1?: number, f2?: number, f3?: number): string {
  // Legacy inline bars (kept for backward compat)
  const values = [
    { l: "F1", v: Number(f1) || 0, c: SL.navy },
    { l: "F2", v: Number(f2) || 0, c: SL.orange },
    { l: "F3", v: Number(f3) || 0, c: SL.blueF3 },
  ];
  const total = values.reduce((a, b) => a + b.v, 0) || 1;
  const w = 380;
  const rows = values.map((v, i) => {
    const pct = (v.v / total) * 100;
    return `<g transform="translate(0,${i * 44})">
      <text x="0" y="14" font-size="12" font-weight="700" fill="${SL.ink}">${v.l} — ${v.l === "F1" ? "Ore di Punta" : v.l === "F2" ? "Ore Intermedie" : "Ore Fuori Punta"}</text>
      <rect x="0" y="20" width="${w}" height="14" rx="7" fill="#E5EDF3"/>
      <rect x="0" y="20" width="${(pct / 100) * w}" height="14" rx="7" fill="${v.c}"/>
      <text x="${(pct / 100) * w + 8}" y="31" font-size="12" font-weight="700" fill="${SL.ink}">${pct.toFixed(1).replace(".", ",")}%</text>
    </g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w + 60}" height="${values.length * 44 + 10}" viewBox="0 0 ${w + 60} ${values.length * 44 + 10}">${rows}</svg>`;
}

function slideImpronta(cmp: any, foot: any, fasce: any, bt: string): string {
  const unit = foot?.unita || (bt === "gas" ? "SMC" : bt === "telco" ? "GB" : "kWh");
  const total = foot?.consumo_annuo_kwh_o_smc || (Number(fasce?.F1_kwh || 0) + Number(fasce?.F2_kwh || 0) + Number(fasce?.F3_kwh || 0));
  const bigNumber = total ? Number(total).toLocaleString("it-IT") : "—";
  const pods = foot?.numero_pod || cmp?.bill?.extracted?.pod ? 1 : (foot?.numero_pod || 1);
  const profilo = foot?.profilo_utilizzo || (Array.isArray(foot?.note) ? foot.note[0] : "");
  const donut = donutChartSvg(Number(fasce?.F1_kwh || 0), Number(fasce?.F2_kwh || 0), Number(fasce?.F3_kwh || 0));
  const bars = fasceBarChartSvg(fasce?.F1_kwh, fasce?.F2_kwh, fasce?.F3_kwh);
  return slideOpen("L'Impronta Energetica Attuale") + `
    <div class="two-cols">
      <div class="card card-plain">
        <div style="text-align:center;">${donut}</div>
      </div>
      <div class="stack">
        <div class="card card-plain center">
          <div class="big-number">${esc(bigNumber)} <span class="big-unit">${esc(unit)}</span></div>
          <div class="big-caption">Consumo Annuo Stimato${pods ? ` su ${pods} POD` : ""}</div>
        </div>
        <div class="card card-plain">${bars}</div>
      </div>
    </div>
    ${profilo ? `<div class="callout callout-orange">${esc(String(profilo))}</div>` : ""}
  ` + slideClose();
}

function slideDettaglio(fasce: any, foot: any): string {
  const total = Number(foot?.consumo_annuo_kwh_o_smc) || (Number(fasce?.F1_kwh || 0) + Number(fasce?.F2_kwh || 0) + Number(fasce?.F3_kwh || 0));
  const rows = [
    { f: "F1", pct: Number(fasce?.F1_percent) || (total ? (Number(fasce?.F1_kwh || 0) / total * 100) : 0), vol: Number(fasce?.F1_kwh || 0) },
    { f: "F2", pct: Number(fasce?.F2_percent) || (total ? (Number(fasce?.F2_kwh || 0) / total * 100) : 0), vol: Number(fasce?.F2_kwh || 0) },
    { f: "F3", pct: Number(fasce?.F3_percent) || (total ? (Number(fasce?.F3_kwh || 0) / total * 100) : 0), vol: Number(fasce?.F3_kwh || 0) },
  ];
  const trs = rows.map((r) => {
    const barW = Math.max(3, Math.min(100, r.pct));
    return `<tr>
      <td class="cell-fascia">${r.f}</td>
      <td class="cell-orari">${esc(FASCIA_ORARI[r.f] || "—")}</td>
      <td class="cell-inc">
        <div class="inc-bar-wrap"><div class="inc-bar" style="width:${barW}%"></div></div>
        <span class="inc-pct">${r.pct.toFixed(1).replace(".", ",")}%</span>
      </td>
      <td class="cell-vol">${r.vol ? r.vol.toLocaleString("it-IT") : "—"} kWh</td>
    </tr>`;
  }).join("");
  return slideOpen("Dettaglio Analitico dei Consumi") + `
    <table class="tbl-detail">
      <thead>
        <tr>
          <th>Fascia</th>
          <th>Orario</th>
          <th>Incidenza</th>
          <th>Volume Stimato</th>
        </tr>
      </thead>
      <tbody>
        ${trs}
        <tr class="row-total">
          <td class="cell-fascia">TOTALE</td>
          <td class="cell-orari">—</td>
          <td class="cell-inc"><span class="inc-pct">100%</span></td>
          <td class="cell-vol">${total ? total.toLocaleString("it-IT") : "—"} kWh</td>
        </tr>
      </tbody>
    </table>
  ` + slideClose("Dati aggregati derivanti dall'analisi dei Punti di Prelievo (POD) aziendali.");
}

function slideContrattoAttuale(con: any, billExtracted: any, bt: string): string {
  const fornitore = con?.fornitore || billExtracted?.fornitore || "n/d";
  const indice = con?.tipo_prezzo || con?.indicizzazione || billExtracted?.tipo_prezzo || "n/d";
  const spread = con?.spread_eur_kwh_o_smc || billExtracted?.spread || billExtracted?.spread_eur_kwh || null;
  const spreadStr = spread != null ? `${String(spread).replace(".", ",")} €/${bt === "gas" ? "SMC" : "kWh"}` : "n/d";
  const costiFissi = billExtracted?.costi_fissi || billExtracted?.costi_fissi_mensili || billExtracted?.quota_fissa_mensile || "Presenza di oneri di commercializzazione (CCV/CCF).";
  const criticita = Array.isArray(con?.criticita) ? con.criticita : [];
  return slideOpen(`Trasparenza sui Dati: Il Contratto ${String(fornitore).slice(0, 20)} Attuale`) + `
    <div class="cards-3">
      <div class="info-card info-neutral">
        <div class="info-label">Indicizzazione</div>
        <div class="info-value mono">${esc(String(indice).toUpperCase())}</div>
      </div>
      <div class="info-card info-orange">
        <div class="info-label">Spread Applicato</div>
        <div class="info-value mono orange">${esc(spreadStr)}</div>
      </div>
      <div class="info-card info-neutral">
        <div class="info-label">Costi Fissi</div>
        <div class="info-value">${esc(String(costiFissi).slice(0, 90))}</div>
      </div>
    </div>
    ${con?.data_scadenza || con?.durata_contratto_mesi ? `<div class="callout callout-neutral">
      ${con?.durata_contratto_mesi ? `<b>Durata contratto:</b> ${esc(con.durata_contratto_mesi)} mesi &nbsp;` : ""}
      ${con?.data_scadenza ? `<b>Scadenza:</b> ${esc(con.data_scadenza)}` : ""}
    </div>` : ""}
    ${criticita.length ? `<div class="criticita">
      <div class="criticita-title">Criticità rilevate</div>
      <ul>${criticita.map((x: string) => `<li>${esc(x)}</li>`).join("")}</ul>
    </div>` : ""}
  ` + slideClose();
}

function slideProposta(offerExtracted: any, cmp: any, con: any, bt: string): string {
  const fornitore = offerExtracted?.fornitore || "Optima";
  const indice = offerExtracted?.tipo_prezzo || offerExtracted?.indicizzazione || "PUN Index GME";
  const newSpread = offerExtracted?.spread || offerExtracted?.spread_eur_kwh || cmp?.calcolo_risparmio?.nuovo_spread || null;
  const oldSpread = con?.spread_eur_kwh_o_smc || null;
  const newSpreadStr = newSpread != null ? `${String(newSpread).replace(".", ",")} €/${bt === "gas" ? "SMC" : "kWh"}` : "n/d";
  const reductionPct = (oldSpread != null && newSpread != null && Number(oldSpread) > 0) ? `Riduzione del ${Math.round(((Number(oldSpread) - Number(newSpread)) / Number(oldSpread)) * 100)}% rispetto ad attuale` : "";
  const costiFissiNew = offerExtracted?.costi_fissi || offerExtracted?.costi_fissi_mensili || "0,00 €";
  const nomeOfferta = offerExtracted?.nome_offerta || "";
  return slideOpen(`La Proposta Migliorativa ${String(fornitore).slice(0, 30)}`) + `
    <div class="cards-3">
      <div class="info-card info-green">
        <div class="info-label">Indicizzazione</div>
        <div class="info-value mono green">${esc(String(indice).toUpperCase())}</div>
      </div>
      <div class="info-card info-green">
        <div class="info-label">Nuovo Spread</div>
        <div class="info-value mono green">${esc(newSpreadStr)}</div>
        ${reductionPct ? `<div class="info-sub">${esc(reductionPct)}</div>` : ""}
      </div>
      <div class="info-card info-green">
        <div class="info-label">Costi Fissi (CCF/CCV)</div>
        <div class="info-value mono green">${esc(costiFissiNew)}</div>
        <div class="info-sub">Completamente azzerati</div>
      </div>
    </div>
    ${nomeOfferta ? `<div class="callout callout-green"><b>Offerta:</b> ${esc(nomeOfferta)}</div>` : ""}
  ` + slideClose();
}

function slideRisparmio(sav: any): string {
  const costOld = Number(sav?.costo_annuo_attuale_eur) || 0;
  const costNew = Number(sav?.costo_annuo_nuovo_eur) || 0;
  const risp = Number(sav?.risparmio_annuo_eur) || (costOld - costNew) || 0;
  const rispPct = Number(sav?.risparmio_percentuale) || (costOld ? (risp / costOld) * 100 : 0);
  const rispMese = Number(sav?.risparmio_mensile_eur) || (risp / 12);
  const dettaglio: string[] = Array.isArray(sav?.dettaglio_calcolo) ? sav.dettaglio_calcolo : [];
  return slideOpen("Calcolo Risparmio Annuo") + `
    <div class="cards-2">
      <div class="cost-card cost-old">
        <div class="cost-label">COSTO ANNUO ATTUALE</div>
        <div class="cost-value">€ ${costOld.toLocaleString("it-IT")}</div>
      </div>
      <div class="cost-card cost-new">
        <div class="cost-label">COSTO ANNUO NUOVO</div>
        <div class="cost-value">€ ${costNew.toLocaleString("it-IT")}</div>
      </div>
    </div>
    <div class="saving-band">
      <div class="saving-inner">
        <div class="saving-side">
          <div class="saving-label">Risparmio annuo</div>
          <div class="saving-big">€ ${Math.round(risp).toLocaleString("it-IT")}</div>
        </div>
        <div class="saving-side">
          <div class="saving-label">Percentuale</div>
          <div class="saving-big">${rispPct.toFixed(1).replace(".", ",")}%</div>
        </div>
        <div class="saving-side">
          <div class="saving-label">Al mese</div>
          <div class="saving-big">€ ${rispMese.toFixed(2).replace(".", ",")}</div>
        </div>
      </div>
    </div>
    ${dettaglio.length ? `<div class="detail-list">
      <div class="detail-title">Dettaglio del calcolo</div>
      <ul>${dettaglio.map((x: string) => `<li>${esc(x)}</li>`).join("")}</ul>
    </div>` : ""}
  ` + slideClose();
}

function slideMatrice(rows: any[]): string {
  if (!Array.isArray(rows) || !rows.length) return "";
  const trs = rows.slice(0, 8).map((r: any) => {
    const van = String(r.vantaggio || "").toLowerCase();
    const isFav = van === "cliente" || van === "nuova" || van === "proposta";
    const isBad = van === "attuale";
    const badge = isFav ? `<span class="badge badge-green">✓ NUOVA</span>` : isBad ? `<span class="badge badge-red">✗ ATTUALE</span>` : `<span class="badge badge-grey">≈ NEUTRO</span>`;
    return `<tr>
      <td class="mx-param">${esc(r.parametro || "")}</td>
      <td class="mx-old">${esc(r.attuale || "—")}</td>
      <td class="mx-new">${esc(r.proposta || "—")}</td>
      <td class="mx-delta">${esc(r.delta || "—")}</td>
      <td class="mx-badge">${badge}</td>
    </tr>`;
  }).join("");
  return slideOpen("Matrice di Confronto Contratto") + `
    <table class="tbl-matrix">
      <thead>
        <tr>
          <th>Parametro</th>
          <th>Contratto Attuale</th>
          <th>Nostra Proposta</th>
          <th>Delta</th>
          <th>Vantaggio</th>
        </tr>
      </thead>
      <tbody>${trs}</tbody>
    </table>
  ` + slideClose();
}

function slideExecutive(es: any, cmp: any, name: string): string {
  const verd = String(es?.verdetto || "").trim();
  const isFav = verd && !verd.toLowerCase().includes("sconsigliato");
  const isBad = verd.toLowerCase().includes("sconsigliato");
  const bannerClass = isFav ? "verd-green" : isBad ? "verd-red" : "verd-neutral";
  const risp = es?.risparmio_annuo_eur ?? cmp?.risparmio_annuo_stimato_eur ?? "";
  const puntiChiave: string[] = Array.isArray(es?.punti_chiave) ? es.punti_chiave : (Array.isArray(cmp?.sintesi) ? cmp.sintesi : []);
  const passi: string[] = Array.isArray(es?.prossimi_passi) ? es.prossimi_passi : (Array.isArray(cmp?.azione_consigliata) ? cmp.azione_consigliata : []);
  return slideOpen("Executive Summary") + `
    <div class="verd-banner ${bannerClass}">
      <div class="verd-label">VERDETTO PER ${esc(String(name || "").toUpperCase())}</div>
      <div class="verd-title">${esc(verd || "Analisi completata")}</div>
      ${risp ? `<div class="verd-saving">Risparmio annuo stimato: <b>€ ${esc(Number(risp).toLocaleString("it-IT"))}</b></div>` : ""}
    </div>
    <div class="two-cols">
      ${puntiChiave.length ? `<div class="stack-col">
        <div class="stack-title">🔑 Punti chiave</div>
        <ul class="stack-list">${puntiChiave.map((x: string) => `<li>${esc(x)}</li>`).join("")}</ul>
      </div>` : ""}
      ${passi.length ? `<div class="stack-col">
        <div class="stack-title">▶ Prossimi passi</div>
        <ol class="stack-list ordered">${passi.map((x: string) => `<li>${esc(x)}</li>`).join("")}</ol>
      </div>` : ""}
    </div>
  ` + slideClose();
}

// Legacy stub — kept so other code paths don't break
function kvGridHtml(_rows: { k: string; v: any; hi?: boolean }[]): string { void _rows; return ""; }
function comparisonMatrixHtml(_rows: { parametro?: string; attuale?: string; proposta?: string; delta?: string; vantaggio?: string }[]): string { void _rows; return ""; }

function buildComparisonHtml(rep: any, contactName?: string, branding?: { agency_name?: string; logo_base64?: string }): string {
  const c = rep?.contact || {};
  const name = contactName || `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Cliente";
  const items = Array.isArray(rep?.items) ? rep.items : [];
  const totalSaving = rep?.risparmio_totale_annuo_eur ? Number(rep.risparmio_totale_annuo_eur) : items.reduce((acc: number, it: any) => acc + (Number(it?.comparison?.risparmio_annuo_stimato_eur) || 0), 0);
  const now = new Date(rep?.generated_at || Date.now());
  const monthNames = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];
  const dateStr = `${monthNames[now.getMonth()]} ${now.getFullYear()}`;
  const agencyName = String(branding?.agency_name || "").trim();
  const logoData = String(branding?.logo_base64 || "").trim();
  const presenter = agencyName || "Dal Pastro CRM · Consulenza Energetica";

  const cover = slideCover(name, c.contact_code || "", presenter, dateStr, totalSaving, items.length, logoData);

  const perItemSlides = items.map((it: any) => {
    const cmp = it.comparison || {};
    const foot = cmp.impronta_energetica || {};
    const fasce = cmp.dettaglio_fasce || {};
    const con = cmp.analisi_contratto_attuale || {};
    const sav = cmp.calcolo_risparmio || {};
    const es = cmp.executive_summary || {};
    const matrice = Array.isArray(cmp.matrice_confronto) ? cmp.matrice_confronto : [];
    const bt = String(it.bill_type || "luce");
    const btLabel = bt === "gas" ? "GAS" : bt === "telco" ? "TELCO" : "ENERGIA ELETTRICA";
    const sectionDivider = `<section class="slide slide-divider">
      <div class="divider-inner">
        <div class="divider-mini">Sezione</div>
        <div class="divider-title">${esc(btLabel)}</div>
        <div class="divider-line"></div>
      </div>
    </section>`;
    const parts: string[] = [sectionDivider];
    // Impronta + dettaglio only for luce/gas (fasce F1/F2/F3)
    if (foot?.consumo_annuo_kwh_o_smc || fasce?.F1_kwh || fasce?.F2_kwh || fasce?.F3_kwh) {
      parts.push(slideImpronta(cmp, foot, fasce, bt));
      if (fasce?.F1_kwh || fasce?.F2_kwh || fasce?.F3_kwh) {
        parts.push(slideDettaglio(fasce, foot));
      }
    }
    parts.push(slideContrattoAttuale(con, it.bill?.extracted || {}, bt));
    parts.push(slideProposta(it.offer?.extracted || {}, cmp, con, bt));
    if (sav?.costo_annuo_attuale_eur || sav?.costo_annuo_nuovo_eur || sav?.risparmio_annuo_eur) {
      parts.push(slideRisparmio(sav));
    }
    if (matrice.length) parts.push(slideMatrice(matrice));
    if (es?.verdetto || es?.risparmio_annuo_eur || (Array.isArray(cmp.azione_consigliata) && cmp.azione_consigliata.length)) {
      parts.push(slideExecutive(es, cmp, name));
    }
    if (cmp.error_message) {
      parts.push(`<section class="slide"><div class="slide-inner"><h2 class="slide-title">Nota tecnica</h2><div class="callout callout-orange">⚠️ ${esc(cmp.error_message)}</div></div></section>`);
    }
    return parts.join("");
  }).join("");

  const css = `
    @page { size: A4 landscape; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; color: ${SL.ink}; background: ${SL.bg}; }
    .slide { width: 297mm; height: 210mm; page-break-after: always; break-after: page; padding: 14mm 18mm; position: relative; background: ${SL.bg}; overflow: hidden; }
    .slide:last-child { page-break-after: auto; }
    .slide-inner { height: 100%; display: flex; flex-direction: column; }
    .slide-title { color: ${SL.navy}; font-size: 30px; font-weight: 900; letter-spacing: -0.5px; margin: 0 0 14px; line-height: 1.05; }
    .slide-body { flex: 1; display: flex; flex-direction: column; gap: 12px; }
    .slide-footer { margin-top: 10px; font-size: 11px; color: ${SL.muted}; text-align: right; font-style: italic; }

    /* Cover */
    .slide-cover { padding: 0; display: flex; align-items: center; justify-content: center; background: linear-gradient(180deg, ${SL.bg} 0%, #EFE9D9 100%); }
    .cover-deco { position: absolute; top: 12mm; left: 12mm; width: 140px; height: 140px; background:
      radial-gradient(circle at 30% 30%, ${SL.green} 12px, transparent 12px),
      radial-gradient(circle at 70% 70%, ${SL.blueF3} 12px, transparent 12px),
      linear-gradient(45deg, ${SL.green}25 30%, transparent 30%),
      linear-gradient(-45deg, ${SL.blueF3}25 30%, transparent 30%);
      background-repeat: no-repeat; opacity: 0.9; border-radius: 30px; }
    .cover-card { background: #FFFFFF; border-radius: 20px; padding: 40px 50px; max-width: 210mm; box-shadow: 0 8px 40px rgba(30,58,95,0.08); border: 1px solid ${SL.border}; }
    .cover-title { color: ${SL.navy}; font-size: 46px; font-weight: 900; margin: 0 0 12px; letter-spacing: -1px; line-height: 1.05; }
    .cover-subtitle { color: ${SL.navy}; font-size: 22px; font-weight: 500; margin-bottom: 22px; }
    .cover-recipient { font-family: "Courier New", ui-monospace, monospace; font-size: 14px; padding: 10px 16px; background: #F8F5EE; border: 1px solid ${SL.border}; border-radius: 6px; margin-bottom: 18px; display: inline-block; }
    .cover-meta { font-family: "Courier New", ui-monospace, monospace; font-size: 13px; color: ${SL.ink}; line-height: 1.7; }
    .cover-saving-band { margin-top: 22px; padding: 16px 22px; background: linear-gradient(90deg, ${SL.green}, #22C55E); color: #FFF; border-radius: 12px; display: flex; align-items: center; justify-content: space-between; box-shadow: 0 4px 14px rgba(46,158,90,0.35); }
    .cover-saving-label { font-size: 13px; text-transform: uppercase; letter-spacing: 1px; opacity: 0.95; }
    .cover-saving-value { font-size: 32px; font-weight: 900; }
    .cover-saving-note { font-size: 12px; opacity: 0.9; }

    /* Divider */
    .slide-divider { display: flex; align-items: center; justify-content: center; background: ${SL.navy}; }
    .divider-inner { text-align: center; color: #FFF; }
    .divider-mini { font-size: 14px; letter-spacing: 4px; opacity: 0.7; margin-bottom: 8px; text-transform: uppercase; }
    .divider-title { font-size: 60px; font-weight: 900; letter-spacing: -1px; }
    .divider-line { height: 4px; width: 120px; background: ${SL.orange}; margin: 20px auto 0; border-radius: 2px; }

    /* Layout helpers */
    .two-cols { display: flex; gap: 18px; align-items: stretch; }
    .two-cols > * { flex: 1; }
    .stack { display: flex; flex-direction: column; gap: 12px; }
    .cards-3 { display: flex; gap: 16px; }
    .cards-3 > * { flex: 1; }
    .cards-2 { display: flex; gap: 20px; margin-bottom: 14px; }
    .cards-2 > * { flex: 1; }

    /* Generic card */
    .card { background: #FFF; border-radius: 12px; padding: 18px; border: 1px solid ${SL.border}; }
    .card-plain { background: #FFF; }
    .center { text-align: center; }

    /* Big number */
    .big-number { color: ${SL.navy}; font-size: 56px; font-weight: 900; letter-spacing: -1px; line-height: 1; font-family: "Courier New", ui-monospace, monospace; }
    .big-unit { font-size: 30px; font-weight: 700; color: ${SL.navy}; }
    .big-caption { color: ${SL.ink}; font-size: 15px; margin-top: 6px; }

    /* Callout boxes */
    .callout { padding: 12px 16px; border-radius: 10px; font-size: 13px; line-height: 1.5; margin-top: 8px; }
    .callout-orange { background: #FFFFFF; border: 2px solid ${SL.orange}; color: ${SL.ink}; }
    .callout-green { background: ${SL.greenSoft}; border: 2px solid ${SL.green}; color: ${SL.ink}; }
    .callout-neutral { background: #FFFFFF; border: 1px solid ${SL.border}; color: ${SL.ink}; }

    /* Info cards (Contratto attuale / Proposta) */
    .info-card { background: #FFF; border-radius: 12px; padding: 16px 18px; border: 1px solid ${SL.border}; }
    .info-neutral { background: #FFFFFF; border: 1px solid ${SL.border}; }
    .info-orange { background: #FFFFFF; border: 2px solid ${SL.orange}; }
    .info-green { background: #FFFFFF; border: 2px solid ${SL.green}; }
    .info-label { color: ${SL.navy}; font-weight: 700; font-size: 13px; margin-bottom: 6px; }
    .info-value { color: ${SL.ink}; font-size: 18px; font-weight: 700; line-height: 1.3; }
    .info-value.mono { font-family: "Courier New", ui-monospace, monospace; }
    .info-value.orange { color: ${SL.orange}; }
    .info-value.green { color: ${SL.green}; }
    .info-sub { color: ${SL.muted}; font-size: 12px; margin-top: 4px; }

    .criticita { margin-top: 12px; padding: 12px 16px; background: ${SL.orangeSoft}; border-left: 4px solid ${SL.orange}; border-radius: 6px; }
    .criticita-title { color: ${SL.navy}; font-weight: 800; font-size: 13px; margin-bottom: 4px; }
    .criticita ul { margin: 0; padding-left: 20px; font-size: 12px; line-height: 1.5; }

    /* Dettaglio table */
    .tbl-detail { width: 100%; border-collapse: separate; border-spacing: 0; background: #FFF; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(30,58,95,0.06); border: 1px solid ${SL.border}; }
    .tbl-detail thead th { background: ${SL.navy}; color: #FFF; font-size: 14px; font-weight: 700; padding: 14px 16px; text-align: center; border-right: 1px solid rgba(255,255,255,0.15); }
    .tbl-detail thead th:last-child { border-right: 0; }
    .tbl-detail tbody td { padding: 14px 16px; font-size: 14px; text-align: center; border-bottom: 1px solid ${SL.border}; font-family: "Courier New", ui-monospace, monospace; }
    .tbl-detail tbody tr:nth-child(even) td { background: #F4F0E4; }
    .tbl-detail .cell-fascia { font-weight: 800; color: ${SL.navy}; font-size: 16px; }
    .tbl-detail .cell-orari { color: ${SL.ink}; }
    .tbl-detail .cell-inc { position: relative; }
    .inc-bar-wrap { display: inline-block; width: 80px; height: 12px; background: #E5EDF3; border-radius: 6px; margin-right: 8px; vertical-align: middle; overflow: hidden; }
    .inc-bar { height: 100%; background: ${SL.blueF3}; }
    .inc-pct { color: ${SL.ink}; font-weight: 700; font-size: 13px; vertical-align: middle; }
    .cell-vol { color: ${SL.ink}; font-weight: 700; }
    .row-total td { background: ${SL.navy} !important; color: #FFF; font-weight: 800; border-bottom: 0; }
    .row-total .cell-fascia { color: #FFF; }

    /* Cost cards (calcolo risparmio) */
    .cost-card { padding: 22px 26px; border-radius: 14px; text-align: center; }
    .cost-old { background: #FFFFFF; border: 2px solid #FCA5A5; }
    .cost-new { background: #FFFFFF; border: 2px solid ${SL.green}; }
    .cost-label { font-size: 12px; letter-spacing: 1px; color: ${SL.muted}; font-weight: 700; margin-bottom: 8px; }
    .cost-old .cost-value { color: #DC2626; }
    .cost-new .cost-value { color: ${SL.green}; }
    .cost-value { font-size: 34px; font-weight: 900; font-family: "Courier New", ui-monospace, monospace; }

    .saving-band { padding: 22px; background: linear-gradient(135deg, ${SL.navy}, ${SL.navyDark}); border-radius: 14px; color: #FFF; }
    .saving-inner { display: flex; gap: 30px; justify-content: space-around; text-align: center; }
    .saving-side { flex: 1; }
    .saving-label { font-size: 12px; text-transform: uppercase; letter-spacing: 1px; opacity: 0.75; margin-bottom: 4px; }
    .saving-big { font-size: 32px; font-weight: 900; font-family: "Courier New", ui-monospace, monospace; }

    .detail-list { margin-top: 12px; padding: 14px 18px; background: #FFF; border-radius: 10px; border: 1px solid ${SL.border}; }
    .detail-title { color: ${SL.navy}; font-weight: 800; font-size: 13px; margin-bottom: 6px; }
    .detail-list ul { margin: 0; padding-left: 20px; font-size: 13px; line-height: 1.7; }

    /* Matrice */
    .tbl-matrix { width: 100%; border-collapse: separate; border-spacing: 0; background: #FFF; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(30,58,95,0.06); border: 1px solid ${SL.border}; }
    .tbl-matrix thead th { background: ${SL.navy}; color: #FFF; font-size: 12px; font-weight: 700; padding: 12px 14px; text-align: left; text-transform: uppercase; letter-spacing: 0.5px; }
    .tbl-matrix tbody td { padding: 12px 14px; font-size: 13px; border-bottom: 1px solid ${SL.border}; }
    .tbl-matrix tbody tr:nth-child(even) td { background: #FAF7EE; }
    .mx-param { font-weight: 700; color: ${SL.navy}; }
    .mx-old { color: #DC2626; font-family: "Courier New", monospace; }
    .mx-new { color: ${SL.green}; font-weight: 700; font-family: "Courier New", monospace; }
    .mx-delta { color: ${SL.muted}; font-family: "Courier New", monospace; }
    .badge { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 11px; font-weight: 800; }
    .badge-green { background: ${SL.greenSoft}; color: ${SL.green}; }
    .badge-red { background: #FEE2E2; color: #DC2626; }
    .badge-grey { background: #F1F5F9; color: ${SL.muted}; }

    /* Executive summary */
    .verd-banner { padding: 26px 34px; border-radius: 14px; color: #FFF; text-align: center; margin-bottom: 20px; }
    .verd-green { background: linear-gradient(135deg, ${SL.green}, #22C55E); }
    .verd-red { background: linear-gradient(135deg, #DC2626, #B91C1C); }
    .verd-neutral { background: linear-gradient(135deg, ${SL.orange}, #F97316); }
    .verd-label { font-size: 12px; letter-spacing: 2px; opacity: 0.9; text-transform: uppercase; }
    .verd-title { font-size: 32px; font-weight: 900; margin-top: 6px; letter-spacing: -0.5px; }
    .verd-saving { font-size: 16px; margin-top: 6px; opacity: 0.95; }

    .stack-col { flex: 1; background: #FFF; border-radius: 12px; padding: 16px 20px; border: 1px solid ${SL.border}; }
    .stack-title { color: ${SL.navy}; font-weight: 900; font-size: 15px; margin-bottom: 8px; }
    .stack-list { margin: 0; padding-left: 20px; font-size: 13px; line-height: 1.7; color: ${SL.ink}; }
    .stack-list.ordered { padding-left: 22px; }
  `;

  return `<!DOCTYPE html>
<html lang="it"><head><meta charset="UTF-8"/>
<title>Analisi Strategica — ${esc(name)}</title>
<style>${css}</style>
</head>
<body>
${cover}
${perItemSlides || `<section class="slide"><div class="slide-inner"><h2 class="slide-title">Nessun confronto disponibile</h2><p>Carica almeno una fattura cliente e un'offerta aziendale dello stesso tipo, poi rigenera il report.</p></div></section>`}
</body></html>`;
}

const styles = StyleSheet.create({
  introCard: {
    flexDirection: "row",
    backgroundColor: "#EEF2FF",
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    alignItems: "flex-start",
  },
  introTitle: { fontSize: 13, fontWeight: "800", color: theme.color.brandPrimary },
  introTxt: { fontSize: 11, color: theme.color.muted, marginTop: 2, lineHeight: 15 },
  section: { marginBottom: 20 },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    marginBottom: 10,
  },
  sectionTitle: { color: "#FFF", fontWeight: "800", fontSize: 15 },
  sectionCount: { color: "#FFF", fontWeight: "800", fontSize: 13, backgroundColor: "rgba(255,255,255,0.25)", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  uploadBtn: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    borderWidth: 2,
    borderStyle: "dashed",
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  uploadTxt: { fontWeight: "700", fontSize: 13 },
  emptyTxt: { fontSize: 12, color: theme.color.muted, fontStyle: "italic", textAlign: "center", paddingVertical: 8 },
  billCard: {
    backgroundColor: theme.color.surface,
    borderRadius: 10,
    marginTop: 8,
    borderWidth: 1,
    borderColor: theme.color.border,
    overflow: "hidden",
  },
  billHeader: { flexDirection: "row", alignItems: "center", padding: 12 },
  billName: { fontSize: 13, fontWeight: "700", color: theme.color.onSurface },
  statusRow: { flexDirection: "row", alignItems: "center", marginTop: 2, gap: 3 },
  statusTxt: { fontSize: 11, fontWeight: "600" },
  metaTxt: { fontSize: 11, color: theme.color.muted },
  billBody: { paddingHorizontal: 12, paddingBottom: 12, borderTopWidth: 1, borderTopColor: theme.color.border },
  errorBox: { backgroundColor: "#FEE2E2", borderRadius: 8, padding: 10, marginTop: 10 },
  errorTxt: { color: "#991B1B", fontSize: 12 },
  dataBox: { marginTop: 8, backgroundColor: "#FAFBFF", borderRadius: 8, padding: 8, overflow: "hidden" },
  kvRow: { flexDirection: "row", paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: "#EEF2FF", alignItems: "flex-start" },
  kvKey: { fontSize: 11, fontWeight: "700", color: theme.color.muted, width: 110, paddingRight: 6 },
  kvVal: { fontSize: 11, color: theme.color.onSurface, flex: 1, flexShrink: 1, flexWrap: "wrap" },
  bulletRow: { flexDirection: "row", paddingVertical: 2, alignItems: "flex-start" },
  bulletDot: { fontSize: 12, color: theme.color.brandPrimary, width: 14, marginTop: 1 },
  bulletTxt: { fontSize: 11, color: theme.color.onSurface, flex: 1, lineHeight: 15 },
  actionsRow: { flexDirection: "row", gap: 6, marginTop: 10, flexWrap: "wrap" },
  actBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  actBtnTxt: { fontSize: 11, fontWeight: "700", color: theme.color.onSurface },
  reportBtn: {
    marginTop: 24,
    backgroundColor: "#6366F1",
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    padding: 14,
    borderRadius: 12,
  },
  reportBtnTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
  compareBtn: {
    marginTop: 12,
    backgroundColor: "#7C3AED",
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    padding: 14,
    borderRadius: 12,
  },
  offersCard: {
    backgroundColor: "#F5F3FF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#DDD6FE",
    marginBottom: 16,
    overflow: "hidden",
  },
  offersHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
  },
  offersTitle: { fontSize: 13, fontWeight: "800", color: "#7C3AED" },
  offersSub: { fontSize: 11, color: theme.color.muted, marginTop: 2, lineHeight: 14 },
  offerCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF",
    borderRadius: 8,
    padding: 8,
    marginTop: 6,
    borderWidth: 1,
    borderColor: "#EDE9FE",
  },
  offerCardTitle: { fontSize: 12, fontWeight: "700", color: theme.color.onSurface },
});

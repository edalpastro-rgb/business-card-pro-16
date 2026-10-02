/**
 * V29.an — ChatTableExport (jspdf rimosso, ora usa expo-print)
 * Rende una tabella markdown parsata (headers + rows) e offre 2 opzioni di export:
 *  1. "Scarica PDF"           → PDF vero via expo-print (HTML → PDF nativo, funziona su Hermes)
 *  2. "Condividi come immagine" → PNG generato da canvas (web) o view-shot (native)
 *
 * Rispetto alla versione precedente: `jspdf` è stato COMPLETAMENTE RIMOSSO per
 * evitare il crash Hermes `RangeError: Unknown encoding: latin1` a livello di
 * modulo. `expo-print.printToFileAsync` genera un PDF con l'engine nativo iOS
 * (UIKit) / Android (WebView -> print) partendo da HTML, senza dipendenze JS
 * problematiche.
 *
 * Se l'utente è Master, il file esportato viene anche salvato in "Insegna ad
 * Axon" (categoria "Dati esportati") per l'auto-apprendimento.
 */
import { fetchOrgSignature } from "@/src/BrandHeaderImage";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, Modal, ScrollView, ActivityIndicator, Platform, Image } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useInsetsSafe } from "@/src/hooks/useSafeBottom";
import * as Print from "expo-print";
import * as FileSystem from "expo-file-system/legacy";
import { useSafeBottom } from "@/src/hooks/useSafeBottom";
import { captureRef } from "react-native-view-shot";
import { shareDataUri } from "@/src/share";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { useAuth } from "@/src/auth";
import { useRole } from "@/src/useRole"; // V50.z436 — permessi centralizzati
import { tryParseChart, type ChartSpec } from "@/src/ChatChartExport";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

export type ParsedTable = {
  headers: string[];
  rows: string[][];
  raw: string; // Original markdown block (for saving)
};

/** V50.z109 — Segmenti supportati: testo, tabella markdown, grafico (```chart blocks). */
export type MessageSegment =
  | { type: "text"; content: string }
  | { type: "table"; table: ParsedTable }
  | { type: "chart"; chart: ChartSpec };

/** Splits a chat message into segments: text vs table (markdown tables) vs chart (```chart fenced blocks). */
export function parseMessageSegments(content: string): MessageSegment[] {
  const lines = content.split(/\r?\n/);
  const out: MessageSegment[] = [];
  let bufText: string[] = [];
  let i = 0;
  const flushText = () => {
    if (bufText.length) {
      const txt = bufText.join("\n").replace(/^\n+|\n+$/g, "");
      if (txt) out.push({ type: "text", content: txt });
      bufText = [];
    }
  };
  while (i < lines.length) {
    const line = lines[i];

    // V50.z109 — ```chart fenced JSON block (Axon-generated visualizzazioni)
    const fenceMatch = /^\s*```(chart|axon-chart|json-chart)\s*$/i.exec(line);
    if (fenceMatch) {
      // Cerca la chiusura ``` sulle righe successive
      const jsonBuf: string[] = [];
      let j = i + 1;
      let closed = false;
      while (j < lines.length) {
        if (/^\s*```\s*$/.test(lines[j])) { closed = true; break; }
        jsonBuf.push(lines[j]);
        j++;
      }
      if (closed) {
        const raw = jsonBuf.join("\n").trim();
        const chart = tryParseChart(raw);
        if (chart) {
          flushText();
          out.push({ type: "chart", chart });
          i = j + 1;
          continue;
        }
        // Fallthrough: se il JSON non è valido, tratta come testo (mantiene il fence
        // per debug lato master).
      }
      // Non è un chart valido → cade nel branch testo
    }

    const next = lines[i + 1] || "";
    const looksLikeHeader = /^\s*\|.*\|\s*$/.test(line);
    const looksLikeSeparator = /^\s*\|?\s*:?-{2,}:?(\s*\|\s*:?-{2,}:?)+\s*\|?\s*$/.test(next);
    if (looksLikeHeader && looksLikeSeparator) {
      const start = i;
      const headers = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      const raw = lines.slice(start, i).join("\n");
      flushText();
      out.push({ type: "table", table: { headers, rows, raw } });
      continue;
    }
    bufText.push(line);
    i += 1;
  }
  flushText();
  return out;
}

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  // V50.z207 — le celle non renderizzano il Markdown: rimuovi i marcatori **grassetto** (restano emoji 🔴/🟢)
  return s.split(/\|/).map((c) => c.trim().replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1").replace(/(^|\s)_([^_]+)_(?=\s|$)/g, "$1$2"));
}

/** V50.z245 — Tinta riga dal marcatore nella prima cella: 🟡 previsione (giallo) · 🔴 massimo · 🟢 minimo. */
function rowTint(r: string[]): { backgroundColor: string } | null {
  const c0 = (r[0] || "").trimStart();
  if (c0.startsWith("🟡")) return { backgroundColor: HT.warningTint };
  if (c0.startsWith("🔴")) return { backgroundColor: HT.dangerTint };
  if (c0.startsWith("🟢")) return { backgroundColor: HT.successTint };
  return null;
}

/** V50.z289 — data leggibile per i nomi file (es. 21-09-2026), niente nomi tutti numerici. */
export function dateStamp(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

/** V50.z289 — Titolo parlante della tabella (es. «PUN medi per fasce · ultimi 18 mesi»). */
export function deriveTableTitle(table: ParsedTable): string {
  const heads = table.headers.map((h) => h.toLowerCase());
  const n = table.rows.length;
  const monthly = heads[0]?.includes("mese") || /^(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\b/i.test(table.rows[0]?.[0]?.replace(/^[^\wÀ-ÿ]+/, "") || "");
  if (heads.some((h) => h.includes("pun"))) {
    const fasce = heads.some((h) => /\bf[123]\b/.test(h));
    return `PUN ${fasce ? "medi per fasce" : "medio mensile"}${monthly ? ` · ultimi ${n} mesi` : ""}`;
  }
  if (heads.some((h) => h.includes("psv"))) return `PSV gas${monthly ? ` · ultimi ${n} mesi` : ""}`;
  const first = table.headers[0]?.replace(/[*_`]/g, "").trim();
  return first ? `Tabella ${first} · ${n} righe` : `Tabella · ${n} righe`;
}

/** V50.z289 — nome file sicuro e leggibile: «Tabella PUN medi per fasce 21-09-2026». */
export function tableFileName(title: string, ext: string): string {
  const base = title.replace(/[·|/\\:*?"<>]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 70);
  return `${base.toLowerCase().startsWith("tabella") ? base : `Tabella ${base}`} ${dateStamp()}.${ext}`;
}

/** V50.z289 — cella markdown → HTML: **grassetto**, _corsivo_, escape del resto. */
export function cellHtml(c: string): string {
  return escapeHtml(c).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(^|\s)_(.+?)_(?=\s|$)/g, "$1<i>$2</i>");
}

/**
 * V29.an — HTML sicuro con escape delle celle. Usato come input di expo-print.
 * Riproduce lo stile del vecchio PDF jspdf: header viola brand, zebra striping,
 * meta-riga di export in alto.
 */
function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** V50.z289 — solo la <table> (riusata anche nell'export PDF dei messaggi chat, stessa maschera della chat). */
export function tableInnerHtml(table: ParsedTable): string {
  const headerCells = table.headers.map((h) => `<th>${cellHtml(h)}</th>`).join("");
  const bodyRows = table.rows
    .map(
      (r, ri) =>
        `<tr class="${ri % 2 === 1 ? "zebra" : ""}"${rowTint(r) ? ` style="background:${rowTint(r)!.backgroundColor}"` : ""}>${r.map((c) => `<td${rowTint(r) ? ` style="background:${rowTint(r)!.backgroundColor}"` : ""}>${cellHtml(c)}</td>`).join("")}</tr>`,
    )
    .join("");
  return `<table><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table>`;
}

/** CSS tabella con font/padding parametrici (V50.z317: adattati per far stare tutto in UNA pagina). */
export function tableCss(fontSize = 10, pad = 6, singlePage = false): string {
  return `
    table { width: 100%; border-collapse: collapse; font-size: ${fontSize}px; line-height: 1.25; table-layout: auto; page-break-inside: ${singlePage ? "avoid" : "auto"}; }
    thead th { background: #7C3AED; color: #FFFFFF; text-align: left; font-weight: 700; padding: ${pad + 1}px ${pad}px; border: 1px solid #7C3AED; }
    tbody td { padding: ${pad}px; border: 1px solid #E5E7EB; vertical-align: top; word-break: break-word; }
    tbody tr.zebra td { background: #F8FAFC; }
    tbody tr { page-break-inside: avoid; page-break-after: auto; }`;
}
export const TABLE_CSS = tableCss();

/** Punti A4 (72 dpi) e margini pagina usati nei PDF tabella. */
export const PDF_PAGE = { portrait: { w: 595, h: 842 }, landscape: { w: 842, h: 595 }, margin: 20 } as const;

/**
 * V50.z317 — Calcola font e padding perché intestazione + titolo + data + tabella stiano in UNA sola pagina A4.
 * Stima altezza riga = font*1.25 + 2*pad + 1 (bordo); riduce progressivamente fino a 6px.
 */
export function fitTableLayout(rowCount: number, colCount: number, hasBrand: boolean, extraLines = 1): { fontSize: number; pad: number; orientation: "portrait" | "landscape"; pageW: number; pageH: number; fits: boolean } {
  const orientation: "portrait" | "landscape" = colCount > 5 ? "landscape" : "portrait";
  const page = PDF_PAGE[orientation];
  const available = page.h - 2 * PDF_PAGE.margin - (hasBrand ? 84 : 0) - 30 /* h1 */ - 26 /* meta */ - extraLines * 16 - 12;
  let fontSize = 10;
  let pad = 6;
  let fits = false;
  for (; fontSize >= 6; fontSize -= 0.5) {
    pad = Math.max(2, Math.round(fontSize * 0.55));
    const rowH = fontSize * 1.25 + 2 * pad + 1;
    const headH = fontSize * 1.25 + 2 * (pad + 1) + 1;
    if (headH + rowCount * rowH <= available) { fits = true; break; }
  }
  // tabelle enormi (non stanno in una pagina nemmeno a 6px): pagine multiple, senza spingere tutto in pagina 2
  return { fontSize: Math.max(6, fontSize), pad, orientation, pageW: page.w, pageH: page.h, fits };
}

function tableToHtml(table: ParsedTable, title: string, brand?: TableBrandHeader | null, orgSig = ""): string {
  const hasBrand = !!(brand && (brand.name || brand.logo_base64));
  const fit = fitTableLayout(table.rows.length, table.headers.length, hasBrand, orgSig ? 2 : 1);
  const orientation = fit.orientation;
  const exportedAt = new Date().toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  // V50.z140 — Header tabella (logo + nome azienda) configurato dal Master
  const brandLogo = brand?.logo_base64 ? toDataUri(brand.logo_base64) : "";
  const brandBlock = brand && (brand.name || brandLogo)
    ? `<div class="brand">${brandLogo ? `<img class="brand-logo" src="${brandLogo}" alt="logo" />` : ""}<div class="brand-name">${escapeHtml(brand.name || "")}</div></div>`
    : "";
  return `<!DOCTYPE html><html lang="it"><head>
  <meta charset="UTF-8">
  <title>${escapeHtml(title)}</title>
  <style>
    @page { size: A4 ${orientation}; margin: ${PDF_PAGE.margin}px; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body { font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif; color: #1B2B4B; }
    .brand { display: flex; align-items: center; gap: 14px; padding-bottom: 8px; margin-bottom: 10px; border-bottom: 3px solid #7C3AED; height: 66px; }
    .brand-logo { max-height: 48px; max-width: 160px; object-fit: contain; }
    .brand-name { font-size: 18px; font-weight: 800; color: #1E3A5F; }
    h1 { color: #4C1D95; font-size: 16px; margin: 0 0 2px 0; font-weight: 800; letter-spacing: -0.2px; line-height: 20px; }
    .meta { color: #64748B; font-size: 10px; margin: 0 0 10px 0; line-height: 14px; }
    ${tableCss(fit.fontSize, fit.pad, fit.fits)}
    .footer { color: #94A3B8; font-size: 8px; margin: 6px 0 0 0; font-style: italic; line-height: 12px; page-break-inside: avoid; }
  </style>
  </head><body>
    ${brandBlock}
    <h1>${escapeHtml(title)}</h1>
    <p class="meta">${escapeHtml(exportedAt)}</p>
    ${tableInnerHtml(table)}
    <p class="footer">${table.rows.length} righe · ${table.headers.length} colonne${orgSig ? ` · ${escapeHtml(orgSig)}` : ""}</p>
  </body></html>`;
}

/** V50.z140 — Header tabella (logo + nome azienda) del tenant, da `GET /api/table-header`. */
export type TableBrandHeader = { name: string; logo_base64: string; source: "table" | "branding" | "none" };

function toDataUri(b64: string): string {
  return b64.startsWith("data:") ? b64 : `data:image/png;base64,${b64}`;
}

let _brandCache: { data: TableBrandHeader; at: number } | null = null;
let _brandInflight: Promise<TableBrandHeader> | null = null;
const BRAND_TTL_MS = 30_000;

/** Invalidazione esplicita (es. dopo il salvataggio in Impostazioni). */
export function invalidateTableBrandHeader() {
  _brandCache = null;
}

export async function fetchTableBrandHeader(): Promise<TableBrandHeader> {
  if (_brandCache && Date.now() - _brandCache.at < BRAND_TTL_MS) return _brandCache.data;
  if (_brandInflight) return _brandInflight;
  _brandInflight = api<TableBrandHeader>("/table-header")
    .then((d) => {
      const data: TableBrandHeader = { name: d?.name || "", logo_base64: d?.logo_base64 || "", source: d?.source || "none" };
      _brandCache = { data, at: Date.now() };
      return data;
    })
    .catch(() => ({ name: "", logo_base64: "", source: "none" as const }))
    .finally(() => { _brandInflight = null; });
  return _brandInflight;
}

function useTableBrandHeader(): TableBrandHeader | null {
  const [brand, setBrand] = useState<TableBrandHeader | null>(_brandCache?.data || null);
  useEffect(() => {
    let alive = true;
    fetchTableBrandHeader().then((b) => { if (alive) setBrand(b); });
    return () => { alive = false; };
  }, []);
  return brand;
}

/** Riga header (logo + nome) mostrata sopra la tabella (anteprima compatta e schermo intero). */
function BrandHeaderRow({ brand, large }: { brand: TableBrandHeader | null; large?: boolean }) {
  if (!brand || (!brand.name && !brand.logo_base64)) return null;
  return (
    <View style={[styles.brandRow, large && styles.brandRowLarge]} testID="table-brand-header">
      {!!brand.logo_base64 && (
        <Image source={{ uri: toDataUri(brand.logo_base64) }} resizeMode="contain" style={large ? styles.brandLogoLarge : styles.brandLogo} />
      )}
      {!!brand.name && (
        <Text style={[styles.brandName, large && styles.brandNameLarge]} numberOfLines={1}>{brand.name}</Text>
      )}
    </View>
  );
}

/**
 * V50.z317 — WEB: stampa SOLO l'HTML passato (finestra dedicata + window.print).
 * NB: su web `Print.printAsync({html})` di expo-print chiama semplicemente window.print()
 * → stamperebbe l'intera pagina della chat. Per questo tutti gli export PDF web passano da qui.
 */
export function printHtmlWeb(html: string): void {
  try {
    const w = window.open("", "_blank", "width=900,height=1000");
    if (!w) throw new Error("Popup bloccato dal browser");
    w.document.open();
    w.document.write(html);
    w.document.close();
    setTimeout(() => {
      try { w.focus(); w.print(); } catch { /* noop */ }
    }, 350);
  } catch (e: any) {
    throw new Error(`Errore stampa PDF: ${e?.message || String(e)}`);
  }
}

/**
 * V29.an — Genera un PDF reale via expo-print (native) o print dialog (web).
 *
 * - Native (iOS/Android): `Print.printToFileAsync({ html })` scrive un PDF nel
 *   cache dir del sandbox app; poi lo leggiamo in base64 con expo-file-system.
 * - Web: `Print.printToFileAsync` non è supportato → apriamo l'HTML in una
 *   nuova finestra e triggeriamo `window.print()` (l'utente lo salva come PDF
 *   dal dialog del browser). In questo caso NON restituiamo base64 e il flusso
 *   di auto-save su Axon knowledge viene saltato (segnalato al chiamante con
 *   `null`).
 */
async function tableToPdfBase64(table: ParsedTable, title: string, brand?: TableBrandHeader | null): Promise<string | null> {
  const html = tableToHtml(table, title, brand, await fetchOrgSignature()); // V50.z233 — firma aziendale nei report/tabelle esportati
  if (Platform.OS === "web") {
    printHtmlWeb(html);
    return null; // No base64 available on web print flow
  }
  // Native (iOS/Android)
  const fit = fitTableLayout(table.rows.length, table.headers.length, !!(brand && (brand.name || brand.logo_base64)));
  const { uri } = await Print.printToFileAsync({
    html,
    // width/height in points (72dpi). A4 portrait = 595 x 842.
    width: fit.pageW,
    height: fit.pageH,
    base64: false,
  });
  // Leggi il file come base64 (expo-file-system è stabile su Hermes)
  const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  return b64;
}

/** V50.z53 — DEPRECATED: non più utilizzata. Manteneva l'auto-save delle
 * tabelle esportate come regole "Insegna ad Axon" (categoria "Dati esportati").
 * Rimossa perché la nuova logica PINNED trattava queste regole come istruzioni
 * assolute con valori datati. Il Master può salvare manualmente se serve. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function _saveToAxonKnowledge_DEPRECATED(_table: ParsedTable, _filename: string, _mime: string, _data_base64: string): Promise<boolean> {
  return false;
}

export function ChatTableExport({ table, assistantColor = "#8B5CF6" }: { table: ParsedTable; assistantColor?: string }) {
  const { user } = useAuth();
  const { isMaster } = useRole();
  const safeBottom = useSafeBottom(); // V29.aq
  const insets = useInsetsSafe(); // V50.z165 — fallback bottom dentro Modal
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState(false); // V50.z140 — modal a schermo intero
  const [busyFormat, setBusyFormat] = useState<"pdf" | "png" | null>(null);
  const captureRefEl = useRef<View>(null);
  const captureFullRef = useRef<View>(null);
  const brand = useTableBrandHeader(); // V50.z140 — logo + nome azienda in testa alla tabella

  const previewRows = useMemo(() => table.rows.slice(0, 30), [table.rows]);
  // V50.z140 — larghezza colonne adattiva a schermo intero (min 110, max 240) in base al testo
  const fullColWidths = useMemo(() => table.headers.map((h, ci) => {
    const maxLen = table.rows.reduce((m, r) => Math.max(m, (r[ci] || "").length), h.length);
    return Math.max(110, Math.min(240, 40 + maxLen * 7));
  }), [table]);

  const doExport = useCallback(async (format: "pdf" | "png", source: "preview" | "full" = "preview") => {
    try {
      setBusyFormat(format);
      // V50.z289 — titolo parlante + nome file con data leggibile (es. «Tabella PUN medi per fasce 21-09-2026.pdf»)
      const title = deriveTableTitle(table);
      const filename = tableFileName(title, format);
      const mime = format === "pdf" ? "application/pdf" : "image/png";
      let data_base64: string | null = "";

      if (format === "pdf") {
        const b = brand && brand.name ? brand : { ...(brand || { logo_base64: "", source: "none" as const }), name: user?.name || "" };
        data_base64 = await tableToPdfBase64(table, title, b);
        // Su web `tableToPdfBase64` apre il print dialog del browser e ritorna null.
        // In quel caso non condividiamo né salviamo — il PDF è già stato prodotto dal browser.
        if (data_base64 === null) {
          notify("PDF pronto", "Il PDF è stato generato nel dialog di stampa del browser. Usa \"Salva come PDF\" dal menù di stampa.");
          setOpen(false);
          return;
        }
      } else {
        // PNG: cross-platform capture
        if (Platform.OS === "web") {
          data_base64 = await drawTableToPngWeb(table, brand);
        } else {
          const target = source === "full" ? captureFullRef.current : captureRefEl.current;
          if (!target) throw new Error("Anteprima non disponibile per lo snapshot");
          const uri = await captureRef(target, { format: "png", quality: 1, result: "base64" });
          data_base64 = uri;
        }
      }

      await shareDataUri(`data:${mime};base64,${data_base64}`, filename, mime);

      // V50.z53 — Auto-save "Dati esportati" RIMOSSO.
      // Motivazione: la nuova logica delle regole PINNED tratta le regole con
      // auto_generated non impostato come regole manuali ad alta priorità.
      // L'auto-save di ogni tabella esportata creava regole con dati datati
      // che Axon usava come riferimento assoluto (poison rules).
      // Se il Master vuole insegnare una tabella specifica, la aggiunge
      // manualmente da "Insegna ad Axon".
      setOpen(false);
    } catch (e: any) {
      notify("Errore esportazione", e?.message || String(e));
    } finally {
      setBusyFormat(null);
    }
  }, [table, isMaster, brand]);

  return (
    <View style={styles.wrap}>
      {/* Table preview (scrollable) — usato anche come capture-target su native.
          V50.z140: un tap apre la tabella a schermo intero. */}
      <Pressable onPress={() => setFull(true)} testID="table-open-fullscreen" accessibilityRole="button" accessibilityLabel="Apri tabella a schermo intero">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tableScroll}>
          <View ref={captureRefEl} collapsable={false} style={[styles.table, { backgroundColor: HT.card }]}>
            <BrandHeaderRow brand={brand} />
            <View style={[styles.row, styles.headerRow, { backgroundColor: assistantColor }]}>
              {table.headers.map((h, i) => (
                <View key={i} style={[styles.cell, i === table.headers.length - 1 && styles.cellLast]}>
                  <Text style={styles.headerCellTxt} numberOfLines={2}>{h}</Text>
                </View>
              ))}
            </View>
            {previewRows.map((r, ri) => (
              <View key={ri} style={[styles.row, ri % 2 === 1 && { backgroundColor: HT.card2 }, rowTint(r)]}>
                {r.map((c, ci) => (
                  <View key={ci} style={[styles.cell, ci === r.length - 1 && styles.cellLast]}>
                    <Text style={styles.cellTxt} numberOfLines={3}>{c}</Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      </Pressable>
      <View style={styles.underRow}>
        <Text style={styles.tapHint}>
          <Ionicons name="expand-outline" size={10} color={HT.muted} /> Tocca la tabella per lo schermo intero
        </Text>
        {table.rows.length > previewRows.length ? (
          <Text style={styles.moreRowsTxt}>… e altre {table.rows.length - previewRows.length} righe (incluse nell&apos;export)</Text>
        ) : null}
      </View>

      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <Pressable
          testID="table-fullscreen-btn"
          onPress={() => setFull(true)}
          style={[styles.exportBtn, { borderColor: assistantColor }]}
        >
          <Ionicons name="expand-outline" size={16} color={assistantColor} />
          <Text style={[styles.exportBtnTxt, { color: assistantColor }]}>Schermo intero</Text>
        </Pressable>
        <Pressable
          testID="table-export-btn"
          onPress={() => setOpen(true)}
          style={[styles.exportBtn, { borderColor: assistantColor }]}
        >
          <Ionicons name="download-outline" size={16} color={assistantColor} />
          <Text style={[styles.exportBtnTxt, { color: assistantColor }]}>Esporta tabella</Text>
        </Pressable>
      </View>

      {/* V50.z140 — Modal a schermo intero: tutte le righe, scroll verticale + orizzontale,
          header tabella (logo + nome azienda), footer FISSO con export + chiudi (regola modal). */}
      <Modal visible={full} animationType="slide" onRequestClose={() => !busyFormat && setFull(false)} presentationStyle="fullScreen">
        <View style={[styles.fullRoot, { paddingTop: insets.top }]}>
          <View style={styles.fullHdr}>
            <View style={{ flex: 1 }}>
              <Text style={styles.fullTitle} numberOfLines={1}>{deriveTableTitle(table)}</Text>
              <Text style={styles.fullSub}>{table.rows.length} righe · {table.headers.length} colonne · scorri in ogni direzione</Text>
            </View>
            <Pressable onPress={() => !busyFormat && setFull(false)} hitSlop={12} style={styles.fullClose} testID="table-fullscreen-close">
              <Ionicons name="close" size={22} color={HT.text} />
            </Pressable>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.fullScrollV} showsVerticalScrollIndicator>
            <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ paddingRight: 12 }}>
              <View ref={captureFullRef} collapsable={false} style={styles.fullTable}>
                <BrandHeaderRow brand={brand} large />
                <View style={[styles.row, { backgroundColor: assistantColor }]}>
                  {table.headers.map((h, i) => (
                    <View key={i} style={[styles.cellFull, { width: fullColWidths[i] }, i === table.headers.length - 1 && styles.cellLast]}>
                      <Text style={styles.headerCellTxtFull}>{h}</Text>
                    </View>
                  ))}
                </View>
                {table.rows.map((r, ri) => (
                  <View key={ri} style={[styles.row, ri % 2 === 1 && { backgroundColor: HT.card2 }, rowTint(r)]} testID={`table-full-row-${ri}`}>
                    {table.headers.map((_, ci) => (
                      <View key={ci} style={[styles.cellFull, { width: fullColWidths[ci] }, ci === table.headers.length - 1 && styles.cellLast]}>
                        <Text style={styles.cellTxtFull}>{r[ci] ?? ""}</Text>
                      </View>
                    ))}
                  </View>
                ))}
              </View>
            </ScrollView>
          </ScrollView>
          <View style={[styles.fullFooter, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            <Pressable
              testID="table-full-export-pdf"
              onPress={() => doExport("pdf", "full")}
              disabled={!!busyFormat}
              style={[styles.fullBtn, { backgroundColor: '#DC2626' }, !!busyFormat && { opacity: 0.6 }]}
            >
              {busyFormat === "pdf" ? <ActivityIndicator color="#FFF" size="small" /> : <Ionicons name="document" size={16} color="#FFF" />}
              <Text style={styles.fullBtnTxt}>PDF</Text>
            </Pressable>
            <Pressable
              testID="table-full-export-png"
              onPress={() => doExport("png", "full")}
              disabled={!!busyFormat}
              style={[styles.fullBtn, { backgroundColor: '#0891B2' }, !!busyFormat && { opacity: 0.6 }]}
            >
              {busyFormat === "png" ? <ActivityIndicator color="#FFF" size="small" /> : <Ionicons name="image" size={16} color="#FFF" />}
              <Text style={styles.fullBtnTxt}>Immagine</Text>
            </Pressable>
            <Pressable
              testID="table-full-close-btn"
              onPress={() => !busyFormat && setFull(false)}
              style={[styles.fullBtn, { backgroundColor: '#1B2B4B', flex: 1.2 }]}
            >
              <Ionicons name="checkmark" size={16} color="#FFF" />
              <Text style={styles.fullBtnTxt}>Chiudi</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal transparent visible={open} animationType="fade" onRequestClose={() => !busyFormat && setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => !busyFormat && setOpen(false)}>
          <Pressable style={[styles.sheet, { paddingBottom: safeBottom + 12 }]} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHdr}>
              <Text style={styles.sheetTitle}>Esporta tabella</Text>
              <Pressable onPress={() => !busyFormat && setOpen(false)} hitSlop={10}>
                <Ionicons name="close" size={22} color={HT.text} />
              </Pressable>
            </View>
            <View style={styles.optionsRow}>
              <FormatOption
                testID="export-pdf"
                icon="document"
                label="Scarica PDF"
                sub="Tabella formattata"
                color="#DC2626"
                busy={busyFormat === "pdf"}
                disabled={!!busyFormat && busyFormat !== "pdf"}
                onPress={() => doExport("pdf")}
              />
              <FormatOption
                testID="export-png"
                icon="image"
                label="Condividi immagine"
                sub="PNG condivisibile"
                color="#0891B2"
                busy={busyFormat === "png"}
                disabled={!!busyFormat && busyFormat !== "png"}
                onPress={() => doExport("png")}
              />
            </View>
            {isMaster ? (
              <Text style={styles.hint}>
                <Ionicons name="sparkles" size={11} color="#8B5CF6" /> Il file verrà salvato anche tra i file di Axon per l&apos;auto-apprendimento.
              </Text>
            ) : (
              <Text style={styles.hint}>Il file verrà scaricato o condiviso dal tuo dispositivo.</Text>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

/** V28.t — Disegna la tabella su un canvas HTML e ritorna PNG base64 (senza prefisso). Solo web. */
async function drawTableToPngWeb(table: ParsedTable, brand?: TableBrandHeader | null): Promise<string> {
  // Dimensionamento heuristico
  const cellPadding = 10;
  const headerH = 32;
  const rowH = 26;
  const fontHeader = 13;
  const fontCell = 12;
  // V50.z140 — Header tabella (logo + nome azienda)
  const hasBrand = !!(brand && (brand.name || brand.logo_base64));
  const brandH = hasBrand ? 64 : 0;
  let logoImg: HTMLImageElement | null = null;
  if (hasBrand && brand?.logo_base64) {
    logoImg = await new Promise<HTMLImageElement | null>((resolve) => {
      const im = new window.Image();
      im.onload = () => resolve(im);
      im.onerror = () => resolve(null);
      im.src = toDataUri(brand.logo_base64);
    });
  }
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas non disponibile");
  // Calcola larghezza colonne in base al testo
  ctx.font = `bold ${fontHeader}px -apple-system, Segoe UI, Roboto, sans-serif`;
  const colWidths = table.headers.map((h, ci) => {
    const headW = ctx.measureText(h).width;
    ctx.font = `${fontCell}px -apple-system, Segoe UI, Roboto, sans-serif`;
    const cellW = table.rows.reduce((mx, r) => Math.max(mx, ctx.measureText(r[ci] || "").width), 0);
    ctx.font = `bold ${fontHeader}px -apple-system, Segoe UI, Roboto, sans-serif`;
    return Math.max(Math.min(Math.max(headW, cellW) + cellPadding * 2, 300), 90);
  });
  const totalW = Math.max(colWidths.reduce((a, b) => a + b, 0), hasBrand ? 320 : 0);
  const totalH = brandH + headerH + table.rows.length * rowH + 40;
  // Retina 2x
  const scale = 2;
  canvas.width = totalW * scale;
  canvas.height = totalH * scale;
  canvas.style.width = `${totalW}px`;
  canvas.style.height = `${totalH}px`;
  ctx.scale(scale, scale);
  // BG
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, totalW, totalH);
  // Brand header
  if (hasBrand) {
    let bx = cellPadding;
    if (logoImg) {
      const maxH = 40, maxW = 120;
      const ratio = Math.min(maxW / logoImg.width, maxH / logoImg.height);
      const lw = logoImg.width * ratio, lh = logoImg.height * ratio;
      ctx.drawImage(logoImg, bx, (brandH - 8 - lh) / 2, lw, lh);
      bx += lw + 12;
    }
    if (brand?.name) {
      ctx.fillStyle = "#1E3A5F";
      ctx.font = `bold 18px -apple-system, Segoe UI, Roboto, sans-serif`;
      ctx.textBaseline = "middle";
      ctx.fillText(brand.name, bx, (brandH - 8) / 2);
    }
    ctx.fillStyle = "#7C3AED";
    ctx.fillRect(0, brandH - 8, totalW, 3);
  }
  ctx.translate(0, brandH);
  // Header
  ctx.fillStyle = "#7C3AED";
  ctx.fillRect(0, 0, totalW, headerH);
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `bold ${fontHeader}px -apple-system, Segoe UI, Roboto, sans-serif`;
  ctx.textBaseline = "middle";
  let x = 0;
  table.headers.forEach((h, ci) => {
    ctx.fillText(h, x + cellPadding, headerH / 2);
    x += colWidths[ci];
  });
  // Rows
  ctx.font = `${fontCell}px -apple-system, Segoe UI, Roboto, sans-serif`;
  table.rows.forEach((r, ri) => {
    const y = headerH + ri * rowH;
    if (ri % 2 === 1) {
      ctx.fillStyle = "#F8FAFC";
      ctx.fillRect(0, y, totalW, rowH);
    }
    ctx.fillStyle = HT.text;
    let cx = 0;
    r.forEach((c, ci) => {
      // Clip text to column width
      const maxW = colWidths[ci] - cellPadding * 2;
      let txt = c;
      while (ctx.measureText(txt).width > maxW && txt.length > 1) txt = txt.slice(0, -1);
      if (txt !== c) txt = txt.slice(0, -1) + "…";
      ctx.fillText(txt, cx + cellPadding, y + rowH / 2);
      cx += colWidths[ci];
    });
    // Row divider
    ctx.strokeStyle = "#E5E7EB";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y + rowH);
    ctx.lineTo(totalW, y + rowH);
    ctx.stroke();
  });
  // Footer meta
  ctx.fillStyle = HT.muted;
  ctx.font = `10px -apple-system, Segoe UI, Roboto, sans-serif`;
  ctx.fillText(`AdvisorOS · ${new Date().toLocaleString("it-IT")}`, cellPadding, headerH + table.rows.length * rowH + 20);
  const dataUri = canvas.toDataURL("image/png");
  return dataUri.split(",").pop() || "";
}

function FormatOption({ testID, icon, label, sub, color, busy, disabled, onPress }: { testID: string; icon: any; label: string; sub: string; color: string; busy: boolean; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={busy || disabled}
      style={[styles.optCard, { borderColor: color }, (busy || disabled) && { opacity: 0.5 }]}
    >
      {busy ? (
        <ActivityIndicator color={color} />
      ) : (
        <Ionicons name={icon} size={26} color={color} />
      )}
      <Text style={[styles.optLbl, { color }]}>{label}</Text>
      <Text style={styles.optSub}>{sub}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 8, gap: 6 },
  tableScroll: { borderRadius: 8, borderWidth: 1, borderColor: HT.border, backgroundColor: HT.card },
  // V49.m — Larghezza uniforme e testo centrato per tutte le celle.
  // Su mobile la ScrollView orizzontale mostra ogni colonna senza tagli.
  table: { minWidth: "100%" },
  row: { flexDirection: "row" },
  headerRow: {},
  cell: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    width: 120,
    alignItems: "center",
    justifyContent: "center",
    borderRightWidth: 1,
    borderRightColor: HT.border,
    borderBottomWidth: 1,
    borderBottomColor: HT.border,
  },
  cellLast: { borderRightWidth: 0 },
  headerCellTxt: { color: "#FFF", fontSize: 11, fontWeight: "800", letterSpacing: 0.2, textAlign: "center" },
  cellTxt: { fontSize: 12, color: HT.text, textAlign: "center" },
  moreRowsTxt: { fontSize: 10, color: HT.muted, fontStyle: "italic", textAlign: "right" },
  underRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" },
  tapHint: { fontSize: 10, color: HT.muted },
  // V50.z140 — Header tabella (logo + nome azienda)
  brandRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingVertical: 6, borderBottomWidth: 2, borderBottomColor: '#7C3AED', backgroundColor: HT.card },
  brandRowLarge: { gap: 12, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 3 },
  brandLogo: { width: 28, height: 22 },
  brandLogoLarge: { width: 72, height: 44 },
  brandName: { fontSize: 12, fontWeight: "800", color: "#1E3A5F", flexShrink: 1 },
  brandNameLarge: { fontSize: 18 },
  // V50.z140 — Modal schermo intero
  fullRoot: { flex: 1, backgroundColor: HT.card2 },
  fullHdr: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: HT.card, borderBottomWidth: 1, borderBottomColor: HT.border },
  fullTitle: { fontSize: 17, fontWeight: "800", color: HT.text },
  fullSub: { fontSize: 11, color: HT.muted, marginTop: 2 },
  fullClose: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: HT.card2 },
  fullScrollV: { padding: 12, paddingBottom: 24 },
  fullTable: { backgroundColor: HT.card, borderRadius: 10, borderWidth: 1, borderColor: HT.border, overflow: "hidden" },
  cellFull: { paddingVertical: 10, paddingHorizontal: 10, justifyContent: "center", borderRightWidth: 1, borderRightColor: HT.border, borderBottomWidth: 1, borderBottomColor: HT.border },
  headerCellTxtFull: { color: "#FFF", fontSize: 13, fontWeight: "800" },
  cellTxtFull: { fontSize: 14, color: HT.text, lineHeight: 20 },
  fullFooter: { flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingTop: 10, backgroundColor: HT.card, borderTopWidth: 1, borderTopColor: HT.border },
  fullBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 46, borderRadius: 12 },
  fullBtnTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
  exportBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1.5, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, alignSelf: "flex-start" },
  exportBtnTxt: { fontSize: 12, fontWeight: "800" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", alignItems: "center", padding: 20 },
  sheet: { backgroundColor: HT.card, borderRadius: 18, padding: 18, width: "100%", maxWidth: 420, gap: 12 },
  sheetHdr: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sheetTitle: { fontSize: 16, fontWeight: "800", color: HT.text },
  optionsRow: { flexDirection: "row", gap: 10 },
  optCard: { flex: 1, alignItems: "center", justifyContent: "center", padding: 16, borderRadius: 12, borderWidth: 1.5, gap: 4, backgroundColor: HT.card },
  optLbl: { fontSize: 14, fontWeight: "800", textAlign: "center" },
  optSub: { fontSize: 10, color: HT.muted, fontWeight: "600", textAlign: "center" },
  hint: { fontSize: 11, color: HT.muted, fontStyle: "italic", textAlign: "center", marginTop: 2 },
});

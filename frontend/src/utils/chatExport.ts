import { Platform, Share } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system/legacy";
import { notify } from "@/src/utils/notify";
// V50.z289 — le tabelle markdown nei messaggi vengono esportate con la STESSA maschera della chat (thead viola, zebra, righe colorate)
import { parseMessageSegments, tableInnerHtml, TABLE_CSS, deriveTableTitle, tableFileName, fetchTableBrandHeader, type ParsedTable } from "@/src/ChatTableExport";

// V50.z160 — Esporta / condividi le chat AxonOS (singolo messaggio o intera
// conversazione): testo via share sheet nativo (WhatsApp, gruppi, mail, social),
// copia negli appunti, PDF via expo-print + expo-sharing.

export type ExportMsg = { role: "user" | "assistant"; content: string; created_at?: string; quick_label?: string | null };

function fmtDate(d?: string): string {
  try {
    const x = d ? new Date(d) : new Date();
    return x.toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}

export function conversationToText(messages: ExportMsg[], assistantName: string, userName?: string): string {
  const lines: string[] = [`Conversazione con ${assistantName} · ${fmtDate()}`, ""];
  for (const m of messages) {
    const who = m.role === "user" ? (userName || "Io") : assistantName;
    const body = (m.role === "user" && m.quick_label) ? m.quick_label : (m.content || "");
    if (!body.trim()) continue;
    lines.push(`${who}:`);
    lines.push(body.trim());
    lines.push("");
  }
  return lines.join("\n").trim();
}

export async function copyText(text: string): Promise<void> {
  try {
    await Clipboard.setStringAsync(text);
    notify("Copiato", "Testo copiato negli appunti");
  } catch {
    notify("Errore", "Impossibile copiare il testo");
  }
}

export async function shareText(text: string, title = "AxonOS"): Promise<void> {
  if (Platform.OS === "web") {
    const nav: any = (globalThis as any).navigator;
    try {
      if (nav?.share) { await nav.share({ title, text }); return; }
    } catch { /* utente ha annullato */ return; }
    await copyText(text);
    return;
  }
  try {
    await Share.share(Platform.OS === "ios" ? { message: text, title } : { message: text, title }, { dialogTitle: title, subject: title });
  } catch (e: any) {
    notify("Errore", e?.message || "Condivisione non disponibile");
  }
}

function esc(s: string): string {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br/>");
}

/** Corpo messaggio: testo + tabelle renderizzate come in chat (niente markdown grezzo). */
function bodyHtml(content: string): string {
  return parseMessageSegments(content || "")
    .map((seg) => {
      if (seg.type === "table") return `<div class="tbl">${tableInnerHtml(seg.table)}</div>`;
      if (seg.type === "chart") return `<div class="body">${esc(seg.chart.title || "Grafico")}</div>`;
      return `<div class="body">${esc(seg.content).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")}</div>`;
    })
    .join("");
}

/** Tabelle contenute nei messaggi (per titolo/nome file). */
export function messagesTables(messages: ExportMsg[]): ParsedTable[] {
  const out: ParsedTable[] = [];
  for (const m of messages) for (const s of parseMessageSegments(m.content || "")) if (s.type === "table") out.push(s.table);
  return out;
}

function buildHtml(messages: ExportMsg[], assistantName: string, userName?: string, title?: string, brandName?: string, brandLogo?: string): string {
  const single = messages.length === 1 && messages[0].role === "assistant";
  const rows = messages
    .filter((m) => ((m.role === "user" && m.quick_label) || (m.content || "").trim()))
    .map((m) => {
      const isUser = m.role === "user";
      const who = isUser ? (userName || "Io") : assistantName;
      const body = isUser && m.quick_label ? m.quick_label : m.content;
      if (single) return bodyHtml(body || ""); // singola risposta: contenuto pulito, senza «bolla» né etichette AxonOS
      return `<div class="msg ${isUser ? "u" : "a"}"><div class="who">${esc(who)}${m.created_at ? ` · <span class="t">${esc(fmtDate(m.created_at))}</span>` : ""}</div>${bodyHtml(body || "")}</div>`;
    })
    .join("");
  const wide = messagesTables(messages).some((tb) => tb.headers.length > 5);
  const brandBlock = brandName || brandLogo ? `<div class="brand">${brandLogo ? `<img class="brand-logo" src="${brandLogo.startsWith("data:") ? brandLogo : `data:image/png;base64,${brandLogo}`}" />` : ""}<div class="brand-name">${esc(brandName || "")}</div></div>` : "";
  return `<!DOCTYPE html><html lang="it"><head><meta charset="utf-8"><title>${esc(title || "Conversazione AxonOS")}</title>
<style>
  @page { size: A4 ${wide ? "landscape" : "portrait"}; margin: 24px; }
  body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #0F172A; margin: 28px; }
  .brand { display: flex; align-items: center; gap: 14px; padding-bottom: 10px; margin-bottom: 14px; border-bottom: 3px solid #7C3AED; }
  .brand-logo { max-height: 56px; max-width: 180px; object-fit: contain; }
  .brand-name { font-size: 20px; font-weight: 800; color: #1E3A5F; }
  h1 { font-size: 18px; margin: 0 0 4px; color: #4C1D95; }
  .sub { color: #64748B; font-size: 12px; margin-bottom: 18px; }
  .tbl { margin: 8px 0 12px; }
  ${TABLE_CSS}
  .msg { border-radius: 12px; padding: 10px 14px; margin: 0 0 10px; page-break-inside: avoid; }
  .u { background: #EDE9FE; margin-left: 15%; }
  .a { background: #F8FAFC; border: 1px solid #E2E8F0; margin-right: 15%; }
  .who { font-size: 11px; font-weight: 700; color: #6D28D9; margin-bottom: 4px; text-transform: uppercase; letter-spacing: .4px; }
  .t { font-weight: 500; color: #94A3B8; text-transform: none; letter-spacing: 0; }
  .body { font-size: 13px; line-height: 1.45; white-space: normal; word-wrap: break-word; }
  .foot { margin-top: 24px; color: #94A3B8; font-size: 10px; text-align: center; }
</style></head><body>
${brandBlock}
<h1>${esc(title || `Conversazione con ${assistantName}`)}</h1>
<div class="sub">${esc(fmtDate())}</div>
${rows}
</body></html>`;
}

/**
 * V50.z289 — PDF di un messaggio o della conversazione:
 *  - intestazione = nome azienda/consulente (header tabelle del Master, altrimenti nome utente), titolo parlante, data e ora;
 *  - tabelle renderizzate come in chat; nome file leggibile («Tabella PUN medi per fasce 21-09-2026.pdf»).
 */
export async function exportConversationPdf(messages: ExportMsg[], assistantName: string, userName?: string, title?: string): Promise<void> {
  const tables = messagesTables(messages);
  const brand = await fetchTableBrandHeader().catch(() => ({ name: "", logo_base64: "", source: "none" as const }));
  const brandName = brand.name || userName || "";
  const docTitle = tables.length === 1 ? deriveTableTitle(tables[0]) : tables.length > 1 ? `${deriveTableTitle(tables[0])} (+${tables.length - 1} tabelle)` : (title || `Conversazione con ${assistantName}`);
  const fileName = tables.length ? tableFileName(docTitle, "pdf") : `${docTitle.replace(/[·|/\\:*?"<>]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60)} ${new Date().toLocaleDateString("it-IT").replace(/\//g, "-")}.pdf`;
  const html = buildHtml(messages, assistantName, userName, docTitle, brandName, brand.logo_base64);
  try {
    if (Platform.OS === "web") {
      await Print.printAsync({ html });
      return;
    }
    const { uri } = await Print.printToFileAsync({ html, width: tables.some((tb) => tb.headers.length > 5) ? 842 : 595, height: tables.some((tb) => tb.headers.length > 5) ? 595 : 842 });
    // rinomina il file (expo-print genera nomi casuali) così il PDF condiviso ha un nome parlante
    let shareUri = uri;
    try {
      const dest = `${FileSystem.cacheDirectory}${fileName}`;
      try { await FileSystem.deleteAsync(dest, { idempotent: true }); } catch {}
      await FileSystem.copyAsync({ from: uri, to: dest });
      shareUri = dest;
    } catch { /* fallback: nome originale */ }
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(shareUri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: docTitle });
    } else {
      notify("PDF creato", shareUri);
    }
  } catch (e: any) {
    notify("Errore", e?.message || "Impossibile generare il PDF");
  }
}

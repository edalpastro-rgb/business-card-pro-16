import { Platform, Share } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { notify } from "@/src/utils/notify";

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

function buildHtml(messages: ExportMsg[], assistantName: string, userName?: string, title?: string): string {
  const rows = messages
    .filter((m) => ((m.role === "user" && m.quick_label) || (m.content || "").trim()))
    .map((m) => {
      const isUser = m.role === "user";
      const who = isUser ? (userName || "Io") : assistantName;
      const body = isUser && m.quick_label ? m.quick_label : m.content;
      return `<div class="msg ${isUser ? "u" : "a"}"><div class="who">${esc(who)}${m.created_at ? ` · <span class="t">${esc(fmtDate(m.created_at))}</span>` : ""}</div><div class="body">${esc(body || "")}</div></div>`;
    })
    .join("");
  return `<!DOCTYPE html><html lang="it"><head><meta charset="utf-8"><title>${esc(title || "Conversazione AxonOS")}</title>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #0F172A; margin: 28px; }
  h1 { font-size: 20px; margin: 0 0 4px; color: #4C1D95; }
  .sub { color: #64748B; font-size: 12px; margin-bottom: 18px; }
  .msg { border-radius: 12px; padding: 10px 14px; margin: 0 0 10px; page-break-inside: avoid; }
  .u { background: #EDE9FE; margin-left: 15%; }
  .a { background: #F8FAFC; border: 1px solid #E2E8F0; margin-right: 15%; }
  .who { font-size: 11px; font-weight: 700; color: #6D28D9; margin-bottom: 4px; text-transform: uppercase; letter-spacing: .4px; }
  .t { font-weight: 500; color: #94A3B8; text-transform: none; letter-spacing: 0; }
  .body { font-size: 13px; line-height: 1.45; white-space: normal; word-wrap: break-word; }
  .foot { margin-top: 24px; color: #94A3B8; font-size: 10px; text-align: center; }
</style></head><body>
<h1>${esc(title || `Conversazione con ${assistantName}`)}</h1>
<div class="sub">Esportato da AdvisorOS · ${esc(fmtDate())}</div>
${rows}
<div class="foot">Generato con AxonOS · AdvisorOS</div>
</body></html>`;
}

export async function exportConversationPdf(messages: ExportMsg[], assistantName: string, userName?: string, title?: string): Promise<void> {
  const html = buildHtml(messages, assistantName, userName, title);
  try {
    if (Platform.OS === "web") {
      await Print.printAsync({ html });
      return;
    }
    const { uri } = await Print.printToFileAsync({ html });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: title || "Conversazione AxonOS" });
    } else {
      notify("PDF creato", uri);
    }
  } catch (e: any) {
    notify("Errore", e?.message || "Impossibile generare il PDF");
  }
}

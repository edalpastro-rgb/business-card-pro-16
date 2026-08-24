/**
 * V28.p — ChatTableExport
 * Rende una tabella markdown parsata (headers + rows) con un pulsante "Esporta"
 * che apre un action-sheet con 3 opzioni: Excel (.xlsx), CSV, PDF.
 * Il file viene sempre condiviso via share sheet nativo / download web, e
 * SE l'utente è Master viene anche salvato automaticamente come regola in
 * "Insegna ad Axon" (categoria "Dati esportati") così che Axon possa usare
 * la tabella come contesto in futuro.
 */
import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, Modal, ScrollView, ActivityIndicator, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as XLSX from "xlsx";
import * as Print from "expo-print";
import * as FileSystem from "expo-file-system/legacy";
import { shareDataUri } from "@/src/share";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { useAuth } from "@/src/auth";

export type ParsedTable = {
  headers: string[];
  rows: string[][];
  raw: string; // Original markdown block (for saving)
};

/**
 * Splits a chat message into segments: text vs table.
 * A markdown table is at least 2 consecutive lines starting with `|` where the
 * SECOND line is a separator like `|---|---|`.
 */
export function parseMessageSegments(content: string): Array<{ type: "text"; content: string } | { type: "table"; table: ParsedTable }> {
  const lines = content.split(/\r?\n/);
  const out: Array<{ type: "text"; content: string } | { type: "table"; table: ParsedTable }> = [];
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
    const next = lines[i + 1] || "";
    const looksLikeHeader = /^\s*\|.*\|\s*$/.test(line);
    const looksLikeSeparator = /^\s*\|?\s*:?-{2,}:?(\s*\|\s*:?-{2,}:?)+\s*\|?\s*$/.test(next);
    if (looksLikeHeader && looksLikeSeparator) {
      // Parse table
      const start = i;
      const headers = splitRow(line);
      i += 2; // skip header + separator
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
  // Trim, strip leading/trailing |, split by unescaped |
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split(/\|/).map((c) => c.trim());
}

function tableToCSV(table: ParsedTable): string {
  const escape = (v: string) => {
    if (v.includes('"') || v.includes(",") || v.includes("\n")) {
      return `"${v.replace(/"/g, '""')}"`;
    }
    return v;
  };
  const lines = [table.headers.map(escape).join(",")];
  table.rows.forEach((r) => lines.push(r.map(escape).join(",")));
  return lines.join("\n");
}

function tableToHTML(table: ParsedTable, title: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>${esc(title)}</title>
<style>
  body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:24px;color:#1B2B4B}
  h1{font-size:18px;margin:0 0 12px;color:#4C1D95;letter-spacing:-0.3px}
  .meta{font-size:11px;color:#94A3B8;margin-bottom:14px}
  table{border-collapse:collapse;width:100%;font-size:12px}
  th{background:#4C1D95;color:#fff;padding:8px 10px;text-align:left;border:1px solid #4C1D95}
  td{padding:7px 10px;border:1px solid #E5E7EB}
  tr:nth-child(even) td{background:#F8FAFC}
  .fx{display:flex;align-items:center;gap:6px;margin-bottom:12px}
  .badge{background:#EDE9FE;color:#4C1D95;padding:3px 8px;border-radius:999px;font-size:10px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase}
</style></head>
<body>
  <div class="fx"><span class="badge">Axon</span><span class="meta">Esportato da Dal Pastro CRM · ${new Date().toLocaleString("it-IT")}</span></div>
  <h1>${esc(title)}</h1>
  <table>
    <thead><tr>${table.headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
    <tbody>
      ${table.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("\n      ")}
    </tbody>
  </table>
</body></html>`;
}

function tableToXlsxBase64(table: ParsedTable, sheetName = "Tabella"): string {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([table.headers, ...table.rows]);
  // Auto width heuristics
  const widths = table.headers.map((h, ci) => {
    const maxCell = table.rows.reduce((acc, r) => Math.max(acc, (r[ci] || "").length), h.length);
    return { wch: Math.min(Math.max(maxCell + 2, 10), 40) };
  });
  ws["!cols"] = widths;
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 30) || "Tabella");
  return XLSX.write(wb, { type: "base64", bookType: "xlsx" }) as string;
}

function nowStamp(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/** Save the exported table as an ai-teach rule so Axon can learn from it.
 *  Silently skips on non-master (403). */
async function saveToAxonKnowledge(table: ParsedTable, filename: string, mime: string, data_base64: string): Promise<boolean> {
  try {
    // Build a compact text preview (max 60 rows)
    const preview = [table.headers.join(" | "), ...table.rows.slice(0, 60).map((r) => r.join(" | "))].join("\n");
    const stamped = new Date().toLocaleString("it-IT");
    await api("/ai-teach/rules", {
      method: "POST",
      body: {
        categories: ["Dati esportati"],
        category: "Dati esportati",
        title: `Tabella esportata · ${stamped}`,
        text: `Dati esportati da una risposta di Axon il ${stamped}. Righe: ${table.rows.length}, colonne: ${table.headers.length}.\n\nAnteprima:\n${preview}`,
        files: [{ name: filename, mime, data_base64 }],
      },
    });
    return true;
  } catch (e: any) {
    // 403 (non-Master) or other errors — silently skip.
    return false;
  }
}

export function ChatTableExport({ table, assistantColor = "#8B5CF6" }: { table: ParsedTable; assistantColor?: string }) {
  const { user } = useAuth();
  const isMaster = !user?.parent_user_id && (user?.role || "member") === "owner";
  const [open, setOpen] = useState(false);
  const [busyFormat, setBusyFormat] = useState<"xlsx" | "csv" | "pdf" | null>(null);

  const previewRows = useMemo(() => table.rows.slice(0, 30), [table.rows]);

  const doExport = useCallback(async (format: "xlsx" | "csv" | "pdf") => {
    try {
      setBusyFormat(format);
      const stamp = nowStamp();
      const baseName = `Tabella-Axon-${stamp}`;
      let filename = baseName;
      let mime = "application/octet-stream";
      let data_base64 = "";
      if (format === "csv") {
        filename = `${baseName}.csv`;
        mime = "text/csv";
        const csv = tableToCSV(table);
        // UTF-8 base64 (browser-safe)
        if (typeof btoa === "function") {
          // Encode as UTF-8 first
          const bytes = new TextEncoder().encode(csv);
          let bin = "";
          bytes.forEach((b) => (bin += String.fromCharCode(b)));
          data_base64 = btoa(bin);
        } else {
          data_base64 = Buffer.from(csv, "utf-8").toString("base64");
        }
      } else if (format === "xlsx") {
        filename = `${baseName}.xlsx`;
        mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        data_base64 = tableToXlsxBase64(table);
      } else {
        // PDF via expo-print
        filename = `${baseName}.pdf`;
        mime = "application/pdf";
        const html = tableToHTML(table, `Tabella esportata (${table.rows.length} righe)`);
        if (Platform.OS === "web") {
          // On web, expo-print isn't reliable. Fallback: share HTML with .pdf name is misleading;
          // instead download the HTML and let the browser export to PDF via print dialog.
          filename = `${baseName}.html`;
          mime = "text/html";
          const bytes = new TextEncoder().encode(html);
          let bin = "";
          bytes.forEach((b) => (bin += String.fromCharCode(b)));
          data_base64 = btoa(bin);
        } else {
          const { uri } = await Print.printToFileAsync({ html });
          data_base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        }
      }

      // Share / download
      await shareDataUri(`data:${mime};base64,${data_base64}`, filename, mime);

      // Auto-save to Axon knowledge (Master only)
      if (isMaster) {
        const saved = await saveToAxonKnowledge(table, filename, mime, data_base64);
        if (saved) {
          notify("Salvato tra i file Axon", `"${filename}" è stato aggiunto alla knowledge base di Axon per l'auto-apprendimento.`);
        }
      }

      setOpen(false);
    } catch (e: any) {
      notify("Errore esportazione", e?.message || String(e));
    } finally {
      setBusyFormat(null);
    }
  }, [table, isMaster]);

  return (
    <View style={styles.wrap}>
      {/* Table preview (horizontally scrollable) */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tableScroll}>
        <View style={styles.table}>
          <View style={[styles.row, styles.headerRow, { backgroundColor: assistantColor }]}>
            {table.headers.map((h, i) => (
              <View key={i} style={[styles.cell, i === table.headers.length - 1 && styles.cellLast]}>
                <Text style={styles.headerCellTxt} numberOfLines={2}>{h}</Text>
              </View>
            ))}
          </View>
          {previewRows.map((r, ri) => (
            <View key={ri} style={[styles.row, ri % 2 === 1 && { backgroundColor: "#F8FAFC" }]}>
              {r.map((c, ci) => (
                <View key={ci} style={[styles.cell, ci === r.length - 1 && styles.cellLast]}>
                  <Text style={styles.cellTxt} numberOfLines={3}>{c}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
      {table.rows.length > previewRows.length ? (
        <Text style={styles.moreRowsTxt}>… e altre {table.rows.length - previewRows.length} righe (incluse nell&apos;export)</Text>
      ) : null}

      {/* Export button */}
      <Pressable
        testID="table-export-btn"
        onPress={() => setOpen(true)}
        style={[styles.exportBtn, { borderColor: assistantColor }]}
      >
        <Ionicons name="download-outline" size={16} color={assistantColor} />
        <Text style={[styles.exportBtnTxt, { color: assistantColor }]}>Esporta tabella</Text>
      </Pressable>

      {/* Format picker modal */}
      <Modal transparent visible={open} animationType="fade" onRequestClose={() => !busyFormat && setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => !busyFormat && setOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHdr}>
              <Text style={styles.sheetTitle}>Esporta come</Text>
              <Pressable onPress={() => !busyFormat && setOpen(false)} hitSlop={10}>
                <Ionicons name="close" size={22} color="#1B2B4B" />
              </Pressable>
            </View>
            <View style={styles.optionsRow}>
              <FormatOption
                testID="export-xlsx"
                icon="grid"
                label="Excel"
                sub=".xlsx"
                color="#10B981"
                busy={busyFormat === "xlsx"}
                disabled={!!busyFormat && busyFormat !== "xlsx"}
                onPress={() => doExport("xlsx")}
              />
              <FormatOption
                testID="export-csv"
                icon="document-text"
                label="CSV"
                sub=".csv"
                color="#3B82F6"
                busy={busyFormat === "csv"}
                disabled={!!busyFormat && busyFormat !== "csv"}
                onPress={() => doExport("csv")}
              />
              <FormatOption
                testID="export-pdf"
                icon="document"
                label="PDF"
                sub={Platform.OS === "web" ? ".html (stampa in PDF)" : ".pdf"}
                color="#DC2626"
                busy={busyFormat === "pdf"}
                disabled={!!busyFormat && busyFormat !== "pdf"}
                onPress={() => doExport("pdf")}
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
        <Ionicons name={icon} size={24} color={color} />
      )}
      <Text style={[styles.optLbl, { color }]}>{label}</Text>
      <Text style={styles.optSub}>{sub}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 8, gap: 6 },
  tableScroll: { borderRadius: 8, borderWidth: 1, borderColor: "#E5E7EB", backgroundColor: "#FFF" },
  table: { minWidth: "100%" },
  row: { flexDirection: "row" },
  headerRow: {},
  cell: { paddingVertical: 6, paddingHorizontal: 8, minWidth: 96, borderRightWidth: 1, borderRightColor: "#E5E7EB", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  cellLast: { borderRightWidth: 0 },
  headerCellTxt: { color: "#FFF", fontSize: 11, fontWeight: "800", letterSpacing: 0.2 },
  cellTxt: { fontSize: 12, color: "#1B2B4B" },
  moreRowsTxt: { fontSize: 10, color: "#94A3B8", fontStyle: "italic", textAlign: "right" },
  exportBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1.5, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, alignSelf: "flex-start" },
  exportBtnTxt: { fontSize: 12, fontWeight: "800" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", alignItems: "center", padding: 20 },
  sheet: { backgroundColor: "#FFF", borderRadius: 18, padding: 18, width: "100%", maxWidth: 420, gap: 12 },
  sheetHdr: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sheetTitle: { fontSize: 16, fontWeight: "800", color: "#1B2B4B" },
  optionsRow: { flexDirection: "row", gap: 10 },
  optCard: { flex: 1, alignItems: "center", justifyContent: "center", padding: 14, borderRadius: 12, borderWidth: 1.5, gap: 4, backgroundColor: "#FFF" },
  optLbl: { fontSize: 14, fontWeight: "800" },
  optSub: { fontSize: 10, color: "#94A3B8", fontWeight: "600" },
  hint: { fontSize: 11, color: "#64748B", fontStyle: "italic", textAlign: "center", marginTop: 2 },
});

/**
 * V28.p / V28.t — ChatTableExport
 * Rende una tabella markdown parsata (headers + rows) e offre 2 opzioni di export:
 *  1. "Scarica PDF"  → PDF vero via jsPDF + jspdf-autotable
 *  2. "Condividi come immagine" → PNG generato da canvas (web) o view-shot (native)
 * Se l'utente è Master il file esportato viene anche salvato in "Insegna ad Axon"
 * (categoria "Dati esportati") per l'auto-apprendimento.
 */
import React, { useCallback, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, Modal, ScrollView, ActivityIndicator, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { captureRef } from "react-native-view-shot";
import { shareDataUri } from "@/src/share";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { useAuth } from "@/src/auth";

export type ParsedTable = {
  headers: string[];
  rows: string[][];
  raw: string; // Original markdown block (for saving)
};

/** Splits a chat message into segments: text vs table (markdown tables). */
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
  return s.split(/\|/).map((c) => c.trim());
}

function nowStamp(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/** V28.t — Genera un PDF reale via jsPDF + autoTable. Ritorna base64 (senza prefisso data:). */
function tableToPdfBase64(table: ParsedTable, title: string): string {
  const orientation = table.headers.length > 5 ? "landscape" : "portrait";
  const doc = new jsPDF({ orientation, unit: "pt", format: "a4" });
  // Header
  doc.setFontSize(14);
  doc.setTextColor(76, 29, 149); // #4C1D95 viola brand
  doc.text(title, 40, 40);
  doc.setFontSize(9);
  doc.setTextColor(148, 163, 184); // muted
  doc.text(`Esportato da Dal Pastro CRM · ${new Date().toLocaleString("it-IT")}`, 40, 56);
  // Table
  autoTable(doc, {
    startY: 72,
    head: [table.headers],
    body: table.rows,
    styles: { fontSize: 9, cellPadding: 5, overflow: "linebreak" },
    headStyles: { fillColor: [124, 58, 237], textColor: 255, fontStyle: "bold" }, // #7C3AED
    alternateRowStyles: { fillColor: [248, 250, 252] }, // #F8FAFC zebra
    margin: { left: 40, right: 40 },
  });
  // jsPDF `output('datauristring')` returns "data:application/pdf;filename=...;base64,<data>"
  const dataUri = doc.output("datauristring");
  const b64 = dataUri.split(",").pop() || "";
  return b64;
}

/** V28.t — Auto-save del file esportato in "Insegna ad Axon" (Master only). */
async function saveToAxonKnowledge(table: ParsedTable, filename: string, mime: string, data_base64: string): Promise<boolean> {
  try {
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
  } catch {
    return false;
  }
}

export function ChatTableExport({ table, assistantColor = "#8B5CF6" }: { table: ParsedTable; assistantColor?: string }) {
  const { user } = useAuth();
  const isMaster = !user?.parent_user_id && (user?.role || "member") === "owner";
  const [open, setOpen] = useState(false);
  const [busyFormat, setBusyFormat] = useState<"pdf" | "png" | null>(null);
  const captureRefEl = useRef<View>(null);

  const previewRows = useMemo(() => table.rows.slice(0, 30), [table.rows]);

  const doExport = useCallback(async (format: "pdf" | "png") => {
    try {
      setBusyFormat(format);
      const stamp = nowStamp();
      const baseName = `Tabella-Axon-${stamp}`;
      let filename = `${baseName}.${format}`;
      const mime = format === "pdf" ? "application/pdf" : "image/png";
      let data_base64 = "";

      if (format === "pdf") {
        data_base64 = tableToPdfBase64(table, `Tabella esportata (${table.rows.length} righe)`);
      } else {
        // PNG: cross-platform capture
        if (Platform.OS === "web") {
          // Web: draw the table on a hidden canvas
          data_base64 = await drawTableToPngWeb(table);
        } else {
          // Native: snapshot the visible preview view via view-shot
          if (!captureRefEl.current) throw new Error("Anteprima non disponibile per lo snapshot");
          const uri = await captureRef(captureRefEl.current, { format: "png", quality: 1, result: "base64" });
          data_base64 = uri;
        }
      }

      await shareDataUri(`data:${mime};base64,${data_base64}`, filename, mime);

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
      {/* Table preview (scrollable) — usato anche come capture-target su native */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tableScroll}>
        <View ref={captureRefEl} collapsable={false} style={[styles.table, { backgroundColor: "#FFF" }]}>
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

      <Pressable
        testID="table-export-btn"
        onPress={() => setOpen(true)}
        style={[styles.exportBtn, { borderColor: assistantColor }]}
      >
        <Ionicons name="download-outline" size={16} color={assistantColor} />
        <Text style={[styles.exportBtnTxt, { color: assistantColor }]}>Esporta tabella</Text>
      </Pressable>

      <Modal transparent visible={open} animationType="fade" onRequestClose={() => !busyFormat && setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => !busyFormat && setOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHdr}>
              <Text style={styles.sheetTitle}>Esporta tabella</Text>
              <Pressable onPress={() => !busyFormat && setOpen(false)} hitSlop={10}>
                <Ionicons name="close" size={22} color="#1B2B4B" />
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
async function drawTableToPngWeb(table: ParsedTable): Promise<string> {
  // Dimensionamento heuristico
  const cellPadding = 10;
  const headerH = 32;
  const rowH = 26;
  const fontHeader = 13;
  const fontCell = 12;
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
  const totalW = colWidths.reduce((a, b) => a + b, 0);
  const totalH = headerH + table.rows.length * rowH + 40;
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
    ctx.fillStyle = "#1B2B4B";
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
  ctx.fillStyle = "#94A3B8";
  ctx.font = `10px -apple-system, Segoe UI, Roboto, sans-serif`;
  ctx.fillText(`Dal Pastro CRM · ${new Date().toLocaleString("it-IT")}`, cellPadding, headerH + table.rows.length * rowH + 20);
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
  optCard: { flex: 1, alignItems: "center", justifyContent: "center", padding: 16, borderRadius: 12, borderWidth: 1.5, gap: 4, backgroundColor: "#FFF" },
  optLbl: { fontSize: 14, fontWeight: "800", textAlign: "center" },
  optSub: { fontSize: 10, color: "#94A3B8", fontWeight: "600", textAlign: "center" },
  hint: { fontSize: 11, color: "#64748B", fontStyle: "italic", textAlign: "center", marginTop: 2 },
});

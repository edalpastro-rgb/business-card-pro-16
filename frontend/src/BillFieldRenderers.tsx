// V38P — Shared bill-field renderers used by both the client-side BillsSection
// (contact detail → tab Fatture) and the Master's Analizza-bolletta screen.
// Recognises a few well-known extracted keys and renders them with a nicer
// visual instead of raw JSON:
//   - `consumi_mensili_kwh` / `consumi_mensili_smc` → bar chart (also detected
//     when nested inside `parametri_richiesti` or when values arrive as an
//     object `{gen:180, feb:200, ...}` instead of an array of `{mese,kwh}`)
//   - `parametri_richiesti` → label+value sub-rows (with automatic chart
//     rendering for any nested month-array or {gen,feb…} object)
//   - `note_ai` → bulleted list

import { View, Text, StyleSheet, ScrollView } from "react-native";
import { theme } from "@/src/theme";

const MONTHS_IT_SHORT = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
const MONTHS_IT_LONG = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];

export function humanizeKey(k: string): string {
  return k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * V2.1 — Strip HTML tags from AI-generated strings so React Native <Text>
 * doesn't display raw <br>/<p>/<li> etc. as literal text. Preserves logical
 * line breaks by converting <br> → newline and <p> → double newline.
 */
export function sanitizeAiText(s: unknown): string {
  return String(s ?? "")
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/p\s*>/gi, "\n\n")
    .replace(/<\s*p(?:\s[^>]*)?>/gi, "")
    .replace(/<\s*\/li\s*>/gi, "\n")
    .replace(/<\s*li(?:\s[^>]*)?>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function formatVal(v: any): string {
  if (v == null) return "—";
  if (typeof v === "object") {
    // V38X — Avoid raw JSON output.
    // Recognize fiscal-check-shaped entries {expected, actual, ok, delta_annual_eur}
    if (!Array.isArray(v) && "ok" in v && ("expected" in v || "actual" in v)) {
      const ok = !!v.ok;
      const exp = v.expected;
      const act = v.actual;
      const delta = v.delta_annual_eur;
      const fmt = (n: any) => {
        const num = Number(n);
        if (!Number.isFinite(num)) return String(n ?? "—");
        return num.toLocaleString("it-IT", { maximumFractionDigits: 6 });
      };
      if (ok) return `${fmt(exp)} OK`;
      const dTxt = Number.isFinite(Number(delta)) && Number(delta) !== 0
        ? ` · Extra 12 mesi: € ${fmt(delta)}`
        : "";
      return `errata — attesa ${fmt(exp)}, trovata ${fmt(act)}${dTxt}`;
    }
    // Array: join non-object primitives; ignore complex arrays
    if (Array.isArray(v)) {
      if (v.every((x) => x == null || typeof x !== "object")) return v.map((x) => String(x)).join(", ");
      return `${v.length} elementi`;
    }
    // Small object: flatten as "k: v, k2: v2" (no JSON braces)
    const entries = Object.entries(v);
    if (entries.length === 0) return "—";
    return entries
      .map(([k, val]) => `${humanizeKey(k)}: ${typeof val === "object" ? formatVal(val) : sanitizeAiText(val)}`)
      .join(" · ");
  }
  // V2.1 — strip AI-generated HTML tags from primitive strings
  return sanitizeAiText(v);
}

/**
 * Normalise a "monthly consumption" payload into an array of {mese, value}.
 * Accepts:
 *   - Array<{ mese: string; kwh?: number; smc?: number; value?: number }>
 *   - Array<number>  (12 numbers → assumed Jan..Dec)
 *   - Object<{ gen: number, feb: number, ... }>  (Italian month keys)
 *   - Object<{ january: number, ... }>  (English month keys)
 */
export function normalizeMonthlyConsumption(raw: any, valueKey: "kwh" | "smc"): { mese: string; value: number }[] {
  if (!raw) return [];
  // Array of objects
  if (Array.isArray(raw)) {
    return raw
      .map((it, idx) => {
        if (typeof it === "number") return { mese: MONTHS_IT_SHORT[idx] || "", value: it };
        if (it && typeof it === "object") {
          const mese = String(it.mese ?? it.month ?? "").slice(0, 3).toLowerCase();
          const v = Number(it[valueKey] ?? it.value ?? it.consumo ?? it.kwh ?? it.smc ?? 0);
          return { mese: mese || (MONTHS_IT_SHORT[idx] || ""), value: Number.isFinite(v) ? v : 0 };
        }
        return { mese: MONTHS_IT_SHORT[idx] || "", value: 0 };
      })
      .filter((it) => it.mese || it.value > 0);
  }
  // Object with month keys
  if (typeof raw === "object") {
    const entries = Object.entries(raw);
    // Try Italian short/long first, then english
    const out: { mese: string; value: number }[] = [];
    for (const [k, v] of entries) {
      const lk = k.toLowerCase().slice(0, 3);
      const idx = MONTHS_IT_SHORT.indexOf(lk);
      const longIdx = MONTHS_IT_LONG.findIndex((m) => k.toLowerCase().startsWith(m));
      const enShort = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(lk);
      const monthIdx = idx >= 0 ? idx : (longIdx >= 0 ? longIdx : enShort);
      if (monthIdx >= 0) {
        const num = Number(v);
        out[monthIdx] = { mese: MONTHS_IT_SHORT[monthIdx], value: Number.isFinite(num) ? num : 0 };
      }
    }
    // Compact & pad
    const filled = out.filter(Boolean);
    return filled.length > 0 ? filled : [];
  }
  return [];
}

// Detect a nested "monthly consumption" value inside a generic object (e.g.
// LLM put it inside `parametri_richiesti` because the user selected
// "Consumi mensili" as one of the custom parameters).
function detectNestedConsumption(v: any): null | { kind: "kwh" | "smc"; data: any } {
  if (!v) return null;
  if (Array.isArray(v) && v.length >= 3) {
    // Sample first element
    const first = v[0];
    if (typeof first === "object" && first && ("kwh" in first || "smc" in first || "mese" in first)) {
      return { kind: "smc" in first ? "smc" : "kwh", data: v };
    }
    if (v.every((n: any) => typeof n === "number") && v.length === 12) {
      return { kind: "kwh", data: v };
    }
  }
  if (typeof v === "object" && !Array.isArray(v)) {
    const keys = Object.keys(v).map((k) => k.toLowerCase().slice(0, 3));
    const hits = keys.filter((k) => MONTHS_IT_SHORT.includes(k));
    if (hits.length >= 3) return { kind: "kwh", data: v };
  }
  return null;
}

export function isSpecialBillField(name: string, value: any): boolean {
  if ((name === "consumi_mensili_kwh" || name === "consumi_mensili_smc") && value) return true;
  if (name === "parametri_richiesti" && value && typeof value === "object" && !Array.isArray(value)) return true;
  if (name === "note_ai") return true;
  return false;
}

export type FieldRowProps = { name: string; value: any; accent: string };

export function BillFieldRow({ name, value, accent }: FieldRowProps) {
  const label = humanizeKey(name);
  // V38Z — parse_error → clear red banner (skip when false to avoid noise)
  if (name === "parse_error") {
    if (!value) return null;
    return (
      <View style={styles.parseErrorBox}>
        <Text style={styles.parseErrorTitle}>⚠ Analisi non riuscita</Text>
        <Text style={styles.parseErrorMsg}>
          L&apos;analisi AI ha restituito una risposta non valida. Riprova più tardi
          o contatta il supporto se il problema persiste.
        </Text>
      </View>
    );
  }
  // V38Z — hide internal diagnostic key from the UI (never expose to user)
  if (name === "parse_error_kind") return null;
  // V38Z — dedicated error_message row (from _parse_llm_json)
  if (name === "error_message") {
    if (!value) return null;
    return (
      <View style={styles.parseErrorBox}>
        <Text style={styles.parseErrorMsg}>{String(value)}</Text>
      </View>
    );
  }
  // Consumi mensili — bar chart (top-level, accepts array OR object shape)
  if (name === "consumi_mensili_kwh" || name === "consumi_mensili_smc") {
    const key: "kwh" | "smc" = name === "consumi_mensili_kwh" ? "kwh" : "smc";
    const points = normalizeMonthlyConsumption(value, key);
    if (points.length === 0) return (
      <View style={styles.kvRow}>
        <Text style={styles.kvKey}>{label}</Text>
        <Text style={styles.kvVal}>—</Text>
      </View>
    );
    return (
      <View style={styles.blockRow}>
        <Text style={styles.blockLabel}>{label}</Text>
        <ConsumptionBarChart points={points} unit={key === "kwh" ? "kWh" : "Smc"} accent={accent} />
      </View>
    );
  }
  // Parametri richiesti — vertical sub-rows; nested consumption arrays rendered as chart
  if (name === "parametri_richiesti" && value && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, any>);
    if (entries.length === 0) return null;
    return (
      <View style={styles.blockRow}>
        <Text style={styles.blockLabel}>{label}</Text>
        <View style={styles.paramSubBox}>
          {entries.map(([k, v]) => {
            const nested = detectNestedConsumption(v);
            if (nested) {
              const points = normalizeMonthlyConsumption(v, nested.kind);
              if (points.length > 0) {
                return (
                  <View key={k} style={{ marginVertical: 6 }}>
                    <Text style={styles.paramSubKey}>{humanizeKey(k)}</Text>
                    <ConsumptionBarChart points={points} unit={nested.kind === "kwh" ? "kWh" : "Smc"} accent={accent} />
                  </View>
                );
              }
            }
            return (
              <View key={k} style={styles.paramSubRow}>
                <Text style={styles.paramSubKey} numberOfLines={2}>{humanizeKey(k)}</Text>
                <Text style={styles.paramSubVal} numberOfLines={3}>{formatVal(v)}</Text>
              </View>
            );
          })}
        </View>
      </View>
    );
  }
  // Consulenza Corporate — bulleted list (was "Note AI")
  if (name === "note_ai") {
    let items: string[] = [];
    if (Array.isArray(value)) items = value.map((x) => sanitizeAiText(x)).filter(Boolean);
    else if (typeof value === "string") {
      // V2.1 — sanitize first, then split on newlines
      const clean = sanitizeAiText(value);
      items = clean.split(/[\r\n]+/).map((s) => s.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);
    }
    if (items.length === 0) return null;
    return (
      <View style={styles.blockRow}>
        <Text style={styles.blockLabel}>Consulenza Corporate</Text>
        <View style={{ gap: 4, marginTop: 4 }}>
          {items.map((t, i) => (
            <View key={i} style={styles.bulletRow}>
              <View style={[styles.bulletDot, { backgroundColor: accent }]} />
              <Text style={styles.bulletTxt}>{t}</Text>
            </View>
          ))}
        </View>
      </View>
    );
  }
  // Arrays of strings — render as inline pipe list
  if (Array.isArray(value)) {
    const s = value.map((x) => (typeof x === "object" ? JSON.stringify(x) : sanitizeAiText(x))).filter(Boolean).join(", ");
    return (
      <View style={styles.kvRow}>
        <Text style={styles.kvKey}>{label}</Text>
        <Text style={styles.kvVal}>{s || "—"}</Text>
      </View>
    );
  }
  return (
    <View style={styles.kvRow}>
      <Text style={styles.kvKey}>{label}</Text>
      <Text style={styles.kvVal}>{formatVal(value)}</Text>
    </View>
  );
}

export function ConsumptionBarChart({ points, unit, accent }: { points: { mese: string; value: number }[]; unit: string; accent: string }) {
  if (points.length === 0) return <Text style={styles.kvVal}>—</Text>;
  const maxV = Math.max(...points.map((it) => it.value), 1);
  const CHART_H = 120;
  const totalV = points.reduce((s, it) => s + it.value, 0);
  return (
    <View style={styles.chartWrap}>
      <View style={styles.chartHeader}>
        <Text style={styles.chartTotal}>Totale: {Math.round(totalV).toLocaleString("it-IT")} {unit}</Text>
        <Text style={styles.chartMax}>Max: {Math.round(maxV).toLocaleString("it-IT")} {unit}</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 6 }}>
        {points.map((it, idx) => {
          const h = Math.max(2, Math.round((it.value / maxV) * CHART_H));
          const meseLabel = it.mese ? it.mese.replace(/^\w/, (c) => c.toUpperCase()) : MONTHS_IT_SHORT[idx].replace(/^\w/, (c) => c.toUpperCase());
          return (
            <View key={idx} style={styles.barCol}>
              <Text style={styles.barValue}>{Math.round(it.value)}</Text>
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { height: h, backgroundColor: accent }]} />
              </View>
              <Text style={styles.barLabel}>{meseLabel}</Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  kvRow: { flexDirection: "row", paddingVertical: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.color.border, alignItems: "flex-start" },
  kvKey: { flex: 1, fontSize: 12, fontWeight: "600", color: theme.color.muted, paddingRight: 6 },
  kvVal: { flex: 2, fontSize: 12, color: theme.color.onSurface, flexShrink: 1, flexWrap: "wrap" },
  blockRow: { paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.color.border, overflow: "hidden" },
  blockLabel: { fontSize: 12, fontWeight: "700", color: theme.color.muted, textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 4 },
  paramSubBox: { gap: 3, backgroundColor: "#F8FAFC", borderRadius: 8, padding: 8, borderWidth: 1, borderColor: theme.color.border, overflow: "hidden" },
  paramSubRow: { flexDirection: "row", paddingVertical: 3, alignItems: "flex-start" },
  paramSubKey: { flex: 1, fontSize: 11, fontWeight: "600", color: theme.color.muted, paddingRight: 6 },
  paramSubVal: { flex: 2, fontSize: 12, color: theme.color.onSurface, flexShrink: 1, flexWrap: "wrap" },
  bulletRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingRight: 4 },
  bulletDot: { width: 6, height: 6, borderRadius: 3, marginTop: 6 },
  bulletTxt: { flex: 1, fontSize: 12, lineHeight: 17, color: theme.color.onSurface, flexShrink: 1, flexWrap: "wrap" },
  chartWrap: { marginTop: 4, backgroundColor: "#F8FAFC", borderRadius: 8, padding: 8, borderWidth: 1, borderColor: theme.color.border },
  chartHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  chartTotal: { fontSize: 11, fontWeight: "700", color: theme.color.onSurface },
  chartMax: { fontSize: 10, color: theme.color.muted },
  barCol: { alignItems: "center", marginHorizontal: 3, width: 34 },
  barValue: { fontSize: 9, color: theme.color.muted, marginBottom: 2, minHeight: 12 },
  barTrack: { width: 26, height: 120, backgroundColor: "#E2E8F0", borderRadius: 4, justifyContent: "flex-end", overflow: "hidden" },
  barFill: { width: "100%", borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  barLabel: { fontSize: 10, color: theme.color.muted, marginTop: 3, fontWeight: "600" },
  // V38Z — clear red parse-error banner
  parseErrorBox: {
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FCA5A5",
    borderRadius: 8,
    padding: 12,
    marginVertical: 6,
  },
  parseErrorTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: "#991B1B",
    marginBottom: 4,
  },
  parseErrorMsg: {
    fontSize: 12,
    color: "#7F1D1D",
    lineHeight: 17,
  },
});

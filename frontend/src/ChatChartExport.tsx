/**
 * V50.z109 — ChatChartExport
 *
 * Renderizza grafici (line / bar / pie) generati da Axon nelle chat.
 * Il blocco atteso nel messaggio ha questo formato:
 *
 *   ```chart
 *   { "type": "bar" | "line" | "pie",
 *     "title": "…",
 *     "labels": ["Gen","Feb", …],
 *     "datasets": [{ "label": "Consumo kWh", "data": [120, 140, …] }],
 *     "unit": "€" | "kWh" | …
 *   }
 *   ```
 *
 * Per `pie`, la struttura è:
 *   { "type": "pie", "title": "…",
 *     "slices": [{ "name": "F1", "value": 120, "color": "#…" }, …] }
 *
 * Ogni grafico ha un pulsante ⛶ per espanderlo a tutto schermo IN-APP
 * (Modal transparent, non esce dall'app).
 */
import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, Modal, useWindowDimensions, ScrollView, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LineChart, BarChart, PieChart } from "react-native-chart-kit";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

export type ChartSpec =
  | {
      type: "line" | "bar";
      title?: string;
      labels: string[];
      datasets: Array<{ label?: string; data: number[]; color?: string }>;
      unit?: string;
    }
  | {
      type: "pie";
      title?: string;
      slices: Array<{ name: string; value: number; color?: string }>;
      unit?: string;
    };

const DEFAULT_PALETTE = [
  "#7C3AED", "#F97316", "#0EA5E9", "#22C55E", "#EAB308",
  "#EC4899", "#14B8A6", "#F43F5E", "#8B5CF6", "#06B6D4",
];

const BRAND = "#7C3AED";

/**
 * Prova a parsare un blocco fenced ```chart … ``` come JSON.
 * Ritorna null se non è un chart valido.
 */
export function tryParseChart(raw: string): ChartSpec | null {
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return null;
    if (obj.type === "pie" && Array.isArray(obj.slices) && obj.slices.length > 0) {
      return obj as ChartSpec;
    }
    if ((obj.type === "line" || obj.type === "bar") && Array.isArray(obj.labels) && Array.isArray(obj.datasets)) {
      // Sanity: almeno un dataset con dati numerici
      const ok = obj.datasets.some((d: any) => Array.isArray(d?.data) && d.data.length > 0);
      if (ok) return obj as ChartSpec;
    }
    return null;
  } catch {
    return null;
  }
}

function pieDataToKit(spec: Extract<ChartSpec, { type: "pie" }>) {
  return spec.slices.map((s, i) => ({
    name: s.name,
    population: Number(s.value) || 0,
    color: s.color || DEFAULT_PALETTE[i % DEFAULT_PALETTE.length],
    legendFontColor: HT.text2,
    legendFontSize: 11,
  }));
}

function xyDataToKit(spec: Extract<ChartSpec, { type: "line" | "bar" }>) {
  return {
    labels: spec.labels.map((l) => String(l).slice(0, 12)),
    datasets: spec.datasets.map((d, i) => ({
      data: (d.data || []).map((v) => (Number.isFinite(Number(v)) ? Number(v) : 0)),
      color: (opacity = 1) => d.color || `${DEFAULT_PALETTE[i % DEFAULT_PALETTE.length]}${Math.round(opacity * 255).toString(16).padStart(2, "0")}`,
      strokeWidth: 2,
    })),
    legend: spec.datasets.map((d, i) => d.label || `Serie ${i + 1}`),
  };
}

/** Decimali dell'asse Y in base all'ordine di grandezza (es. PUN 0,11 €/kWh → 3 decimali). */
function decimalsFor(spec: ChartSpec): number {
  const ds: Array<{ data: number[] }> = (spec as any).datasets || ((spec as any).data ? [{ data: ((spec as any).data as any[]).map((x: any) => Number(x?.value ?? x)) }] : []);
  const vals = ds.flatMap((d) => (d.data || []).map((v: number) => Math.abs(Number(v)))).filter((v: number) => Number.isFinite(v) && v > 0);
  const max = vals.length ? Math.max(...vals) : 0;
  if (max === 0) return 0;
  if (max < 1) return 3;
  if (max < 10) return 2;
  if (max < 100) return 1;
  return 0;
}

function chartConfig(bg = "#FFFFFF", decimalPlaces = 0) {
  return {
    backgroundColor: bg,
    backgroundGradientFrom: bg,
    backgroundGradientTo: bg,
    decimalPlaces,
    color: (opacity = 1) => `rgba(124, 58, 237, ${opacity})`,
    labelColor: (opacity = 1) => `rgba(30, 41, 59, ${opacity})`,
    style: { borderRadius: 12 },
    propsForBackgroundLines: { stroke: "#E5E7EB", strokeDasharray: "3,4" },
    propsForDots: { r: "4", strokeWidth: "2", stroke: "#FFF" },
    barPercentage: 0.6,
  };
}

type Props = {
  spec: ChartSpec;
  assistantColor?: string;
};

export function ChatChartExport({ spec, assistantColor = BRAND }: Props) {
  const { width: winW, height: winH } = useWindowDimensions();
  const [expanded, setExpanded] = useState(false);

  // Larghezza chart embedded (dentro il bubble Axon). Il bubble ha padding
  // ~14px per lato → lasciamo un piccolo margine di sicurezza (56px).
  const embedW = useMemo(() => Math.max(220, Math.min(winW - 56, 320)), [winW]);
  const embedH = 200;

  // Fullscreen: usa quasi tutta la finestra, lascia header e safe area.
  const fullW = useMemo(() => Math.max(280, winW - 32), [winW]);
  const fullH = useMemo(() => Math.max(320, winH - 220), [winW, winH]);

  const title = spec.title || (spec.type === "pie" ? "Distribuzione" : spec.type === "line" ? "Andamento" : "Confronto");

  const renderChart = (w: number, h: number) => {
    if (spec.type === "pie") {
      const data = pieDataToKit(spec);
      return (
        <PieChart
          data={data}
          width={w}
          height={h}
          chartConfig={chartConfig("#FFFFFF", decimalsFor(spec))}
          accessor="population"
          backgroundColor="transparent"
          paddingLeft="10"
          absolute
        />
      );
    }
    const data = xyDataToKit(spec);
    if (spec.type === "line") {
      return (
        <LineChart
          data={data}
          width={w}
          height={h}
          yAxisSuffix={spec.unit ? ` ${spec.unit}` : ""}
          chartConfig={chartConfig("#FFFFFF", decimalsFor(spec))}
          bezier
          style={{ borderRadius: 12 }}
          fromZero
          withInnerLines
        />
      );
    }
    return (
      <BarChart
        data={data}
        width={w}
        height={h}
        yAxisLabel=""
        yAxisSuffix={spec.unit ? ` ${spec.unit}` : ""}
        chartConfig={chartConfig("#FFFFFF", decimalsFor(spec))}
        style={{ borderRadius: 12 }}
        fromZero
        showValuesOnTopOfBars
      />
    );
  };

  return (
    <View style={styles.wrap} testID={`axon-chart-${spec.type}`}>
      <View style={styles.header}>
        <View style={[styles.badge, { backgroundColor: assistantColor + "18" }]}>
          <Ionicons name="stats-chart" size={12} color={assistantColor} />
          <Text style={[styles.badgeTxt, { color: assistantColor }]}>{spec.type.toUpperCase()}</Text>
        </View>
        <Text style={styles.title} numberOfLines={2}>{title}</Text>
        <Pressable
          onPress={() => setExpanded(true)}
          hitSlop={10}
          style={[styles.expandBtn, { borderColor: assistantColor }]}
          testID="axon-chart-expand"
          accessibilityLabel="Espandi grafico a tutto schermo"
        >
          <Ionicons name="expand" size={14} color={assistantColor} />
          <Text style={[styles.expandTxt, { color: assistantColor }]}>Espandi</Text>
        </Pressable>
      </View>
      <View style={styles.chartBox}>{renderChart(embedW, embedH)}</View>

      <Modal
        visible={expanded}
        animationType="fade"
        transparent
        onRequestClose={() => setExpanded(false)}
      >
        <View style={styles.fullBackdrop}>
          <View style={styles.fullHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.fullTitle} numberOfLines={2}>{title}</Text>
              <Text style={styles.fullSub}>Grafico Axon · pinch/scroll per esplorare</Text>
            </View>
            <Pressable
              onPress={() => setExpanded(false)}
              hitSlop={12}
              style={styles.fullCloseBtn}
              testID="axon-chart-fullscreen-close"
              accessibilityLabel="Chiudi vista a tutto schermo"
            >
              <Ionicons name="close" size={22} color="#FFF" />
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={styles.fullScroll}
            maximumZoomScale={Platform.OS === "ios" ? 3 : 1}
            minimumZoomScale={1}
            showsVerticalScrollIndicator={false}
          >
            <ScrollView horizontal contentContainerStyle={{ alignItems: "center" }} showsHorizontalScrollIndicator={false}>
              <View style={styles.fullChartBox}>
                {renderChart(fullW, fullH)}
              </View>
            </ScrollView>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 8,
    padding: 10,
    borderRadius: 12,
    backgroundColor: HT.card,
    borderWidth: 1,
    borderColor: HT.border,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeTxt: { fontSize: 10, fontWeight: "800", letterSpacing: 0.4 },
  title: { flex: 1, fontSize: 13, fontWeight: "800", color: HT.text },
  expandBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1.5,
    backgroundColor: HT.card,
  },
  expandTxt: { fontSize: 11, fontWeight: "800" },
  chartBox: { alignItems: "center", justifyContent: "center" },
  fullBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15,15,25,0.94)",
  },
  fullHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: Platform.OS === "ios" ? 54 : 26,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  fullTitle: { color: "#FFF", fontSize: 16, fontWeight: "800" },
  fullSub: { color: "rgba(255,255,255,0.6)", fontSize: 11, marginTop: 2 },
  fullCloseBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  fullScroll: {
    flexGrow: 1,
    padding: 16,
    justifyContent: "center",
  },
  fullChartBox: {
    padding: 12,
    borderRadius: 16,
    backgroundColor: HT.card,
    alignSelf: "center",
  },
});

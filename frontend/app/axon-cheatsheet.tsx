/**
 * V50.w — Cheat Sheet Fornitori/Prezzi Bollette
 *
 * Vista auto-costruita dei fornitori/tariffe che l'utente ha già analizzato.
 * Aggiornata automaticamente dopo ogni bolletta caricata.
 */
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Alert, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

type CheatRow = {
  supplier: string;
  bill_type: string;
  count: number;
  avg_price_kwh?: number | null;
  avg_price_smc?: number | null;
  avg_pcv?: number | null;
  avg_canone?: number | null;
  min_price_kwh?: number | null;
  max_price_kwh?: number | null;
};

const TYPE_META: Record<string, { emoji: string; color: string; unit: string; primary: keyof CheatRow }> = {
  luce: { emoji: "⚡", color: "#F59E0B", unit: "€/kWh", primary: "avg_price_kwh" },
  gas:  { emoji: "🔥", color: "#DC2626", unit: "€/Smc", primary: "avg_price_smc" },
  telco:{ emoji: "📱", color: "#2563EB", unit: "€/mese", primary: "avg_canone" },
};

export default function AxonCheatsheetScreen() {
  const router = useRouter();
  const bottomInset = usePageBottomPadding();

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<CheatRow[]>([]);

  const load = useCallback(async () => {
    try {
      const r = await api<any>("/axon/cheatsheet/bills");
      setRows(Array.isArray(r?.rows) ? r.rows : []);
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile caricare il cheat sheet");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const resetAll = () => {
    Alert.alert("Reset cheat sheet", "Cancellare tutti i dati appresi? (le bollette rimangono)", [
      { text: "Annulla", style: "cancel" },
      { text: "Reset", style: "destructive", onPress: async () => {
        try {
          await api("/axon/cheatsheet/bills", { method: "DELETE" });
          setRows([]);
          notify("Reset ok", "Cheat sheet svuotata");
        } catch (e: any) { notify("Errore", e?.message || String(e)); }
      }},
    ]);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <View style={styles.center}><ActivityIndicator color="#F59E0B" size="large" /></View>
      </SafeAreaView>
    );
  }

  // Raggruppa per bill_type
  const groups = rows.reduce<Record<string, CheatRow[]>>((acc, r) => {
    const k = r.bill_type || "altro";
    (acc[k] ||= []).push(r);
    return acc;
  }, {});

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.hBtn}>
          <Ionicons name="chevron-back" size={24} color="#FFF" />
        </Pressable>
        <Text style={styles.hTitle}>📊 Cheat Sheet Fornitori</Text>
        <Pressable onPress={resetAll} hitSlop={10} style={styles.hBtn}>
          <Ionicons name="refresh" size={20} color={HT.muted} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: bottomInset }}>
        <View style={styles.hint}>
          <Ionicons name="information-circle" size={18} color="#F59E0B" />
          <Text style={styles.hintTxt}>
            Costruito automaticamente dalle bollette che hai analizzato. Axon usa questi dati per confronti rapidi durante l&apos;analisi.
          </Text>
        </View>

        {rows.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="document-text-outline" size={40} color={HT.muted} />
            <Text style={styles.emptyTitle}>Nessun dato ancora</Text>
            <Text style={styles.emptyTxt}>Analizza qualche bolletta dai contatti e questa tabella si popolerà automaticamente.</Text>
          </View>
        ) : (
          Object.entries(groups).map(([bill_type, items]) => {
            const meta = TYPE_META[bill_type] || { emoji: "📄", color: HT.muted, unit: "€", primary: "avg_price_kwh" };
            return (
              <View key={bill_type} style={{ marginBottom: 20 }}>
                <View style={styles.groupHead}>
                  <Text style={[styles.groupTitle, { color: meta.color }]}>
                    {meta.emoji} {bill_type.toUpperCase()} ({items.length} fornitori)
                  </Text>
                </View>
                {items.sort((a, b) => (b.count || 0) - (a.count || 0)).map((r) => {
                  const primaryVal = r[meta.primary] as number | null | undefined;
                  return (
                    <View key={`${r.supplier}-${r.bill_type}`} style={[styles.row, { borderLeftColor: meta.color }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowSupplier}>{r.supplier}</Text>
                        <Text style={styles.rowCount}>{r.count} bolletta{r.count !== 1 ? "e" : ""} analizzat{r.count !== 1 ? "e" : "a"}</Text>
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        {primaryVal != null ? (
                          <Text style={styles.rowPrice}>{primaryVal.toFixed(4)} <Text style={styles.rowUnit}>{meta.unit}</Text></Text>
                        ) : (
                          <Text style={styles.rowNA}>n/d</Text>
                        )}
                        {r.min_price_kwh != null && r.max_price_kwh != null && bill_type === "luce" ? (
                          <Text style={styles.rowRange}>min {r.min_price_kwh.toFixed(4)} · max {r.max_price_kwh.toFixed(4)}</Text>
                        ) : null}
                        {r.avg_pcv != null ? <Text style={styles.rowExtra}>PCV medio: {r.avg_pcv.toFixed(2)} €</Text> : null}
                      </View>
                    </View>
                  );
                })}
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0F2438' },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 10, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.08)",
  },
  hBtn: { padding: 6, minWidth: 30 },
  hTitle: { color: "#FFF", fontSize: 16, fontWeight: "900" },
  hint: {
    flexDirection: "row", gap: 8, alignItems: "flex-start",
    backgroundColor: "rgba(245,158,11,0.12)", padding: 12, borderRadius: 10, marginBottom: 14,
    borderWidth: 1, borderColor: "rgba(245,158,11,0.3)",
  },
  hintTxt: { flex: 1, color: "rgba(255,255,255,0.85)", fontSize: 12, lineHeight: 17 },
  groupHead: { marginBottom: 6 },
  groupTitle: { fontSize: 12, fontWeight: "900", letterSpacing: 0.6, textTransform: "uppercase" },
  row: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: HT.card, padding: 12, borderRadius: 10, marginBottom: 6,
    borderLeftWidth: 4,
  },
  rowSupplier: { color: HT.text, fontWeight: "900", fontSize: 14, textTransform: "capitalize" },
  rowCount: { color: HT.muted, fontSize: 11, marginTop: 2 },
  rowPrice: { color: HT.text, fontWeight: "900", fontSize: 15 },
  rowUnit: { color: HT.muted, fontSize: 10, fontWeight: "600" },
  rowNA: { color: HT.muted, fontSize: 12, fontStyle: "italic" },
  rowRange: { color: HT.muted, fontSize: 10, marginTop: 2 },
  rowExtra: { color: "#0F9D58", fontSize: 10, marginTop: 2, fontWeight: "700" },
  emptyBox: { alignItems: "center", padding: 30, gap: 10 },
  emptyTitle: { color: "#FFF", fontSize: 16, fontWeight: "900" },
  emptyTxt: { color: "rgba(255,255,255,0.7)", fontSize: 12, textAlign: "center", lineHeight: 17 },
});

import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { theme } from "@/src/theme";
import { api } from "@/src/api";
import { DocumentScannerModal } from "@/src/DocumentScannerModal";
import { ModuleErrorBoundary } from "@/src/shared";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

/**
 * V50.z50 — Scanner standalone (Utility).
 * Apre il DocumentScannerModal (multi-pagina + auto-crop + PDF merge) e salva il
 * PDF risultante in "I miei file" → categoria "files". Funziona in modo
 * indipendente dall'upload bolletta.
 */
export default function ScannerRoute() {
  return (
    <ModuleErrorBoundary moduleName="scanner">
      <ScannerScreen />
    </ModuleErrorBoundary>
  );
}

function ScannerScreen() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const busy = false;
  const [lastSaved, setLastSaved] = useState<{ name: string; pages: number } | null>(null);
  useEffect(() => { api("/axon/nav/track", { method: "POST", body: { feature: "scanner" } }).catch(() => {}); }, []); // V50.z259 — uso funzione (suggerimenti proattivi Axon)

  // Autoapertura scanner al mount → l'utente arriva subito nel flusso di scan
  useEffect(() => {
    const t = setTimeout(() => setOpen(true), 200);
    return () => clearTimeout(t);
  }, []);

  const defaultName = React.useMemo(() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `Scansione-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  }, []);

  const handleSaved = async ({ name, page_count }: { pdf_base64: string; name: string; page_count: number; mime: string }) => {
    // V50.z226 — il salvataggio in «I miei file › Scanner» avviene dentro DocumentScannerModal (mai perso)
    const fname = name.endsWith(".pdf") ? name : `${name}.pdf`;
    setLastSaved({ name: fname, pages: page_count });
    setOpen(false);
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} testID="scanner-back">
          <Ionicons name="chevron-back" size={26} color={HT.text} />
        </Pressable>
        <Text style={styles.title}>Scanner documenti</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 140 }}>
        <View style={styles.heroCard}>
          <View style={styles.heroIcon}>
            <Ionicons name="scan" size={44} color="#FFF" />
          </View>
          <Text style={styles.heroTitle}>Scansiona qualsiasi documento</Text>
          <Text style={styles.heroSub}>
            Multi-pagina con auto-crop e miglioramento contrasto. Il PDF finale viene salvato in
            <Text style={{ fontWeight: "800" }}> "I miei file"</Text> nella cartella Scanner.
          </Text>
        </View>

        {lastSaved && (
          <View style={styles.savedCard} testID="scanner-last-saved">
            <View style={styles.savedIcon}>
              <Ionicons name="checkmark-circle" size={22} color="#16A34A" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.savedTitle}>Ultima scansione salvata</Text>
              <Text style={styles.savedSub} numberOfLines={1}>{lastSaved.name}</Text>
              <Text style={styles.savedMeta}>{lastSaved.pages} pagina/e · PDF</Text>
            </View>
            <Pressable
              onPress={() => router.push("/master-files?tab=scanner" as any)}
              hitSlop={8}
              testID="scanner-open-files"
              style={styles.savedGoBtn}
            >
              <Text style={styles.savedGoTxt}>Vedi</Text>
              <Ionicons name="chevron-forward" size={14} color="#FFF" />
            </Pressable>
          </View>
        )}

        <Pressable
          onPress={() => setOpen(true)}
          disabled={busy}
          style={[styles.primaryBtn, busy && { opacity: 0.6 }]}
          testID="scanner-start"
        >
          {busy ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <>
              <Ionicons name="scan-circle" size={22} color="#FFF" />
              <Text style={styles.primaryBtnTxt}>Avvia nuova scansione</Text>
            </>
          )}
        </Pressable>

        <Pressable
          onPress={() => router.push("/master-files?tab=scanner" as any)}
          style={styles.secondaryBtn}
          testID="scanner-open-master-files"
        >
          <Ionicons name="folder-open" size={20} color={HT.brand} />
          <Text style={styles.secondaryBtnTxt}>Apri "I miei file"</Text>
        </Pressable>

        <View style={styles.tipsCard}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <Ionicons name="bulb" size={16} color="#EAB308" />
            <Text style={styles.tipsTitle}>Suggerimenti</Text>
          </View>
          <Text style={styles.tipsRow}>• Poggia il foglio su una superficie a contrasto</Text>
          <Text style={styles.tipsRow}>• Luce diffusa, evita riflessi diretti</Text>
          <Text style={styles.tipsRow}>• L'auto-crop rileva i bordi del documento</Text>
          <Text style={styles.tipsRow}>• Puoi scansionare più pagine e unirle in un unico PDF</Text>
        </View>
      </ScrollView>

      <DocumentScannerModal
        visible={open}
        onClose={() => setOpen(false)}
        defaultName={defaultName}
        hintTitle="Scanner documenti"
        onSaved={handleSaved}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: HT.border,
    backgroundColor: HT.card,
  },
  title: { fontSize: 17, fontWeight: "800", color: HT.text },
  heroCard: {
    backgroundColor: HT.card,
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
    borderWidth: 1,
    borderColor: HT.border,
    gap: 10,
  },
  heroIcon: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#475569',
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  heroTitle: { fontSize: 17, fontWeight: "800", color: HT.text, textAlign: "center" },
  heroSub: { fontSize: 13, color: HT.muted, textAlign: "center", lineHeight: 18 },
  savedCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: HT.successTint,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: HT.success + '66',
  },
  savedIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: HT.successTint,
    alignItems: "center",
    justifyContent: "center",
  },
  savedTitle: { fontSize: 12, fontWeight: "800", color: HT.success },
  savedSub: { fontSize: 13, fontWeight: "700", color: HT.text, marginTop: 2 },
  savedMeta: { fontSize: 11, color: HT.muted, marginTop: 1 },
  savedGoBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#16A34A',
  },
  savedGoTxt: { color: "#FFF", fontWeight: "800", fontSize: 12 },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: '#475569',
    paddingVertical: 14,
    borderRadius: 12,
  },
  primaryBtnTxt: { color: "#FFF", fontWeight: "800", fontSize: 15 },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: HT.card,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: HT.border,
  },
  secondaryBtnTxt: { color: HT.brand, fontWeight: "700", fontSize: 14 },
  tipsCard: {
    backgroundColor: HT.warningTint,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: HT.warning + '66',
  },
  tipsTitle: { fontSize: 12, fontWeight: "800", color: "#FDBA74", letterSpacing: 0.3 },
  tipsRow: { fontSize: 12, color: "#FDBA74", lineHeight: 18 },
});

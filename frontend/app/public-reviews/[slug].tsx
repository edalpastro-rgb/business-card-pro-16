// V50.z101 — Pagina pubblica delle recensioni approvate del consulente.
// Aperta da chiunque via link permanente condivisibile.

import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import Constants from "expo-constants";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

const BACKEND = (
  process.env.EXPO_PUBLIC_BACKEND_URL ||
  (Constants?.expoConfig?.extra as any)?.EXPO_PUBLIC_BACKEND_URL ||
  ""
).replace(/\/$/, "");

type PublicReview = {
  rating: number;
  text: string;
  date: string | null;
  author: string;
};

type PublicPage = {
  master_name: string;
  reviews: PublicReview[];
  count: number;
  average_rating: number | null;
};

function fmt(iso: string | null): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" });
  } catch { return ""; }
}

export default function PublicReviewsPage() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const [data, setData] = useState<PublicPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");

  const load = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    setError("");
    try {
      const r = await fetch(`${BACKEND}/api/public/reviews/${slug}`);
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.detail || `HTTP ${r.status}`);
      }
      setData(await r.json());
    } catch (e: any) {
      setError(e?.message || "Impossibile caricare la pagina");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}><ActivityIndicator size="large" color="#8B5CF6" /></View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <Ionicons name="alert-circle" size={48} color="#DC2626" />
          <Text style={styles.errorTitle}>Pagina non trovata</Text>
          <Text style={styles.errorSub}>{error}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const avg = data?.average_rating || 0;
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <Text style={styles.masterName}>{data?.master_name || "Consulente"}</Text>
          <Text style={styles.heroSub}>Cosa dicono i clienti</Text>
          <View style={styles.avgBox}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              {[1, 2, 3, 4, 5].map((s) => (
                <Ionicons
                  key={s}
                  name={s <= Math.round(avg) ? "star" : "star-outline"}
                  size={22}
                  color="#F59E0B"
                />
              ))}
            </View>
            <Text style={styles.avgTxt}>
              {data?.average_rating ? data.average_rating.toFixed(1) : "—"} · {data?.count || 0} recensioni
            </Text>
          </View>
        </View>

        {(data?.reviews || []).length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="star-outline" size={40} color={HT.muted} />
            <Text style={styles.emptyTxt}>Nessuna recensione approvata al momento.</Text>
          </View>
        ) : (
          (data?.reviews || []).map((rv, idx) => (
            <View key={idx} style={styles.card}>
              <View style={styles.cardHead}>
                <View style={{ flexDirection: "row" }}>
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Ionicons
                      key={s}
                      name={s <= rv.rating ? "star" : "star-outline"}
                      size={16}
                      color="#F59E0B"
                    />
                  ))}
                </View>
                <Text style={styles.cardDate}>{fmt(rv.date)}</Text>
              </View>
              {rv.text ? <Text style={styles.reviewTxt}>“{rv.text}”</Text> : null}
              <Text style={styles.author}>— {rv.author}</Text>
            </View>
          ))
        )}

        <Text style={styles.footer}>
          🔒 Recensioni verificate. Nomi abbreviati per privacy.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: HT.card2 },
  scroll: { padding: 20, paddingBottom: 60 },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  hero: { alignItems: "center", paddingVertical: 24, marginBottom: 12 },
  masterName: { fontSize: 26, fontWeight: "800", color: HT.text, textAlign: "center" },
  heroSub: { fontSize: 14, color: HT.muted, marginTop: 4 },
  avgBox: { alignItems: "center", marginTop: 12, gap: 4 },
  avgTxt: { fontSize: 14, color: HT.text2, fontWeight: "700", marginTop: 4 },
  empty: { alignItems: "center", padding: 40 },
  emptyTxt: { color: HT.muted, marginTop: 12, fontSize: 14 },
  card: {
    backgroundColor: HT.card,
    borderRadius: 14,
    padding: 18,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: HT.border,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  cardHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  cardDate: { fontSize: 11, color: HT.muted },
  reviewTxt: { fontSize: 15, color: HT.text, fontStyle: "italic", lineHeight: 22, marginTop: 6 },
  author: { fontSize: 12, color: HT.muted, marginTop: 10, fontWeight: "600" },
  footer: { fontSize: 11, color: HT.muted, textAlign: "center", marginTop: 20 },
  errorTitle: { fontSize: 18, fontWeight: "800", color: HT.text, marginTop: 12, textAlign: "center" },
  errorSub: { fontSize: 13, color: HT.muted, marginTop: 6, textAlign: "center" },
});

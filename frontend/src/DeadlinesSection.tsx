import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

/**
 * V29 — Sezione "Scadenze contratti" per l'anagrafica contatto.
 * Deriva le scadenze dalle bollette caricate (LUCE/GAS/TELCO) sfruttando
 * `data_attivazione`, `data_scadenza` e `durata_contratto_mesi` estratti dall'AI.
 * Non duplica i dati in DB: se l'utente rianalizza la bolletta la scadenza
 * si aggiorna automaticamente.
 */

type Deadline = {
  bill_id: string;
  contact_id: string;
  bill_type: "luce" | "gas" | "telco";
  pdf_name?: string;
  fornitore?: string;
  nome_offerta?: string;
  activation_date?: string | null;
  expiry_date: string;
  days_left: number;
  status: "expired" | "critical" | "warning" | "ok" | "unknown";
  source: "data_scadenza" | "calcolata";
  duration_months?: number | null;
};

const C = {
  text: HT.text,
  muted: HT.muted,
  border: "#E5E7EB",
  bg: HT.card,
  primary: "#EA580C",
  primarySoft: "#FFF1E9",
  navy: HT.text,
  expired: "#DC2626",
  expiredSoft: "#FEE2E2",
  critical: "#F59E0B",
  criticalSoft: "#FEF3C7",
  warning: "#0891B2",
  warningSoft: "#CFFAFE",
  ok: "#16A34A",
  okSoft: "#DCFCE7",
};

const TYPE_META: Record<string, { label: string; icon: any; color: string }> = {
  luce: { label: "Luce", icon: "flash", color: "#F59E0B" },
  gas: { label: "Gas", icon: "flame", color: "#EA580C" },
  telco: { label: "Telco", icon: "wifi", color: "#0891B2" },
};

const STATUS_META: Record<string, { label: string; fg: string; bg: string }> = {
  expired: { label: "Scaduta", fg: C.expired, bg: C.expiredSoft },
  critical: { label: "Urgente", fg: C.critical, bg: C.criticalSoft },
  warning: { label: "In arrivo", fg: C.warning, bg: C.warningSoft },
  ok: { label: "OK", fg: C.ok, bg: C.okSoft },
  unknown: { label: "?", fg: C.muted, bg: HT.card2 },
};

function formatIsoDate(iso?: string | null): string {
  if (!iso) return "—";
  try {
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  } catch {
    return iso;
  }
}

function daysLabel(n: number): string {
  if (n < 0) return `${Math.abs(n)} gg fa`;
  if (n === 0) return "oggi";
  if (n === 1) return "domani";
  return `tra ${n} gg`;
}

export function DeadlinesSection({ contactId }: { contactId: string }) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Deadline[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const r = await api(`/contacts/${contactId}/deadlines`);
      setItems(r?.items || []);
    } catch (e: any) {
      setError(e?.message || "Errore nel caricamento delle scadenze");
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => {
    load();
  }, [load]);

  // La sezione compare SOLO se esistono scadenze rilevanti: scadute (ancora da
  // gestire) oppure in scadenza entro i prossimi 90 giorni. Durante il
  // caricamento, in caso di errore o senza scadenze non viene renderizzato nulla.
  const relevant = items.filter((d) => typeof d.days_left === "number" && d.days_left <= 90);
  if (loading || error || relevant.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Ionicons name="hourglass-outline" size={18} color={C.primary} />
        <Text style={styles.title}>Scadenze contratti</Text>
        <View style={{ flex: 1 }} />
        <Pressable onPress={load} style={styles.reloadBtn} hitSlop={8}>
          <Ionicons name="refresh" size={16} color={C.primary} />
        </Pressable>
      </View>

      {relevant.map((d) => {
          const tm = TYPE_META[d.bill_type] || TYPE_META.luce;
          const sm = STATUS_META[d.status] || STATUS_META.unknown;
          return (
            <View key={d.bill_id} style={styles.card}>
              <View style={[styles.typeBadge, { backgroundColor: tm.color + "1A" }]}>
                <Ionicons name={tm.icon} size={16} color={tm.color} />
                <Text style={[styles.typeBadgeTxt, { color: tm.color }]}>{tm.label}</Text>
              </View>
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={styles.offerName} numberOfLines={1}>
                  {d.nome_offerta || d.fornitore || d.pdf_name || "Contratto"}
                </Text>
                {d.fornitore && d.nome_offerta ? (
                  <Text style={styles.supplier} numberOfLines={1}>{d.fornitore}</Text>
                ) : null}
                <View style={styles.metaRow}>
                  <Text style={styles.metaLabel}>Attivazione:</Text>
                  <Text style={styles.metaVal}>{formatIsoDate(d.activation_date)}</Text>
                </View>
                <View style={styles.metaRow}>
                  <Text style={styles.metaLabel}>Scadenza:</Text>
                  <Text style={styles.metaVal}>{formatIsoDate(d.expiry_date)}</Text>
                  {d.source === "calcolata" ? (
                    <Text style={styles.calcHint}>· stimata</Text>
                  ) : null}
                </View>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <View style={[styles.statusPill, { backgroundColor: sm.bg }]}>
                  <Text style={[styles.statusPillTxt, { color: sm.fg }]}>{sm.label}</Text>
                </View>
                <Text style={[styles.daysTxt, { color: sm.fg }]}>{daysLabel(d.days_left)}</Text>
              </View>
            </View>
          );
        })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: C.bg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    marginTop: 14,
    marginBottom: 6,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  title: {
    fontSize: 15,
    fontWeight: "800",
    color: C.text,
    letterSpacing: -0.2,
  },
  reloadBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: C.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  error: { color: C.expired, fontSize: 13 },
  emptyBox: {
    flexDirection: "row",
    gap: 10,
    padding: 12,
    borderRadius: 10,
    backgroundColor: HT.card2,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "flex-start",
  },
  emptyTxt: { flex: 1, fontSize: 12.5, color: C.muted, lineHeight: 18 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 8,
    backgroundColor: HT.card2,
  },
  typeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
  },
  typeBadgeTxt: { fontSize: 11.5, fontWeight: "700" },
  offerName: { fontSize: 14, fontWeight: "700", color: C.text },
  supplier: { fontSize: 12, color: C.muted, marginTop: 2 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4, flexWrap: "wrap" },
  metaLabel: { fontSize: 11.5, color: C.muted },
  metaVal: { fontSize: 12, color: C.text, fontWeight: "600" },
  calcHint: { fontSize: 11, color: C.muted, fontStyle: "italic" },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  statusPillTxt: { fontSize: 11, fontWeight: "800", letterSpacing: 0.2 },
  daysTxt: { fontSize: 12, fontWeight: "700", marginTop: 4 },
});

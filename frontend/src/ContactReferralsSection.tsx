import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

type Ref = {
  contact_id: string;
  first_name?: string;
  last_name?: string;
  contact_code?: string;
  area?: string;
};

type Props = {
  contactId: string;
  contactName: string;
  /** trigger reload when this changes */
  refreshKey?: number;
};

/**
 * Contact referrals section:
 * - "Riferito da" (parent) — the contact that referred the current contact
 * - "Ha segnalato" (children) — contacts this contact has referred
 * Uses GET /api/contacts/{id}/referrals
 */
export function ContactReferralsSection({ contactId, contactName, refreshKey }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [parent, setParent] = useState<Ref | null>(null);
  const [children, setChildren] = useState<Ref[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api<{ referred_by: Ref | null; referrals: Ref[] }>(`/contacts/${contactId}/referrals`);
      setParent(r?.referred_by || null);
      setChildren(Array.isArray(r?.referrals) ? r.referrals : []);
    } catch {
      setParent(null);
      setChildren([]);
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  if (loading) {
    return (
      <View style={styles.card}>
        <ActivityIndicator color={HT.brand} />
      </View>
    );
  }

  // Hide section entirely when there's nothing to show
  if (!parent && children.length === 0) return null;

  const fullName = (r: Ref) => `${r.first_name || ""} ${r.last_name || ""}`.trim() || "(senza nome)";
  const areaColor = (a?: string) =>
    a === "energy" ? theme.color.energy : a === "network" ? theme.color.network : HT.muted;

  return (
    <View style={styles.card}>
      <View style={styles.headRow}>
        <Ionicons name="git-network" size={18} color={HT.brand} />
        <Text style={styles.title}>Anagrafiche collegate</Text>
      </View>

      {parent && (
        <View style={{ marginTop: 8 }}>
          <Text style={styles.label}>Riferito da</Text>
          <Pressable
            testID="referral-parent"
            onPress={() => router.push(`/contact/${parent.contact_id}`)}
            style={styles.rowCard}
          >
            <View style={[styles.avatar, { backgroundColor: areaColor(parent.area) }]}>
              <Ionicons name="person" size={16} color="#FFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{fullName(parent)}</Text>
              {parent.contact_code ? (
                <Text style={styles.sub}>{parent.contact_code}</Text>
              ) : null}
            </View>
            <Ionicons name="chevron-forward" size={18} color={HT.muted} />
          </Pressable>
        </View>
      )}

      {children.length > 0 && (
        <View style={{ marginTop: parent ? 14 : 8 }}>
          <View style={styles.subHead}>
            <Text style={styles.label}>Ha segnalato ({children.length})</Text>
            <Text style={styles.subHint}>{contactName} ha portato questi contatti</Text>
          </View>
          <View style={{ gap: 6 }}>
            {children.map((r) => (
              <Pressable
                key={r.contact_id}
                testID={`referral-child-${r.contact_id}`}
                onPress={() => router.push(`/contact/${r.contact_id}`)}
                style={styles.rowCard}
              >
                <View style={[styles.avatar, { backgroundColor: areaColor(r.area) }]}>
                  <Ionicons name="person" size={16} color="#FFF" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{fullName(r)}</Text>
                  {r.contact_code ? (
                    <Text style={styles.sub}>{r.contact_code}</Text>
                  ) : null}
                </View>
                <Ionicons name="chevron-forward" size={18} color={HT.muted} />
              </Pressable>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: HT.card2,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: HT.border,
  },
  headRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: {
    fontSize: 13,
    fontWeight: "700",
    color: HT.brand,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  label: {
    fontSize: 11,
    fontWeight: "700",
    color: HT.muted,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  subHead: {},
  subHint: { fontSize: 11, color: HT.muted, marginTop: -3, marginBottom: 6 },
  rowCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderRadius: 10,
    backgroundColor: HT.card2,
    borderWidth: 1,
    borderColor: HT.border,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: "center",
    alignItems: "center",
  },
  name: { fontSize: 14, fontWeight: "600", color: HT.text },
  sub: { fontSize: 11, color: HT.muted, marginTop: 1 },
});

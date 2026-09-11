import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { theme } from "@/src/theme";

/**
 * V27 — Invita hub screen.
 * Landing page that lets the Master pick between two distinct invite flows:
 *   1) Prospect — external person, NO role in the team hierarchy, gets a trial
 *      account with access only to their own personal area.
 *   2) Collaboratore — team member, choose role (basic/manager/master-figlio)
 *      and optionally assign under an existing team member (parent selection is
 *      handled inside the Collaboratore screen).
 */
export default function InvitaHubScreen() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} testID="invita-back">
          <Ionicons name="chevron-back" size={26} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.title}>Invita Prospect o Collaboratore</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 140 }}>
        <Text style={styles.intro}>
          Scegli chi vuoi invitare: un <Text style={{ fontWeight: "800" }}>Prospect</Text> esterno che avrà accesso solo alla sua area personale, oppure un <Text style={{ fontWeight: "800" }}>Collaboratore</Text> che entra nella tua squadra con un ruolo.
        </Text>

        <Pressable
          testID="hub-invite-prospect"
          onPress={() => router.push("/invita-pick?intent=prospect" as any)}
          style={[styles.card, { borderColor: "#0891B2" }]}
        >
          <View style={[styles.iconBadge, { backgroundColor: "#0891B2" }]}>
            <Ionicons name="person-outline" size={26} color="#FFF" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Invita Prospect</Text>
            <Text style={styles.cardSub}>Persona esterna al team.</Text>
            <View style={styles.bulletRow}>
              <Ionicons name="checkmark-circle" size={14} color="#0891B2" />
              <Text style={styles.bulletTxt}>Nessun ruolo nella gerarchia</Text>
            </View>
            <View style={styles.bulletRow}>
              <Ionicons name="checkmark-circle" size={14} color="#0891B2" />
              <Text style={styles.bulletTxt}>Accede solo alla sua area personale</Text>
            </View>
            <View style={styles.bulletRow}>
              <Ionicons name="checkmark-circle" size={14} color="#0891B2" />
              <Text style={styles.bulletTxt}>Trial personalizzabile (giorni + estensioni)</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={22} color={theme.color.muted} />
        </Pressable>

        <Pressable
          testID="hub-invite-collaborator"
          onPress={() => router.push("/invita-pick?intent=collaborator" as any)}
          style={[styles.card, { borderColor: "#7C3AED" }]}
        >
          <View style={[styles.iconBadge, { backgroundColor: "#7C3AED" }]}>
            <Ionicons name="people" size={26} color="#FFF" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Invita Collaboratore</Text>
            <Text style={styles.cardSub}>Entra nel tuo team con un ruolo.</Text>
            <View style={styles.bulletRow}>
              <Ionicons name="checkmark-circle" size={14} color="#7C3AED" />
              <Text style={styles.bulletTxt}>Scegli ruolo: Basic · Manager · Master figlio</Text>
            </View>
            <View style={styles.bulletRow}>
              <Ionicons name="checkmark-circle" size={14} color="#7C3AED" />
              <Text style={styles.bulletTxt}>Assegna direttamente a te o sotto un altro collaboratore</Text>
            </View>
            <View style={styles.bulletRow}>
              <Ionicons name="checkmark-circle" size={14} color="#7C3AED" />
              <Text style={styles.bulletTxt}>Link + QR code condivisibili</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={22} color={theme.color.muted} />
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontSize: 17, fontWeight: "800", color: theme.color.onSurface, flex: 1, textAlign: "center" },
  intro: { fontSize: 13, color: theme.color.onSurfaceTertiary, lineHeight: 19, marginBottom: 4 },
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    backgroundColor: "#FFF",
    borderRadius: 16,
    padding: 16,
    borderWidth: 2,
    ...({
      shadowColor: "#0F172A",
      shadowOpacity: 0.05,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 2,
    } as any),
  },
  iconBadge: { width: 52, height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  cardTitle: { fontSize: 17, fontWeight: "800", color: "#1B2B4B" },
  cardSub: { fontSize: 12, color: theme.color.muted, marginTop: 2, marginBottom: 8 },
  bulletRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  bulletTxt: { fontSize: 12, color: theme.color.onSurface, flex: 1 },
});

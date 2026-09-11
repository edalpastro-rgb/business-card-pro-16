// Corporate Gym — striscia avviso sottile (stile allerta) in Home.
// Visibile SOLO se l'utente ha sessioni OBBLIGATORIE non completate; sparisce da sola
// al completamento (ricarica su focus). La X la nasconde finché il numero di sessioni
// obbligatorie pendenti non cambia (o al prossimo avvio dell'app).
import React, { useCallback, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { cgymApi } from "@/src/corporate-gym/api";

const ORANGE = "#F97316";
let dismissedForCount: number | null = null; // memoria di sessione (non persistita)

export function CgymAlertStrip() {
  const router = useRouter();
  const [pending, setPending] = useState(0);
  const [overdue, setOverdue] = useState(0);
  const [hiddenFor, setHiddenFor] = useState<number | null>(dismissedForCount);

  const load = useCallback(async () => {
    try {
      const s = await cgymApi.summary();
      setPending(s.mandatory_pending || 0);
      setOverdue(s.overdue || 0);
    } catch {
      setPending(0);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (pending <= 0) return null;
  if (hiddenFor === pending) return null;

  return (
    <View style={styles.strip} testID="cgym-alert-strip">
      <Pressable style={styles.body} onPress={() => router.push("/corporate-gym" as any)} testID="cgym-alert-strip-open" hitSlop={4}>
        <Ionicons name="barbell" size={13} color="#FFF" />
        <Text style={styles.txt} numberOfLines={1}>
          Corporate Gym · {pending} {pending === 1 ? "obbligatoria da completare" : "obbligatorie da completare"}
          {overdue > 0 ? ` · ${overdue} in ritardo` : ""}
        </Text>
      </Pressable>
      <Pressable
        onPress={() => { dismissedForCount = pending; setHiddenFor(pending); }}
        hitSlop={10}
        style={styles.close}
        testID="cgym-alert-strip-close"
        accessibilityLabel="Chiudi avviso"
      >
        <Ionicons name="close" size={14} color="#FFF" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: ORANGE,
    borderRadius: 6,
    minHeight: 26,
    paddingLeft: 10,
    paddingRight: 4,
    marginBottom: 10,
  },
  body: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4 },
  txt: { color: "#FFF", fontSize: 12, fontWeight: "800", flex: 1 },
  close: { width: 26, height: 26, alignItems: "center", justifyContent: "center" },
});

export default CgymAlertStrip;

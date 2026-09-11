// Corporate Gym — "Il tuo feedback AxonOS": ogni collaboratore vede il proprio feedback personale nella Gym home.
import React, { useCallback, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";
import { cgymStatsApi, CgymAiReport, CgymAgentFeedback, CGYM_ORANGE } from "@/src/corporate-gym/api";

const FOCUS_LABEL: Record<string, string> = {
  ascolto: "Ascolto ed empatia", riformulazione: "Riformulazione", valore: "Valore e numeri", chiusura: "Chiusura e appuntamento", tono: "Tono e chiarezza",
};

export function CgymMyFeedbackCard({ userId, hasSessions }: { userId: string; hasSessions: boolean }) {
  const [fb, setFb] = useState<CgymAiReport<CgymAgentFeedback> | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  useFocusEffect(useCallback(() => {
    cgymStatsApi.agentFeedbackGet(userId).then((r) => setFb(r?.content ? r : null)).catch(() => {});
  }, [userId]));

  const generate = async (force: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await cgymStatsApi.agentFeedback(userId, force);
      setFb(r);
      setOpen(true);
    } catch (e: any) {
      notify("Feedback", e?.message || "Errore");
    } finally {
      setBusy(false);
    }
  };

  const c = fb?.content;
  const when = fb?.generated_at ? new Date(fb.generated_at).toLocaleDateString("it-IT", { day: "2-digit", month: "short" }) : "";

  return (
    <View style={styles.card} testID="cgym-my-feedback">
      <Pressable style={styles.head} onPress={() => setOpen((v) => !v)} testID="cgym-my-feedback-toggle">
        <View style={styles.iconWrap}><Ionicons name="sparkles" size={18} color={CGYM_ORANGE} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Il tuo feedback AxonOS</Text>
          <Text style={styles.sub} numberOfLines={open ? undefined : 1}>
            {c ? (c.suggested_focus ? `Focus: ${FOCUS_LABEL[c.suggested_focus] || c.suggested_focus} · ${when}` : when) : hasSessions ? "Scopri dove migliorare in base alle tue sessioni" : "Completa una sessione per ricevere il tuo feedback"}
          </Text>
        </View>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={theme.color.muted} />
      </Pressable>

      {open && (
        <View style={{ marginTop: 10, gap: 8 }}>
          {c ? (
            <>
              {!!c.character && (<View style={styles.charBox}><Ionicons name="person" size={14} color={theme.color.brandPrimary} /><Text style={styles.charTxt}>{c.character}</Text></View>)}
              <Block title="Dove migliorare" icon="arrow-up-circle" color={CGYM_ORANGE} items={c.where_to_improve} />
              <Block title="Azioni per questa settimana" icon="construct" color={theme.color.brandPrimary} items={c.corrective_actions} />
              <Block title="I tuoi punti di forza" icon="checkmark-circle" color={theme.color.success} items={c.strengths} />
              {!!c.encouragement && (<View style={styles.encBox}><Ionicons name="heart" size={14} color={theme.color.success} /><Text style={styles.encTxt}>{c.encouragement}</Text></View>)}
            </>
          ) : (
            <Text style={styles.empty}>{hasSessions ? "Nessun feedback ancora generato: chiedilo ad AxonOS." : "Completa almeno una sessione o un role-play per ottenere un feedback personale."}</Text>
          )}
          <Pressable onPress={() => generate(!!c)} disabled={busy || (!c && !hasSessions)} style={[styles.genBtn, (busy || (!c && !hasSessions)) && { opacity: 0.5 }]} testID="cgym-my-feedback-gen">
            {busy ? <ActivityIndicator color="#FFF" size="small" /> : (<><Ionicons name={c ? "refresh" : "flash"} size={14} color="#FFF" /><Text style={styles.genTxt}>{c ? "Aggiorna feedback" : "Genera il mio feedback"}</Text></>)}
          </Pressable>
        </View>
      )}
    </View>
  );
}

function Block({ title, icon, color, items }: { title: string; icon: any; color: string; items?: string[] }) {
  if (!items || !items.length) return null;
  return (
    <View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 3 }}>
        <Ionicons name={icon} size={14} color={color} />
        <Text style={[styles.blockHead, { color }]}>{title}</Text>
      </View>
      {items.map((t, i) => <Text key={i} style={styles.item}>• {t}</Text>)}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: theme.color.surfaceSecondary, borderRadius: 14, borderWidth: 1, borderColor: CGYM_ORANGE + "55", padding: 12, marginTop: 8 },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  iconWrap: { width: 36, height: 36, borderRadius: 10, backgroundColor: CGYM_ORANGE + "22", alignItems: "center", justifyContent: "center" },
  title: { fontSize: 15, fontWeight: "800", color: theme.color.onSurface },
  sub: { fontSize: 12, color: theme.color.muted, marginTop: 1 },
  charBox: { flexDirection: "row", gap: 8, backgroundColor: theme.color.brandTertiary, borderRadius: 10, padding: 10 },
  charTxt: { flex: 1, fontSize: 13, color: theme.color.brandPrimary, fontWeight: "600", lineHeight: 19, fontStyle: "italic" },
  blockHead: { fontSize: 12, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.3 },
  item: { fontSize: 13, color: theme.color.onSurface, lineHeight: 19 },
  encBox: { flexDirection: "row", gap: 8, backgroundColor: theme.color.success + "18", borderRadius: 10, padding: 10 },
  encTxt: { flex: 1, fontSize: 13, color: theme.color.onSurface, lineHeight: 19 },
  empty: { fontSize: 12, color: theme.color.muted, lineHeight: 17 },
  genBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: CGYM_ORANGE, borderRadius: 12, paddingVertical: 11, minHeight: 44 },
  genTxt: { color: "#FFF", fontWeight: "800", fontSize: 13 },
});

export default CgymMyFeedbackCard;

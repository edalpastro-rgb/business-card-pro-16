// CallsTodayBlock.tsx — V50.z506 — Blocco «CALL DI OGGI» per la Home: telefonate programmate del giorno (appuntamenti is_phone)
// + arretrate da fare, con spunta, chiama e sposta data; link al modulo completo /call.
import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { HT } from "@/src/homeTheme";
import { CallsToday, fetchCallsToday } from "@/src/calls/callsApi";
import { CallRow } from "@/src/calls/CallRow";

export function CallsTodayBlock({ titleStyle, pillStyle, pillTxtStyle, addBtnStyle, addBtnTxtStyle }: { titleStyle: any; pillStyle: any; pillTxtStyle: any; addBtnStyle: any; addBtnTxtStyle: any }) {
  const router = useRouter();
  const [data, setData] = useState<CallsToday | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try { setData(await fetchCallsToday()); } catch { /* offline */ }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const items = (data?.items || []).slice(0, 6);
  return (
    <View style={{ flex: 1 }} testID="home-calls-block">
      <View style={s.head}>
        <Text style={titleStyle}>CALL DI OGGI</Text>
        <View style={pillStyle}><Text style={pillTxtStyle}>{data?.todo ?? 0}</Text></View>
        <View style={{ flex: 1 }} />
        <Pressable testID="home-calls-open" onPress={() => router.push("/call" as any)} style={addBtnStyle} accessibilityLabel="Apri il modulo Call">
          <Ionicons name="call" size={14} color="#FFFFFF" />
          <Text style={addBtnTxtStyle}>Modulo Call</Text>
        </Pressable>
      </View>
      <View style={{ flex: 1 }}>
        {loading ? <ActivityIndicator color={HT.brand} /> : items.length === 0 ? (
          <View style={s.empty}>
            <Ionicons name="call-outline" size={28} color={HT.muted} />
            <Text style={s.emptyTxt}>Nessuna call programmata per oggi</Text>
          </View>
        ) : items.map((c) => <CallRow key={c.appointment_id} c={c} onChanged={load} compact />)}
        {(data?.items.length || 0) > 6 ? <Pressable onPress={() => router.push("/call" as any)} style={s.more}><Text style={s.moreTxt}>Vedi tutte le {data?.items.length} call →</Text></Pressable> : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  empty: { alignItems: "center", justifyContent: "center", flexGrow: 1, padding: 22, gap: 8, backgroundColor: HT.card, borderRadius: 14, borderWidth: 1, borderColor: HT.border, borderStyle: "dashed" },
  emptyTxt: { color: HT.muted, fontWeight: "600" },
  more: { alignItems: "center", paddingVertical: 10, minHeight: 44, justifyContent: "center" },
  moreTxt: { color: HT.brand, fontWeight: "800", fontSize: 13 },
});

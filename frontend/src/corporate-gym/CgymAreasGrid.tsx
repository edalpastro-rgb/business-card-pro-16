// CgymAreasGrid.tsx — V50.z365 — griglia AREE dinamiche del Corporate Gym (stesso modello visivo: card immagine/logo, nome,
// stato sessioni). V50.z408: nessuna matita sulle card — il Master usa «Modifica aree» (/corporate-gym/areas-edit). Tap → pagina area.
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Image } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { cgaApi, CgaArea, RATING_COLOR } from "@/src/corporate-gym/areasApi";
import { HT } from "@/src/homeTheme";

export function CgymAreaLogo({ a, size = 84 }: { a: CgaArea; size?: number }) {
  const src = a.logo_b64 ? (a.logo_b64.startsWith("data:") ? a.logo_b64 : `data:image/png;base64,${a.logo_b64}`) : a.image;
  if (src) return <Image source={{ uri: src }} style={{ width: size, height: size, borderRadius: 18 }} resizeMode="cover" />;
  return (
    <View style={{ width: size, height: size, borderRadius: 18, backgroundColor: a.color + "22", alignItems: "center", justifyContent: "center" }}>
      <Ionicons name={(a.icon as any) || "barbell"} size={size * 0.42} color={a.color} />{/* V50.z408 — icona scelta dalla libreria */}
    </View>
  );
}

export function CgymAreasGrid({ pendingByKey }: { pendingByKey?: Record<string, number> }) {
  const router = useRouter();
  const [areas, setAreas] = useState<CgaArea[]>([]);
  const [master, setMaster] = useState(false);

  const load = useCallback(async () => {
    try { const r = await cgaApi.areas(); setAreas(r.items); setMaster(r.is_master); } catch { /* offline */ }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const open = (a: CgaArea) => router.push(`/corporate-gym/area/${a.area_id}` as any); // V50.z400 — STRUTTURA UNICA: anche Obiezioni e WIN-WIN aprono la pagina area (come ANT)

  return (
    <View>
      {/* V50.z408 — niente più matite sulle card: un solo pulsante «Modifica aree» (Master) → schermata di gestione */}
      {master ? (
        <Pressable onPress={() => router.push("/corporate-gym/areas-edit" as any)} style={styles.editAllBtn} testID="cgym-areas-edit">
          <Ionicons name="options-outline" size={18} color={HT.violet} />
          <Text style={styles.editAllTxt}>Modifica aree</Text>
          <Ionicons name="chevron-forward" size={16} color={HT.violet} />
        </Pressable>
      ) : null}
      <View style={styles.grid}>
        {areas.map((a) => {
          const n = pendingByKey?.[a.key] ?? 0;
          return (
            <Pressable key={a.area_id} style={styles.tile} onPress={() => open(a)} testID={`cgym-area-${a.key}`}>
              <CgymAreaLogo a={a} />
              <Text style={styles.tileTitle} numberOfLines={2}>{a.name}</Text>
              <Text style={styles.tileSub}>{n > 0 ? `${n} da fare` : a.my_last_rating ? `Ultima: ${a.my_last_rating}` : a.my_sessions > 0 ? `${a.my_sessions} sessioni` : "Nessuna in sospeso"}</Text>
              {a.my_last_rating ? <View style={[styles.dot, { backgroundColor: RATING_COLOR[a.my_last_rating] || HT.muted }]} /> : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  editAllBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, alignSelf: "flex-end", minHeight: 40, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: HT.violet + "66", backgroundColor: HT.violetTint, marginBottom: 10 },
  editAllTxt: { color: HT.violet, fontWeight: "800", fontSize: 13 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12, paddingHorizontal: 16, marginTop: 14 },
  tile: { width: "47%", flexGrow: 1, backgroundColor: HT.card, borderRadius: 18, borderWidth: 1, borderColor: HT.border, padding: 14, alignItems: "center", gap: 8, position: "relative" },
  tileAdd: { borderStyle: "dashed", borderColor: HT.violet + "66", backgroundColor: HT.violetTint },
  tileTitle: { fontSize: 15, fontWeight: "900", color: HT.text, textAlign: "center" },
  tileSub: { fontSize: 12, color: HT.muted, textAlign: "center" },
  dot: { position: "absolute", top: 10, left: 10, width: 10, height: 10, borderRadius: 5 },
  pencil: { position: "absolute", top: 8, right: 8, width: 26, height: 26, borderRadius: 13, backgroundColor: HT.violet, alignItems: "center", justifyContent: "center" },
  addIcon: { width: 84, height: 84, borderRadius: 18, backgroundColor: HT.violetTint, alignItems: "center", justifyContent: "center" },
  back: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: { backgroundColor: HT.card, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18, paddingBottom: 30, gap: 12 },
  sheetTitle: { fontSize: 17, fontWeight: "900", color: HT.text },
  camBadge: { position: "absolute", right: -4, bottom: -4, width: 22, height: 22, borderRadius: 11, backgroundColor: HT.violet, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 12, fontWeight: "800", color: HT.muted, textTransform: "uppercase" },
  input: { borderWidth: 1, borderColor: HT.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: HT.text, backgroundColor: HT.card2 },
  btn: { minHeight: 46, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 18, backgroundColor: HT.violet },
  btnTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
});

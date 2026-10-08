// PermissionsBanner.tsx — V50.z484 — Banner PERSISTENTE in Home: elenca i permessi di sistema mancanti (GPS, microfono,
// fotocamera, contatti) e con un tap apre le Impostazioni del sistema. Non si può chiudere: sparisce solo quando i permessi
// sono concessi (refresh automatico al rientro dalle Impostazioni). Solo app nativa (su web non si mostra).
import React from "react";
import { View, Text, StyleSheet, Pressable, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { HT } from "@/src/homeTheme";
import { PERM_META, openSystemSettings, settingsPath, useDevicePermissions } from "@/src/permissions/devicePermissions";

export function PermissionsBanner() {
  const { missing } = useDevicePermissions();
  if (Platform.OS === "web" || !missing.length) return null;
  const first = missing[0];
  return (
    <Pressable onPress={openSystemSettings} style={s.box} testID="permissions-banner" accessibilityRole="button" accessibilityLabel="Permessi mancanti: apri impostazioni">
      <View style={s.iconWrap}><Ionicons name="shield-half" size={20} color="#FFF" /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.title}>{missing.length === 1 ? "1 permesso di sistema mancante" : `${missing.length} permessi di sistema mancanti`}</Text>
        <View style={s.chips}>
          {missing.map((p) => (
            <View key={p.key} style={s.chip} testID={`permissions-banner-${p.key}`}>
              <Ionicons name={PERM_META[p.key].icon as any} size={12} color="#B45309" />
              <Text style={s.chipTxt}>{p.label}{p.status === "blocked" ? " · bloccato" : p.status === "undetermined" ? " · da concedere" : " · negato"}</Text>
            </View>
          ))}
        </View>
        <Text style={s.hint} numberOfLines={2}>Tocca per aprire le Impostazioni · {settingsPath(first.key)}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color="#B45309" />
    </Pressable>
  );
}

const s = StyleSheet.create({
  box: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12, padding: 12, borderRadius: 14, backgroundColor: "#FFF7ED", borderWidth: 1, borderColor: "#FDBA74" },
  iconWrap: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#F59E0B", alignItems: "center", justifyContent: "center" },
  title: { fontSize: 14, fontWeight: "800", color: "#9A3412" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: "#FFEDD5", borderWidth: 1, borderColor: "#FDBA74" },
  chipTxt: { fontSize: 11.5, fontWeight: "700", color: "#B45309" },
  hint: { fontSize: 11.5, color: HT.muted, marginTop: 6 },
});

// V50.z187 — Edge Panel (menu slide laterale): stessa organizzazione per AREA e COLORE del menu Master.
// Modulo isolato: mappa ogni azione del pannello alla categoria (palette `MENU_CATEGORIES`, la stessa
// del Master / drawer) e restituisce i gruppi ordinati con header identici a quelli del Master.
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MENU_CATEGORIES, ROUTE_CATEGORY, type MenuCategory, type MenuCategoryKey } from "@/src/menuCategories";

// Override per id (Master: Sveglia/Scanner/Meteo/Calcolatrice = "Utility" grigio #475569)
const ID_CATEGORY: Record<string, MenuCategoryKey> = {
  home: "crm", agenda: "crm", contatti: "crm", "new-contact": "crm", "new-appt": "crm", "new-crt": "crm", cruscotto: "crm", quick: "crm",
  chat: "comm", "call-script": "comm", banners: "comm",
  "my-web": "axon", "bill-quick": "axon", "ai-teach": "axon", "axon-brain": "axon", "axon-scripts": "axon", ha: "axon",
  "my-audios": "docs", "my-files": "docs", "business-card": "docs",
  report: "team",
  master: "team", profilo: "admin", "axon-alarms": "admin", libretto: "admin", meteo: "admin",
};
const LABEL_OVERRIDE: Partial<Record<MenuCategoryKey, string>> = { admin: "Utility" }; // come nel menu Master

export type EdgeLike = { id: string; href: string };

export function edgeCategory(a: EdgeLike): MenuCategory {
  const k = ID_CATEGORY[a.id] || ROUTE_CATEGORY[a.href.replace("/(tabs)", "")] || ROUTE_CATEGORY[a.href] || "admin";
  const cat = MENU_CATEGORIES[k];
  return LABEL_OVERRIDE[k] ? { ...cat, label: LABEL_OVERRIDE[k] as string } : cat;
}

/** Colore del bottone = colore dell'area (identico al Master). */
export function edgeColor(a: EdgeLike): string {
  return edgeCategory(a).color;
}

/** Raggruppa nell'ordine delle aree del Master (CRM Core → AI & Axon → Comunicazioni → DB Master → Team → Utility). */
export function groupEdgeActions<T extends EdgeLike>(items: T[]): { cat: MenuCategory; items: T[] }[] {
  return Object.values(MENU_CATEGORIES)
    .sort((a, b) => a.order - b.order)
    .map((c) => ({ cat: LABEL_OVERRIDE[c.key] ? { ...c, label: LABEL_OVERRIDE[c.key] as string } : c, items: items.filter((i) => edgeCategory(i).key === c.key) }))
    .filter((g) => g.items.length > 0);
}

/** Header di area — stesso schema visivo del Master (badge icona + etichetta maiuscola + linea). */
export function EdgeCategoryHeader({ cat, dark }: { cat: MenuCategory; dark?: boolean }) {
  return (
    <View style={styles.catHeader} testID={`edge-cat-${cat.key}`}>
      <View style={[styles.catBadge, { backgroundColor: cat.color + (dark ? "33" : "22") }]}>
        <Ionicons name={cat.icon as any} size={12} color={cat.color} />
      </View>
      <Text style={[styles.catLabel, { color: cat.color }]}>{cat.label}</Text>
      <View style={[styles.catLine, { backgroundColor: cat.color + "55" }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  catHeader: { width: "100%", flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, marginBottom: 4, paddingHorizontal: 4 },
  catBadge: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  catLabel: { fontSize: 11, fontWeight: "900", letterSpacing: 0.6, textTransform: "uppercase" },
  catLine: { flex: 1, height: 2, borderRadius: 1, marginLeft: 4 },
});

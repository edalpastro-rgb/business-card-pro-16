import { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, TextInput, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { theme } from "@/src/theme";
import { ModuleErrorBoundary } from "@/src/shared";

type Contact = {
  contact_id: string; first_name: string; last_name: string; phone: string; email: string;
  area: "energy" | "network"; source: "personal" | "referral"; address: string;
  group_ids?: string[];
};
type Settings = { energy_title: string; energy_color: string; network_title: string; network_color: string };
type Group = { group_id: string; name: string; color: string; member_count: number };

const AREAS_ALL: { key: "all" | "energy" | "network"; label: string }[] = [
  { key: "all", label: "Tutti" },
  { key: "energy", label: "Energia" },
  { key: "network", label: "Network" },
];

export default function ContattiRoute() {
  return (
    <ModuleErrorBoundary moduleName="contacts">
      <ContattiScreen />
    </ModuleErrorBoundary>
  );
}

function ContattiScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const allowed = user?.areas || ["energy", "network"];
  const AREAS = AREAS_ALL.filter((a) => a.key === "all" || allowed.includes(a.key));
  const [items, setItems] = useState<Contact[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [q, setQ] = useState("");
  const [area, setArea] = useState<"all" | "energy" | "network">("all");
  const [groupId, setGroupId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api<{ items: Contact[] }>("/contacts", {
        query: { q: q || undefined, area: area !== "all" ? area : undefined, group_id: groupId || undefined },
      });
      setItems(r.items);
      if (!settings) setSettings(await api<Settings>("/settings"));
      const gr = await api<{ items: Group[] }>("/groups");
      setGroups(gr.items || []);
    } finally { setLoading(false); }
  }, [q, area, groupId, settings]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const colorFor = (a: string) => (a === "energy" ? (settings?.energy_color || theme.color.energy) : (settings?.network_color || theme.color.network));

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Contatti</Text>
        <Pressable testID="contacts-add-btn" onPress={() => router.push("/contact/new")} style={styles.headerBtn}>
          <Ionicons name="add" size={22} color="#FFF" />
        </Pressable>
      </View>

      <View style={styles.search}>
        <Ionicons name="search" size={18} color={theme.color.muted} />
        <TextInput
          testID="contacts-search"
          placeholder="Cerca per nome, telefono, email"
          placeholderTextColor="#94A3B8"
          value={q}
          onChangeText={setQ}
          style={styles.searchInput}
          returnKeyType="search"
          onSubmitEditing={load}
        />
      </View>

      <View style={styles.chipsRow}>
        {AREAS.map((a) => (
          <Pressable
            key={a.key}
            testID={`filter-${a.key}`}
            onPress={() => setArea(a.key)}
            style={[styles.chip, area === a.key && styles.chipActive]}
          >
            <Text style={[styles.chipTxt, area === a.key && styles.chipTxtActive]}>{a.label}</Text>
          </Pressable>
        ))}
      </View>

      {groups.length > 0 && (
        <View style={{ maxHeight: 44 }}>
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={[{ group_id: "__all__", name: "Tutti gruppi", color: theme.color.brandPrimary, member_count: 0 } as Group, ...groups]}
            keyExtractor={(g) => g.group_id}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 8 }}
            renderItem={({ item }) => {
              const isAll = item.group_id === "__all__";
              const on = isAll ? groupId === null : groupId === item.group_id;
              return (
                <Pressable
                  testID={`group-filter-${item.group_id}`}
                  onPress={() => setGroupId(isAll ? null : item.group_id)}
                  onLongPress={() => !isAll && router.push(`/groups/${item.group_id}`)}
                  style={[styles.groupChip, on && { backgroundColor: item.color, borderColor: item.color }]}
                >
                  {!isAll && <View style={[styles.groupDot, { backgroundColor: on ? "#FFF" : item.color }]} />}
                  <Text style={[styles.groupChipTxt, on && { color: "#FFF" }]}>{item.name}{!isAll && ` (${item.member_count})`}</Text>
                </Pressable>
              );
            }}
          />
        </View>
      )}

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={theme.color.brandPrimary} />
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="people-outline" size={40} color={theme.color.muted} />
          <Text style={styles.emptyTxt}>Nessun contatto trovato</Text>
          <Pressable testID="empty-add-contact" style={styles.emptyBtn} onPress={() => router.push("/contact/new")}>
            <Text style={styles.emptyBtnTxt}>Aggiungi contatto</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.contact_id}
          contentContainerStyle={{ padding: 16, paddingTop: 4, paddingBottom: 180 }}
          renderItem={({ item }) => (
            <Pressable
              testID={`contact-${item.contact_id}`}
              onPress={() => router.push(`/contact/${item.contact_id}`)}
              style={styles.card}
            >
              <View style={[styles.avatar, { backgroundColor: colorFor(item.area) + "22" }]}>
                <Text style={[styles.avatarTxt, { color: colorFor(item.area) }]}>
                  {(item.first_name?.[0] || "").toUpperCase()}{(item.last_name?.[0] || "").toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.first_name} {item.last_name}</Text>
                <Text style={styles.sub}>{item.phone || item.email || "—"}</Text>
                <View style={styles.tags}>
                  <View style={[styles.tag, { borderColor: colorFor(item.area) }]}>
                    <View style={[styles.tagDot, { backgroundColor: colorFor(item.area) }]} />
                    <Text style={[styles.tagTxt, { color: colorFor(item.area) }]}>{item.area === "energy" ? (settings?.energy_title || "Energia") : (settings?.network_title || "Network")}</Text>
                  </View>
                  <View style={[styles.tag, { borderColor: theme.color.border }]}>
                    <Text style={styles.tagTxtNeutral}>{item.source === "referral" ? "Referenza" : "Conoscenza"}</Text>
                  </View>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={20} color={theme.color.muted} />
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 12 },
  title: { fontSize: 24, fontWeight: "700", color: theme.color.onSurface },
  headerBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.color.brandPrimary, alignItems: "center", justifyContent: "center" },
  search: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#FFF", marginHorizontal: 16, paddingHorizontal: 12, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border },
  searchInput: { flex: 1, paddingVertical: 10, color: theme.color.onSurface },
  chipsRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: theme.radius.pill, backgroundColor: "#FFF", borderWidth: 1, borderColor: theme.color.border, flexShrink: 0 },
  chipActive: { backgroundColor: theme.color.brandPrimary, borderColor: theme.color.brandPrimary },
  chipTxt: { color: theme.color.onSurfaceTertiary, fontWeight: "600", fontSize: 13 },
  chipTxtActive: { color: "#FFF" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40, gap: 12 },
  emptyTxt: { color: theme.color.muted, fontSize: 15 },
  emptyBtn: { backgroundColor: theme.color.brandPrimary, paddingHorizontal: 20, paddingVertical: 12, borderRadius: theme.radius.md, marginTop: 8 },
  emptyBtnTxt: { color: "#FFF", fontWeight: "700" },
  card: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#FFF", padding: 12, borderRadius: theme.radius.md, marginBottom: 8, borderWidth: 1, borderColor: theme.color.border },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  avatarTxt: { fontWeight: "700", fontSize: 15 },
  name: { fontSize: 16, fontWeight: "700", color: theme.color.onSurface },
  sub: { fontSize: 13, color: theme.color.muted, marginTop: 2 },
  tags: { flexDirection: "row", gap: 6, marginTop: 6 },
  tag: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: theme.radius.pill, borderWidth: 1 },
  tagDot: { width: 6, height: 6, borderRadius: 3 },
  tagTxt: { fontSize: 11, fontWeight: "700" },
  tagTxtNeutral: { fontSize: 11, fontWeight: "600", color: theme.color.muted },
  groupChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: theme.radius.pill, backgroundColor: "#FFF", borderWidth: 1, borderColor: theme.color.border },
  groupChipTxt: { color: theme.color.onSurfaceTertiary, fontWeight: "600", fontSize: 12 },
  groupDot: { width: 8, height: 8, borderRadius: 4 },
});

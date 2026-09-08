import { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, TextInput, ActivityIndicator, Modal } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { theme } from "@/src/theme";
import { ModuleErrorBoundary } from "@/src/shared";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";

type Contact = {
  contact_id: string; first_name: string; last_name: string; phone: string; email: string;
  area: "energy" | "network"; source: "personal" | "referral"; address: string;
  group_ids?: string[];
};
type Settings = { energy_title: string; energy_color: string; network_title: string; network_color: string; office_address?: string };
type Group = { group_id: string; name: string; color: string; member_count: number };
type SortMode = "default" | "distance";

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
  const pagePad = usePageBottomPadding();
  const allowed = user?.areas || ["energy", "network"];
  const AREAS = AREAS_ALL.filter((a) => a.key === "all" || allowed.includes(a.key));
  const [items, setItems] = useState<Contact[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [q, setQ] = useState("");
  const [area, setArea] = useState<"all" | "energy" | "network">("all");
  const [groupId, setGroupId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // V50.z72 — Distanze in batch + ordinamento per vicinanza
  const [sortMode, setSortMode] = useState<SortMode>("default");
  const [distanceOrigin, setDistanceOrigin] = useState<string>("");
  const [distances, setDistances] = useState<Record<string, number | null>>({});
  const [distLoading, setDistLoading] = useState(false);
  const [originModalOpen, setOriginModalOpen] = useState(false);
  const [originDraft, setOriginDraft] = useState("");

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

  // V50.z72 — Popola distanceOrigin di default dall'indirizzo ufficio
  useEffect(() => {
    if (!distanceOrigin && settings?.office_address) {
      setDistanceOrigin(settings.office_address);
    }
  }, [settings?.office_address, distanceOrigin]);

  // V50.z72 — Fetch batch delle distanze quando origine + lista sono pronti
  useEffect(() => {
    if (!distanceOrigin || items.length === 0) {
      setDistances({});
      return;
    }
    let cancelled = false;
    (async () => {
      setDistLoading(true);
      try {
        const res = await api<{ origin_valid: boolean; distances: Record<string, number | null> }>("/contacts/distances-batch", {
          method: "POST",
          body: { origin: distanceOrigin, contact_ids: items.map((i) => i.contact_id) },
        });
        if (!cancelled) setDistances(res?.distances || {});
      } catch {
        if (!cancelled) setDistances({});
      } finally {
        if (!cancelled) setDistLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [distanceOrigin, items]);

  // V50.z72 — Applica ordinamento per vicinanza (contatti con distance null vanno in fondo)
  const orderedItems = useMemo(() => {
    if (sortMode !== "distance") return items;
    const withKm = [...items];
    withKm.sort((a, b) => {
      const ka = distances[a.contact_id];
      const kb = distances[b.contact_id];
      if (ka == null && kb == null) return 0;
      if (ka == null) return 1;
      if (kb == null) return -1;
      return ka - kb;
    });
    return withKm;
  }, [items, distances, sortMode]);

  const colorFor = (a: string) => (a === "energy" ? (settings?.energy_color || theme.color.energy) : (settings?.network_color || theme.color.network));

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Contatti</Text>
        <View style={{ flexDirection: "row", gap: 8 }} />
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

      {/* V50.z72 — Barra distanze: toggle ordinamento + indirizzo di partenza */}
      <View style={styles.distBar}>
        <Pressable
          testID="sort-toggle"
          onPress={() => {
            if (sortMode === "distance") { setSortMode("default"); }
            else {
              if (!distanceOrigin) { setOriginDraft(settings?.office_address || ""); setOriginModalOpen(true); }
              setSortMode("distance");
            }
          }}
          style={[styles.sortChip, sortMode === "distance" && styles.sortChipOn]}
        >
          <Ionicons name={sortMode === "distance" ? "swap-vertical" : "swap-vertical-outline"} size={14} color={sortMode === "distance" ? "#FFF" : theme.color.brandPrimary} />
          <Text style={[styles.sortChipTxt, sortMode === "distance" && { color: "#FFF" }]}>
            {sortMode === "distance" ? "Ordina: vicinanza" : "Ordina per vicinanza"}
          </Text>
        </Pressable>
        {distanceOrigin ? (
          <Pressable
            testID="dist-origin-edit"
            onPress={() => { setOriginDraft(distanceOrigin); setOriginModalOpen(true); }}
            style={styles.originPill}
          >
            <Ionicons name="business-outline" size={12} color={theme.color.muted} />
            <Text style={styles.originPillTxt} numberOfLines={1}>Da: {distanceOrigin}</Text>
            <Ionicons name="create-outline" size={12} color={theme.color.brandPrimary} />
          </Pressable>
        ) : (
          <Pressable
            testID="dist-origin-set"
            onPress={() => { setOriginDraft(""); setOriginModalOpen(true); }}
            style={styles.originPill}
          >
            <Ionicons name="add-circle-outline" size={12} color={theme.color.brandPrimary} />
            <Text style={[styles.originPillTxt, { color: theme.color.brandPrimary }]}>Imposta origine</Text>
          </Pressable>
        )}
        {distLoading ? <ActivityIndicator size="small" color={theme.color.brandPrimary} /> : null}
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

      {/* Barra import CSV/Excel sopra la lista (spostata dall'header) */}
      <View style={styles.importBar}>
        <Pressable
          testID="contacts-import-btn"
          onPress={() => router.push("/contacts-import" as any)}
          style={styles.importBtn}
        >
          <Ionicons name="cloud-upload-outline" size={16} color="#7C3AED" />
          <Text style={styles.importBtnTxt}>Importa contatti da CSV / Excel</Text>
          <Ionicons name="chevron-forward" size={14} color="#7C3AED" />
        </Pressable>
      </View>

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
          data={orderedItems}
          keyExtractor={(i) => i.contact_id}
          contentContainerStyle={{ padding: 16, paddingTop: 4, paddingBottom: pagePad }}
          renderItem={({ item }) => {
            const km = distances[item.contact_id];
            return (
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
                    {/* V50.z72 — Badge distanza */}
                    {distanceOrigin ? (
                      km == null ? (
                        <View style={[styles.tag, styles.kmTagNull]}>
                          <Ionicons name="help-circle-outline" size={11} color={theme.color.muted} />
                          <Text style={styles.tagTxtNeutral}>senza indirizzo</Text>
                        </View>
                      ) : (
                        <View style={[styles.tag, styles.kmTag]}>
                          <Ionicons name="speedometer-outline" size={11} color="#0369A1" />
                          <Text style={styles.kmTagTxt}>≈ {km.toFixed(1)} km</Text>
                        </View>
                      )
                    ) : null}
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={20} color={theme.color.muted} />
              </Pressable>
            );
          }}
        />
      )}

      {/* V50.z72 — Modal per impostare origine distanze */}
      <Modal visible={originModalOpen} transparent animationType="fade" onRequestClose={() => setOriginModalOpen(false)}>
        <View style={styles.modalBackdrop} pointerEvents="box-none">
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Distanze dal punto</Text>
            <Text style={styles.modalSub}>
              Da qui verranno calcolate le distanze verso ogni contatto.
              {settings?.office_address ? " Default = indirizzo ufficio." : ""}
            </Text>
            <TextInput
              testID="dist-origin-input"
              value={originDraft}
              onChangeText={setOriginDraft}
              placeholder="es. Corso Italia 42, Milano"
              placeholderTextColor={theme.color.muted}
              style={styles.modalInput}
              autoFocus
            />
            <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
              {settings?.office_address && originDraft.trim() !== settings.office_address ? (
                <Pressable onPress={() => setOriginDraft(settings.office_address || "")} style={[styles.modalBtn, styles.modalBtnGhost]}>
                  <Ionicons name="business-outline" size={14} color={theme.color.onSurface} />
                  <Text style={styles.modalBtnGhostTxt}>Ufficio</Text>
                </Pressable>
              ) : null}
              <Pressable onPress={() => setOriginModalOpen(false)} style={[styles.modalBtn, styles.modalBtnGhost, { flex: 1 }]}>
                <Text style={styles.modalBtnGhostTxt}>Annulla</Text>
              </Pressable>
              <Pressable
                testID="dist-origin-save"
                onPress={() => {
                  const val = originDraft.trim();
                  setDistanceOrigin(val);
                  setDistances({});
                  setOriginModalOpen(false);
                  if (val && sortMode !== "distance") setSortMode("distance");
                }}
                style={[styles.modalBtn, { flex: 1, backgroundColor: theme.color.brandPrimary }]}
              >
                <Ionicons name="checkmark" size={16} color="#FFF" />
                <Text style={styles.modalBtnTxt}>Calcola</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 12 },
  title: { fontSize: 24, fontWeight: "700", color: theme.color.onSurface },
  // V29.bb — Stile Optima
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.color.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.9)",
    shadowColor: "#000",
    shadowOpacity: 0.20,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
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
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.9)",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
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
  // V50.z72 — Distanze in batch UI
  distBar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingBottom: 6, flexWrap: "wrap" },
  importBar: { paddingHorizontal: 16, paddingBottom: 8 },
  importBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: "#F5F3FF", borderWidth: 1, borderColor: "#DDD6FE", minHeight: 44 },
  importBtnTxt: { flex: 1, fontSize: 13, fontWeight: "700", color: "#7C3AED" },
  sortChip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: "#FFF", borderWidth: 1, borderColor: theme.color.brandPrimary },
  sortChipOn: { backgroundColor: theme.color.brandPrimary, borderColor: theme.color.brandPrimary },
  sortChipTxt: { fontSize: 11, fontWeight: "700", color: theme.color.brandPrimary },
  originPill: { flex: 1, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: theme.color.border, minWidth: 100 },
  originPillTxt: { flex: 1, fontSize: 11, fontWeight: "600", color: theme.color.muted },
  kmTag: { flexDirection: "row", alignItems: "center", gap: 3, borderColor: "#BAE6FD", backgroundColor: "#E0F2FE" },
  kmTagNull: { flexDirection: "row", alignItems: "center", gap: 3, borderColor: theme.color.border, backgroundColor: "#F8FAFC" },
  kmTagTxt: { fontSize: 11, fontWeight: "700", color: "#0369A1" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 20 },
  modalSheet: { backgroundColor: "#FFF", borderRadius: 14, padding: 18 },
  modalTitle: { fontSize: 16, fontWeight: "800", color: theme.color.onSurface },
  modalSub: { fontSize: 12, color: theme.color.muted, marginTop: 4, marginBottom: 10, lineHeight: 17 },
  modalInput: { borderWidth: 1, borderColor: theme.color.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, backgroundColor: "#F8FAFC", color: theme.color.onSurface },
  modalBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10 },
  modalBtnGhost: { backgroundColor: "#F1F5F9" },
  modalBtnGhostTxt: { color: theme.color.onSurface, fontWeight: "700", fontSize: 13 },
  modalBtnTxt: { color: "#FFF", fontWeight: "800", fontSize: 13 },
});

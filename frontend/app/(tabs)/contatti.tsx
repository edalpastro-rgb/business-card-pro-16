import { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, TextInput, ActivityIndicator, Modal, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { PendingBadge } from "@/src/OfflineBanner"; // V50.z281
import { theme } from "@/src/theme";
import { isAreaVisible, areaCategories } from "@/src/utils/areaAccess";
import { ModuleErrorBoundary } from "@/src/shared";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { useScrollMemory } from "@/src/utils/appStatePersist";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium coerente con la Home

type Contact = {
  _pending?: boolean; // V50.z281 — creato/modificato offline, in attesa di sincronizzazione
  contact_id: string; first_name: string; last_name: string; phone: string; email: string;
  area: "energy" | "network"; source: "personal" | "referral"; address: string;
  area_categories?: Record<string, { category?: string; subcategory?: string }>;
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
  const scrollMem = useScrollMemory("contatti_list"); // V50.z243 — scroll memorizzato
  // V50.z335 — Griglia responsive: 1 colonna telefono · 2 tablet · 3 desktop
  const { width: winW } = useWindowDimensions();
  const cols = winW >= 1100 ? 3 : winW >= 720 ? 2 : 1;
  const [items, setItems] = useState<Contact[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  // V50.z115 — Filtro Categoria › Sottocategoria (attivo quando è selezionata un'area con categorie)
  const [catFilter, setCatFilter] = useState<string | null>(null);
  const [subFilter, setSubFilter] = useState<string | null>(null);
  // V50.z114 — Permessi aree (CRM · Aree): nascondi ai collaboratori le aree non consentite/archiviate
  const AREAS = AREAS_ALL.filter((a) => a.key === "all" || (allowed.includes(a.key) && isAreaVisible(settings as any, a.key, user?.role)));
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
    // V50.z114 — Esclude i contatti delle aree non visibili per il ruolo corrente
    const visible = items.filter((c) => {
      if (!isAreaVisible(settings as any, c.area, user?.role)) return false;
      if (area !== "all" && catFilter) {
        const ac = c.area_categories?.[area];
        if (ac?.category !== catFilter) return false;
        if (subFilter && ac?.subcategory !== subFilter) return false;
      }
      return true;
    });
    if (sortMode !== "distance") return visible;
    const withKm = [...visible];
    withKm.sort((a, b) => {
      const ka = distances[a.contact_id];
      const kb = distances[b.contact_id];
      if (ka == null && kb == null) return 0;
      if (ka == null) return 1;
      if (kb == null) return -1;
      return ka - kb;
    });
    return withKm;
  }, [items, distances, sortMode, settings, user?.role, area, catFilter, subFilter]);

  const colorFor = (a: string) => (a === "energy" ? (settings?.energy_color || theme.color.energy) : (settings?.network_color || theme.color.network));

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Contatti</Text>
        <View style={styles.countPill} testID="contacts-count"><Text style={styles.countPillTxt}>{orderedItems.length}</Text></View>
      </View>

      <View style={styles.search}>
        <Ionicons name="search" size={18} color={HT.muted} />
        <TextInput
          testID="contacts-search"
          placeholder="Cerca per nome, telefono, email"
          placeholderTextColor={HT.muted}
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
            onPress={() => { setArea(a.key); setCatFilter(null); setSubFilter(null); }}
            style={[styles.chip, area === a.key && styles.chipActive]}
          >
            <Text style={[styles.chipTxt, area === a.key && styles.chipTxtActive]}>{a.label}</Text>
          </Pressable>
        ))}
      </View>
      {area !== "all" && areaCategories(settings as any, area).length > 0 && (
        <View style={[styles.chipsRow, { paddingTop: 0 }]} testID="filter-categories">
          {areaCategories(settings as any, area).map((c) => (
            <Pressable
              key={c.name}
              testID={`filter-cat-${c.name}`}
              onPress={() => { setCatFilter(catFilter === c.name ? null : c.name); setSubFilter(null); }}
              style={[styles.chip, catFilter === c.name && styles.chipActive]}
            >
              <Text style={[styles.chipTxt, catFilter === c.name && styles.chipTxtActive]}>{c.name}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {area !== "all" && catFilter && (areaCategories(settings as any, area).find((c) => c.name === catFilter)?.subs.length || 0) > 0 && (
        <View style={[styles.chipsRow, { paddingTop: 0 }]} testID="filter-subcategories">
          {(areaCategories(settings as any, area).find((c) => c.name === catFilter)?.subs || []).map((sub) => (
            <Pressable
              key={sub}
              testID={`filter-sub-${sub}`}
              onPress={() => setSubFilter(subFilter === sub ? null : sub)}
              style={[styles.chip, subFilter === sub && styles.chipActive]}
            >
              <Text style={[styles.chipTxt, subFilter === sub && styles.chipTxtActive]}>› {sub}</Text>
            </Pressable>
          ))}
        </View>
      )}

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
          <Ionicons name={sortMode === "distance" ? "swap-vertical" : "swap-vertical-outline"} size={14} color={sortMode === "distance" ? "#FFF" : HT.brand} />
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
            <Ionicons name="business-outline" size={12} color={HT.muted} />
            <Text style={styles.originPillTxt} numberOfLines={1}>Da: {distanceOrigin}</Text>
            <Ionicons name="create-outline" size={12} color={HT.brand} />
          </Pressable>
        ) : (
          <Pressable
            testID="dist-origin-set"
            onPress={() => { setOriginDraft(""); setOriginModalOpen(true); }}
            style={styles.originPill}
          >
            <Ionicons name="add-circle-outline" size={12} color={HT.brand} />
            <Text style={[styles.originPillTxt, { color: HT.brand }]}>Imposta origine</Text>
          </Pressable>
        )}
        {distLoading ? <ActivityIndicator size="small" color={HT.brand} /> : null}
      </View>

      {groups.length > 0 && (
        <View style={{ maxHeight: 44 }}>
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={[{ group_id: "__all__", name: "Tutti gruppi", color: HT.brand, member_count: 0 } as Group, ...groups]}
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
                  style={[styles.groupChip, on && { backgroundColor: item.color + "2E", borderColor: item.color }]}
                >
                  {!isAll && <View style={[styles.groupDot, { backgroundColor: item.color }]} />}
                  <Text style={[styles.groupChipTxt, on && { color: HT.text }]}>{item.name}{!isAll && ` (${item.member_count})`}</Text>
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
          <Ionicons name="cloud-upload-outline" size={16} color={HT.violet} />
          <Text style={styles.importBtnTxt}>Importa contatti da CSV / Excel</Text>
          <Ionicons name="chevron-forward" size={14} color={HT.violet} />
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={HT.brand} />
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="people-outline" size={40} color={HT.muted} />
          <Text style={styles.emptyTxt}>Nessun contatto trovato</Text>
          <Pressable testID="empty-add-contact" style={styles.emptyBtn} onPress={() => router.push("/contact/new")}>
            <Text style={styles.emptyBtnTxt}>Aggiungi contatto</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          key={`cols-${cols}`}
          numColumns={cols}
          columnWrapperStyle={cols > 1 ? { gap: 12 } : undefined}
          testID="contacts-list"
          ref={scrollMem.ref}
          onScroll={scrollMem.onScroll}
          onContentSizeChange={scrollMem.onContentSizeChange}
          scrollEventThrottle={scrollMem.scrollEventThrottle}
          data={orderedItems}
          keyExtractor={(i) => i.contact_id}
          contentContainerStyle={{ padding: 16, paddingTop: 4, paddingBottom: pagePad }}
          renderItem={({ item }) => {
            const km = distances[item.contact_id];
            return (
              <Pressable
                testID={`contact-${item.contact_id}`}
                onPress={() => router.push(`/contact/${item.contact_id}`)}
                style={({ pressed }) => [styles.card, cols > 1 && { flex: 1 }, pressed && { borderColor: colorFor(item.area) + "99" }]}
              >
                <View style={[styles.avatar, { backgroundColor: colorFor(item.area), borderColor: colorFor(item.area) + "66" }]}>
                  <Text style={styles.avatarTxt}>
                    {(item.first_name?.[0] || "").toUpperCase()}{(item.last_name?.[0] || "").toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center" }}><Text style={styles.name}>{item.first_name} {item.last_name}</Text><PendingBadge pending={item._pending} /></View>
                  <Text style={styles.sub}>{item.phone || item.email || "—"}</Text>
                  <View style={styles.tags}>
                    <View style={[styles.tag, { borderColor: colorFor(item.area) + "66", backgroundColor: colorFor(item.area) + "22" }]}>
                      <Text style={[styles.tagTxt, { color: colorFor(item.area) }]}>{item.area === "energy" ? (settings?.energy_title || "Energia") : (settings?.network_title || "Network")}</Text>
                    </View>
                    <View style={[styles.tag, { borderColor: HT.border, backgroundColor: HT.glass }]}>
                      <Ionicons name={item.source === "referral" ? "git-branch-outline" : "hand-left-outline"} size={10} color={HT.text2} />
                      <Text style={styles.tagTxtNeutral}>{item.source === "referral" ? "Referenza" : "Conoscenza"}</Text>
                    </View>
                    {/* V50.z72 — Badge distanza */}
                    {distanceOrigin ? (
                      km == null ? (
                        <View style={[styles.tag, styles.kmTagNull]}>
                          <Ionicons name="help-circle-outline" size={11} color={HT.muted} />
                          <Text style={styles.tagTxtNeutral}>senza indirizzo</Text>
                        </View>
                      ) : (
                        <View style={[styles.tag, styles.kmTag]}>
                          <Ionicons name="navigate" size={10} color={HT.axon} />
                          <Text style={styles.kmTagTxt}>≈ {km.toFixed(1)} km</Text>
                        </View>
                      )
                    ) : null}
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={18} color={HT.muted} />
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
              placeholderTextColor={HT.muted}
              style={styles.modalInput}
              autoFocus
            />
            <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
              {settings?.office_address && originDraft.trim() !== settings.office_address ? (
                <Pressable onPress={() => setOriginDraft(settings.office_address || "")} style={[styles.modalBtn, styles.modalBtnGhost]}>
                  <Ionicons name="business-outline" size={14} color={HT.text} />
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
                style={[styles.modalBtn, { flex: 1, backgroundColor: HT.brand }]}
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
  root: { flex: 1, backgroundColor: HT.bg },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 20, paddingVertical: 12 },
  title: { fontSize: 26, fontWeight: "900", color: HT.text, letterSpacing: -0.6 },
  countPill: { backgroundColor: HT.brandTint, borderWidth: 1, borderColor: HT.brandLine, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
  countPillTxt: { color: HT.brand, fontWeight: "800", fontSize: 12 },
  search: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: HT.card, marginHorizontal: 16, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1, borderColor: HT.border, minHeight: 46 },
  searchInput: { flex: 1, paddingVertical: 10, color: HT.text, fontSize: 15 },
  chipsRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingVertical: 12, flexWrap: "wrap" },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border, flexShrink: 0, minHeight: 36, justifyContent: "center" },
  chipActive: { backgroundColor: HT.brandTint, borderColor: HT.brand },
  chipTxt: { color: HT.text2, fontWeight: "700", fontSize: 13 },
  chipTxtActive: { color: HT.brand },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40, gap: 12 },
  emptyTxt: { color: HT.muted, fontSize: 15 },
  emptyBtn: { backgroundColor: HT.brand, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, marginTop: 8 },
  emptyBtnTxt: { color: "#FFF", fontWeight: "700" },
  card: { ...HT.cardShadow, flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: HT.card, padding: 12, borderRadius: 16, marginBottom: 12, borderWidth: 1, borderColor: HT.border },
  avatar: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", borderWidth: 1.5 },
  avatarTxt: { fontWeight: "800", fontSize: 15, color: "#FFF", letterSpacing: 0.3 },
  name: { fontSize: 16, fontWeight: "800", color: HT.text, letterSpacing: -0.2 },
  sub: { fontSize: 13, color: HT.muted, marginTop: 2 },
  tags: { flexDirection: "row", gap: 6, marginTop: 8, flexWrap: "wrap" },
  tag: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, borderWidth: 1 },
  tagTxt: { fontSize: 11, fontWeight: "800" },
  tagTxtNeutral: { fontSize: 11, fontWeight: "700", color: HT.text2 },
  groupChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border, minHeight: 36 },
  groupChipTxt: { color: HT.text2, fontWeight: "700", fontSize: 12 },
  groupDot: { width: 8, height: 8, borderRadius: 4 },
  // V50.z72 — Distanze in batch UI
  distBar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingBottom: 8, flexWrap: "wrap" },
  importBar: { paddingHorizontal: 16, paddingBottom: 8 },
  importBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: HT.violetTint, borderWidth: 1, borderColor: HT.violet + "55", minHeight: 44 },
  importBtnTxt: { flex: 1, fontSize: 13, fontWeight: "700", color: HT.violet },
  sortChip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: HT.card, borderWidth: 1, borderColor: HT.brandLine, minHeight: 32 },
  sortChipOn: { backgroundColor: HT.brand, borderColor: HT.brand },
  sortChipTxt: { fontSize: 11, fontWeight: "700", color: HT.brand },
  originPill: { flex: 1, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border, minWidth: 100, minHeight: 32 },
  originPillTxt: { flex: 1, fontSize: 11, fontWeight: "600", color: HT.muted },
  kmTag: { borderColor: HT.axonLine, backgroundColor: HT.axonTint },
  kmTagNull: { borderColor: HT.border, backgroundColor: HT.glass },
  kmTagTxt: { fontSize: 11, fontWeight: "800", color: HT.axon },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", padding: 20 },
  modalSheet: { backgroundColor: HT.card, borderRadius: 16, padding: 18, borderWidth: 1, borderColor: HT.border },
  modalTitle: { fontSize: 16, fontWeight: "800", color: HT.text },
  modalSub: { fontSize: 12, color: HT.muted, marginTop: 4, marginBottom: 10, lineHeight: 17 },
  modalInput: { borderWidth: 1, borderColor: HT.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, backgroundColor: HT.card2, color: HT.text },
  modalBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10 },
  modalBtnGhost: { backgroundColor: HT.glassStrong },
  modalBtnGhostTxt: { color: HT.text, fontWeight: "700", fontSize: 13 },
  modalBtnTxt: { color: "#FFF", fontWeight: "800", fontSize: 13 },
});

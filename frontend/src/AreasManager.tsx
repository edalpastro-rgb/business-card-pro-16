/**
 * V50.z113 — CRM · Aree: gestione ad albero Area > Sottocategoria.
 *
 * Una card collassabile per area (colore + nome + freccia). Dentro: nome,
 * colore (selettore a scomparsa), descrizione uso, permessi di accesso per
 * ruolo, sottocategorie. Elimina → "Archivia" (nascondi) oppure "Elimina
 * definitivamente" (solo aree personalizzate: Energia/Network sono strutturali
 * e possono solo essere archiviate). "Nuova area" in fondo alla lista.
 *
 * Persistenza (settings del tenant):
 *  - aree built-in: energy_title/energy_color, network_title/network_color + area_meta[key]
 *  - aree custom: custom_areas[] = { id, name, color, icon, description, subcategories, allowed_roles, archived }
 */
import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, Modal } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

export type AreaCategory = { name: string; subs: string[] };
export type AreaMeta = { description?: string; subcategories?: string[]; categories?: AreaCategory[]; allowed_roles?: string[]; archived?: boolean };
export type CustomArea = { id: string; name: string; color: string; icon?: string } & AreaMeta;
export type AreasSettings = {
  energy_title: string; energy_color: string;
  network_title: string; network_color: string;
  custom_areas?: CustomArea[];
  area_meta?: Record<string, AreaMeta>;
};

type AreaRow = { key: string; builtin: boolean; name: string; color: string; meta: AreaMeta };

const PALETTE = ["#EF4444", "#F97316", "#F59E0B", "#22C55E", "#10B981", "#06B6D4", "#3B82F6", "#2563EB", "#8B5CF6", "#EC4899", "#F43F5E", "#84CC16", HT.muted, HT.text];
const ROLES: { key: string; label: string }[] = [
  { key: "owner", label: "Titolare" },
  { key: "admin", label: "Admin" },
  { key: "member", label: "Collaboratori" },
];
const ALL_ROLES = ROLES.map((r) => r.key);

export function AreasManager({ settings, onSave, onReset }: {
  settings: AreasSettings;
  onSave: (next: AreasSettings) => Promise<void> | void;
  onReset: () => Promise<void> | void;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [confirm, setConfirm] = useState<{ key: string; builtin: boolean; name: string } | null>(null);
  const [resetAsk, setResetAsk] = useState(false);

  const rows: AreaRow[] = useMemo(() => {
    const meta = settings.area_meta || {};
    const base: AreaRow[] = [
      { key: "energy", builtin: true, name: settings.energy_title, color: settings.energy_color, meta: meta.energy || {} },
      { key: "network", builtin: true, name: settings.network_title, color: settings.network_color, meta: meta.network || {} },
    ];
    const custom: AreaRow[] = (settings.custom_areas || []).map((a) => ({
      key: a.id, builtin: false, name: a.name, color: a.color,
      meta: { description: a.description, subcategories: a.subcategories, categories: a.categories, allowed_roles: a.allowed_roles, archived: a.archived },
    }));
    return [...base, ...custom];
  }, [settings]);

  const visible = rows.filter((r) => showArchived || !r.meta.archived);
  const archivedCount = rows.filter((r) => r.meta.archived).length;

  /** Applica una modifica (nome/colore/meta) a un'area e persiste. */
  const updateArea = (key: string, patch: { name?: string; color?: string; meta?: AreaMeta }) => {
    const next: AreasSettings = { ...settings, custom_areas: [...(settings.custom_areas || [])], area_meta: { ...(settings.area_meta || {}) } };
    if (key === "energy" || key === "network") {
      if (patch.name !== undefined) (next as any)[`${key}_title`] = patch.name;
      if (patch.color !== undefined) (next as any)[`${key}_color`] = patch.color;
      if (patch.meta) next.area_meta![key] = { ...(next.area_meta![key] || {}), ...patch.meta };
    } else {
      next.custom_areas = next.custom_areas!.map((a) => a.id === key ? { ...a, ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.color !== undefined ? { color: patch.color } : {}), ...(patch.meta || {}) } : a);
    }
    void onSave(next);
  };

  const addArea = () => {
    const id = `area_${Date.now().toString(36)}`;
    const used = new Set(rows.map((r) => r.color));
    const color = PALETTE.find((c) => !used.has(c)) || PALETTE[rows.length % PALETTE.length];
    const next: AreasSettings = {
      ...settings,
      custom_areas: [...(settings.custom_areas || []), { id, name: "Nuova area", color, icon: "briefcase", description: "", categories: [], allowed_roles: ALL_ROLES, archived: false }],
    };
    void onSave(next);
    setOpenKey(id);
  };

  const deleteForever = (key: string) => {
    void onSave({ ...settings, custom_areas: (settings.custom_areas || []).filter((a) => a.id !== key) });
    if (openKey === key) setOpenKey(null);
  };

  return (
    <View testID="areas-manager">
      <Text style={styles.legend}>
        Struttura: <Text style={styles.legendStrong}>Area</Text> › <Text style={styles.legendStrong}>Categoria</Text> › <Text style={styles.legendStrong}>Sottocategoria</Text>. Tocca un&apos;area per aprirla.
      </Text>

      {visible.map((r) => (
        <AreaCard
          key={r.key}
          row={r}
          open={openKey === r.key}
          onToggle={() => setOpenKey(openKey === r.key ? null : r.key)}
          onChange={(patch) => updateArea(r.key, patch)}
          onDelete={() => setConfirm({ key: r.key, builtin: r.builtin, name: r.name })}
          onRestore={() => updateArea(r.key, { meta: { archived: false } })}
        />
      ))}

      <Pressable testID="area-add" onPress={addArea} style={styles.addBtn}>
        <Ionicons name="add-circle" size={20} color="#FFF" />
        <Text style={styles.addBtnTxt}>Nuova area</Text>
      </Pressable>

      <View style={styles.footerRow}>
        {archivedCount > 0 && (
          <Pressable testID="areas-toggle-archived" onPress={() => setShowArchived((v) => !v)} style={styles.linkBtn}>
            <Ionicons name={showArchived ? "eye-off-outline" : "eye-outline"} size={14} color={HT.brand} />
            <Text style={styles.linkTxt}>{showArchived ? "Nascondi archiviate" : `Mostra archiviate (${archivedCount})`}</Text>
          </Pressable>
        )}
        <View style={{ flex: 1 }} />
        <Pressable testID="areas-reset" onPress={() => setResetAsk(true)} style={styles.linkBtn}>
          <Ionicons name="refresh-circle-outline" size={14} color={HT.danger} />
          <Text style={[styles.linkTxt, { color: HT.danger }]}>Azzera tutto</Text>
        </Pressable>
      </View>

      {/* Conferma eliminazione: Archivia / Elimina definitivamente */}
      <Modal visible={!!confirm} transparent animationType="fade" onRequestClose={() => setConfirm(null)}>
        <View style={styles.modalBack}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Elimina «{confirm?.name}»</Text>
            <Text style={styles.modalHint}>
              {confirm?.builtin
                ? "Quest'area è strutturale (contatti e appuntamenti la usano): può essere solo archiviata."
                : "Scegli cosa fare con quest'area, le sue categorie e sottocategorie."}
            </Text>
            <Pressable
              testID="area-archive"
              onPress={() => { if (confirm) { updateArea(confirm.key, { meta: { archived: true } }); if (openKey === confirm.key) setOpenKey(null); } setConfirm(null); }}
              style={[styles.modalBtn, { backgroundColor: HT.warningTint }]}
            >
              <Ionicons name="archive-outline" size={18} color={HT.warning} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.modalBtnTxt, { color: HT.warning }]}>Archivia (nascondi senza cancellare)</Text>
                <Text style={styles.modalBtnSub}>Sparisce dagli elenchi, i dati restano. Puoi ripristinarla in qualsiasi momento.</Text>
              </View>
            </Pressable>
            {!confirm?.builtin && (
              <Pressable
                testID="area-delete-forever"
                onPress={() => { if (confirm) deleteForever(confirm.key); setConfirm(null); }}
                style={[styles.modalBtn, { backgroundColor: HT.dangerTint }]}
              >
                <Ionicons name="trash-outline" size={18} color={HT.danger} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.modalBtnTxt, { color: HT.danger }]}>Elimina definitivamente tutti i dati</Text>
                  <Text style={styles.modalBtnSub}>Area, descrizione, permessi e sottocategorie vengono cancellati. Non reversibile.</Text>
                </View>
              </Pressable>
            )}
            <Pressable onPress={() => setConfirm(null)} style={[styles.modalBtn, { justifyContent: "center", backgroundColor: HT.card2, borderWidth: 1, borderColor: HT.border }]}>
              <Text style={[styles.modalBtnTxt, { color: HT.text }]}>Annulla</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Conferma azzeramento totale */}
      <Modal visible={resetAsk} transparent animationType="fade" onRequestClose={() => setResetAsk(false)}>
        <View style={styles.modalBack}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Azzerare tutte le aree?</Text>
            <Text style={styles.modalHint}>Cancella aree personalizzate, descrizioni, permessi, sottocategorie, categorie prodotto e tipi appuntamento personalizzati. Energia e Network restano con nome e colore attuali.</Text>
            <Pressable testID="areas-reset-confirm" onPress={async () => { setResetAsk(false); setOpenKey(null); await onReset(); }} style={[styles.modalBtn, { backgroundColor: HT.dangerTint, justifyContent: "center" }]}>
              <Text style={[styles.modalBtnTxt, { color: HT.danger }]}>Sì, azzera tutto</Text>
            </Pressable>
            <Pressable onPress={() => setResetAsk(false)} style={[styles.modalBtn, { justifyContent: "center", backgroundColor: HT.card2, borderWidth: 1, borderColor: HT.border }]}>
              <Text style={[styles.modalBtnTxt, { color: HT.text }]}>Annulla</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function AreaCard({ row, open, onToggle, onChange, onDelete, onRestore }: {
  row: AreaRow; open: boolean; onToggle: () => void;
  onChange: (patch: { name?: string; color?: string; meta?: AreaMeta }) => void;
  onDelete: () => void; onRestore: () => void;
}) {
  const [name, setName] = useState(row.name);
  const [desc, setDesc] = useState(row.meta.description || "");
  const [colorOpen, setColorOpen] = useState(false);
  const [hex, setHex] = useState(row.color);
  const [catInput, setCatInput] = useState("");
  const [subInputs, setSubInputs] = useState<Record<string, string>>({});
  // Gerarchia: categorie con sottocategorie. Le vecchie `subcategories` piatte
  // vengono mostrate come categoria "Generale" (migrazione trasparente al primo salvataggio).
  const cats: AreaCategory[] = (row.meta.categories && row.meta.categories.length)
    ? row.meta.categories
    : (row.meta.subcategories && row.meta.subcategories.length ? [{ name: "Generale", subs: row.meta.subcategories }] : []);
  const subCount = cats.reduce((n, c) => n + c.subs.length, 0);
  const roles = row.meta.allowed_roles && row.meta.allowed_roles.length ? row.meta.allowed_roles : ALL_ROLES;
  const archived = !!row.meta.archived;

  // Risincronizza i draft quando cambiano i dati salvati (es. reset)
  React.useEffect(() => { setName(row.name); setHex(row.color); setDesc(row.meta.description || ""); }, [row.name, row.color, row.meta.description]);

  const commitName = () => { const n = name.trim(); if (n && n !== row.name) onChange({ name: n }); else setName(row.name); };
  const commitDesc = () => { if ((desc || "") !== (row.meta.description || "")) onChange({ meta: { description: desc } }); };
  const pickColor = (c: string) => { setHex(c); onChange({ color: c }); setColorOpen(false); };
  const commitHex = () => { const h = hex.startsWith("#") ? hex : `#${hex}`; if (/^#[0-9a-fA-F]{6}$/.test(h)) { onChange({ color: h }); setColorOpen(false); } else setHex(row.color); };
  const toggleRole = (k: string) => {
    const next = roles.includes(k) ? roles.filter((r) => r !== k) : [...roles, k];
    if (next.length === 0) return; // almeno un ruolo
    onChange({ meta: { allowed_roles: next } });
  };
  const saveCats = (next: AreaCategory[]) => onChange({ meta: { categories: next, subcategories: [] } });
  const addCat = () => {
    const v = catInput.trim();
    if (!v || cats.some((c) => c.name.toLowerCase() === v.toLowerCase())) { setCatInput(""); return; }
    saveCats([...cats, { name: v, subs: [] }]);
    setCatInput("");
  };
  const removeCat = (name: string) => saveCats(cats.filter((c) => c.name !== name));
  const addSub = (catName: string) => {
    const v = (subInputs[catName] || "").trim();
    const cat = cats.find((c) => c.name === catName);
    if (!v || !cat || cat.subs.some((x) => x.toLowerCase() === v.toLowerCase())) { setSubInputs({ ...subInputs, [catName]: "" }); return; }
    saveCats(cats.map((c) => c.name === catName ? { ...c, subs: [...c.subs, v] } : c));
    setSubInputs({ ...subInputs, [catName]: "" });
  };
  const removeSub = (catName: string, v: string) => saveCats(cats.map((c) => c.name === catName ? { ...c, subs: c.subs.filter((x) => x !== v) } : c));

  return (
    <View style={[styles.card, { borderLeftColor: row.color }, archived && { opacity: 0.6 }]} testID={`area-card-${row.key}`}>
      <Pressable onPress={onToggle} style={styles.cardHead} testID={`area-toggle-${row.key}`}>
        <View style={[styles.dot, { backgroundColor: row.color }]} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.cardTitle} numberOfLines={1}>{row.name}</Text>
          <Text style={styles.cardSub} numberOfLines={1}>
            {cats.length} {cats.length === 1 ? "categoria" : "categorie"} · {subCount} {subCount === 1 ? "sottocategoria" : "sottocategorie"}
            {row.builtin ? " · predefinita" : ""}{archived ? " · ARCHIVIATA" : ""}
          </Text>
        </View>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={20} color={HT.muted} />
      </Pressable>

      {open && (
        <View style={styles.body}>
          {/* Nome */}
          <Text style={styles.label}>Nome area</Text>
          <TextInput
            testID={`area-name-${row.key}`}
            value={name}
            onChangeText={setName}
            onBlur={commitName}
            onSubmitEditing={commitName}
            style={styles.input}
            placeholder="Es. Assicurazioni"
            placeholderTextColor={HT.muted}
          />

          {/* Colore — selettore a scomparsa */}
          <Text style={styles.label}>Colore</Text>
          <View style={styles.colorRow}>
            <View style={[styles.colorCurrent, { backgroundColor: row.color }]} />
            <Text style={styles.colorHex}>{row.color.toUpperCase()}</Text>
            <View style={{ flex: 1 }} />
            <Pressable testID={`area-color-toggle-${row.key}`} onPress={() => setColorOpen((v) => !v)} style={styles.smallBtn}>
              <Ionicons name="color-palette-outline" size={14} color={HT.brand} />
              <Text style={styles.smallBtnTxt}>{colorOpen ? "Chiudi" : "Cambia colore"}</Text>
            </Pressable>
          </View>
          {colorOpen && (
            <View style={styles.colorPanel} testID={`area-color-panel-${row.key}`}>
              <View style={styles.swatches}>
                {PALETTE.map((c) => (
                  <Pressable key={c} testID={`area-swatch-${row.key}-${c}`} onPress={() => pickColor(c)} style={[styles.swatch, { backgroundColor: c }, row.color.toLowerCase() === c.toLowerCase() && styles.swatchActive]}>
                    {row.color.toLowerCase() === c.toLowerCase() && <Ionicons name="checkmark" size={12} color="#FFF" />}
                  </Pressable>
                ))}
              </View>
              <TextInput
                value={hex}
                onChangeText={setHex}
                onBlur={commitHex}
                onSubmitEditing={commitHex}
                style={[styles.input, { marginTop: 8 }]}
                placeholder="#RRGGBB"
                placeholderTextColor={HT.muted}
                autoCapitalize="characters"
                maxLength={7}
              />
            </View>
          )}

          {/* Descrizione uso */}
          <Text style={styles.label}>Descrizione uso</Text>
          <TextInput
            testID={`area-desc-${row.key}`}
            value={desc}
            onChangeText={setDesc}
            onBlur={commitDesc}
            multiline
            style={[styles.input, { minHeight: 64, textAlignVertical: "top" }]}
            placeholder="A cosa serve quest'area? Es. Contratti luce/gas per privati e PMI"
            placeholderTextColor={HT.muted}
          />

          {/* Permessi di accesso */}
          <Text style={styles.label}>Permessi di accesso</Text>
          <View style={styles.rolesRow}>
            {ROLES.map((r) => {
              const on = roles.includes(r.key);
              return (
                <Pressable key={r.key} testID={`area-role-${row.key}-${r.key}`} onPress={() => toggleRole(r.key)} style={[styles.roleChip, on && { backgroundColor: row.color + "22", borderColor: row.color }]}>
                  <Ionicons name={on ? "checkmark-circle" : "ellipse-outline"} size={14} color={on ? row.color : HT.muted} />
                  <Text style={[styles.roleTxt, on && { color: row.color }]}>{r.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* Albero: Area › Categoria › Sottocategoria */}
          <Text style={styles.label}>Categorie e sottocategorie</Text>
          <View style={styles.tree}>
            <View style={styles.treeRoot}>
              <View style={[styles.dotSm, { backgroundColor: row.color }]} />
              <Text style={styles.treeRootTxt}>{row.name}</Text>
            </View>
            {cats.length === 0 && <Text style={styles.treeEmpty}>└─ nessuna categoria</Text>}
            {cats.map((cat, ci) => {
              const lastCat = ci === cats.length - 1;
              return (
                <View key={cat.name} testID={`area-cat-${row.key}-${ci}`}>
                  <View style={styles.treeRow}>
                    <Text style={styles.treeBranch}>{lastCat ? "└─" : "├─"}</Text>
                    <Ionicons name="folder-outline" size={14} color={row.color} />
                    <Text style={[styles.treeLeaf, { fontWeight: "800" }]} numberOfLines={1}>{cat.name}</Text>
                    <Pressable onPress={() => removeCat(cat.name)} hitSlop={8} testID={`area-cat-del-${row.key}-${ci}`}>
                      <Ionicons name="close-circle" size={16} color={HT.muted} />
                    </Pressable>
                  </View>
                  {cat.subs.map((sub, si) => (
                    <View key={sub} style={[styles.treeRow, { paddingLeft: 22 }]} testID={`area-sub-${row.key}-${ci}-${si}`}>
                      <Text style={styles.treeBranch}>{lastCat ? "   " : "│  "}{si === cat.subs.length - 1 ? "└─" : "├─"}</Text>
                      <Text style={styles.treeLeaf} numberOfLines={1}>{sub}</Text>
                      <Pressable onPress={() => removeSub(cat.name, sub)} hitSlop={8} testID={`area-sub-del-${row.key}-${ci}-${si}`}>
                        <Ionicons name="close-circle" size={14} color={HT.muted} />
                      </Pressable>
                    </View>
                  ))}
                  <View style={[styles.addRow, { paddingLeft: 22, marginTop: 4, marginBottom: 6 }]}>
                    <TextInput
                      testID={`area-sub-input-${row.key}-${ci}`}
                      value={subInputs[cat.name] || ""}
                      onChangeText={(t) => setSubInputs({ ...subInputs, [cat.name]: t })}
                      onSubmitEditing={() => addSub(cat.name)}
                      style={[styles.input, { flex: 1, marginTop: 0, paddingVertical: 6, fontSize: 13 }]}
                      placeholder={`Sottocategoria di ${cat.name}`}
                      placeholderTextColor={HT.muted}
                    />
                    <Pressable testID={`area-sub-add-${row.key}-${ci}`} onPress={() => addSub(cat.name)} style={[styles.plusBtn, { width: 34, height: 34, backgroundColor: row.color + "33" }]}>
                      <Ionicons name="add" size={16} color={row.color} />
                    </Pressable>
                  </View>
                </View>
              );
            })}
            <View style={styles.addRow}>
              <TextInput
                testID={`area-cat-input-${row.key}`}
                value={catInput}
                onChangeText={setCatInput}
                onSubmitEditing={addCat}
                style={[styles.input, { flex: 1, marginTop: 0 }]}
                placeholder="Nuova categoria (es. Luce, Gas)"
                placeholderTextColor={HT.muted}
              />
              <Pressable testID={`area-cat-add-${row.key}`} onPress={addCat} style={[styles.plusBtn, { backgroundColor: row.color }]}>
                <Ionicons name="add" size={18} color="#FFF" />
              </Pressable>
            </View>
          </View>

          {/* Azioni */}
          <View style={styles.actions}>
            {archived ? (
              <Pressable testID={`area-restore-${row.key}`} onPress={onRestore} style={[styles.actionBtn, { backgroundColor: HT.successTint }]}>
                <Ionicons name="arrow-undo-outline" size={16} color="#16A34A" />
                <Text style={[styles.actionTxt, { color: "#16A34A" }]}>Ripristina</Text>
              </Pressable>
            ) : (
              <Pressable testID={`area-delete-${row.key}`} onPress={onDelete} style={[styles.actionBtn, { backgroundColor: HT.dangerTint }]}>
                <Ionicons name="trash-outline" size={16} color={HT.danger} />
                <Text style={[styles.actionTxt, { color: HT.danger }]}>Elimina</Text>
              </Pressable>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  legend: { fontSize: 12, color: HT.muted, marginBottom: 10 },
  legendStrong: { fontWeight: "800", color: HT.text },
  card: { borderWidth: 1, borderColor: HT.border, borderLeftWidth: 4, borderRadius: 12, backgroundColor: HT.card2, marginBottom: 8, overflow: "hidden" },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 12, minHeight: 52 },
  dot: { width: 24, height: 24, borderRadius: 12 },
  dotSm: { width: 10, height: 10, borderRadius: 5 },
  cardTitle: { fontSize: 15, fontWeight: "800", color: HT.text },
  cardSub: { fontSize: 11.5, color: HT.muted, marginTop: 1 },
  body: { paddingHorizontal: 12, paddingBottom: 12, borderTopWidth: 1, borderTopColor: HT.border },
  label: { fontSize: 11.5, fontWeight: "800", color: HT.muted, marginTop: 12, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.3 },
  input: { borderWidth: 1, borderColor: HT.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: HT.text, backgroundColor: HT.card2 },
  colorRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  colorCurrent: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: HT.card },
  colorHex: { fontSize: 13, fontWeight: "700", color: HT.text },
  smallBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: HT.brand, minHeight: 32 },
  smallBtnTxt: { fontSize: 12, fontWeight: "700", color: HT.brand },
  colorPanel: { marginTop: 8, padding: 10, borderRadius: 10, backgroundColor: HT.card2, borderWidth: 1, borderColor: HT.border },
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  swatch: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  swatchActive: { borderWidth: 3, borderColor: '#0F172A' },
  rolesRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  roleChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: HT.border, backgroundColor: HT.card2, minHeight: 34 },
  roleTxt: { fontSize: 12.5, fontWeight: "700", color: HT.muted },
  tree: { borderRadius: 10, backgroundColor: HT.card2, borderWidth: 1, borderColor: HT.border, padding: 10 },
  treeRoot: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  treeRootTxt: { fontSize: 13.5, fontWeight: "800", color: HT.text },
  treeRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 5, paddingLeft: 4 },
  treeBranch: { fontFamily: "monospace", fontSize: 13, color: HT.muted },
  treeLeaf: { flex: 1, fontSize: 13.5, color: HT.text },
  treeEmpty: { fontSize: 12, color: HT.muted, fontStyle: "italic", paddingLeft: 4, paddingVertical: 4 },
  addRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  plusBtn: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 14 },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, minHeight: 40 },
  actionTxt: { fontSize: 13, fontWeight: "800" },
  addBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: HT.brand, paddingVertical: 13, borderRadius: 12, marginTop: 4, minHeight: 48 },
  addBtnTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
  footerRow: { flexDirection: "row", alignItems: "center", marginTop: 10 },
  linkBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 6, minHeight: 32 },
  linkTxt: { fontSize: 12, fontWeight: "700", color: HT.brand },
  modalBack: { flex: 1, backgroundColor: "rgba(15,23,42,0.55)", alignItems: "center", justifyContent: "center", padding: 20 },
  modalCard: { width: "100%", maxWidth: 440, backgroundColor: HT.card2, borderRadius: 16, padding: 18, gap: 10 },
  modalTitle: { fontSize: 17, fontWeight: "900", color: HT.text },
  modalHint: { fontSize: 12.5, color: HT.muted, marginBottom: 4 },
  modalBtn: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, minHeight: 48 },
  modalBtnTxt: { fontSize: 14, fontWeight: "800" },
  modalBtnSub: { fontSize: 11.5, color: HT.muted, marginTop: 2 },
});

export default AreasManager;

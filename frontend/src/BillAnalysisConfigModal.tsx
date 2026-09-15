// BillAnalysisConfigModal.tsx — Pannello «Configura Analisi Fatture»
// Accessibile dal Master (Analizza bolletta) e dalla scheda cliente (tab Fatture).
// 3 sezioni: Campi estrazione · Analisi comparativa · Richieste manuali. Tutto salvato per tenant (PUT /bills/analysis-config).
import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Modal, TextInput, ActivityIndicator, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/src/theme";
import { notify, confirmAsync } from "@/src/utils/notify";
import { VoiceDictationButton } from "@/src/VoiceDictationButton";
import { useSafeBottom } from "@/src/hooks/useSafeBottom";
import {
  BAType, BillAnalysisBundle, BillAnalysisConfig, BACatalogItem,
  loadBillAnalysisConfig, saveBillAnalysisConfig, resetBillAnalysisConfig,
} from "@/src/billAnalysisConfig";

const ACCENT = "#7C3AED";
const TYPES: { id: BAType; label: string; emoji: string; color: string }[] = [
  { id: "luce", label: "Luce", emoji: "💡", color: "#F59E0B" },
  { id: "gas", label: "Gas", emoji: "🔥", color: "#2563EB" },
  { id: "telco", label: "Telco", emoji: "📞", color: "#0891B2" },
];
type Tab = "fields" | "comparison" | "manual";
const TABS: { id: Tab; label: string; icon: any }[] = [
  { id: "fields", label: "Campi", icon: "list" },
  { id: "comparison", label: "Comparativa", icon: "git-compare" },
  { id: "manual", label: "Richieste", icon: "create" },
];

type Props = { visible: boolean; onClose: () => void; onSaved?: (bundle: BillAnalysisBundle) => void };

export function BillAnalysisConfigModal({ visible, onClose, onSaved }: Props) {
  const insets = useSafeAreaInsets();
  const safeBottom = useSafeBottom();
  const [bundle, setBundle] = useState<BillAnalysisBundle | null>(null);
  const [cfg, setCfg] = useState<BillAnalysisConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<Tab>("fields");
  const [bt, setBt] = useState<BAType>("luce");
  const [cmpBt, setCmpBt] = useState<BAType>("luce");
  const [newField, setNewField] = useState("");
  const [newCmpField, setNewCmpField] = useState("");

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    loadBillAnalysisConfig()
      .then((b) => { setBundle(b); setCfg(b.config); })
      .catch((e: any) => notify("Errore", e?.message || "Impossibile caricare la configurazione"))
      .finally(() => setLoading(false));
  }, [visible]);

  const catalog = bundle?.catalog;
  const typeMeta = useMemo(() => TYPES.find((t) => t.id === bt)!, [bt]);
  const cmpTypeMeta = useMemo(() => TYPES.find((t) => t.id === cmpBt)!, [cmpBt]);

  const update = (fn: (c: BillAnalysisConfig) => BillAnalysisConfig) => setCfg((c) => (c ? fn(c) : c));

  const toggleField = (id: string, def: boolean) => update((c) => ({
    ...c,
    fields: { ...c.fields, [bt]: { ...c.fields[bt], [id]: !(c.fields[bt]?.[id] ?? def) } },
  }));
  const setAllFields = (on: boolean) => update((c) => ({
    ...c,
    fields: { ...c.fields, [bt]: Object.fromEntries((catalog?.fields[bt] || []).map((f) => [f.id, on])) },
  }));
  const addCustomField = () => {
    const v = newField.trim();
    if (!v) return;
    update((c) => c.custom_fields[bt]?.includes(v) ? c : ({ ...c, custom_fields: { ...c.custom_fields, [bt]: [...(c.custom_fields[bt] || []), v] } }));
    setNewField("");
  };
  const removeCustomField = (v: string) => update((c) => ({ ...c, custom_fields: { ...c.custom_fields, [bt]: (c.custom_fields[bt] || []).filter((x) => x !== v) } }));

  const setCmp = (patch: Partial<BillAnalysisConfig["comparison"]>) => update((c) => ({ ...c, comparison: { ...c.comparison, ...patch } }));
  const toggleSection = (id: string) => update((c) => ({ ...c, comparison: { ...c.comparison, sections: { ...c.comparison.sections, [id]: !(c.comparison.sections[id] ?? true) } } }));
  const toggleCmpField = (id: string, def: boolean) => update((c) => ({
    ...c,
    comparison: { ...c.comparison, compare_fields: { ...c.comparison.compare_fields, [cmpBt]: { ...c.comparison.compare_fields[cmpBt], [id]: !(c.comparison.compare_fields[cmpBt]?.[id] ?? def) } } },
  }));
  const addCmpField = () => {
    const v = newCmpField.trim();
    if (!v) return;
    update((c) => c.comparison.custom_compare_fields[cmpBt]?.includes(v) ? c : ({
      ...c,
      comparison: { ...c.comparison, custom_compare_fields: { ...c.comparison.custom_compare_fields, [cmpBt]: [...(c.comparison.custom_compare_fields[cmpBt] || []), v] } },
    }));
    setNewCmpField("");
  };
  const removeCmpField = (v: string) => update((c) => ({
    ...c,
    comparison: { ...c.comparison, custom_compare_fields: { ...c.comparison.custom_compare_fields, [cmpBt]: (c.comparison.custom_compare_fields[cmpBt] || []).filter((x) => x !== v) } },
  }));

  const save = async () => {
    if (!cfg) return;
    try {
      setSaving(true);
      const b = await saveBillAnalysisConfig(cfg);
      setBundle(b);
      setCfg(b.config);
      onSaved?.(b);
      notify("Configurazione salvata", "Sarà applicata a tutte le prossime analisi e comparazioni, lato Master e scheda cliente.");
      onClose();
    } catch (e: any) {
      notify("Errore salvataggio", e?.message || "");
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!(await confirmAsync("Ripristinare i predefiniti?", "Tutte le spunte, i campi personalizzati e le richieste manuali torneranno ai valori iniziali."))) return;
    try {
      setSaving(true);
      const b = await resetBillAnalysisConfig();
      setBundle(b);
      setCfg(b.config);
      onSaved?.(b);
    } catch (e: any) {
      notify("Errore", e?.message || "");
    } finally {
      setSaving(false);
    }
  };

  const countOn = (items: BACatalogItem[] | undefined, flags: Record<string, boolean> | undefined) =>
    (items || []).filter((f) => flags?.[f.id] ?? f.default_on ?? true).length;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.root, { paddingTop: Platform.OS === "web" ? 12 : insets.top }]}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={10} testID="bac-close">
            <Ionicons name="close" size={26} color={theme.color.onSurface} />
          </Pressable>
          <View style={{ flex: 1, marginLeft: 8 }}>
            <Text style={styles.title}>Configura Analisi Fatture</Text>
            <Text style={styles.subtitle}>Valido per Master e schede cliente</Text>
          </View>
          <Pressable onPress={reset} hitSlop={8} disabled={saving || !cfg} testID="bac-reset" style={styles.resetBtn}>
            <Ionicons name="refresh" size={16} color={theme.color.muted} />
            <Text style={styles.resetTxt}>Predefiniti</Text>
          </Pressable>
        </View>

        {/* Tabs */}
        <View style={styles.tabs}>
          {TABS.map((t) => {
            const on = tab === t.id;
            return (
              <Pressable key={t.id} onPress={() => setTab(t.id)} style={[styles.tab, on && styles.tabOn]} testID={`bac-tab-${t.id}`}>
                <Ionicons name={t.icon} size={15} color={on ? "#FFF" : ACCENT} />
                <Text style={[styles.tabTxt, on && styles.tabTxtOn]}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {loading || !cfg || !catalog ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator color={ACCENT} />
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            {tab === "fields" && (
              <>
                <InfoBox text="Le spunte qui sotto sono i valori predefiniti per ogni nuova analisi: potrai comunque modificarle al momento del caricamento di ciascuna fattura." />
                <TypeSwitch value={bt} onChange={setBt} counts={(id) => `${countOn(catalog.fields[id], cfg.fields[id])}/${catalog.fields[id]?.length || 0}`} />
                <View style={styles.rowBetween}>
                  <Text style={styles.sectionLabel}>CAMPI DA ESTRARRE · {typeMeta.label.toUpperCase()}</Text>
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <Pressable onPress={() => setAllFields(true)} testID="bac-fields-all"><Text style={styles.linkTxt}>Tutti</Text></Pressable>
                    <Pressable onPress={() => setAllFields(false)} testID="bac-fields-none"><Text style={styles.linkTxt}>Nessuno</Text></Pressable>
                  </View>
                </View>
                <View style={styles.pillWrap}>
                  {(catalog.fields[bt] || []).map((f) => {
                    const on = cfg.fields[bt]?.[f.id] ?? f.default_on ?? true;
                    return <Pill key={f.id} on={on} color={typeMeta.color} label={f.label} onPress={() => toggleField(f.id, !!f.default_on)} testID={`bac-field-${bt}-${f.id}`} />;
                  })}
                </View>

                <Text style={[styles.sectionLabel, { marginTop: 18 }]}>CAMPI PERSONALIZZATI · {typeMeta.label.toUpperCase()}</Text>
                <ChipList items={cfg.custom_fields[bt] || []} onRemove={removeCustomField} empty="Nessun campo personalizzato: aggiungine uno qui sotto (es. Bonus sociale, Rateizzazione, IVA agevolata)." />
                <AddRow value={newField} onChange={setNewField} onAdd={addCustomField} placeholder="Nuovo campo da estrarre…" testID="bac-custom-field" />
              </>
            )}

            {tab === "comparison" && (
              <>
                <InfoBox text="Definisci come viene costruito il confronto tra la fattura del concorrente e la tua offerta aziendale: aspetto grafico, sezioni, parametri e base di calcolo." />

                <Text style={styles.sectionLabel}>MODELLO GRAFICO</Text>
                <View style={{ gap: 8 }}>
                  {catalog.layouts.map((l) => (
                    <RadioCard key={l.id} on={cfg.comparison.layout === l.id} title={l.label} desc={l.desc} onPress={() => setCmp({ layout: l.id })} testID={`bac-layout-${l.id}`} />
                  ))}
                </View>

                <Text style={[styles.sectionLabel, { marginTop: 18 }]}>STILE</Text>
                <View style={styles.pillWrap}>
                  {catalog.styles.map((s) => {
                    const on = cfg.comparison.style === s.id;
                    return (
                      <Pressable key={s.id} onPress={() => setCmp({ style: s.id })} style={[styles.styleCard, on && { borderColor: ACCENT, borderWidth: 2 }]} testID={`bac-style-${s.id}`}>
                        <View style={{ flexDirection: "row", gap: 4 }}>
                          <View style={[styles.swatch, { backgroundColor: s.primary || "#000" }]} />
                          <View style={[styles.swatch, { backgroundColor: s.bg || "#FFF", borderWidth: 1, borderColor: theme.color.border }]} />
                          <View style={[styles.swatch, { backgroundColor: s.accent || "#888" }]} />
                        </View>
                        <Text style={styles.styleTitle}>{s.label}</Text>
                        <Text style={styles.styleDesc}>{s.desc}</Text>
                        {on && <Ionicons name="checkmark-circle" size={16} color={ACCENT} style={{ position: "absolute", top: 6, right: 6 }} />}
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={[styles.sectionLabel, { marginTop: 18 }]}>SEZIONI DA MOSTRARE</Text>
                <View style={styles.card}>
                  {catalog.sections.map((s, i) => {
                    const on = cfg.comparison.sections[s.id] ?? true;
                    return (
                      <Pressable key={s.id} onPress={() => toggleSection(s.id)} style={[styles.sectionRow, i > 0 && { borderTopWidth: 1, borderTopColor: theme.color.divider }]} testID={`bac-section-${s.id}`}>
                        <Ionicons name={on ? "checkbox" : "square-outline"} size={22} color={on ? ACCENT : theme.color.muted} />
                        <View style={{ flex: 1, marginLeft: 10 }}>
                          <Text style={styles.sectionTitle}>{s.label}</Text>
                          {!!s.desc && <Text style={styles.sectionDesc}>{s.desc}</Text>}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={[styles.sectionLabel, { marginTop: 18 }]}>BASE DEL CONFRONTO</Text>
                <View style={{ gap: 8 }}>
                  {catalog.bases.map((b) => (
                    <RadioCard key={b.id} on={cfg.comparison.basis === b.id} title={b.label} desc={b.desc} onPress={() => setCmp({ basis: b.id })} testID={`bac-basis-${b.id}`} />
                  ))}
                </View>

                <Text style={[styles.sectionLabel, { marginTop: 18 }]}>CAMPI DA CONFRONTARE</Text>
                <TypeSwitch value={cmpBt} onChange={setCmpBt} counts={(id) => `${countOn(catalog.compare_fields[id], cfg.comparison.compare_fields[id])}/${catalog.compare_fields[id]?.length || 0}`} />
                <View style={styles.pillWrap}>
                  {(catalog.compare_fields[cmpBt] || []).map((f) => {
                    const on = cfg.comparison.compare_fields[cmpBt]?.[f.id] ?? f.default_on ?? true;
                    return <Pill key={f.id} on={on} color={cmpTypeMeta.color} label={f.label} onPress={() => toggleCmpField(f.id, !!f.default_on)} testID={`bac-cmpfield-${cmpBt}-${f.id}`} />;
                  })}
                </View>
                <ChipList items={cfg.comparison.custom_compare_fields[cmpBt] || []} onRemove={removeCmpField} empty="" />
                <AddRow value={newCmpField} onChange={setNewCmpField} onAdd={addCmpField} placeholder="Altro parametro da confrontare…" testID="bac-custom-cmpfield" />

                <Text style={[styles.sectionLabel, { marginTop: 18 }]}>ISTRUZIONI PER LA COMPARATIVA</Text>
                <FreeText
                  value={cfg.comparison.instructions}
                  onChange={(v) => setCmp({ instructions: v })}
                  placeholder="Es. Evidenzia sempre il vincolo contrattuale e la penale; se il cliente ha fotovoltaico considera l'autoconsumo…"
                  testID="bac-cmp-instructions"
                />
              </>
            )}

            {tab === "manual" && (
              <>
                <InfoBox text="Richieste in testo libero che l'AI dovrà rispettare in OGNI analisi fattura (come per le offerte aziendali). Puoi scriverle o dettarle." />
                <Text style={styles.sectionLabel}>RICHIESTE MANUALI AGGIUNTIVE</Text>
                <FreeText
                  value={cfg.extra_instructions}
                  onChange={(v) => update((c) => ({ ...c, extra_instructions: v }))}
                  placeholder="Es. Segnala sempre eventuali more o interessi di ritardato pagamento; indica se la fattura è di conguaglio; calcola il costo medio €/kWh tutto incluso…"
                  testID="bac-extra-instructions"
                  tall
                />
                <Text style={styles.hint}>Suggerimento: frasi brevi, una richiesta per riga. I dati aggiuntivi trovati compariranno tra i «Parametri richiesti» di ogni analisi.</Text>
              </>
            )}
          </ScrollView>
        )}

        {/* Footer */}
        <View style={[styles.footer, { paddingBottom: 12 + safeBottom }]}>
          <Pressable onPress={onClose} style={styles.cancelBtn} testID="bac-cancel">
            <Text style={styles.cancelTxt}>Chiudi</Text>
          </Pressable>
          <Pressable onPress={save} disabled={saving || !cfg} style={[styles.saveBtn, (saving || !cfg) && { opacity: 0.6 }]} testID="bac-save">
            {saving ? <ActivityIndicator color="#FFF" /> : (
              <>
                <Ionicons name="save-outline" size={18} color="#FFF" />
                <Text style={styles.saveTxt}>Salva configurazione</Text>
              </>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/** Pulsante ben visibile «Configura Analisi Fatture» (Master + scheda cliente). */
export function BillAnalysisConfigButton({ onPress, summary, testID = "bills-analysis-cfg-btn" }: { onPress: () => void; summary?: string; testID?: string }) {
  return (
    <Pressable onPress={onPress} testID={testID} style={styles.bigBtn}>
      <View style={styles.bigBtnIcon}>
        <Ionicons name="options" size={22} color="#FFF" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.bigBtnTitle}>Configura Analisi Fatture</Text>
        <Text style={styles.bigBtnSub} numberOfLines={1}>{summary || "Campi da estrarre · comparativa · richieste manuali"}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color="#FFF" />
    </Pressable>
  );
}

// ---------- Sub-components ----------

function InfoBox({ text }: { text: string }) {
  return (
    <View style={styles.infoBox}>
      <Ionicons name="information-circle" size={18} color={ACCENT} />
      <Text style={styles.infoTxt}>{text}</Text>
    </View>
  );
}

function TypeSwitch({ value, onChange, counts }: { value: BAType; onChange: (v: BAType) => void; counts: (id: BAType) => string }) {
  return (
    <View style={styles.typeRow}>
      {TYPES.map((t) => {
        const on = value === t.id;
        return (
          <Pressable key={t.id} onPress={() => onChange(t.id)} style={[styles.typeBtn, on && { backgroundColor: t.color + "18", borderColor: t.color }]} testID={`bac-type-${t.id}`}>
            <Text style={{ fontSize: 14 }}>{t.emoji}</Text>
            <Text style={[styles.typeTxt, on && { color: t.color }]}>{t.label}</Text>
            <Text style={[styles.typeCount, on && { color: t.color }]}>{counts(t.id)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Pill({ on, color, label, onPress, testID }: { on: boolean; color: string; label: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable onPress={onPress} testID={testID} style={[styles.pill, { borderColor: on ? color : theme.color.border, backgroundColor: on ? color + "18" : theme.color.surfaceSecondary }]}>
      <Ionicons name={on ? "checkbox" : "square-outline"} size={16} color={on ? color : theme.color.muted} />
      <Text style={[styles.pillTxt, { color: on ? color : theme.color.onSurface, fontWeight: on ? "700" : "500" }]}>{label}</Text>
    </Pressable>
  );
}

function ChipList({ items, onRemove, empty }: { items: string[]; onRemove: (v: string) => void; empty: string }) {
  if (!items.length) return empty ? <Text style={styles.hint}>{empty}</Text> : null;
  return (
    <View style={[styles.pillWrap, { marginBottom: 8 }]}>
      {items.map((p) => (
        <View key={p} style={styles.chip}>
          <Ionicons name="sparkles" size={13} color={ACCENT} />
          <Text style={styles.chipTxt}>{p}</Text>
          <Pressable onPress={() => onRemove(p)} hitSlop={6} testID={`bac-chip-remove-${p}`}>
            <Ionicons name="close-circle" size={15} color={ACCENT} />
          </Pressable>
        </View>
      ))}
    </View>
  );
}

function AddRow({ value, onChange, onAdd, placeholder, testID }: { value: string; onChange: (v: string) => void; onAdd: () => void; placeholder: string; testID: string }) {
  return (
    <View style={{ flexDirection: "row", gap: 8, alignItems: "center", marginTop: 6 }}>
      <TextInput
        testID={`${testID}-input`}
        value={value}
        onChangeText={onChange}
        onSubmitEditing={onAdd}
        placeholder={placeholder}
        placeholderTextColor={theme.color.muted}
        style={styles.input}
      />
      <Pressable onPress={onAdd} disabled={!value.trim()} testID={`${testID}-add`} style={[styles.addBtn, { backgroundColor: value.trim() ? ACCENT : theme.color.borderStrong }]}>
        <Ionicons name="add" size={16} color="#FFF" />
        <Text style={styles.addTxt}>Aggiungi</Text>
      </Pressable>
    </View>
  );
}

function RadioCard({ on, title, desc, onPress, testID }: { on: boolean; title: string; desc?: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable onPress={onPress} testID={testID} style={[styles.radioCard, on && { borderColor: ACCENT, backgroundColor: "#F5F3FF" }]}>
      <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={20} color={on ? ACCENT : theme.color.muted} />
      <View style={{ flex: 1, marginLeft: 10 }}>
        <Text style={[styles.sectionTitle, on && { color: ACCENT }]}>{title}</Text>
        {!!desc && <Text style={styles.sectionDesc}>{desc}</Text>}
      </View>
    </Pressable>
  );
}

function FreeText({ value, onChange, placeholder, testID, tall }: { value: string; onChange: (v: string) => void; placeholder: string; testID: string; tall?: boolean }) {
  return (
    <View style={{ gap: 8 }}>
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.color.muted}
        multiline
        style={[styles.textArea, tall && { minHeight: 160 }]}
      />
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flex: 1 }}>
          <VoiceDictationButton compact label="Detta" testID={`${testID}-mic`} onTranscript={(t) => onChange((value ? value + " " : "") + t)} />
        </View>
        <Text style={styles.hint}>{value.length}/3000</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bigBtn: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: ACCENT, borderRadius: 14, padding: 12, marginBottom: 14, minHeight: 60, shadowColor: ACCENT, shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  bigBtnIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" },
  bigBtnTitle: { color: "#FFF", fontSize: 15, fontWeight: "800" },
  bigBtnSub: { color: "#EDE9FE", fontSize: 11, marginTop: 2 },
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10 },
  title: { fontSize: 18, fontWeight: "800", color: theme.color.onSurface },
  subtitle: { fontSize: 11, color: theme.color.muted, marginTop: 1 },
  resetBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, backgroundColor: theme.color.surfaceTertiary },
  resetTxt: { fontSize: 12, fontWeight: "700", color: theme.color.muted },
  tabs: { flexDirection: "row", marginHorizontal: 16, marginBottom: 4, backgroundColor: "#F3E8FF", borderRadius: 12, padding: 4, gap: 4 },
  tab: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 10 },
  tabOn: { backgroundColor: ACCENT },
  tabTxt: { fontSize: 13, fontWeight: "700", color: ACCENT },
  tabTxtOn: { color: "#FFF" },
  infoBox: { flexDirection: "row", gap: 8, backgroundColor: "#F5F3FF", borderRadius: 12, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: "#DDD6FE" },
  infoTxt: { flex: 1, fontSize: 12, color: "#4C1D95", lineHeight: 17 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  sectionLabel: { fontSize: 12, fontWeight: "800", color: theme.color.muted, marginBottom: 8, letterSpacing: 0.4 },
  linkTxt: { fontSize: 12, fontWeight: "700", color: ACCENT },
  typeRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  typeBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surfaceSecondary },
  typeTxt: { fontSize: 13, fontWeight: "700", color: theme.color.onSurface },
  typeCount: { fontSize: 11, fontWeight: "600", color: theme.color.muted },
  pillWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 20, borderWidth: 1, minHeight: 36 },
  pillTxt: { fontSize: 12 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 20, backgroundColor: "#F3E8FF", borderWidth: 1, borderColor: ACCENT },
  chipTxt: { fontSize: 12, color: "#5B21B6", fontWeight: "700" },
  input: { flex: 1, backgroundColor: theme.color.surfaceSecondary, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: theme.color.border, fontSize: 13, color: theme.color.onSurface, minHeight: 44 },
  addBtn: { paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10, flexDirection: "row", alignItems: "center", gap: 4, minHeight: 44 },
  addTxt: { color: "#FFF", fontWeight: "700", fontSize: 12 },
  card: { backgroundColor: theme.color.surfaceSecondary, borderRadius: 12, borderWidth: 1, borderColor: theme.color.border, paddingHorizontal: 12 },
  sectionRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, minHeight: 48 },
  sectionTitle: { fontSize: 14, fontWeight: "700", color: theme.color.onSurface },
  sectionDesc: { fontSize: 11, color: theme.color.muted, marginTop: 2 },
  radioCard: { flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surfaceSecondary, minHeight: 52 },
  styleCard: { width: "48%", flexGrow: 1, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surfaceSecondary, gap: 6, position: "relative" },
  swatch: { width: 18, height: 18, borderRadius: 5 },
  styleTitle: { fontSize: 13, fontWeight: "800", color: theme.color.onSurface },
  styleDesc: { fontSize: 11, color: theme.color.muted },
  textArea: { backgroundColor: theme.color.surfaceSecondary, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "#DDD6FE", minHeight: 110, textAlignVertical: "top", color: theme.color.onSurface, fontSize: 13, lineHeight: 19 },
  hint: { fontSize: 11, color: theme.color.muted, marginTop: 6, lineHeight: 15 },
  footer: { flexDirection: "row", gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: theme.color.border, backgroundColor: theme.color.surfaceSecondary },
  cancelBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: theme.color.surfaceTertiary, alignItems: "center", justifyContent: "center", minHeight: 48 },
  cancelTxt: { color: theme.color.onSurface, fontWeight: "700", fontSize: 14 },
  saveBtn: { flex: 2, paddingVertical: 14, borderRadius: 12, backgroundColor: ACCENT, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, minHeight: 48 },
  saveTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
});

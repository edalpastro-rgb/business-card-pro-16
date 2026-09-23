// BillAnalysisConfigModal.tsx — Pannello «Configura Analisi Fatture»
// Accessibile dal Master (Analizza bolletta) e dalla scheda cliente (tab Fatture).
// 3 sezioni: Campi estrazione · Analisi comparativa · Richieste manuali. Tutto salvato per tenant (PUT /bills/analysis-config).
import React, { useEffect, useMemo, useState } from "react";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium
import { View, Text, StyleSheet, Pressable, ScrollView, Modal, TextInput, ActivityIndicator, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/src/theme";
import { notify, confirmAsync } from "@/src/utils/notify";
import { VoiceDictationButton } from "@/src/VoiceDictationButton";
import { useSafeBottom } from "@/src/hooks/useSafeBottom";
import { ComparisonPreview, SAMPLE_COMPARISON_REPORT } from "@/src/ComparisonPreview";
import {
  BAType, BillAnalysisBundle, BillAnalysisConfig, BACatalogItem, BAPreset,
  loadBillAnalysisConfig, saveBillAnalysisConfig, resetBillAnalysisConfig, savePreset, deletePreset, labelsFor,
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

export type PreviewBuilder = (rep: any, cfg: { layout?: string; style?: string; sections?: Record<string, boolean> }) => string;

type Props = { visible: boolean; onClose: () => void; onSaved?: (bundle: BillAnalysisBundle) => void; previewBuilder?: PreviewBuilder };

export function BillAnalysisConfigModal({ visible, onClose, onSaved, previewBuilder }: Props) {
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
  // V50.z252 — Preset salvati
  const [loadedPresetId, setLoadedPresetId] = useState<string | null>(null);
  const [presetNameOpen, setPresetNameOpen] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [presetBusy, setPresetBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    setPresetNameOpen(false);
    setPresetName("");
    loadBillAnalysisConfig()
      .then((b) => { setBundle(b); setCfg(b.config); setLoadedPresetId(b.active_preset_id || null); })
      .catch((e: any) => notify("Errore", e?.message || "Impossibile caricare la configurazione"))
      .finally(() => setLoading(false));
  }, [visible]);

  const catalog = bundle?.catalog;
  const presets: BAPreset[] = bundle?.presets || [];
  const typeMeta = useMemo(() => TYPES.find((t) => t.id === bt)!, [bt]);
  const cmpTypeMeta = useMemo(() => TYPES.find((t) => t.id === cmpBt)!, [cmpBt]);
  const previewHtml = useMemo(
    () => (previewBuilder && cfg ? previewBuilder(SAMPLE_COMPARISON_REPORT, cfg.comparison) : ""),
    [previewBuilder, cfg],
  );

  // Ogni modifica manuale "scollega" il preset caricato (il salvataggio non sarà più attribuito a quel preset)
  const update = (fn: (c: BillAnalysisConfig) => BillAnalysisConfig) => { setLoadedPresetId(null); setCfg((c) => (c ? fn(c) : c)); };

  const loadPreset = (p: BAPreset) => {
    setCfg(p.config);
    setLoadedPresetId(p.preset_id);
  };

  const doSavePreset = async () => {
    const name = presetName.trim();
    if (!name || !cfg) return;
    try {
      setPresetBusy(true);
      const r = await savePreset(name, cfg);
      setBundle((b) => (b ? { ...b, presets: r.items } : b));
      setLoadedPresetId(r.preset.preset_id);
      setPresetNameOpen(false);
      setPresetName("");
      notify("Preset salvato", `«${r.preset.name}» è pronto: potrai richiamarlo con un tap prima di ogni analisi.`);
    } catch (e: any) {
      notify("Errore", e?.message || "");
    } finally {
      setPresetBusy(false);
    }
  };

  const doDeletePreset = async (p: BAPreset) => {
    if (!(await confirmAsync(`Eliminare il preset «${p.name}»?`, "La configurazione attiva non cambia."))) return;
    try {
      setPresetBusy(true);
      const r = await deletePreset(p.preset_id);
      setBundle((b) => (b ? { ...b, presets: r.items, active_preset_id: b.active_preset_id === p.preset_id ? null : b.active_preset_id } : b));
      if (loadedPresetId === p.preset_id) setLoadedPresetId(null);
    } catch (e: any) {
      notify("Errore", e?.message || "");
    } finally {
      setPresetBusy(false);
    }
  };

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
      const b = await saveBillAnalysisConfig(cfg, loadedPresetId);
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
    if (!(await confirmAsync("Ripristinare i predefiniti?", "Tutte le spunte, i campi personalizzati e le richieste manuali torneranno ai valori iniziali. I preset salvati restano."))) return;
    try {
      setSaving(true);
      const b = await resetBillAnalysisConfig();
      setBundle(b);
      setCfg(b.config);
      setLoadedPresetId(null);
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
            <Ionicons name="close" size={26} color={HT.text} />
          </Pressable>
          <View style={{ flex: 1, marginLeft: 8 }}>
            <Text style={styles.title}>Configura Analisi Fatture</Text>
            <Text style={styles.subtitle}>Valido per Master e schede cliente</Text>
          </View>
          <Pressable onPress={reset} hitSlop={8} disabled={saving || !cfg} testID="bac-reset" style={styles.resetBtn}>
            <Ionicons name="refresh" size={16} color={HT.muted} />
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
            {/* V50.z252 — Preset salvati */}
            <View style={styles.presetBox}>
              <View style={styles.rowBetween}>
                <Text style={styles.sectionLabel}>PRESET SALVATI</Text>
                <Pressable onPress={() => setPresetNameOpen((v) => !v)} style={styles.presetAddBtn} testID="bac-preset-new">
                  <Ionicons name={presetNameOpen ? "chevron-up" : "bookmark"} size={14} color={ACCENT} />
                  <Text style={styles.linkTxt}>{presetNameOpen ? "Chiudi" : "Salva come preset"}</Text>
                </Pressable>
              </View>
              {presetNameOpen && (
                <View style={{ flexDirection: "row", gap: 8, alignItems: "center", marginBottom: 10 }}>
                  <TextInput
                    testID="bac-preset-name-input"
                    value={presetName}
                    onChangeText={setPresetName}
                    onSubmitEditing={doSavePreset}
                    placeholder="Nome preset (es. Domestico, Business)…"
                    placeholderTextColor={HT.muted}
                    maxLength={40}
                    style={styles.input}
                  />
                  <Pressable onPress={doSavePreset} disabled={!presetName.trim() || presetBusy} testID="bac-preset-save" style={[styles.addBtn, { backgroundColor: presetName.trim() ? ACCENT : theme.color.borderStrong }]}>
                    {presetBusy ? <ActivityIndicator color="#FFF" size="small" /> : <Ionicons name="checkmark" size={16} color="#FFF" />}
                    <Text style={styles.addTxt}>Salva</Text>
                  </Pressable>
                </View>
              )}
              {presets.length === 0 ? (
                <Text style={styles.hint}>Nessun preset: configura le spunte e premi «Salva come preset» per richiamarle con un tap prima di ogni analisi.</Text>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
                  {presets.map((p) => {
                    const loaded = loadedPresetId === p.preset_id;
                    const active = bundle?.active_preset_id === p.preset_id;
                    return (
                      <Pressable key={p.preset_id} onPress={() => loadPreset(p)} testID={`bac-preset-${p.preset_id}`} style={[styles.presetChip, loaded && styles.presetChipOn]}>
                        <Ionicons name={active ? "bookmark" : "bookmark-outline"} size={14} color={loaded ? "#FFF" : ACCENT} />
                        <Text style={[styles.presetTxt, loaded && { color: "#FFF" }]} numberOfLines={1}>{p.name}</Text>
                        {active && <Text style={[styles.presetActive, loaded && { color: "#EDE9FE" }]}>attivo</Text>}
                        <Pressable onPress={() => doDeletePreset(p)} hitSlop={8} testID={`bac-preset-del-${p.preset_id}`}>
                          <Ionicons name="close-circle" size={16} color={loaded ? "#EDE9FE" : HT.muted} />
                        </Pressable>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              )}
              {loadedPresetId && bundle?.active_preset_id !== loadedPresetId && (
                <Text style={[styles.hint, { color: ACCENT, fontWeight: "700" }]}>Preset caricato nel pannello: premi «Salva configurazione» per renderlo attivo.</Text>
              )}
            </View>

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
                          <View style={[styles.swatch, { backgroundColor: s.bg || "#FFF", borderWidth: 1, borderColor: HT.border }]} />
                          <View style={[styles.swatch, { backgroundColor: s.accent || "#888" }]} />
                        </View>
                        <Text style={styles.styleTitle}>{s.label}</Text>
                        <Text style={styles.styleDesc}>{s.desc}</Text>
                        {on && <Ionicons name="checkmark-circle" size={16} color={ACCENT} style={{ position: "absolute", top: 6, right: 6 }} />}
                      </Pressable>
                    );
                  })}
                </View>

                {!!previewHtml && (
                  <>
                    <Text style={[styles.sectionLabel, { marginTop: 18 }]}>ANTEPRIMA DEL PDF COMPARATIVO</Text>
                    <ComparisonPreview html={previewHtml} layout={cfg.comparison.layout} height={320} testID="bac-preview" />
                    <Text style={styles.hint}>Scorri l&apos;anteprima per vedere tutte le pagine. Si aggiorna automaticamente cambiando stile, modello grafico e sezioni.</Text>
                  </>
                )}

                <Text style={[styles.sectionLabel, { marginTop: 18 }]}>SEZIONI DA MOSTRARE</Text>
                <View style={styles.card}>
                  {catalog.sections.map((s, i) => {
                    const on = cfg.comparison.sections[s.id] ?? true;
                    return (
                      <Pressable key={s.id} onPress={() => toggleSection(s.id)} style={[styles.sectionRow, i > 0 && { borderTopWidth: 1, borderTopColor: HT.border }]} testID={`bac-section-${s.id}`}>
                        <Ionicons name={on ? "checkbox" : "square-outline"} size={22} color={on ? ACCENT : HT.muted} />
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

/** Riga «Preset rapidi» nel popup parametri di ogni analisi: un tap applica le spunte del preset (o della configurazione attiva). */
export function PresetQuickRow({ bundle, bt, color, onApply }: { bundle: BillAnalysisBundle | null; bt: BAType; color: string; onApply: (sel: { labels: string[]; custom: string[] }) => void }) {
  const [picked, setPicked] = useState<string>("__active__");
  if (!bundle || !bundle.presets?.length) return null;
  const items = [{ preset_id: "__active__", name: "Configurazione attiva", config: bundle.config } as BAPreset, ...bundle.presets];
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={styles.sectionLabel}>PRESET RAPIDI</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {items.map((p) => {
          const on = picked === p.preset_id;
          return (
            <Pressable
              key={p.preset_id}
              testID={`preset-quick-${p.preset_id}`}
              onPress={() => { setPicked(p.preset_id); onApply(labelsFor(p.config, bundle.catalog, bt)); }}
              style={[styles.presetChip, { borderColor: color, backgroundColor: on ? color : color + "14" }]}
            >
              <Ionicons name={p.preset_id === "__active__" ? "flash" : "bookmark"} size={14} color={on ? "#FFF" : color} />
              <Text style={[styles.presetTxt, { color: on ? "#FFF" : color }]} numberOfLines={1}>{p.name}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
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
    <Pressable onPress={onPress} testID={testID} style={[styles.pill, { borderColor: on ? color : HT.border, backgroundColor: on ? color + "18" : HT.card2 }]}>
      <Ionicons name={on ? "checkbox" : "square-outline"} size={16} color={on ? color : HT.muted} />
      <Text style={[styles.pillTxt, { color: on ? color : HT.text, fontWeight: on ? "700" : "500" }]}>{label}</Text>
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
        placeholderTextColor={HT.muted}
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
    <Pressable onPress={onPress} testID={testID} style={[styles.radioCard, on && { borderColor: ACCENT, backgroundColor: HT.violetTint }]}>
      <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={20} color={on ? ACCENT : HT.muted} />
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
        placeholderTextColor={HT.muted}
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
  root: { flex: 1, backgroundColor: HT.card2 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10 },
  title: { fontSize: 18, fontWeight: "800", color: HT.text },
  subtitle: { fontSize: 11, color: HT.muted, marginTop: 1 },
  resetBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, backgroundColor: HT.card2 },
  resetTxt: { fontSize: 12, fontWeight: "700", color: HT.muted },
  tabs: { flexDirection: "row", marginHorizontal: 16, marginBottom: 4, backgroundColor: '#F3E8FF', borderRadius: 12, padding: 4, gap: 4 },
  tab: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 10 },
  tabOn: { backgroundColor: ACCENT },
  tabTxt: { fontSize: 13, fontWeight: "700", color: ACCENT },
  tabTxtOn: { color: "#FFF" },
  infoBox: { flexDirection: "row", gap: 8, backgroundColor: HT.violetTint, borderRadius: 12, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: HT.violet + '66' },
  infoTxt: { flex: 1, fontSize: 12, color: HT.violet, lineHeight: 17 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  sectionLabel: { fontSize: 12, fontWeight: "800", color: HT.muted, marginBottom: 8, letterSpacing: 0.4 },
  linkTxt: { fontSize: 12, fontWeight: "700", color: ACCENT },
  typeRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  typeBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: HT.border, backgroundColor: HT.card2 },
  typeTxt: { fontSize: 13, fontWeight: "700", color: HT.text },
  typeCount: { fontSize: 11, fontWeight: "600", color: HT.muted },
  pillWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 20, borderWidth: 1, minHeight: 36 },
  pillTxt: { fontSize: 12 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 20, backgroundColor: '#F3E8FF', borderWidth: 1, borderColor: ACCENT },
  chipTxt: { fontSize: 12, color: HT.violet, fontWeight: "700" },
  input: { flex: 1, backgroundColor: HT.card2, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: HT.border, fontSize: 13, color: HT.text, minHeight: 44 },
  addBtn: { paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10, flexDirection: "row", alignItems: "center", gap: 4, minHeight: 44 },
  addTxt: { color: "#FFF", fontWeight: "700", fontSize: 12 },
  card: { backgroundColor: HT.card2, borderRadius: 12, borderWidth: 1, borderColor: HT.border, paddingHorizontal: 12 },
  sectionRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, minHeight: 48 },
  sectionTitle: { fontSize: 14, fontWeight: "700", color: HT.text },
  sectionDesc: { fontSize: 11, color: HT.muted, marginTop: 2 },
  radioCard: { flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 12, borderWidth: 1, borderColor: HT.border, backgroundColor: HT.card2, minHeight: 52 },
  styleCard: { width: "48%", flexGrow: 1, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: HT.border, backgroundColor: HT.card2, gap: 6, position: "relative" },
  swatch: { width: 18, height: 18, borderRadius: 5 },
  styleTitle: { fontSize: 13, fontWeight: "800", color: HT.text },
  styleDesc: { fontSize: 11, color: HT.muted },
  textArea: { backgroundColor: HT.card2, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: HT.violet + '66', minHeight: 110, textAlignVertical: "top", color: HT.text, fontSize: 13, lineHeight: 19 },
  hint: { fontSize: 11, color: HT.muted, marginTop: 6, lineHeight: 15 },
  presetBox: { backgroundColor: HT.card2, borderRadius: 12, borderWidth: 1, borderColor: HT.border, padding: 12, marginBottom: 14 },
  presetAddBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 4, paddingHorizontal: 6, marginBottom: 8 },
  presetChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: ACCENT, backgroundColor: HT.violetTint, minHeight: 38, maxWidth: 220 },
  presetChipOn: { backgroundColor: ACCENT },
  presetTxt: { fontSize: 13, fontWeight: "700", color: HT.violet, flexShrink: 1 },
  presetActive: { fontSize: 10, fontWeight: "700", color: ACCENT, textTransform: "uppercase" },
  footer: { flexDirection: "row", gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: HT.border, backgroundColor: HT.card2 },
  cancelBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: HT.card2, alignItems: "center", justifyContent: "center", minHeight: 48 },
  cancelTxt: { color: HT.text, fontWeight: "700", fontSize: 14 },
  saveBtn: { flex: 2, paddingVertical: 14, borderRadius: 12, backgroundColor: ACCENT, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, minHeight: 48 },
  saveTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
});

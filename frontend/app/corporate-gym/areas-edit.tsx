// areas-edit.tsx — V50.z408 — «MODIFICA AREE» del Corporate Gym (solo Master / Super Master): un'unica schermata al posto delle
// matite sulle card. Per ogni area: nome, descrizione, icona dalla libreria (colori accattivanti) oppure immagine caricata
// (galleria / file / Drive), BLOCCHI della trattativa (aggiungi, rinomina, riordina ↑↓, elimina — ogni blocco = una parte
// cronologica del manuale), salva; elimina (solo aree non predefinite); «Nuova area» in fondo.
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, Image, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { KScrollView } from "@/src/ui/keyboard";
import { notify } from "@/src/utils/notify";
import { pickImages } from "@/src/image-picker";
import { cgaApi, CgaArea } from "@/src/corporate-gym/areasApi";
import { AREA_ICON_LIBRARY } from "@/src/corporate-gym/areaIcons";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { HT } from "@/src/homeTheme";

type Draft = { name: string; description: string; blocks: string[]; icon: string | null; color: string; logo: string | null; dirty: boolean };
const toDraft = (a: CgaArea): Draft => ({ name: a.name, description: a.description || "", blocks: [...(a.blocks || [])], icon: a.icon || null, color: a.color, logo: null, dirty: false });
const NEW_ID = "__new__";

export default function AreasEditScreen() {
  const router = useRouter();
  const pad = usePageBottomPadding();
  const [areas, setAreas] = useState<CgaArea[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [master, setMaster] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [iconPickerFor, setIconPickerFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await cgaApi.areas(); setAreas(r.items); setMaster(r.is_master);
      setDrafts((d) => Object.fromEntries(r.items.map((a) => [a.area_id, d[a.area_id]?.dirty ? d[a.area_id] : toDraft(a)])));
    } catch (e: any) { notify(e?.message || "Aree non disponibili"); setMaster(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const patch = (id: string, fn: (d: Draft) => Draft) => setDrafts((all) => ({ ...all, [id]: { ...fn(all[id]), dirty: true } }));
  const pickLogo = async (id: string) => {
    const res = await pickImages({ multiple: false, quality: 0.7, allowsEditing: true, aspect: [1, 1] });
    const f = res[0]; if (!f) return;
    const uri = f.base64 ? `data:${f.mimeType || "image/jpeg"};base64,${f.base64}` : f.uri?.startsWith("data:") ? f.uri : null;
    if (uri) patch(id, (d) => ({ ...d, logo: uri, icon: null }));
  };
  const save = async (id: string) => {
    const d = drafts[id]; if (!d) return;
    if (d.name.trim().length < 2) { notify("Nome troppo corto"); return; }
    const blocks = d.blocks.map((b) => b.trim()).filter(Boolean);
    if (!blocks.length) { notify("Serve almeno un blocco"); return; }
    setBusy(id);
    try {
      const body = { name: d.name.trim(), description: d.description.trim(), blocks, color: d.color, icon: d.icon, ...(d.logo ? { logo_b64: d.logo } : {}) };
      if (id === NEW_ID) { await cgaApi.create(body); setDrafts((all) => { const { [NEW_ID]: _n, ...rest } = all; return rest; }); }
      else await cgaApi.update(id, body);
      await load(); notify("Area salvata");
    } catch (e: any) { notify(e?.message || "Salvataggio non riuscito"); } finally { setBusy(null); }
  };
  const remove = (a: CgaArea) => {
    const go = async () => { setBusy(a.area_id); try { await cgaApi.remove(a.area_id); await load(); notify("Area eliminata"); } catch (e: any) { notify(e?.message || "Eliminazione non riuscita"); } finally { setBusy(null); } };
    Alert.alert("Eliminare l'area?", `«${a.name}» e le sue sessioni non saranno più visibili.`, [{ text: "Annulla", style: "cancel" }, { text: "Elimina", style: "destructive", onPress: go }]);
  };
  const addNew = () => setDrafts((all) => ({ ...all, [NEW_ID]: { name: "", description: "", blocks: ["Apertura"], icon: "barbell", color: "#7C3AED", logo: null, dirty: true } }));

  const renderPreview = (a: CgaArea | null, d: Draft) => {
    const src = d.logo || (a?.logo_b64 && !d.icon ? (a.logo_b64.startsWith("data:") ? a.logo_b64 : `data:image/png;base64,${a.logo_b64}`) : null);
    if (src) return <Image source={{ uri: src }} style={s.preview} resizeMode="cover" />;
    return <View style={[s.preview, { backgroundColor: d.color + "22", alignItems: "center", justifyContent: "center" }]}><Ionicons name={(d.icon as any) || "barbell"} size={30} color={d.color} /></View>;
  };

  const renderArea = (id: string, a: CgaArea | null) => {
    const d = drafts[id]; if (!d) return null;
    const saving = busy === id;
    return (
      <View key={id} style={s.card} testID={`areas-edit-card-${a?.key || "new"}`}>
        <View style={s.headRow}>
          {renderPreview(a, d)}
          <View style={{ flex: 1, gap: 6 }}>
            <TextInput value={d.name} onChangeText={(v) => patch(id, (x) => ({ ...x, name: v }))} placeholder="Nome area" placeholderTextColor={HT.muted} style={s.input} testID={`areas-edit-name-${a?.key || "new"}`} />
            <TextInput value={d.description} onChangeText={(v) => patch(id, (x) => ({ ...x, description: v }))} placeholder="Descrizione breve (sotto il nome)" placeholderTextColor={HT.muted} style={[s.input, { fontSize: 13 }]} />
          </View>
        </View>
        <View style={s.rowBtns}>
          <Pressable onPress={() => setIconPickerFor(iconPickerFor === id ? null : id)} style={s.smallBtn} testID={`areas-edit-icon-${a?.key || "new"}`}><Ionicons name="color-palette-outline" size={16} color={HT.violet} /><Text style={s.smallTxt}>Icona</Text></Pressable>
          <Pressable onPress={() => pickLogo(id)} style={s.smallBtn} testID={`areas-edit-logo-${a?.key || "new"}`}><Ionicons name="image-outline" size={16} color={HT.violet} /><Text style={s.smallTxt}>Carica immagine</Text></Pressable>
          {a && !a.builtin ? <Pressable onPress={() => remove(a)} style={[s.smallBtn, { borderColor: HT.danger + "66" }]} testID={`areas-edit-delete-${a.key}`}><Ionicons name="trash-outline" size={16} color={HT.danger} /><Text style={[s.smallTxt, { color: HT.danger }]}>Elimina</Text></Pressable> : null}
        </View>
        {iconPickerFor === id ? (
          <View style={s.iconGrid} testID="areas-edit-icon-grid">
            {AREA_ICON_LIBRARY.map((it) => (
              <Pressable key={it.icon as string} onPress={() => { patch(id, (x) => ({ ...x, icon: it.icon as string, color: it.color, logo: null })); setIconPickerFor(null); }} style={[s.iconCell, d.icon === it.icon && { borderColor: it.color, borderWidth: 2 }]} testID={`areas-edit-pick-${it.icon}`}>
                <View style={[s.iconBubble, { backgroundColor: it.color + "22" }]}><Ionicons name={it.icon} size={22} color={it.color} /></View>
                <Text style={s.iconLbl} numberOfLines={1}>{it.label}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <Text style={s.label}>Blocchi della trattativa · in ordine cronologico rispetto al manuale</Text>
        {d.blocks.map((b, i) => (
          <View key={i} style={s.blockRow}>
            <Text style={s.blockNum}>{i + 1}</Text>
            <TextInput value={b} onChangeText={(v) => patch(id, (x) => ({ ...x, blocks: x.blocks.map((y, j) => (j === i ? v : y)) }))} placeholder={`Blocco ${i + 1}`} placeholderTextColor={HT.muted} style={[s.input, { flex: 1 }]} testID={`areas-edit-block-${a?.key || "new"}-${i}`} />
            <Pressable disabled={i === 0} onPress={() => patch(id, (x) => { const b2 = [...x.blocks]; [b2[i - 1], b2[i]] = [b2[i], b2[i - 1]]; return { ...x, blocks: b2 }; })} style={[s.iconBtn, i === 0 && { opacity: 0.3 }]}><Ionicons name="chevron-up" size={18} color={HT.text} /></Pressable>
            <Pressable disabled={i === d.blocks.length - 1} onPress={() => patch(id, (x) => { const b2 = [...x.blocks]; [b2[i + 1], b2[i]] = [b2[i], b2[i + 1]]; return { ...x, blocks: b2 }; })} style={[s.iconBtn, i === d.blocks.length - 1 && { opacity: 0.3 }]}><Ionicons name="chevron-down" size={18} color={HT.text} /></Pressable>
            <Pressable onPress={() => patch(id, (x) => ({ ...x, blocks: x.blocks.filter((_, j) => j !== i) }))} style={s.iconBtn}><Ionicons name="close" size={18} color={HT.danger} /></Pressable>
          </View>
        ))}
        <Pressable onPress={() => patch(id, (x) => ({ ...x, blocks: [...x.blocks, ""] }))} style={s.addBlock} testID={`areas-edit-add-block-${a?.key || "new"}`}><Ionicons name="add" size={18} color={HT.violet} /><Text style={s.smallTxt}>Aggiungi blocco</Text></Pressable>

        <Pressable onPress={() => save(id)} disabled={saving || !d.dirty} style={[s.saveBtn, (!d.dirty || saving) && { opacity: 0.45 }]} testID={`areas-edit-save-${a?.key || "new"}`}>
          {saving ? <ActivityIndicator color="#FFF" /> : <><Ionicons name="save-outline" size={18} color="#FFF" /><Text style={s.saveTxt}>{id === NEW_ID ? "Crea area" : "Salva modifiche"}</Text></>}
        </Pressable>
      </View>
    );
  };

  return (
    <SafeAreaView style={s.root} edges={["top"]}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} testID="areas-edit-back"><Ionicons name="chevron-back" size={24} color={HT.text} /></Pressable>
        <View style={{ flex: 1 }}><Text style={s.title}>Modifica aree</Text><Text style={s.sub}>Nomi, icone, immagini e blocchi del Corporate Gym</Text></View>
      </View>
      {master === null ? <ActivityIndicator color={HT.violet} style={{ marginTop: 30 }} /> : !master ? (
        <View style={s.center}><Ionicons name="lock-closed-outline" size={36} color={HT.muted} /><Text style={s.sub}>Sezione riservata al Master</Text></View>
      ) : (
        <KScrollView contentContainerStyle={{ padding: 14, gap: 14, paddingBottom: pad }}>
          {areas.map((a) => renderArea(a.area_id, a))}
          {drafts[NEW_ID] ? renderArea(NEW_ID, null) : (
            <Pressable onPress={addNew} style={s.newBtn} testID="areas-edit-new"><Ionicons name="add-circle-outline" size={22} color={HT.violet} /><Text style={[s.smallTxt, { fontSize: 15 }]}>Nuova area</Text></Pressable>
          )}
        </KScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: HT.bg },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: HT.border, backgroundColor: HT.card },
  title: { fontSize: 17, fontWeight: "900", color: HT.text }, sub: { fontSize: 12, color: HT.muted },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  card: { backgroundColor: HT.card, borderRadius: 16, borderWidth: 1, borderColor: HT.border, padding: 14, gap: 10 },
  headRow: { flexDirection: "row", gap: 12, alignItems: "center" },
  preview: { width: 72, height: 72, borderRadius: 18 },
  input: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: HT.border, backgroundColor: HT.card2, color: HT.text, paddingHorizontal: 12, fontSize: 15 },
  rowBtns: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  smallBtn: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 40, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: HT.violet + "66", backgroundColor: HT.violetTint },
  smallTxt: { color: HT.violet, fontWeight: "800", fontSize: 13 },
  iconGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  iconCell: { width: "22%", alignItems: "center", gap: 4, padding: 6, borderRadius: 14, borderWidth: 1, borderColor: HT.border, backgroundColor: HT.card2 },
  iconBubble: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  iconLbl: { fontSize: 10, color: HT.muted, fontWeight: "700" },
  label: { fontSize: 11, fontWeight: "800", color: HT.muted, textTransform: "uppercase", letterSpacing: 0.4, marginTop: 4 },
  blockRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  blockNum: { width: 22, textAlign: "center", color: HT.muted, fontWeight: "900" },
  iconBtn: { width: 36, height: 44, alignItems: "center", justifyContent: "center" },
  addBlock: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 40, alignSelf: "flex-start", paddingHorizontal: 8 },
  saveBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 48, borderRadius: 14, backgroundColor: HT.violet },
  saveTxt: { color: "#FFF", fontWeight: "800" },
  newBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 56, borderRadius: 16, borderWidth: 1, borderStyle: "dashed", borderColor: HT.violet + "88", backgroundColor: HT.violetTint },
});

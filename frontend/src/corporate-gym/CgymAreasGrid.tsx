// CgymAreasGrid.tsx — V50.z365 — griglia AREE dinamiche del Corporate Gym (stesso modello visivo: card immagine/logo, nome,
// stato sessioni). Master: pressione lunga o matita → rinomina + logo; «+ Nuova area». Tap → rotta storica (Obiezioni/WIN-WIN)
// oppure pagina area (/corporate-gym/area/[id]).
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Image, Modal, TextInput, ActivityIndicator } from "react-native";
import { KScrollView, KModalBody } from "@/src/ui/keyboard"; // V50.z374/z387 — tastiera: campo attivo sempre visibile (anche nella Modal Android)
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { notify } from "@/src/utils/notify";
import { pickImages } from "@/src/image-picker";
import { cgaApi, CgaArea, RATING_COLOR } from "@/src/corporate-gym/areasApi";
import { HT } from "@/src/homeTheme";

export function CgymAreaLogo({ a, size = 84 }: { a: CgaArea; size?: number }) {
  const src = a.logo_b64 ? (a.logo_b64.startsWith("data:") ? a.logo_b64 : `data:image/png;base64,${a.logo_b64}`) : a.image;
  if (src) return <Image source={{ uri: src }} style={{ width: size, height: size, borderRadius: 18 }} resizeMode="cover" />;
  return (
    <View style={{ width: size, height: size, borderRadius: 18, backgroundColor: a.color + "22", alignItems: "center", justifyContent: "center" }}>
      <Ionicons name="barbell" size={size * 0.42} color={a.color} />
    </View>
  );
}

export function CgymAreasGrid({ pendingByKey }: { pendingByKey?: Record<string, number> }) {
  const router = useRouter();
  const [areas, setAreas] = useState<CgaArea[]>([]);
  const [master, setMaster] = useState(false);
  const [edit, setEdit] = useState<{ a: CgaArea | null; name: string; logo: string | null; blocks: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { const r = await cgaApi.areas(); setAreas(r.items); setMaster(r.is_master); } catch { /* offline */ }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const open = (a: CgaArea) => router.push(`/corporate-gym/area/${a.area_id}` as any); // V50.z400 — STRUTTURA UNICA: anche Obiezioni e WIN-WIN aprono la pagina area (come ANT)
  const startEdit = (a: CgaArea | null) => setEdit({ a, name: a?.name || "", logo: null, blocks: (a?.blocks || []).join("\n") });
  const pickLogo = async () => {
    const res = await pickImages({ multiple: false, quality: 0.7, allowsEditing: true, aspect: [1, 1] });
    const first = res[0];
    if (first?.base64) setEdit((e) => e && { ...e, logo: `data:${first.mimeType || "image/jpeg"};base64,${first.base64}` });
    else if (first?.uri?.startsWith("data:")) setEdit((e) => e && { ...e, logo: first.uri });
  };
  const save = async () => {
    if (!edit || busy) return;
    if (edit.name.trim().length < 2) { notify("Nome troppo corto"); return; }
    setBusy(true);
    try {
      const blocks = edit.blocks.split("\n").map((s) => s.trim()).filter(Boolean);
      if (edit.a) await cgaApi.update(edit.a.area_id, { name: edit.name.trim(), blocks, ...(edit.logo ? { logo_b64: edit.logo } : {}) });
      else await cgaApi.create({ name: edit.name.trim(), blocks, ...(edit.logo ? { logo_b64: edit.logo } : {}) });
      setEdit(null); await load(); notify("Area salvata");
    } catch (e: any) { notify(e?.message || "Errore salvataggio"); } finally { setBusy(false); }
  };

  return (
    <View>
      <View style={styles.grid}>
        {areas.map((a) => {
          const n = pendingByKey?.[a.key] ?? 0;
          return (
            <Pressable key={a.area_id} style={styles.tile} onPress={() => open(a)} onLongPress={master ? () => startEdit(a) : undefined} delayLongPress={400} testID={`cgym-area-${a.key}`}>
              <CgymAreaLogo a={a} />
              <Text style={styles.tileTitle} numberOfLines={2}>{a.name}</Text>
              <Text style={styles.tileSub}>{n > 0 ? `${n} da fare` : a.my_last_rating ? `Ultima: ${a.my_last_rating}` : a.my_sessions > 0 ? `${a.my_sessions} sessioni` : "Nessuna in sospeso"}</Text>
              {a.my_last_rating ? <View style={[styles.dot, { backgroundColor: RATING_COLOR[a.my_last_rating] || HT.muted }]} /> : null}
              {master ? (
                <Pressable onPress={() => startEdit(a)} hitSlop={8} style={styles.pencil} testID={`cgym-area-edit-${a.key}`} accessibilityLabel="Modifica nome e logo">
                  <Ionicons name="pencil" size={13} color="#FFF" />
                </Pressable>
              ) : null}
            </Pressable>
          );
        })}
        {master ? (
          <Pressable style={[styles.tile, styles.tileAdd]} onPress={() => startEdit(null)} testID="cgym-area-add">
            <View style={styles.addIcon}><Ionicons name="add" size={30} color={HT.violet} /></View>
            <Text style={styles.tileTitle}>Nuova area</Text>
            <Text style={styles.tileSub}>Nome, logo e blocchi</Text>
          </Pressable>
        ) : null}
      </View>

      <Modal visible={!!edit} transparent animationType="slide" onRequestClose={() => setEdit(null)}>
        <KModalBody>
        <Pressable style={styles.back} onPress={() => setEdit(null)} />
        <View style={styles.sheet} testID="cgym-area-editor">
          <Text style={styles.sheetTitle}>{edit?.a ? "Modifica area" : "Nuova area"}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Pressable onPress={pickLogo} testID="cgym-area-logo-pick">
              {edit?.logo || edit?.a ? (
                edit?.logo ? <Image source={{ uri: edit.logo }} style={{ width: 72, height: 72, borderRadius: 16 }} /> : <CgymAreaLogo a={edit!.a!} size={72} />
              ) : <View style={[styles.addIcon, { width: 72, height: 72 }]}><Ionicons name="image" size={26} color={HT.violet} /></View>}
              <View style={styles.camBadge}><Ionicons name="camera" size={12} color="#FFF" /></View>
            </Pressable>
            <TextInput value={edit?.name || ""} onChangeText={(v) => setEdit((e) => e && { ...e, name: v })} placeholder="Nome area" placeholderTextColor={HT.muted} style={[styles.input, { flex: 1 }]} testID="cgym-area-name" />
          </View>
          <Text style={styles.label}>Blocchi (uno per riga, come nel manuale)</Text>
          <KScrollView style={{ maxHeight: 160 }}>
            <TextInput value={edit?.blocks || ""} onChangeText={(v) => setEdit((e) => e && { ...e, blocks: v })} multiline placeholder={"Dalla telefonata al rapport\nChi sono\n…"} placeholderTextColor={HT.muted} style={[styles.input, { minHeight: 110, textAlignVertical: "top" }]} testID="cgym-area-blocks" />
          </KScrollView>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Pressable onPress={() => setEdit(null)} style={[styles.btn, { backgroundColor: HT.card2, borderWidth: 1, borderColor: HT.border }]}><Text style={[styles.btnTxt, { color: HT.text }]}>Annulla</Text></Pressable>
            <Pressable onPress={save} disabled={busy} style={[styles.btn, { flex: 1 }]} testID="cgym-area-save">{busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.btnTxt}>Salva</Text>}</Pressable>
          </View>
        </View>
        </KModalBody>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
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

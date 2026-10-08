// app/spazio-personale-anagrafica.tsx — V50.z469 — Feature 13/14: «Spazio Personale › Anagrafica» (Super Master).
// Blocco A: Famiglia · Case · Contatti d'emergenza · Documenti — dati cifrati SOLO sul dispositivo (src/personalVault.ts),
// nessuna sincronizzazione con il VPS. Blocco B: protetto dal cancello PIN/biometria dello Spazio Personale (PersonalLockGate,
// riblocco al rientro dal background) + interruttore «Condividi con Axon» (riepilogo allegato alla singola richiesta chat).
import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, Switch, AppState, Platform, Modal, Share } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useInsetsSafe } from "@/src/hooks/useSafeBottom";
import { PersonalLockGate } from "@/src/PersonalLockGate";
import { notify } from "@/src/utils/notify";
import { HT } from "@/src/homeTheme";
import { api } from "@/src/api";
import { EMPTY_VAULT, Vault, loadVault, saveVault, wipeVault, newId, vaultCount, vaultIsOsEncrypted } from "@/src/personalVault";

const GREEN = "#059669";
type Block = "family" | "homes" | "emergency" | "documents";
type FieldSpec = { key: string; label: string; placeholder?: string; keyboard?: "default" | "phone-pad" };
const BLOCKS: { key: Block; icon: keyof typeof Ionicons.glyphMap; title: string; desc: string; fields: FieldSpec[]; headline: (x: any) => string; sub: (x: any) => string }[] = [
  { key: "family", icon: "people", title: "Famiglia", desc: "Familiari, date di nascita, recapiti.", fields: [{ key: "name", label: "Nome e cognome" }, { key: "relation", label: "Relazione", placeholder: "moglie, figlio, madre…" }, { key: "birth_date", label: "Data di nascita", placeholder: "GG/MM/AAAA" }, { key: "phone", label: "Telefono", keyboard: "phone-pad" }, { key: "notes", label: "Note" }], headline: (x) => x.name, sub: (x) => [x.relation, x.birth_date, x.phone].filter(Boolean).join(" · ") },
  { key: "homes", icon: "home", title: "Case", desc: "Abitazioni, seconde case, note utili.", fields: [{ key: "label", label: "Etichetta", placeholder: "Casa principale, Casa al mare…" }, { key: "address", label: "Indirizzo" }, { key: "notes", label: "Note", placeholder: "allarme, chiavi, portineria…" }], headline: (x) => x.label, sub: (x) => x.address },
  { key: "emergency", icon: "medkit", title: "Contatti d'emergenza", desc: "Chi avvisare in caso di bisogno.", fields: [{ key: "name", label: "Nome" }, { key: "relation", label: "Relazione" }, { key: "phone", label: "Telefono", keyboard: "phone-pad" }], headline: (x) => x.name, sub: (x) => [x.relation, x.phone].filter(Boolean).join(" · ") },
  { key: "documents", icon: "card", title: "Documenti", desc: "Carta d'identità, passaporto, patente, tessere.", fields: [{ key: "type", label: "Tipo", placeholder: "Carta d'identità, Passaporto…" }, { key: "number", label: "Numero" }, { key: "expires", label: "Scadenza", placeholder: "GG/MM/AAAA" }, { key: "notes", label: "Note" }], headline: (x) => x.type, sub: (x) => [x.number && `n. ${x.number}`, x.expires && `scade ${x.expires}`].filter(Boolean).join(" · ") },
];

export default function SpazioPersonaleAnagraficaScreen() {
  const router = useRouter();
  const insets = useInsetsSafe();
  const [unlocked, setUnlocked] = useState(false);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [vault, setVault] = useState<Vault>({ ...EMPTY_VAULT });
  const [editing, setEditing] = useState<{ block: Block; item: Record<string, string> } | null>(null);
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => { if (appState.current === "active" && (next === "background" || next === "inactive")) setUnlocked(false); appState.current = next; });
    return () => sub.remove();
  }, []);
  useEffect(() => { api<{ super_master: boolean }>("/axon/core/persona").then((r) => setAllowed(!!r?.super_master)).catch(() => setAllowed(false)); }, []);
  useEffect(() => { if (unlocked) loadVault().then(setVault); }, [unlocked]);

  const persist = useCallback(async (next: Vault) => { setVault(next); try { await saveVault(next); } catch (e: any) { notify("Salvataggio non riuscito", e?.message || "Riprova"); } }, []);

  const saveItem = async () => {
    if (!editing) return;
    const spec = BLOCKS.find((b) => b.key === editing.block)!;
    if (!(editing.item[spec.fields[0].key] || "").trim()) { notify("Campo obbligatorio", `${spec.fields[0].label} è richiesto`); return; }
    const list = [...(vault[editing.block] as any[])];
    const idx = list.findIndex((x) => x.id === editing.item.id);
    if (idx >= 0) list[idx] = editing.item; else list.push({ ...editing.item, id: editing.item.id || newId() });
    await persist({ ...vault, [editing.block]: list } as Vault);
    setEditing(null);
  };
  const removeItem = async (block: Block, id: string) => persist({ ...vault, [block]: (vault[block] as any[]).filter((x) => x.id !== id) } as Vault);

  const exportJson = async () => {
    try { await Share.share({ message: JSON.stringify(vault, null, 2), title: "Spazio Personale — esportazione" }); }
    catch (e: any) { notify("Esportazione", e?.message || "Non riuscita"); }
  };
  const wipeAll = () => notify("Cancellare tutto?", "I dati dello Spazio Personale verranno eliminati da questo dispositivo (non esistono copie sul server).", [{ text: "Annulla", style: "cancel" }, { text: "Elimina", style: "destructive", onPress: async () => { await wipeVault(); setVault({ ...EMPTY_VAULT }); } }]);

  const header = (
    <View style={styles.header}>
      <Pressable onPress={() => router.back()} hitSlop={10} testID="psa-back"><Ionicons name="arrow-back" size={22} color="#FFF" /></Pressable>
      <View style={{ flex: 1 }}>
        <Text style={styles.headerTitle}>Anagrafica personale</Text>
        <Text style={styles.headerSub}>🔐 Solo su questo dispositivo · nessuna copia sul server</Text>
      </View>
    </View>
  );

  if (allowed === false) {
    return (<View style={[styles.root, { paddingTop: insets.top }]}>{header}<View style={styles.center}><Ionicons name="lock-closed" size={36} color="#94A3B8" /><Text style={styles.centerTxt}>Questa sezione è riservata al Super Master.</Text></View></View>);
  }
  if (!unlocked) {
    return (<View style={[styles.root, { paddingTop: insets.top }]}>{header}<PersonalLockGate onUnlocked={() => setUnlocked(true)} /></View>);
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="psa-screen">
      {header}
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: insets.bottom + 120, gap: 12 }}>
        <View style={styles.trust}>
          <Ionicons name="shield-checkmark" size={20} color={HT.success} />
          <Text style={styles.trustTxt}>
            {vaultIsOsEncrypted ? "Dati cifrati dal sistema operativo (Keystore/Keychain) e conservati SOLO su questo dispositivo. Non vengono sincronizzati con il server: se cambi telefono, esportali prima." : "Su web i dati restano nel browser (non cifrati dal sistema): usa l'app installata per la protezione completa."}
          </Text>
        </View>

        <View style={styles.shareCard} testID="psa-share-axon">
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Condividi con Axon</Text>
            <Text style={styles.desc}>Quando chiedi qualcosa su famiglia, casa, emergenze o documenti, Axon riceve un riepilogo solo per quella risposta. Nulla viene salvato sul server.</Text>
          </View>
          <Switch value={vault.share_with_axon} onValueChange={(v) => persist({ ...vault, share_with_axon: v })} trackColor={{ true: GREEN }} />
        </View>

        {BLOCKS.map((b) => (
          <View key={b.key} style={styles.block} testID={`psa-block-${b.key}`}>
            <View style={styles.blockHead}>
              <View style={styles.icon}><Ionicons name={b.icon} size={18} color={GREEN} /></View>
              <View style={{ flex: 1 }}><Text style={styles.label}>{b.title}</Text><Text style={styles.desc}>{b.desc}</Text></View>
              <Pressable onPress={() => setEditing({ block: b.key, item: {} })} style={styles.addBtn} testID={`psa-add-${b.key}`}><Ionicons name="add" size={20} color="#FFF" /></Pressable>
            </View>
            {(vault[b.key] as any[]).length === 0 ? <Text style={styles.empty}>Nessun elemento. Tocca + per aggiungere.</Text> : (vault[b.key] as any[]).map((x) => (
              <Pressable key={x.id} onPress={() => setEditing({ block: b.key, item: { ...x } })} style={styles.row} testID={`psa-item-${x.id}`}>
                <View style={{ flex: 1 }}><Text style={styles.rowTitle}>{b.headline(x)}</Text>{b.sub(x) ? <Text style={styles.rowSub}>{b.sub(x)}</Text> : null}</View>
                <Pressable onPress={() => removeItem(b.key, x.id)} hitSlop={8} style={styles.delBtn}><Ionicons name="trash-outline" size={18} color={HT.danger} /></Pressable>
              </Pressable>
            ))}
          </View>
        ))}

        <View style={styles.footerRow}>
          <Pressable onPress={exportJson} style={styles.ghostBtn} testID="psa-export"><Ionicons name="share-outline" size={16} color={HT.text} /><Text style={styles.ghostTxt}>Esporta ({vaultCount(vault)})</Text></Pressable>
          <Pressable onPress={wipeAll} style={[styles.ghostBtn, { borderColor: HT.danger }]} testID="psa-wipe"><Ionicons name="trash-outline" size={16} color={HT.danger} /><Text style={[styles.ghostTxt, { color: HT.danger }]}>Cancella tutto</Text></Pressable>
        </View>
        {vault.updated_at ? <Text style={styles.updated}>Ultimo salvataggio: {new Date(vault.updated_at).toLocaleString("it-IT")}</Text> : null}
      </ScrollView>

      <Modal visible={!!editing} transparent animationType="slide" onRequestClose={() => setEditing(null)}>
        <Pressable style={styles.modalBg} onPress={() => setEditing(null)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            {editing ? (() => { const spec = BLOCKS.find((b) => b.key === editing.block)!; return (
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 10, paddingBottom: Math.max(insets.bottom, 12) }}>
                <Text style={styles.sheetTitle}>{editing.item.id ? "Modifica" : "Nuovo"} · {spec.title}</Text>
                {spec.fields.map((f) => (
                  <View key={f.key}>
                    <Text style={styles.fLbl}>{f.label}</Text>
                    <TextInput value={editing.item[f.key] || ""} onChangeText={(t) => setEditing({ ...editing, item: { ...editing.item, [f.key]: t } })} placeholder={f.placeholder || f.label} placeholderTextColor={HT.muted} style={styles.input} keyboardType={f.keyboard || "default"} testID={`psa-field-${f.key}`} />
                  </View>
                ))}
                <View style={{ flexDirection: "row", gap: 10, marginTop: 6 }}>
                  <Pressable onPress={() => setEditing(null)} style={[styles.ghostBtn, { flex: 1, justifyContent: "center" }]}><Text style={styles.ghostTxt}>Annulla</Text></Pressable>
                  <Pressable onPress={saveItem} style={styles.saveBtn} testID="psa-save"><Ionicons name="checkmark" size={18} color="#FFF" /><Text style={styles.saveTxt}>Salva sul dispositivo</Text></Pressable>
                </View>
              </ScrollView>
            ); })() : null}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: HT.bg },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: GREEN },
  headerTitle: { color: "#FFF", fontSize: 18, fontWeight: "900" },
  headerSub: { color: "rgba(255,255,255,0.85)", fontSize: 11.5, fontWeight: "600" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 24 },
  centerTxt: { color: HT.muted, textAlign: "center", fontSize: 14 },
  trust: { flexDirection: "row", gap: 10, backgroundColor: HT.successTint, borderRadius: 12, padding: 12, alignItems: "flex-start" },
  trustTxt: { flex: 1, fontSize: 12.5, color: HT.text, lineHeight: 18 },
  shareCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border, borderRadius: 14, padding: 12 },
  block: { backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border, borderRadius: 14, padding: 12, gap: 8 },
  blockHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  icon: { width: 36, height: 36, borderRadius: 10, backgroundColor: HT.successTint, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 15, fontWeight: "800", color: HT.text },
  desc: { fontSize: 12, color: HT.muted, marginTop: 2 },
  addBtn: { width: 44, height: 44, borderRadius: 12, backgroundColor: GREEN, alignItems: "center", justifyContent: "center" },
  empty: { fontSize: 12, color: HT.muted, fontStyle: "italic", paddingVertical: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: HT.border, minHeight: 48 },
  rowTitle: { fontSize: 14, fontWeight: "700", color: HT.text },
  rowSub: { fontSize: 12, color: HT.muted, marginTop: 1 },
  delBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  footerRow: { flexDirection: "row", gap: 10 },
  ghostBtn: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: HT.border, borderRadius: 12, paddingHorizontal: 14, minHeight: 44, backgroundColor: HT.card },
  ghostTxt: { fontSize: 13, fontWeight: "700", color: HT.text },
  updated: { fontSize: 11, color: HT.muted, textAlign: "center" },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { backgroundColor: HT.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, maxHeight: "85%" },
  sheetTitle: { fontSize: 17, fontWeight: "900", color: HT.text, marginBottom: 4 },
  fLbl: { fontSize: 12, fontWeight: "700", color: HT.muted, marginBottom: 4 },
  input: { backgroundColor: HT.card2, borderWidth: 1, borderColor: HT.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: Platform.OS === "ios" ? 12 : 10, color: HT.text, fontSize: 15, minHeight: 46 },
  saveBtn: { flex: 1.4, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: GREEN, borderRadius: 12, minHeight: 46 },
  saveTxt: { color: "#FFF", fontWeight: "900", fontSize: 14 },
});

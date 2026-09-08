/**
 * V27 — Master-only screen dedicated to editing phone-call scripts that
 * agents see when they tap "Script" on a contact card or ritelefonata.
 * V28.f — Supports MULTIPLE named scripts (freddo/caldo/prospect/…): each
 * has a name and content. Backed by `settings.call_scripts` array.
 * The legacy `settings.call_script` (single string) is preserved as fallback
 * for older data.
 */
import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";

const C = { primary: "#FF6B35", navy: "#1B2B4B", muted: "#94A3B8", success: "#16A34A" };

type NamedScript = { id: string; name: string; content: string; whatsapp_message?: string };

function newId(): string { return "sc_" + Math.random().toString(36).slice(2, 10); }

export default function CallScriptConfigScreen() {
  const pagePad = usePageBottomPadding();
  const router = useRouter();
  const { user } = useAuth();
  const isMaster = !user?.parent_user_id;
  const [scripts, setScripts] = useState<NamedScript[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await api<{ call_script?: string; call_scripts?: NamedScript[] }>("/settings");
      let list = Array.isArray(s.call_scripts) ? s.call_scripts.filter((x) => x && x.id && x.name != null) : [];
      // Normalizza: assicura il campo whatsapp_message (default vuoto) per compatibilità
      list = list.map((x) => ({ id: x.id, name: x.name, content: x.content || "", whatsapp_message: x.whatsapp_message || "" }));
      // Legacy migration: promote the old single string as "Standard"
      if (list.length === 0 && s.call_script) {
        list = [{ id: newId(), name: "Standard", content: s.call_script, whatsapp_message: "" }];
      }
      if (list.length === 0) {
        list = [{ id: newId(), name: "Freddo", content: "", whatsapp_message: "" }];
      }
      setScripts(list);
      setActiveId(list[0].id);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (isMaster) load(); else setLoading(false); }, [isMaster, load]);

  const active = scripts.find((s) => s.id === activeId) || scripts[0];

  const patchActive = (patch: Partial<NamedScript>) => {
    setScripts((arr) => arr.map((s) => (s.id === activeId ? { ...s, ...patch } : s)));
  };

  const addScript = () => {
    const n: NamedScript = { id: newId(), name: `Script ${scripts.length + 1}`, content: "", whatsapp_message: "" };
    setScripts((arr) => [...arr, n]);
    setActiveId(n.id);
  };

  const removeActive = () => {
    if (scripts.length <= 1) { notify("Non puoi eliminare", "Deve esistere almeno uno script."); return; }
    const idx = scripts.findIndex((s) => s.id === activeId);
    const next = scripts.filter((s) => s.id !== activeId);
    setScripts(next);
    setActiveId(next[Math.max(0, idx - 1)].id);
  };

  const save = async () => {
    try {
      setSaving(true);
      const full = await api<any>("/settings");
      // Also keep legacy field synced to the FIRST script for pre-V28.f agents
      const legacy = scripts[0]?.content || "";
      await api("/settings", { method: "PUT", body: { ...full, call_scripts: scripts, call_script: legacy } });
      notify("Salvato ✅", `${scripts.length} script visibili a tutti gli agenti`);
      router.back();
    } catch (e: any) { notify("Errore", e?.message || ""); } finally { setSaving(false); }
  };

  if (!isMaster) {
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={26} color={C.navy} /></Pressable>
          <Text style={styles.title}>Script Telefonata</Text><View style={{ width: 26 }} />
        </View>
        <View style={{ padding: 40, alignItems: "center", gap: 10 }}>
          <Ionicons name="lock-closed" size={40} color={C.muted} />
          <Text style={{ fontWeight: "800", color: C.navy }}>Sezione riservata al Master</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={26} color={C.navy} /></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Script Telefonata & WhatsApp</Text>
          <Text style={styles.sub}>Multi-script (Freddo/Caldo/Prospect…) · ogni script ha il suo messaggio WhatsApp</Text>
        </View>
      </View>

      {loading ? <ActivityIndicator style={{ marginTop: 40 }} color={C.primary} /> : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: pagePad, gap: 10 }}>
          <View style={styles.tipCard}>
            <Ionicons name="information-circle" size={18} color={C.primary} />
            <Text style={styles.tipTxt}>
              Crea diversi script (es. Freddo, Caldo, Prospect). L&apos;agente sceglie quale usare all&apos;apertura. Ogni script può avere il proprio <Text style={{ fontWeight: "800", color: "#16A34A" }}>messaggio WhatsApp</Text> associato. Placeholder disponibili: <Text style={{ fontWeight: "800" }}>{"{name}"}</Text> · <Text style={{ fontWeight: "800" }}>{"{agent}"}</Text>.
            </Text>
          </View>

          {/* Script tabs */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 6 }}>
            {scripts.map((s) => {
              const on = s.id === activeId;
              return (
                <Pressable
                  key={s.id}
                  testID={`script-tab-${s.id}`}
                  onPress={() => setActiveId(s.id)}
                  style={[styles.tab, on && styles.tabOn]}
                >
                  <Ionicons name={on ? "document-text" : "document-text-outline"} size={14} color={on ? "#FFF" : C.primary} />
                  <Text style={[styles.tabTxt, on && { color: "#FFF" }]}>{s.name || "Senza nome"}</Text>
                </Pressable>
              );
            })}
            <Pressable testID="script-add" onPress={addScript} style={[styles.tab, styles.tabAdd]}>
              <Ionicons name="add" size={16} color={C.navy} />
              <Text style={[styles.tabTxt, { color: C.navy }]}>Nuovo</Text>
            </Pressable>
          </ScrollView>

          {active ? (
            <>
              <Text style={styles.lbl}>Nome script</Text>
              <TextInput
                testID="script-name"
                value={active.name}
                onChangeText={(t) => patchActive({ name: t })}
                placeholder="es. Freddo / Caldo / Prospect"
                placeholderTextColor="#94A3B8"
                style={styles.nameInput}
              />

              <Text style={styles.lbl}>Contenuto</Text>
              <TextInput
                testID="call-script-textarea"
                value={active.content}
                onChangeText={(t) => patchActive({ content: t })}
                multiline
                placeholder={"APERTURA\nBuongiorno {name}, sono {agent}…\n\nSCOPO\n…\n\nCHIUSURA\nLe va bene giovedì alle 18:00?"}
                placeholderTextColor="#94A3B8"
                style={styles.textarea}
              />

              <View style={styles.waHeaderRow}>
                <Ionicons name="logo-whatsapp" size={16} color="#25D366" />
                <Text style={[styles.lbl, { marginTop: 0 }]}>Messaggio WhatsApp associato</Text>
              </View>
              <TextInput
                testID="call-script-whatsapp"
                value={active.whatsapp_message || ""}
                onChangeText={(t) => patchActive({ whatsapp_message: t })}
                multiline
                placeholder={"Ciao {name}! Ti scrivo da parte di {agent}… un messaggio breve e caldo per iniziare la conversazione."}
                placeholderTextColor="#94A3B8"
                style={[styles.textarea, styles.textareaWa, { minHeight: 130 }]}
              />
              <Text style={styles.waHint}>
                Placeholder: <Text style={{ fontWeight: "800" }}>{"{name}"}</Text> = nome cliente ·{" "}
                <Text style={{ fontWeight: "800" }}>{"{agent}"}</Text> = tuo nome. Vuoto = usa il messaggio globale delle Impostazioni.
              </Text>

              {scripts.length > 1 ? (
                <Pressable testID="script-remove" onPress={removeActive} style={styles.removeBtn}>
                  <Ionicons name="trash-outline" size={16} color="#DC2626" />
                  <Text style={styles.removeBtnTxt}>Elimina questo script</Text>
                </Pressable>
              ) : null}
            </>
          ) : null}

          <Pressable testID="save-script-btn" onPress={save} disabled={saving} style={[styles.saveBtn, { backgroundColor: saving ? C.muted : C.primary }]}>
            {saving ? <ActivityIndicator color="#FFF" /> : (
              <>
                <Ionicons name="save" size={18} color="#FFF" />
                <Text style={styles.saveBtnTxt}>Salva tutti gli script</Text>
              </>
            )}
          </Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: "row", alignItems: "center", gap: 10, padding: 16 },
  title: { fontSize: 18, fontWeight: "800", color: C.navy, letterSpacing: -0.3 },
  sub: { fontSize: 11, color: C.muted, marginTop: 2, fontWeight: "600" },
  tipCard: { flexDirection: "row", gap: 10, alignItems: "flex-start", padding: 12, backgroundColor: "#FFF1E9", borderRadius: 12, borderWidth: 1, borderColor: "#FFD5B8" },
  tipTxt: { flex: 1, fontSize: 12, color: C.navy, lineHeight: 17, fontWeight: "600" },
  tab: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: "#FFF", borderWidth: 1.5, borderColor: C.primary },
  tabOn: { backgroundColor: C.primary, borderColor: C.primary },
  tabAdd: { borderColor: C.navy, backgroundColor: "#F1F5F9" },
  tabTxt: { fontSize: 12, fontWeight: "800", color: C.primary },
  lbl: { fontSize: 12, fontWeight: "800", color: C.muted, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 8 },
  nameInput: { backgroundColor: "#FFF", borderWidth: 1, borderColor: theme.color.border, borderRadius: 10, padding: 12, fontSize: 15, fontWeight: "700", color: C.navy },
  textarea: { backgroundColor: "#FFF", borderRadius: 14, padding: 14, minHeight: 260, fontSize: 15, color: C.navy, textAlignVertical: "top", borderWidth: 1, borderColor: theme.color.border, lineHeight: 22 },
  textareaWa: { backgroundColor: "#F0FDF4", borderColor: "#86EFAC" },
  waHeaderRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 14, marginBottom: 4 },
  waHint: { fontSize: 11, color: theme.color.muted, marginTop: 4, fontStyle: "italic" },
  removeBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 8, backgroundColor: "#FEE2E2", borderRadius: 10, marginTop: 4 },
  removeBtnTxt: { color: "#DC2626", fontWeight: "700", fontSize: 12 },
  saveBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 14, borderRadius: 14, marginTop: 8 },
  saveBtnTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
});

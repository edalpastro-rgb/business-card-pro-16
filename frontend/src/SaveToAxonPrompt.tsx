/**
 * V28.y — SaveToAxonPrompt
 * Piccolo prompt discreto mostrato SOTTO ogni risposta di Axon (solo per Master).
 * Due azioni:
 *  - 🧠 "Salva come regola" → apre mini-modal con title+text prefilled → POST /ai-teach/rules
 *  - 🔗 "Aggiungi fonte" (solo se il messaggio contiene URL) → mostra elenco URL, tap per aggiungere
 * L'utente resta nella chat: nessun redirect.
 */
import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, Modal, TextInput, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { CT } from "@/src/assistant/chatTheme"; // V50.z337 — chat dark/premium
import { useSafeBottom } from "@/src/hooks/useSafeBottom";

/** Estrae URL (http/https) da un testo. Deduplica preservando l'ordine. */
export function extractUrls(text: string): string[] {
  if (!text) return [];
  const rx = /https?:\/\/[^\s)>\]"']+/g;
  const seen = new Set<string>();
  const out: string[] = [];
  const matches = text.match(rx) || [];
  matches.forEach((u) => {
    let clean = u.replace(/[.,;:!?]+$/g, ""); // strip trailing punctuation
    if (!seen.has(clean)) { seen.add(clean); out.push(clean); }
  });
  return out;
}

/** Suggerisce un titolo dalla prima riga o dai primi ~60 char del contenuto. */
function suggestRuleTitle(content: string): string {
  const line = (content.split(/\r?\n/).find((l) => l.trim()) || "").trim();
  const s = line.replace(/^[\W_]+/, "").replace(/\s+/g, " ");
  if (s.length <= 60) return s || "Regola da Axon";
  return s.slice(0, 60).trim() + "…";
}

export function SaveToAxonPrompt({
  content,
  assistantColor = "#7C3AED",
  isMaster,
}: {
  content: string;
  assistantColor?: string;
  isMaster: boolean;
}) {
  const [savedRule, setSavedRule] = useState(false);
  const [savedUrls, setSavedUrls] = useState<Set<string>>(new Set());
  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const { height: winH } = useWindowDimensions(); // V50.z162
  const safeBottom = useSafeBottom(); // V29.aq
  const [urlModalOpen, setUrlModalOpen] = useState(false);
  const [ruleTitle, setRuleTitle] = useState("");
  const [ruleText, setRuleText] = useState("");
  const [busy, setBusy] = useState(false);
  const [urlBusy, setUrlBusy] = useState<string | null>(null);

  const urls = useMemo(() => extractUrls(content), [content]);

  // Nascondi il prompt se:
  //  - non è Master (endpoint ai-teach richiede Master)
  //  - contenuto vuoto o troppo breve per essere utile (< 40 caratteri)
  if (!isMaster || (content || "").trim().length < 40) return null;

  const openRuleModal = () => {
    setRuleTitle(suggestRuleTitle(content));
    setRuleText(content.trim().slice(0, 2000));
    setRuleModalOpen(true);
  };

  const saveRule = async () => {
    try {
      setBusy(true);
      const t = ruleTitle.trim();
      const x = ruleText.trim();
      if (!t || !x) { notify("Dati mancanti", "Titolo e testo obbligatori"); return; }
      await api("/ai-teach/rules", {
        method: "POST",
        body: {
          categories: ["Generale"],
          category: "Generale",
          title: t,
          text: x,
          files: [],
          // V50.z53 — Sempre esplicito: questa è una regola manuale del Master
          auto_generated: false,
        },
      });
      setSavedRule(true);
      setRuleModalOpen(false);
      notify("Regola salvata", "Aggiunta a Insegna ad Axon nella categoria Generale.");
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile salvare la regola");
    } finally { setBusy(false); }
  };

  const addUrl = async (url: string) => {
    try {
      setUrlBusy(url);
      // Nome autogenerato dall'host
      let name = "Fonte";
      try { const u = new URL(url); name = u.hostname.replace(/^www\./, ""); } catch { /* keep default */ }
      await api("/ai-teach/urls", {
        method: "POST",
        body: {
          url,
          name,
          category: "generic",
          frequency: "manual",
        },
      });
      setSavedUrls((s) => new Set([...Array.from(s), url]));
      notify("Fonte aggiunta", `${name} è stata aggiunta a Insegna ad Axon.`);
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile aggiungere la fonte");
    } finally { setUrlBusy(null); }
  };

  return (
    <View style={styles.wrap} testID="save-to-axon-prompt">
      <View style={styles.chipsRow}>
        {!savedRule ? (
          <Pressable testID="save-rule-chip" onPress={openRuleModal} style={[styles.chip, { borderColor: assistantColor }]}>
            <Ionicons name="bookmark-outline" size={12} color={assistantColor} />
            <Text style={[styles.chipTxt, { color: assistantColor }]}>Salva come regola</Text>
          </Pressable>
        ) : (
          <View style={[styles.chip, styles.chipDone]}>
            <Ionicons name="checkmark-circle" size={12} color={CT.success} />
            <Text style={[styles.chipTxt, { color: CT.success }]}>Regola salvata</Text>
          </View>
        )}
        {urls.length > 0 && (
          <Pressable testID="save-url-chip" onPress={() => setUrlModalOpen(true)} style={[styles.chip, { borderColor: assistantColor }]}>
            <Ionicons name="link" size={12} color={assistantColor} />
            <Text style={[styles.chipTxt, { color: assistantColor }]}>
              Aggiungi fonte ({urls.length})
            </Text>
          </Pressable>
        )}
      </View>

      {/* Rule creation modal */}
      <Modal transparent visible={ruleModalOpen} animationType="fade" onRequestClose={() => !busy && setRuleModalOpen(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Pressable style={styles.backdrop} onPress={() => !busy && setRuleModalOpen(false)}>
          <Pressable style={[styles.sheet, { paddingBottom: safeBottom + 12, maxHeight: winH * 0.9 }]} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHdr}>
              <Ionicons name="bookmark" size={20} color={assistantColor} />
              <Text style={styles.sheetTitle}>Salva come regola</Text>
              <Pressable onPress={() => !busy && setRuleModalOpen(false)} hitSlop={10}>
                <Ionicons name="close" size={22} color={CT.text} />
              </Pressable>
            </View>
            {/* V50.z162 — Form scrollabile (max ~50% schermo) + bottone Salva SEMPRE
                visibile sotto: con testo lungo o tastiera aperta il bottone era irraggiungibile. */}
            <ScrollView
              style={{ maxHeight: Math.max(160, winH * 0.5) }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
              testID="save-rule-scroll"
            >
              <Text style={styles.lbl}>Titolo</Text>
              <TextInput
                value={ruleTitle}
                onChangeText={setRuleTitle}
                placeholder="Titolo breve della regola"
                placeholderTextColor="#94A3B8"
                maxLength={120}
                style={styles.input}
              />
              <Text style={styles.lbl}>Testo</Text>
              <TextInput
                value={ruleText}
                onChangeText={setRuleText}
                placeholder="Contenuto della regola"
                placeholderTextColor="#94A3B8"
                multiline
                maxLength={2000}
                scrollEnabled={false}
                style={[styles.input, { minHeight: 120, textAlignVertical: "top" }]}
              />
              <Text style={styles.helper}>Verrà salvata in Insegna ad Axon nella categoria &quot;Generale&quot; e potrai modificarla in seguito.</Text>
            </ScrollView>
            <Pressable
              testID="save-rule-confirm"
              onPress={saveRule}
              disabled={busy}
              style={[styles.primaryBtn, { backgroundColor: busy ? "#94A3B8" : assistantColor }]}
            >
              {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryBtnTxt}>Salva regola</Text>}
            </Pressable>
          </Pressable>
        </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      {/* URL sources modal */}
      <Modal transparent visible={urlModalOpen} animationType="fade" onRequestClose={() => !urlBusy && setUrlModalOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => !urlBusy && setUrlModalOpen(false)}>
          <Pressable style={[styles.sheet, { paddingBottom: safeBottom + 12 }]} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHdr}>
              <Ionicons name="link" size={20} color={assistantColor} />
              <Text style={styles.sheetTitle}>Aggiungi fonti ad Axon</Text>
              <Pressable onPress={() => !urlBusy && setUrlModalOpen(false)} hitSlop={10}>
                <Ionicons name="close" size={22} color={CT.text} />
              </Pressable>
            </View>
            <Text style={styles.helper}>Tocca una fonte per aggiungerla. Verrà usata da Axon per auto-apprendimento (categoria: generic, aggiornamento manuale).</Text>
            <ScrollView style={{ maxHeight: 300 }}>
              {urls.map((u) => {
                const done = savedUrls.has(u);
                const isBusy = urlBusy === u;
                let hostname = u;
                try { hostname = new URL(u).hostname.replace(/^www\./, ""); } catch { /* ignore */ }
                return (
                  <Pressable
                    key={u}
                    testID={`url-add-${hostname}`}
                    onPress={() => !done && !isBusy && addUrl(u)}
                    disabled={done || !!urlBusy}
                    style={[styles.urlRow, done && { opacity: 0.6 }]}
                  >
                    <Ionicons
                      name={done ? "checkmark-circle" : "link"}
                      size={18}
                      color={done ? "#059669" : assistantColor}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.urlHost} numberOfLines={1}>{hostname}</Text>
                      <Text style={styles.urlFull} numberOfLines={1}>{u}</Text>
                    </View>
                    {isBusy ? <ActivityIndicator color={assistantColor} /> : done ? null : <Ionicons name="add-circle" size={22} color={assistantColor} />}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 6 },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 6, borderWidth: 1,
    backgroundColor: "transparent",
  },
  chipDone: { borderColor: CT.success, backgroundColor: "transparent" },
  chipTxt: { fontSize: 10, fontWeight: "800", letterSpacing: 0.2 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", alignItems: "center", padding: 20 },
  sheet: { backgroundColor: CT.surface, borderWidth: 1, borderColor: CT.borderGhost, borderRadius: 14, padding: 18, width: "100%", maxWidth: 480, gap: 8 },
  sheetHdr: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  sheetTitle: { fontSize: 16, fontWeight: "800", color: CT.text, flex: 1 },
  lbl: { fontSize: 11, fontWeight: "800", color: CT.muted, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 8, marginBottom: 4 },
  input: { backgroundColor: CT.bar, borderWidth: 1, borderColor: CT.borderGhost, borderRadius: 8, padding: 12, fontSize: 14, color: CT.text },
  helper: { fontSize: 11, color: CT.muted, fontStyle: "italic", marginTop: 4, marginBottom: 6 },
  primaryBtn: { padding: 14, borderRadius: 14, marginTop: 12, alignItems: "center" },
  primaryBtnTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
  urlRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: CT.border },
  urlHost: { fontSize: 13, fontWeight: "700", color: CT.text },
  urlFull: { fontSize: 10, color: CT.muted, fontWeight: "600" },
});

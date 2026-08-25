/**
 * V28.y — SaveToAxonPrompt
 * Piccolo prompt discreto mostrato SOTTO ogni risposta di Axon (solo per Master).
 * Due azioni:
 *  - 🧠 "Salva come regola" → apre mini-modal con title+text prefilled → POST /ai-teach/rules
 *  - 🔗 "Aggiungi fonte" (solo se il messaggio contiene URL) → mostra elenco URL, tap per aggiungere
 * L'utente resta nella chat: nessun redirect.
 */
import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, Modal, TextInput, ActivityIndicator, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";

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
            <Ionicons name="checkmark-circle" size={12} color="#059669" />
            <Text style={[styles.chipTxt, { color: "#059669" }]}>Regola salvata</Text>
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
        <Pressable style={styles.backdrop} onPress={() => !busy && setRuleModalOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHdr}>
              <Ionicons name="bookmark" size={20} color={assistantColor} />
              <Text style={styles.sheetTitle}>Salva come regola</Text>
              <Pressable onPress={() => !busy && setRuleModalOpen(false)} hitSlop={10}>
                <Ionicons name="close" size={22} color="#1B2B4B" />
              </Pressable>
            </View>
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
              style={[styles.input, { minHeight: 120, textAlignVertical: "top" }]}
            />
            <Text style={styles.helper}>Verrà salvata in Insegna ad Axon nella categoria &quot;Generale&quot; e potrai modificarla in seguito.</Text>
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
      </Modal>

      {/* URL sources modal */}
      <Modal transparent visible={urlModalOpen} animationType="fade" onRequestClose={() => !urlBusy && setUrlModalOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => !urlBusy && setUrlModalOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHdr}>
              <Ionicons name="link" size={20} color={assistantColor} />
              <Text style={styles.sheetTitle}>Aggiungi fonti ad Axon</Text>
              <Pressable onPress={() => !urlBusy && setUrlModalOpen(false)} hitSlop={10}>
                <Ionicons name="close" size={22} color="#1B2B4B" />
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
    borderRadius: 999, borderWidth: 1,
    backgroundColor: "rgba(255,255,255,0.6)",
  },
  chipDone: { borderColor: "#059669", backgroundColor: "#ECFDF5" },
  chipTxt: { fontSize: 10, fontWeight: "800", letterSpacing: 0.2 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", alignItems: "center", padding: 20 },
  sheet: { backgroundColor: "#FFF", borderRadius: 18, padding: 18, width: "100%", maxWidth: 480, gap: 8 },
  sheetHdr: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  sheetTitle: { fontSize: 16, fontWeight: "800", color: "#1B2B4B", flex: 1 },
  lbl: { fontSize: 11, fontWeight: "800", color: "#94A3B8", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 8, marginBottom: 4 },
  input: { backgroundColor: "#F1F5F9", borderRadius: 10, padding: 12, fontSize: 14, color: "#1B2B4B" },
  helper: { fontSize: 11, color: "#64748B", fontStyle: "italic", marginTop: 4, marginBottom: 6 },
  primaryBtn: { padding: 14, borderRadius: 14, marginTop: 12, alignItems: "center" },
  primaryBtnTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
  urlRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: "#F1F5F9" },
  urlHost: { fontSize: 13, fontWeight: "700", color: "#1B2B4B" },
  urlFull: { fontSize: 10, color: "#94A3B8", fontWeight: "600" },
});

import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Platform, Alert, Linking, Modal, TextInput } from "react-native";
import { KModalBody } from "@/src/ui/keyboard"; // V50.z374 — tastiera: campo attivo sempre visibile
import { Ionicons } from "@expo/vector-icons";
import { WebView } from "react-native-webview";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

/**
 * V50.z74 / V50.z92 — WebViewer con azione "Chiedi ad Axon" (estrazione + save).
 * Estrae il contenuto della pagina via Tavily e chiede all'utente dove salvarlo:
 *   - Knowledge base (RAG Axon)
 *   - Scheda cliente attiva (se contactId fornito)
 *   - Solo analisi istantanea (nessun salvataggio, contenuto passato alla chat)
 */
export function InAppWebViewer({
  title,
  url,
  onClose,
  contactId,
}: {
  title: string;
  url: string;
  onClose: () => void;
  contactId?: string;
}) {
  const [loading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [busy, setBusy] = useState<null | "kb" | "contact" | "instant">(null);
  const [note, setNote] = useState("");

  const openExternal = () => {
    Linking.openURL(url).catch(() => Alert.alert("Errore", "Impossibile aprire il link nel browser"));
  };

  const runAxonAction = async (target: "kb" | "contact" | "instant") => {
    if (busy) return;
    setBusy(target);
    try {
      const body: any = { url, target, note: note.trim() || undefined };
      if (target === "contact") {
        if (!contactId) {
          notify("Non disponibile", "Apri il webview da una scheda cliente per usare questa opzione.");
          setBusy(null); return;
        }
        body.contact_id = contactId;
      }
      const res = await api<{ ok: boolean; title?: string; content?: string; preview?: string }>(`/axon/webpage-save`, { method: "POST", body });
      setAskOpen(false); setNote("");
      if (target === "kb") notify("Salvato in KB", `«${res.title}» è ora accessibile ad Axon.`);
      else if (target === "contact") notify("Salvato nel cliente", `Nota aggiunta alla scheda contatto.`);
      else notify("Analisi pronta", `Contenuto (${res.content?.length || 0} caratteri) disponibile per la prossima domanda ad Axon.`);
    } catch (e: any) {
      notify("Errore", e?.message || "Estrazione fallita");
    } finally { setBusy(null); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <View style={styles.header}>
        <Pressable onPress={onClose} hitSlop={8} testID="inapp-webview-close">
          <Ionicons name="chevron-back" size={24} color="#FFF" />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{title || "Link"}</Text>
        <View style={{ flexDirection: "row", gap: 12 }}>
          <Pressable onPress={() => setAskOpen(true)} hitSlop={8} testID="inapp-webview-axon" style={styles.axonBtn}>
            <Ionicons name="sparkles" size={16} color="#F59E0B" />
            <Text style={styles.axonBtnTxt}>Axon</Text>
          </Pressable>
          <Pressable onPress={openExternal} hitSlop={8} testID="inapp-webview-external">
            <Ionicons name="open-outline" size={22} color="#FFF" />
          </Pressable>
        </View>
      </View>
      <View style={{ flex: 1, backgroundColor: HT.card }}>
        {Platform.OS === "web" ? (
          // @ts-expect-error web only
          <iframe src={url} title={title} style={{ width: "100%", height: "100%", border: "none" }} />
        ) : (
          <WebView
            source={{ uri: url }}
            style={{ flex: 1 }}
            onLoadStart={() => setLoading(true)}
            onLoadEnd={() => setLoading(false)}
            onError={(e: any) => {
              setLoading(false);
              // Rileva blocco WebView (X-Frame-Options, CSP frame-ancestors, ecc.)
              const desc = e?.nativeEvent?.description || "";
              const blocked = /x-frame|frame-ancestors|refused|blocked|denied/i.test(desc);
              setErrMsg(blocked ? "Sito non accessibile in modalità interna" : (desc || "Sito non accessibile in modalità interna"));
            }}
            onHttpError={(e: any) => {
              const code = e?.nativeEvent?.statusCode;
              if (code && code >= 400) {
                setLoading(false);
                setErrMsg("Sito non accessibile in modalità interna");
              }
            }}
            javaScriptEnabled
            domStorageEnabled
            startInLoadingState
            originWhitelist={["*"]}
          />
        )}
        {loading && Platform.OS !== "web" ? (
          <View style={styles.loader} pointerEvents="none">
            <ActivityIndicator size="large" color="#0EA5E9" />
          </View>
        ) : null}
        {errMsg ? (
          <View style={styles.errBox}>
            <Ionicons name="warning" size={30} color="#DC2626" />
            <Text style={styles.errTitle}>Sito non accessibile in modalità interna</Text>
            <Text style={styles.errTxt}>{errMsg}</Text>
            <Pressable onPress={openExternal} style={styles.errBtn} testID="inapp-webview-open-external-fallback">
              <Ionicons name="open-outline" size={16} color="#FFF" />
              <Text style={styles.errBtnTxt}>Apri nel browser esterno</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      {/* V50.z92 — Modal "Dove salvo questi contenuti?" */}
      <Modal visible={askOpen} transparent animationType="fade" onRequestClose={() => setAskOpen(false)}><KModalBody>
        <View style={styles.askBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => (!busy && setAskOpen(false))} />
          <View style={styles.askCard}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <Ionicons name="sparkles" size={20} color="#F59E0B" />
              <Text style={styles.askTitle}>Dove salvo questi contenuti?</Text>
            </View>
            <Text style={styles.askSub}>Estrarrò testo pulito dalla pagina e lo userò come indicato.</Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Nota opzionale (es. tariffa 2026)"
              placeholderTextColor={HT.muted}
              style={styles.askNote}
              maxLength={500}
              testID="inapp-webview-axon-note"
            />
            <Pressable disabled={!!busy} onPress={() => runAxonAction("kb")} style={[styles.askOpt, busy === "kb" && { opacity: 0.6 }]} testID="inapp-webview-axon-kb">
              <Ionicons name="library" size={18} color="#0EA5E9" />
              <View style={{ flex: 1 }}>
                <Text style={styles.askOptName}>Salva in Knowledge Base</Text>
                <Text style={styles.askOptSub}>Accessibile ad Axon per tutte le prossime chat</Text>
              </View>
              {busy === "kb" ? <ActivityIndicator size="small" /> : <Ionicons name="chevron-forward" size={16} color={HT.muted} />}
            </Pressable>
            <Pressable disabled={!!busy || !contactId} onPress={() => runAxonAction("contact")} style={[styles.askOpt, (busy === "contact" || !contactId) && { opacity: 0.55 }]} testID="inapp-webview-axon-contact">
              <Ionicons name="person" size={18} color="#7C3AED" />
              <View style={{ flex: 1 }}>
                <Text style={styles.askOptName}>Salva nella scheda cliente attiva</Text>
                <Text style={styles.askOptSub}>{contactId ? "Aggiungi come nota al contatto corrente" : "Non disponibile — apri da una scheda cliente"}</Text>
              </View>
              {busy === "contact" ? <ActivityIndicator size="small" /> : <Ionicons name="chevron-forward" size={16} color={HT.muted} />}
            </Pressable>
            <Pressable disabled={!!busy} onPress={() => runAxonAction("instant")} style={[styles.askOpt, busy === "instant" && { opacity: 0.6 }]} testID="inapp-webview-axon-instant">
              <Ionicons name="flash" size={18} color="#F59E0B" />
              <View style={{ flex: 1 }}>
                <Text style={styles.askOptName}>Solo analisi istantanea</Text>
                <Text style={styles.askOptSub}>Nessun salvataggio, usa il testo per una domanda al volo</Text>
              </View>
              {busy === "instant" ? <ActivityIndicator size="small" /> : <Ionicons name="chevron-forward" size={16} color={HT.muted} />}
            </Pressable>
            <Pressable disabled={!!busy} onPress={() => setAskOpen(false)} style={styles.askCancel}>
              <Text style={styles.askCancelTxt}>Annulla</Text>
            </Pressable>
          </View>
        </View>
      </KModalBody></Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingTop: Platform.OS === "ios" ? 44 : 12,
    paddingBottom: 10,
    backgroundColor: '#0F172A',
  },
  title: { color: "#FFF", fontSize: 15, fontWeight: "700", flex: 1, marginHorizontal: 12, textAlign: "center" },
  axonBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: "rgba(245,158,11,0.15)", borderWidth: 1, borderColor: "#F59E0B55" },
  axonBtnTxt: { color: "#F59E0B", fontWeight: "800", fontSize: 12 },
  loader: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.6)" },
  errBox: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", gap: 8, padding: 24, backgroundColor: HT.card },
  errTitle: { color: HT.text, fontSize: 16, fontWeight: "800", textAlign: "center", marginTop: 8 },
  errTxt: { color: HT.muted, fontSize: 12, textAlign: "center" },
  errBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: '#0EA5E9', paddingHorizontal: 18, paddingVertical: 12, borderRadius: 10, marginTop: 8 },
  errBtnTxt: { color: "#FFF", fontWeight: "800", fontSize: 13 },
  askBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", padding: 20 },
  askCard: { width: "100%", maxWidth: 380, backgroundColor: HT.card, borderRadius: 16, padding: 16 },
  askTitle: { fontSize: 15, fontWeight: "900", color: HT.text, flex: 1 },
  askSub: { fontSize: 12, color: HT.text2, marginBottom: 12 },
  askNote: { borderWidth: 1, borderColor: HT.border, borderRadius: 10, padding: 10, fontSize: 13, color: HT.text, marginBottom: 10 },
  askOpt: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: HT.border, marginBottom: 8 },
  askOptName: { fontSize: 14, fontWeight: "800", color: HT.text },
  askOptSub: { fontSize: 11, color: HT.muted, marginTop: 2 },
  askCancel: { alignItems: "center", paddingVertical: 10, marginTop: 4 },
  askCancelTxt: { color: HT.muted, fontWeight: "700", fontSize: 13 },
});

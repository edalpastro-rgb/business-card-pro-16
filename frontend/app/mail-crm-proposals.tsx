// V50.z22 — Mail Auto-CRM proposals: revisiona aggiornamenti anagrafica
// clienti proposti da Axon leggendo le firme delle mail in arrivo.

import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert,
  RefreshControl, Switch,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

type Change = { from: string | null; to: string };
type Proposal = {
  proposal_id: string;
  contact_id: string;
  contact_name?: string;
  contact_email?: string;
  from_email: string;
  from_name?: string;
  subject: string;
  changes: Record<string, Change>;
  status: "pending" | "accepted" | "rejected";
  created_at?: string;
};

const FIELD_LABELS: Record<string, string> = {
  full_name: "Nome completo",
  role: "Ruolo",
  phone: "Telefono",
  mobile: "Cellulare",
  codice_fiscale: "Codice Fiscale",
  partita_iva: "Partita IVA",
  address: "Indirizzo",
  city: "Città",
  website: "Sito web",
};

export default function MailCrmProposalsScreen() {
  const router = useRouter();
  const pagePad = usePageBottomPadding();
  const [items, setItems] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [filter, setFilter] = useState<"pending" | "all">("pending");

  // V50.z24 — Scheduler settings
  type AutoSettings = {
    enabled: boolean;
    interval_minutes: number;
    last_run_at: string | null;
    next_run_at: string | null;
    last_stats?: any;
    last_error?: string | null;
    limits?: { min_minutes: number; max_minutes: number };
  };
  const [settings, setSettings] = useState<AutoSettings | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  const loadSettings = useCallback(async () => {
    try {
      const s = await api<AutoSettings>("/mail/auto-crm/settings");
      setSettings(s);
    } catch { /* silent */ }
  }, []);

  const patchSettings = async (upd: Partial<AutoSettings>) => {
    if (savingSettings) return;
    setSavingSettings(true);
    try {
      const s = await api<AutoSettings>("/mail/auto-crm/settings", { method: "PATCH", body: upd });
      setSettings(s);
    } catch (e: any) {
      Alert.alert("Errore", e?.message || "Impossibile salvare");
    } finally {
      setSavingSettings(false);
    }
  };

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: Proposal[] }>(`/mail/auto-crm/proposals?status=${filter}`);
      setItems(r.items || []);
    } catch (e: any) {
      Alert.alert("Errore", e?.message || "Impossibile caricare");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadSettings(); }, [loadSettings]);

  const runScan = async () => {
    if (scanning) return;
    setScanning(true);
    try {
      const r = await api<{ stats: any }>("/mail/auto-crm/scan", { method: "POST", body: {} });
      const s = r.stats;
      Alert.alert("Scansione completata",
        `Scansionate: ${s.scanned}\nClienti trovati: ${s.clients_matched}\nAllegati salvati: ${s.attachments_saved}\nProposte create: ${s.proposals_created}`);
      load();
    } catch (e: any) {
      Alert.alert("Errore scan", e?.message || "");
    } finally {
      setScanning(false);
    }
  };

  const accept = async (p: Proposal) => {
    try {
      await api(`/mail/auto-crm/proposals/${p.proposal_id}/accept`, { method: "POST" });
      setItems((prev) => prev.filter((x) => x.proposal_id !== p.proposal_id));
    } catch (e: any) { Alert.alert("Errore", e?.message || ""); }
  };
  const reject = async (p: Proposal) => {
    try {
      await api(`/mail/auto-crm/proposals/${p.proposal_id}/reject`, { method: "POST" });
      setItems((prev) => prev.filter((x) => x.proposal_id !== p.proposal_id));
    } catch (e: any) { Alert.alert("Errore", e?.message || ""); }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={HT.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Auto-CRM da Mail</Text>
          <Text style={styles.headerSub}>{items.length} proposte</Text>
        </View>
      </View>

      <View style={styles.scanBarWrap}>
        <Pressable onPress={runScan} disabled={scanning} style={[styles.scanBtn, scanning && { opacity: 0.6 }]}>
          {scanning ? <ActivityIndicator color="#FFF" /> : (
            <>
              <Ionicons name="scan" size={20} color="#FFF" />
              <Text style={styles.scanBtnTxt}>SCANSIONA MAIL ORA</Text>
            </>
          )}
        </Pressable>

        {/* V50.z24 — Scheduler config */}
        {settings ? (
          <View style={styles.schedCard}>
            <View style={styles.schedHead}>
              <Ionicons name="time" size={16} color="#7C3AED" />
              <Text style={styles.schedTitle}>Scansione automatica</Text>
              <View style={{ flex: 1 }} />
              <Switch
                value={settings.enabled}
                onValueChange={(v) => patchSettings({ enabled: v })}
                disabled={savingSettings}
                trackColor={{ true: "#7C3AED", false: "#CBD5E1" }}
                thumbColor="#FFF"
              />
            </View>
            {settings.enabled ? (
              <>
                <Text style={styles.schedLabel}>Intervallo scansione</Text>
                <View style={styles.chipRow}>
                  {[5, 10, 15, 30, 60, 120, 360].map((mins) => (
                    <Pressable
                      key={mins}
                      onPress={() => patchSettings({ interval_minutes: mins })}
                      disabled={savingSettings}
                      style={[styles.intervalChip, settings.interval_minutes === mins && styles.intervalChipOn]}
                    >
                      <Text style={[styles.intervalTxt, settings.interval_minutes === mins && styles.intervalTxtOn]}>
                        {mins < 60 ? `${mins} min` : `${mins / 60} h`}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <View style={styles.schedInfoRow}>
                  {settings.last_run_at ? (
                    <Text style={styles.schedInfo}>
                      Ultima: {new Date(settings.last_run_at).toLocaleString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      {settings.last_stats && typeof settings.last_stats.proposals_created === "number"
                        ? ` · ${settings.last_stats.proposals_created} proposte`
                        : ""}
                    </Text>
                  ) : (
                    <Text style={styles.schedInfo}>Mai eseguita — parte al prossimo minuto</Text>
                  )}
                  {settings.next_run_at ? (
                    <Text style={styles.schedInfo}>
                      Prossima: {new Date(settings.next_run_at).toLocaleString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </Text>
                  ) : null}
                  {settings.last_error ? (
                    <Text style={styles.schedError} numberOfLines={2}>⚠ {settings.last_error}</Text>
                  ) : null}
                </View>
              </>
            ) : (
              <Text style={styles.schedInfo}>Disattivata · attivala per far girare Auto-CRM in background</Text>
            )}
          </View>
        ) : null}
      </View>

      <View style={styles.filterBar}>
        <Pressable onPress={() => setFilter("pending")} style={[styles.filterChip, filter === "pending" && styles.filterChipOn]}>
          <Text style={[styles.filterTxt, filter === "pending" && styles.filterTxtOn]}>In attesa</Text>
        </Pressable>
        <Pressable onPress={() => setFilter("all")} style={[styles.filterChip, filter === "all" && styles.filterChipOn]}>
          <Text style={[styles.filterTxt, filter === "all" && styles.filterTxtOn]}>Tutte</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 12, paddingBottom: Math.max(pagePad, 60), gap: 10 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      >
        {loading ? (
          <View style={styles.empty}><ActivityIndicator size="large" color="#7C3AED" /></View>
        ) : items.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="checkmark-done" size={44} color={HT.muted} />
            <Text style={styles.emptyTxt}>Nessuna proposta {filter === "pending" ? "in attesa" : ""}</Text>
            <Text style={styles.emptyHint}>Tocca &quot;SCANSIONA MAIL ORA&quot; per cercare aggiornamenti da mail recenti</Text>
          </View>
        ) : items.map((p) => (
          <View key={p.proposal_id} style={styles.card}>
            <View style={styles.cardHead}>
              <Ionicons name="person" size={22} color="#7C3AED" />
              <View style={{ flex: 1 }}>
                <Text style={styles.contactName}>{p.contact_name || p.from_email}</Text>
                <Text style={styles.mailSub}>da: {p.from_email}</Text>
                <Text style={styles.mailSub}>oggetto: {p.subject}</Text>
              </View>
            </View>
            <Text style={styles.changesTitle}>Modifiche proposte ({Object.keys(p.changes).length}):</Text>
            {Object.entries(p.changes).map(([field, delta]) => (
              <View key={field} style={styles.changeRow}>
                <Text style={styles.changeField}>{FIELD_LABELS[field] || field}</Text>
                {delta.from ? (
                  <View style={styles.diffBox}>
                    <Text style={styles.diffOld} numberOfLines={2}>{delta.from}</Text>
                    <Ionicons name="arrow-forward" size={14} color={HT.muted} />
                    <Text style={styles.diffNew} numberOfLines={2}>{delta.to}</Text>
                  </View>
                ) : (
                  <Text style={styles.diffNew}>+ {delta.to}</Text>
                )}
              </View>
            ))}
            {p.status === "pending" ? (
              <View style={styles.btnRow}>
                <Pressable onPress={() => reject(p)} style={styles.rejBtn}>
                  <Ionicons name="close" size={16} color="#DC2626" />
                  <Text style={styles.rejTxt}>Rifiuta</Text>
                </Pressable>
                <Pressable onPress={() => accept(p)} style={styles.accBtn}>
                  <Ionicons name="checkmark" size={16} color="#FFF" />
                  <Text style={styles.accTxt}>Applica modifiche</Text>
                </Pressable>
              </View>
            ) : (
              <View style={[styles.statusPill, p.status === "accepted" ? styles.statusOk : styles.statusRej]}>
                <Text style={[styles.statusTxt, p.status === "accepted" ? { color: HT.success } : { color: HT.danger }]}>
                  {p.status === "accepted" ? "✓ APPLICATA" : "✗ RIFIUTATA"}
                </Text>
              </View>
            )}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.background },
  header: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 12, paddingVertical: 10, backgroundColor: HT.card,
    borderBottomWidth: 1, borderBottomColor: HT.border,
  },
  backBtn: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 16, fontWeight: "800", color: HT.text },
  headerSub: { fontSize: 12, color: HT.muted, marginTop: 2 },
  scanBarWrap: { padding: 12, backgroundColor: HT.card },
  scanBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 12, borderRadius: 999, backgroundColor: '#7C3AED',
    shadowColor: "#7C3AED", shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3,
  },
  scanBtnTxt: { color: "#FFF", fontSize: 14, fontWeight: "900", letterSpacing: 1 },
  filterBar: {
    flexDirection: "row", gap: 8, padding: 10,
    borderBottomWidth: 1, borderBottomColor: HT.border, backgroundColor: HT.card,
  },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: HT.card2 },
  filterChipOn: { backgroundColor: '#7C3AED' },
  filterTxt: { color: HT.text, fontWeight: "700", fontSize: 12 },
  filterTxtOn: { color: "#FFF" },
  empty: { padding: 40, alignItems: "center", gap: 6 },
  emptyTxt: { color: HT.text, fontSize: 15, fontWeight: "700" },
  emptyHint: { color: HT.muted, fontSize: 12, textAlign: "center", maxWidth: 250 },
  card: {
    padding: 12, borderRadius: 12, backgroundColor: HT.card,
    borderWidth: 1, borderColor: HT.border, gap: 6,
  },
  cardHead: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  contactName: { fontSize: 14, fontWeight: "800", color: HT.text },
  mailSub: { fontSize: 11, color: HT.muted, marginTop: 1 },
  changesTitle: { fontSize: 12, fontWeight: "800", color: "#7C3AED", marginTop: 6 },
  changeRow: { paddingVertical: 6, borderTopWidth: 1, borderTopColor: HT.border },
  changeField: { fontSize: 11, fontWeight: "700", color: HT.muted, marginBottom: 3 },
  diffBox: { flexDirection: "row", alignItems: "center", gap: 6 },
  diffOld: { flex: 1, fontSize: 12, color: HT.danger, textDecorationLine: "line-through" },
  diffNew: { flex: 1, fontSize: 13, color: HT.success, fontWeight: "700" },
  btnRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  rejBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4,
    paddingVertical: 10, borderRadius: 10, backgroundColor: HT.dangerTint,
  },
  rejTxt: { color: "#DC2626", fontWeight: "800", fontSize: 13 },
  accBtn: {
    flex: 2, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4,
    paddingVertical: 10, borderRadius: 10, backgroundColor: '#7C3AED',
  },
  accTxt: { color: "#FFF", fontWeight: "800", fontSize: 13 },
  statusPill: { marginTop: 6, alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  statusOk: { backgroundColor: HT.successTint },
  statusRej: { backgroundColor: HT.dangerTint },
  statusTxt: { fontSize: 11, fontWeight: "900" },
  // V50.z24 — scheduler card
  schedCard: {
    marginTop: 10, padding: 10, borderRadius: 12,
    backgroundColor: HT.violetTint, borderWidth: 1, borderColor: HT.violet + '66', gap: 6,
  },
  schedHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  schedTitle: { fontSize: 13, fontWeight: "800", color: HT.violet },
  schedLabel: { fontSize: 11, fontWeight: "700", color: HT.muted, marginTop: 4 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  intervalChip: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
    backgroundColor: HT.card, borderWidth: 1, borderColor: HT.violet + '66',
  },
  intervalChipOn: { backgroundColor: '#7C3AED', borderColor: '#7C3AED' },
  intervalTxt: { fontSize: 11, fontWeight: "700", color: HT.violet },
  intervalTxtOn: { color: "#FFF" },
  schedInfoRow: { marginTop: 6, gap: 2 },
  schedInfo: { fontSize: 11, color: HT.muted },
  schedError: { fontSize: 11, color: HT.danger, fontWeight: "700" },
});

// V50.z9 — Home Assistant integration screen.
// L'utente configura URL + Long-Lived Access Token della propria istanza HA.
// Poi vede tutte le entità (luci, tapparelle, serrature, switch, scene) e
// può accenderle/spegnerle con un tap. Ideale abbinato a IoT già in casa.
//
// Come ottenere il token:
//   1. Apri il tuo Home Assistant → Profilo (icona in basso a sx)
//   2. Scorri fino a "Long-Lived Access Tokens" → Crea token
//   3. Copialo (viene mostrato una sola volta) e incollalo qui.

import { useCallback, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator,
  Alert, RefreshControl, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { api } from "@/src/api";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";

type HAConfig = {
  connected: boolean;
  base_url?: string;
  verified?: boolean;
  last_verified_at?: string | null;
  label?: string | null;
  last_error?: string | null;
};

type HAEntity = {
  entity_id: string;
  domain: string;
  state: string;
  friendly_name: string;
  icon?: string | null;
  brightness?: number | null;
  current_position?: number | null;
};

const DOMAIN_ICONS: Record<string, keyof typeof import("@expo/vector-icons/Ionicons").glyphMap> = {
  light: "bulb-outline",
  switch: "flash-outline",
  cover: "square-outline",
  lock: "lock-closed-outline",
  scene: "color-palette-outline",
  climate: "thermometer-outline",
  fan: "sync-outline",
  media_player: "musical-notes-outline",
  vacuum: "car-outline",
  input_boolean: "toggle-outline",
  button: "radio-button-on-outline",
};

const DOMAIN_LABELS: Record<string, string> = {
  light: "Luci",
  switch: "Interruttori",
  cover: "Tapparelle/Cancelli",
  lock: "Serrature",
  scene: "Scene",
  climate: "Clima",
  fan: "Ventole",
  media_player: "Media",
  vacuum: "Aspirapolvere",
  input_boolean: "Toggle",
  button: "Pulsanti",
};

export default function HomeAssistantScreen() {
  const router = useRouter();
  const bottomPad = usePageBottomPadding(24);
  const [cfg, setCfg] = useState<HAConfig | null>(null);
  const [entities, setEntities] = useState<HAEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showEditor, setShowEditor] = useState(false);

  const load = useCallback(async () => {
    try {
      const c = await api<HAConfig>("/homeassistant/config");
      setCfg(c);
      if (c.connected && c.verified) {
        try {
          const r = await api<{ items: HAEntity[] }>("/homeassistant/entities");
          setEntities(r.items || []);
        } catch (e: any) {
          Alert.alert("HA offline?", e?.message || "Impossibile leggere le entità");
          setEntities([]);
        }
      } else {
        setEntities([]);
      }
    } catch (e: any) {
      Alert.alert("Errore", e?.message || "Impossibile caricare");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const grouped = useMemo(() => {
    const g: Record<string, HAEntity[]> = {};
    for (const e of entities) {
      (g[e.domain] ||= []).push(e);
    }
    return g;
  }, [entities]);

  const onToggle = async (e: HAEntity) => {
    // Optimistic
    const nextState = e.state === "on" ? "off" : e.domain === "lock" ? (e.state === "locked" ? "unlocked" : "locked") : "on";
    setEntities((prev) => prev.map((x) => x.entity_id === e.entity_id ? { ...x, state: nextState } : x));
    try {
      await api("/homeassistant/toggle", { method: "POST", body: { entity_id: e.entity_id } });
      // Ri-sync dopo 400ms per stato reale
      setTimeout(() => load(), 400);
    } catch (err: any) {
      setEntities((prev) => prev.map((x) => x.entity_id === e.entity_id ? { ...x, state: e.state } : x));
      Alert.alert("Errore", err?.message || "Comando fallito");
    }
  };

  const onDisconnect = () => {
    Alert.alert("Disconnetti", "Vuoi rimuovere Home Assistant?", [
      { text: "Annulla", style: "cancel" },
      {
        text: "Disconnetti", style: "destructive", onPress: async () => {
          try {
            await api("/homeassistant/config", { method: "DELETE" });
            setCfg({ connected: false });
            setEntities([]);
          } catch (e: any) {
            Alert.alert("Errore", e?.message || "Impossibile disconnettere");
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.hBtn} testID="ha-back">
          <Ionicons name="chevron-back" size={24} color="#FFF" />
        </Pressable>
        <Text style={styles.headerTitle}>Home Assistant</Text>
        {cfg?.connected ? (
          <Pressable onPress={() => setShowEditor(true)} hitSlop={10} style={styles.hBtn} testID="ha-edit">
            <Ionicons name="cog-outline" size={22} color="#FFF" />
          </Pressable>
        ) : (
          <View style={{ width: 30 }} />
        )}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#FBBF24" size="large" />
        </View>
      ) : !cfg?.connected ? (
        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: bottomPad, gap: 14 }}
        >
          <View style={styles.emptyHero}>
            <Ionicons name="home-outline" size={54} color="#FBBF24" />
            <Text style={styles.emptyTitle}>Connetti la tua casa</Text>
            <Text style={styles.emptySub}>
              Home Assistant è la piattaforma open-source per la domotica più usata al mondo
              (self-hosted, gratis). Con questa integrazione Axon può accendere luci, aprire
              tapparelle, controllare serrature, scene e molto altro.
            </Text>
          </View>
          <View style={styles.stepBox}>
            <Text style={styles.stepTitle}>Come collegarti (2 minuti):</Text>
            <StepLine n={1} text="Apri la tua istanza Home Assistant nel browser." />
            <StepLine n={2} text="Vai su Profilo (icona in basso a sinistra)." />
            <StepLine n={3} text='Scorri fino a "Long-Lived Access Tokens" → Crea token.' />
            <StepLine n={4} text="Copia il token (viene mostrato una sola volta)." />
            <StepLine n={5} text="Torna qui, premi 'Connetti' e incolla token + URL." />
          </View>
          <Pressable onPress={() => setShowEditor(true)} style={styles.connectBtn} testID="ha-connect">
            <Ionicons name="link" size={18} color="#0F172A" />
            <Text style={styles.connectTxt}>Connetti Home Assistant</Text>
          </Pressable>
          <View style={styles.oshint}>
            <Ionicons name="information-circle-outline" size={16} color="#94A3B8" />
            <Text style={styles.oshintTxt}>
              Non hai ancora HA? Puoi installarlo su un Raspberry Pi, NAS Synology, mini PC
              o VM. Guida: home-assistant.io/installation
            </Text>
          </View>
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 14, paddingBottom: bottomPad, gap: 14 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor="#FBBF24"
            />
          }
        >
          <View style={styles.statusBox}>
            <Ionicons name={cfg.verified ? "checkmark-circle" : "warning"} size={22} color={cfg.verified ? "#22C55E" : "#F59E0B"} />
            <View style={{ flex: 1 }}>
              <Text style={styles.statusTitle}>{cfg.label || "Casa"}</Text>
              <Text style={styles.statusSub} numberOfLines={1}>{cfg.base_url}</Text>
              {cfg.last_error && !cfg.verified ? (
                <Text style={styles.statusErr}>Ultimo errore: {cfg.last_error}</Text>
              ) : null}
            </View>
            <Pressable onPress={onDisconnect} hitSlop={8} style={styles.disconnectBtn}>
              <Ionicons name="log-out-outline" size={18} color="#EF4444" />
            </Pressable>
          </View>

          {entities.length === 0 ? (
            <View style={styles.emptyHero}>
              <Text style={styles.emptyTitle}>Nessuna entità</Text>
              <Text style={styles.emptySub}>
                Nessun dispositivo supportato trovato. Configura almeno una luce, un
                interruttore o una tapparella in HA.
              </Text>
            </View>
          ) : (
            Object.keys(grouped).map((domain) => (
              <View key={domain} style={styles.groupBox}>
                <View style={styles.groupHead}>
                  <Ionicons
                    name={DOMAIN_ICONS[domain] || "cube-outline"}
                    size={18}
                    color="#FBBF24"
                  />
                  <Text style={styles.groupTitle}>{DOMAIN_LABELS[domain] || domain}</Text>
                  <Text style={styles.groupCount}>{grouped[domain].length}</Text>
                </View>
                {grouped[domain].map((e) => (
                  <EntityRow key={e.entity_id} e={e} onToggle={() => onToggle(e)} />
                ))}
              </View>
            ))
          )}
        </ScrollView>
      )}

      {showEditor && (
        <HAEditor
          initial={cfg?.connected ? cfg : null}
          onClose={() => setShowEditor(false)}
          onSaved={(saved) => {
            setCfg(saved);
            setShowEditor(false);
            setTimeout(load, 200);
          }}
        />
      )}
    </SafeAreaView>
  );
}

function StepLine({ n, text }: { n: number; text: string }) {
  return (
    <View style={styles.stepRow}>
      <View style={styles.stepNum}><Text style={styles.stepNumTxt}>{n}</Text></View>
      <Text style={styles.stepTxt}>{text}</Text>
    </View>
  );
}

function EntityRow({ e, onToggle }: { e: HAEntity; onToggle: () => void }) {
  const on = e.state === "on" || e.state === "open" || e.state === "unlocked" || e.state === "playing";
  const stateLabel = translateState(e.state);
  return (
    <Pressable onPress={onToggle} style={[styles.entRow, on && styles.entRowOn]} testID={`ent-${e.entity_id}`}>
      <Ionicons
        name={DOMAIN_ICONS[e.domain] || "cube-outline"}
        size={22}
        color={on ? "#FBBF24" : "#94A3B8"}
      />
      <View style={{ flex: 1 }}>
        <Text style={styles.entName} numberOfLines={1}>{e.friendly_name}</Text>
        <Text style={styles.entState}>{stateLabel}</Text>
      </View>
      <View style={[styles.stateBadge, on && styles.stateBadgeOn]}>
        <Text style={[styles.stateBadgeTxt, on && styles.stateBadgeTxtOn]}>{on ? "ON" : "OFF"}</Text>
      </View>
    </Pressable>
  );
}

function translateState(s: string): string {
  const m: Record<string, string> = {
    on: "Acceso", off: "Spento",
    open: "Aperto", closed: "Chiuso",
    locked: "Bloccato", unlocked: "Sbloccato",
    playing: "In riproduzione", paused: "In pausa", idle: "In attesa",
    unavailable: "Non disponibile", unknown: "Sconosciuto",
    home: "Presente", not_home: "Assente",
  };
  return m[s] || s;
}

// ─── Editor ─────────────────────────────────────────────────
function HAEditor({ initial, onClose, onSaved }: {
  initial: HAConfig | null;
  onClose: () => void;
  onSaved: (c: HAConfig) => void;
}) {
  const [baseUrl, setBaseUrl] = useState(initial?.base_url || "http://homeassistant.local:8123");
  const [token, setToken] = useState("");
  const [label, setLabel] = useState(initial?.label || "Casa");
  const [saving, setSaving] = useState(false);
  const [showToken, setShowToken] = useState(false);

  const onSave = async () => {
    if (!baseUrl.startsWith("http")) {
      Alert.alert("URL non valido", "Deve iniziare con http:// o https://");
      return;
    }
    if (!token || token.length < 20) {
      Alert.alert("Token mancante", "Incolla il Long-Lived Access Token generato dal tuo HA.");
      return;
    }
    setSaving(true);
    try {
      const r = await api<HAConfig>("/homeassistant/config", {
        method: "POST",
        body: { base_url: baseUrl.trim(), access_token: token.trim(), label: label.trim() },
      });
      if (!r.verified) {
        Alert.alert(
          "Connessione salvata ma non verificata",
          r.last_error ||
            "Non sono riuscito a raggiungere l'istanza HA con questi dati. Controlla URL e token, poi torna qui.",
        );
      }
      onSaved(r);
    } catch (e: any) {
      Alert.alert("Errore", e?.message || "Impossibile salvare");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.editorOverlay}>
      <SafeAreaView style={styles.editorSafe} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={10} style={styles.hBtn}>
            <Ionicons name="close" size={24} color="#FFF" />
          </Pressable>
          <Text style={styles.headerTitle}>Configura Home Assistant</Text>
          <View style={{ width: 30 }} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 14, gap: 14 }} keyboardShouldPersistTaps="handled">
          <View>
            <Text style={styles.fieldLabel}>URL Home Assistant</Text>
            <TextInput
              value={baseUrl}
              onChangeText={setBaseUrl}
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType={Platform.OS === "ios" ? "url" : "default"}
              placeholder="http://192.168.1.100:8123"
              placeholderTextColor="#64748B"
            />
            <Text style={styles.hint}>
              L&apos;IP + porta della tua istanza (locale o remota). Es. http://homeassistant.local:8123 oppure https://xxx.duckdns.org
            </Text>
          </View>

          <View>
            <Text style={styles.fieldLabel}>Long-Lived Access Token</Text>
            <View style={{ position: "relative" }}>
              <TextInput
                value={token}
                onChangeText={setToken}
                style={[styles.input, { paddingRight: 44 }]}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry={!showToken}
                placeholder="Incolla qui il token…"
                placeholderTextColor="#64748B"
                multiline={showToken}
              />
              <Pressable
                onPress={() => setShowToken((v) => !v)}
                style={styles.eyeBtn}
                hitSlop={6}
              >
                <Ionicons name={showToken ? "eye-off-outline" : "eye-outline"} size={18} color="#94A3B8" />
              </Pressable>
            </View>
            <Text style={styles.hint}>
              HA → Profilo (basso sx) → &quot;Long-Lived Access Tokens&quot; → Crea token → Copia.
            </Text>
          </View>

          <View>
            <Text style={styles.fieldLabel}>Etichetta (opzionale)</Text>
            <TextInput
              value={label}
              onChangeText={setLabel}
              style={styles.input}
              placeholder="Casa, Ufficio…"
              placeholderTextColor="#64748B"
              maxLength={60}
            />
          </View>

          <View style={styles.securityBox}>
            <Ionicons name="shield-checkmark" size={18} color="#22C55E" />
            <Text style={styles.securityTxt}>
              Il token è cifrato con Fernet lato server e mai esposto al client dopo il salvataggio.
              Solo tu (utente autenticato) puoi usarlo.
            </Text>
          </View>

          <Pressable
            onPress={onSave}
            disabled={saving}
            style={[styles.connectBtn, saving && { opacity: 0.6 }]}
            testID="ha-save"
          >
            {saving ? (
              <ActivityIndicator color="#0F172A" size="small" />
            ) : (
              <>
                <Ionicons name="save" size={18} color="#0F172A" />
                <Text style={styles.connectTxt}>Salva e verifica</Text>
              </>
            )}
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0F2438" },
  header: {
    height: 52, flexDirection: "row", alignItems: "center",
    justifyContent: "space-between", paddingHorizontal: 12,
    backgroundColor: "#0F2438",
    borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.08)",
  },
  hBtn: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: "#FFF", fontSize: 17, fontWeight: "800" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  emptyHero: { alignItems: "center", padding: 20, gap: 8 },
  emptyTitle: { color: "#FFF", fontSize: 18, fontWeight: "800", marginTop: 12, textAlign: "center" },
  emptySub: { color: "#94A3B8", fontSize: 13, textAlign: "center", lineHeight: 20 },

  stepBox: {
    backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 14,
    padding: 14, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", gap: 10,
  },
  stepTitle: { color: "#FBBF24", fontSize: 14, fontWeight: "800", marginBottom: 4 },
  stepRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  stepNum: { width: 24, height: 24, borderRadius: 12, backgroundColor: "rgba(251,191,36,0.2)", alignItems: "center", justifyContent: "center" },
  stepNumTxt: { color: "#FBBF24", fontSize: 12, fontWeight: "900" },
  stepTxt: { flex: 1, color: "#E2E8F0", fontSize: 13, lineHeight: 20 },

  connectBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: "#FBBF24", paddingVertical: 14, borderRadius: 999,
    shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 4,
  },
  connectTxt: { color: "#0F172A", fontSize: 15, fontWeight: "900" },
  oshint: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 10 },
  oshintTxt: { flex: 1, color: "#94A3B8", fontSize: 12, lineHeight: 18 },

  statusBox: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 14,
    padding: 14, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)",
  },
  statusTitle: { color: "#FFF", fontSize: 15, fontWeight: "800" },
  statusSub: { color: "#94A3B8", fontSize: 12, marginTop: 2 },
  statusErr: { color: "#EF4444", fontSize: 11, marginTop: 4 },
  disconnectBtn: { padding: 6 },

  groupBox: {
    backgroundColor: "rgba(255,255,255,0.03)", borderRadius: 14,
    padding: 10, gap: 6, borderWidth: 1, borderColor: "rgba(255,255,255,0.06)",
  },
  groupHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  groupTitle: { color: "#FBBF24", fontSize: 13, fontWeight: "800", flex: 1 },
  groupCount: { color: "#64748B", fontSize: 12, fontWeight: "700" },

  entRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    padding: 12, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.06)",
  },
  entRowOn: { borderColor: "rgba(251,191,36,0.4)", backgroundColor: "rgba(251,191,36,0.08)" },
  entName: { color: "#FFF", fontSize: 14, fontWeight: "700" },
  entState: { color: "#94A3B8", fontSize: 11, marginTop: 2 },
  stateBadge: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8,
    backgroundColor: "rgba(148,163,184,0.15)",
  },
  stateBadgeOn: { backgroundColor: "rgba(251,191,36,0.25)" },
  stateBadgeTxt: { color: "#94A3B8", fontSize: 11, fontWeight: "900" },
  stateBadgeTxtOn: { color: "#FBBF24" },

  // Editor
  editorOverlay: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "#0F2438",
  },
  editorSafe: { flex: 1, backgroundColor: "#0F2438" },
  fieldLabel: {
    color: "#94A3B8", fontSize: 12, fontWeight: "700", marginBottom: 6,
    textTransform: "uppercase", letterSpacing: 0.5,
  },
  input: {
    backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, color: "#FFF", fontSize: 14,
  },
  eyeBtn: { position: "absolute", right: 10, top: 10, padding: 4 },
  hint: { color: "#64748B", fontSize: 11, marginTop: 6, fontStyle: "italic" },
  securityBox: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "rgba(34,197,94,0.08)", borderRadius: 10,
    padding: 12, borderWidth: 1, borderColor: "rgba(34,197,94,0.25)",
  },
  securityTxt: { flex: 1, color: "#22C55E", fontSize: 12, lineHeight: 18 },
});

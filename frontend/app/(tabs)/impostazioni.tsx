import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { theme } from "@/src/theme";
import { pickAvatarBase64 } from "@/src/image-picker";
import { notify, confirmAsync } from "@/src/utils/notify";

type Settings = {
  energy_title: string; energy_color: string;
  network_title: string; network_color: string;
  app_name?: string;
  custom_appointment_types?: string[];
  custom_product_categories?: { name: string; subs?: string[] }[];
  custom_areas?: { id: string; name: string; color: string; icon?: string }[];
};

const COLOR_SWATCHES = ["#EF4444", "#F97316", "#F59E0B", "#22C55E", "#10B981", "#06B6D4", "#3B82F6", "#2563EB", "#8B5CF6", "#EC4899", "#F43F5E", "#84CC16"];

export default function ImpostazioniScreen() {
  const { user, logout, refresh } = useAuth();
  const router = useRouter();
  const [s, setS] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [ok, setOk] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  // V38H — additional emails management
  const [emailInput, setEmailInput] = useState("");
  const [emailsBusy, setEmailsBusy] = useState(false);
  const [aptTypeInput, setAptTypeInput] = useState("");
  const [prodCatInput, setProdCatInput] = useState("");
  const [subInputs, setSubInputs] = useState<Record<number, string>>({});
  const [assistantName, setAssistantName] = useState<string>("Neo");
  const [assistantNameSaved, setAssistantNameSaved] = useState(false);
  const [assistantMode, setAssistantMode] = useState<"text" | "voice" | "both">("text");
  const [assistantVoice, setAssistantVoice] = useState<string>("nova");
  const assistantSaveTimer = React.useRef<any>(null);

  const persistAndReload = async (next: Settings) => {
    setS(next);
    try { await api("/settings", { method: "PUT", body: next }); } catch {}
  };

  const addAptType = () => {
    if (!s) return;
    const t = aptTypeInput.trim();
    if (!t) return;
    const list = s.custom_appointment_types || [];
    if (list.includes(t)) return;
    persistAndReload({ ...s, custom_appointment_types: [...list, t] });
    setAptTypeInput("");
  };
  const removeAptType = (t: string) => {
    if (!s) return;
    persistAndReload({ ...s, custom_appointment_types: (s.custom_appointment_types || []).filter((x) => x !== t) });
  };
  const addProdCat = () => {
    if (!s) return;
    const name = prodCatInput.trim();
    if (!name) return;
    const list = s.custom_product_categories || [];
    if (list.some((c) => c.name === name)) return;
    persistAndReload({ ...s, custom_product_categories: [...list, { name, subs: [] }] });
    setProdCatInput("");
  };
  const removeProdCat = (idx: number) => {
    if (!s) return;
    const next = [...(s.custom_product_categories || [])];
    next.splice(idx, 1);
    persistAndReload({ ...s, custom_product_categories: next });
  };
  const addSub = (idx: number) => {
    if (!s) return;
    const v = (subInputs[idx] || "").trim();
    if (!v) return;
    const next = [...(s.custom_product_categories || [])];
    const cat = { ...next[idx] };
    cat.subs = [...(cat.subs || []), v];
    next[idx] = cat;
    persistAndReload({ ...s, custom_product_categories: next });
    setSubInputs({ ...subInputs, [idx]: "" });
  };
  const removeSub = (idx: number, sub: string) => {
    if (!s) return;
    const next = [...(s.custom_product_categories || [])];
    const cat = { ...next[idx] };
    cat.subs = (cat.subs || []).filter((x) => x !== sub);
    next[idx] = cat;
    persistAndReload({ ...s, custom_product_categories: next });
  };

  const changeAvatar = async () => {
    setAvatarBusy(true);
    try {
      const b64 = await pickAvatarBase64();
      if (b64) {
        await api("/auth/profile", { method: "PUT", body: { avatar_base64: b64 } });
        await refresh();
      }
    } finally { setAvatarBusy(false); }
  };

  // V38I — Branding (logo + agency name) for PDF reports
  const [companyName, setCompanyName] = useState<string>(user?.company_name || "");
  const [companyNameSaved, setCompanyNameSaved] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const companyNameTimer = React.useRef<any>(null);
  useEffect(() => { setCompanyName(user?.company_name || ""); }, [user?.company_name]);
  const saveCompanyName = (v: string) => {
    setCompanyName(v);
    setCompanyNameSaved(false);
    if (companyNameTimer.current) clearTimeout(companyNameTimer.current);
    companyNameTimer.current = setTimeout(async () => {
      try {
        await api("/auth/profile", { method: "PUT", body: { company_name: v.trim().slice(0, 80) } });
        await refresh();
        setCompanyNameSaved(true);
        setTimeout(() => setCompanyNameSaved(false), 1800);
      } catch (e: any) { notify("Errore", e?.message || ""); }
    }, 600);
  };
  const uploadCompanyLogo = async () => {
    setLogoBusy(true);
    try {
      const b64 = await pickAvatarBase64();
      if (b64) {
        await api("/auth/profile", { method: "PUT", body: { company_logo_base64: b64 } });
        await refresh();
      }
    } catch (e: any) { notify("Errore logo", e?.message || ""); }
    finally { setLogoBusy(false); }
  };
  const removeCompanyLogo = async () => {
    const ok = await confirmAsync("Rimuovi logo", "Vuoi togliere il logo aziendale dai report?");
    if (!ok) return;
    setLogoBusy(true);
    try {
      await api("/auth/profile", { method: "PUT", body: { company_logo_base64: "" } });
      await refresh();
    } catch (e: any) { notify("Errore", e?.message || ""); }
    finally { setLogoBusy(false); }
  };

  const load = useCallback(async () => setS(await api<Settings>("/settings")), []);
  useEffect(() => { load(); }, [load]);

  // Load user-level settings (assistant name / mode / voice)
  useEffect(() => {
    (async () => {
      try {
        const us = await api<{ assistant_name?: string; assistant_response_mode?: string; assistant_voice?: string }>("/user-settings");
        if (us?.assistant_name) setAssistantName(us.assistant_name);
        if (us?.assistant_response_mode) setAssistantMode(us.assistant_response_mode as any);
        if (us?.assistant_voice) setAssistantVoice(us.assistant_voice);
      } catch {}
    })();
  }, []);

  const saveAssistantMode = async (m: "text" | "voice" | "both") => {
    setAssistantMode(m);
    try {
      await api("/user-settings", { method: "PUT", body: { assistant_response_mode: m } });
    } catch {}
  };

  const saveAssistantVoice = async (v: string) => {
    setAssistantVoice(v);
    try {
      await api("/user-settings", { method: "PUT", body: { assistant_voice: v } });
    } catch {}
  };

  const saveAssistantName = (name: string) => {
    setAssistantName(name);
    setAssistantNameSaved(false);
    if (assistantSaveTimer.current) clearTimeout(assistantSaveTimer.current);
    assistantSaveTimer.current = setTimeout(async () => {
      const trimmed = (name || "").trim().slice(0, 40) || "Neo";
      try {
        await api("/user-settings", { method: "PUT", body: { assistant_name: trimmed } });
        setAssistantNameSaved(true);
        setTimeout(() => setAssistantNameSaved(false), 1800);
      } catch {}
    }, 600);
  };

  const save = async () => {
    if (!s) return;
    setSaving(true); setOk(false);
    try { await api("/settings", { method: "PUT", body: s }); setOk(true); }
    finally { setSaving(false); setTimeout(() => setOk(false), 2000); }
  };

  if (!s) return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ActivityIndicator style={{ marginTop: 40 }} color={theme.color.brandPrimary} />
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}><Text style={styles.title}>Profilo & Impostazioni</Text></View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        <View style={styles.card}>
          <View style={styles.profileHead}>
            <Pressable testID="profile-avatar-btn" onPress={changeAvatar} style={styles.avatarWrap} disabled={avatarBusy}>
              {user?.avatar_base64 ? (
                <Image source={{ uri: user.avatar_base64 }} style={styles.avatarImg} />
              ) : (
                <View style={styles.avatar}><Text style={styles.avatarTxt}>{user?.name?.[0]?.toUpperCase()}</Text></View>
              )}
              <View style={styles.avatarBadge}>
                {avatarBusy ? <ActivityIndicator size="small" color="#FFF" /> : <Ionicons name="camera" size={14} color="#FFF" />}
              </View>
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{user?.name}</Text>
              <Text style={styles.email}>{user?.email}</Text>
              <Text style={styles.roleBadge}>{user?.parent_user_id ? "Collaboratore" : "Owner"}</Text>
            </View>
          </View>
        </View>

        {/* V38H — Additional emails management (used as sender for birthday/comms) */}
        <View style={styles.linkCard}>
          <Ionicons name="mail-open" size={26} color={theme.color.brandPrimary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.linkTitle}>Email aggiuntive</Text>
            <Text style={styles.linkSub}>Indirizzi da usare come mittente (auguri, comunicazioni)</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
              {(user?.additional_emails || []).map((em) => (
                <View key={em} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, backgroundColor: "#EFF6FF", borderWidth: 1, borderColor: "#DBEAFE" }}>
                  <Text style={{ fontSize: 11, color: theme.color.brandPrimary, fontWeight: "600" }}>{em}</Text>
                  <Pressable
                    testID={`profile-email-del-${em}`}
                    onPress={async () => {
                      const ok = await confirmAsync("Rimuovi email", `Rimuovere "${em}" dagli indirizzi aggiuntivi?`);
                      if (!ok) return;
                      try {
                        setEmailsBusy(true);
                        const next = (user?.additional_emails || []).filter((e) => e !== em);
                        await api("/auth/profile", { method: "PUT", body: { additional_emails: next } });
                        await refresh();
                      } catch (e: any) {
                        notify("Errore", e?.message || "");
                      } finally {
                        setEmailsBusy(false);
                      }
                    }}
                    hitSlop={6}
                  >
                    <Ionicons name="close-circle" size={14} color={theme.color.brandPrimary} />
                  </Pressable>
                </View>
              ))}
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 }}>
              <TextInput
                testID="profile-email-input"
                value={emailInput}
                onChangeText={setEmailInput}
                placeholder="Aggiungi email (es. lavoro@…)"
                placeholderTextColor={theme.color.muted}
                keyboardType="email-address"
                autoCapitalize="none"
                style={{ flex: 1, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, backgroundColor: "#F1F5F9", fontSize: 12, color: theme.color.onSurface }}
              />
              <Pressable
                testID="profile-email-add"
                disabled={emailsBusy || !emailInput.trim().includes("@")}
                onPress={async () => {
                  const em = emailInput.trim().toLowerCase();
                  if (!em.includes("@")) return;
                  const existing = user?.additional_emails || [];
                  if (existing.includes(em) || user?.email === em) {
                    setEmailInput("");
                    return;
                  }
                  try {
                    setEmailsBusy(true);
                    await api("/auth/profile", { method: "PUT", body: { additional_emails: [...existing, em] } });
                    setEmailInput("");
                    await refresh();
                  } catch (e: any) {
                    notify("Errore", e?.message || "");
                  } finally {
                    setEmailsBusy(false);
                  }
                }}
                style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: theme.color.brandPrimary, opacity: (!emailInput.trim().includes("@") || emailsBusy) ? 0.5 : 1 }}
              >
                {emailsBusy ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={{ color: "#FFF", fontWeight: "700", fontSize: 12 }}>+</Text>}
              </Pressable>
            </View>
          </View>
        </View>

        {!user?.parent_user_id && (
          <Pressable testID="team-link" onPress={() => router.push("/team")} style={styles.linkCard}>
            <Ionicons name="people-circle" size={26} color={theme.color.brandPrimary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.linkTitle}>Gestione Team</Text>
              <Text style={styles.linkSub}>Invita collaboratori e assegna aree</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={theme.color.muted} />
          </Pressable>
        )}

        {!user?.parent_user_id && (
          <Pressable testID="invitati-link" onPress={() => router.push("/invitati")} style={styles.linkCard}>
            <Ionicons name="person-add" size={26} color={theme.color.brandPrimary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.linkTitle}>Clienti invitati</Text>
              <Text style={styles.linkSub}>Genera link invito, monitora trial, estendi giorni</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={theme.color.muted} />
          </Pressable>
        )}

        <Pressable testID="groups-link" onPress={() => router.push("/groups")} style={styles.linkCard}>
          <Ionicons name="people-outline" size={26} color={theme.color.brandPrimary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.linkTitle}>Gruppi Contatti</Text>
            <Text style={styles.linkSub}>Crea gruppi personalizzati per invii bulk</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={theme.color.muted} />
        </Pressable>

        <Pressable testID="security-link" onPress={() => router.push("/security")} style={styles.linkCard}>
          <Ionicons name="shield-checkmark" size={26} color={theme.color.brandPrimary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.linkTitle}>Sicurezza & 2FA</Text>
            <Text style={styles.linkSub}>Autenticazione a due fattori, PIN e biometria</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={theme.color.muted} />
        </Pressable>

        {/* V38I — Branding aziendale for PDF reports (owner only) */}
        {!user?.parent_user_id && (
          <View style={styles.card} testID="branding-card">
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "#FEF3C7", justifyContent: "center", alignItems: "center" }}>
                <Ionicons name="ribbon" size={20} color="#B45309" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sectionTitle}>Branding aziendale</Text>
                <Text style={{ fontSize: 12, color: theme.color.muted, marginTop: 2 }}>
                  Logo e nome che appaiono sui PDF (report Fatture, confronti offerte)
                </Text>
              </View>
            </View>

            <Text style={[styles.label, { marginTop: 14 }]}>Nome agenzia / studio</Text>
            <TextInput
              testID="branding-name-input"
              value={companyName}
              onChangeText={saveCompanyName}
              style={styles.input}
              placeholder="Es. Dal Pastro Consulting"
              placeholderTextColor="#94A3B8"
              maxLength={80}
            />
            <Text style={{ fontSize: 11, color: companyNameSaved ? "#16A34A" : theme.color.muted, marginTop: 4 }}>
              {companyNameSaved ? "✓ Nome agenzia salvato" : "Salvataggio automatico dopo la digitazione."}
            </Text>

            <Text style={[styles.label, { marginTop: 14 }]}>Logo agenzia</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 6 }}>
              <View style={{ width: 84, height: 84, borderRadius: 12, backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: theme.color.border, justifyContent: "center", alignItems: "center", overflow: "hidden" }}>
                {user?.company_logo_base64 ? (
                  <Image source={{ uri: user.company_logo_base64 }} style={{ width: "100%", height: "100%", resizeMode: "contain" }} />
                ) : (
                  <Ionicons name="image" size={30} color={theme.color.muted} />
                )}
              </View>
              <View style={{ flex: 1, gap: 8 }}>
                <Pressable
                  testID="branding-logo-upload"
                  onPress={uploadCompanyLogo}
                  disabled={logoBusy}
                  style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 8, backgroundColor: theme.color.brandPrimary, opacity: logoBusy ? 0.5 : 1 }}
                >
                  {logoBusy ? <ActivityIndicator size="small" color="#FFF" /> : <Ionicons name="cloud-upload" size={16} color="#FFF" />}
                  <Text style={{ color: "#FFF", fontWeight: "700", fontSize: 12 }}>{user?.company_logo_base64 ? "Cambia logo" : "Carica logo"}</Text>
                </Pressable>
                {user?.company_logo_base64 && (
                  <Pressable
                    testID="branding-logo-remove"
                    onPress={removeCompanyLogo}
                    disabled={logoBusy}
                    style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 8, borderRadius: 8, backgroundColor: "#FEE2E2", borderWidth: 1, borderColor: "#FCA5A5" }}
                  >
                    <Ionicons name="trash" size={14} color="#DC2626" />
                    <Text style={{ color: "#DC2626", fontWeight: "700", fontSize: 12 }}>Rimuovi</Text>
                  </Pressable>
                )}
              </View>
            </View>
            <Text style={{ fontSize: 11, color: theme.color.muted, marginTop: 8, fontStyle: "italic" }}>
              Consigliato: PNG/JPG orizzontale, max 500 KB, sfondo trasparente/bianco.
            </Text>
          </View>
        )}

        {/* AI Assistant customization — available to all users */}
        <View style={styles.card} testID="assistant-name-card">
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "#F1EEFF", justifyContent: "center", alignItems: "center" }}>
              <Ionicons name="sparkles" size={20} color="#7C3AED" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.sectionTitle}>Assistente AI</Text>
              <Text style={{ fontSize: 12, color: theme.color.muted, marginTop: 2 }}>
                Personalizza il nome del tuo assistente personale
              </Text>
            </View>
          </View>
          <Text style={[styles.label, { marginTop: 12 }]}>Nome dell&apos;assistente</Text>
          <TextInput
            testID="assistant-name-input"
            value={assistantName}
            onChangeText={saveAssistantName}
            style={styles.input}
            placeholder="Neo"
            placeholderTextColor="#94A3B8"
            maxLength={40}
          />
          <Text style={{ fontSize: 11, color: assistantNameSaved ? "#16A34A" : theme.color.muted, marginTop: 4 }}>
            {assistantNameSaved ? "✓ Salvato" : `Tocca il pulsante viola con il robot in basso a destra per chattare con ${assistantName || "Neo"}.`}
          </Text>

          {/* Response mode picker */}
          <Text style={[styles.label, { marginTop: 14 }]}>Modalità di risposta</Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
            {([
              { key: "text", label: "Solo testo", icon: "chatbox-ellipses" },
              { key: "voice", label: "Solo voce", icon: "volume-high" },
              { key: "both", label: "Voce e testo", icon: "megaphone" },
            ] as const).map((opt) => {
              const active = assistantMode === opt.key;
              return (
                <Pressable
                  key={opt.key}
                  testID={`assistant-mode-${opt.key}`}
                  onPress={() => saveAssistantMode(opt.key)}
                  style={[
                    { flex: 1, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 8, alignItems: "center", borderWidth: 1 },
                    active
                      ? { backgroundColor: "#F1EEFF", borderColor: "#7C3AED" }
                      : { backgroundColor: theme.color.surface, borderColor: theme.color.border },
                  ]}
                >
                  <Ionicons name={opt.icon as any} size={18} color={active ? "#7C3AED" : theme.color.muted} />
                  <Text style={{ fontSize: 11, marginTop: 4, color: active ? "#7C3AED" : theme.color.onSurface, fontWeight: active ? "700" : "500", textAlign: "center" }}>
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {(assistantMode === "voice" || assistantMode === "both") && (
            <>
              <Text style={[styles.label, { marginTop: 14 }]}>Voce dell&apos;assistente</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
                {[
                  { key: "nova", label: "Nova (F, chiara)" },
                  { key: "shimmer", label: "Shimmer (F, calda)" },
                  { key: "alloy", label: "Alloy (neutra)" },
                  { key: "onyx", label: "Onyx (M, grave)" },
                  { key: "echo", label: "Echo (M, morbida)" },
                  { key: "fable", label: "Fable (narrativa)" },
                ].map((v) => {
                  const active = assistantVoice === v.key;
                  return (
                    <Pressable
                      key={v.key}
                      testID={`assistant-voice-${v.key}`}
                      onPress={() => saveAssistantVoice(v.key)}
                      style={[
                        { borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14, borderWidth: 1 },
                        active
                          ? { backgroundColor: "#7C3AED", borderColor: "#7C3AED" }
                          : { backgroundColor: theme.color.surface, borderColor: theme.color.border },
                      ]}
                    >
                      <Text style={{ fontSize: 12, color: active ? "#FFF" : theme.color.onSurface, fontWeight: "600" }}>
                        {v.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </>
          )}
        </View>

        {!user?.parent_user_id && (
          <Pressable testID="smtp-link" onPress={() => router.push("/smtp")} style={styles.linkCard}>
            <Ionicons name="mail-open" size={26} color={theme.color.brandPrimary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.linkTitle}>Configurazione Email (SMTP)</Text>
              <Text style={styles.linkSub}>Aruba, Gmail o altro provider per invii bulk</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={theme.color.muted} />
          </Pressable>
        )}

        {!user?.parent_user_id && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Personalizza aree</Text>

          <Text style={styles.label}>Nome App</Text>
          <TextInput
            testID="settings-app-name"
            value={s.app_name || "Dal Pastro CRM"}
            onChangeText={(t) => setS({ ...s, app_name: t })}
            style={styles.input}
            placeholder="Nome della tua app"
            placeholderTextColor="#94A3B8"
          />

          <Text style={styles.label}>Titolo Area 1 (Energia)</Text>
          <TextInput
            testID="settings-energy-title"
            value={s.energy_title}
            onChangeText={(t) => setS({ ...s, energy_title: t })}
            style={styles.input}
          />
          <Text style={styles.label}>Colore Area 1</Text>
          <View style={styles.swatches}>
            {COLOR_SWATCHES.map((c) => (
              <Pressable
                key={"e"+c}
                testID={`energy-color-${c}`}
                onPress={() => setS({ ...s, energy_color: c })}
                style={[styles.swatch, { backgroundColor: c }, s.energy_color === c && styles.swatchActive]}
              >
                {s.energy_color === c && <Ionicons name="checkmark" size={16} color="#FFF" />}
              </Pressable>
            ))}
          </View>
          <View style={styles.hexRow}>
            <View style={[styles.hexPreview, { backgroundColor: s.energy_color }]} />
            <TextInput
              testID="settings-energy-hex"
              value={s.energy_color}
              onChangeText={(t) => setS({ ...s, energy_color: t.startsWith("#") ? t : "#" + t.replace(/[^0-9a-fA-F]/g, "").slice(0, 6) })}
              style={[styles.input, { flex: 1 }]}
              placeholder="#RRGGBB"
              placeholderTextColor="#94A3B8"
              autoCapitalize="characters"
              maxLength={7}
            />
          </View>

          <View style={{ height: 12 }} />
          <Text style={styles.label}>Titolo Area 2 (Network)</Text>
          <TextInput
            testID="settings-network-title"
            value={s.network_title}
            onChangeText={(t) => setS({ ...s, network_title: t })}
            style={styles.input}
          />
          <Text style={styles.label}>Colore Area 2</Text>
          <View style={styles.swatches}>
            {COLOR_SWATCHES.map((c) => (
              <Pressable
                key={"n"+c}
                testID={`network-color-${c}`}
                onPress={() => setS({ ...s, network_color: c })}
                style={[styles.swatch, { backgroundColor: c }, s.network_color === c && styles.swatchActive]}
              >
                {s.network_color === c && <Ionicons name="checkmark" size={16} color="#FFF" />}
              </Pressable>
            ))}
          </View>
          <View style={styles.hexRow}>
            <View style={[styles.hexPreview, { backgroundColor: s.network_color }]} />
            <TextInput
              testID="settings-network-hex"
              value={s.network_color}
              onChangeText={(t) => setS({ ...s, network_color: t.startsWith("#") ? t : "#" + t.replace(/[^0-9a-fA-F]/g, "").slice(0, 6) })}
              style={[styles.input, { flex: 1 }]}
              placeholder="#RRGGBB"
              placeholderTextColor="#94A3B8"
              autoCapitalize="characters"
              maxLength={7}
            />
          </View>

          <Pressable testID="settings-save" onPress={save} style={styles.saveBtn} disabled={saving}>
            {saving ? <ActivityIndicator color="#FFF" /> : <Text style={styles.saveBtnTxt}>{ok ? "Salvato ✓" : "Salva modifiche"}</Text>}
          </Pressable>
        </View>
        )}

        {!user?.parent_user_id && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Aree contatto personalizzate</Text>
          <Text style={styles.hint}>Oltre a &quot;Consulente Energetico&quot; e &quot;Networker&quot;, gestisci le aree custom (es. Assicurazioni, Immobiliare). Crea nuove aree direttamente dalla scheda contatto.</Text>
          {(s.custom_areas || []).length === 0 ? (
            <Text style={{ color: theme.color.muted, fontSize: 12, fontStyle: "italic", marginTop: 4 }}>Nessuna area personalizzata. Creane dalla schermata Nuovo Contatto → &quot;Nuova area&quot;.</Text>
          ) : (
            <View style={styles.chipsWrap}>
              {(s.custom_areas || []).map((a) => (
                <Pressable
                  key={a.id}
                  onPress={() => {
                    persistAndReload({ ...s, custom_areas: (s.custom_areas || []).filter((x) => x.id !== a.id) });
                  }}
                  style={[styles.chip, { flexDirection: "row", alignItems: "center", backgroundColor: a.color + "33", borderColor: a.color, borderWidth: 1 }]}
                >
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: a.color, marginRight: 6 }} />
                  <Text style={[styles.chipTxt, { color: a.color }]}>{a.name}</Text>
                  <Ionicons name="close" size={12} color={a.color} />
                </Pressable>
              ))}
            </View>
          )}
        </View>
        )}

        {!user?.parent_user_id && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Aree merceologiche / Tipi di appuntamento</Text>
          <Text style={styles.hint}>Modifica e crea nuove aree merceologiche degli appuntamenti (Piano Marketing / Energia / Ant / Dare seguito / Demo prodotti sono predefinite). Puoi eliminarle toccandole.</Text>
          <View style={styles.addRow}>
            <TextInput
              testID="apt-type-input"
              value={aptTypeInput}
              onChangeText={setAptTypeInput}
              placeholder="Es. Aggiornamento cliente"
              placeholderTextColor="#94A3B8"
              style={[styles.input, { flex: 1 }]}
              onSubmitEditing={() => addAptType()}
            />
            <Pressable testID="apt-type-add" onPress={addAptType} style={styles.addBtn}>
              <Ionicons name="add" size={20} color="#FFF" />
            </Pressable>
          </View>
          {(s.custom_appointment_types || []).length > 0 && (
            <View style={styles.chipsWrap}>
              {(s.custom_appointment_types || []).map((t) => (
                <Pressable key={t} onPress={() => removeAptType(t)} style={styles.chip}>
                  <Text style={styles.chipTxt}>{t}</Text>
                  <Ionicons name="close" size={12} color={theme.color.brandPrimary} />
                </Pressable>
              ))}
            </View>
          )}
        </View>
        )}

        {!user?.parent_user_id && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Categorie prodotti custom</Text>
          <Text style={styles.hint}>Categorie oltre a &quot;Demo prodotti&quot; (Artistry / Nutrilite / Home). Aggiungi la categoria, poi le sotto-categorie</Text>
          <View style={styles.addRow}>
            <TextInput
              testID="prod-cat-input"
              value={prodCatInput}
              onChangeText={setProdCatInput}
              placeholder="Nome categoria (es. Alta cosmesi)"
              placeholderTextColor="#94A3B8"
              style={[styles.input, { flex: 1 }]}
            />
            <Pressable testID="prod-cat-add" onPress={addProdCat} style={styles.addBtn}>
              <Ionicons name="add" size={20} color="#FFF" />
            </Pressable>
          </View>
          {(s.custom_product_categories || []).map((cat, idx) => (
            <View key={cat.name} style={styles.catCard}>
              <View style={styles.catHead}>
                <Text style={styles.catName}>{cat.name}</Text>
                <Pressable onPress={() => removeProdCat(idx)}><Ionicons name="trash-outline" size={16} color={theme.color.error} /></Pressable>
              </View>
              <View style={styles.addRow}>
                <TextInput
                  value={subInputs[idx] || ""}
                  onChangeText={(t) => setSubInputs({ ...subInputs, [idx]: t })}
                  placeholder="Aggiungi sotto-categoria"
                  placeholderTextColor="#94A3B8"
                  style={[styles.input, { flex: 1 }]}
                />
                <Pressable onPress={() => addSub(idx)} style={styles.addBtn}>
                  <Ionicons name="add" size={18} color="#FFF" />
                </Pressable>
              </View>
              <View style={styles.chipsWrap}>
                {(cat.subs || []).map((sub) => (
                  <Pressable key={sub} onPress={() => removeSub(idx, sub)} style={styles.chip}>
                    <Text style={styles.chipTxt}>{sub}</Text>
                    <Ionicons name="close" size={12} color={theme.color.brandPrimary} />
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
        </View>
        )}

        <Pressable testID="logout-btn" onPress={async () => { await logout(); router.replace("/login"); }} style={styles.logoutBtn}>
          <Ionicons name="log-out-outline" size={20} color={theme.color.error} />
          <Text style={styles.logoutTxt}>Esci</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { paddingHorizontal: 20, paddingVertical: 12 },
  title: { fontSize: 24, fontWeight: "700", color: theme.color.onSurface },
  card: { backgroundColor: "#FFF", borderRadius: theme.radius.md, padding: 16, borderWidth: 1, borderColor: theme.color.border },
  profileHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatarWrap: { position: "relative" },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: theme.color.brandTertiary, alignItems: "center", justifyContent: "center" },
  avatarImg: { width: 52, height: 52, borderRadius: 26 },
  avatarBadge: { position: "absolute", right: -2, bottom: -2, width: 22, height: 22, borderRadius: 11, backgroundColor: theme.color.brandPrimary, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#FFF" },
  avatarTxt: { color: theme.color.brandPrimary, fontWeight: "700", fontSize: 20 },
  name: { fontSize: 16, fontWeight: "700", color: theme.color.onSurface },
  email: { fontSize: 13, color: theme.color.muted, marginTop: 2 },
  roleBadge: { alignSelf: "flex-start", marginTop: 6, backgroundColor: theme.color.brandTertiary, color: theme.color.brandPrimary, fontSize: 11, fontWeight: "700", paddingHorizontal: 8, paddingVertical: 2, borderRadius: theme.radius.pill, overflow: "hidden" },
  linkCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#FFF", padding: 14, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border },
  linkTitle: { fontSize: 15, fontWeight: "700", color: theme.color.onSurface },
  linkSub: { fontSize: 12, color: theme.color.muted, marginTop: 2 },
  sectionTitle: { fontSize: 15, fontWeight: "700", color: theme.color.onSurface, marginBottom: 12 },
  label: { fontSize: 12, color: theme.color.onSurfaceTertiary, fontWeight: "600", marginTop: 10, marginBottom: 6 },
  input: { backgroundColor: theme.color.surface, borderRadius: theme.radius.md, padding: 12, borderWidth: 1, borderColor: theme.color.border, color: theme.color.onSurface },
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  swatch: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "transparent" },
  swatchActive: { borderColor: theme.color.onSurface },
  hexRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  hexPreview: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: theme.color.border },
  saveBtn: { backgroundColor: theme.color.brandPrimary, paddingVertical: 12, borderRadius: theme.radius.md, alignItems: "center", marginTop: 16 },
  saveBtnTxt: { color: "#FFF", fontWeight: "700" },
  logoutBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#FFF", padding: 14, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border },
  logoutTxt: { color: theme.color.error, fontWeight: "700" },
  hint: { fontSize: 11, color: theme.color.muted, marginBottom: 8, fontStyle: "italic" },
  addRow: { flexDirection: "row", gap: 8, alignItems: "center", marginTop: 4 },
  addBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: theme.color.brandPrimary, alignItems: "center", justifyContent: "center" },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: theme.color.brandTertiary, paddingHorizontal: 10, paddingVertical: 4, borderRadius: theme.radius.pill },
  chipTxt: { color: theme.color.brandPrimary, fontWeight: "700", fontSize: 12 },
  catCard: { backgroundColor: theme.color.surface, borderRadius: theme.radius.md, padding: 10, borderWidth: 1, borderColor: theme.color.border, marginTop: 10 },
  catHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  catName: { fontSize: 14, fontWeight: "700", color: theme.color.onSurface },
});

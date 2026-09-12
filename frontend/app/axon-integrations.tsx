// axon-integrations.tsx — V50.z197 — BLOCCO 8 · Fase 1: «Integrazioni AxonOS» a due sfere (schermata ISOLATA)
// Sfera 🔵 Business e sfera 🟢 Home, mai mescolate: ogni card ha un solo tap «Concedi accesso» / «Revoca».
// Google (Calendar + Contacts, + Drive per Home) usa la stessa infrastruttura OAuth di Google Drive (web: redirect; mobile: browser + polling).
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl, Platform, Alert } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import { useInsetsSafe } from "@/src/hooks/useSafeBottom";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { buildOAuthReturn } from "@/src/utils/oauthReturn";

try { WebBrowser.maybeCompleteAuthSession(); } catch { /* noop */ }

type Item = { key: string; label: string; desc: string; provider: string; connected: boolean; account?: string | null; last_sync_at?: string | null; one_tap: boolean;
  manage_route?: string; coming?: boolean; sphere: "business" | "home"; count?: number; configured?: boolean; shared_with?: string };
type Sphere = { label: string; color: string; icon: string; items: Item[] };
type Status = { spheres: { business: Sphere; home: Sphere }; google_configured: boolean };

const ICONS: Record<string, string> = { google_calendar: "calendar", google_calendar_home: "calendar", google_contacts: "people", google_contacts_home: "people", google_drive: "cloud", google_drive_home: "cloud",
  dropbox: "logo-dropbox", bank_statement: "document-text", receipts: "receipt", homeassistant: "home", personal_expenses: "wallet" };

function confirmAsync(title: string, msg: string, ok: string, onOk: () => void) {
  if (Platform.OS === "web") { if ((globalThis as any).window?.confirm(`${title}\n\n${msg}`)) onOk(); return; }
  Alert.alert(title, msg, [{ text: "Annulla", style: "cancel" }, { text: ok, style: "destructive", onPress: onOk }]);
}

export default function AxonIntegrationsScreen() {
  const router = useRouter();
  const insets = useInsetsSafe();
  const [st, setSt] = useState<Status | null>(null);
  const [busy, setBusy] = useState<string>("");

  const load = useCallback(async () => { try { setSt(await api<Status>("/axon/integrations/status")); } catch (e: any) { notify("Integrazioni", e?.message || String(e)); } }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const onFocus = () => load();
    (globalThis as any).window?.addEventListener?.("focus", onFocus);
    return () => (globalThis as any).window?.removeEventListener?.("focus", onFocus);
  }, [load]);

  const connectGoogle = async (sphere: "business" | "home") => {
    setBusy(sphere);
    try {
      const ret = Platform.OS === "web" ? null : buildOAuthReturn("axon-integrations", "google");
      const r = await api<{ authorization_url: string }>("/axon/integrations/google/start", { method: "POST", body: { sphere, ...(ret?.body || {}) } });
      if (Platform.OS === "web" || !ret) { (globalThis as any).window.location.assign(r.authorization_url); return; }
      const res = await WebBrowser.openAuthSessionAsync(r.authorization_url, ret.returnUrl, { showInRecents: false, preferEphemeralSession: true });
      if (res.type === "success" || res.type === "cancel" || res.type === "dismiss") {
        for (let i = 0; i < 14; i++) {
          const s = await api<Status>("/axon/integrations/status").catch(() => null);
          if (s && s.spheres[sphere].items.some((it) => it.provider === "google" && it.connected)) { setSt(s); notify("Collegato", `Google ${sphere === "home" ? "Home" : "Business"} collegato ad Axon`); return; }
          await new Promise((r2) => setTimeout(r2, 1500));
        }
      }
      await load();
    } catch (e: any) { notify("Errore connessione", e?.message || String(e)); } finally { setBusy(""); }
  };

  const revokeGoogle = (sphere: "business" | "home") => confirmAsync("Revoca accesso", `Axon non leggerà più Calendar e Contatti della sfera ${sphere === "home" ? "Home" : "Business"}. I riferimenti sincronizzati vengono cancellati.`, "Revoca", async () => {
    setBusy(sphere);
    try { await api(`/axon/integrations/${sphere}/google`, { method: "DELETE" }); await load(); notify("Revocato", "Accesso Google revocato."); } catch (e: any) { notify("Errore", e?.message || String(e)); } finally { setBusy(""); }
  });

  const syncNow = async (sphere: "business" | "home") => {
    setBusy(`sync-${sphere}`);
    try { const r = await api<any>(`/axon/integrations/${sphere}/sync`, { method: "POST" }); notify("Sincronizzato", `${r.events} eventi · ${r.contacts} contatti${r.pushed ? ` · ${r.pushed} appuntamenti scritti su Calendar` : ""}`); await load(); }
    catch (e: any) { notify("Sync", e?.message || String(e)); } finally { setBusy(""); }
  };

  const renderItem = (it: Item, sphere: Sphere) => {
    const color = sphere.color;
    return (
      <View key={it.key} style={[styles.card, it.connected && { borderColor: color + "88" }]} testID={`axi-card-${it.key}`}>
        <View style={styles.row}>
          <View style={[styles.icon, { backgroundColor: color + "18" }]}><Ionicons name={(ICONS[it.key] || "extension-puzzle") as any} size={18} color={color} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>{it.label}</Text>
            <Text style={styles.desc}>{it.desc}</Text>
            {it.connected ? <Text style={[styles.meta, { color }]}>✓ Collegato{it.account ? ` · ${it.account}` : ""}{typeof it.count === "number" && it.count > 0 ? ` · ${it.count} sincronizzati` : ""}</Text> : it.coming ? <Text style={styles.meta}>In arrivo</Text> : null}
          </View>
        </View>
        <View style={styles.actions}>
          {it.coming ? null : it.provider === "google" ? (
            it.shared_with ? <Text style={styles.hint}>Si attiva insieme a «Google Calendar Home».</Text> : it.connected ? (
              <>
                <Pressable onPress={() => syncNow(it.sphere)} disabled={!!busy} style={[styles.btn, styles.ghost, { borderColor: color }]} testID={`axi-sync-${it.key}`}>
                  {busy === `sync-${it.sphere}` ? <ActivityIndicator size="small" color={color} /> : <><Ionicons name="sync" size={15} color={color} /><Text style={[styles.btnTxt, { color }]}>Sincronizza</Text></>}
                </Pressable>
                <Pressable onPress={() => revokeGoogle(it.sphere)} disabled={!!busy} style={[styles.btn, styles.danger]} testID={`axi-revoke-${it.key}`}>
                  <Ionicons name="close-circle" size={15} color="#DC2626" /><Text style={[styles.btnTxt, { color: "#DC2626" }]}>Revoca</Text>
                </Pressable>
              </>
            ) : (
              <Pressable onPress={() => connectGoogle(it.sphere)} disabled={!!busy || it.configured === false} style={[styles.btn, { backgroundColor: color }]} testID={`axi-connect-${it.key}`}>
                {busy === it.sphere ? <ActivityIndicator size="small" color="#FFF" /> : <><Ionicons name="key" size={15} color="#FFF" /><Text style={[styles.btnTxt, { color: "#FFF" }]}>Concedi accesso</Text></>}
              </Pressable>
            )
          ) : (
            <Pressable onPress={() => it.manage_route && router.push(it.manage_route as any)} style={[styles.btn, it.connected ? [styles.ghost, { borderColor: color }] : { backgroundColor: color }]} testID={`axi-manage-${it.key}`}>
              <Ionicons name={it.connected ? "settings-outline" : "key"} size={15} color={it.connected ? color : "#FFF"} />
              <Text style={[styles.btnTxt, { color: it.connected ? color : "#FFF" }]}>{it.connected ? (it.provider === "axon" ? "Apri" : "Gestisci") : "Concedi accesso"}</Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  };

  const renderSphere = (key: "business" | "home") => {
    const s = st!.spheres[key];
    return (
      <View key={key} style={[styles.sphere, { borderColor: s.color + "55", backgroundColor: s.color + "0D" }]} testID={`axi-sphere-${key}`}>
        <View style={styles.sphereHead}>
          <View style={[styles.dot, { backgroundColor: s.color }]} />
          <Text style={[styles.sphereTitle, { color: s.color }]}>Sfera {s.label}</Text>
          <Text style={styles.sphereSub}>{key === "business" ? "dati di lavoro · CRM" : "dati personali · casa"}</Text>
        </View>
        {s.items.map((it) => renderItem(it, s))}
      </View>
    );
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} testID="axi-back"><Ionicons name="arrow-back" size={22} color="#FFF" /></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Integrazioni AxonOS</Text>
          <Text style={styles.sub}>Un tap per concedere, un tap per revocare</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: insets.bottom + 120, gap: 14 }} refreshControl={<RefreshControl refreshing={!st} onRefresh={load} />}>
        <View style={styles.trust}>
          <Ionicons name="shield-checkmark" size={20} color="#065F46" />
          <Text style={styles.trustTxt}>Due sfere separate: 🔵 Business e 🟢 Home. I dati non si mescolano mai e Axon indica sempre in quale sfera sta operando. Tutto è referenziato, non duplicato, e revocabile con un tap.</Text>
        </View>
        {!st ? <ActivityIndicator color="#7C3AED" style={{ marginTop: 30 }} /> : (<>{renderSphere("business")}{renderSphere("home")}</>)}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#F4F5FA" },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: "#7C3AED" },
  title: { color: "#FFF", fontWeight: "800", fontSize: 17 },
  sub: { color: "#EDE9FE", fontSize: 12 },
  trust: { flexDirection: "row", gap: 10, backgroundColor: "#ECFDF5", borderRadius: 14, padding: 12, borderWidth: 1, borderColor: "#A7F3D0" },
  trustTxt: { flex: 1, fontSize: 12.5, color: "#065F46", lineHeight: 18 },
  sphere: { borderRadius: 18, borderWidth: 1.5, padding: 12, gap: 10 },
  sphereHead: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 2 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  sphereTitle: { fontSize: 16, fontWeight: "900" },
  sphereSub: { flex: 1, fontSize: 11.5, color: "#64748B", textAlign: "right" },
  card: { backgroundColor: "#FFF", borderRadius: 14, borderWidth: 1, borderColor: "#EEF0F6", padding: 12, gap: 10 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  icon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 14.5, fontWeight: "800", color: "#1B2B4B" },
  desc: { fontSize: 12, color: "#64748B", marginTop: 2, lineHeight: 16 },
  meta: { fontSize: 11.5, fontWeight: "700", marginTop: 4, color: "#94A3B8" },
  hint: { fontSize: 11.5, color: "#94A3B8", fontStyle: "italic" },
  actions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  btn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 12, minHeight: 44, paddingHorizontal: 12, minWidth: 130 },
  ghost: { backgroundColor: "#FFF", borderWidth: 1 },
  danger: { backgroundColor: "#FEF2F2", borderWidth: 1, borderColor: "#FECACA" },
  btnTxt: { fontWeight: "800", fontSize: 13 },
});

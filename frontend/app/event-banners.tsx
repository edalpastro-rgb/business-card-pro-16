import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput, ActivityIndicator, Image, Platform, Modal, Switch } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { notify, confirmAsync } from "@/src/utils/notify";
import { uriToBase64 } from "@/src/utils/media";
import { launchLibraryUniversal } from "@/src/utils/imagePickerCompat";
import { ModuleErrorBoundary } from "@/src/shared";

// ---------- Types ----------
type EventBanner = {
  event_id: string;
  title: string;
  event_at: string;
  cover_mime?: string;
  visibility_kind: "all" | "specific";
  visible_user_ids?: string[];
  visible_contact_ids?: string[];
  visible_group_ids?: string[];
  public_token?: string;
  created_at?: string;
};

type TeamMember = { user_id: string; name: string; email?: string; role?: string };
type ContactLite = { contact_id: string; first_name: string; last_name: string };
type GroupLite = { group_id: string; name: string };

// ---------- Route ----------
export default function EventBannersRoute() {
  return (
    <ModuleErrorBoundary moduleName="events">
      <EventBannersScreen />
    </ModuleErrorBoundary>
  );
}

function EventBannersScreen() {
  const router = useRouter();
  const [items, setItems] = useState<EventBanner[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<null | Partial<EventBanner> & { cover_base64?: string; program_pdf_base64?: string; program_pdf_name?: string }>(null);

  // Options
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [contacts, setContacts] = useState<ContactLite[]>([]);
  const [groups, setGroups] = useState<GroupLite[]>([]);

  // Form state (mirrors `editing`)
  const [title, setTitle] = useState("");
  const [dateStr, setDateStr] = useState(""); // yyyy-mm-dd
  const [timeStr, setTimeStr] = useState(""); // HH:mm
  const [cover, setCover] = useState<{ base64: string; mime: string } | null>(null);
  const [visibilityKind, setVisibilityKind] = useState<"all" | "specific">("all");
  const [selUsers, setSelUsers] = useState<Set<string>>(new Set());
  const [selContacts, setSelContacts] = useState<Set<string>>(new Set());
  const [selGroups, setSelGroups] = useState<Set<string>>(new Set());
  const [programPdf, setProgramPdf] = useState<{ base64: string; name: string } | null>(null);
  const [aiDesc, setAiDesc] = useState("");
  const [aiDuration, setAiDuration] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: EventBanner[] }>("/event-banners");
      setItems(r.items || []);
    } catch (e: any) {
      notify("Errore", e?.message || "");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = async () => {
    setTitle(""); setDateStr(""); setTimeStr(""); setCover(null);
    setVisibilityKind("all");
    setSelUsers(new Set()); setSelContacts(new Set()); setSelGroups(new Set());
    setProgramPdf(null); setAiDesc(""); setAiDuration("");
    setEditing({});
    // Load options in parallel
    try {
      const [tm, ct, gr] = await Promise.all([
        api<{ items: TeamMember[] }>("/team/members").catch(() => ({ items: [] })),
        api<{ items: ContactLite[] }>("/contacts").catch(() => ({ items: [] })),
        api<{ items: GroupLite[] }>("/groups").catch(() => ({ items: [] })),
      ]);
      setTeam(tm.items || []);
      setContacts(ct.items || []);
      setGroups(gr.items || []);
    } catch {}
  };

  const openEdit = async (b: EventBanner) => {
    // Fetch full (with cover base64)
    try {
      const full = await api<any>(`/event-banners/${b.event_id}`);
      setTitle(full.title || "");
      const dt = new Date(full.event_at);
      const y = dt.getFullYear(), m = String(dt.getMonth() + 1).padStart(2, "0"), d = String(dt.getDate()).padStart(2, "0");
      const hh = String(dt.getHours()).padStart(2, "0"), mm = String(dt.getMinutes()).padStart(2, "0");
      setDateStr(`${y}-${m}-${d}`);
      setTimeStr(`${hh}:${mm}`);
      setCover(full.cover_base64 ? { base64: full.cover_base64, mime: full.cover_mime || "image/jpeg" } : null);
      setVisibilityKind(full.visibility_kind || "all");
      setSelUsers(new Set(full.visible_user_ids || []));
      setSelContacts(new Set(full.visible_contact_ids || []));
      setSelGroups(new Set(full.visible_group_ids || []));
      setProgramPdf(full.program_pdf_base64 ? { base64: full.program_pdf_base64, name: full.program_pdf_name || "programma.pdf" } : null);
      setEditing({ event_id: full.event_id });
      const [tm, ct, gr] = await Promise.all([
        api<{ items: TeamMember[] }>("/team/members").catch(() => ({ items: [] })),
        api<{ items: ContactLite[] }>("/contacts").catch(() => ({ items: [] })),
        api<{ items: GroupLite[] }>("/groups").catch(() => ({ items: [] })),
      ]);
      setTeam(tm.items || []); setContacts(ct.items || []); setGroups(gr.items || []);
    } catch (e: any) {
      notify("Errore", e?.message || "");
    }
  };

  const pickCover = async () => {
    try {
      const res = await launchLibraryUniversal({ mediaTypes: "images", allowsEditing: true, quality: 0.85, base64: true, aspect: [16, 9] });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      let b64 = (a as any).base64 as string | undefined;
      if (!b64) b64 = await uriToBase64(a.uri);
      if (!b64) { notify("Errore", "Impossibile leggere l'immagine"); return; }
      const bytes = Math.round((b64.length * 3) / 4);
      if (bytes > 6 * 1024 * 1024) {
        notify("Immagine troppo grande", "Massimo 6MB. Riduci la qualità o ritaglia.");
        return;
      }
      setCover({ base64: b64, mime: (a as any).mimeType || "image/jpeg" });
    } catch (e: any) {
      notify("Errore", e?.message || "");
    }
  };

  const pickProgramPdf = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: "application/pdf", multiple: false, copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      const b64 = await uriToBase64(a.uri);
      const bytes = Math.round((b64.length * 3) / 4);
      if (bytes > 10 * 1024 * 1024) { notify("PDF troppo grande", "Max 10MB."); return; }
      setProgramPdf({ base64: b64, name: a.name || "programma.pdf" });
    } catch (e: any) {
      notify("Errore", e?.message || "");
    }
  };

  const runAiProgram = async () => {
    if (!editing?.event_id) { notify("Salva prima l'evento", "Prima crea l'evento, poi genera il programma con AI."); return; }
    setAiBusy(true);
    try {
      await api(`/event-banners/${editing.event_id}/generate-program`, {
        method: "POST",
        body: { description: aiDesc.trim(), duration_hint: aiDuration.trim() || null },
      });
      notify("Programma generato ✅", "Il programma AI è stato salvato sull'evento.");
    } catch (e: any) {
      notify("Errore AI", e?.message || "");
    } finally { setAiBusy(false); }
  };

  const save = async () => {
    if (!title.trim()) { notify("Titolo mancante", "Inserisci un titolo per l'evento."); return; }
    if (!dateStr || !timeStr) { notify("Data mancante", "Inserisci data e ora dell'evento."); return; }
    if (!cover?.base64 && !editing?.event_id) { notify("Copertina mancante", "Carica un'immagine di copertina."); return; }
    const iso = new Date(`${dateStr}T${timeStr}:00`).toISOString();
    setSaving(true);
    try {
      const body: any = {
        title: title.trim(),
        event_at: iso,
        visibility_kind: visibilityKind,
        visible_user_ids: Array.from(selUsers),
        visible_contact_ids: Array.from(selContacts),
        visible_group_ids: Array.from(selGroups),
      };
      if (cover?.base64) { body.cover_base64 = cover.base64; body.cover_mime = cover.mime; }
      if (programPdf) { body.program_pdf_base64 = programPdf.base64; body.program_pdf_name = programPdf.name; }

      if (editing?.event_id) {
        await api(`/event-banners/${editing.event_id}`, { method: "PUT", body });
      } else {
        const r = await api<{ event_id: string }>("/event-banners", { method: "POST", body });
        // Set the new event_id so AI generate button becomes active
        setEditing({ event_id: r.event_id });
      }
      await load();
      notify("Evento salvato ✅", "L'evento è ora visibile nei destinatari selezionati.");
      if (!editing?.event_id) return; // stay in modal so user can generate AI program
      setEditing(null);
    } catch (e: any) {
      notify("Errore salvataggio", e?.message || "");
    } finally { setSaving(false); }
  };

  const del = async (b: EventBanner) => {
    const ok = await confirmAsync("Elimina evento", `Vuoi eliminare "${b.title}"? L'operazione è irreversibile.`);
    if (!ok) return;
    try {
      await api(`/event-banners/${b.event_id}`, { method: "DELETE" });
      await load();
    } catch (e: any) { notify("Errore", e?.message || ""); }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable testID="back-btn" onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Banner Evento</Text>
        <Pressable testID="event-add-btn" onPress={openCreate} hitSlop={10}>
          <Ionicons name="add-circle" size={26} color={theme.color.brandPrimary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
        <View style={styles.introCard}>
          <Ionicons name="megaphone" size={22} color="#F59E0B" />
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={styles.introTitle}>Banner Evento</Text>
            <Text style={styles.introTxt}>Crea eventi con copertina, data e programma. Appariranno nella home dei destinatari selezionati con countdown live e link al programma condivisibile.</Text>
          </View>
        </View>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 20 }} color={theme.color.brandPrimary} />
        ) : items.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="calendar-outline" size={40} color={theme.color.muted} />
            <Text style={styles.emptyTxt}>Nessun evento creato. Tocca + in alto a destra per iniziare.</Text>
          </View>
        ) : (
          items.map((b) => {
            const when = new Date(b.event_at);
            const past = when.getTime() < Date.now();
            return (
              <View key={b.event_id} style={styles.card} testID={`event-card-${b.event_id}`}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle} numberOfLines={1}>{b.title}</Text>
                  <Text style={styles.cardWhen}>
                    {when.toLocaleString("it-IT", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </Text>
                  <View style={{ flexDirection: "row", gap: 6, marginTop: 6 }}>
                    <View style={[styles.pill, past ? { backgroundColor: "#FEE2E2" } : { backgroundColor: "#DCFCE7" }]}>
                      <Text style={[styles.pillTxt, past ? { color: "#991B1B" } : { color: "#166534" }]}>
                        {past ? "Passato" : "Prossimo"}
                      </Text>
                    </View>
                    <View style={[styles.pill, { backgroundColor: "#EEF2FF" }]}>
                      <Text style={[styles.pillTxt, { color: "#3730A3" }]}>
                        {b.visibility_kind === "all" ? "Tutti" : "Selezione"}
                      </Text>
                    </View>
                  </View>
                </View>
                <View style={{ flexDirection: "row", gap: 6 }}>
                  <Pressable testID={`event-edit-${b.event_id}`} onPress={() => openEdit(b)} style={styles.iconBtn}>
                    <Ionicons name="pencil" size={16} color={theme.color.brandPrimary} />
                  </Pressable>
                  <Pressable testID={`event-del-${b.event_id}`} onPress={() => del(b)} style={styles.iconBtn}>
                    <Ionicons name="trash" size={16} color="#DC2626" />
                  </Pressable>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      {/* Create/Edit modal */}
      <Modal visible={!!editing} animationType="slide" transparent onRequestClose={() => setEditing(null)}>
        <View style={styles.modalBack}>
          <View style={styles.modalCard}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>{editing?.event_id ? "Modifica evento" : "Nuovo evento"}</Text>
              <Pressable onPress={() => setEditing(null)} hitSlop={8}>
                <Ionicons name="close" size={22} color={theme.color.onSurface} />
              </Pressable>
            </View>

            <ScrollView style={{ maxHeight: 560 }} contentContainerStyle={{ padding: 14 }}>
              {/* Cover */}
              <Text style={styles.lbl}>Copertina</Text>
              <Pressable testID="event-cover-pick" onPress={pickCover} style={styles.coverBox}>
                {cover?.base64 ? (
                  <Image
                    source={{ uri: `data:${cover.mime};base64,${cover.base64}` }}
                    style={StyleSheet.absoluteFill}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={styles.coverEmpty}>
                    <Ionicons name="image-outline" size={30} color={theme.color.muted} />
                    <Text style={{ color: theme.color.muted, fontSize: 12, marginTop: 4 }}>Tocca per scegliere</Text>
                  </View>
                )}
              </Pressable>

              {/* Title */}
              <Text style={styles.lbl}>Titolo</Text>
              <TextInput
                testID="event-title"
                value={title}
                onChangeText={setTitle}
                placeholder="Es. Convention 2026, Aperitivo Rete…"
                placeholderTextColor="#94A3B8"
                style={styles.input}
              />

              {/* Date + time */}
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lbl}>Data</Text>
                  <TextInput
                    testID="event-date"
                    value={dateStr}
                    onChangeText={setDateStr}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor="#94A3B8"
                    style={styles.input}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lbl}>Ora</Text>
                  <TextInput
                    testID="event-time"
                    value={timeStr}
                    onChangeText={setTimeStr}
                    placeholder="HH:MM"
                    placeholderTextColor="#94A3B8"
                    style={styles.input}
                  />
                </View>
              </View>

              {/* Visibility */}
              <Text style={styles.lbl}>Visibilità</Text>
              <View style={{ flexDirection: "row", gap: 6, marginBottom: 6 }}>
                <VisibilityChip active={visibilityKind === "all"} label="Tutti" onPress={() => setVisibilityKind("all")} testID="event-vis-all" />
                <VisibilityChip active={visibilityKind === "specific"} label="Solo selezionati" onPress={() => setVisibilityKind("specific")} testID="event-vis-specific" />
              </View>

              {visibilityKind === "specific" && (
                <>
                  {team.length > 0 && (
                    <>
                      <Text style={styles.subLbl}>Collaboratori ({selUsers.size})</Text>
                      <View style={styles.pillRow}>
                        {team.map((m) => {
                          const on = selUsers.has(m.user_id);
                          return (
                            <Pressable
                              key={m.user_id}
                              testID={`event-user-${m.user_id}`}
                              onPress={() => setSelUsers((s) => { const n = new Set(s); on ? n.delete(m.user_id) : n.add(m.user_id); return n; })}
                              style={[styles.chip, on && styles.chipOn]}
                            >
                              <Text style={[styles.chipTxt, on && styles.chipTxtOn]}>{m.name || m.email}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </>
                  )}
                  {groups.length > 0 && (
                    <>
                      <Text style={styles.subLbl}>Gruppi contatti ({selGroups.size})</Text>
                      <View style={styles.pillRow}>
                        {groups.map((g) => {
                          const on = selGroups.has(g.group_id);
                          return (
                            <Pressable
                              key={g.group_id}
                              testID={`event-group-${g.group_id}`}
                              onPress={() => setSelGroups((s) => { const n = new Set(s); on ? n.delete(g.group_id) : n.add(g.group_id); return n; })}
                              style={[styles.chip, on && styles.chipOn]}
                            >
                              <Text style={[styles.chipTxt, on && styles.chipTxtOn]}>{g.name}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </>
                  )}
                  {contacts.length > 0 && (
                    <>
                      <Text style={styles.subLbl}>Contatti singoli ({selContacts.size}) — usa il link pubblico per condividere</Text>
                      <View style={styles.pillRow}>
                        {contacts.slice(0, 60).map((c) => {
                          const on = selContacts.has(c.contact_id);
                          const nm = `${c.first_name} ${c.last_name}`.trim();
                          return (
                            <Pressable
                              key={c.contact_id}
                              testID={`event-contact-${c.contact_id}`}
                              onPress={() => setSelContacts((s) => { const n = new Set(s); on ? n.delete(c.contact_id) : n.add(c.contact_id); return n; })}
                              style={[styles.chip, on && styles.chipOn]}
                            >
                              <Text style={[styles.chipTxt, on && styles.chipTxtOn]}>{nm || "(senza nome)"}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </>
                  )}
                </>
              )}

              {/* Program */}
              <Text style={styles.lbl}>Programma evento</Text>
              <Pressable testID="event-program-pick" onPress={pickProgramPdf} style={[styles.uploadBtn, { borderColor: "#7C3AED" }]}>
                <Ionicons name="cloud-upload-outline" size={16} color="#7C3AED" />
                <Text style={[styles.uploadTxt, { color: "#7C3AED" }]}>
                  {programPdf ? `PDF: ${programPdf.name}` : "Carica PDF del programma"}
                </Text>
              </Pressable>

              <Text style={[styles.subLbl, { marginTop: 8 }]}>Oppure genera con AI</Text>
              <TextInput
                testID="event-ai-desc"
                value={aiDesc}
                onChangeText={setAiDesc}
                placeholder="Descrizione libera (es. workshop energie rinnovabili + aperitivo networking)"
                placeholderTextColor="#94A3B8"
                multiline
                style={[styles.input, { minHeight: 60, textAlignVertical: "top" }]}
              />
              <TextInput
                testID="event-ai-duration"
                value={aiDuration}
                onChangeText={setAiDuration}
                placeholder="Durata (es. mezza giornata, sera, weekend)"
                placeholderTextColor="#94A3B8"
                style={styles.input}
              />
              <Pressable
                testID="event-ai-generate"
                onPress={runAiProgram}
                disabled={aiBusy || !editing?.event_id}
                style={[styles.uploadBtn, { borderColor: "#059669", backgroundColor: editing?.event_id ? "#ECFDF5" : "#F1F5F9", opacity: (!editing?.event_id || aiBusy) ? 0.6 : 1 }]}
              >
                {aiBusy ? (
                  <ActivityIndicator color="#059669" />
                ) : (
                  <>
                    <Ionicons name="sparkles" size={16} color="#059669" />
                    <Text style={[styles.uploadTxt, { color: "#059669" }]}>Genera programma con AI</Text>
                  </>
                )}
              </Pressable>
              {!editing?.event_id && (
                <Text style={{ fontSize: 11, color: theme.color.muted, marginTop: 4, fontStyle: "italic" }}>
                  Salva prima l&apos;evento per abilitare la generazione AI.
                </Text>
              )}
            </ScrollView>

            <View style={styles.modalFooter}>
              <Pressable onPress={() => setEditing(null)} style={[styles.btn, { backgroundColor: "#F1F5F9" }]}>
                <Text style={{ color: theme.color.onSurface, fontWeight: "700" }}>Chiudi</Text>
              </Pressable>
              <Pressable
                testID="event-save-btn"
                onPress={save}
                disabled={saving}
                style={[styles.btn, { backgroundColor: theme.color.brandPrimary, flex: 2 }]}
              >
                {saving ? (
                  <ActivityIndicator color="#FFF" />
                ) : (
                  <Text style={{ color: "#FFF", fontWeight: "800" }}>Salva evento</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function VisibilityChip({ active, label, onPress, testID }: { active: boolean; label: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable testID={testID} onPress={onPress} style={[styles.visChip, active && styles.visChipOn]}>
      <Ionicons name={active ? "checkbox" : "square-outline"} size={16} color={active ? "#FFF" : theme.color.muted} />
      <Text style={[styles.visChipTxt, active && { color: "#FFF" }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.color.border, backgroundColor: theme.color.surface },
  headerTitle: { fontSize: 18, fontWeight: "800", color: theme.color.onSurface },
  introCard: { flexDirection: "row", backgroundColor: "#FFF7ED", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "#FED7AA", marginBottom: 16 },
  introTitle: { fontSize: 14, fontWeight: "800", color: "#9A3412" },
  introTxt: { fontSize: 12, color: "#9A3412", marginTop: 4, lineHeight: 17 },
  emptyCard: { alignItems: "center", padding: 30, backgroundColor: theme.color.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.color.border, borderStyle: "dashed" },
  emptyTxt: { color: theme.color.muted, fontSize: 13, textAlign: "center", marginTop: 10, maxWidth: 300 },
  card: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, backgroundColor: theme.color.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.color.border, marginBottom: 8 },
  cardTitle: { fontSize: 14, fontWeight: "800", color: theme.color.onSurface },
  cardWhen: { fontSize: 11, color: theme.color.muted, marginTop: 2 },
  pill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  pillTxt: { fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.4 },
  iconBtn: { padding: 8, backgroundColor: "#F1F5F9", borderRadius: 8 },
  modalBack: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: theme.color.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "94%" },
  modalHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  modalTitle: { fontSize: 17, fontWeight: "800", color: theme.color.onSurface },
  modalFooter: { flexDirection: "row", gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: theme.color.border },
  btn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: "center", justifyContent: "center", flexDirection: "row" },
  lbl: { fontSize: 12, fontWeight: "700", color: theme.color.muted, textTransform: "uppercase", letterSpacing: 0.4, marginTop: 12, marginBottom: 4 },
  subLbl: { fontSize: 11, fontWeight: "700", color: theme.color.muted, marginTop: 10, marginBottom: 4 },
  input: { backgroundColor: "#F1F5F9", borderRadius: 8, paddingHorizontal: 10, paddingVertical: Platform.OS === "ios" ? 10 : 8, fontSize: 13, color: theme.color.onSurface },
  coverBox: { height: 140, borderRadius: 10, overflow: "hidden", backgroundColor: "#F1F5F9", borderWidth: 2, borderColor: theme.color.border, borderStyle: "dashed" },
  coverEmpty: { flex: 1, alignItems: "center", justifyContent: "center" },
  visChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: theme.color.border, backgroundColor: "#FFF" },
  visChipOn: { backgroundColor: theme.color.brandPrimary, borderColor: theme.color.brandPrimary },
  visChipTxt: { fontSize: 12, fontWeight: "700", color: theme.color.onSurface },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: theme.color.border, backgroundColor: "#FFF" },
  chipOn: { backgroundColor: "#EEF2FF", borderColor: theme.color.brandPrimary },
  chipTxt: { fontSize: 11, color: theme.color.onSurface, fontWeight: "600" },
  chipTxtOn: { color: theme.color.brandPrimary, fontWeight: "800" },
  uploadBtn: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8, borderWidth: 2, borderStyle: "dashed", borderRadius: 10, padding: 12, marginBottom: 8 },
  uploadTxt: { fontWeight: "700", fontSize: 13 },
});

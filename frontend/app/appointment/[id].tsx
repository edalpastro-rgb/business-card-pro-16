import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Platform, Linking, Alert, Modal } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import DateTimePicker from "@react-native-community/datetimepicker";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { scheduleAppointmentReminder, cancelAppointmentReminder, scheduleCallbackReminder } from "@/src/notifications";
import { openGoogleCalendar, openOutlookCalendar, shareIcs } from "@/src/calendar-export";

type Outcome = { id: string; name: string; color: string; icon?: string; counts_as?: string };
type Settings = { appointment_outcomes?: Outcome[] };
type Appointment = {
  appointment_id: string; title: string; area: "energy" | "network"; start_at: string;
  is_phone: boolean; done: boolean; location: string; notes: string;
  outcome_tags: string[]; outcome_notes: string; products_sold: number; contract_signed: boolean;
  outcome_ids?: string[]; rescheduled_to?: string;
  contact_id?: string;
  duration_min?: number;
};
type ContactLite = { contact_id: string; first_name: string; last_name: string; phone?: string; whatsapp?: string; email?: string };

const ENERGY_OUTCOMES = [
  { key: "non_interessato", label: "Non interessato" },
  { key: "contratto_fatto", label: "Contratto fatto" },
  { key: "richiamare", label: "Richiamare" },
];
const NETWORK_OUTCOMES = [
  { key: "post_appuntamento", label: "Post appuntamento" },
  { key: "ok_abo", label: "Ok Abo" },
  { key: "ok_cliente", label: "Ok Cliente" },
  { key: "dare_seguito", label: "Dare seguito" },
  { key: "primo_avvio", label: "Primo avvio" },
  { key: "presentazione_prodotti", label: "Presentazione prodotti" },
  { key: "incontro_open", label: "Incontro Open" },
  { key: "incontro_bbs", label: "Incontro BBS" },
  { key: "incontro_wes", label: "Incontro WES" },
];

export default function AppointmentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [a, setA] = useState<Appointment | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [contact, setContact] = useState<ContactLite | null>(null);
  const [showPicker, setShowPicker] = useState<"date" | "time" | null>(null);
  const [callbackAt, setCallbackAt] = useState<Date>(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const [showCbSection, setShowCbSection] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcomeModal, setOutcomeModal] = useState<{ mode: "create" | "rename"; outcome_id?: string; name: string; color: string; counts_as?: string } | null>(null);

  const load = useCallback(async () => {
    const [ap, s] = await Promise.all([
      api<Appointment>(`/appointments/${id}`),
      api<Settings>("/settings"),
    ]);
    setA(ap);
    setSettings(s);
    if (ap.contact_id) {
      try { setContact(await api<ContactLite>(`/contacts/${ap.contact_id}`)); } catch {}
    }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!a) return <SafeAreaView style={styles.root}><ActivityIndicator style={{ marginTop: 40 }} color={theme.color.brandPrimary} /></SafeAreaView>;

  const color = a.area === "energy" ? theme.color.energy : theme.color.network;
  const outcomes = a.area === "energy" ? ENERGY_OUTCOMES : NETWORK_OUTCOMES;
  const dynamicOutcomes: Outcome[] = settings?.appointment_outcomes || [];
  const selectedOutcomeIds: string[] = a.outcome_ids || [];

  const toggleOutcome = async (outcomeId: string) => {
    const next = selectedOutcomeIds.includes(outcomeId)
      ? selectedOutcomeIds.filter((x) => x !== outcomeId)
      : [...selectedOutcomeIds, outcomeId];
    const outcome = dynamicOutcomes.find((o) => o.id === outcomeId);
    const patch: any = { outcome_ids: next };
    // Auto-set contract_signed based on counts_as="contract"
    const containsContract = next.some((oid) => dynamicOutcomes.find((o) => o.id === oid)?.counts_as === "contract");
    patch.contract_signed = containsContract || a.contract_signed;
    // If "rescheduled" outcome toggled ON → prompt to reschedule
    setA({ ...a, outcome_ids: next, contract_signed: patch.contract_signed });
    await api(`/appointments/${id}`, { method: "PUT", body: patch });
    if (outcome?.counts_as === "rescheduled" && !selectedOutcomeIds.includes(outcomeId)) {
      // Just added rescheduled
      Alert.alert("Riprogramma appuntamento", "Vuoi creare un nuovo appuntamento con gli stessi dettagli?", [
        { text: "No, grazie", style: "cancel" },
        {
          text: "Sì, riprogramma", onPress: () => {
            const q = new URLSearchParams({
              reschedule_from: id as string,
              title: a.title,
              area: a.area,
              location: a.location || "",
              notes: a.notes || "",
              contact_id: a.contact_id || "",
              is_phone: a.is_phone ? "1" : "0",
            });
            router.push(`/appointment/new?${q.toString()}`);
          },
        },
      ]);
    }
  };

  const saveOutcomeModal = async () => {
    if (!outcomeModal || !outcomeModal.name.trim() || !settings) return;
    const list = [...(settings.appointment_outcomes || [])];
    if (outcomeModal.mode === "create") {
      const newOutcome: Outcome = {
        id: `out_${Date.now().toString(36)}`,
        name: outcomeModal.name.trim(),
        color: outcomeModal.color,
        counts_as: outcomeModal.counts_as || "other",
      };
      list.push(newOutcome);
      const saved = await api<Settings>("/settings", { method: "PUT", body: { ...settings, appointment_outcomes: list } });
      setSettings(saved);
      // Auto-select the new outcome
      const next = [...selectedOutcomeIds, newOutcome.id];
      setA({ ...a, outcome_ids: next });
      await api(`/appointments/${id}`, { method: "PUT", body: { outcome_ids: next } });
    } else if (outcomeModal.mode === "rename" && outcomeModal.outcome_id) {
      const idx = list.findIndex((o) => o.id === outcomeModal.outcome_id);
      if (idx >= 0) list[idx] = { ...list[idx], name: outcomeModal.name.trim(), color: outcomeModal.color, counts_as: outcomeModal.counts_as || list[idx].counts_as };
      const saved = await api<Settings>("/settings", { method: "PUT", body: { ...settings, appointment_outcomes: list } });
      setSettings(saved);
    }
    setOutcomeModal(null);
  };

  const deleteOutcome = (outcome: Outcome) => {
    if (!settings) return;
    Alert.alert("Elimina esito", `Vuoi eliminare "${outcome.name}"?`, [
      { text: "Annulla", style: "cancel" },
      {
        text: "Elimina", style: "destructive", onPress: async () => {
          const list = (settings.appointment_outcomes || []).filter((o) => o.id !== outcome.id);
          const saved = await api<Settings>("/settings", { method: "PUT", body: { ...settings, appointment_outcomes: list } });
          setSettings(saved);
          if (selectedOutcomeIds.includes(outcome.id)) {
            const next = selectedOutcomeIds.filter((x) => x !== outcome.id);
            setA({ ...a, outcome_ids: next });
            await api(`/appointments/${id}`, { method: "PUT", body: { outcome_ids: next } });
          }
        },
      },
    ]);
  };

  const toggleTag = async (key: string) => {
    const has = a.outcome_tags.includes(key);
    const next = has ? a.outcome_tags.filter((t) => t !== key) : [...a.outcome_tags, key];
    setA({ ...a, outcome_tags: next });
    // energy: single-select behavior implicit; for network multiselect. Persist:
    await api(`/appointments/${id}`, { method: "PUT", body: { outcome_tags: next, contract_signed: next.includes("contratto_fatto") || a.contract_signed } });
  };

  const savePartial = async (patch: any) => {
    setBusy(true);
    try {
      const updated = await api<Appointment>(`/appointments/${id}`, { method: "PUT", body: patch });
      setA(updated);
      if (patch.start_at) {
        await scheduleAppointmentReminder(id as string, updated.title, new Date(updated.start_at));
      }
      if (patch.done === true) {
        await cancelAppointmentReminder(id as string);
      }
    } finally { setBusy(false); }
  };

  const rescheduleTo = async (d: Date, mode: "date" | "time") => {
    const next = new Date(a.start_at);
    if (mode === "date") next.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
    else next.setHours(d.getHours(), d.getMinutes());
    await savePartial({ start_at: next.toISOString() });
  };

  const createCallback = async () => {
    const cb = await api<{ callback_id: string; title: string }>("/callbacks", {
      method: "POST",
      body: { title: `Richiamare: ${a.title}`, area: a.area, scheduled_at: callbackAt.toISOString(), contact_id: a.contact_id, note: "" },
    });
    await scheduleCallbackReminder(cb.callback_id, cb.title, callbackAt);
    setShowCbSection(false);
  };

  const del = async () => {
    await cancelAppointmentReminder(id as string);
    await api(`/appointments/${id}`, { method: "DELETE" });
    router.back();
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={[styles.header, { backgroundColor: color }]}>
        <Pressable testID="back-btn" onPress={() => router.back()}><Ionicons name="chevron-back" size={26} color="#FFF" /></Pressable>
        <Text style={styles.headerTxt}>Dettaglio</Text>
        <Pressable testID="delete-appt" onPress={del}><Ionicons name="trash-outline" size={22} color="#FFF" /></Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <View style={[styles.titleCard, { borderLeftColor: color }]}>
          <Text style={styles.apTitle}>{a.title}</Text>
          <View style={styles.metaRow}>
            <Ionicons name="time-outline" size={14} color={theme.color.muted} />
            <Text style={styles.metaTxt}>{new Date(a.start_at).toLocaleString("it-IT")}</Text>
            {a.is_phone && <><Ionicons name="call" size={14} color={color} /><Text style={[styles.metaTxt, { color }]}>Telefonico</Text></>}
          </View>
          {a.location ? (
            <Pressable testID="waze-btn" onPress={() => Linking.openURL(`https://www.waze.com/ul?q=${encodeURIComponent(a.location)}&navigate=yes`)} style={styles.wazeBtn}>
              <Ionicons name="navigate" size={16} color={theme.color.brandPrimary} />
              <Text style={styles.wazeTxt}>{a.location}</Text>
            </Pressable>
          ) : null}
        </View>

        <Pressable testID="done-btn" onPress={() => savePartial({ done: !a.done })} style={[styles.doneBtn, a.done && { backgroundColor: theme.color.success }]}>
          <Ionicons name={a.done ? "checkmark-circle" : "ellipse-outline"} size={22} color="#FFF" />
          <Text style={styles.doneBtnTxt}>{a.done ? "Appuntamento fatto ✓" : "Segna come fatto"}</Text>
        </Pressable>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Condividi con il cliente</Text>
          <Text style={styles.shareHint}>Invia i dati dell&apos;appuntamento tramite Email, WhatsApp o SMS senza uscire dall&apos;app</Text>
          {(() => {
            const dateStr = new Date(a.start_at).toLocaleString("it-IT", { dateStyle: "full", timeStyle: "short" });
            const bodyText = `Ciao${contact ? " " + contact.first_name : ""},\n\nti confermo il nostro appuntamento:\n\n📅 ${a.title}\n🗓 ${dateStr}${a.location ? `\n📍 ${a.location}` : ""}${a.is_phone ? "\n📞 Appuntamento telefonico" : ""}${a.notes ? `\n\nNote: ${a.notes}` : ""}\n\nA presto!`;
            return (
              <View style={styles.shareRow}>
                <Pressable
                  testID="share-email"
                  disabled={!contact?.email}
                  onPress={() => Linking.openURL(`mailto:${contact?.email}?subject=${encodeURIComponent("Appuntamento: " + a.title)}&body=${encodeURIComponent(bodyText)}`)}
                  style={[styles.shareBtn, { backgroundColor: "#0F766E" }, !contact?.email && { opacity: 0.4 }]}
                >
                  <Ionicons name="mail" size={16} color="#FFF" />
                  <Text style={styles.shareBtnTxt}>Email</Text>
                </Pressable>
                <Pressable
                  testID="share-whatsapp"
                  disabled={!contact?.phone && !contact?.whatsapp}
                  onPress={() => {
                    const num = (contact?.whatsapp || contact?.phone || "").replace(/[^\d+]/g, "");
                    Linking.openURL(`https://wa.me/${num}?text=${encodeURIComponent(bodyText)}`);
                  }}
                  style={[styles.shareBtn, { backgroundColor: "#25D366" }, !(contact?.phone || contact?.whatsapp) && { opacity: 0.4 }]}
                >
                  <Ionicons name="logo-whatsapp" size={16} color="#FFF" />
                  <Text style={styles.shareBtnTxt}>WhatsApp</Text>
                </Pressable>
                <Pressable
                  testID="share-sms"
                  disabled={!contact?.phone}
                  onPress={() => {
                    const num = (contact?.phone || "").replace(/\s/g, "");
                    const sep = Platform.OS === "ios" ? "&" : "?";
                    Linking.openURL(`sms:${num}${sep}body=${encodeURIComponent(bodyText)}`);
                  }}
                  style={[styles.shareBtn, { backgroundColor: theme.color.brandSecondary }, !contact?.phone && { opacity: 0.4 }]}
                >
                  <Ionicons name="chatbubble-ellipses" size={16} color="#FFF" />
                  <Text style={styles.shareBtnTxt}>SMS</Text>
                </Pressable>
              </View>
            );
          })()}
          {!contact && <Text style={styles.shareWarn}>Nessun contatto collegato a questo appuntamento — associane uno per abilitare la condivisione.</Text>}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Sincronizza con calendario</Text>
          <View style={styles.syncRow}>
            <Pressable
              testID="sync-google"
              onPress={() => openGoogleCalendar({ id: a.appointment_id, title: a.title, start: new Date(a.start_at), location: a.location, description: a.notes })}
              style={[styles.syncBtn, { backgroundColor: "#EA4335" }]}
            >
              <Ionicons name="logo-google" size={16} color="#FFF" />
              <Text style={styles.syncBtnTxt}>Google</Text>
            </Pressable>
            <Pressable
              testID="sync-outlook"
              onPress={() => openOutlookCalendar({ id: a.appointment_id, title: a.title, start: new Date(a.start_at), location: a.location, description: a.notes })}
              style={[styles.syncBtn, { backgroundColor: "#0078D4" }]}
            >
              <Ionicons name="mail" size={16} color="#FFF" />
              <Text style={styles.syncBtnTxt}>Outlook</Text>
            </Pressable>
            <Pressable
              testID="sync-ics"
              onPress={() => shareIcs({ id: a.appointment_id, title: a.title, start: new Date(a.start_at), location: a.location, description: a.notes })}
              style={[styles.syncBtn, { backgroundColor: theme.color.brandPrimary }]}
            >
              <Ionicons name="download-outline" size={16} color="#FFF" />
              <Text style={styles.syncBtnTxt}>.ics</Text>
            </Pressable>
          </View>
          <Text style={styles.syncHint}>Aggiungi l&apos;appuntamento al tuo calendario personale (Google, Outlook o file .ics per Apple/altri).</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Sposta / Rinvia</Text>
          {Platform.OS === "web" ? (
            /* @ts-expect-error web-only */
            <input
              type="datetime-local"
              value={
                new Date(new Date(a.start_at).getTime() - new Date(a.start_at).getTimezoneOffset() * 60000)
                  .toISOString()
                  .slice(0, 16)
              }
              onChange={(e: any) => rescheduleTo(new Date(e.target.value), "date")}
              style={{
                width: "100%",
                backgroundColor: theme.color.surface,
                border: `1px solid ${theme.color.border}`,
                borderRadius: 12,
                padding: "10px 14px",
                fontSize: 14,
                color: theme.color.onSurface,
                fontFamily: "inherit",
                outline: "none",
              } as any}
            />
          ) : (
            <>
              <View style={styles.dateRow}>
                <Pressable testID="reschedule-date" onPress={() => setShowPicker("date")} style={styles.dateBtn}>
                  <Ionicons name="calendar-outline" size={16} color={theme.color.brandPrimary} />
                  <Text style={styles.dateBtnTxt}>{new Date(a.start_at).toLocaleDateString("it-IT")}</Text>
                </Pressable>
                <Pressable testID="reschedule-time" onPress={() => setShowPicker("time")} style={styles.dateBtn}>
                  <Ionicons name="time-outline" size={16} color={theme.color.brandPrimary} />
                  <Text style={styles.dateBtnTxt}>{new Date(a.start_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text>
                </Pressable>
              </View>
              {showPicker && (
                <DateTimePicker
                  value={new Date(a.start_at)}
                  mode={showPicker}
                  onChange={(e, d) => { setShowPicker(null); if (d) rescheduleTo(d, showPicker); }}
                />
              )}
            </>
          )}
        </View>

        {a.is_phone && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Programma ritelefonata</Text>
            {!showCbSection ? (
              <Pressable testID="add-callback-btn" onPress={() => setShowCbSection(true)} style={styles.linkBtn}>
                <Ionicons name="add-circle-outline" size={18} color={theme.color.brandPrimary} />
                <Text style={styles.linkTxt}>Aggiungi ritelefonata</Text>
              </Pressable>
            ) : (
              <>
                {Platform.OS === "web" ? (
                  /* @ts-expect-error web-only */
                  <input
                    type="datetime-local"
                    value={
                      new Date(callbackAt.getTime() - callbackAt.getTimezoneOffset() * 60000)
                        .toISOString()
                        .slice(0, 16)
                    }
                    onChange={(e: any) => setCallbackAt(new Date(e.target.value))}
                    style={{
                      width: "100%",
                      backgroundColor: theme.color.surface,
                      border: `1px solid ${theme.color.border}`,
                      borderRadius: 12,
                      padding: "10px 14px",
                      fontSize: 14,
                      color: theme.color.onSurface,
                      fontFamily: "inherit",
                      outline: "none",
                    } as any}
                  />
                ) : (
                  <DateTimePicker
                    value={callbackAt}
                    mode="datetime"
                    onChange={(e, d) => { if (d) setCallbackAt(d); }}
                  />
                )}
                <Pressable testID="save-callback" onPress={createCallback} style={styles.smallSave}>
                  <Text style={styles.smallSaveTxt}>Salva ritelefonata</Text>
                </Pressable>
              </>
            )}
          </View>
        )}

        {a.done && (
          <View style={[styles.card, { borderLeftColor: theme.color.success, borderLeftWidth: 4 }]}>
            <Text style={styles.sectionTitle}>Esito dell&apos;appuntamento</Text>
            <Text style={styles.shareHint}>Seleziona uno o più esiti. Se scegli &quot;Rinviato&quot; puoi riprogrammare l&apos;appuntamento.</Text>
            <View style={styles.outcomesGrid}>
              {dynamicOutcomes.map((o) => {
                const active = selectedOutcomeIds.includes(o.id);
                return (
                  <Pressable
                    key={o.id}
                    testID={`out-${o.id}`}
                    onPress={() => toggleOutcome(o.id)}
                    onLongPress={() => {
                      Alert.alert(o.name, "Cosa vuoi fare?", [
                        { text: "Annulla", style: "cancel" },
                        { text: "Rinomina / colore", onPress: () => setOutcomeModal({ mode: "rename", outcome_id: o.id, name: o.name, color: o.color, counts_as: o.counts_as }) },
                        { text: "Elimina", style: "destructive", onPress: () => deleteOutcome(o) },
                      ]);
                    }}
                    style={[styles.outcomeChip, active && { backgroundColor: o.color, borderColor: o.color }]}
                  >
                    <Ionicons name={(o.icon as any) || (active ? "checkmark-circle" : "ellipse-outline")} size={16} color={active ? "#FFF" : o.color} />
                    <Text style={[styles.outcomeTxt, active && { color: "#FFF" }]}>{o.name}</Text>
                  </Pressable>
                );
              })}
              <Pressable
                testID="out-new"
                onPress={() => setOutcomeModal({ mode: "create", name: "", color: "#16A34A", counts_as: "other" })}
                style={[styles.outcomeChip, { borderStyle: "dashed", borderColor: theme.color.brandPrimary }]}
              >
                <Ionicons name="add" size={14} color={theme.color.brandPrimary} />
                <Text style={[styles.outcomeTxt, { color: theme.color.brandPrimary }]}>Nuovo esito</Text>
              </Pressable>
            </View>
            {selectedOutcomeIds.length > 0 && (
              <View style={{ marginTop: 10, padding: 10, backgroundColor: "#F0FDF4", borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.success }}>
                <Text style={{ color: theme.color.success, fontWeight: "700", fontSize: 12 }}>
                  ✓ {selectedOutcomeIds.length} esit{selectedOutcomeIds.length === 1 ? "o registrato" : "i registrati"}
                </Text>
              </View>
            )}
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Dopo l&apos;appuntamento (dettagli)</Text>
          <View style={styles.outcomesGrid}>
            {outcomes.map((o) => {
              const active = a.outcome_tags.includes(o.key);
              return (
                <Pressable
                  key={o.key}
                  testID={`outcome-${o.key}`}
                  onPress={() => toggleTag(o.key)}
                  style={[styles.outcomeChip, active && { backgroundColor: color, borderColor: color }]}
                >
                  <Ionicons name={active ? "checkmark-circle" : "ellipse-outline"} size={16} color={active ? "#FFF" : theme.color.muted} />
                  <Text style={[styles.outcomeTxt, active && { color: "#FFF" }]}>{o.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.lbl}>Note dettagliate</Text>
          <TextInput
            testID="outcome-notes"
            value={a.outcome_notes || ""}
            onChangeText={(t) => setA({ ...a, outcome_notes: t })}
            onEndEditing={() => savePartial({ outcome_notes: a.outcome_notes })}
            style={[styles.input, { minHeight: 80, textAlignVertical: "top" }]}
            multiline
            placeholder="Aggiungi note approfondite..."
            placeholderTextColor="#94A3B8"
          />

          {a.area === "energy" && (
            <>
              <Text style={styles.lbl}>Prodotti venduti</Text>
              <TextInput
                testID="products-sold"
                value={String(a.products_sold || 0)}
                onChangeText={(t) => setA({ ...a, products_sold: parseInt(t) || 0 })}
                onEndEditing={() => savePartial({ products_sold: a.products_sold })}
                style={styles.input}
                keyboardType="number-pad"
              />
            </>
          )}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      <Modal visible={!!outcomeModal} transparent animationType="fade" onRequestClose={() => setOutcomeModal(null)}>
        <View style={omstyles.back}>
          <View style={omstyles.card}>
            <Text style={omstyles.title}>{outcomeModal?.mode === "create" ? "Nuovo esito appuntamento" : "Modifica esito"}</Text>
            <Text style={omstyles.hint}>Es. Contratto firmato, Da ricontattare, Nuovo cliente Power...</Text>
            <Text style={omstyles.lbl}>Nome</Text>
            <TextInput
              testID="out-modal-name"
              value={outcomeModal?.name || ""}
              onChangeText={(t) => setOutcomeModal((m) => m ? { ...m, name: t } : m)}
              placeholder="Nome dell'esito"
              placeholderTextColor="#94A3B8"
              autoFocus
              style={omstyles.input}
            />
            <Text style={omstyles.lbl}>Colore</Text>
            <View style={omstyles.swatches}>
              {["#16A34A", "#C83232", "#1B6CB0", "#B77C14", "#6B7280", "#0891B2", "#7C3AED", "#DB2777"].map((c) => (
                <Pressable key={c} onPress={() => setOutcomeModal((m) => m ? { ...m, color: c } : m)} style={[omstyles.swatch, { backgroundColor: c }, outcomeModal?.color === c && { borderColor: theme.color.onSurface }]}>
                  {outcomeModal?.color === c && <Ionicons name="checkmark" size={16} color="#FFF" />}
                </Pressable>
              ))}
            </View>
            <Text style={omstyles.lbl}>Tipologia (per statistiche report)</Text>
            <View style={omstyles.typeRow}>
              {[
                { k: "contract", label: "Contratto" },
                { k: "new_energy", label: "Nuovo cliente Power" },
                { k: "new_network", label: "Nuovo cliente Networker" },
                { k: "rescheduled", label: "Rinviato" },
                { k: "followup", label: "Da ricontattare" },
                { k: "no_interest", label: "Non interessato" },
                { k: "other", label: "Altro" },
              ].map((t) => {
                const on = (outcomeModal?.counts_as || "other") === t.k;
                return (
                  <Pressable key={t.k} onPress={() => setOutcomeModal((m) => m ? { ...m, counts_as: t.k } : m)} style={[omstyles.typeChip, on && { backgroundColor: theme.color.brandPrimary, borderColor: theme.color.brandPrimary }]}>
                    <Text style={[omstyles.typeChipTxt, on && { color: "#FFF" }]}>{t.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
              <Pressable onPress={() => setOutcomeModal(null)} style={[omstyles.btn, { backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border }]}>
                <Text style={{ color: theme.color.onSurface, fontWeight: "700" }}>Annulla</Text>
              </Pressable>
              <Pressable testID="out-modal-save" onPress={saveOutcomeModal} disabled={!outcomeModal?.name?.trim()} style={[omstyles.btn, { backgroundColor: theme.color.brandPrimary, opacity: outcomeModal?.name?.trim() ? 1 : 0.5 }]}>
                <Text style={{ color: "#FFF", fontWeight: "700" }}>{outcomeModal?.mode === "create" ? "Crea" : "Salva"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const omstyles = StyleSheet.create({
  back: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 20 },
  card: { width: "100%", maxWidth: 420, backgroundColor: "#FFF", borderRadius: theme.radius.md, padding: 18 },
  title: { fontSize: 18, fontWeight: "700", color: theme.color.onSurface, marginBottom: 6 },
  hint: { color: theme.color.muted, fontSize: 12, marginBottom: 8, fontStyle: "italic" },
  lbl: { fontSize: 12, color: theme.color.onSurfaceTertiary, fontWeight: "600", marginTop: 10, marginBottom: 4 },
  input: { backgroundColor: theme.color.surface, borderRadius: theme.radius.md, padding: 12, borderWidth: 1, borderColor: theme.color.border, color: theme.color.onSurface },
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  swatch: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "transparent" },
  typeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  typeChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: theme.radius.pill, backgroundColor: "#FFF", borderWidth: 1, borderColor: theme.color.border },
  typeChipTxt: { fontSize: 11, fontWeight: "700", color: theme.color.onSurfaceTertiary },
  btn: { flex: 1, paddingVertical: 12, borderRadius: theme.radius.md, alignItems: "center" },
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12 },
  headerTxt: { color: "#FFF", fontSize: 16, fontWeight: "700" },
  titleCard: { backgroundColor: "#FFF", padding: 16, borderRadius: theme.radius.md, borderLeftWidth: 4, borderWidth: 1, borderColor: theme.color.border },
  apTitle: { fontSize: 20, fontWeight: "700", color: theme.color.onSurface },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6, flexWrap: "wrap" },
  metaTxt: { fontSize: 13, color: theme.color.muted },
  wazeBtn: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10, backgroundColor: theme.color.brandTertiary, alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 6, borderRadius: theme.radius.pill },
  wazeTxt: { color: theme.color.brandPrimary, fontWeight: "600" },
  doneBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: theme.color.brandPrimary, padding: 14, borderRadius: theme.radius.md },
  doneBtnTxt: { color: "#FFF", fontWeight: "700" },
  card: { backgroundColor: "#FFF", padding: 14, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border },
  sectionTitle: { fontSize: 14, fontWeight: "700", color: theme.color.onSurface, marginBottom: 10 },
  dateRow: { flexDirection: "row", gap: 10 },
  dateBtn: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: theme.color.surface, padding: 10, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border },
  dateBtnTxt: { color: theme.color.onSurface, fontWeight: "600" },
  input: { backgroundColor: theme.color.surface, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border, padding: 10, fontSize: 14, color: theme.color.onSurface, marginTop: 8 },
  linkBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
  linkTxt: { color: theme.color.brandPrimary, fontWeight: "600" },
  smallSave: { backgroundColor: theme.color.brandPrimary, padding: 10, borderRadius: theme.radius.md, alignItems: "center", marginTop: 10 },
  smallSaveTxt: { color: "#FFF", fontWeight: "700" },
  outcomesGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  outcomeChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 8, borderRadius: theme.radius.pill, backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border },
  outcomeTxt: { fontSize: 12, fontWeight: "600", color: theme.color.onSurfaceTertiary },
  lbl: { fontSize: 12, fontWeight: "600", color: theme.color.onSurfaceTertiary, marginTop: 12, marginBottom: 4 },
  syncRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  syncBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: theme.radius.md, flex: 1, justifyContent: "center", minWidth: 90 },
  syncBtnTxt: { color: "#FFF", fontWeight: "700", fontSize: 13 },
  syncHint: { fontSize: 11, color: theme.color.muted, marginTop: 8 },
  shareRow: { flexDirection: "row", gap: 8, marginTop: 8, flexWrap: "wrap" },
  shareBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: theme.radius.md, flex: 1, justifyContent: "center", minWidth: 90 },
  shareBtnTxt: { color: "#FFF", fontWeight: "700", fontSize: 13 },
  shareHint: { fontSize: 12, color: theme.color.muted, marginTop: -2, marginBottom: 4 },
  shareWarn: { fontSize: 11, color: theme.color.warning, marginTop: 8, fontStyle: "italic" },
});

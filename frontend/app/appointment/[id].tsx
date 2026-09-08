import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Platform, Linking, Alert, Modal } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import DateTimePicker from "@react-native-community/datetimepicker";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { scheduleAppointmentReminder, cancelAppointmentReminder, scheduleCallbackReminder } from "@/src/notifications";
import { openGoogleCalendar, openOutlookCalendar, shareIcs } from "@/src/calendar-export";
import { ModuleErrorBoundary } from "@/src/shared";
import { AppointmentShareActions } from "@/src/AppointmentShareActions";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { apptTypeColor } from "@/app/appointment/new";

type Outcome = { id: string; name: string; color: string; icon?: string; counts_as?: string };
type Settings = { appointment_outcomes?: Outcome[] };
type Appointment = {
  appointment_id: string; title: string; area: "energy" | "network"; start_at: string;
  is_phone: boolean; done: boolean; location: string; notes: string;
  outcome_tags: string[]; outcome_notes: string; products_sold: number; contract_signed: boolean;
  outcome_ids?: string[]; rescheduled_to?: string;
  contact_id?: string;
  duration_min?: number;
  appointment_type_tags?: string[];
  is_broadcast?: boolean;
  broadcast_notify_advance_min?: number;
  read_only?: boolean;
  created_by?: string;
  // v2.16 — Direct phone/email + structured address (optional)
  phone_mobile?: string;
  phone_work?: string;
  email?: string;
  address_street?: string;
  address_number?: string;
  address_city?: string;
  address_zip?: string;
  address_province?: string;
};
type ContactLite = { contact_id: string; first_name: string; last_name: string; phone?: string; whatsapp?: string; email?: string };
type ContactSearchResult = { contact_id: string; first_name: string; last_name: string; phone?: string; email?: string; area?: string };

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

export default function AppointmentDetailRoute() {
  return (
    <ModuleErrorBoundary moduleName="agenda">
      <AppointmentDetail />
    </ModuleErrorBoundary>
  );
}

function AppointmentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const pagePad = usePageBottomPadding();
  const [a, setA] = useState<Appointment | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [contact, setContact] = useState<ContactLite | null>(null);
  const [showPicker, setShowPicker] = useState<"date" | "time" | null>(null);
  const [callbackAt, setCallbackAt] = useState<Date>(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const [showCbSection, setShowCbSection] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcomeModal, setOutcomeModal] = useState<{ mode: "create" | "rename"; outcome_id?: string; name: string; color: string; counts_as?: string } | null>(null);
  // V26.q — Modale inline per Rinviato/Da ricontattare
  const [rescheduleModal, setRescheduleModal] = useState<{
    kind: "rescheduled" | "followup";
    outcomeName: string;
    date: Date;
    showPicker: null | "date" | "time";
    isPhone: boolean;
    notes: string;
  } | null>(null);
  // V38W — Collega contatto: modal picker
  const [linkModal, setLinkModal] = useState(false);
  const [linkQuery, setLinkQuery] = useState("");
  const [linkContacts, setLinkContacts] = useState<ContactSearchResult[]>([]);
  const [linkLoading, setLinkLoading] = useState(false);
  const [linking, setLinking] = useState<string | null>(null);

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

  // V38W — Link contact search (must be declared before any early return to preserve Hook order)
  const searchContactsForLink = useCallback(async (q: string) => {
    setLinkLoading(true);
    try {
      const r = await api<{ items: ContactSearchResult[] }>("/contacts");
      const items = r.items || [];
      const query = q.trim().toLowerCase();
      let filtered: ContactSearchResult[];
      if (!query) {
        filtered = items.slice(0, 30);
      } else {
        filtered = items.filter((c) => {
          const hay = `${c.first_name || ""} ${c.last_name || ""} ${c.phone || ""} ${c.email || ""}`.toLowerCase();
          return hay.includes(query);
        }).slice(0, 50);
      }
      setLinkContacts(filtered);
    } catch {
      setLinkContacts([]);
    } finally {
      setLinkLoading(false);
    }
  }, []);
  useFocusEffect(useCallback(() => {
    if (linkModal) searchContactsForLink(linkQuery);
  }, [linkModal, linkQuery, searchContactsForLink]));
  useEffect(() => {
    if (!linkModal) return;
    const t = setTimeout(() => searchContactsForLink(linkQuery), 250);
    return () => clearTimeout(t);
  }, [linkQuery, linkModal, searchContactsForLink]);

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
    // V26.q: Rinviato → apri modal per fissare nuova data
    if (outcome?.counts_as === "rescheduled" && !selectedOutcomeIds.includes(outcomeId)) {
      setRescheduleModal({
        kind: "rescheduled",
        outcomeName: outcome.name,
        date: new Date(Date.now() + 24 * 60 * 60 * 1000),
        showPicker: null,
        isPhone: a.is_phone,
        notes: "",
      });
    }
    // V26.q: Da ricontattare → apri modal per fissare nuova data + tipo
    if (outcome?.counts_as === "followup" && !selectedOutcomeIds.includes(outcomeId)) {
      setRescheduleModal({
        kind: "followup",
        outcomeName: outcome.name,
        date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        showPicker: null,
        isPhone: false,
        notes: "",
      });
    }
  };

  const confirmReschedule = async () => {
    if (!rescheduleModal || !a) return;
    try {
      // Crea nuovo appuntamento
      const payload: any = {
        contact_id: a.contact_id || null,
        title: a.title,
        area: a.area,
        start_at: rescheduleModal.date.toISOString(),
        duration_min: a.duration_min || 60,
        is_phone: rescheduleModal.isPhone,
        location: a.location || "",
        notes: (rescheduleModal.notes ? rescheduleModal.notes + "\n\n" : "") + `Ri-programmato da: ${a.title} (${new Date(a.start_at).toLocaleString("it-IT")})`,
        reminder_minutes: a.reminder_minutes ?? 15,
        recurrence: "none",
        participant_contact_ids: [],
        value_amount: a.value_amount || 0,
        appointment_type_tags: a.appointment_type_tags || [],
        product_categories: a.product_categories || [],
      };
      const newAp = await api<{ appointment_id: string }>("/appointments", { method: "POST", body: payload });
      // Link il vecchio → nuovo
      await api(`/appointments/${id}`, { method: "PUT", body: { rescheduled_to: newAp.appointment_id } });
      setRescheduleModal(null);
      router.push(`/appointment/${newAp.appointment_id}`);
    } catch (e: any) {
      if (Platform.OS === "web") window.alert("Errore: " + (e?.message || ""));
      else Alert.alert("Errore", e?.message || "Impossibile creare");
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

  // V38W — Link contact action (search hook moved above early-return for Hook stability)
  const linkContact = async (contactId: string) => {
    if (!a) return;
    setLinking(contactId);
    try {
      await api(`/appointments/${id}`, { method: "PUT", body: { contact_id: contactId } });
      // Fetch full contact + refreshed appointment
      const [updatedAppt, updatedContact] = await Promise.all([
        api<Appointment>(`/appointments/${id}`),
        api<ContactLite>(`/contacts/${contactId}`).catch(() => null),
      ]);
      setA(updatedAppt);
      if (updatedContact) setContact(updatedContact);
      setLinkModal(false);
      setLinkQuery("");
    } catch (e: any) {
      if (Platform.OS === "web") window.alert("Errore collegamento: " + (e?.message || ""));
      else Alert.alert("Errore collegamento", e?.message || "");
    } finally {
      setLinking(null);
    }
  };

  const rescheduleTo = async (d: Date, mode: "date" | "time" | "datetime") => {
    const next = new Date(a.start_at);
    if (mode === "date") {
      next.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
    } else if (mode === "time") {
      // V50.z110 — Reset esplicito di secondi e millisecondi per evitare drift
      // (es. seconds ereditati da un salvataggio precedente che, ri-serializzati,
      // possono spostare il minuto visualizzato).
      next.setHours(d.getHours(), d.getMinutes(), 0, 0);
    } else {
      // datetime: sostituisci sia data sia ora (usato dall'input web datetime-local).
      next.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
      next.setHours(d.getHours(), d.getMinutes(), 0, 0);
    }
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

      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: pagePad }}>
        {a.read_only && (
          <View style={styles.roBanner}>
            <Ionicons name="lock-closed" size={16} color="#FFF" />
            <Text style={styles.roBannerTxt}>Evento condiviso dal team — sola lettura</Text>
          </View>
        )}
        {a.is_broadcast && !a.read_only && (
          <View style={styles.bcBanner}>
            <Ionicons name="megaphone" size={16} color="#FFF" />
            <Text style={styles.roBannerTxt}>Evento inviato ai collaboratori</Text>
          </View>
        )}
        <View style={[styles.titleCard, { borderLeftColor: color }]}>
          <Text style={styles.apTitle}>{a.title}</Text>
          <View style={styles.metaRow}>
            <Ionicons name="time-outline" size={14} color={theme.color.muted} />
            <Text style={styles.metaTxt}>{new Date(a.start_at).toLocaleString("it-IT")}</Text>
            {a.is_phone && <><Ionicons name="call" size={14} color={color} /><Text style={[styles.metaTxt, { color }]}>Telefonico</Text></>}
          </View>
          {(a.appointment_type_tags || []).length > 0 && (
            <View style={[styles.metaRow, { flexWrap: "wrap", marginTop: 6 }]}>
              {(a.appointment_type_tags || []).map((t) => {
                const c = apptTypeColor(t);
                return (
                  <View key={t} testID={`ap-detail-type-${t}`} style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, borderWidth: 1, borderColor: c }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c }} />
                    <Text style={[styles.metaTxt, { color: c, fontWeight: "700" }]}>{t}</Text>
                  </View>
                );
              })}
            </View>
          )}
          {a.location ? (
            <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
              <Pressable testID="waze-btn" onPress={() => Linking.openURL(`https://www.waze.com/ul?q=${encodeURIComponent(a.location)}&navigate=yes`)} style={[styles.wazeBtn, { flex: 1 }]}>
                <Ionicons name="navigate" size={16} color={theme.color.brandPrimary} />
                <Text style={styles.wazeTxt} numberOfLines={1}>Waze</Text>
              </Pressable>
              <Pressable testID="gmaps-btn" onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a.location)}`)} style={[styles.wazeBtn, { flex: 1, borderColor: "#34A853" }]}>
                <Ionicons name="map" size={16} color="#34A853" />
                <Text style={[styles.wazeTxt, { color: "#34A853" }]} numberOfLines={1}>Google Maps</Text>
              </Pressable>
            </View>
          ) : null}
          {a.location ? <Text style={styles.addrTxt}>{a.location}</Text> : null}
        </View>

        <Pressable testID="done-btn" onPress={() => savePartial({ done: !a.done })} style={[styles.doneBtn, a.done && { backgroundColor: theme.color.success }]}>
          <Ionicons name={a.done ? "checkmark-circle" : "ellipse-outline"} size={22} color="#FFF" />
          <Text style={styles.doneBtnTxt}>{a.done ? "Appuntamento fatto ✓" : "Segna come fatto"}</Text>
        </Pressable>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Condividi con il cliente</Text>
          {/* v2.16 — use shared component with fallback phone/email from appt */}
          <AppointmentShareActions
            appt={{
              title: a.title,
              start_at: a.start_at,
              is_phone: a.is_phone,
              location: a.location,
              notes: a.notes,
              phone_mobile: a.phone_mobile,
              phone_work: a.phone_work,
              email: a.email,
              address_street: a.address_street,
              address_number: a.address_number,
              address_city: a.address_city,
              address_zip: a.address_zip,
              address_province: a.address_province,
            }}
            contact={contact ? {
              first_name: contact.first_name,
              last_name: contact.last_name,
              phone: contact.phone,
              whatsapp: contact.whatsapp,
              email: contact.email,
            } : null}
            compact
          />
          {!contact && (
            <View style={styles.linkContactBlock}>
              <View style={styles.linkContactRow}>
                <Ionicons name="link" size={16} color={theme.color.muted} />
                <Text style={styles.shareWarn}>Nessun contatto collegato — puoi comunque usare i canali sopra se hai inserito telefono/email nell&apos;appuntamento.</Text>
              </View>
              <Pressable
                testID="link-contact-btn"
                onPress={() => { setLinkModal(true); setLinkQuery(""); }}
                style={styles.linkContactBtn}
              >
                <Ionicons name="person-add" size={16} color="#FFF" />
                <Text style={styles.linkContactBtnTxt}>Collega contatto</Text>
              </Pressable>
            </View>
          )}
          {contact && (
            <View style={styles.linkedContactRow}>
              <Ionicons name="checkmark-circle" size={14} color={theme.color.success} />
              <Text style={styles.linkedContactTxt}>
                Collegato a: <Text style={{ fontWeight: "700" }}>{contact.first_name} {contact.last_name}</Text>
              </Text>
              <Pressable
                testID="link-contact-change"
                onPress={() => { setLinkModal(true); setLinkQuery(""); }}
                hitSlop={8}
              >
                <Text style={styles.linkChangeTxt}>Cambia</Text>
              </Pressable>
            </View>
          )}
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
              onChange={(e: any) => {
                // V50.z110 — datetime-local restituisce "YYYY-MM-DDTHH:MM" senza timezone.
                // I browser lo interpretano come ORA LOCALE (spec HTML5). Passiamo mode
                // "datetime" così sia data sia ora vengono salvate (prima solo la data
                // veniva applicata → cambio d'orario dal web silenziosamente ignorato).
                const v = e?.target?.value;
                if (!v) return;
                rescheduleTo(new Date(v), "datetime");
              }}
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
              <Pressable testID="add-callback-btn" onPress={() => setShowCbSection(true)} style={styles.greenAddBtn}>
                <Ionicons name="call" size={18} color="#FFF" />
                <Text style={styles.greenAddTxt}>Aggiungi Telefonata</Text>
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

        <View style={[styles.card, { borderLeftColor: theme.color.success, borderLeftWidth: 4 }]}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
            <Text style={styles.sectionTitle}>Esito dell&apos;appuntamento</Text>
            {a.done ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Ionicons name="checkmark-circle" size={14} color={theme.color.success} />
                <Text style={{ color: theme.color.success, fontWeight: "700", fontSize: 11 }}>Fatto</Text>
              </View>
            ) : (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Ionicons name="time-outline" size={14} color={theme.color.warning} />
                <Text style={{ color: theme.color.warning, fontWeight: "700", fontSize: 11 }}>Da svolgere</Text>
              </View>
            )}
          </View>
          <Text style={styles.shareHint}>
            {a.done
              ? "Seleziona uno o più esiti. Se scegli \"Rinviato\" puoi riprogrammare l'appuntamento."
              : "Segna prima l'appuntamento come \"Fatto\" per registrare gli esiti (Contratto, Nuovo cliente, Rinviato ecc.)"}
          </Text>
          <View style={[styles.outcomesGrid, !a.done && { opacity: 0.5 }]} pointerEvents={a.done ? "auto" : "none"}>
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

      {/* V26.q — Modal Rinviato/Da ricontattare */}
      <Modal visible={!!rescheduleModal} transparent animationType="fade" onRequestClose={() => setRescheduleModal(null)}>
        <View style={omstyles.back}>
          <View style={omstyles.card}>
            <Text style={omstyles.title}>{rescheduleModal?.kind === "rescheduled" ? "Rinvia appuntamento" : "Programma ricontatto"}</Text>
            <Text style={omstyles.hint}>Fissa una nuova data e ora.</Text>

            <Text style={omstyles.lbl}>Data e ora</Text>
            {Platform.OS === "web" ? (
              <input
                type="datetime-local"
                data-testid="resched-datetime"
                value={rescheduleModal ? new Date(rescheduleModal.date.getTime() - rescheduleModal.date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ""}
                onChange={(e: any) => { if (rescheduleModal && e.target.value) setRescheduleModal({ ...rescheduleModal, date: new Date(e.target.value) }); }}
                style={{ width: "100%", border: `1px solid ${theme.color.border}`, borderRadius: 10, padding: "10px 12px", fontSize: 15, marginBottom: 8 } as any}
              />
            ) : (
              <>
                <View style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
                  <Pressable testID="resched-date-btn" onPress={() => setRescheduleModal((m) => m ? { ...m, showPicker: "date" } : m)} style={[omstyles.input, { flexDirection: "row", alignItems: "center", gap: 6 }]}>
                    <Ionicons name="calendar-outline" size={16} color={theme.color.brandPrimary} />
                    <Text>{rescheduleModal?.date.toLocaleDateString("it-IT")}</Text>
                  </Pressable>
                  <Pressable testID="resched-time-btn" onPress={() => setRescheduleModal((m) => m ? { ...m, showPicker: "time" } : m)} style={[omstyles.input, { flexDirection: "row", alignItems: "center", gap: 6 }]}>
                    <Ionicons name="time-outline" size={16} color={theme.color.brandPrimary} />
                    <Text>{rescheduleModal?.date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text>
                  </Pressable>
                </View>
                {rescheduleModal?.showPicker ? (
                  <DateTimePicker
                    value={rescheduleModal.date}
                    mode={rescheduleModal.showPicker}
                    onChange={(_, d) => {
                      setRescheduleModal((m) => {
                        if (!m) return m;
                        if (!d) return { ...m, showPicker: null };
                        const nd = new Date(m.date);
                        if (m.showPicker === "date") nd.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
                        else nd.setHours(d.getHours(), d.getMinutes(), 0, 0);
                        return { ...m, date: nd, showPicker: null };
                      });
                    }}
                  />
                ) : null}
              </>
            )}

            {rescheduleModal?.kind === "followup" ? (
              <>
                <Text style={omstyles.lbl}>Tipo appuntamento</Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Pressable
                    testID="resched-type-presence"
                    onPress={() => setRescheduleModal((m) => m ? { ...m, isPhone: false } : m)}
                    style={[omstyles.typeChip, !rescheduleModal.isPhone && { backgroundColor: theme.color.brandPrimary, borderColor: theme.color.brandPrimary }]}
                  >
                    <Ionicons name="location" size={14} color={!rescheduleModal.isPhone ? "#FFF" : theme.color.onSurface} />
                    <Text style={[omstyles.typeChipTxt, !rescheduleModal.isPhone && { color: "#FFF" }]}>In presenza</Text>
                  </Pressable>
                  <Pressable
                    testID="resched-type-phone"
                    onPress={() => setRescheduleModal((m) => m ? { ...m, isPhone: true } : m)}
                    style={[omstyles.typeChip, rescheduleModal.isPhone && { backgroundColor: theme.color.brandPrimary, borderColor: theme.color.brandPrimary }]}
                  >
                    <Ionicons name="call" size={14} color={rescheduleModal.isPhone ? "#FFF" : theme.color.onSurface} />
                    <Text style={[omstyles.typeChipTxt, rescheduleModal.isPhone && { color: "#FFF" }]}>Telefonico</Text>
                  </Pressable>
                </View>
              </>
            ) : null}

            <Text style={omstyles.lbl}>Note (opzionale)</Text>
            <TextInput
              testID="resched-notes"
              value={rescheduleModal?.notes || ""}
              onChangeText={(t) => setRescheduleModal((m) => m ? { ...m, notes: t } : m)}
              style={[omstyles.input, { minHeight: 60, textAlignVertical: "top" }]}
              multiline
              placeholderTextColor="#94A3B8"
            />

            <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
              <Pressable testID="resched-cancel" onPress={() => setRescheduleModal(null)} style={[omstyles.btn, { backgroundColor: "#E5E7EB" }]}>
                <Text style={[omstyles.btnTxt, { color: theme.color.onSurface }]}>Annulla</Text>
              </Pressable>
              <Pressable testID="resched-confirm" onPress={confirmReschedule} style={omstyles.btn}>
                <Ionicons name="checkmark" size={16} color="#FFF" />
                <Text style={omstyles.btnTxt}>{rescheduleModal?.kind === "rescheduled" ? "Rinvia" : "Programma"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>


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

      {/* V38W — Link Contact modal */}
      <Modal transparent visible={linkModal} animationType="fade" onRequestClose={() => setLinkModal(false)}>
        <View style={omstyles.back}>
          <View style={[omstyles.card, { maxHeight: "85%" }]}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <Text style={omstyles.title}>Collega contatto</Text>
              <Pressable testID="link-modal-close" onPress={() => setLinkModal(false)} hitSlop={10}>
                <Ionicons name="close" size={22} color={theme.color.muted} />
              </Pressable>
            </View>
            <Text style={omstyles.hint}>Cerca un contatto esistente e collegalo all&apos;appuntamento.</Text>
            <TextInput
              testID="link-search-input"
              placeholder="Nome, cognome, telefono o email"
              placeholderTextColor="#94A3B8"
              value={linkQuery}
              onChangeText={setLinkQuery}
              style={omstyles.input}
              autoFocus
            />
            <ScrollView style={{ maxHeight: 360, marginTop: 10 }} contentContainerStyle={{ gap: 6 }}>
              {linkLoading ? (
                <ActivityIndicator style={{ marginTop: 20 }} color={theme.color.brandPrimary} />
              ) : linkContacts.length === 0 ? (
                <View style={{ padding: 24, alignItems: "center" }}>
                  <Ionicons name="people-outline" size={30} color={theme.color.muted} />
                  <Text style={{ color: theme.color.muted, fontSize: 12, marginTop: 6, textAlign: "center" }}>
                    {linkQuery.trim() ? "Nessun contatto trovato" : "Inizia a scrivere per cercare"}
                  </Text>
                </View>
              ) : (
                linkContacts.map((c) => (
                  <Pressable
                    key={c.contact_id}
                    testID={`link-pick-${c.contact_id}`}
                    onPress={() => linkContact(c.contact_id)}
                    disabled={!!linking}
                    style={styles.linkContactItem}
                  >
                    <View style={[styles.linkAvatar, { backgroundColor: c.area === "energy" ? theme.color.energy : theme.color.network }]}>
                      <Text style={{ color: "#FFF", fontWeight: "800", fontSize: 12 }}>
                        {(c.first_name?.[0] || "?").toUpperCase()}{(c.last_name?.[0] || "").toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.linkName} numberOfLines={1}>{c.first_name} {c.last_name}</Text>
                      {c.phone || c.email ? (
                        <Text style={styles.linkMeta} numberOfLines={1}>{[c.phone, c.email].filter(Boolean).join(" · ")}</Text>
                      ) : null}
                    </View>
                    {linking === c.contact_id ? (
                      <ActivityIndicator size="small" color={theme.color.brandPrimary} />
                    ) : (
                      <Ionicons name="chevron-forward" size={18} color={theme.color.muted} />
                    )}
                  </Pressable>
                ))
              )}
            </ScrollView>
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
  typeChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 10, borderRadius: theme.radius.pill, backgroundColor: "#FFF", borderWidth: 1, borderColor: theme.color.border, flex: 1, justifyContent: "center" },
  typeChipTxt: { fontSize: 12, fontWeight: "700", color: theme.color.onSurfaceTertiary },
  btn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: theme.radius.md, backgroundColor: theme.color.brandPrimary },
  btnTxt: { color: "#FFF", fontWeight: "700", fontSize: 13 },
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12 },
  headerTxt: { color: "#FFF", fontSize: 16, fontWeight: "700" },
  titleCard: { backgroundColor: "#FFF", padding: 16, borderRadius: theme.radius.md, borderLeftWidth: 4, borderWidth: 1, borderColor: theme.color.border },
  apTitle: { fontSize: 20, fontWeight: "700", color: theme.color.onSurface },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6, flexWrap: "wrap" },
  metaTxt: { fontSize: 13, color: theme.color.muted },
  wazeBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 10, backgroundColor: theme.color.brandTertiary, paddingHorizontal: 10, paddingVertical: 8, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.color.brandPrimary },
  wazeTxt: { color: theme.color.brandPrimary, fontWeight: "700", fontSize: 13 },
  addrTxt: { color: theme.color.muted, fontSize: 12, marginTop: 6 },
  roBanner: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: theme.color.muted, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  bcBanner: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#7A2E8E", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  roBannerTxt: { color: "#FFF", fontWeight: "700", fontSize: 12 },
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
  // V38S — Long green "Aggiungi Telefonata"
  greenAddBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#16A34A", paddingVertical: 12, borderRadius: 10, marginTop: 6 },
  greenAddTxt: { color: "#FFF", fontSize: 14, fontWeight: "800" },
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
  // V38W — Link contact button + modal styles
  linkContactBlock: { marginTop: 8, gap: 8 },
  linkContactRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  linkContactBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: theme.color.brandPrimary, paddingVertical: 12, borderRadius: 10 },
  linkContactBtnTxt: { color: "#FFF", fontWeight: "800", fontSize: 13 },
  linkedContactRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, backgroundColor: "#F1F5F9", paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8 },
  linkedContactTxt: { flex: 1, fontSize: 12, color: theme.color.onSurface },
  linkChangeTxt: { fontSize: 12, color: theme.color.brandPrimary, fontWeight: "700" },
  linkContactItem: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: theme.color.border, backgroundColor: "#FFF" },
  linkAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  linkName: { fontSize: 14, fontWeight: "700", color: theme.color.onSurface },
  linkMeta: { fontSize: 11, color: theme.color.muted, marginTop: 2 },
});

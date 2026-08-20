import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView, ActivityIndicator, Platform, Switch, Modal, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { useAudioRecorder, AudioModule, RecordingPresets } from "expo-audio";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { theme } from "@/src/theme";
import { scheduleAppointmentReminder } from "@/src/notifications";
import { uriToBase64DataUrl, uriToBase64, base64ByteSize } from "@/src/utils/media";
import { notify } from "@/src/utils/notify";
import { WheelPickerModal, WheelItem } from "@/src/WheelPicker";

type Attachment = {
  id: string;
  kind: "photo" | "audio" | "file";
  photo_base64?: string;
  audio_base64?: string;
  audio_mime?: string;
  file_base64?: string;
  file_name?: string;
  file_mime?: string;
  file_size?: number;
};

type Contact = {
  contact_id: string; first_name: string; last_name: string; area: string;
  address: string; phone?: string; phone_alt?: string;
  address_street?: string; address_number?: string; address_zip?: string; address_city?: string; address_province?: string;
  work_address?: string; residence_address?: string;
};
type Settings = {
  energy_title: string; network_title: string;
  custom_appointment_types?: string[];
  custom_product_categories?: { name: string; subs?: string[] }[];
};

const DEFAULT_APPT_TYPES = ["Energy", "Telefonata", "Personale", "Riunione", "Promemoria", "Altro"];
// V38S — Color per appointment type (shown in calendar week/month view + on the pill)
const APPT_TYPE_COLORS: Record<string, string> = {
  "Energy": "#DC2626",         // rosso
  "Telefonata": "#EA580C",     // arancione
  "Personale": "#16A34A",      // verde
  "Riunione": "#2563EB",       // blu
  "Promemoria": "#F59E0B",     // giallo
  "Altro": "#6B7280",          // grigio
};
export function apptTypeColor(t?: string): string {
  if (!t) return "#6B7280";
  return APPT_TYPE_COLORS[t] || "#8B5CF6"; // custom types → purple fallback
}
const DEFAULT_PRODUCT_CATS = [
  { name: "Demo prodotti", subs: ["Artistry", "Nutrilite", "Home"] },
];

const DURATIONS: WheelItem<number>[] = [
  { value: 5, label: "5 min" },
  { value: 10, label: "10 min" },
  { value: 15, label: "15 min" },
  { value: 20, label: "20 min" },
  { value: 30, label: "30 min" },
  { value: 45, label: "45 min" },
  { value: 60, label: "1 ora" },
  { value: 75, label: "1 ora 15 min" },
  { value: 90, label: "1 ora 30 min" },
  { value: 105, label: "1 ora 45 min" },
  { value: 120, label: "2 ore" },
  { value: 150, label: "2 ore 30 min" },
  { value: 180, label: "3 ore" },
  { value: 240, label: "4 ore" },
  { value: 300, label: "5 ore" },
  { value: 360, label: "6 ore" },
  { value: 480, label: "8 ore (giornata)" },
];
const REMINDERS: WheelItem<number>[] = [
  { value: 0, label: "Nessuno" },
  { value: 5, label: "5 min prima" },
  { value: 10, label: "10 min prima" },
  { value: 15, label: "15 min prima" },
  { value: 20, label: "20 min prima" },
  { value: 30, label: "30 min prima" },
  { value: 45, label: "45 min prima" },
  { value: 60, label: "1 ora prima" },
  { value: 120, label: "2 ore prima" },
  { value: 180, label: "3 ore prima" },
  { value: 360, label: "6 ore prima" },
  { value: 720, label: "12 ore prima" },
  { value: 1440, label: "1 giorno prima" },
  { value: 2880, label: "2 giorni prima" },
  { value: 10080, label: "1 settimana prima" },
];
const labelFor = <T,>(items: WheelItem<T>[], v: T, fallback = "-") =>
  (items.find((it) => it.value === v)?.label) ?? fallback;
const RECURRENCES = [
  { k: "none", label: "Nessuna" }, { k: "weekly", label: "Settimanale" },
  { k: "monthly", label: "Mensile" }, { k: "yearly", label: "Annuale" },
];

export default function NewAppointmentScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const allowed = (user?.areas || ["energy", "network"]) as ("energy" | "network")[];
  const { contactId, reschedule_from, title: prefTitle, area: prefArea, location: prefLoc, notes: prefNotes, contact_id: prefContact, is_phone: prefPhone } = useLocalSearchParams<{
    contactId?: string; reschedule_from?: string; title?: string; area?: string; location?: string; notes?: string; contact_id?: string; is_phone?: string;
  }>();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [form, setForm] = useState({
    title: prefTitle || "",
    contact_id: contactId || prefContact || "",
    participant_contact_ids: [] as string[],
    area: (prefArea === "network" ? "network" : prefArea === "energy" ? "energy" : (allowed[0] || "energy")) as "energy" | "network",
    start_at: new Date(Date.now() + 60 * 60 * 1000),
    duration_min: 60,
    reminder_minutes: 15,
    recurrence: "none" as "none" | "weekly" | "monthly" | "yearly",
    is_phone: prefPhone === "1",
    phone_mobile: "",
    phone_work: "",
    phone_target: "" as "" | "mobile" | "work",
    location: prefLoc || "",
    map_address: "",
    full_address: "",
    notes: prefNotes || "",
    value_amount: "",
    appointment_type_tags: [] as string[],
    product_categories: [] as string[],
  });
  const [broadcast, setBroadcast] = useState({
    enabled: false,
    scope: "subtree" as "all" | "subtree" | "custom",
    notify_min: 30,
    custom_ids: [] as string[],
  });
  const [teamMembers, setTeamMembers] = useState<{ user_id: string; name: string; role: string }[]>([]);

  const canBroadcast = user?.role === "owner" || user?.role === "admin";
  useEffect(() => {
    if (!canBroadcast) return;
    (async () => {
      try {
        const r = await api<{ items: { user_id: string; name: string; role: string }[] }>("/team/members");
        setTeamMembers((r.items || []).filter((m) => m.user_id !== user?.user_id));
      } catch {}
    })();
  }, [canBroadcast, user?.user_id]);
  const [showPicker, setShowPicker] = useState<"date" | "time" | null>(null);
  const [wheelPicker, setWheelPicker] = useState<null | "duration" | "reminder">(null);
  const [busy, setBusy] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [recording, setRecording] = useState(false);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const webRecRef = useRef<{ mr: MediaRecorder; chunks: Blob[]; stream: MediaStream } | null>(null);

  const addPhoto = async (fromCamera: boolean) => {
    try {
      const perm = fromCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (Platform.OS !== "web" && !perm.granted) {
        notify("Permesso negato");
        return;
      }
      // IMPORTANT: On web, do NOT request base64 (broken in expo-image-picker 17.x web).
      const useBase64 = Platform.OS !== "web";
      const opts: any = { quality: 0.5, base64: useBase64, mediaTypes: ImagePicker.MediaTypeOptions.Images };
      const res = fromCamera
        ? await ImagePicker.launchCameraAsync(opts)
        : await ImagePicker.launchImageLibraryAsync(opts);
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      let dataUrl: string;
      if (a.base64) {
        dataUrl = `data:${a.mimeType || "image/jpeg"};base64,${a.base64}`;
      } else if (a.uri) {
        dataUrl = await uriToBase64DataUrl(a.uri, a.mimeType || "image/jpeg");
      } else {
        return;
      }
      if (base64ByteSize(dataUrl) > 8 * 1024 * 1024) {
        notify("Foto troppo grande", "Prova con una foto più piccola (max ~8 MB)");
        return;
      }
      setAttachments((p) => [...p, { id: `${Date.now()}`, kind: "photo", photo_base64: dataUrl }]);
    } catch (e: any) {
      console.warn("addPhoto err", e);
      notify("Impossibile caricare la foto", e?.message || "Riprova con un'altra immagine");
    }
  };

  const pickFile = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: "*/*", multiple: false, copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      const b64 = await uriToBase64(asset.uri);
      if (base64ByteSize(b64) > 15 * 1024 * 1024) {
        notify("File troppo grande", "Massimo 15 MB");
        return;
      }
      setAttachments((p) => [...p, {
        id: `${Date.now()}`, kind: "file",
        file_base64: b64,
        file_name: asset.name,
        file_mime: asset.mimeType || "application/octet-stream",
        file_size: asset.size || 0,
      }]);
    } catch (e: any) {
      console.warn("pickFile err", e);
      notify("Impossibile caricare il file", e?.message || "Riprova");
    }
  };

  const startRec = async () => {
    try {
      if (Platform.OS === "web") {
        // Web: use MediaRecorder API directly
        return await startRecWeb();
      }
      const { granted } = await AudioModule.requestRecordingPermissionsAsync();
      if (!granted) { notify("Permesso microfono negato"); return; }
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
    } catch (e: any) {
      console.warn("startRec err", e);
      notify("Impossibile iniziare la registrazione", e?.message || "");
    }
  };

  const stopRec = async () => {
    try {
      if (Platform.OS === "web") {
        return await stopRecWeb();
      }
      setRecording(false);
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) return;
      const b64 = await uriToBase64(uri);
      setAttachments((p) => [...p, { id: `${Date.now()}`, kind: "audio", audio_base64: b64, audio_mime: "audio/m4a" }]);
    } catch (e: any) { console.warn(e); }
  };

  // ---- Web audio recording (MediaRecorder) ----

  const startRecWeb = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      mr.start();
      webRecRef.current = { mr, chunks, stream };
      setRecording(true);
    } catch (e: any) {
      notify("Microfono non accessibile", e?.message || "Autorizza il microfono nel browser");
    }
  };

  const stopRecWeb = async () => {
    const st = webRecRef.current;
    if (!st) { setRecording(false); return; }
    await new Promise<void>((resolve) => {
      st.mr.onstop = () => resolve();
      st.mr.stop();
    });
    st.stream.getTracks().forEach((t) => t.stop());
    setRecording(false);
    const blob = new Blob(st.chunks, { type: "audio/webm" });
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("read failed"));
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(blob);
    });
    const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    setAttachments((p) => [...p, { id: `${Date.now()}`, kind: "audio", audio_base64: b64, audio_mime: "audio/webm" }]);
    webRecRef.current = null;
  };

  const removeAttachment = (id: string) => setAttachments((p) => p.filter((a) => a.id !== id));

  useEffect(() => {
    api<{ items: Contact[] }>("/contacts").then((r) => setContacts(r.items));
    api<Settings>("/settings").then(setSettings).catch(() => {});
  }, []);

  useEffect(() => {
    if (contactId && contacts.length) {
      const c = contacts.find((x) => x.contact_id === contactId);
      if (c) {
        // Compute full structured address if available, else fallback to raw
        const structured = [c.address_street, c.address_number ? c.address_number : "", [c.address_zip, c.address_city].filter(Boolean).join(" "), c.address_province]
          .filter(Boolean).join(", ");
        const fullAddr = structured || c.work_address || c.residence_address || c.address || "";
        setForm((f) => ({
          ...f,
          contact_id: c.contact_id,
          area: ((c.area as any) || f.area) as any,
          title: f.title || `Appuntamento ${c.first_name} ${c.last_name}`,
          location: c.address || f.location,
          phone_mobile: c.phone || f.phone_mobile,
          phone_work: c.phone_alt || f.phone_work,
          full_address: fullAddr || f.full_address,
          phone_target: !f.phone_target && c.phone ? "mobile" : (f.phone_target || (c.phone_alt ? "work" : "")),
        }));
      }
    }
  }, [contacts, contactId]);

  const submit = async () => {
    if (!form.title.trim()) return;
    setBusy(true);
    try {
      const payload: any = {
        ...form,
        start_at: form.start_at.toISOString(),
        value_amount: form.value_amount ? parseFloat(form.value_amount) : 0,
        note_attachments: attachments,
        is_broadcast: broadcast.enabled && canBroadcast,
        broadcast_scope: broadcast.enabled && canBroadcast ? broadcast.scope : null,
        broadcast_to_user_ids: broadcast.enabled && broadcast.scope === "custom" ? broadcast.custom_ids : [],
        broadcast_notify_advance_min: broadcast.notify_min,
      };
      delete payload.value_amount_str;
      const created = await api<{ appointment_id: string }>("/appointments", { method: "POST", body: payload });
      if (form.reminder_minutes > 0) {
        await scheduleAppointmentReminder(created.appointment_id, form.title, form.start_at);
      }
      // If we're rescheduling from an existing appointment, link them
      if (reschedule_from) {
        try {
          await api(`/appointments/${reschedule_from}`, { method: "PUT", body: { rescheduled_to: created.appointment_id } });
        } catch (e) { console.warn(e); }
      }
      router.back();
    } finally { setBusy(false); }
  };

  const setDate = (d: Date) => { const n = new Date(form.start_at); n.setFullYear(d.getFullYear(), d.getMonth(), d.getDate()); setForm({ ...form, start_at: n }); };
  const setTime = (d: Date) => { const n = new Date(form.start_at); n.setHours(d.getHours(), d.getMinutes(), 0, 0); setForm({ ...form, start_at: n }); };

  const toggleParticipant = (cid: string) => {
    const has = form.participant_contact_ids.includes(cid);
    const next = has ? form.participant_contact_ids.filter((x) => x !== cid) : [...form.participant_contact_ids, cid];
    setForm({ ...form, participant_contact_ids: next });
  };

  const toggleType = (t: string) => {
    const has = form.appointment_type_tags.includes(t);
    setForm({
      ...form,
      appointment_type_tags: has ? form.appointment_type_tags.filter((x) => x !== t) : [...form.appointment_type_tags, t],
    });
  };

  const [typeEditModal, setTypeEditModal] = useState<{ mode: "create" | "rename"; oldName?: string; value: string } | null>(null);

  const saveTypeEdit = async () => {
    if (!typeEditModal || !settings) return;
    const val = typeEditModal.value.trim();
    if (!val) return;
    if (typeEditModal.mode === "create") {
      if ([...DEFAULT_APPT_TYPES, ...(settings.custom_appointment_types || [])].includes(val)) {
        notify("Nome già esistente");
        return;
      }
      const next = { ...settings, custom_appointment_types: [...(settings.custom_appointment_types || []), val] };
      const saved = await api<Settings>("/settings", { method: "PUT", body: next });
      setSettings(saved);
      // Auto-select
      setForm((f) => ({ ...f, appointment_type_tags: [...f.appointment_type_tags, val] }));
    } else if (typeEditModal.mode === "rename" && typeEditModal.oldName) {
      const list = (settings.custom_appointment_types || []).map((x) => x === typeEditModal.oldName ? val : x);
      const next = { ...settings, custom_appointment_types: list };
      const saved = await api<Settings>("/settings", { method: "PUT", body: next });
      setSettings(saved);
      // Update any selected tags on this form
      setForm((f) => ({ ...f, appointment_type_tags: f.appointment_type_tags.map((x) => x === typeEditModal.oldName ? val : x) }));
    }
    setTypeEditModal(null);
  };

  const deleteType = async (name: string) => {
    if (!settings) return;
    notify("Elimina tipo", `Vuoi eliminare "${name}"?`, [
      { text: "Annulla", style: "cancel" },
      {
        text: "Elimina", style: "destructive", onPress: async () => {
          const list = (settings.custom_appointment_types || []).filter((x) => x !== name);
          const saved = await api<Settings>("/settings", { method: "PUT", body: { ...settings, custom_appointment_types: list } });
          setSettings(saved);
          setForm((f) => ({ ...f, appointment_type_tags: f.appointment_type_tags.filter((x) => x !== name) }));
        }
      },
    ]);
  };

  const toggleProduct = (t: string) => {
    const has = form.product_categories.includes(t);
    setForm({
      ...form,
      product_categories: has ? form.product_categories.filter((x) => x !== t) : [...form.product_categories, t],
    });
  };

  const allApptTypes = [...DEFAULT_APPT_TYPES, ...(settings?.custom_appointment_types || [])];
  const showDemo = form.appointment_type_tags.includes("Demo prodotti");
  const productCats = [...DEFAULT_PRODUCT_CATS, ...(settings?.custom_product_categories || [])];

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable testID="back-btn" onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={26} color={theme.color.onSurface} /></Pressable>
        <Text style={styles.title}>Nuovo appuntamento</Text>
        <View style={{ width: 26 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

        <View style={styles.card}>
          <Text style={styles.lbl}>Titolo *</Text>
          <TextInput testID="ap-title" value={form.title} onChangeText={(t) => setForm({ ...form, title: t })} style={styles.input} placeholder="Titolo appuntamento" placeholderTextColor="#94A3B8" />

          <Text style={styles.lbl}>Area</Text>
          <View style={styles.pillsRow}>
            {(["energy", "network"] as const).filter((a) => allowed.includes(a)).map((a) => (
              <Pressable key={a} testID={`ap-area-${a}`} onPress={() => setForm({ ...form, area: a })} style={[styles.pill, form.area === a && { backgroundColor: a === "energy" ? theme.color.energy : theme.color.network, borderColor: a === "energy" ? theme.color.energy : theme.color.network }]}>
                <Text style={[styles.pillTxt, form.area === a && styles.pillTxtActive]}>{a === "energy" ? "Energia" : "Network"}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Tipo appuntamento (spuntabili più di uno)</Text>
          <Text style={styles.hint}>Tocca per selezionare · Tocca a lungo un tipo personalizzato per rinominare o eliminare</Text>
          <View style={styles.pillsRow}>
            {allApptTypes.map((t) => {
              const active = form.appointment_type_tags.includes(t);
              const isCustom = !DEFAULT_APPT_TYPES.includes(t);
              const c = apptTypeColor(t);
              return (
                <Pressable
                  key={t}
                  testID={`ap-type-${t}`}
                  onPress={() => toggleType(t)}
                  onLongPress={isCustom ? () => {
                    notify(t, "Cosa vuoi fare?", [
                      { text: "Annulla", style: "cancel" },
                      { text: "Rinomina", onPress: () => setTypeEditModal({ mode: "rename", oldName: t, value: t }) },
                      { text: "Elimina", style: "destructive", onPress: () => deleteType(t) },
                    ]);
                  } : undefined}
                  style={[
                    styles.pill,
                    { flexDirection: "row", alignItems: "center", borderColor: active ? c : "#E5E7EB" },
                    active && { backgroundColor: c, borderColor: c },
                  ]}
                >
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c, marginRight: 6, borderWidth: active ? 2 : 0, borderColor: "#FFF" }} />
                  <Ionicons name={active ? "checkmark-circle" : "ellipse-outline"} size={14} color={active ? "#FFF" : c} />
                  <Text style={[styles.pillTxt, active && styles.pillTxtActive, { marginLeft: 4 }]}>{t}</Text>
                  {isCustom && <Ionicons name="pencil" size={10} color={active ? "#FFF" : theme.color.muted} style={{ marginLeft: 4 }} />}
                </Pressable>
              );
            })}
            <Pressable
              testID="ap-type-new"
              onPress={() => setTypeEditModal({ mode: "create", value: "" })}
              style={[styles.pill, { flexDirection: "row", alignItems: "center", borderStyle: "dashed", borderColor: theme.color.brandPrimary }]}
            >
              <Ionicons name="add" size={14} color={theme.color.brandPrimary} />
              <Text style={[styles.pillTxt, { color: theme.color.brandPrimary, marginLeft: 4 }]}>Nuovo tipo</Text>
            </Pressable>
          </View>

          {showDemo && (
            <>
              <Text style={styles.lbl}>Categorie prodotti</Text>
              {productCats.map((cat) => (
                <View key={cat.name} style={{ marginBottom: 8 }}>
                  <Text style={styles.subCat}>{cat.name}</Text>
                  <View style={styles.pillsRow}>
                    {(cat.subs || []).map((s) => {
                      const key = `${cat.name}:${s}`;
                      const active = form.product_categories.includes(key);
                      return (
                        <Pressable key={key} testID={`ap-prod-${s}`} onPress={() => toggleProduct(key)} style={[styles.pill, active && styles.pillActive]}>
                          <Text style={[styles.pillTxt, active && styles.pillTxtActive]}>{s}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ))}
              <Text style={styles.hint}>Aggiungi altre categorie da &quot;Profilo → Personalizzazioni&quot;</Text>
            </>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Data & ora</Text>
          {Platform.OS === "web" ? (
            <View style={{ marginTop: 4 }}>
              {/* @ts-expect-error web-only */}
              <input
                type="datetime-local"
                value={
                  new Date(form.start_at.getTime() - form.start_at.getTimezoneOffset() * 60000)
                    .toISOString().slice(0, 16)
                }
                onChange={(e: any) => setForm({ ...form, start_at: new Date(e.target.value) })}
                style={webInputStyle}
              />
            </View>
          ) : (
            <>
              <View style={styles.dateRow}>
                <Pressable testID="ap-date-btn" onPress={() => setShowPicker("date")} style={styles.dateBtn}>
                  <Ionicons name="calendar-outline" size={18} color={theme.color.brandPrimary} />
                  <Text style={styles.dateBtnTxt}>{form.start_at.toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" })}</Text>
                </Pressable>
                <Pressable testID="ap-time-btn" onPress={() => setShowPicker("time")} style={styles.dateBtn}>
                  <Ionicons name="time-outline" size={18} color={theme.color.brandPrimary} />
                  <Text style={styles.dateBtnTxt}>{form.start_at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text>
                </Pressable>
              </View>
              {showPicker && (
                <DateTimePicker value={form.start_at} mode={showPicker}
                  onChange={(e, d) => { setShowPicker(null); if (d) { if (showPicker === "date") setDate(d); else setTime(d); } }} />
              )}
            </>
          )}

          <Text style={styles.lbl}>Durata prevista</Text>
          <Pressable
            testID="ap-duration-picker"
            onPress={() => setWheelPicker("duration")}
            style={styles.pickerBtn}
          >
            <Ionicons name="hourglass-outline" size={18} color={theme.color.brandPrimary} />
            <Text style={styles.pickerBtnTxt}>{labelFor(DURATIONS, form.duration_min, `${form.duration_min} min`)}</Text>
            <Ionicons name="chevron-forward" size={16} color={theme.color.muted} />
          </Pressable>

          <Text style={styles.lbl}>Promemoria</Text>
          <Pressable
            testID="ap-reminder-picker"
            onPress={() => setWheelPicker("reminder")}
            style={styles.pickerBtn}
          >
            <Ionicons name="notifications-outline" size={18} color={theme.color.brandPrimary} />
            <Text style={styles.pickerBtnTxt}>{labelFor(REMINDERS, form.reminder_minutes, "Nessuno")}</Text>
            <Ionicons name="chevron-forward" size={16} color={theme.color.muted} />
          </Pressable>

          <Text style={styles.lbl}>Ricorrenza</Text>
          <View style={styles.pillsRow}>
            {RECURRENCES.map((r) => (
              <Pressable key={r.k} onPress={() => setForm({ ...form, recurrence: r.k as any })} style={[styles.pill, form.recurrence === r.k && styles.pillActive]}>
                <Text style={[styles.pillTxt, form.recurrence === r.k && styles.pillTxtActive]}>{r.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Contatto principale</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            <Pressable
              testID="ap-contact-none"
              onPress={() => setForm({ ...form, contact_id: "", phone_mobile: "", phone_work: "", full_address: "", phone_target: "" })}
              style={[styles.pill, !form.contact_id && styles.pillActive]}
            >
              <Text style={[styles.pillTxt, !form.contact_id && styles.pillTxtActive]}>Nessuno</Text>
            </Pressable>
            {contacts.map((c) => (
              <Pressable
                key={c.contact_id}
                testID={`ap-contact-${c.contact_id}`}
                onPress={() => {
                  const structured = [c.address_street, c.address_number, [c.address_zip, c.address_city].filter(Boolean).join(" "), c.address_province].filter(Boolean).join(", ");
                  const fullAddr = structured || c.work_address || c.residence_address || c.address || "";
                  setForm({
                    ...form,
                    contact_id: c.contact_id,
                    area: (c.area === "energy" || c.area === "network") ? c.area : form.area,
                    location: c.address || form.location,
                    phone_mobile: c.phone || "",
                    phone_work: c.phone_alt || "",
                    full_address: fullAddr,
                    phone_target: c.phone ? "mobile" : (c.phone_alt ? "work" : ""),
                  });
                }}
                style={[styles.pill, form.contact_id === c.contact_id && styles.pillActive]}
              >
                <Text style={[styles.pillTxt, form.contact_id === c.contact_id && styles.pillTxtActive]}>{c.first_name} {c.last_name}</Text>
              </Pressable>
            ))}
          </ScrollView>

          {contacts.length > 0 && (
            <>
              <Text style={styles.lbl}>Partecipanti aggiuntivi</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {contacts.filter((c) => c.contact_id !== form.contact_id).map((c) => {
                  const active = form.participant_contact_ids.includes(c.contact_id);
                  return (
                    <Pressable key={c.contact_id} onPress={() => toggleParticipant(c.contact_id)} style={[styles.pill, active && styles.pillActive]}>
                      <Text style={[styles.pillTxt, active && styles.pillTxtActive]}>{active ? "✓ " : "+ "}{c.first_name} {c.last_name}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </>
          )}
        </View>

        <View style={styles.card}>
          <View style={styles.switchRow}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Ionicons name="call" size={18} color={theme.color.brandPrimary} />
              <Text style={styles.switchLbl}>Telefonico</Text>
            </View>
            <Switch testID="ap-phone-switch" value={form.is_phone} onValueChange={(v) => setForm({ ...form, is_phone: v })} />
          </View>

          {/* V26.p — Campi telefono e indirizzo pre-compilati dal contatto */}
          <Text style={styles.lbl}>Telefono cellulare</Text>
          <TextInput
            testID="ap-phone-mobile"
            value={form.phone_mobile}
            onChangeText={(t) => setForm({ ...form, phone_mobile: t })}
            style={styles.input}
            keyboardType="phone-pad"
            placeholder="+39 333 1234567"
            placeholderTextColor="#94A3B8"
          />

          <Text style={styles.lbl}>Telefono aziendale</Text>
          <TextInput
            testID="ap-phone-work"
            value={form.phone_work}
            onChangeText={(t) => setForm({ ...form, phone_work: t })}
            style={styles.input}
            keyboardType="phone-pad"
            placeholder="+39 02 12345678"
            placeholderTextColor="#94A3B8"
          />

          {form.is_phone ? (
            <>
              <Text style={styles.lbl}>Chiama a quale numero?</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable
                  testID="ap-phone-target-mobile"
                  onPress={() => setForm({ ...form, phone_target: "mobile" })}
                  style={[styles.phoneTargetChip, form.phone_target === "mobile" && styles.phoneTargetChipActive, !form.phone_mobile && { opacity: 0.4 }]}
                  disabled={!form.phone_mobile}
                >
                  <Ionicons name="phone-portrait" size={14} color={form.phone_target === "mobile" ? "#FFF" : theme.color.onSurface} />
                  <Text style={[styles.phoneTargetTxt, form.phone_target === "mobile" && { color: "#FFF" }]}>
                    Cellulare{form.phone_mobile ? "\n" + form.phone_mobile : ""}
                  </Text>
                </Pressable>
                <Pressable
                  testID="ap-phone-target-work"
                  onPress={() => setForm({ ...form, phone_target: "work" })}
                  style={[styles.phoneTargetChip, form.phone_target === "work" && styles.phoneTargetChipActive, !form.phone_work && { opacity: 0.4 }]}
                  disabled={!form.phone_work}
                >
                  <Ionicons name="business" size={14} color={form.phone_target === "work" ? "#FFF" : theme.color.onSurface} />
                  <Text style={[styles.phoneTargetTxt, form.phone_target === "work" && { color: "#FFF" }]}>
                    Aziendale{form.phone_work ? "\n" + form.phone_work : ""}
                  </Text>
                </Pressable>
              </View>
              {!form.phone_mobile && !form.phone_work ? (
                <Text style={{ fontSize: 12, color: theme.color.muted, marginTop: 6 }}>
                  Inserisci almeno un numero sopra per selezionare quale chiamare.
                </Text>
              ) : null}
            </>
          ) : null}

          <Text style={styles.lbl}>Indirizzo completo</Text>
          <TextInput
            testID="ap-full-address"
            value={form.full_address}
            onChangeText={(t) => setForm({ ...form, full_address: t })}
            style={[styles.input, { minHeight: 50, textAlignVertical: "top" }]}
            multiline
            placeholder="Es. Via Roma 10, 20100 Milano MI"
            placeholderTextColor="#94A3B8"
          />

          <Text style={styles.lbl}>Luogo (visualizzato in agenda)</Text>
          <TextInput testID="ap-location" value={form.location} onChangeText={(t) => setForm({ ...form, location: t })} style={styles.input} placeholder="Indirizzo o link videochiamata" placeholderTextColor="#94A3B8" />

          <Text style={styles.lbl}>Valore stimato (€)</Text>
          <TextInput testID="ap-value" value={form.value_amount} onChangeText={(t) => setForm({ ...form, value_amount: t.replace(/[^0-9.]/g, "") })} style={styles.input} placeholder="0" placeholderTextColor="#94A3B8" keyboardType="decimal-pad" />

          <Text style={styles.lbl}>Note</Text>
          <TextInput testID="ap-notes" value={form.notes} onChangeText={(t) => setForm({ ...form, notes: t })} style={[styles.input, { minHeight: 70, textAlignVertical: "top" }]} multiline placeholder="Note" placeholderTextColor="#94A3B8" />

          <View style={{ marginTop: 8 }}>
            <Text style={styles.lbl}>Allegati (foto, audio, file)</Text>
            <View style={styles.mediaRow}>
              <Pressable testID="ap-media-camera" onPress={() => addPhoto(true)} style={[styles.mediaBtn, { backgroundColor: "#E67700" }]}>
                <Ionicons name="camera" size={16} color="#FFF" />
                <Text style={styles.mediaBtnTxt}>Scatta</Text>
              </Pressable>
              <Pressable testID="ap-media-photo" onPress={() => addPhoto(false)} style={[styles.mediaBtn, { backgroundColor: "#7A2E8E" }]}>
                <Ionicons name="images" size={16} color="#FFF" />
                <Text style={styles.mediaBtnTxt}>Foto</Text>
              </Pressable>
              {!recording ? (
                <Pressable testID="ap-media-audio" onPress={startRec} style={[styles.mediaBtn, { backgroundColor: "#C83232" }]}>
                  <Ionicons name="mic" size={16} color="#FFF" />
                  <Text style={styles.mediaBtnTxt}>Registra</Text>
                </Pressable>
              ) : (
                <Pressable testID="ap-media-audio-stop" onPress={stopRec} style={[styles.mediaBtn, { backgroundColor: "#DC2626" }]}>
                  <Ionicons name="stop-circle" size={16} color="#FFF" />
                  <Text style={styles.mediaBtnTxt}>Stop</Text>
                </Pressable>
              )}
              <Pressable testID="ap-media-file" onPress={pickFile} style={[styles.mediaBtn, { backgroundColor: "#0B7285" }]}>
                <Ionicons name="attach" size={16} color="#FFF" />
                <Text style={styles.mediaBtnTxt}>File</Text>
              </Pressable>
            </View>
            {attachments.length > 0 && (
              <View style={styles.attRow}>
                {attachments.map((a) => (
                  <View key={a.id} style={styles.attChip}>
                    {a.kind === "photo" ? (
                      <Image source={{ uri: a.photo_base64 }} style={styles.attThumb} />
                    ) : (
                      <View style={[styles.attThumb, { alignItems: "center", justifyContent: "center", backgroundColor: theme.color.surfaceTertiary }]}>
                        <Ionicons name={a.kind === "audio" ? "musical-notes" : "document"} size={22} color={theme.color.muted} />
                      </View>
                    )}
                    <Text style={styles.attLabel} numberOfLines={1}>{a.kind === "audio" ? "Audio" : a.kind === "photo" ? "Foto" : (a.file_name || "File")}</Text>
                    <Pressable onPress={() => removeAttachment(a.id)} style={styles.attRm}>
                      <Ionicons name="close-circle" size={18} color={theme.color.error} />
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>

        {canBroadcast && (
          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <View style={{ flex: 1 }}>
                <Text style={styles.lbl}>Evento condiviso con team</Text>
                <Text style={styles.hint}>Attivalo per inviare questo evento anche ai calendari dei collaboratori.</Text>
              </View>
              <Switch
                testID="ap-broadcast-toggle"
                value={broadcast.enabled}
                onValueChange={(v) => setBroadcast({ ...broadcast, enabled: v })}
                trackColor={{ true: theme.color.brandPrimary, false: "#E2E8F0" }}
              />
            </View>

            {broadcast.enabled && (
              <View style={{ marginTop: 10, gap: 10 }}>
                <Text style={styles.lbl}>Destinatari</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {user?.role === "owner" && (
                    <Pressable
                      testID="ap-broadcast-scope-all"
                      onPress={() => setBroadcast({ ...broadcast, scope: "all" })}
                      style={[styles.pill, broadcast.scope === "all" && styles.pillOn]}
                    >
                      <Ionicons name="business" size={12} color={broadcast.scope === "all" ? "#FFF" : theme.color.muted} />
                      <Text style={[styles.pillTxt, broadcast.scope === "all" && { color: "#FFF" }]}>Tutta l&apos;azienda</Text>
                    </Pressable>
                  )}
                  <Pressable
                    testID="ap-broadcast-scope-subtree"
                    onPress={() => setBroadcast({ ...broadcast, scope: "subtree" })}
                    style={[styles.pill, broadcast.scope === "subtree" && styles.pillOn]}
                  >
                    <Ionicons name="people" size={12} color={broadcast.scope === "subtree" ? "#FFF" : theme.color.muted} />
                    <Text style={[styles.pillTxt, broadcast.scope === "subtree" && { color: "#FFF" }]}>Il mio team</Text>
                  </Pressable>
                  <Pressable
                    testID="ap-broadcast-scope-custom"
                    onPress={() => setBroadcast({ ...broadcast, scope: "custom" })}
                    style={[styles.pill, broadcast.scope === "custom" && styles.pillOn]}
                  >
                    <Ionicons name="checkmark-done" size={12} color={broadcast.scope === "custom" ? "#FFF" : theme.color.muted} />
                    <Text style={[styles.pillTxt, broadcast.scope === "custom" && { color: "#FFF" }]}>Selezione</Text>
                  </Pressable>
                </View>

                {broadcast.scope === "custom" && (
                  <View style={{ gap: 6 }}>
                    <Text style={styles.hint}>Tocca i collaboratori da avvisare:</Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                      {teamMembers.length === 0 ? (
                        <Text style={styles.hint}>Nessun collaboratore disponibile</Text>
                      ) : teamMembers.map((m) => {
                        const on = broadcast.custom_ids.includes(m.user_id);
                        return (
                          <Pressable
                            key={m.user_id}
                            testID={`ap-broadcast-member-${m.user_id}`}
                            onPress={() => {
                              setBroadcast({
                                ...broadcast,
                                custom_ids: on
                                  ? broadcast.custom_ids.filter((x) => x !== m.user_id)
                                  : [...broadcast.custom_ids, m.user_id],
                              });
                            }}
                            style={[styles.pill, on && styles.pillOn]}
                          >
                            <Text style={[styles.pillTxt, on && { color: "#FFF" }]}>{m.name}{m.role === "admin" ? " ★" : ""}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                )}

                <Text style={styles.lbl}>Anticipo notifica (minuti prima dell&apos;evento)</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  {[5, 15, 30, 60, 120].map((n) => (
                    <Pressable
                      key={n}
                      testID={`ap-broadcast-notify-${n}`}
                      onPress={() => setBroadcast({ ...broadcast, notify_min: n })}
                      style={[styles.pill, broadcast.notify_min === n && styles.pillOn]}
                    >
                      <Text style={[styles.pillTxt, broadcast.notify_min === n && { color: "#FFF" }]}>{n}min</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}
          </View>
        )}

        <Pressable testID="ap-save" onPress={submit} style={styles.saveBtn} disabled={busy || !form.title.trim()}>
          {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.saveBtnTxt}>Crea appuntamento</Text>}
        </Pressable>
        <View style={{ height: 40 }} />
      </ScrollView>

      <Modal visible={!!typeEditModal} transparent animationType="fade" onRequestClose={() => setTypeEditModal(null)}>
        <View style={mstyles.back}>
          <View style={mstyles.card}>
            <Text style={mstyles.title}>{typeEditModal?.mode === "create" ? "Nuovo tipo di appuntamento" : "Rinomina tipo"}</Text>
            <Text style={mstyles.hint}>Es. Consulenza, Follow-up, Presentazione, Formazione...</Text>
            <TextInput
              testID="ap-type-modal-input"
              value={typeEditModal?.value || ""}
              onChangeText={(t) => setTypeEditModal((m) => m ? { ...m, value: t } : m)}
              placeholder="Nome del tipo"
              placeholderTextColor="#94A3B8"
              autoFocus
              style={mstyles.input}
            />
            <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
              <Pressable onPress={() => setTypeEditModal(null)} style={[mstyles.btn, { backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border }]}>
                <Text style={{ color: theme.color.onSurface, fontWeight: "700" }}>Annulla</Text>
              </Pressable>
              <Pressable testID="ap-type-modal-save" onPress={saveTypeEdit} disabled={!typeEditModal?.value?.trim()} style={[mstyles.btn, { backgroundColor: theme.color.brandPrimary, opacity: typeEditModal?.value?.trim() ? 1 : 0.5 }]}>
                <Text style={{ color: "#FFF", fontWeight: "700" }}>{typeEditModal?.mode === "create" ? "Crea" : "Salva"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <WheelPickerModal
        visible={wheelPicker === "duration"}
        title="Durata prevista"
        items={DURATIONS}
        value={form.duration_min}
        onConfirm={(v) => setForm({ ...form, duration_min: v })}
        onClose={() => setWheelPicker(null)}
        testID="ap-duration-modal"
      />
      <WheelPickerModal
        visible={wheelPicker === "reminder"}
        title="Promemoria"
        items={REMINDERS}
        value={form.reminder_minutes}
        onConfirm={(v) => setForm({ ...form, reminder_minutes: v })}
        onClose={() => setWheelPicker(null)}
        testID="ap-reminder-modal"
      />
    </SafeAreaView>
  );
}

const mstyles = StyleSheet.create({
  back: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 20 },
  card: { width: "100%", maxWidth: 420, backgroundColor: "#FFF", borderRadius: theme.radius.md, padding: 18 },
  title: { fontSize: 18, fontWeight: "700", color: theme.color.onSurface, marginBottom: 6 },
  hint: { color: theme.color.muted, fontSize: 12, marginBottom: 8, fontStyle: "italic" },
  input: { backgroundColor: theme.color.surface, borderRadius: theme.radius.md, padding: 12, borderWidth: 1, borderColor: theme.color.border, color: theme.color.onSurface, marginTop: 6 },
  btn: { flex: 1, paddingVertical: 12, borderRadius: theme.radius.md, alignItems: "center" },
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontSize: 18, fontWeight: "700", color: theme.color.onSurface },
  content: { padding: 16 },
  card: { backgroundColor: "#FFF", padding: 14, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border, marginTop: 12, gap: 4 },
  sectionTitle: { fontSize: 12, fontWeight: "700", color: theme.color.brandPrimary, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  lbl: { fontSize: 12, fontWeight: "600", color: theme.color.onSurfaceTertiary, marginTop: 10, marginBottom: 4 },
  input: { backgroundColor: theme.color.surface, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: theme.color.onSurface },
  pillsRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  pickerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    marginTop: 2,
  },
  pickerBtnTxt: { flex: 1, fontSize: 15, color: theme.color.onSurface, fontWeight: "600" },
  pill: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: theme.radius.pill, backgroundColor: "#FFF", borderWidth: 1, borderColor: theme.color.border, flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 4 },
  pillOn: { backgroundColor: theme.color.brandPrimary, borderColor: theme.color.brandPrimary },
  pillTxt: { color: theme.color.onSurfaceTertiary, fontWeight: "600", fontSize: 12 },
  rowBetween: { flexDirection: "row", alignItems: "center", gap: 12 },
  pillActive: { backgroundColor: theme.color.brandPrimary, borderColor: theme.color.brandPrimary },
  phoneTargetChip: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, paddingHorizontal: 8, borderRadius: 10, backgroundColor: "#F1F5F9", borderWidth: 1.5, borderColor: theme.color.border },
  phoneTargetChipActive: { backgroundColor: theme.color.brandPrimary, borderColor: theme.color.brandPrimary },
  phoneTargetTxt: { fontSize: 12, fontWeight: "700", color: theme.color.onSurface, textAlign: "center" },
  pillTxtActive: { color: "#FFF" },
  dateRow: { flexDirection: "row", gap: 10, marginTop: 4 },
  dateBtn: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: theme.color.surface, padding: 12, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border },
  dateBtnTxt: { color: theme.color.onSurface, fontWeight: "600" },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  switchLbl: { fontSize: 14, color: theme.color.onSurface, fontWeight: "600" },
  saveBtn: { backgroundColor: theme.color.brandPrimary, paddingVertical: 14, borderRadius: theme.radius.md, alignItems: "center", marginTop: 20 },
  saveBtnTxt: { color: "#FFF", fontWeight: "700", fontSize: 15 },
  subCat: { fontSize: 12, fontWeight: "700", color: theme.color.onSurfaceTertiary, marginBottom: 6 },
  hint: { fontSize: 11, color: theme.color.muted, marginTop: 8, fontStyle: "italic" },
  mediaRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
  mediaBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10 },
  mediaBtnTxt: { color: "#FFF", fontWeight: "700", fontSize: 12 },
  attRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  attChip: { flexDirection: "column", alignItems: "center", gap: 4, backgroundColor: "#FFF", borderWidth: 1, borderColor: theme.color.border, borderRadius: 10, padding: 6, width: 82 },
  attThumb: { width: 68, height: 68, borderRadius: 8, backgroundColor: theme.color.surfaceTertiary },
  attLabel: { fontSize: 10, color: theme.color.muted, textAlign: "center" },
  attRm: { position: "absolute", top: -6, right: -6, backgroundColor: "#FFF", borderRadius: 10 },
});

const webInputStyle: any = {
  width: "100%",
  backgroundColor: theme.color.surface,
  border: `1px solid ${theme.color.border}`,
  borderRadius: 12,
  padding: "12px 14px",
  fontSize: 15,
  color: theme.color.onSurface,
  fontFamily: "inherit",
  outline: "none",
};

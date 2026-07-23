import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView, ActivityIndicator, Platform, Switch, Alert, Modal, Image } from "react-native";
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

type Contact = { contact_id: string; first_name: string; last_name: string; area: string; address: string };
type Settings = {
  energy_title: string; network_title: string;
  custom_appointment_types?: string[];
  custom_product_categories?: { name: string; subs?: string[] }[];
};

const DEFAULT_APPT_TYPES = ["Piano Marketing", "Energia", "Ant", "Dare seguito", "Demo prodotti"];
const DEFAULT_PRODUCT_CATS = [
  { name: "Demo prodotti", subs: ["Artistry", "Nutrilite", "Home"] },
];

const DURATIONS = [
  { m: 15, label: "15m" }, { m: 30, label: "30m" }, { m: 60, label: "1h" },
  { m: 90, label: "1h30" }, { m: 120, label: "2h" }, { m: 180, label: "3h" },
];
const REMINDERS = [
  { m: 0, label: "Nessuno" }, { m: 5, label: "5m prima" },
  { m: 15, label: "15m prima" }, { m: 30, label: "30m prima" },
  { m: 60, label: "1h prima" }, { m: 1440, label: "1 giorno prima" },
];
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
    location: prefLoc || "",
    notes: prefNotes || "",
    value_amount: "",
    appointment_type_tags: [] as string[],
    product_categories: [] as string[],
  });
  const [showPicker, setShowPicker] = useState<"date" | "time" | null>(null);
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
        Alert.alert("Permesso negato");
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
        Alert.alert("Foto troppo grande", "Prova con una foto più piccola (max ~8 MB)");
        return;
      }
      setAttachments((p) => [...p, { id: `${Date.now()}`, kind: "photo", photo_base64: dataUrl }]);
    } catch (e: any) {
      console.warn("addPhoto err", e);
      Alert.alert("Impossibile caricare la foto", e?.message || "Riprova con un'altra immagine");
    }
  };

  const pickFile = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: "*/*", multiple: false, copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      const b64 = await uriToBase64(asset.uri);
      if (base64ByteSize(b64) > 15 * 1024 * 1024) {
        Alert.alert("File troppo grande", "Massimo 15 MB");
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
      Alert.alert("Impossibile caricare il file", e?.message || "Riprova");
    }
  };

  const startRec = async () => {
    try {
      if (Platform.OS === "web") {
        // Web: use MediaRecorder API directly
        return await startRecWeb();
      }
      const { granted } = await AudioModule.requestRecordingPermissionsAsync();
      if (!granted) { Alert.alert("Permesso microfono negato"); return; }
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
    } catch (e: any) {
      console.warn("startRec err", e);
      Alert.alert("Impossibile iniziare la registrazione", e?.message || "");
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
      Alert.alert("Microfono non accessibile", e?.message || "Autorizza il microfono nel browser");
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
      if (c) setForm((f) => ({
        ...f,
        contact_id: c.contact_id,
        area: ((c.area as any) || f.area) as any,
        title: f.title || `Appuntamento ${c.first_name} ${c.last_name}`,
        location: c.address || f.location,
      }));
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
        Alert.alert("Nome già esistente");
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
    Alert.alert("Elimina tipo", `Vuoi eliminare "${name}"?`, [
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
              return (
                <Pressable
                  key={t}
                  testID={`ap-type-${t}`}
                  onPress={() => toggleType(t)}
                  onLongPress={isCustom ? () => {
                    Alert.alert(t, "Cosa vuoi fare?", [
                      { text: "Annulla", style: "cancel" },
                      { text: "Rinomina", onPress: () => setTypeEditModal({ mode: "rename", oldName: t, value: t }) },
                      { text: "Elimina", style: "destructive", onPress: () => deleteType(t) },
                    ]);
                  } : undefined}
                  style={[styles.pill, { flexDirection: "row", alignItems: "center" }, active && styles.pillActive]}
                >
                  <Ionicons name={active ? "checkmark-circle" : "ellipse-outline"} size={14} color={active ? "#FFF" : theme.color.muted} />
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
                  onChange={(e, d) => { setShowPicker(null); if (d) { showPicker === "date" ? setDate(d) : setTime(d); } }} />
              )}
            </>
          )}

          <Text style={styles.lbl}>Durata prevista</Text>
          <View style={styles.pillsRow}>
            {DURATIONS.map((d) => (
              <Pressable key={d.m} onPress={() => setForm({ ...form, duration_min: d.m })} style={[styles.pill, form.duration_min === d.m && styles.pillActive]}>
                <Text style={[styles.pillTxt, form.duration_min === d.m && styles.pillTxtActive]}>{d.label}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.lbl}>Promemoria</Text>
          <View style={styles.pillsRow}>
            {REMINDERS.map((r) => (
              <Pressable key={r.m} onPress={() => setForm({ ...form, reminder_minutes: r.m })} style={[styles.pill, form.reminder_minutes === r.m && styles.pillActive]}>
                <Text style={[styles.pillTxt, form.reminder_minutes === r.m && styles.pillTxtActive]}>{r.label}</Text>
              </Pressable>
            ))}
          </View>

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
            <Pressable testID="ap-contact-none" onPress={() => setForm({ ...form, contact_id: "" })} style={[styles.pill, !form.contact_id && styles.pillActive]}>
              <Text style={[styles.pillTxt, !form.contact_id && styles.pillTxtActive]}>Nessuno</Text>
            </Pressable>
            {contacts.map((c) => (
              <Pressable key={c.contact_id} testID={`ap-contact-${c.contact_id}`} onPress={() => setForm({ ...form, contact_id: c.contact_id })} style={[styles.pill, form.contact_id === c.contact_id && styles.pillActive]}>
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

          <Text style={styles.lbl}>Luogo</Text>
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
  pill: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: theme.radius.pill, backgroundColor: "#FFF", borderWidth: 1, borderColor: theme.color.border, flexShrink: 0 },
  pillActive: { backgroundColor: theme.color.brandPrimary, borderColor: theme.color.brandPrimary },
  pillTxt: { color: theme.color.onSurfaceTertiary, fontWeight: "600", fontSize: 12 },
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

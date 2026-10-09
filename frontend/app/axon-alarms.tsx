// V50.z8 — Axon Alarms: Timer / Sveglie / Promemoria personali in-app.
// Alexa-style ma tutto dentro AdvisorOS: nessuna dipendenza dall'orologio
// del sistema operativo. Notifiche locali via expo-notifications, suono
// custom opzionale via expo-audio.

import { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Modal, Alert, Platform, Switch, FlatList } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller"; // V50.z374 — behavior "padding" valido su iOS e Android
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { notify, confirmAsync } from "@/src/utils/notify"; // V50.z498
import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Notifications from "expo-notifications";
import { createAudioPlayer, AudioModule } from "expo-audio";
import Slider from "@react-native-community/slider";
import { api } from "@/src/api";
import { emitAlarmsChanged } from "@/src/AlarmIndicators"; // V50.z501 — header/menu si aggiornano subito
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { syncAlarmNotifs, removeAlarmNotifs, syncAllAlarms, getCustomSoundUri, type Alarm, type AlarmKind } from "@/src/alarmNotifs";
import { useTimeFormat, formatHHMM, formatDateTime, formatHM } from "@/src/utils/timeFormat";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

type Tab = "timer" | "alarm" | "reminder";
type Sound = { id: string; name: string; mime: string; size_bytes?: number; created_at: string };

// V50.z78 — Preset sound list: audio pubblici (Pixabay CDN — royalty free).
// Il player fetcha l'URL una sola volta e lo cachea. Volume applicato dal player.
type PresetSound = { id: string; name: string; icon: keyof typeof Ionicons.glyphMap; url: string };
const PRESET_SOUNDS: PresetSound[] = [
  { id: "preset:default", name: "Predefinito (sistema)", icon: "notifications-outline", url: "" },
  { id: "preset:classic", name: "Sveglia classica", icon: "alarm-outline", url: "https://cdn.pixabay.com/download/audio/2022/03/15/audio_1abb4e1e05.mp3" },
  { id: "preset:gentle", name: "Melodia delicata", icon: "musical-notes-outline", url: "https://cdn.pixabay.com/download/audio/2022/10/25/audio_775a10b0d1.mp3" },
  { id: "preset:energic", name: "Energico", icon: "flash-outline", url: "https://cdn.pixabay.com/download/audio/2023/03/06/audio_b8a41b4a04.mp3" },
  { id: "preset:chirp", name: "Cinguettio", icon: "leaf-outline", url: "https://cdn.pixabay.com/download/audio/2022/03/24/audio_c8d3ed4d95.mp3" },
  { id: "preset:beep", name: "Beep digitale", icon: "radio-outline", url: "https://cdn.pixabay.com/download/audio/2023/09/29/audio_69a61cd6d6.mp3" },
];
const PRESET_BY_ID: Record<string, PresetSound> = Object.fromEntries(PRESET_SOUNDS.map((p) => [p.id, p]));

const TABS: { id: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: "timer", label: "Timer", icon: "timer-outline" },
  { id: "alarm", label: "Sveglie", icon: "alarm-outline" },
  { id: "reminder", label: "Promemoria", icon: "notifications-outline" },
];

const WEEKDAY_LABELS = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"];

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s && !h) parts.push(`${s}s`);
  return parts.join(" ");
}

function formatWhen(iso: string | undefined | null, fmt: "12h" | "24h" = "24h"): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return formatDateTime(d, fmt);
  } catch { return ""; }
}

function formatRemaining(iso: string | undefined | null): string {
  if (!iso) return "";
  const target = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, Math.floor((target - now) / 1000));
  if (diff === 0) return "scaduto";
  return `tra ${formatDuration(diff)}`;
}

export default function AxonAlarmsScreen() {
  const router = useRouter();
  const bottomPad = usePageBottomPadding(96);
  const [tab, setTab] = useState<Tab>("timer");
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Alarm | null>(null);
  const [creating, setCreating] = useState<AlarmKind | null>(null);
  const [tick, setTick] = useState(0); // per re-render countdown ogni sec
  const [timeFmt, setTimeFmt] = useTimeFormat();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api<{ items: Alarm[] }>("/axon/alarms");
      setAlarms(r.items || []);
    } catch (e: any) {
      Alert.alert("Errore", e?.message || "Impossibile caricare le sveglie");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    load();
    // Ri-sincronizza notifiche locali con lo stato server
    syncAllAlarms().catch(() => {});
  }, [load]));

  // Timer ogni secondo per aggiornare countdown timers/reminders
  useEffect(() => {
    const has = alarms.some((a) => a.enabled && (a.kind === "timer" || a.kind === "reminder"));
    if (!has) return;
    const iv = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(iv);
  }, [alarms]);

  const visible = useMemo(() => alarms.filter((a) => a.kind === tab), [alarms, tab]);

  const onToggle = async (a: Alarm) => {
    // Ottimistic
    const newVal = !a.enabled;
    setAlarms((prev) => prev.map((x) => (x.id === a.id ? { ...x, enabled: newVal } : x)));
    try {
      await api(`/axon/alarms/${a.id}/toggle`, { method: "POST" });
      emitAlarmsChanged();
      await syncAlarmNotifs({ ...a, enabled: newVal });
    } catch (e: any) {
      setAlarms((prev) => prev.map((x) => (x.id === a.id ? { ...x, enabled: !newVal } : x)));
      Alert.alert("Errore", e?.message || "Impossibile aggiornare");
    }
  };

  const onDelete = async (a: Alarm) => {
    // V50.z498 — BUG: su web `Alert.alert` con bottoni non esegue i callback → il cestino non faceva nulla. `confirmAsync` funziona ovunque.
    const ok = await confirmAsync("Elimina", `Vuoi eliminare "${a.label}"?`);
    if (!ok) return;
    try {
      await api(`/axon/alarms/${a.id}`, { method: "DELETE" });
      await removeAlarmNotifs(a.id).catch(() => {});
      setAlarms((prev) => prev.filter((x) => x.id !== a.id));
      emitAlarmsChanged();
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile eliminare");
    }
  };

  const openCreate = (kind: AlarmKind) => {
    setEditing(null);
    setCreating(kind);
  };

  const onSaved = async (saved: Alarm) => {
    emitAlarmsChanged();
    setAlarms((prev) => {
      const exists = prev.some((x) => x.id === saved.id);
      return exists ? prev.map((x) => (x.id === saved.id ? saved : x)) : [saved, ...prev];
    });
    await syncAlarmNotifs(saved);
    setEditing(null);
    setCreating(null);
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.hBtn} testID="back-btn">
          <Ionicons name="chevron-back" size={24} color="#FFF" />
        </Pressable>
        <Text style={styles.headerTitle}>Timer & Sveglie</Text>
        {/* V50.z10 — Toggle formato 12h/24h */}
        <Pressable
          onPress={() => setTimeFmt(timeFmt === "24h" ? "12h" : "24h")}
          hitSlop={10}
          style={styles.fmtBtn}
          testID="time-format-toggle"
        >
          <Text style={styles.fmtBtnTxt}>{timeFmt === "24h" ? "24h" : "12h"}</Text>
        </Pressable>
      </View>

      <View style={styles.tabsBar}>
        {TABS.map((t) => (
          <Pressable
            key={t.id}
            onPress={() => setTab(t.id)}
            style={[styles.tabBtn, tab === t.id && styles.tabBtnActive]}
            testID={`tab-${t.id}`}
          >
            <Ionicons name={t.icon} size={16} color={tab === t.id ? HT.text : HT.muted} />
            <Text style={[styles.tabTxt, tab === t.id && styles.tabTxtActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={styles.emptyBox}>
          <ActivityIndicator color="#FBBF24" size="large" />
        </View>
      ) : visible.length === 0 ? (
        <View style={styles.emptyBox}>
          <Ionicons name={TABS.find((x) => x.id === tab)!.icon} size={40} color="rgba(255,255,255,0.25)" />
          <Text style={styles.emptyTitle}>
            Nessun{tab === "alarm" ? "a sveglia" : tab === "timer" ? " timer" : " promemoria"}
          </Text>
          <Text style={styles.emptySub}>
            Tocca il pulsante in basso per crear{tab === "alarm" ? "la" : "lo"}.
          </Text>
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(a) => a.id}
          contentContainerStyle={{ padding: 14, paddingBottom: bottomPad, gap: 10 }}
          renderItem={({ item }) => (
            <AlarmRow
              a={item}
              onToggle={() => onToggle(item)}
              onEdit={() => { setCreating(null); setEditing(item); }}
              onDelete={() => onDelete(item)}
              _tick={tick}
              timeFmt={timeFmt}
            />
          )}
        />
      )}

      {/* FAB - Nuovo */}
      <Pressable
        onPress={() => openCreate(tab)}
        style={[styles.fab, { bottom: bottomPad - 60 }]}
        testID="new-alarm-fab"
      >
        <Ionicons name="add" size={26} color={HT.text} />
        <Text style={styles.fabTxt}>
          {tab === "timer" ? "Nuovo timer" : tab === "alarm" ? "Nuova sveglia" : "Nuovo promemoria"}
        </Text>
      </Pressable>

      {/* Editor modale */}
      {(editing || creating) && (
        <AlarmEditor
          initial={editing}
          initialKind={creating || editing?.kind || "timer"}
          timeFmt={timeFmt}
          onClose={() => { setEditing(null); setCreating(null); }}
          onSaved={onSaved}
        />
      )}
    </SafeAreaView>
  );
}

// ─── Row ─────────────────────────────────────────────────────────
function AlarmRow({ a, onToggle, onEdit, onDelete, _tick, timeFmt }: {
  a: Alarm; onToggle: () => void; onEdit: () => void; onDelete: () => void; _tick: number; timeFmt: "12h" | "24h";
}) {
  const subtitle = useMemo(() => {
    if (a.kind === "timer") {
      const dur = a.duration_seconds ? formatDuration(a.duration_seconds) : "";
      return a.enabled ? `${dur} · ${formatRemaining(a.trigger_at)}` : `${dur} · disabilitato`;
    }
    if (a.kind === "alarm") {
      const t = a.time ? formatHHMM(a.time, timeFmt) : "--:--";
      if (!a.weekdays || a.weekdays.length === 0) return `${t} · una volta`;
      if (a.weekdays.length === 7) return `${t} · Ogni giorno`;
      const wd = a.weekdays.map((w) => WEEKDAY_LABELS[w]).join(" ");
      return `${t} · ${wd}`;
    }
    return formatWhen(a.trigger_at, timeFmt) || "—";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a, _tick, timeFmt]);

  return (
    <View style={[styles.row, !a.enabled && styles.rowDisabled]}>
      <Pressable onPress={onEdit} style={styles.rowLeft} testID={`row-${a.id}`}>
        <Text style={styles.rowLabel} numberOfLines={1}>{a.label}</Text>
        <Text style={styles.rowSub} numberOfLines={1}>{subtitle}</Text>
        {a.note ? <Text style={styles.rowNote} numberOfLines={2}>{a.note}</Text> : null}
      </Pressable>
      <View style={styles.rowActions}>
        <Switch
          value={a.enabled}
          onValueChange={onToggle}
          thumbColor={a.enabled ? "#FBBF24" : HT.muted}
          trackColor={{ true: "rgba(251,191,36,0.4)", false: "rgba(148,163,184,0.3)" }}
        />
        <Pressable onPress={onDelete} hitSlop={8} style={styles.trashBtn} testID={`del-${a.id}`}>
          <Ionicons name="trash-outline" size={18} color="#EF4444" />
        </Pressable>
      </View>
    </View>
  );
}

// ─── Editor ──────────────────────────────────────────────────────
function AlarmEditor({ initial, initialKind, timeFmt, onClose, onSaved }: {
  initial: Alarm | null;
  initialKind: AlarmKind;
  timeFmt: "12h" | "24h";
  onClose: () => void;
  onSaved: (a: Alarm) => void;
}) {
  const bottomPad = usePageBottomPadding(24);
  const kind = initial?.kind || initialKind;
  const [label, setLabel] = useState(initial?.label || defaultLabel(kind));
  const [note, setNote] = useState(initial?.note || "");
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [vibrate, setVibrate] = useState(initial?.vibrate ?? true);
  const [soundRef, setSoundRef] = useState(initial?.sound_ref || "default");
  // V50.z78 — Volume 0-100 per sveglia/timer/promemoria (default 100 = massimo)
  const [volume, setVolume] = useState<number>(typeof initial?.volume === "number" ? initial.volume : 100);
  const [saving, setSaving] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);

  // Timer state
  const initialDur = initial?.duration_seconds ?? 5 * 60;
  const [durHours, setDurHours] = useState(Math.floor(initialDur / 3600));
  const [durMinutes, setDurMinutes] = useState(Math.floor((initialDur % 3600) / 60));
  const [durSeconds, setDurSeconds] = useState(initialDur % 60);

  // Alarm state
  // V50.z16 — Fix bug "reset a 07:30": il default iniziale ora è "ora corrente
  // + 5 minuti" (invece di un 07:30 fisso), così l'utente non vede una
  // valorizzazione arbitraria quando apre l'editor. Se l'alarm esiste già,
  // viene rispettato il suo `time` originale.
  const parsedTime = parseTime(initial?.time, !initial);
  const [alarmDate, setAlarmDate] = useState<Date>(() => {
    const d = new Date();
    d.setHours(parsedTime.h, parsedTime.m, 0, 0);
    return d;
  });
  const [weekdays, setWeekdays] = useState<number[]>(initial?.weekdays || []);

  // Reminder state
  const [reminderDate, setReminderDate] = useState<Date>(() => {
    if (initial?.trigger_at) return new Date(initial.trigger_at);
    const d = new Date();
    d.setHours(d.getHours() + 1, 0, 0, 0);
    return d;
  });

  // Sounds
  const [sounds, setSounds] = useState<Sound[]>([]);
  const [showSoundPicker, setShowSoundPicker] = useState(false);
  const [uploadingSound, setUploadingSound] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await api<{ items: Sound[] }>("/axon/alarm-sounds");
        setSounds(r.items || []);
      } catch { /* ignore */ }
    })();
  }, []);

  const soundLabel = useMemo(() => {
    if (soundRef === "default") return "Suono predefinito";
    if (soundRef.startsWith("preset:")) {
      const p = PRESET_BY_ID[soundRef];
      return p ? p.name : "Suono predefinito";
    }
    const s = sounds.find((x) => x.id === soundRef);
    return s ? s.name : "Suono personalizzato";
  }, [soundRef, sounds]);

  // V50.z13 — Anteprima suono: default → schedula notifica istantanea (usa
  // system sound). Custom → suona con expo-audio dal file mp3 in cache.
  // V50.z78 — Preset sounds: URL Pixabay riprodotto con volume corrente.
  const previewSound = async (id: string) => {
    try {
      // Preset built-in
      if (id.startsWith("preset:")) {
        const preset = PRESET_BY_ID[id];
        if (!preset || !preset.url) {
          // preset:default → usa notifica di sistema
          await Notifications.scheduleNotificationAsync({
            content: { title: "Anteprima suono", body: "Suono predefinito", sound: "default", data: { tag: "preview_default" } },
            trigger: null,
          });
          return;
        }
        try {
          await AudioModule.setAudioModeAsync({ playsInSilentMode: true });
        } catch { /* ignore */ }
        const player = createAudioPlayer({ uri: preset.url });
        try { (player as any).volume = Math.max(0, Math.min(1, volume / 100)); } catch { /* ignore */ }
        player.play();
        setTimeout(() => {
          try { player.pause(); player.remove(); } catch { /* ignore */ }
        }, 5000);
        return;
      }
      if (id === "default") {
        // Trigger notifica immediata (foreground handler la mostra + suono)
        await Notifications.scheduleNotificationAsync({
          content: {
            title: "Anteprima suono",
            body: "Suono predefinito",
            sound: "default",
            data: { tag: "preview_default" },
          },
          trigger: null, // immediata
        });
      } else {
        const uri = await getCustomSoundUri(id);
        if (!uri) {
          Alert.alert("Anteprima non disponibile", "Impossibile caricare il file audio.");
          return;
        }
        try {
          await AudioModule.setAudioModeAsync({ playsInSilentMode: true });
        } catch { /* ignore */ }
        const player = createAudioPlayer({ uri });
        try { (player as any).volume = Math.max(0, Math.min(1, volume / 100)); } catch { /* ignore */ }
        player.play();
        // Auto-stop dopo 5s per non lasciarlo aperto
        setTimeout(() => {
          try { player.pause(); player.remove(); } catch { /* ignore */ }
        }, 5000);
      }
    } catch (e: any) {
      Alert.alert("Errore anteprima", e?.message || "Impossibile riprodurre");
    }
  };

  const totalDurationSeconds = durHours * 3600 + durMinutes * 60 + durSeconds;

  const canSave = useMemo(() => {
    if (!label.trim()) return false;
    if (kind === "timer") return totalDurationSeconds >= 5;
    if (kind === "alarm") return true;
    if (kind === "reminder") return reminderDate.getTime() > Date.now() + 1000;
    return false;
  }, [label, kind, totalDurationSeconds, reminderDate]);

  const onSave = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      const payload: any = {
        kind,
        label: label.trim(),
        note: note.trim() || null,
        enabled,
        sound_ref: soundRef,
        vibrate,
        volume: Math.max(0, Math.min(100, Math.round(volume))),
      };
      if (kind === "timer") payload.duration_seconds = totalDurationSeconds;
      if (kind === "alarm") {
        payload.time = fmtHHMM24(alarmDate);
        payload.weekdays = weekdays;
      }
      if (kind === "reminder") payload.trigger_at = reminderDate.toISOString();
      const method = initial ? "PUT" : "POST";
      const path = initial ? `/axon/alarms/${initial.id}` : "/axon/alarms";
      const saved = await api<Alarm>(path, { method, body: payload });
      onSaved(saved);
    } catch (e: any) {
      Alert.alert("Errore", e?.message || "Impossibile salvare");
    } finally {
      setSaving(false);
    }
  };

  const onPickSound = async () => {
    setShowSoundPicker(false);
    setUploadingSound(true);
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ["audio/mpeg", "audio/mp3", "audio/wav", "audio/aac", "audio/mp4", "audio/*"],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      if (asset.size && asset.size > 1_500_000) {
        Alert.alert("Troppo grande", "Il file deve essere sotto 1.5MB (~30s a 128kbps).");
        return;
      }
      const b64 = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const created = await api<Sound>("/axon/alarm-sounds", {
        method: "POST",
        body: { name: asset.name || "Suono", mime: asset.mimeType || "audio/mpeg", data_base64: b64 },
      });
      setSounds((prev) => [created, ...prev]);
      setSoundRef(created.id);
    } catch (e: any) {
      Alert.alert("Errore", e?.message || "Impossibile caricare");
    } finally {
      setUploadingSound(false);
    }
  };

  const toggleWeekday = (wd: number) => {
    setWeekdays((prev) => prev.includes(wd) ? prev.filter((x) => x !== wd) : [...prev, wd].sort());
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={10} style={styles.hBtn}>
            <Ionicons name="chevron-back" size={24} color="#FFF" />
          </Pressable>
          <Text style={styles.headerTitle}>
            {initial ? "Modifica" : "Nuovo"} {kind === "timer" ? "Timer" : kind === "alarm" ? "Sveglia" : "Promemoria"}
          </Text>
          <View style={{ width: 30 }} />
        </View>
        <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
          <ScrollView
            contentContainerStyle={{ padding: 14, paddingBottom: 120, gap: 14 }}
            keyboardShouldPersistTaps="handled"
          >
            {/* Label */}
            <Field label="Nome">
              <TextInput
                value={label}
                onChangeText={setLabel}
                style={styles.input}
                placeholder="es. Sveglia mattina"
                placeholderTextColor={HT.muted}
                maxLength={120}
              />
            </Field>

            {/* Kind-specific */}
            {kind === "timer" && (
              <Field label={`Durata · ${formatDuration(totalDurationSeconds)}`}>
                <View style={styles.rowThreeCols}>
                  <NumberPicker label="Ore" value={durHours} min={0} max={23} onChange={setDurHours} />
                  <NumberPicker label="Min" value={durMinutes} min={0} max={59} onChange={setDurMinutes} />
                  <NumberPicker label="Sec" value={durSeconds} min={0} max={59} onChange={setDurSeconds} />
                </View>
                <View style={styles.presetRow}>
                  {[["5m", 300], ["15m", 900], ["30m", 1800], ["1h", 3600]].map(([lab, s]) => (
                    <Pressable
                      key={lab}
                      onPress={() => {
                        const sec = s as number;
                        setDurHours(Math.floor(sec / 3600));
                        setDurMinutes(Math.floor((sec % 3600) / 60));
                        setDurSeconds(sec % 60);
                      }}
                      style={styles.presetChip}
                    >
                      <Text style={styles.presetTxt}>{lab}</Text>
                    </Pressable>
                  ))}
                </View>
              </Field>
            )}

            {kind === "alarm" && (
              <>
                <Field label="Ora">
                  <Pressable style={styles.timeBox} onPress={() => {
                    // V50.z13 — Su Android usa API imperativa (evita il bug
                    // di reset dello state quando il picker Samsung entra
                    // in "keyboard mode"). Su iOS resta l'inline picker.
                    // V50.z16 — Gestione permissiva: accetta QUALSIASI evento
                    // con una data valida (Samsung invia talvolta "" o
                    // "neutralButtonPressed" invece di "set"). Salviamo il
                    // valore, quindi ignoriamo solo l'esplicito "dismissed".
                    if (Platform.OS === "android") {
                      DateTimePickerAndroid.open({
                        value: alarmDate,
                        mode: "time",
                        is24Hour: timeFmt === "24h",
                        display: "clock",
                        onChange: (event, d) => {
                          if (event?.type === "dismissed") return;
                          if (!d) return;
                          const merged = new Date(alarmDate);
                          merged.setHours(d.getHours(), d.getMinutes(), 0, 0);
                          setAlarmDate(merged);
                        },
                      });
                    } else {
                      setShowTimePicker(true);
                    }
                  }}>
                    <Ionicons name="time-outline" size={22} color="#FBBF24" />
                    <Text style={styles.timeTxt}>{formatHM(alarmDate.getHours(), alarmDate.getMinutes(), timeFmt)}</Text>
                    <Ionicons name="chevron-forward" size={20} color={HT.muted} />
                  </Pressable>
                  {Platform.OS === "ios" && showTimePicker && (
                    <DateTimePicker
                      value={alarmDate}
                      mode="time"
                      is24Hour={timeFmt === "24h"}
                      display="spinner"
                      onChange={(_, d) => {
                        setShowTimePicker(false);
                        if (d) setAlarmDate(d);
                      }}
                    />
                  )}
                  {/* V50.z16 — Fallback bulletproof: regolazione manuale con
                      pulsanti +/- (a prova di picker Samsung difettoso). */}
                  <View style={[styles.rowThreeCols, { marginTop: 10 }]}>
                    <NumberPicker
                      label="Ora"
                      value={alarmDate.getHours()}
                      min={0}
                      max={23}
                      onChange={(v) => {
                        const nd = new Date(alarmDate);
                        nd.setHours(v);
                        setAlarmDate(nd);
                      }}
                    />
                    <NumberPicker
                      label="Min"
                      value={alarmDate.getMinutes()}
                      min={0}
                      max={59}
                      onChange={(v) => {
                        const nd = new Date(alarmDate);
                        nd.setMinutes(v);
                        setAlarmDate(nd);
                      }}
                    />
                  </View>
                </Field>
                <Field label="Giorni della settimana">
                  <View style={styles.weekdayRow}>
                    {WEEKDAY_LABELS.map((lab, idx) => {
                      const on = weekdays.includes(idx);
                      return (
                        <Pressable
                          key={idx}
                          onPress={() => toggleWeekday(idx)}
                          style={[styles.wdChip, on && styles.wdChipOn]}
                        >
                          <Text style={[styles.wdTxt, on && styles.wdTxtOn]}>{lab}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Text style={styles.hint}>
                    Nessun giorno selezionato = sveglia una tantum (alla prossima ora).
                  </Text>
                  <View style={styles.presetRow}>
                    <Pressable onPress={() => setWeekdays([1, 2, 3, 4, 5])} style={styles.presetChip}>
                      <Text style={styles.presetTxt}>Lun-Ven</Text>
                    </Pressable>
                    <Pressable onPress={() => setWeekdays([0, 6])} style={styles.presetChip}>
                      <Text style={styles.presetTxt}>Weekend</Text>
                    </Pressable>
                    <Pressable onPress={() => setWeekdays([0, 1, 2, 3, 4, 5, 6])} style={styles.presetChip}>
                      <Text style={styles.presetTxt}>Ogni giorno</Text>
                    </Pressable>
                    <Pressable onPress={() => setWeekdays([])} style={styles.presetChip}>
                      <Text style={styles.presetTxt}>Nessuno</Text>
                    </Pressable>
                  </View>
                </Field>
              </>
            )}

            {kind === "reminder" && (
              <Field label="Data e ora">
                <Pressable style={styles.timeBox} onPress={() => {
                  // V50.z13 — Android: apri Date poi Time (imperativo)
                  // V50.z16 — Gestione permissiva eventi (vedi commento sopra)
                  if (Platform.OS === "android") {
                    DateTimePickerAndroid.open({
                      value: reminderDate,
                      mode: "date",
                      onChange: (event, d) => {
                        if (event?.type === "dismissed") return;
                        if (!d) return;
                        const merged = new Date(reminderDate);
                        merged.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
                        // Poi apri il time picker
                        DateTimePickerAndroid.open({
                          value: merged,
                          mode: "time",
                          is24Hour: timeFmt === "24h",
                          display: "clock",
                          onChange: (event2, d2) => {
                            if (event2?.type === "dismissed") return;
                            if (!d2) return;
                            const final = new Date(merged);
                            final.setHours(d2.getHours(), d2.getMinutes(), 0, 0);
                            setReminderDate(final);
                          },
                        });
                      },
                    });
                  } else {
                    setShowDatePicker(true);
                  }
                }}>
                  <Ionicons name="calendar-outline" size={22} color="#FBBF24" />
                  <Text style={styles.timeTxt}>{formatWhen(reminderDate.toISOString(), timeFmt)}</Text>
                  <Ionicons name="chevron-forward" size={20} color={HT.muted} />
                </Pressable>
                {Platform.OS === "ios" && showDatePicker && (
                  <DateTimePicker
                    value={reminderDate}
                    mode="datetime"
                    is24Hour={timeFmt === "24h"}
                    onChange={(_, d) => {
                      setShowDatePicker(false);
                      if (d) setReminderDate(d);
                    }}
                  />
                )}
              </Field>
            )}

            {/* Suono */}
            <Field label="Suono">
              <Pressable style={styles.timeBox} onPress={() => setShowSoundPicker(true)}>
                <Ionicons name="musical-note-outline" size={22} color="#FBBF24" />
                <Text style={styles.timeTxt}>{soundLabel}</Text>
                <Ionicons name="chevron-forward" size={20} color={HT.muted} />
              </Pressable>
              {Platform.OS === "ios" && soundRef !== "default" && !soundRef.startsWith("preset:") ? (
                <Text style={[styles.hint, { color: "#F59E0B" }]}>
                  ⚠️ iOS usa il suono di default per le notifiche in background. Il suono
                  custom si sente quando l&apos;app è aperta.
                </Text>
              ) : null}
            </Field>

            {/* V50.z78 — Volume slider */}
            <Field label={`Volume · ${Math.round(volume)}%`}>
              <View style={styles.volRow}>
                <Ionicons name="volume-low" size={18} color={HT.muted} />
                <Slider
                  style={{ flex: 1 }}
                  minimumValue={0}
                  maximumValue={100}
                  step={5}
                  value={volume}
                  onValueChange={setVolume}
                  minimumTrackTintColor="#FBBF24"
                  maximumTrackTintColor="rgba(255,255,255,0.15)"
                  thumbTintColor="#FBBF24"
                  testID="volume-slider"
                />
                <Ionicons name="volume-high" size={18} color="#FBBF24" />
              </View>
            </Field>

            {/* Note */}
            <Field label="Nota (opzionale)">
              <TextInput
                value={note}
                onChangeText={setNote}
                style={[styles.input, { height: 80, textAlignVertical: "top" }]}
                placeholder="es. Ricordati di portare i documenti"
                placeholderTextColor={HT.muted}
                multiline
                maxLength={500}
              />
            </Field>

            {/* Toggle */}
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Attivo</Text>
              <Switch
                value={enabled}
                onValueChange={setEnabled}
                thumbColor={enabled ? "#FBBF24" : HT.muted}
                trackColor={{ true: "rgba(251,191,36,0.4)", false: "rgba(148,163,184,0.3)" }}
              />
            </View>
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Vibrazione</Text>
              <Switch
                value={vibrate}
                onValueChange={setVibrate}
                thumbColor={vibrate ? "#FBBF24" : HT.muted}
                trackColor={{ true: "rgba(251,191,36,0.4)", false: "rgba(148,163,184,0.3)" }}
              />
            </View>
          </ScrollView>

          {/* Sticky Save */}
          <View style={[styles.saveBar, { paddingBottom: Math.max(14, bottomPad - 100) }]}>
            <Pressable
              onPress={onSave}
              disabled={!canSave || saving}
              style={[styles.saveBtn, (!canSave || saving) && { opacity: 0.5 }]}
              testID="save-alarm"
            >
              {saving ? (
                <ActivityIndicator color={HT.text} size="small" />
              ) : (
                <>
                  <Ionicons name="save" size={18} color={HT.text} />
                  <Text style={styles.saveTxt}>Salva</Text>
                </>
              )}
            </Pressable>
          </View>
        </KeyboardAvoidingView>

        {/* Sound picker modal */}
        <Modal visible={showSoundPicker} transparent animationType="fade" onRequestClose={() => setShowSoundPicker(false)}>
          <Pressable style={styles.spBackdrop} onPress={() => setShowSoundPicker(false)}>
            <Pressable style={styles.spSheet} onPress={(e) => e.stopPropagation()}>
              <View style={styles.dragHandle} />
              <Text style={styles.spTitle}>Scegli suono</Text>
              <Pressable onPress={() => { setSoundRef("default"); setShowSoundPicker(false); }} style={styles.soundRow}>
                <Ionicons name="musical-notes" size={22} color="#FBBF24" />
                <Text style={styles.soundRowTxt}>Suono predefinito</Text>
                <Pressable onPress={(e) => { e.stopPropagation?.(); previewSound("default"); }} hitSlop={8} style={styles.previewBtn} testID="preview-default">
                  <Ionicons name="play-circle" size={22} color="#22C55E" />
                </Pressable>
                {soundRef === "default" ? <Ionicons name="checkmark" size={20} color="#22C55E" /> : null}
              </Pressable>
              {/* V50.z78 — Preset sounds (built-in) */}
              {PRESET_SOUNDS.filter((p) => p.id !== "preset:default").map((p) => (
                <View key={p.id} style={styles.soundRow}>
                  <Pressable
                    onPress={() => { setSoundRef(p.id); setShowSoundPicker(false); }}
                    style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}
                  >
                    <Ionicons name={p.icon} size={22} color="#FBBF24" />
                    <Text style={styles.soundRowTxt} numberOfLines={1}>{p.name}</Text>
                    {soundRef === p.id ? <Ionicons name="checkmark" size={20} color="#22C55E" /> : null}
                  </Pressable>
                  <Pressable onPress={() => previewSound(p.id)} hitSlop={8} style={styles.previewBtn} testID={`preview-${p.id}`}>
                    <Ionicons name="play-circle" size={22} color="#22C55E" />
                  </Pressable>
                </View>
              ))}
              {sounds.length > 0 ? <Text style={styles.spSectionLbl}>Suoni personalizzati</Text> : null}
              {sounds.map((s) => (
                <View key={s.id} style={styles.soundRow}>
                  <Pressable
                    onPress={() => { setSoundRef(s.id); setShowSoundPicker(false); }}
                    style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}
                  >
                    <Ionicons name="musical-note" size={22} color={HT.muted} />
                    <Text style={styles.soundRowTxt} numberOfLines={1}>{s.name}</Text>
                    {soundRef === s.id ? <Ionicons name="checkmark" size={20} color="#22C55E" /> : null}
                  </Pressable>
                  <Pressable onPress={() => previewSound(s.id)} hitSlop={8} style={styles.previewBtn} testID={`preview-${s.id}`}>
                    <Ionicons name="play-circle" size={22} color="#22C55E" />
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      Alert.alert("Elimina suono", `Rimuovere "${s.name}"?`, [
                        { text: "Annulla", style: "cancel" },
                        {
                          text: "Elimina", style: "destructive", onPress: async () => {
                            try {
                              await api(`/axon/alarm-sounds/${s.id}`, { method: "DELETE" });
                              setSounds((prev) => prev.filter((x) => x.id !== s.id));
                              if (soundRef === s.id) setSoundRef("default");
                            } catch (e: any) {
                              Alert.alert("Errore", e?.message || "Impossibile eliminare");
                            }
                          }
                        },
                      ]);
                    }}
                    hitSlop={8}
                  >
                    <Ionicons name="trash-outline" size={18} color="#EF4444" />
                  </Pressable>
                </View>
              ))}
              <Pressable
                onPress={onPickSound}
                disabled={uploadingSound}
                style={[styles.uploadBtn, uploadingSound && { opacity: 0.6 }]}
              >
                {uploadingSound ? (
                  <ActivityIndicator color="#FBBF24" size="small" />
                ) : (
                  <>
                    <Ionicons name="cloud-upload-outline" size={18} color="#FBBF24" />
                    <Text style={styles.uploadTxt}>Carica mp3 personalizzato</Text>
                  </>
                )}
              </Pressable>
              <Text style={styles.hint}>Max ~1.5MB (mp3/wav/aac, ~30s a 128kbps).</Text>
            </Pressable>
          </Pressable>
        </Modal>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Sub-components ────────────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

function NumberPicker({ label, value, min, max, onChange }: {
  label: string; value: number; min: number; max: number; onChange: (v: number) => void;
}) {
  return (
    <View style={styles.npCol}>
      <Text style={styles.npLabel}>{label}</Text>
      <View style={styles.npBox}>
        <Pressable onPress={() => onChange(Math.max(min, value - 1))} hitSlop={6} style={styles.npBtn}>
          <Ionicons name="remove" size={18} color="#FBBF24" />
        </Pressable>
        <Text style={styles.npVal}>{String(value).padStart(2, "0")}</Text>
        <Pressable onPress={() => onChange(Math.min(max, value + 1))} hitSlop={6} style={styles.npBtn}>
          <Ionicons name="add" size={18} color="#FBBF24" />
        </Pressable>
      </View>
    </View>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────
function defaultLabel(kind: AlarmKind): string {
  if (kind === "timer") return "Timer";
  if (kind === "alarm") return "Sveglia";
  return "Promemoria";
}

function parseTime(t: string | undefined | null, useNowPlus5: boolean = false): { h: number; m: number } {
  // V50.z16 / V50.z78 — Non torniamo MAI al fixed 07:30. Se manca `time`,
  // usiamo sempre "ora corrente + 5 min" così l'utente non vede il classico
  // reset a 07:30 mai (il fallback storico era la causa del bug).
  if (!t) {
    const d = new Date(Date.now() + 5 * 60 * 1000);
    return { h: d.getHours(), m: d.getMinutes() };
  }
  const [h, m] = t.split(":").map((x) => parseInt(x, 10));
  // Se il parsing produce NaN (input corrotto), usa now+5 (mai 07:30)
  if (isNaN(h) || isNaN(m)) {
    const d = new Date(Date.now() + 5 * 60 * 1000);
    return { h: d.getHours(), m: d.getMinutes() };
  }
  return { h, m };
}

function fmtHHMM24(d: Date): string {
  // Formato ISO/24h sempre — usato SOLO per il payload backend
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

// ─── Styles ────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0F2438' },
  header: {
    height: 52, flexDirection: "row", alignItems: "center",
    justifyContent: "space-between", paddingHorizontal: 12,
    backgroundColor: '#0F2438', borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.08)",
  },
  hBtn: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: "#FFF", fontSize: 17, fontWeight: "800" },
  // V50.z10 — Toggle 12h/24h nell'header
  fmtBtn: {
    minWidth: 44, height: 30, borderRadius: 15, paddingHorizontal: 10,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(251,191,36,0.15)", borderWidth: 1, borderColor: "rgba(251,191,36,0.4)",
  },
  fmtBtnTxt: { color: "#FBBF24", fontSize: 12, fontWeight: "900", letterSpacing: 0.3 },

  tabsBar: {
    flexDirection: "row", padding: 10, gap: 8,
    backgroundColor: '#0F2438', borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.06)",
  },
  tabBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 8, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.05)",
  },
  tabBtnActive: { backgroundColor: '#FBBF24' },
  tabTxt: { color: HT.muted, fontWeight: "700", fontSize: 13 },
  tabTxtActive: { color: HT.text },

  emptyBox: { flex: 1, alignItems: "center", justifyContent: "center", padding: 30 },
  emptyTitle: { color: "#FFF", fontSize: 16, fontWeight: "800", marginTop: 12 },
  emptySub: { color: HT.muted, fontSize: 13, marginTop: 6, textAlign: "center" },

  row: {
    flexDirection: "row", alignItems: "center", gap: 10,
    padding: 14, borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.08)",
  },
  rowDisabled: { opacity: 0.55 },
  rowLeft: { flex: 1 },
  rowLabel: { color: "#FFF", fontSize: 15, fontWeight: "800" },
  rowSub: { color: HT.muted, fontSize: 13, marginTop: 2 },
  rowNote: { color: HT.muted, fontSize: 12, marginTop: 4, fontStyle: "italic" },
  rowActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  trashBtn: { padding: 4 },

  fab: {
    position: "absolute", right: 16, left: 16,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: '#FBBF24', paddingVertical: 14, borderRadius: 999,
    shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 6,
  },
  fabTxt: { color: HT.text, fontWeight: "900", fontSize: 15 },

  // Editor
  fieldLabel: { color: HT.muted, fontSize: 12, fontWeight: "700", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 },
  input: {
    backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, color: "#FFF", fontSize: 15,
  },
  timeBox: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12,
  },
  timeTxt: { color: "#FFF", fontSize: 16, fontWeight: "700", flex: 1 },
  weekdayRow: { flexDirection: "row", gap: 6, justifyContent: "space-between" },
  wdChip: {
    flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 10,
    borderRadius: 10, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)",
  },
  wdChipOn: { backgroundColor: '#FBBF24', borderColor: '#FBBF24' },
  wdTxt: { color: HT.muted, fontSize: 12, fontWeight: "700" },
  wdTxtOn: { color: HT.text },
  presetRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  presetChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
    backgroundColor: "rgba(251,191,36,0.15)", borderWidth: 1, borderColor: "rgba(251,191,36,0.4)",
  },
  presetTxt: { color: "#FBBF24", fontSize: 12, fontWeight: "700" },
  hint: { color: HT.muted, fontSize: 11, marginTop: 6, fontStyle: "italic" },
  rowThreeCols: { flexDirection: "row", gap: 8 },
  npCol: { flex: 1, alignItems: "center" },
  npLabel: { color: HT.muted, fontSize: 11, fontWeight: "700", marginBottom: 4 },
  npBox: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 12,
    paddingHorizontal: 6, paddingVertical: 8, width: "100%",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.1)",
  },
  npBtn: { width: 30, height: 30, alignItems: "center", justifyContent: "center", borderRadius: 8, backgroundColor: "rgba(251,191,36,0.15)" },
  npVal: { color: "#FFF", fontSize: 22, fontWeight: "900" },
  switchRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
  },
  switchLabel: { color: "#FFF", fontSize: 15, fontWeight: "700" },
  saveBar: {
    padding: 14, backgroundColor: '#0F2438',
    borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)",
  },
  saveBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: '#FBBF24', paddingVertical: 14, borderRadius: 999,
  },
  saveTxt: { color: HT.text, fontSize: 15, fontWeight: "900" },

  // Sound picker
  spBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  spSheet: { backgroundColor: '#0F2438', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, paddingBottom: 28 },
  dragHandle: { alignSelf: "center", width: 44, height: 4, borderRadius: 2, backgroundColor: '#334155', marginBottom: 8 },
  spTitle: { color: "#FFF", fontSize: 16, fontWeight: "800", marginBottom: 12 },
  spSectionLbl: { color: HT.muted, fontSize: 11, fontWeight: "700", textTransform: "uppercase", marginTop: 10, marginBottom: 4, letterSpacing: 0.5 },
  // V50.z78 — Volume slider row
  volRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 10 },
  soundRow: {
    flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.06)",
  },
  soundRowTxt: { color: "#FFF", fontSize: 14, fontWeight: "600", flex: 1 },
  previewBtn: { padding: 4, marginRight: 4 },
  uploadBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    marginTop: 14, paddingVertical: 12, borderRadius: 12,
    backgroundColor: "rgba(251,191,36,0.15)", borderWidth: 1, borderColor: "rgba(251,191,36,0.4)",
  },
  uploadTxt: { color: "#FBBF24", fontSize: 14, fontWeight: "700" },
});

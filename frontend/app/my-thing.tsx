import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Image,
  Modal, Alert, Platform, KeyboardAvoidingView, Switch,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { launchLibraryUniversal, launchCameraUniversal } from "@/src/utils/imagePickerCompat";
import DateTimePicker from "@react-native-community/datetimepicker";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { scheduleOneShot, scheduleDailyAt, scheduleYearlyAt, cancelByTag, ensureNotifPermission } from "@/src/notifs";

type Kind = "message" | "image" | "event" | "anniversary";

// V28.d — Banner customization types
type FontFamilyKey = "system" | "serif" | "monospace" | "rounded";
type FontSizeKey = "small" | "medium" | "large";

type MyThingItem = {
  item_id: string;
  kind: Kind;
  title: string;
  body: string;
  image_base64?: string | null;
  scheduled_at?: string | null;
  daily_time?: string | null;
  recurring: "none" | "daily" | "yearly";
  display_mode: "random" | "scheduled";
  notify: boolean;
  active: boolean;
  color: string;
  font_family?: FontFamilyKey | null;
  font_size?: FontSizeKey | null;
};

// Return a px number for each size preset (used both in native and web)
function sizePxFor(key: FontSizeKey | undefined | null): number {
  const m = SIZE_OPTIONS.find((s) => s.id === key);
  return m ? m.px : 16;
}

// V28.d — Utility: parse #RRGGBB into perceived luminance in [0..1]
function _luminance(hex: string): number {
  const h = (hex || "").replace("#", "").trim();
  if (h.length !== 6) return 0.5;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  // Perceived luminance (sRGB)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function isLightColor(hex: string): boolean {
  return _luminance(hex) > 0.72;
}

function contrastTextColor(bg: string): string {
  return isLightColor(bg) ? "#1B2B4B" : "#FFFFFF";
}

const TABS: { id: Kind; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: "message", label: "Messaggi", icon: "chatbubble-ellipses" },
  { id: "image", label: "Immagini", icon: "images" },
  { id: "event", label: "Eventi", icon: "calendar" },
  { id: "anniversary", label: "Ricorrenze", icon: "gift" },
];

// V28.d — White is now the default; light backgrounds first, then dark accents.
const COLORS = ["#FFFFFF", "#F5F5F5", "#FFF7ED", "#FEF9C3", "#DCFCE7", "#DBEAFE", "#EDE9FE", "#FCE7F3", "#3A739C", "#C83232", "#1B6CB0", "#2D7A5A", "#B77C14", "#7A2E8E", "#0B7285", "#E67700"];

// V28.d — Font families (3+ options as requested)
const FONT_OPTIONS: { id: FontFamilyKey; label: string; sample: string }[] = [
  { id: "system", label: "Standard", sample: "Aa" },
  { id: "serif", label: "Serif", sample: "Aa" },
  { id: "monospace", label: "Mono", sample: "Aa" },
  { id: "rounded", label: "Arrotondato", sample: "Aa" },
];

const SIZE_OPTIONS: { id: FontSizeKey; label: string; px: number }[] = [
  { id: "small", label: "Piccolo", px: 13 },
  { id: "medium", label: "Medio", px: 16 },
  { id: "large", label: "Grande", px: 20 },
];

// Return a native/web fontFamily string for each preset
function fontFamilyFor(key: FontFamilyKey | undefined | null): string | undefined {
  switch (key) {
    case "serif":
      return Platform.select({ ios: "Georgia", android: "serif", default: "Georgia, 'Times New Roman', serif" });
    case "monospace":
      return Platform.select({ ios: "Menlo", android: "monospace", default: "'SF Mono', Menlo, Consolas, monospace" });
    case "rounded":
      return Platform.select({ ios: "Avenir Next", android: "sans-serif-medium", default: "'Nunito', 'Avenir Next', system-ui, sans-serif" });
    case "system":
    default:
      return undefined; // system default
  }
}

export default function MyThingScreen() {
  const router = useRouter();
  const [active, setActive] = useState<Kind>("message");
  const [items, setItems] = useState<MyThingItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<MyThingItem | null>(null);

  // Form state
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [imgB64, setImgB64] = useState<string | null>(null);
  const [displayMode, setDisplayMode] = useState<"random" | "scheduled">("random");
  const [dailyTime, setDailyTime] = useState<string>("09:00");
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [scheduledAt, setScheduledAt] = useState<Date | null>(null);
  const [notify, setNotify] = useState(false);
  const [color, setColor] = useState<string>(COLORS[0]);
  // V28.d — banner customization for message slides
  const [fontFamily, setFontFamily] = useState<FontFamilyKey>("system");
  const [fontSize, setFontSize] = useState<FontSizeKey>("medium");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api<{ items: MyThingItem[] }>("/my-thing", { query: { kind: active } });
      setItems(r.items || []);
    } finally { setLoading(false); }
  }, [active]);
  useEffect(() => { load(); }, [load]);

  const openEditor = (it?: MyThingItem) => {
    if (it) {
      setEditing(it);
      setTitle(it.title || "");
      setBody(it.body || "");
      setImgB64(it.image_base64 || null);
      setDisplayMode(it.display_mode || "random");
      setDailyTime(it.daily_time || "09:00");
      setScheduledAt(it.scheduled_at ? new Date(it.scheduled_at) : null);
      setNotify(!!it.notify);
      setColor(it.color || COLORS[0]);
      setFontFamily((it.font_family as FontFamilyKey) || "system");
      setFontSize((it.font_size as FontSizeKey) || "medium");
    } else {
      setEditing(null);
      setTitle("");
      setBody("");
      setImgB64(null);
      setDisplayMode("random");
      setDailyTime("09:00");
      setScheduledAt(null);
      setNotify(false);
      setColor(COLORS[0]);
      setFontFamily("system");
      setFontSize("medium");
    }
    setEditorOpen(true);
  };

  const closeEditor = () => {
    setEditorOpen(false);
    setEditing(null);
  };

  const pickImage = async () => {
    const r = await launchLibraryUniversal({
      mediaTypes: "images",
      quality: 0.7,
      base64: Platform.OS !== "web",
    });
    if (r.canceled || !r.assets?.[0]) return;
    const a = r.assets[0];
    if (a.uri && a.uri.startsWith("data:")) {
      setImgB64(a.uri);
    } else if (a.base64) {
      setImgB64(`data:${a.mimeType || "image/jpeg"};base64,${a.base64}`);
    }
  };

  const takePhoto = async () => {
    const r = await launchCameraUniversal({ quality: 0.7, base64: Platform.OS !== "web" });
    if (r.canceled || !r.assets?.[0]) return;
    const a = r.assets[0];
    if (a.uri && a.uri.startsWith("data:")) {
      setImgB64(a.uri);
    } else if (a.base64) {
      setImgB64(`data:${a.mimeType || "image/jpeg"};base64,${a.base64}`);
    }
  };

  const save = async () => {
    // Validate
    if (active === "message" && !body.trim()) {
      Alert.alert("Manca il testo", "Scrivi il messaggio da salvare");
      return;
    }
    if (active === "image" && !imgB64) {
      Alert.alert("Manca l'immagine", "Aggiungi un'immagine");
      return;
    }
    if ((active === "event" || active === "anniversary") && !scheduledAt) {
      Alert.alert("Manca la data", "Seleziona la data dell'evento");
      return;
    }
    if (active === "message" && displayMode === "scheduled" && !/^\d{2}:\d{2}$/.test(dailyTime)) {
      Alert.alert("Orario non valido", "Formato HH:MM");
      return;
    }

    const payload: Partial<MyThingItem> = {
      kind: active,
      title: title.trim(),
      body: body.trim(),
      image_base64: imgB64,
      display_mode: active === "message" ? displayMode : "random",
      daily_time: active === "message" && displayMode === "scheduled" ? dailyTime : null,
      scheduled_at: scheduledAt ? scheduledAt.toISOString() : null,
      recurring: active === "anniversary" ? "yearly" : active === "message" && displayMode === "scheduled" ? "daily" : "none",
      notify,
      active: true,
      color,
      // V28.d — persist banner customization only for message-kind items
      font_family: active === "message" ? fontFamily : undefined,
      font_size: active === "message" ? fontSize : undefined,
    };

    try {
      let saved: MyThingItem;
      if (editing) {
        const r = await api<{ item: MyThingItem }>(`/my-thing/${editing.item_id}`, { method: "PUT", body: payload });
        saved = r.item;
      } else {
        const r = await api<{ item: MyThingItem }>("/my-thing", { method: "POST", body: payload });
        saved = r.item;
      }

      // Schedule notification if requested
      if (notify) {
        const ok = await ensureNotifPermission();
        if (!ok && Platform.OS !== "web") {
          Alert.alert("Notifiche disattivate", "Attiva le notifiche nelle impostazioni del dispositivo per ricevere avvisi");
        } else {
          const notifTitle = saved.title || "Promemoria";
          const notifBody = saved.body || saved.title || "Ricorda!";
          if (active === "event" && scheduledAt) {
            await scheduleOneShot(`mt_${saved.item_id}`, notifTitle, notifBody, scheduledAt);
          } else if (active === "anniversary" && scheduledAt) {
            await scheduleYearlyAt(`mt_${saved.item_id}`, notifTitle, notifBody, scheduledAt.getMonth() + 1, scheduledAt.getDate(), 9, 0);
          } else if (active === "message" && displayMode === "scheduled") {
            const [h, m] = dailyTime.split(":").map((x) => parseInt(x, 10));
            await scheduleDailyAt(`mt_${saved.item_id}`, notifTitle, notifBody, h, m);
          }
        }
      } else {
        await cancelByTag(`mt_${saved.item_id}`);
      }

      closeEditor();
      load();
    } catch (e: any) {
      Alert.alert("Errore", e.message || "Impossibile salvare");
    }
  };

  const doDelete = (it: MyThingItem) => {
    const doIt = async () => {
      try {
        await api(`/my-thing/${it.item_id}`, { method: "DELETE" });
        await cancelByTag(`mt_${it.item_id}`);
        load();
      } catch (e: any) {
        if (Platform.OS === "web") {
          window.alert("Impossibile eliminare: " + (e?.message || ""));
        } else {
          Alert.alert("Errore", e?.message || "Impossibile eliminare");
        }
      }
    };
    if (Platform.OS === "web") {
      if (window.confirm("Confermi eliminazione?")) doIt();
    } else {
      Alert.alert("Elimina", "Confermi eliminazione?", [
        { text: "Annulla", style: "cancel" },
        { text: "Elimina", style: "destructive", onPress: doIt },
      ]);
    }
  };

  const toggleActive = async (it: MyThingItem) => {
    try {
      await api(`/my-thing/${it.item_id}`, { method: "PUT", body: { active: !it.active } });
      if (it.active) await cancelByTag(`mt_${it.item_id}`);
      load();
    } catch {}
  };

  const dateLabel = scheduledAt ? scheduledAt.toLocaleString("it-IT", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "Seleziona data e ora";

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={22} color={theme.color.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>My Thing</Text>
          <Text style={styles.subtitle}>Il tuo spazio personale</Text>
        </View>
        <Pressable testID="mt-add-btn" onPress={() => openEditor()} style={styles.addBtn}>
          <Ionicons name="add" size={22} color="#FFF" />
        </Pressable>
      </View>

      <View style={styles.tabsRow}>
        {TABS.map((t) => {
          const on = active === t.id;
          return (
            <Pressable
              key={t.id}
              testID={`mt-tab-${t.id}`}
              onPress={() => setActive(t.id)}
              style={[styles.tab, on && styles.tabOn]}
            >
              <Ionicons name={t.icon} size={16} color={on ? "#FFF" : theme.color.muted} />
              <Text style={[styles.tabTxt, on && styles.tabTxtOn]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={theme.color.brandPrimary} /></View>
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name={TABS.find((t) => t.id === active)!.icon} size={44} color={theme.color.muted} />
          <Text style={styles.emptyTitle}>Nessun elemento</Text>
          <Text style={styles.emptySub}>Tocca &quot;+&quot; per aggiungere il primo{active === "message" ? " messaggio motivazionale" : active === "image" ? "&apos;a immagine" : active === "event" ? "&apos; evento" : "&apos;a ricorrenza"}</Text>
          <Pressable testID="mt-empty-add" onPress={() => openEditor()} style={styles.emptyBtn}>
            <Ionicons name="add-circle" size={18} color="#FFF" />
            <Text style={styles.emptyBtnTxt}>Aggiungi</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
          {items.map((it) => (
            <View key={it.item_id} style={[styles.card, { borderLeftColor: it.color, borderLeftWidth: 4 }]}>
              {it.kind === "image" && it.image_base64 ? (
                <Image source={{ uri: it.image_base64 }} style={styles.cardImg} />
              ) : null}
              <View style={{ flex: 1 }}>
                <View style={styles.cardRow}>
                  <Text style={styles.cardTitle} numberOfLines={1}>{it.title || (it.kind === "message" ? "Messaggio" : it.kind === "image" ? "Immagine" : it.kind === "event" ? "Evento" : "Ricorrenza")}</Text>
                  <Pressable onPress={() => toggleActive(it)} hitSlop={8}>
                    <Ionicons name={it.active ? "eye" : "eye-off"} size={18} color={it.active ? theme.color.brandPrimary : theme.color.muted} />
                  </Pressable>
                </View>
                {!!it.body && <Text style={styles.cardBody} numberOfLines={3}>{it.body}</Text>}
                <View style={styles.cardMeta}>
                  {it.kind === "message" && (
                    <View style={styles.metaChip}>
                      <Ionicons name={it.display_mode === "random" ? "shuffle" : "time"} size={11} color={theme.color.muted} />
                      <Text style={styles.metaTxt}>
                        {it.display_mode === "random" ? "Random" : `Ore ${it.daily_time}`}
                      </Text>
                    </View>
                  )}
                  {(it.kind === "event" || it.kind === "anniversary") && it.scheduled_at && (
                    <View style={styles.metaChip}>
                      <Ionicons name="calendar" size={11} color={theme.color.muted} />
                      <Text style={styles.metaTxt}>
                        {new Date(it.scheduled_at).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: it.kind === "anniversary" ? undefined : "numeric" })}
                      </Text>
                    </View>
                  )}
                  {it.notify && (
                    <View style={styles.metaChip}>
                      <Ionicons name="notifications" size={11} color={theme.color.brandPrimary} />
                      <Text style={[styles.metaTxt, { color: theme.color.brandPrimary }]}>Notifica</Text>
                    </View>
                  )}
                </View>
                <View style={styles.cardActions}>
                  <Pressable onPress={() => openEditor(it)} style={styles.actionBtn}>
                    <Ionicons name="create-outline" size={14} color={theme.color.brandPrimary} />
                    <Text style={styles.actionTxt}>Modifica</Text>
                  </Pressable>
                  <Pressable onPress={() => doDelete(it)} style={styles.actionBtn}>
                    <Ionicons name="trash-outline" size={14} color={theme.color.error} />
                    <Text style={[styles.actionTxt, { color: theme.color.error }]}>Elimina</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      {/* EDITOR MODAL */}
      <Modal visible={editorOpen} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>
                {editing ? "Modifica" : "Nuovo"} {active === "message" ? "messaggio" : active === "image" ? "immagine" : active === "event" ? "evento" : "ricorrenza"}
              </Text>
              <Pressable onPress={closeEditor} hitSlop={8}>
                <Ionicons name="close" size={22} color={theme.color.onSurface} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
              <TextInput
                testID="mt-title-input"
                value={title}
                onChangeText={setTitle}
                placeholder="Titolo (opzionale)"
                placeholderTextColor="#94A3B8"
                style={styles.input}
              />

              {(active === "message" || active === "event") && (
                <TextInput
                  testID="mt-body-input"
                  value={body}
                  onChangeText={setBody}
                  placeholder={active === "message" ? "Scrivi il tuo messaggio motivazionale…" : "Descrizione dell'evento…"}
                  placeholderTextColor="#94A3B8"
                  multiline
                  numberOfLines={4}
                  style={[styles.input, { minHeight: 90, textAlignVertical: "top" }]}
                />
              )}

              {active === "image" && (
                <View style={{ gap: 8 }}>
                  {imgB64 ? (
                    <View style={{ alignItems: "center" }}>
                      <Image source={{ uri: imgB64 }} style={styles.previewImg} />
                      <Pressable onPress={() => setImgB64(null)} style={styles.linkBtn}>
                        <Text style={styles.linkBtnTxt}>Rimuovi</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <Pressable onPress={pickImage} style={[styles.imgBtn, { backgroundColor: "#7A2E8E" }]}>
                        <Ionicons name="images" size={18} color="#FFF" />
                        <Text style={styles.imgBtnTxt}>Galleria</Text>
                      </Pressable>
                      <Pressable onPress={takePhoto} style={[styles.imgBtn, { backgroundColor: "#E67700" }]}>
                        <Ionicons name="camera" size={18} color="#FFF" />
                        <Text style={styles.imgBtnTxt}>Scatta</Text>
                      </Pressable>
                    </View>
                  )}
                  <TextInput
                    value={body}
                    onChangeText={setBody}
                    placeholder="Didascalia (opzionale)"
                    placeholderTextColor="#94A3B8"
                    style={styles.input}
                  />
                </View>
              )}

              {active === "message" && (
                <View style={styles.formCard}>
                  <Text style={styles.label}>Modalità di visualizzazione</Text>
                  <View style={styles.segment}>
                    <Pressable
                      testID="mt-mode-random"
                      onPress={() => setDisplayMode("random")}
                      style={[styles.segItem, displayMode === "random" && styles.segItemOn]}
                    >
                      <Ionicons name="shuffle" size={14} color={displayMode === "random" ? "#FFF" : theme.color.muted} />
                      <Text style={[styles.segTxt, displayMode === "random" && { color: "#FFF" }]}>Random in home</Text>
                    </Pressable>
                    <Pressable
                      testID="mt-mode-scheduled"
                      onPress={() => setDisplayMode("scheduled")}
                      style={[styles.segItem, displayMode === "scheduled" && styles.segItemOn]}
                    >
                      <Ionicons name="time" size={14} color={displayMode === "scheduled" ? "#FFF" : theme.color.muted} />
                      <Text style={[styles.segTxt, displayMode === "scheduled" && { color: "#FFF" }]}>Orario fisso</Text>
                    </Pressable>
                  </View>
                  {displayMode === "scheduled" && (
                    <View style={{ marginTop: 10 }}>
                      <Text style={styles.label}>Ora (HH:MM)</Text>
                      <TextInput
                        testID="mt-daily-time"
                        value={dailyTime}
                        onChangeText={(t) => setDailyTime(t.replace(/[^0-9:]/g, "").slice(0, 5))}
                        placeholder="09:00"
                        placeholderTextColor="#94A3B8"
                        style={[styles.input, { textAlign: "center", letterSpacing: 4, fontSize: 18 }]}
                        maxLength={5}
                      />
                    </View>
                  )}
                </View>
              )}

              {(active === "event" || active === "anniversary") && (
                <View style={styles.formCard}>
                  <Text style={styles.label}>Data{active === "event" ? " e ora" : ""}</Text>
                  {Platform.OS === "web" ? (
                    <View style={{ marginTop: 4 }}>
                      {/* @ts-expect-error web-only */}
                      <input
                        type={active === "event" ? "datetime-local" : "date"}
                        value={
                          scheduledAt
                            ? (active === "event"
                                ? new Date(scheduledAt.getTime() - scheduledAt.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
                                : new Date(scheduledAt.getTime() - scheduledAt.getTimezoneOffset() * 60000).toISOString().slice(0, 10))
                            : ""
                        }
                        onChange={(e: any) => {
                          const v = e.target.value;
                          if (!v) { setScheduledAt(null); return; }
                          setScheduledAt(new Date(v));
                        }}
                        style={webInputStyle}
                      />
                    </View>
                  ) : (
                    <>
                      <Pressable onPress={() => setDatePickerOpen(true)} style={styles.dateBtn}>
                        <Ionicons name="calendar" size={16} color={theme.color.brandPrimary} />
                        <Text style={styles.dateBtnTxt}>{dateLabel}</Text>
                      </Pressable>
                      {datePickerOpen && (
                        <DateTimePicker
                          value={scheduledAt || new Date()}
                          mode={active === "event" ? "datetime" : "date"}
                          display={Platform.OS === "ios" ? "spinner" : "default"}
                          onChange={(_e, d) => {
                            if (Platform.OS === "android") setDatePickerOpen(false);
                            if (d) setScheduledAt(d);
                          }}
                        />
                      )}
                    </>
                  )}
                  {active === "anniversary" && (
                    <Text style={styles.hint}>Le ricorrenze si ripetono ogni anno automaticamente.</Text>
                  )}
                </View>
              )}

              <View style={styles.formCard}>
                <View style={styles.rowBetween}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>Notifica / Pop-up</Text>
                    <Text style={styles.hint}>
                      {active === "message" && displayMode === "random" ? "Le notifiche non sono disponibili in modalità Random" :
                       active === "message" ? "Riceverai una notifica ogni giorno all'orario indicato" :
                       active === "event" ? "Riceverai una notifica all'ora dell'evento" :
                       active === "anniversary" ? "Riceverai una notifica ogni anno alle 09:00" : ""}
                    </Text>
                  </View>
                  <Switch
                    testID="mt-notify-switch"
                    value={notify}
                    onValueChange={setNotify}
                    disabled={active === "message" && displayMode === "random"}
                    trackColor={{ true: theme.color.brandPrimary, false: "#E2E8F0" }}
                  />
                </View>
              </View>

              {/* V28.d — Banner customization (message-kind only) */}
              {active === "message" && (
                <View style={styles.formCard}>
                  <Text style={styles.label}>Anteprima banner</Text>
                  <View
                    style={[
                      styles.bannerPreview,
                      { backgroundColor: color, borderColor: isLightColor(color) ? "#E2E8F0" : "transparent" },
                    ]}
                  >
                    {title.trim() ? (
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.bannerPreviewTitle,
                          { color: contrastTextColor(color), fontFamily: fontFamilyFor(fontFamily) },
                        ]}
                      >
                        {title.trim().toUpperCase()}
                      </Text>
                    ) : null}
                    <Text
                      numberOfLines={3}
                      style={{
                        color: contrastTextColor(color),
                        fontWeight: "700",
                        textAlign: "center",
                        fontFamily: fontFamilyFor(fontFamily),
                        fontSize: sizePxFor(fontSize),
                        lineHeight: sizePxFor(fontSize) * 1.4,
                      }}
                    >
                      {body.trim() || "Anteprima del messaggio: scrivi qui sopra e vedrai il risultato."}
                    </Text>
                  </View>

                  <Text style={[styles.label, { marginTop: 12 }]}>Font</Text>
                  <View style={styles.chipsRow}>
                    {FONT_OPTIONS.map((f) => {
                      const on = fontFamily === f.id;
                      return (
                        <Pressable
                          key={f.id}
                          testID={`mt-font-${f.id}`}
                          onPress={() => setFontFamily(f.id)}
                          style={[styles.fontChip, on && styles.fontChipOn]}
                        >
                          <Text style={[styles.fontChipSample, on && styles.fontChipTxtOn, { fontFamily: fontFamilyFor(f.id) }]}>{f.sample}</Text>
                          <Text style={[styles.fontChipLbl, on && styles.fontChipTxtOn]}>{f.label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <Text style={[styles.label, { marginTop: 12 }]}>Dimensione testo</Text>
                  <View style={styles.segment}>
                    {SIZE_OPTIONS.map((s) => {
                      const on = fontSize === s.id;
                      return (
                        <Pressable
                          key={s.id}
                          testID={`mt-size-${s.id}`}
                          onPress={() => setFontSize(s.id)}
                          style={[styles.segItem, on && styles.segItemOn]}
                        >
                          <Text
                            style={[
                              styles.segTxt,
                              on && { color: "#FFF" },
                              { fontSize: s.px * 0.65 + 4 },
                            ]}
                          >
                            {s.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              )}

              <View style={styles.formCard}>
                <Text style={styles.label}>Colore sfondo{active === "message" ? " banner" : ""}</Text>
                <View style={styles.swatches}>
                  {COLORS.map((c) => (
                    <Pressable
                      key={c}
                      onPress={() => setColor(c)}
                      style={[
                        styles.swatch,
                        { backgroundColor: c, borderColor: isLightColor(c) ? "#CBD5E1" : "transparent" },
                        color === c && styles.swatchOn,
                      ]}
                    >
                      {color === c && <Ionicons name="checkmark" size={14} color={contrastTextColor(c)} />}
                    </Pressable>
                  ))}
                </View>
              </View>

              <Pressable testID="mt-save-btn" onPress={save} style={styles.saveBtn}>
                <Ionicons name="checkmark" size={20} color="#FFF" />
                <Text style={styles.saveBtnTxt}>{editing ? "Salva modifiche" : "Aggiungi"}</Text>
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12 },
  iconBtn: { padding: 4 },
  title: { fontSize: 20, fontWeight: "800", color: theme.color.onSurface },
  subtitle: { fontSize: 12, color: theme.color.muted, marginTop: 2 },
  addBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.color.brandPrimary, alignItems: "center", justifyContent: "center" },
  tabsRow: { flexDirection: "row", gap: 6, paddingHorizontal: 12, marginBottom: 4, flexWrap: "wrap" },
  tab: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, backgroundColor: theme.color.surfaceTertiary },
  tabOn: { backgroundColor: theme.color.brandPrimary },
  tabTxt: { color: theme.color.muted, fontWeight: "600", fontSize: 12 },
  tabTxtOn: { color: "#FFF" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: theme.color.onSurface, marginTop: 8 },
  emptySub: { fontSize: 13, color: theme.color.muted, textAlign: "center" },
  emptyBtn: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 20, backgroundColor: theme.color.brandPrimary },
  emptyBtnTxt: { color: "#FFF", fontWeight: "700" },
  card: { backgroundColor: "#FFF", borderRadius: theme.radius.md, padding: 12, borderWidth: 1, borderColor: theme.color.border, flexDirection: "row", gap: 12 },
  formCard: { backgroundColor: "#FFF", borderRadius: theme.radius.md, padding: 12, borderWidth: 1, borderColor: theme.color.border, gap: 8 },
  cardImg: { width: 70, height: 70, borderRadius: 8 },
  cardRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { fontSize: 14, fontWeight: "700", color: theme.color.onSurface, flex: 1 },
  cardBody: { fontSize: 13, color: theme.color.onSurfaceTertiary, marginTop: 2 },
  cardMeta: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  metaChip: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: theme.color.surface, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  metaTxt: { fontSize: 11, color: theme.color.muted },
  cardActions: { flexDirection: "row", gap: 12, marginTop: 8 },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  actionTxt: { fontSize: 12, color: theme.color.brandPrimary, fontWeight: "700" },
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: theme.color.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "92%" },
  modalHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  modalTitle: { fontSize: 17, fontWeight: "700", color: theme.color.onSurface },
  input: { backgroundColor: "#FFF", borderRadius: theme.radius.md, padding: 12, borderWidth: 1, borderColor: theme.color.border, color: theme.color.onSurface, fontSize: 15 },
  label: { fontSize: 12, color: theme.color.onSurfaceTertiary, fontWeight: "700", marginBottom: 6 },
  hint: { fontSize: 11, color: theme.color.muted, marginTop: 4, fontStyle: "italic" },
  segment: { flexDirection: "row", backgroundColor: theme.color.surfaceTertiary, borderRadius: 20, padding: 3 },
  segItem: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 8, borderRadius: 16 },
  segItemOn: { backgroundColor: theme.color.brandPrimary },
  segTxt: { color: theme.color.muted, fontWeight: "600", fontSize: 12 },
  rowBetween: { flexDirection: "row", alignItems: "center", gap: 12 },
  dateBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: theme.color.surfaceTertiary, padding: 12, borderRadius: theme.radius.md },
  dateBtnTxt: { color: theme.color.onSurface, fontWeight: "600" },
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  swatch: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "transparent" },
  swatchOn: { borderColor: theme.color.onSurface },
  // V28.d — banner customization
  bannerPreview: {
    borderRadius: 14,
    padding: 16,
    minHeight: 88,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
  },
  bannerPreviewTitle: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.3,
    opacity: 0.85,
  },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  fontChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surfaceTertiary,
    borderWidth: 1,
    borderColor: "transparent",
  },
  fontChipOn: { backgroundColor: theme.color.brandPrimary, borderColor: theme.color.brandPrimary },
  fontChipSample: { fontSize: 15, fontWeight: "800", color: theme.color.onSurface },
  fontChipLbl: { fontSize: 12, fontWeight: "700", color: theme.color.muted },
  fontChipTxtOn: { color: "#FFF" },
  saveBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: theme.color.brandPrimary, paddingVertical: 14, borderRadius: theme.radius.md, marginTop: 4 },
  saveBtnTxt: { color: "#FFF", fontWeight: "800", fontSize: 15 },
  imgBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 14, borderRadius: theme.radius.md },
  imgBtnTxt: { color: "#FFF", fontWeight: "700" },
  previewImg: { width: 220, height: 220, borderRadius: 12, backgroundColor: theme.color.surfaceTertiary },
  linkBtn: { paddingVertical: 8 },
  linkBtnTxt: { color: theme.color.error, fontWeight: "600", fontSize: 13 },
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

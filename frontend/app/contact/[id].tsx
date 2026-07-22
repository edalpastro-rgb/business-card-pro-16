import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Linking, Platform, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { useAudioRecorder, AudioModule, RecordingPresets, useAudioPlayer } from "expo-audio";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { pickAvatarBase64 } from "@/src/image-picker";
import { shareText, shareDataUri } from "@/src/share";
import * as ImagePicker from "expo-image-picker";

type Note = { id: string; kind: "text" | "audio" | "photo" | "video" | "file" | "link"; category?: "general" | "email" | "referral" | null; text?: string; audio_base64?: string; audio_mime?: string; photo_base64?: string; video_base64?: string; video_mime?: string; file_base64?: string; file_name?: string; file_mime?: string; file_size?: number; link_url?: string; link_title?: string; created_at: string; duration_ms?: number };
type CFile = { id: string; name: string; mime: string; size: number; created_at: string; data_base64?: string };
type Contact = {
  contact_id: string; first_name: string; last_name: string; phone: string; email: string; address: string;
  phone_alt?: string; whatsapp?: string; email_alt?: string; telegram?: string;
  address_street?: string; address_number?: string; address_zip?: string; address_city?: string; address_province?: string;
  birth_date?: string; fiscal_code?: string; vat_number?: string;
  website?: string; linkedin?: string; instagram?: string; facebook?: string;
  area: "energy" | "network"; additional_areas?: string[]; source: string; referral_note: string; email_note: string; general_note: string;
  tags?: string[]; group_ids?: string[]; referred_by_contact_id?: string;
  notes: Note[]; files: CFile[]; avatar_base64?: string;
};

export default function ContactDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [c, setC] = useState<Contact | null>(null);
  const [tab, setTab] = useState<"info" | "notes" | "files">("info");
  const [noteText, setNoteText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [activeCategory, setActiveCategory] = useState<null | "general" | "email" | "referral">(null);
  const [groups, setGroups] = useState<Array<{ group_id: string; name: string; color: string }>>([]);
  const [settings, setSettings] = useState<any>(null);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [playingUri, setPlayingUri] = useState<string | null>(null);
  const player = useAudioPlayer(playingUri);

  const load = useCallback(async () => {
    setC(await api<Contact>(`/contacts/${id}`));
    try {
      const [gr, st] = await Promise.all([
        api<{ items: any[] }>("/groups"),
        api<any>("/settings"),
      ]);
      setGroups(gr.items || []);
      setSettings(st);
    } catch {}
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!c) return <SafeAreaView style={styles.root}><ActivityIndicator style={{ marginTop: 40 }} color={theme.color.brandPrimary} /></SafeAreaView>;

  const color = c.area === "energy" ? theme.color.energy : theme.color.network;

  const openWaze = () => {
    if (!c.address) return;
    const url = `https://www.waze.com/ul?q=${encodeURIComponent(c.address)}&navigate=yes`;
    Linking.openURL(url);
  };
  const callPhone = () => { if (c.phone) Linking.openURL(`tel:${c.phone.replace(/\s/g, "")}`); };
  const sendWhatsApp = () => { if (c.phone) Linking.openURL(`https://wa.me/${c.phone.replace(/[^\d+]/g, "")}`); };
  const sendEmail = () => { if (c.email) Linking.openURL(`mailto:${c.email}`); };

  const addTextNote = async () => {
    if (!noteText.trim()) return;
    setBusy(true);
    try {
      await api(`/contacts/${id}/notes`, { method: "POST", body: { kind: "text", text: noteText, category: activeCategory } });
      setNoteText(""); await load();
    } finally { setBusy(false); }
  };

  const startRecording = async () => {
    if (Platform.OS === "web") { alert("Registrazione audio non disponibile su web preview"); return; }
    const { granted } = await AudioModule.requestRecordingPermissionsAsync();
    if (!granted) return;
    await recorder.prepareToRecordAsync();
    recorder.record();
    setRecording(true);
  };

  const stopRecording = async () => {
    setRecording(false);
    await recorder.stop();
    const uri = recorder.uri;
    if (!uri) return;
    setBusy(true);
    try {
      const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      await api(`/contacts/${id}/notes`, {
        method: "POST",
        body: { kind: "audio", audio_base64: b64, audio_mime: "audio/m4a", category: activeCategory },
      });
      await load();
    } catch (e) { console.warn(e); }
    finally { setBusy(false); }
  };

  const playNote = (n: Note) => {
    if (!n.audio_base64) return;
    const uri = `data:${n.audio_mime || "audio/m4a"};base64,${n.audio_base64}`;
    setPlayingUri(uri);
    setTimeout(() => player.play(), 100);
  };

  const deleteNote = async (nid: string) => {
    await api(`/contacts/${id}/notes/${nid}`, { method: "DELETE" });
    load();
  };

  const addPhotoNote = async (fromCamera: boolean) => {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (Platform.OS !== "web" && !perm.granted) return;
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.5, base64: Platform.OS === "web" })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.5, base64: Platform.OS === "web" });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    let b64 = a.base64;
    if (!b64) {
      try { b64 = await FileSystem.readAsStringAsync(a.uri, { encoding: FileSystem.EncodingType.Base64 }); } catch { return; }
    }
    const uri = `data:${a.mimeType || "image/jpeg"};base64,${b64}`;
    setBusy(true);
    try {
      await api(`/contacts/${id}/notes`, { method: "POST", body: { kind: "photo", photo_base64: uri, category: activeCategory } });
      await load();
    } finally { setBusy(false); }
  };

  const addVideoNote = async (fromCamera: boolean) => {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (Platform.OS !== "web" && !perm.granted) return;
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Videos,
          videoMaxDuration: 60,
          quality: 0.5,
          base64: Platform.OS === "web",
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Videos,
          videoMaxDuration: 60,
          quality: 0.5,
          base64: Platform.OS === "web",
        });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    let b64 = a.base64;
    if (!b64) {
      try { b64 = await FileSystem.readAsStringAsync(a.uri, { encoding: FileSystem.EncodingType.Base64 }); } catch { return; }
    }
    // Sanity check size to avoid huge payloads (limit ~15MB base64)
    if (b64 && b64.length > 20 * 1024 * 1024) {
      alert("Video troppo grande (max ~15MB). Registra un clip più breve o riduci la qualità.");
      return;
    }
    const mime = a.mimeType || "video/mp4";
    const uri = `data:${mime};base64,${b64}`;
    setBusy(true);
    try {
      await api(`/contacts/${id}/notes`, { method: "POST", body: { kind: "video", video_base64: uri, video_mime: mime, category: activeCategory } });
      await load();
    } finally { setBusy(false); }
  };

  const addLinkNote = async () => {
    if (!linkUrl.trim()) return;
    setBusy(true);
    try {
      await api(`/contacts/${id}/notes`, { method: "POST", body: { kind: "link", link_url: linkUrl, link_title: noteText, category: activeCategory } });
      setLinkUrl(""); setNoteText(""); setShowLinkInput(false);
      await load();
    } finally { setBusy(false); }
  };

  const pickFile = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: ["application/pdf", "image/*"], multiple: false, copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.[0]) return;
    const asset = res.assets[0];
    setBusy(true);
    try {
      const b64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      await api(`/contacts/${id}/files`, {
        method: "POST",
        body: { name: asset.name, mime: asset.mimeType || "application/octet-stream", data_base64: b64, size: asset.size || 0 },
      });
      await load();
    } finally { setBusy(false); }
  };

  const addFileNote = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: "*/*", multiple: false, copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.[0]) return;
    const asset = res.assets[0];
    setBusy(true);
    try {
      const b64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      if (b64.length > 20 * 1024 * 1024) {
        alert("File troppo grande (max ~15MB).");
        return;
      }
      await api(`/contacts/${id}/notes`, {
        method: "POST",
        body: {
          kind: "file",
          file_base64: b64,
          file_name: asset.name,
          file_mime: asset.mimeType || "application/octet-stream",
          file_size: asset.size || 0,
          category: activeCategory,
        },
      });
      await load();
    } finally { setBusy(false); }
  };

  const deleteFile = async (fid: string) => {
    await api(`/contacts/${id}/files/${fid}`, { method: "DELETE" });
    load();
  };

  const shareContact = async () => {
    if (!c) return;
    const lines = [
      `${c.first_name} ${c.last_name}`.trim(),
      c.phone ? `📞 ${c.phone}` : "",
      c.phone_alt ? `📞 ${c.phone_alt}` : "",
      c.whatsapp ? `💬 WhatsApp: ${c.whatsapp}` : "",
      c.email ? `✉️ ${c.email}` : "",
      c.email_alt ? `✉️ ${c.email_alt}` : "",
      c.telegram ? `Telegram: ${c.telegram}` : "",
      c.address ? `📍 ${c.address}` : "",
      c.website ? `🌐 ${c.website}` : "",
      c.general_note ? `\n${c.general_note}` : "",
    ].filter(Boolean).join("\n");
    await shareText(lines, `Scheda ${c.first_name} ${c.last_name}`);
  };

  const shareFile = async (f: CFile) => {
    if (!f.data_base64) return;
    await shareDataUri(`data:${f.mime};base64,${f.data_base64}`, f.name, f.mime);
  };

  const shareNote = async (n: Note) => {
    try {
      if (n.kind === "text") await shareText(n.text || "");
      else if (n.kind === "link") await shareText(`${n.link_title || ""}\n${n.link_url || ""}`.trim());
      else if (n.kind === "audio" && n.audio_base64) await shareDataUri(`data:${n.audio_mime || "audio/m4a"};base64,${n.audio_base64}`, `vocale-${n.id}.m4a`, n.audio_mime || "audio/m4a");
      else if (n.kind === "photo" && n.photo_base64) await shareDataUri(n.photo_base64, `foto-${n.id}.jpg`, "image/jpeg");
      else if (n.kind === "video" && n.video_base64) await shareDataUri(n.video_base64, `video-${n.id}.mp4`, n.video_mime || "video/mp4");
      else if (n.kind === "file" && n.file_base64) await shareDataUri(`data:${n.file_mime};base64,${n.file_base64}`, n.file_name || `file-${n.id}`, n.file_mime || "application/octet-stream");
    } catch (e) { console.warn(e); }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={[styles.header, { backgroundColor: color }]}>
        <Pressable testID="back-btn" onPress={() => router.back()}><Ionicons name="chevron-back" size={26} color="#FFF" /></Pressable>
        <View style={{ flex: 1 }} />
        <Pressable testID="share-contact" onPress={shareContact} style={{ marginRight: 12 }}><Ionicons name="share-social-outline" size={22} color="#FFF" /></Pressable>
        <Pressable testID="edit-contact" onPress={() => router.push(`/contact/edit/${id}`)}><Ionicons name="create-outline" size={22} color="#FFF" /></Pressable>
      </View>
      <View style={[styles.hero, { backgroundColor: color }]}>
        <Pressable
          testID="contact-avatar-btn"
          onPress={async () => {
            const b64 = await pickAvatarBase64();
            if (b64) { await api(`/contacts/${id}`, { method: "PUT", body: { avatar_base64: b64 } }); await load(); }
          }}
          style={styles.avatarWrap}
        >
          {c.avatar_base64 ? (
            <Image source={{ uri: c.avatar_base64 }} style={styles.avatarImg} />
          ) : (
            <View style={styles.avatar}><Text style={styles.avatarTxt}>{c.first_name[0]?.toUpperCase()}{c.last_name[0]?.toUpperCase()}</Text></View>
          )}
          <View style={styles.avatarBadge}>
            <Ionicons name="camera" size={12} color="#FFF" />
          </View>
        </Pressable>
        <Text style={styles.name}>{c.first_name} {c.last_name}</Text>
        <Text style={styles.areaTag}>{c.area === "energy" ? "Consulente Energetico" : "Networker"} · {c.source === "referral" ? "Referenza" : "Conoscenza"}</Text>
        <View style={styles.actionsRow}>
          {c.phone ? <QuickAct icon="call" label="Chiama" onPress={callPhone} testID="act-call" /> : null}
          {c.phone ? <QuickAct icon="logo-whatsapp" label="WhatsApp" onPress={sendWhatsApp} testID="act-wa" /> : null}
          {c.email ? <QuickAct icon="mail" label="Email" onPress={sendEmail} testID="act-mail" /> : null}
          {c.address ? <QuickAct icon="navigate" label="Waze" onPress={openWaze} testID="act-waze" /> : null}
        </View>
      </View>

      <View style={styles.tabs}>
        {(["info", "notes", "files"] as const).map((t) => (
          <Pressable key={t} testID={`tab-${t}`} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabActive]}>
            <Text style={[styles.tabTxt, tab === t && styles.tabTxtActive]}>{t === "info" ? "Info" : t === "notes" ? "Note" : "File"}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={{ padding: 16 }}>
        {tab === "info" && (
          <>
            {(() => {
              const areaMap: Record<string, { name: string; color: string }> = {
                energy: { name: settings?.energy_title || "Consulente Energetico", color: settings?.energy_color || theme.color.energy },
                network: { name: settings?.network_title || "Networker", color: settings?.network_color || theme.color.network },
              };
              (settings?.custom_areas || []).forEach((a: any) => { areaMap[a.id] = { name: a.name, color: a.color }; });
              const contactAreas: string[] = [c.area, ...(c.additional_areas || [])].filter(Boolean);
              const contactGroupObjs = (c.group_ids || []).map((gid) => groups.find((g) => g.group_id === gid)).filter(Boolean) as Array<{ group_id: string; name: string; color: string }>;
              if (contactAreas.length === 0 && contactGroupObjs.length === 0) return null;
              return (
                <View style={styles.card}>
                  {contactAreas.length > 0 && (
                    <>
                      <Text style={styles.commSectionTitle}>Aree di appartenenza</Text>
                      <View style={styles.badgesRow}>
                        {contactAreas.map((aid, i) => {
                          const info = areaMap[aid] || { name: aid, color: theme.color.muted };
                          return (
                            <View key={`a-${aid}`} style={[styles.areaBadge, { backgroundColor: info.color }]}>
                              {i === 0 && <Ionicons name="star" size={12} color="#FFF" />}
                              <Text style={styles.areaBadgeTxt}>{info.name}</Text>
                            </View>
                          );
                        })}
                      </View>
                    </>
                  )}
                  {contactGroupObjs.length > 0 && (
                    <>
                      <Text style={[styles.commSectionTitle, { marginTop: 12 }]}>Gruppi</Text>
                      <View style={styles.badgesRow}>
                        {contactGroupObjs.map((g) => (
                          <Pressable key={g.group_id} onPress={() => router.push(`/groups/${g.group_id}`)} style={[styles.groupBadge, { borderColor: g.color }]}>
                            <View style={[styles.groupBadgeDot, { backgroundColor: g.color }]} />
                            <Text style={[styles.groupBadgeTxt, { color: g.color }]}>{g.name}</Text>
                          </Pressable>
                        ))}
                      </View>
                    </>
                  )}
                </View>
              );
            })()}

            <View style={styles.card}>
              <Text style={styles.commSectionTitle}>Comunica con {c.first_name}</Text>
              <View style={styles.commGrid}>
                {c.phone ? (
                  <Pressable testID="comm-call" onPress={() => Linking.openURL(`tel:${c.phone.replace(/\s/g, "")}`)} style={[styles.commBtn, { backgroundColor: "#0F766E" }]}>
                    <Ionicons name="call" size={20} color="#FFF" /><Text style={styles.commBtnTxt}>Chiama</Text>
                  </Pressable>
                ) : null}
                {c.phone ? (
                  <Pressable testID="comm-sms" onPress={() => Linking.openURL(`sms:${c.phone.replace(/\s/g, "")}`)} style={[styles.commBtn, { backgroundColor: theme.color.brandSecondary }]}>
                    <Ionicons name="chatbubble-ellipses" size={20} color="#FFF" /><Text style={styles.commBtnTxt}>SMS</Text>
                  </Pressable>
                ) : null}
                {(c.whatsapp || c.phone) ? (
                  <Pressable testID="comm-whatsapp" onPress={() => {
                    const num = (c.whatsapp || c.phone).replace(/[^\d+]/g, "");
                    Linking.openURL(`https://wa.me/${num}`);
                  }} style={[styles.commBtn, { backgroundColor: "#25D366" }]}>
                    <Ionicons name="logo-whatsapp" size={20} color="#FFF" /><Text style={styles.commBtnTxt}>WhatsApp</Text>
                  </Pressable>
                ) : null}
                {c.telegram ? (
                  <Pressable testID="comm-telegram" onPress={() => {
                    const t = c.telegram!.replace(/^@/, "");
                    Linking.openURL(`https://t.me/${t}`);
                  }} style={[styles.commBtn, { backgroundColor: "#0088CC" }]}>
                    <Ionicons name="paper-plane" size={20} color="#FFF" /><Text style={styles.commBtnTxt}>Telegram</Text>
                  </Pressable>
                ) : null}
                {c.email ? (
                  <Pressable testID="comm-email" onPress={() => Linking.openURL(`mailto:${c.email}`)} style={[styles.commBtn, { backgroundColor: "#0F2438" }]}>
                    <Ionicons name="mail" size={20} color="#FFF" /><Text style={styles.commBtnTxt}>Email</Text>
                  </Pressable>
                ) : null}
                {c.linkedin ? (
                  <Pressable testID="comm-linkedin" onPress={() => Linking.openURL(c.linkedin!.startsWith("http") ? c.linkedin! : `https://linkedin.com/${c.linkedin!.replace(/^\//, "")}`)} style={[styles.commBtn, { backgroundColor: "#0A66C2" }]}>
                    <Ionicons name="logo-linkedin" size={20} color="#FFF" /><Text style={styles.commBtnTxt}>LinkedIn</Text>
                  </Pressable>
                ) : null}
                {c.instagram ? (
                  <Pressable testID="comm-instagram" onPress={() => {
                    const u = c.instagram!.replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//, "");
                    Linking.openURL(`https://instagram.com/${u}`);
                  }} style={[styles.commBtn, { backgroundColor: "#E4405F" }]}>
                    <Ionicons name="logo-instagram" size={20} color="#FFF" /><Text style={styles.commBtnTxt}>Instagram</Text>
                  </Pressable>
                ) : null}
                {c.facebook ? (
                  <Pressable testID="comm-facebook" onPress={() => Linking.openURL(c.facebook!.startsWith("http") ? c.facebook! : `https://facebook.com/${c.facebook!}`)} style={[styles.commBtn, { backgroundColor: "#1877F2" }]}>
                    <Ionicons name="logo-facebook" size={20} color="#FFF" /><Text style={styles.commBtnTxt}>Facebook</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>

            <View style={styles.card}>
            {c.tags && c.tags.length > 0 && (
              <View style={styles.tagsWrap}>
                {c.tags.map((t) => (
                  <View key={t} style={styles.tagChip}><Text style={styles.tagChipTxt}>{t}</Text></View>
                ))}
              </View>
            )}
            <InfoRow icon="call-outline" label="Telefono principale" value={c.phone || "—"} />
            {c.phone_alt ? <InfoRow icon="call-outline" label="Telefono 2°" value={c.phone_alt} /> : null}
            {c.whatsapp ? <InfoRow icon="logo-whatsapp" label="WhatsApp" value={c.whatsapp} /> : null}
            <InfoRow icon="mail-outline" label="Email principale" value={c.email || "—"} />
            {c.email_alt ? <InfoRow icon="mail-outline" label="Email 2°" value={c.email_alt} /> : null}
            {(c.address_street || c.address_city) ? (
              <View>
                <InfoRow icon="location-outline" label="Indirizzo"
                  value={[c.address_street, [c.address_zip, c.address_city].filter(Boolean).join(" "), c.address_province].filter(Boolean).join(", ")} />
                <Pressable
                  testID="address-waze-btn"
                  onPress={() => {
                    const addr = [c.address_street, c.address_city, c.address_province].filter(Boolean).join(", ");
                    if (addr) Linking.openURL(`https://www.waze.com/ul?q=${encodeURIComponent(addr)}&navigate=yes`);
                  }}
                  style={styles.wazeInline}
                >
                  <Ionicons name="navigate" size={14} color="#FFF" />
                  <Text style={styles.wazeInlineTxt}>Naviga con Waze</Text>
                </Pressable>
              </View>
            ) : (c.address ? (
              <View>
                <InfoRow icon="location-outline" label="Indirizzo" value={c.address} />
                <Pressable testID="address-waze-btn" onPress={() => Linking.openURL(`https://www.waze.com/ul?q=${encodeURIComponent(c.address)}&navigate=yes`)} style={styles.wazeInline}>
                  <Ionicons name="navigate" size={14} color="#FFF" />
                  <Text style={styles.wazeInlineTxt}>Naviga con Waze</Text>
                </Pressable>
              </View>
            ) : null)}
            {c.birth_date ? <InfoRow icon="gift-outline" label="Data di nascita" value={c.birth_date} /> : null}
            {c.fiscal_code ? <InfoRow icon="card-outline" label="Codice Fiscale" value={c.fiscal_code} /> : null}
            {c.vat_number ? <InfoRow icon="business-outline" label="Partita IVA" value={c.vat_number} /> : null}
            {c.website ? <InfoRow icon="globe-outline" label="Sito web" value={c.website} /> : null}
            {c.linkedin ? <InfoRow icon="logo-linkedin" label="LinkedIn" value={c.linkedin} /> : null}
            {c.instagram ? <InfoRow icon="logo-instagram" label="Instagram" value={c.instagram} /> : null}
            {c.facebook ? <InfoRow icon="logo-facebook" label="Facebook" value={c.facebook} /> : null}
            {c.referral_note ? <InfoRow icon="star-outline" label="Nota referenza" value={c.referral_note} /> : null}
            {c.email_note ? <InfoRow icon="chatbox-outline" label="Nota email" value={c.email_note} /> : null}
            {c.general_note ? <InfoRow icon="document-text-outline" label="Note generali" value={c.general_note} /> : null}
          </View>
          </>
        )}

        {tab === "notes" && (
          <>
            <View style={styles.card}>
              <Text style={styles.categoryTitle}>Categoria della nota</Text>
              <View style={styles.categoryRow}>
                {[
                  { k: null, label: "Nota semplice", color: theme.color.brandPrimary, icon: "document-text" },
                  { k: "general", label: "Note generali", color: "#2D7A5A", icon: "list" },
                  { k: "email", label: "Nota email condivisibile", color: "#0F2438", icon: "mail" },
                  { k: "referral", label: "Referenza", color: "#B77C14", icon: "people" },
                ].map((c: any) => {
                  const on = activeCategory === c.k;
                  return (
                    <Pressable
                      key={String(c.k)}
                      testID={`note-cat-${c.k ?? "all"}`}
                      onPress={() => setActiveCategory(c.k)}
                      style={[styles.catChip, { flexDirection: "row", alignItems: "center" }, on && { backgroundColor: c.color, borderColor: c.color }]}
                    >
                      <Ionicons name={c.icon} size={12} color={on ? "#FFF" : c.color} style={{ marginRight: 4 }} />
                      <Text style={[styles.catChipTxt, { color: on ? "#FFF" : c.color }]}>{c.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.catHint}>
                {activeCategory === "general" ? "Le note salvate qui sono organizzate come Note generali." :
                 activeCategory === "email" ? "Queste note vengono incluse quando condividi la scheda via email." :
                 activeCategory === "referral" ? "Note relative a chi ti ha segnalato il contatto." :
                 "Aggiungi rapidamente una nota. Puoi cambiare categoria in qualsiasi momento."}
              </Text>
              <TextInput
                testID="note-text-input"
                value={noteText}
                onChangeText={setNoteText}
                placeholder={showLinkInput ? "Etichetta del link (opzionale)" : "Scrivi una nota..."}
                placeholderTextColor="#94A3B8"
                style={[styles.input, { minHeight: showLinkInput ? 44 : 80, textAlignVertical: "top" }]}
                multiline={!showLinkInput}
              />
              {showLinkInput && (
                <TextInput
                  testID="note-link-input"
                  value={linkUrl}
                  onChangeText={setLinkUrl}
                  placeholder="https://..."
                  placeholderTextColor="#94A3B8"
                  autoCapitalize="none"
                  keyboardType="url"
                  style={[styles.input, { marginTop: 8 }]}
                />
              )}
              <View style={styles.noteBtnRow}>
                {!showLinkInput && (
                  <Pressable testID="note-add-text" onPress={addTextNote} style={styles.smallBtn} disabled={busy}>
                    <Ionicons name="document-text" size={16} color="#FFF" /><Text style={styles.smallBtnTxt}>Testo</Text>
                  </Pressable>
                )}
                {showLinkInput ? (
                  <Pressable testID="note-add-link" onPress={addLinkNote} style={[styles.smallBtn, { backgroundColor: theme.color.success }]}>
                    <Ionicons name="checkmark" size={16} color="#FFF" /><Text style={styles.smallBtnTxt}>Salva link</Text>
                  </Pressable>
                ) : (
                  <Pressable testID="note-toggle-link" onPress={() => setShowLinkInput(true)} style={[styles.smallBtn, { backgroundColor: theme.color.info }]}>
                    <Ionicons name="link" size={16} color="#FFF" /><Text style={styles.smallBtnTxt}>Link/Video</Text>
                  </Pressable>
                )}
                <Pressable testID="note-photo-camera" onPress={() => addPhotoNote(true)} style={[styles.smallBtn, { backgroundColor: theme.color.brandSecondary }]}>
                  <Ionicons name="camera" size={16} color="#FFF" /><Text style={styles.smallBtnTxt}>Scatta foto</Text>
                </Pressable>
                <Pressable testID="note-photo-gallery" onPress={() => addPhotoNote(false)} style={[styles.smallBtn, { backgroundColor: "#8B5CF6" }]}>
                  <Ionicons name="image" size={16} color="#FFF" /><Text style={styles.smallBtnTxt}>Importa foto</Text>
                </Pressable>
                <Pressable testID="note-video-camera" onPress={() => addVideoNote(true)} style={[styles.smallBtn, { backgroundColor: "#DB2777" }]}>
                  <Ionicons name="videocam" size={16} color="#FFF" /><Text style={styles.smallBtnTxt}>Registra video</Text>
                </Pressable>
                <Pressable testID="note-video-gallery" onPress={() => addVideoNote(false)} style={[styles.smallBtn, { backgroundColor: "#7C3AED" }]}>
                  <Ionicons name="film" size={16} color="#FFF" /><Text style={styles.smallBtnTxt}>Importa video</Text>
                </Pressable>
                <Pressable testID="note-attach-file" onPress={addFileNote} style={[styles.smallBtn, { backgroundColor: "#0891B2" }]}>
                  <Ionicons name="attach" size={16} color="#FFF" /><Text style={styles.smallBtnTxt}>Allega file</Text>
                </Pressable>
                <Pressable testID="note-record-toggle" onPress={recording ? stopRecording : startRecording} style={[styles.smallBtn, { backgroundColor: recording ? theme.color.error : theme.color.warning }]}>
                  <Ionicons name={recording ? "stop" : "mic"} size={16} color="#FFF" /><Text style={styles.smallBtnTxt}>{recording ? "Stop" : "Registra audio"}</Text>
                </Pressable>
              </View>
            </View>
            {c.notes && c.notes.length > 0 ? c.notes.map((n) => (
              <View key={n.id} style={styles.noteCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.noteMeta}>
                    {n.kind === "audio" ? "Vocale" : n.kind === "photo" ? "Foto" : n.kind === "video" ? "Video" : n.kind === "file" ? "File" : n.kind === "link" ? "Link" : "Testo"}
                    {n.category ? ` · ${n.category === "general" ? "🗂️ Generali" : n.category === "email" ? "📧 Email" : "👥 Referenza"}` : ""}
                    {" · "}{new Date(n.created_at).toLocaleString("it-IT")}
                  </Text>
                  {n.kind === "text" && <Text style={styles.noteTxt}>{n.text}</Text>}
                  {n.kind === "audio" && (
                    <Pressable testID={`play-${n.id}`} onPress={() => playNote(n)} style={styles.playBtn}>
                      <Ionicons name="play" size={16} color={theme.color.brandPrimary} />
                      <Text style={styles.playBtnTxt}>Ascolta</Text>
                    </Pressable>
                  )}
                  {n.kind === "photo" && n.photo_base64 && (
                    <Image source={{ uri: n.photo_base64 }} style={styles.notePhoto} />
                  )}
                  {n.kind === "video" && n.video_base64 && (
                    <View style={styles.videoWrap}>
                      {Platform.OS === "web" ? (
                        // @ts-expect-error web element
                        <video src={n.video_base64} controls style={{ width: 240, height: 180, borderRadius: 10, backgroundColor: "#000" }} />
                      ) : (
                        <Pressable onPress={async () => {
                          const uri = n.video_base64!;
                          const b64 = uri.includes(",") ? uri.split(",")[1] : uri;
                          const path = `${FileSystem.cacheDirectory}video-${n.id}.mp4`;
                          try {
                            await FileSystem.writeAsStringAsync(path, b64, { encoding: FileSystem.EncodingType.Base64 });
                            await Linking.openURL(path);
                          } catch (e) { console.warn(e); }
                        }} style={styles.videoPlaceholder}>
                          <Ionicons name="play-circle" size={48} color="#FFF" />
                          <Text style={{ color: "#FFF", fontWeight: "700", marginTop: 4 }}>Riproduci video</Text>
                        </Pressable>
                      )}
                    </View>
                  )}
                  {n.kind === "link" && n.link_url && (
                    <Pressable onPress={() => Linking.openURL(n.link_url!)} style={styles.linkBox}>
                      <Ionicons name="link" size={16} color={theme.color.brandPrimary} />
                      <Text style={styles.linkTxt} numberOfLines={2}>{n.link_title || n.link_url}</Text>
                    </Pressable>
                  )}
                  {n.kind === "file" && n.file_base64 && (
                    <Pressable
                      onPress={async () => {
                        try {
                          if (Platform.OS === "web") {
                            const uri = `data:${n.file_mime};base64,${n.file_base64}`;
                            const a = document.createElement("a");
                            a.href = uri; a.download = n.file_name || "file"; document.body.appendChild(a); a.click(); a.remove();
                            return;
                          }
                          const path = `${FileSystem.cacheDirectory}${n.file_name || "file"}`;
                          await FileSystem.writeAsStringAsync(path, n.file_base64!, { encoding: FileSystem.EncodingType.Base64 });
                          await Linking.openURL(path);
                        } catch (e) { console.warn(e); }
                      }}
                      style={styles.linkBox}
                    >
                      <Ionicons name={n.file_mime?.includes("pdf") ? "document-text" : "document"} size={20} color={theme.color.brandPrimary} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.linkTxt} numberOfLines={1}>{n.file_name || "File"}</Text>
                        <Text style={{ fontSize: 11, color: theme.color.muted }}>{Math.round((n.file_size || 0) / 1024)} KB</Text>
                      </View>
                    </Pressable>
                  )}
                </View>
                <Pressable testID={`share-note-${n.id}`} onPress={() => shareNote(n)} style={{ marginRight: 6 }}><Ionicons name="share-social-outline" size={18} color={theme.color.brandPrimary} /></Pressable>
                <Pressable testID={`del-note-${n.id}`} onPress={() => deleteNote(n.id)}><Ionicons name="trash-outline" size={18} color={theme.color.error} /></Pressable>
              </View>
            )) : <Text style={styles.emptyTxt}>Nessuna nota</Text>}
          </>
        )}

        {tab === "files" && (
          <>
            <Pressable testID="file-add-btn" onPress={pickFile} style={styles.addFileBtn} disabled={busy}>
              <Ionicons name="cloud-upload-outline" size={20} color={theme.color.brandPrimary} />
              <Text style={styles.addFileTxt}>Carica PDF o immagine</Text>
            </Pressable>
            {c.files && c.files.length > 0 ? c.files.map((f) => (
              <View key={f.id} style={styles.fileCard}>
                <Ionicons name={f.mime.startsWith("image/") ? "image-outline" : "document-outline"} size={22} color={theme.color.brandPrimary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.fileName} numberOfLines={1}>{f.name}</Text>
                  <Text style={styles.fileMeta}>{Math.round((f.size || 0) / 1024)} KB · {new Date(f.created_at).toLocaleDateString("it-IT")}</Text>
                </View>
                <Pressable testID={`share-file-${f.id}`} onPress={() => shareFile(f)} style={{ marginRight: 6 }}><Ionicons name="share-social-outline" size={18} color={theme.color.brandPrimary} /></Pressable>
                <Pressable testID={`del-file-${f.id}`} onPress={() => deleteFile(f.id)}><Ionicons name="trash-outline" size={18} color={theme.color.error} /></Pressable>
              </View>
            )) : <Text style={styles.emptyTxt}>Nessun file</Text>}
          </>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function QuickAct({ icon, label, onPress, testID }: any) {
  return (
    <Pressable onPress={onPress} testID={testID} style={styles.quickAct}>
      <Ionicons name={icon} size={18} color="#FFF" />
      <Text style={styles.quickActTxt}>{label}</Text>
    </Pressable>
  );
}

function InfoRow({ icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={18} color={theme.color.brandPrimary} />
      <View style={{ flex: 1 }}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 10 },
  hero: { padding: 20, paddingTop: 4, alignItems: "center" },
  avatarWrap: { position: "relative", marginBottom: 10 },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: "rgba(255,255,255,0.25)", alignItems: "center", justifyContent: "center" },
  avatarImg: { width: 72, height: 72, borderRadius: 36 },
  avatarBadge: { position: "absolute", right: -2, bottom: -2, width: 24, height: 24, borderRadius: 12, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#FFF" },
  avatarTxt: { color: "#FFF", fontSize: 26, fontWeight: "700" },
  name: { color: "#FFF", fontSize: 22, fontWeight: "700" },
  areaTag: { color: "rgba(255,255,255,0.85)", marginTop: 4, fontSize: 12 },
  actionsRow: { flexDirection: "row", gap: 10, marginTop: 14, flexWrap: "wrap", justifyContent: "center" },
  quickAct: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.2)", paddingHorizontal: 12, paddingVertical: 8, borderRadius: theme.radius.pill },
  quickActTxt: { color: "#FFF", fontWeight: "600", fontSize: 12 },
  tabs: { flexDirection: "row", backgroundColor: "#FFF", borderBottomWidth: 1, borderBottomColor: theme.color.border },
  tab: { flex: 1, paddingVertical: 12, alignItems: "center" },
  tabActive: { borderBottomWidth: 2, borderBottomColor: theme.color.brandPrimary },
  tabTxt: { fontWeight: "600", color: theme.color.muted },
  tabTxtActive: { color: theme.color.brandPrimary },
  card: { backgroundColor: "#FFF", borderRadius: theme.radius.md, padding: 14, borderWidth: 1, borderColor: theme.color.border, gap: 12 },
  infoRow: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  infoLabel: { fontSize: 11, color: theme.color.muted, textTransform: "uppercase", fontWeight: "700" },
  infoValue: { fontSize: 15, color: theme.color.onSurface, marginTop: 2 },
  input: { backgroundColor: theme.color.surface, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border, padding: 10, color: theme.color.onSurface },
  noteBtnRow: { flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap" },
  smallBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: theme.color.brandPrimary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: theme.radius.pill },
  smallBtnTxt: { color: "#FFF", fontWeight: "700", fontSize: 13 },
  noteCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#FFF", borderRadius: theme.radius.md, padding: 12, borderWidth: 1, borderColor: theme.color.border, marginTop: 8 },
  noteMeta: { fontSize: 11, color: theme.color.muted, marginBottom: 4 },
  noteTxt: { fontSize: 14, color: theme.color.onSurface },
  playBtn: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", backgroundColor: theme.color.brandTertiary, paddingHorizontal: 12, paddingVertical: 6, borderRadius: theme.radius.pill },
  playBtnTxt: { color: theme.color.brandPrimary, fontWeight: "700", fontSize: 12 },
  addFileBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#FFF", padding: 14, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.brandPrimary, borderStyle: "dashed" },
  addFileTxt: { color: theme.color.brandPrimary, fontWeight: "700" },
  fileCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#FFF", borderRadius: theme.radius.md, padding: 12, borderWidth: 1, borderColor: theme.color.border, marginTop: 8 },
  fileName: { fontSize: 14, fontWeight: "600", color: theme.color.onSurface },
  fileMeta: { fontSize: 11, color: theme.color.muted, marginTop: 2 },
  emptyTxt: { textAlign: "center", color: theme.color.muted, marginTop: 20 },
  tagChip: { backgroundColor: theme.color.brandTertiary, paddingHorizontal: 10, paddingVertical: 4, borderRadius: theme.radius.pill },
  tagChipTxt: { color: theme.color.brandPrimary, fontWeight: "700", fontSize: 11 },
  tagsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 },
  notePhoto: { width: "100%", height: 180, borderRadius: theme.radius.md, marginTop: 6 },
  linkBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: theme.color.brandTertiary, padding: 10, borderRadius: theme.radius.md, marginTop: 6 },
  linkTxt: { color: theme.color.brandPrimary, fontWeight: "600", flex: 1 },
  wazeInline: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: theme.color.brandPrimary, alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 6, borderRadius: theme.radius.pill, marginTop: 6, marginLeft: 30 },
  wazeInlineTxt: { color: "#FFF", fontWeight: "700", fontSize: 12 },
  commSectionTitle: { fontSize: 13, fontWeight: "700", color: theme.color.brandPrimary, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 },
  badgesRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  areaBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: theme.radius.pill },
  areaBadgeTxt: { color: "#FFF", fontWeight: "700", fontSize: 12 },
  groupBadge: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: theme.radius.pill, borderWidth: 1.5, backgroundColor: "#FFF" },
  groupBadgeDot: { width: 8, height: 8, borderRadius: 4 },
  groupBadgeTxt: { fontWeight: "700", fontSize: 12 },
  videoWrap: { marginTop: 6 },
  videoPlaceholder: { width: 240, height: 180, borderRadius: 10, backgroundColor: "#0F172A", alignItems: "center", justifyContent: "center" },
  categoryTitle: { fontSize: 11, fontWeight: "700", color: theme.color.onSurfaceTertiary, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },
  categoryRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  catChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: theme.radius.pill, backgroundColor: "#FFF", borderWidth: 1, borderColor: theme.color.border },
  catChipTxt: { fontWeight: "700", fontSize: 11 },
  catHint: { color: theme.color.muted, fontSize: 11, marginTop: 8, marginBottom: 4, fontStyle: "italic" },
  commGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  commBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 10, borderRadius: theme.radius.md, minWidth: 108, flexGrow: 1, justifyContent: "center" },
  commBtnTxt: { color: "#FFF", fontWeight: "700", fontSize: 12 },
});

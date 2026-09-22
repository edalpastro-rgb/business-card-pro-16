// V50.z311 — Bolle messaggio, pannello conversazione hands-free e indicatore "sta scrivendo"
// (estratti da AssistantChat.tsx, nessuna modifica logica).
import React, { useEffect, useRef } from "react";
import { View, Text, Pressable, Animated, Easing } from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useAuth } from "@/src/auth";
import { ChatTableExport, parseMessageSegments } from "@/src/ChatTableExport";
import { ChatChartExport } from "@/src/ChatChartExport";
import { NavChips, extractNavChips } from "@/src/NavChips";
import { SaveToAxonPrompt } from "@/src/SaveToAxonPrompt";
import { copyText, shareText, exportConversationPdf } from "@/src/utils/chatExport";
import { ModuleErrorBoundary } from "@/src/shared/ModuleErrorBoundary";
import { styles, ASSISTANT_COLOR, ASSISTANT_COLOR_DARK } from "@/src/assistant/chatStyles";
import type { ChatMsg } from "@/src/assistant/chatTypes";

export type ConvPhase = "idle" | "listening" | "transcribing" | "thinking" | "speaking";

export function ConversationPanel({
  phase,
  muted,
  onToggleMute,
  onStopListening,
  onEnd,
  assistantName,
}: {
  phase: ConvPhase;
  muted: boolean;
  onToggleMute: () => void;
  onStopListening?: () => void;
  onEnd: () => void;
  assistantName: string;
}) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    // Pulse only when actively engaged (not idle-muted)
    if (muted) { pulse.setValue(0); return; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true, easing: Easing.out(Easing.ease) }),
        Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true, easing: Easing.in(Easing.ease) }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [muted, pulse]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] });

  let color = "#8B5CF6"; // idle / speaking
  let icon: keyof typeof Ionicons.glyphMap = "mic";
  let label = "In ascolto…";
  let subLabel = "Parla pure, ti sto ascoltando";
  if (muted) {
    color = "#6B7280"; icon = "mic-off"; label = "Microfono muto"; subLabel = "Tocca il microfono per riprendere";
  } else if (phase === "transcribing") {
    color = "#F59E0B"; icon = "cloud-upload"; label = "Ti sto capendo…"; subLabel = "Sto trascrivendo";
  } else if (phase === "thinking") {
    color = "#8B5CF6"; icon = "sparkles"; label = `${assistantName} sta pensando…`; subLabel = "Attendi la risposta";
  } else if (phase === "speaking") {
    color = "#22C55E"; icon = "volume-high"; label = `${assistantName} sta parlando…`; subLabel = "Ti risponde ora";
  } else if (phase === "listening") {
    color = "#DC2626"; icon = "mic"; label = "In ascolto…"; subLabel = "Parla pure, ti sto ascoltando";
  } else {
    color = "#8B5CF6"; icon = "hourglass"; label = "Pausa"; subLabel = "Un attimo…";
  }

  return (
    <View style={styles.convPanel} testID="assistant-conv-panel">
      <View style={styles.convVisual}>
        <Animated.View
          style={[
            styles.convOrb,
            { backgroundColor: color, transform: [{ scale }], opacity },
          ]}
        >
          <Ionicons name={icon} size={34} color="#FFF" />
        </Animated.View>
      </View>
      <Text style={styles.convLabel}>{label}</Text>
      <Text style={styles.convSubLabel}>{subLabel}</Text>
      <View style={styles.convBtnRow}>
        {phase === "listening" && onStopListening && (
          <Pressable
            onPress={onStopListening}
            style={[styles.convBtn, { backgroundColor: "#111827" }]}
            testID="assistant-conv-stop-listening"
            accessibilityLabel="Ferma la registrazione e invia"
          >
            <Ionicons name="stop-circle" size={22} color="#FFF" />
            <Text style={[styles.convBtnTxt, { color: "#FFF" }]}>Stop · invia</Text>
          </Pressable>
        )}
        <Pressable
          onPress={onToggleMute}
          style={[styles.convBtn, { backgroundColor: muted ? "#DC2626" : "#F1F0FF" }]}
          testID="assistant-conv-mute"
          accessibilityLabel={muted ? "Riattiva microfono" : "Silenzia microfono"}
        >
          <Ionicons name={muted ? "mic-off" : "mic"} size={22} color={muted ? "#FFF" : ASSISTANT_COLOR_DARK} />
          <Text style={[styles.convBtnTxt, muted && { color: "#FFF" }]}>{muted ? "Riprendi" : "Muto"}</Text>
        </Pressable>
        <Pressable
          onPress={onEnd}
          style={[styles.convBtn, { backgroundColor: "#EF4444" }]}
          testID="assistant-conv-end"
          accessibilityLabel="Termina conversazione"
        >
          <Ionicons name="call" size={22} color="#FFF" style={{ transform: [{ rotate: "135deg" }] }} />
          <Text style={[styles.convBtnTxt, { color: "#FFF" }]}>Termina</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function MessageBubble({
  msg,
  assistantName,
  onPlay,
  isPlaying,
  paused,
  onTogglePause,
  onSaveToMaster,
  isMaster,
  onFeedback,
  onConfigureArea,
  onNavigate,
  onAction,
}: {
  msg: ChatMsg;
  assistantName: string;
  onPlay?: () => void;
  isPlaying?: boolean;
  paused?: boolean;
  onTogglePause?: () => void;
  onSaveToMaster?: () => void;
  isMaster?: boolean;
  onFeedback?: (rating: "up" | "down") => void;
  onConfigureArea?: (areaKey: string) => void; // V50.z227
  onNavigate?: (route: string) => void; // V50.z259
  onAction?: (action: string, payload: Record<string, any>) => Promise<void> | void; // V50.z259
}) {
  const isUser = msg.role === "user";
  const { user: authUser } = useAuth(); // V50.z289 — nome consulente per l’intestazione dei PDF
  return (
    <View style={[styles.bubbleRow, { justifyContent: isUser ? "flex-end" : "flex-start" }]}>
      {!isUser && (
        <View style={styles.bubbleAvatar}>
          <MaterialCommunityIcons name="robot-happy" size={14} color="#FFF" />
        </View>
      )}
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAsst]}>
        {!isUser && (
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={styles.bubbleWho}>{assistantName}</Text>
              {msg.used_web_search && (
                <View style={styles.webBadge}>
                  <Ionicons name="globe" size={10} color="#0EA5E9" />
                  <Text style={styles.webBadgeTxt}>web</Text>
                </View>
              )}
              {msg.from_cache && (
                <View style={styles.cacheBadge} testID="msg-cache-badge">
                  <Ionicons name="flash" size={10} color="#B45309" />
                  <Text style={styles.cacheBadgeTxt}>istantanea</Text>
                </View>
              )}
              {msg.streaming && (
                <View style={styles.streamBadge}>
                  <Ionicons name="ellipsis-horizontal" size={10} color="#6D28D9" />
                </View>
              )}
            </View>
            {onPlay && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                {/* V38T — Prominent pause/resume button while this reply is playing */}
                {isPlaying && onTogglePause && (
                  <Pressable
                    onPress={onTogglePause}
                    hitSlop={8}
                    accessibilityLabel={paused ? "Riprendi" : "Pausa"}
                    testID="msg-pause-btn"
                    style={{ padding: 2 }}
                  >
                    <Ionicons name={paused ? "play" : "pause"} size={20} color="#DC2626" />
                  </Pressable>
                )}
                <Pressable
                  onPress={onPlay}
                  hitSlop={8}
                  accessibilityLabel="Ascolta risposta"
                  testID="msg-play-btn"
                  style={{ padding: 2 }}
                >
                  <Ionicons
                    name={isPlaying ? "volume-high" : "play-circle"}
                    size={18}
                    color={isPlaying ? "#DC2626" : ASSISTANT_COLOR_DARK}
                  />
                </Pressable>
              </View>
            )}
          </View>
        )}
        {/* V28.p — Rende il contenuto in segmenti: testo normale + tabelle markdown con Export */}
        {(() => {
          if (isUser) {
            // V29.n — Se il messaggio viene da un'azione rapida, mostra solo l'etichetta compatta
            // (es. "PUN MEDIO PER FASCE") invece del prompt completo della regola.
            if (msg.quick_label) {
              return (
                <View style={styles.quickActionPill}>
                  <Ionicons name="sparkles" size={12} color="#FFF" />
                  <Text style={styles.quickActionPillTxt} numberOfLines={2}>
                    {msg.quick_label}
                  </Text>
                </View>
              );
            }
            // Utente normale: testo semplice
            return <Text style={[styles.bubbleText, { color: "#FFF" }]}>{msg.content}</Text>;
          }
          // V50.z121 — Il parser tabelle/grafici non deve mai far crashare la chat
          let segments: ReturnType<typeof parseMessageSegments>;
          // V50.z227 — marker [[CONFIGURA:<area>]] → bottone «Configura ora» (area attiva ma non configurata)
          const cfgMatch = /\[\[CONFIGURA:([a-z0-9_]+)\]\]/i.exec(msg.content || "");
          const cleanContent0 = cfgMatch ? (msg.content || "").replace(cfgMatch[0], "").trimEnd() : (msg.content || "");
          // V50.z259 — marker [[NAV:route|label]] / [[ACTION:id|label|json]] → pulsanti deep link (nascosti finché lo stream non è completo)
          const { clean: cleanContent, chips: navChips0 } = extractNavChips(cleanContent0);
          const navChips = msg.streaming ? [] : navChips0;
          try { segments = parseMessageSegments(cleanContent); }
          catch { segments = [{ type: "text", content: cleanContent }] as any; }
          if (segments.length === 0 && !cfgMatch && navChips.length === 0) return null;
          return (
            <View style={{ gap: 6 }}>
              {segments.map((seg, si) => {
                if (seg.type === "text") {
                  return <Text key={`s-${si}`} style={styles.bubbleText}>{seg.content}</Text>;
                }
                if (seg.type === "chart") {
                  // V50.z109 — Grafico Axon con pulsante espandi-a-tutto-schermo in-app
                  // V50.z121 — Error boundary: un grafico non renderizzabile NON deve
                  // mai lasciare la chat bianca (fallback: tabella/testo).
                  return (
                    <ModuleErrorBoundary key={`s-${si}`} moduleName="grafico" fallback={() => <Text style={styles.bubbleText}>{seg.chart?.title ? `📊 ${seg.chart.title}` : "📊 Grafico non disponibile su questo dispositivo"}</Text>}>
                      <ChatChartExport spec={seg.chart} assistantColor={ASSISTANT_COLOR_DARK} />
                    </ModuleErrorBoundary>
                  );
                }
                return (
                  <ModuleErrorBoundary key={`s-${si}`} moduleName="tabella" fallback={() => <Text style={styles.bubbleText}>{(seg.table?.rows || []).map((r: any) => (Array.isArray(r) ? r.join(" | ") : String(r))).join("\n")}</Text>}>
                    <ChatTableExport table={seg.table} assistantColor={ASSISTANT_COLOR} />
                  </ModuleErrorBoundary>
                );
              })}
              {cfgMatch && !msg.streaming && (
                <Pressable onPress={() => onConfigureArea?.(cfgMatch[1])} style={styles.configureNowBtn} testID={`configure-now-${cfgMatch[1]}`}>
                  <Ionicons name="flash" size={14} color="#FFF" />
                  <Text style={styles.configureNowTxt}>Configura ora</Text>
                </Pressable>
              )}
              {navChips.length > 0 && onNavigate && (
                <NavChips chips={navChips} onNavigate={onNavigate} onAction={(a, p) => onAction?.(a, p)} />
              )}
            </View>
          );
        })()}
        {/* V38T — Save-to-Master button on responses that used web search */}
        {!isUser && onSaveToMaster && (
          <Pressable
            onPress={onSaveToMaster}
            testID="msg-save-master-btn"
            style={styles.saveMasterBtn}
          >
            <Ionicons name="save" size={14} color="#16A34A" />
            <Text style={styles.saveMasterTxt}>Salva nei file Master</Text>
          </Pressable>
        )}
        {/* Web sources footer */}
        {!isUser && msg.web_sources && msg.web_sources.length > 0 && (
          <View style={{ marginTop: 6, gap: 2 }}>
            <Text style={styles.sourcesLbl}>Fonti:</Text>
            {msg.web_sources.slice(0, 3).map((s, k) => (
              <Text key={k} style={styles.sourceTxt} numberOfLines={1}>• {s.title || s.url}</Text>
            ))}
          </View>
        )}
        {/* V29.ag — Footer "Dati aggiornati al: ..." per messaggi da azioni rapide con cache server-side */}
        {!isUser && msg.qa_updated_at && (
          <View style={styles.qaUpdatedRow}>
            <Ionicons name={msg.qa_from_cache ? "flash" : "cloud-download"} size={11} color="#16A34A" />
            <Text style={styles.qaUpdatedTxt}>
              {msg.qa_from_cache ? "Dati aggiornati al: " : "Nuovo aggiornamento: "}
              {(() => {
                try {
                  const d = new Date(msg.qa_updated_at);
                  return d.toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" }) +
                    " · " + d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
                } catch {
                  return msg.qa_updated_at || "";
                }
              })()}
            </Text>
          </View>
        )}
        {/* V28.y — Prompt discreto "Salva come regola" / "Aggiungi fonte" — solo Master */}
        {!isUser && (
          <SaveToAxonPrompt content={msg.content} assistantColor={ASSISTANT_COLOR_DARK} isMaster={!!isMaster} />
        )}
        {/* V50.z160 — Azioni messaggio: Copia · Condividi · PDF (il testo non è
            selezionabile su Android nel Modal → serve un'azione esplicita). */}
        {!msg.streaming && !!(msg.content || "").trim() && (
          <View style={[styles.msgActionsRow, isUser && { justifyContent: "flex-end" }]} testID="msg-actions">
            <Pressable
              onPress={async () => { await copyText(msg.content); }}
              hitSlop={8}
              accessibilityLabel="Copia messaggio"
              testID="msg-copy-btn"
              style={[styles.msgActionBtn, isUser && styles.msgActionBtnUser]}
            >
              <Ionicons name="copy-outline" size={15} color={isUser ? "#EDE9FE" : "#475569"} />
              <Text style={[styles.msgActionTxt, isUser && { color: "#EDE9FE" }]}>Copia</Text>
            </Pressable>
            <Pressable
              // V50.z289 — se il messaggio contiene una tabella, la condivisione usa il PDF con la stessa maschera della chat (non il markdown grezzo)
              onPress={() => (parseMessageSegments(msg.content || "").some((sg) => sg.type === "table") ? exportConversationPdf([msg], assistantName, authUser?.name || undefined) : shareText(msg.content, `${assistantName} · AdvisorOS`))}
              hitSlop={8}
              accessibilityLabel="Condividi messaggio"
              testID="msg-share-btn"
              style={[styles.msgActionBtn, isUser && styles.msgActionBtnUser]}
            >
              <Ionicons name="share-social-outline" size={15} color={isUser ? "#EDE9FE" : "#475569"} />
              <Text style={[styles.msgActionTxt, isUser && { color: "#EDE9FE" }]}>Condividi</Text>
            </Pressable>
            {!isUser && (
              <Pressable
                onPress={() => exportConversationPdf([msg], assistantName, authUser?.name || undefined)}
                hitSlop={8}
                accessibilityLabel="Esporta messaggio in PDF"
                testID="msg-pdf-btn"
                style={styles.msgActionBtn}
              >
                <Ionicons name="document-text-outline" size={15} color="#475569" />
                <Text style={styles.msgActionTxt}>PDF</Text>
              </Pressable>
            )}
          </View>
        )}
        {/* V41 — Feedback 👍/👎 (solo su risposte assistant completate, con message_id) */}
        {!isUser && !msg.streaming && msg.message_id && onFeedback && (
          <View style={styles.feedbackRow}>
            <Text style={styles.feedbackLbl}>Utile?</Text>
            <Pressable
              onPress={() => onFeedback("up")}
              hitSlop={8}
              accessibilityLabel="Utile"
              testID="msg-feedback-up"
              style={[
                styles.feedbackBtn,
                msg.feedback_rating === "up" && styles.feedbackBtnUp,
              ]}
            >
              <Ionicons
                name={msg.feedback_rating === "up" ? "thumbs-up" : "thumbs-up-outline"}
                size={14}
                color={msg.feedback_rating === "up" ? "#16A34A" : "#64748B"}
              />
            </Pressable>
            <Pressable
              onPress={() => onFeedback("down")}
              hitSlop={8}
              accessibilityLabel="Non utile"
              testID="msg-feedback-down"
              style={[
                styles.feedbackBtn,
                msg.feedback_rating === "down" && styles.feedbackBtnDown,
              ]}
            >
              <Ionicons
                name={msg.feedback_rating === "down" ? "thumbs-down" : "thumbs-down-outline"}
                size={14}
                color={msg.feedback_rating === "down" ? "#DC2626" : "#64748B"}
              />
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

export function TypingDots() {
  const a1 = useRef(new Animated.Value(0)).current;
  const a2 = useRef(new Animated.Value(0)).current;
  const a3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const mkAnim = (val: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(val, { toValue: 1, duration: 300, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
          Animated.timing(val, { toValue: 0, duration: 300, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        ])
      );
    const loops = [mkAnim(a1, 0), mkAnim(a2, 150), mkAnim(a3, 300)];
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [a1, a2, a3]);

  const dot = (v: Animated.Value) => (
    <Animated.View
      style={[
        styles.dot,
        {
          opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }),
          transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -3] }) }],
        },
      ]}
    />
  );

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 3, marginRight: 8 }}>
      {dot(a1)}
      {dot(a2)}
      {dot(a3)}
    </View>
  );
}

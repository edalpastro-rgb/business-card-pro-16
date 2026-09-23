/**
 * V29.al — Global Error Boundary
 *
 * Cattura CRASH JS all'avvio (o in qualsiasi momento) e mostra una schermata
 * diagnostica in italiano invece di far chiudere l'app. Serve soprattutto in
 * build APK/nativa dove l'utente non ha modo di leggere il crash: qui può
 * copiarlo con un tap e inviarcelo.
 *
 * Cosa cattura:
 *  1. Errori di rendering React (via componentDidCatch)
 *  2. Errori JS non gestiti (via ErrorUtils.setGlobalHandler)
 *  3. Unhandled promise rejections (via HermesInternal / tracking module)
 *
 * NON è un sostituto della Play Console — cattura solo errori JS.
 * I crash NATIVI (linking, JNI, native module) NON vengono qui: per quelli
 * serve logcat.
 */
import React from "react";
import { View, Text, ScrollView, Pressable, StyleSheet, Platform, Alert } from "react-native";
import * as Clipboard from "expo-clipboard";

type ErrInfo = {
  message: string;
  stack?: string;
  component?: string;
  source: "render" | "uncaught" | "promise";
  ts: string;
};

type State = {
  err: ErrInfo | null;
};

// Handler globale installato una sola volta a livello di modulo
let globalInstalled = false;
let pushErr: ((e: ErrInfo) => void) | null = null;

function installGlobalHandlers() {
  if (globalInstalled) return;
  globalInstalled = true;

  try {
    // Uncaught JS errors (Metro/RN)
    const EU: any = (globalThis as any).ErrorUtils;
    if (EU?.setGlobalHandler) {
      const prev = EU.getGlobalHandler?.();
      EU.setGlobalHandler((error: any, isFatal: boolean) => {
        try {
          pushErr?.({
            message: `[FATAL=${!!isFatal}] ${error?.message || String(error)}`,
            stack: error?.stack || undefined,
            source: "uncaught",
            ts: new Date().toISOString(),
          });
        } catch {}
        try {
          prev?.(error, isFatal);
        } catch {}
      });
    }
  } catch {}

  try {
    // Unhandled promise rejections
    const onUnhandled = (event: any) => {
      const reason = event?.reason ?? event;
      pushErr?.({
        message: `[Promise] ${reason?.message || String(reason)}`,
        stack: reason?.stack || undefined,
        source: "promise",
        ts: new Date().toISOString(),
      });
    };
    if (Platform.OS === "web" && typeof (globalThis as any).addEventListener === "function") {
      (globalThis as any).addEventListener("unhandledrejection", onUnhandled);
    } else {
      // Best-effort su native (Hermes) — la tracker interna espone `enable` via require
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const tracking = require("promise/setimmediate/rejection-tracking");
        tracking.enable({
          allRejections: true,
          onUnhandled: (id: any, reason: any) => onUnhandled({ reason }),
          onHandled: () => {},
        });
      } catch {}
    }
  } catch {}
}

export class GlobalErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { err: null };

  constructor(props: { children: React.ReactNode }) {
    super(props);
    installGlobalHandlers();
    pushErr = (e) => {
      // Registra un errore proveniente da global handler solo se non ne stiamo già mostrando uno
      if (!this.state.err) this.setState({ err: e });
    };
  }

  componentWillUnmount(): void {
    pushErr = null;
  }

  static getDerivedStateFromError(error: any): State {
    return {
      err: {
        message: error?.message || String(error),
        stack: error?.stack,
        source: "render",
        ts: new Date().toISOString(),
      },
    };
  }

  componentDidCatch(error: any, info: any) {
    this.setState({
      err: {
        message: error?.message || String(error),
        stack: error?.stack,
        component: info?.componentStack || undefined,
        source: "render",
        ts: new Date().toISOString(),
      },
    });
  }

  private async copyLog() {
    const e = this.state.err;
    if (!e) return;
    const platformInfo = `${Platform.OS} ${Platform.Version ?? ""}`.trim();
    const text = [
      `AdvisorOS — Crash log`,
      `Timestamp: ${e.ts}`,
      `Platform: ${platformInfo}`,
      `Source: ${e.source}`,
      `Message: ${e.message}`,
      ``,
      `Stack:`,
      e.stack || "(no stack)",
      e.component ? `\nComponent stack:\n${e.component}` : "",
    ].join("\n");
    try {
      await Clipboard.setStringAsync(text);
      if (Platform.OS === "web") {
        try {
          (globalThis as any).alert?.("Log copiato negli appunti.");
        } catch {}
      } else {
        Alert.alert("Copiato", "Log crash negli appunti. Incollalo nella chat AdvisorOS.");
      }
    } catch {
      Alert.alert("Errore", "Impossibile copiare il log.");
    }
  }

  private reset = () => {
    this.setState({ err: null });
  };

  render() {
    if (this.state.err) {
      const { err } = this.state;
      return (
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.scroll}>
            <View style={styles.iconWrap}>
              <Text style={styles.icon}>⚠️</Text>
            </View>
            <Text style={styles.title}>Errore all&apos;avvio dell&apos;app</Text>
            <Text style={styles.sub}>
              AdvisorOS ha incontrato un errore. Il log qui sotto aiuta a diagnosticarlo.
              Copialo e inviamelo in chat per una correzione mirata.
            </Text>

            <View style={styles.logBox}>
              <Text style={styles.logLabel}>Sorgente</Text>
              <Text style={styles.logValue}>{err.source}</Text>
              <Text style={styles.logLabel}>Timestamp</Text>
              <Text style={styles.logValue}>{err.ts}</Text>
              <Text style={styles.logLabel}>Piattaforma</Text>
              <Text style={styles.logValue}>{Platform.OS} {String(Platform.Version || "")}</Text>
              <Text style={styles.logLabel}>Messaggio</Text>
              <Text style={styles.logValue}>{err.message}</Text>
              {err.stack ? (
                <>
                  <Text style={styles.logLabel}>Stack</Text>
                  <Text style={styles.logMono}>{err.stack}</Text>
                </>
              ) : null}
              {err.component ? (
                <>
                  <Text style={styles.logLabel}>Component stack</Text>
                  <Text style={styles.logMono}>{err.component}</Text>
                </>
              ) : null}
            </View>

            <Pressable onPress={() => this.copyLog()} style={styles.btnPrimary} testID="crash-copy">
              <Text style={styles.btnPrimaryTxt}>📋 Copia log</Text>
            </Pressable>
            <Pressable onPress={this.reset} style={styles.btnSecondary} testID="crash-retry">
              <Text style={styles.btnSecondaryTxt}>Riprova</Text>
            </Pressable>
          </ScrollView>
        </View>
      );
    }
    return this.props.children as any;
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0F2438' },
  scroll: { padding: 22, paddingTop: 60, paddingBottom: 40, gap: 14 },
  iconWrap: { alignItems: "center", marginBottom: 4 },
  icon: { fontSize: 48 },
  title: { fontSize: 22, fontWeight: "900", color: "#FFF", textAlign: "center", letterSpacing: -0.4 },
  sub: { fontSize: 13, color: "rgba(255,255,255,0.7)", textAlign: "center", lineHeight: 18, marginBottom: 8 },
  logBox: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    gap: 6,
  },
  logLabel: {
    color: "#FF6B35",
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginTop: 6,
  },
  logValue: {
    color: "#FFF",
    fontSize: 13,
    fontWeight: "600",
  },
  logMono: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 11,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
    lineHeight: 15,
  },
  btnPrimary: {
    backgroundColor: '#FF6B35',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 10,
  },
  btnPrimaryTxt: { color: "#FFF", fontWeight: "900", fontSize: 15, letterSpacing: 0.3 },
  btnSecondary: {
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.25)",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  btnSecondaryTxt: { color: "#FFF", fontWeight: "700", fontSize: 14 },
});

export default GlobalErrorBoundary;

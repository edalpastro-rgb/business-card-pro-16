import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";

/**
 * Wrap every module's public screen with <ModuleErrorBoundary moduleName="..."/>
 * so that a crash inside a module cannot bring down other modules.
 */
type Props = {
  moduleName: string;
  children: React.ReactNode;
  fallback?: (retry: () => void, error: Error) => React.ReactNode;
};

type State = { error: Error | null };

export class ModuleErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.warn(`[module:${this.props.moduleName}] crashed:`, error, info);
  }

  private retry = (): void => this.setState({ error: null });

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(this.retry, this.state.error);
    return (
      <View style={styles.root}>
        <Text style={styles.title}>Errore modulo</Text>
        <Text style={styles.msg}>
          {this.props.moduleName}: {this.state.error.message || "errore inatteso"}
        </Text>
        <Pressable onPress={this.retry} style={styles.btn}>
          <Text style={styles.btnTxt}>Riprova</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: { padding: 20, alignItems: "center", justifyContent: "center", flex: 1 },
  title: { fontSize: 16, fontWeight: "800", color: "#DC2626", marginBottom: 6 },
  msg: { fontSize: 13, color: "#475569", textAlign: "center", marginBottom: 16 },
  btn: { paddingHorizontal: 20, paddingVertical: 10, backgroundColor: "#1A2A6C", borderRadius: 8 },
  btnTxt: { color: "#FFF", fontWeight: "700", fontSize: 13 },
});

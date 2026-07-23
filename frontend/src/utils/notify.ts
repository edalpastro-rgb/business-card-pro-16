import { Alert, Platform } from "react-native";

/**
 * Cross-platform alert wrapper.
 * `Alert.alert` is a no-op on react-native-web — this ensures messages
 * are visible on web (via `window.alert`) while behaving normally on native.
 */
export function notify(title: string, message?: string) {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined" && typeof window.alert === "function") {
      window.alert(message ? `${title}\n\n${message}` : title);
    }
    return;
  }
  Alert.alert(title, message);
}

/**
 * Cross-platform confirm. Returns promise resolving true/false.
 */
export function confirmAsync(title: string, message?: string): Promise<boolean> {
  if (Platform.OS === "web") {
    return Promise.resolve(
      typeof window !== "undefined" && typeof window.confirm === "function"
        ? window.confirm(message ? `${title}\n\n${message}` : title)
        : true,
    );
  }
  return new Promise<boolean>((resolve) => {
    Alert.alert(title, message, [
      { text: "Annulla", style: "cancel", onPress: () => resolve(false) },
      { text: "OK", onPress: () => resolve(true) },
    ]);
  });
}

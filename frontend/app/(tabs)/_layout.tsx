import { Tabs, Redirect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/src/auth";
import { theme } from "@/src/theme";
import { View, ActivityIndicator, Platform } from "react-native";
import { useNavBarBottomInset } from "@/src/hooks/useSafeBottom";

// V27 palette (used only for tab bar styling, no global theme override)
const TAB_ACTIVE = "#FF6B35";
const TAB_INACTIVE = "#94A3B8";
const TAB_BG = "#FFFFFF";
const TAB_BORDER = "#EEF0F4";

export default function TabsLayout() {
  const { user, loading } = useAuth();
  const router = useRouter();
  // V50.z167 — Stesso valore della PersistentBottomNav (hook condiviso, con fallback
  // initialWindowMetrics): prima `Math.max(insets.bottom, 20)` locale → in Home la barra
  // risultava attaccata alla navigation bar Android (insets.bottom=0 dentro lo Stack).
  const bottomInset = useNavBarBottomInset();
  const tabBarHeight = 60 + bottomInset;

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.color.surface }}>
        <ActivityIndicator color={TAB_ACTIVE} />
      </View>
    );
  }
  if (!user) return <Redirect href="/login" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: TAB_ACTIVE,
        tabBarInactiveTintColor: TAB_INACTIVE,
        tabBarStyle: {
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          backgroundColor: TAB_BG,
          borderTopColor: TAB_BORDER,
          borderTopWidth: 1,
          height: tabBarHeight,
          paddingTop: 10,
          paddingBottom: bottomInset,
          ...Platform.select({
            ios: {
              shadowColor: "#0F172A",
              shadowOpacity: 0.05,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: -4 },
            },
            android: { elevation: 8 },
          }),
        },
        tabBarLabelStyle: { fontSize: 12, fontWeight: "700", letterSpacing: 0.2, marginTop: 3, marginBottom: 0, includeFontPadding: false },
        tabBarItemStyle: { paddingVertical: 2 },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: "Home",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "grid" : "grid-outline"} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="contatti"
        options={{
          title: "Contatti",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "people" : "people-outline"} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: "Chat",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "chatbubbles" : "chatbubbles-outline"} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="calendario"
        options={{
          title: "Calendario",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "calendar" : "calendar-outline"} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="report"
        options={{
          // V50.z141 — "Report/Statistiche" tolto dalla bottom bar (resta raggiungibile dal
          // menu laterale come "Statistiche" e dall'Edge Panel). Rotta invariata: /(tabs)/report
          href: null,
          title: "Statistiche",
        }}
      />
      <Tabs.Screen
        name="help"
        options={{
          title: "Help",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "help-circle" : "help-circle-outline"} size={24} color={color} />
          ),
        }}
        listeners={{
          // V50.z141 — Il tab Help apre direttamente la guida / tour guidato (libretto)
          tabPress: (e) => {
            e.preventDefault();
            router.push("/libretto" as any);
          },
        }}
      />
      <Tabs.Screen
        name="impostazioni"
        options={{
          title: "Profilo",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "person-circle" : "person-circle-outline"} size={24} color={color} />
          ),
        }}
      />
      {/* V50.z107 — WebViewer accessibile via push URL, nascosto dalla tab bar
           (ma tab bar rimane visibile durante la navigazione web) */}
      <Tabs.Screen
        name="webviewer"
        options={{ href: null }}
      />
    </Tabs>
  );
}

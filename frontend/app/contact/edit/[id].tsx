import { useLocalSearchParams } from "expo-router";
import NewContactScreen from "../new";

export default function EditContactRoute() {
  // Same component in edit mode — new.tsx reads editId param when present
  return <NewContactScreen />;
}

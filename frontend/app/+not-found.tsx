// +not-found.tsx — V50.z543 — qualsiasi indirizzo non esistente porta alla home pubblica (/landing); da lì «Accedi».
import { Redirect } from "expo-router";

export default function NotFound() {
  return <Redirect href="/landing" />;
}

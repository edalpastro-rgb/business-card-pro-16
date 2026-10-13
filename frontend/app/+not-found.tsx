// +not-found.tsx — V50.z540 — qualsiasi indirizzo non esistente (inclusa la vecchia /landing, rimossa) porta al login.
import { Redirect } from "expo-router";

export default function NotFound() {
  return <Redirect href="/login" />;
}

import { Linking, Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";

function pad(n: number) { return n < 10 ? `0${n}` : String(n); }

function toIcsDate(d: Date): string {
  // yyyymmddThhmmssZ (UTC)
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

export type CalEvent = {
  id: string;
  title: string;
  start: Date;
  end?: Date;
  location?: string;
  description?: string;
};

function normalized(ev: CalEvent) {
  const end = ev.end || new Date(ev.start.getTime() + 60 * 60 * 1000);
  return { ...ev, end };
}

export function googleCalendarUrl(ev: CalEvent): string {
  const n = normalized(ev);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: ev.title,
    dates: `${toIcsDate(n.start)}/${toIcsDate(n.end!)}`,
    details: ev.description || "",
    location: ev.location || "",
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function outlookCalendarUrl(ev: CalEvent): string {
  const n = normalized(ev);
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: ev.title,
    startdt: n.start.toISOString(),
    enddt: n.end!.toISOString(),
    body: ev.description || "",
    location: ev.location || "",
  });
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
}

export function icsContent(ev: CalEvent): string {
  const n = normalized(ev);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ProSync CRM//IT",
    "BEGIN:VEVENT",
    `UID:${ev.id}@prosync`,
    `DTSTAMP:${toIcsDate(new Date())}`,
    `DTSTART:${toIcsDate(n.start)}`,
    `DTEND:${toIcsDate(n.end!)}`,
    `SUMMARY:${(ev.title || "").replace(/\n/g, " ")}`,
    ev.location ? `LOCATION:${ev.location.replace(/\n/g, " ")}` : "",
    ev.description ? `DESCRIPTION:${ev.description.replace(/\n/g, " ")}` : "",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  return lines.join("\r\n");
}

export async function openGoogleCalendar(ev: CalEvent) {
  await Linking.openURL(googleCalendarUrl(ev));
}

export async function openOutlookCalendar(ev: CalEvent) {
  await Linking.openURL(outlookCalendarUrl(ev));
}

export async function shareIcs(ev: CalEvent) {
  const content = icsContent(ev);
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") {
      const blob = new Blob([content], { type: "text/calendar" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${ev.title.replace(/[^a-z0-9]/gi, "_")}.ics`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
    return;
  }
  const path = (FileSystem as any).cacheDirectory + `${ev.id}.ics`;
  await FileSystem.writeAsStringAsync(path, content, { encoding: FileSystem.EncodingType.UTF8 });
  await Linking.openURL(path);
}

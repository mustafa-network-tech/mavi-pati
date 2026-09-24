import type { OfferedSlot } from "@/lib/outreach/decide";

type SlotRow = { id: string; starts_at: string };

// Labels and times are rendered in the office's timezone; the AI only ever sees these.
export function toOfferedSlots(rows: SlotRow[], timeZone: string): OfferedSlot[] {
  const label = new Intl.DateTimeFormat("tr-TR", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
  const time = new Intl.DateTimeFormat("tr-TR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return rows.map((row) => {
    const startsAt = new Date(row.starts_at);
    return { id: row.id, label: label.format(startsAt), time: time.format(startsAt) };
  });
}

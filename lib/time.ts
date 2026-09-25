function timeZoneOffset(timestamp: number, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(timestamp))
      .map((part) => [part.type, part.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - timestamp;
}

// "2026-09-25T14:00" entered in the office's timezone -> the absolute instant.
export function zonedLocalToDate(local: string, timeZone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  const wallClock = Date.UTC(year, month - 1, day, hour, minute);
  let instant = wallClock - timeZoneOffset(wallClock, timeZone);
  instant = wallClock - timeZoneOffset(instant, timeZone);
  const date = new Date(instant);
  return Number.isNaN(date.getTime()) ? null : date;
}

// "YYYY-MM-DD" of the given instant in the clinic's timezone.
export function localDateString(timeZone: string, instant = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    instant,
  );
}

export function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

// Absolute start/end of a local calendar day (end exclusive).
export function zonedDayRange(date: string, timeZone: string) {
  const start = zonedLocalToDate(`${date}T00:00`, timeZone);
  const end = zonedLocalToDate(`${addDays(date, 1)}T00:00`, timeZone);
  if (!start || !end) throw new Error("Invalid date");
  return { start: start.toISOString(), end: end.toISOString() };
}

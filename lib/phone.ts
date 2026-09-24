// Mirrors private.normalize_phone() in the database: international digits,
// Turkish local formats (0XXXXXXXXXX / XXXXXXXXXX) become 90XXXXXXXXXX.
export function normalizePhone(raw: string | null | undefined) {
  const digits = (raw ?? "").replace(/[^0-9]+/g, "");
  if (!digits) return null;
  if (digits.startsWith("00")) return digits.slice(2);
  if (/^0[1-9]\d{9}$/.test(digits)) return `9${digits}`;
  if (/^[1-9]\d{9}$/.test(digits)) return `90${digits}`;
  return digits;
}

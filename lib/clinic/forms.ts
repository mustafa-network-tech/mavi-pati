import { z } from "zod";
import { zonedLocalToDate } from "@/lib/time";

const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

export const optionalText = (maximum: number) =>
  z.preprocess(blankToUndefined, z.string().trim().max(maximum).optional());

export const requiredText = (minimum: number, maximum: number, message: string) =>
  z.string({ message }).trim().min(minimum, message).max(maximum);

export const optionalEmail = z.preprocess(
  blankToUndefined,
  z.string().trim().email("Geçerli bir e-posta adresi girin.").max(254).optional(),
);

export const optionalDate = z.preprocess(
  blankToUndefined,
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih geçersiz.").optional(),
);

export const optionalUuid = z.preprocess(blankToUndefined, z.string().uuid().optional());

export const optionalPositiveNumber = (maximum: number) =>
  z.preprocess(
    (value) => (typeof value === "string" ? (value.trim() === "" ? undefined : value.replace(",", ".")) : value),
    z.coerce.number().positive("Değer sıfırdan büyük olmalıdır.").max(maximum).optional(),
  );

// "datetime-local" values are wall-clock times in the clinic's timezone.
export const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Tarih ve saat geçersiz.");

export function toInstant(local: string, timeZone: string) {
  const date = zonedLocalToDate(local, timeZone);
  if (!date) throw new Error("Invalid local date");
  return date.toISOString();
}

export function formValues(formData: FormData) {
  return Object.fromEntries([...formData.entries()].filter(([, value]) => typeof value === "string"));
}

export function firstIssue(error: z.ZodError, fallback: string) {
  return error.issues[0]?.message ?? fallback;
}

// Approximate age (years) -> estimated birth date, when the exact date is unknown.
export function estimatedBirthDate(ageYears: number, today = new Date()) {
  const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  date.setUTCMonth(date.getUTCMonth() - Math.round(ageYears * 12));
  return date.toISOString().slice(0, 10);
}

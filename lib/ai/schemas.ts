import { z } from "zod";

export const advisorIntentKeys = [
  "PATIENT_HISTORY",
  "RECENT_EXAMINATIONS",
  "VACCINATION_SUMMARY",
  "NOTE_CLEANUP",
  "OWNER_INFO_DRAFT",
  "TODAY_APPOINTMENTS",
  "UPCOMING_VACCINATIONS",
  "UPCOMING_FOLLOW_UPS",
  "OPERATIONS_SUMMARY",
  "OUT_OF_SCOPE",
] as const;
export type AdvisorIntent = (typeof advisorIntentKeys)[number];

// Step 1: map a free-form request onto one whitelisted intent. The backend then
// decides which data may be loaded; the model never chooses queries itself.
export const advisorClassificationSchema = z.strictObject({
  intent: z.enum(advisorIntentKeys),
  patient_name: z.string().trim().min(1).max(80).nullable(),
  note_text: z.string().trim().min(1).max(6000).nullable(),
});
export type AdvisorClassification = z.infer<typeof advisorClassificationSchema>;

// Step 2: the answer, grounded in the context the backend supplied.
export const advisorAnswerSchema = z.strictObject({
  answer: z.string().trim().min(1).max(4000),
  insufficient_data: z.boolean(),
});
export type AdvisorAnswer = z.infer<typeof advisorAnswerSchema>;

const unsupportedKeywords = new Set([
  "$schema",
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minItems",
  "maxItems",
]);

function stripKeywords(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripKeywords);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !unsupportedKeywords.has(key))
        .map(([key, entry]) => [key, stripKeywords(entry)]),
    );
  return value;
}

// JSON schema for provider-side structured output. Length/range limits are
// enforced afterwards by the Zod schema itself.
export function structuredOutputSchema(schema: z.ZodType) {
  return stripKeywords(z.toJSONSchema(schema)) as Record<string, unknown>;
}

export const ownerIntentKeys = [
  "PET_SUMMARY",
  "APPOINTMENT_REQUEST",
  "MEDICATION_REQUEST",
  "REQUEST_STATUS",
  "CLINIC_INFO",
  "EMERGENCY",
  "OUT_OF_SCOPE",
] as const;
export type OwnerIntent = (typeof ownerIntentKeys)[number];

// Owner requests are only extracted here; the backend validates them and the owner
// must confirm before anything reaches the clinic.
export const ownerClassificationSchema = z.strictObject({
  intent: z.enum(ownerIntentKeys),
  pet_name: z.string().trim().min(1).max(80).nullable(),
  // Validated as YYYY-MM-DD (and not in the past) by the backend, not trusted here.
  preferred_date: z.string().trim().max(20).nullable(),
  preferred_time: z.string().trim().min(1).max(100).nullable(),
  medication_name: z.string().trim().min(2).max(200).nullable(),
});
export type OwnerClassification = z.infer<typeof ownerClassificationSchema>;

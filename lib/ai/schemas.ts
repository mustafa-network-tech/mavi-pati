import { z } from "zod";

const text = (maximum: number) => z.string().trim().min(1).max(maximum).nullable();
const flag = z.boolean().nullable();

// Unknown facts are null; the model must never guess them.
export const listingAnalysisSchema = z.strictObject({
  listing_purpose: z.enum(["SALE", "RENT"]).nullable(),
  property_type: z
    .enum(["APARTMENT", "HOUSE", "VILLA", "OFFICE", "LAND", "COMMERCIAL", "OTHER"])
    .nullable(),
  city: text(100),
  district: text(100),
  neighborhood: text(100),
  price: z.number().nonnegative().nullable(),
  currency: z.string().trim().regex(/^[A-Z]{3}$/).nullable(),
  room_count: text(30),
  gross_m2: z.number().positive().max(1_000_000).nullable(),
  net_m2: z.number().positive().max(1_000_000).nullable(),
  building_age: z.number().int().min(0).max(300).nullable(),
  floor: text(50),
  total_floors: z.number().int().min(0).max(300).nullable(),
  heating: text(100),
  balcony: flag,
  elevator: flag,
  parking: flag,
  furnished: flag,
  site: flag,
  garden: flag,
  terrace: flag,
  view: text(150),
  facade: text(100),
  highlights: z.array(z.string().trim().min(1).max(160)).max(5),
  summary: z.string().trim().min(1).max(600),
});
export type ListingAnalysis = z.infer<typeof listingAnalysisSchema>;

export const initialMessageSchema = z.strictObject({
  message: z.string().trim().min(10).max(700),
});

export const replyIntents = [
  "GENERAL",
  "OBJECTION",
  "APPOINTMENT",
  "PRICE_QUESTION",
  "COMMISSION_QUESTION",
  "REJECTION",
  "HUMAN_REQUEST",
] as const;
export const replyActions = [
  "REPLY",
  "SHOW_APPOINTMENTS",
  "CREATE_APPOINTMENT",
  "HANDOFF",
  "CLOSE_CONVERSATION",
] as const;

export const conversationReplySchema = z.strictObject({
  reply: z.string().trim().min(1).max(1000),
  intent: z.enum(replyIntents),
  recommended_action: z.enum(replyActions),
  selected_slot_id: z.string().nullable(),
  do_not_contact: z.boolean(),
  conversation_summary: z.string().trim().min(1).max(600),
});
export type ConversationReply = z.infer<typeof conversationReplySchema>;

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

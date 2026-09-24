import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { normalizePhone } from "@/lib/phone";

// Meta signs the raw request body: X-Hub-Signature-256: sha256=<hex HMAC>.
export function verifyWebhookSignature(rawBody: string, header: string | null, appSecret: string) {
  if (!header?.startsWith("sha256=")) return false;
  const received = Buffer.from(header.slice("sha256=".length), "hex");
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function verifyWebhookChallenge(params: URLSearchParams, verifyToken: string) {
  const token = params.get("hub.verify_token") ?? "";
  const matches =
    token.length === verifyToken.length &&
    timingSafeEqual(Buffer.from(token), Buffer.from(verifyToken));
  return params.get("hub.mode") === "subscribe" && matches ? params.get("hub.challenge") : null;
}

export type InboundWhatsAppMessage = {
  providerMessageId: string;
  from: string;
  type: string;
  text: string;
  sentAt: Date;
};

export type WhatsAppStatusUpdate = {
  providerMessageId: string;
  status: "sent" | "delivered" | "read" | "failed";
  errorCode: string | null;
};

const payloadSchema = z.object({
  object: z.string(),
  entry: z.array(
    z.object({
      changes: z.array(
        z.object({
          field: z.string(),
          value: z.object({
            metadata: z.object({ phone_number_id: z.string() }).optional(),
            messages: z
              .array(
                z.object({
                  id: z.string(),
                  from: z.string(),
                  timestamp: z.string(),
                  type: z.string(),
                  text: z.object({ body: z.string() }).optional(),
                  button: z.object({ text: z.string() }).optional(),
                  interactive: z
                    .object({
                      button_reply: z.object({ title: z.string() }).optional(),
                      list_reply: z.object({ title: z.string() }).optional(),
                    })
                    .optional(),
                }),
              )
              .optional(),
            statuses: z
              .array(
                z.object({
                  id: z.string(),
                  status: z.string(),
                  errors: z.array(z.object({ code: z.union([z.number(), z.string()]) })).optional(),
                }),
              )
              .optional(),
          }),
        }),
      ),
    }),
  ),
});

// Only events for our own phone number are returned; everything else is ignored.
export function parseWebhookPayload(payload: unknown, phoneNumberId: string) {
  const parsed = payloadSchema.safeParse(payload);
  const messages: InboundWhatsAppMessage[] = [];
  const statuses: WhatsAppStatusUpdate[] = [];
  if (!parsed.success || parsed.data.object !== "whatsapp_business_account")
    return { messages, statuses };

  for (const entry of parsed.data.entry)
    for (const change of entry.changes) {
      if (change.field !== "messages" || change.value.metadata?.phone_number_id !== phoneNumberId)
        continue;
      for (const message of change.value.messages ?? []) {
        const text =
          message.text?.body ??
          message.button?.text ??
          message.interactive?.button_reply?.title ??
          message.interactive?.list_reply?.title ??
          `[${message.type} mesajı]`;
        messages.push({
          providerMessageId: message.id,
          from: normalizePhone(message.from) ?? message.from,
          type: message.type,
          text: text.trim().slice(0, 4000) || `[${message.type} mesajı]`,
          sentAt: new Date(Number(message.timestamp) * 1000),
        });
      }
      for (const status of change.value.statuses ?? [])
        if (["sent", "delivered", "read", "failed"].includes(status.status))
          statuses.push({
            providerMessageId: status.id,
            status: status.status as WhatsAppStatusUpdate["status"],
            errorCode: status.errors?.[0] ? String(status.errors[0].code) : null,
          });
    }
  return { messages, statuses };
}

// Test mode (default on) only allows the configured test recipient.
export function isRecipientAllowed(
  recipient: string,
  options: { testMode: boolean; testRecipient: string | null },
) {
  if (!options.testMode) return true;
  const allowed = normalizePhone(options.testRecipient);
  return !!allowed && normalizePhone(recipient) === allowed;
}

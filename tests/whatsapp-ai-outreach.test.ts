import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { OpenAiProvider, AiProviderError } from "../lib/ai/openai";
import { AI_AGENT_POLICY, buildAgentSystemPrompt } from "../lib/ai/policy";
import { findPolicyViolation, findUnofferedTimes } from "../lib/ai/safety";
import {
  conversationReplySchema,
  listingAnalysisSchema,
  structuredOutputSchema,
  type ConversationReply,
  type ListingAnalysis,
} from "../lib/ai/schemas";
import { COMMERCIAL_REDIRECT, decideReply, REJECTION_ACK, type OfferedSlot } from "../lib/outreach/decide";
import { toOfferedSlots } from "../lib/outreach/slots";
import { normalizePhone } from "../lib/phone";
import {
  isRecipientAllowed,
  parseWebhookPayload,
  verifyWebhookChallenge,
  verifyWebhookSignature,
} from "../lib/providers/whatsapp-webhook";
import { zonedLocalToDate } from "../lib/time";

const slots: OfferedSlot[] = [
  { id: "11111111-1111-4111-8111-111111111111", label: "25 Eylül Perşembe 14:00", time: "14:00" },
  { id: "22222222-2222-4222-8222-222222222222", label: "25 Eylül Perşembe 16:30", time: "16:30" },
];

const reply = (overrides: Partial<ConversationReply>): ConversationReply => ({
  reply: "Memnuniyetle yardımcı olurum.",
  intent: "GENERAL",
  recommended_action: "REPLY",
  selected_slot_id: null,
  do_not_contact: false,
  conversation_summary: "Özet",
  ...overrides,
});

test("phone numbers normalize to WhatsApp wa_id digits and test mode guards recipients", () => {
  assert.equal(normalizePhone("0555 111 22 33"), "905551112233");
  assert.equal(normalizePhone("555 111 22 33"), "905551112233");
  assert.equal(normalizePhone("+90 (555) 111-22-33"), "905551112233");
  assert.equal(normalizePhone("0049 151 2345678"), "491512345678");
  assert.equal(normalizePhone(""), null);

  assert.equal(isRecipientAllowed("905551112233", { testMode: true, testRecipient: "0555 111 22 33" }), true);
  assert.equal(isRecipientAllowed("905559999999", { testMode: true, testRecipient: "0555 111 22 33" }), false);
  assert.equal(isRecipientAllowed("905559999999", { testMode: true, testRecipient: null }), false);
  assert.equal(isRecipientAllowed("905559999999", { testMode: false, testRecipient: null }), true);
});

test("webhook signature and verification handshake are enforced", () => {
  const body = JSON.stringify({ hello: "world" });
  const signature = `sha256=${createHmac("sha256", "app-secret").update(body).digest("hex")}`;
  assert.equal(verifyWebhookSignature(body, signature, "app-secret"), true);
  assert.equal(verifyWebhookSignature(body, signature, "other-secret"), false);
  assert.equal(verifyWebhookSignature(`${body} `, signature, "app-secret"), false);
  assert.equal(verifyWebhookSignature(body, null, "app-secret"), false);

  const params = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "tok", "hub.challenge": "123" });
  assert.equal(verifyWebhookChallenge(params, "tok"), "123");
  assert.equal(verifyWebhookChallenge(params, "other"), null);
});

test("webhook payloads are parsed only for our phone number", () => {
  const payload = {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: "PN1" },
              messages: [
                { id: "wamid.A", from: "905551112233", timestamp: "1790000000", type: "text", text: { body: " Komisyonunuz ne kadar? " } },
                { id: "wamid.B", from: "905551112233", timestamp: "1790000001", type: "image" },
              ],
              statuses: [{ id: "wamid.OUT", status: "delivered" }, { id: "wamid.OUT", status: "deleted" }],
            },
          },
          { field: "messages", value: { metadata: { phone_number_id: "OTHER" }, messages: [{ id: "wamid.C", from: "1", timestamp: "1", type: "text", text: { body: "x" } }] } },
        ],
      },
    ],
  };
  const parsed = parseWebhookPayload(payload, "PN1");
  assert.deepEqual(parsed.messages.map((message) => [message.providerMessageId, message.text]), [
    ["wamid.A", "Komisyonunuz ne kadar?"],
    ["wamid.B", "[image mesajı]"],
  ]);
  assert.deepEqual(parsed.statuses, [{ providerMessageId: "wamid.OUT", status: "delivered", errorCode: null }]);
  assert.deepEqual(parseWebhookPayload({ object: "page" }, "PN1"), { messages: [], statuses: [] });
});

test("safety guard blocks prices, percentages and guarantees but allows listing facts", () => {
  assert.equal(findPolicyViolation("Eviniz 5.000.000 TL eder"), "PRICE_OR_AMOUNT");
  assert.equal(findPolicyViolation("₺4.500.000 civarı"), "PRICE_OR_AMOUNT");
  assert.equal(findPolicyViolation("Komisyonumuz %2"), "PERCENTAGE");
  assert.equal(findPolicyViolation("yüzde 3 komisyon"), "PERCENTAGE");
  assert.equal(findPolicyViolation("Üç ayda satışı garanti ediyoruz"), "GUARANTEE");
  assert.equal(findPolicyViolation("Bolu Merkez'deki 135 m² 3+1 daireniz için yazıyorum"), null);
  assert.equal(findPolicyViolation("Satış garantisi veremem ama danışmanımız yardımcı olur"), null);

  assert.deepEqual(findUnofferedTimes("Yarın 14:00 veya 16.30 uygun", ["14:00", "16:30"]), []);
  assert.deepEqual(findUnofferedTimes("Yarın 10:00 uygun mu?", ["14:00"]), ["10:00"]);
});

test("backend decides actions; the model's recommendation is not trusted", () => {
  assert.deepEqual(
    decideReply(reply({ intent: "REJECTION", do_not_contact: true, reply: "Anlıyorum, iyi günler." }), slots),
    { type: "REJECT", message: "Anlıyorum, iyi günler." },
  );
  assert.deepEqual(
    decideReply(reply({ intent: "REJECTION", do_not_contact: true, reply: "Ama %1 komisyonla satarız!" }), slots),
    { type: "REJECT", message: REJECTION_ACK },
  );
  assert.deepEqual(
    decideReply(reply({ recommended_action: "CREATE_APPOINTMENT", selected_slot_id: slots[1].id }), slots),
    { type: "BOOK", slotId: slots[1].id },
  );
  const invented = decideReply(
    reply({ recommended_action: "CREATE_APPOINTMENT", selected_slot_id: "33333333-3333-4333-8333-333333333333" }),
    slots,
  );
  assert.equal(invented.type, "REPLY");
  assert.match((invented as { message: string }).message, /14:00.*16:30/);

  assert.deepEqual(
    decideReply(reply({ intent: "COMMISSION_QUESTION", reply: "Komisyonumuz %2 olur." }), slots),
    { type: "REPLY", message: COMMERCIAL_REDIRECT, blocked: "PERCENTAGE" },
  );
  const madeUpTime = decideReply(reply({ intent: "APPOINTMENT", reply: "Yarın 10:00 uygun mu?" }), slots);
  assert.equal((madeUpTime as { blocked?: string }).blocked, "UNOFFERED_TIME");
  assert.equal(decideReply(reply({ intent: "APPOINTMENT", recommended_action: "SHOW_APPOINTMENTS" }), []).type, "HANDOFF");
  assert.equal(decideReply(reply({ intent: "HUMAN_REQUEST" }), slots).type, "HANDOFF");
  assert.equal(decideReply(reply({ intent: "OBJECTION" }), slots).type, "REPLY");
});

test("structured output schemas are strict and reject invented fields", () => {
  const schema = structuredOutputSchema(conversationReplySchema) as {
    additionalProperties: boolean;
    required: string[];
    properties: Record<string, unknown>;
  };
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort());
  assert.equal(JSON.stringify(schema).includes("maxLength"), false);

  const analysis: ListingAnalysis = {
    listing_purpose: "SALE", property_type: "APARTMENT", city: "Bolu", district: "Merkez", neighborhood: null,
    price: null, currency: null, room_count: "3+1", gross_m2: 135, net_m2: null, building_age: null, floor: null,
    total_floors: null, heating: null, balcony: null, elevator: null, parking: null, furnished: null, site: null,
    garden: null, terrace: null, view: null, facade: null, highlights: [], summary: "Bolu Merkez'de 3+1 satılık daire.",
  };
  assert.equal(listingAnalysisSchema.safeParse(analysis).success, true);
  assert.equal(listingAnalysisSchema.safeParse({ ...analysis, property_type: "CASTLE" }).success, false);
  assert.equal(listingAnalysisSchema.safeParse({ ...analysis, invented: "x" }).success, false);
});

test("slot times are rendered in the office timezone", () => {
  const instant = zonedLocalToDate("2026-09-25T14:00", "Europe/Istanbul")!;
  assert.equal(instant.toISOString(), "2026-09-25T11:00:00.000Z");
  assert.equal(zonedLocalToDate("25.09.2026 14:00", "Europe/Istanbul"), null);
  const [slot] = toOfferedSlots([{ id: "s1", starts_at: instant.toISOString() }], "Europe/Istanbul");
  assert.equal(slot.time, "14:00");
  assert.match(slot.label, /25 Eylül.*14:00/);
});

test("one central policy drives every channel", () => {
  const whatsapp = buildAgentSystemPrompt("WHATSAPP");
  const voice = buildAgentSystemPrompt("VOICE");
  for (const rule of AI_AGENT_POLICY.forbidden) {
    assert.ok(whatsapp.includes(rule));
    assert.ok(voice.includes(rule));
  }
  assert.match(whatsapp, /Komisyon/);
});

test("OpenAI provider sends strict JSON schema requests and validates the answer", async () => {
  const originalFetch = globalThis.fetch;
  const requests: { url: string; body: Record<string, unknown>; auth: string | null }[] = [];
  let content = JSON.stringify(reply({ intent: "COMMISSION_QUESTION", recommended_action: "SHOW_APPOINTMENTS" }));
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    requests.push({ url, body: JSON.parse(String(init.body)), auth: new Headers(init.headers).get("authorization") });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const provider = new OpenAiProvider("sk-test", "test-model");
    const result = await provider.generateConversationReply({
      officeName: "Test Emlak",
      ownerName: "Mustafa",
      analysis: null,
      listingTitle: "Bolu Merkez 3+1",
      history: [
        { role: "OFFICE", content: "Merhaba Mustafa Bey" },
        { role: "LEAD", content: "Komisyonunuz ne kadar?" },
      ],
      slots: [{ id: slots[0].id, label: slots[0].label }],
      now: "25 Eylül 2026",
    });
    assert.equal(result.intent, "COMMISSION_QUESTION");
    const [request] = requests;
    assert.equal(request.url, "https://api.openai.com/v1/chat/completions");
    assert.equal(request.auth, "Bearer sk-test");
    assert.equal(request.body.model, "test-model");
    const format = request.body.response_format as { type: string; json_schema: { strict: boolean } };
    assert.equal(format.type, "json_schema");
    assert.equal(format.json_schema.strict, true);
    const messages = request.body.messages as { role: string; content: string }[];
    assert.deepEqual(messages.slice(-2).map((message) => message.role), ["assistant", "user"]);
    assert.match(messages[0].content, /Komisyon oranı söylemek/);
    assert.ok(!JSON.stringify(messages).includes("905"), "no phone numbers reach the model");

    content = JSON.stringify({ ...reply({}), intent: "SELL_NOW" });
    await assert.rejects(
      () => provider.generateConversationReply({ officeName: "x", ownerName: null, analysis: null, listingTitle: "x", history: [{ role: "LEAD", content: "x" }], slots: [], now: "x" }),
      (error: unknown) => error instanceof AiProviderError && error.code === "OPENAI_SCHEMA_MISMATCH",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

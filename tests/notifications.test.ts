import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WhatsAppNotificationProvider,
  unansweredWhatsAppMessage,
} from "../lib/notifications";
import { matchQuestion, normalizeQuestion } from "../lib/matching";
import type { Clinic, UnansweredQuestion, Knowledge } from "../types";
const q: UnansweredQuestion = {
  id: "q",
  clinic_id: "a",
  language_code: "tr",
  visitor_name: "Ayşe & Ali",
  visitor_phone: "+90 555 000 0000",
  question_text: "Boncuk için fiyat? & 🐾",
  normalized_question: "boncuk için fiyat",
  status: "pending",
  created_at: "2026-09-16",
};
const clinic: Clinic = {
  id: "a",
  slug: "a",
  name: "A",
  description: null,
  phone: null,
  address: null,
  whatsapp: "901111111111",
};
test("WhatsApp message round-trips Turkish, emoji, and special characters", () => {
  const result = new WhatsAppNotificationProvider().prepare({
    clinic,
    question: q,
  });
  assert.ok(result);
  assert.equal(
    new URL(result.url).searchParams.get("text"),
    unansweredWhatsAppMessage(q),
  );
  assert.equal(new URL(result.url).pathname, "/901111111111");
});
test("each clinic supplies its own destination", () => {
  const provider = new WhatsAppNotificationProvider();
  assert.ok(
    provider
      .prepare({ clinic: { ...clinic, whatsapp: "902222222222" }, question: q })
      ?.url.startsWith("https://wa.me/902222222222?"),
  );
  assert.equal(
    provider.prepare({ clinic: { ...clinic, whatsapp: null }, question: q }),
    null,
  );
  assert.equal(
    provider.prepare({
      clinic: { ...clinic, whatsapp: "javascript:alert(1)" },
      question: q,
    }),
    null,
  );
});
test("notification cannot use another tenant clinic", () => {
  assert.throws(() =>
    new WhatsAppNotificationProvider().prepare({
      clinic: { ...clinic, id: "b" },
      question: q,
    }),
  );
});
const records: Knowledge[] = [
  {
    id: "k",
    clinic_id: "a",
    language_code: "tr",
    category: "Kedi Aşıları",
    canonical_question: "Kedi karma aşısı ne kadar?",
    answer_text: "Demo cevap",
    keywords: ["kedi", "karma", "aşısı"],
    alternative_questions: [],
    priority: 0,
  },
];
test("known exact question matches; unknown and dog questions are rejected", () => {
  assert.ok(matchQuestion("Kedi karma aşısı ne kadar?", records));
  assert.equal(
    matchQuestion("Mars üzerinde ameliyat yapıyor musunuz?", records),
    null,
  );
  assert.equal(matchQuestion("Köpek karma aşısı ne kadar?", records), null);
  assert.equal(normalizeQuestion("  İĞNE, fiyatı? "), "iğne fiyatı");
});

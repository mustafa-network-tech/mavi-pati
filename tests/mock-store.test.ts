import { test } from "node:test";
import assert from "node:assert/strict";
import { MockQuestionStore } from "../lib/demo/question-store";
import type { UnansweredQuestion } from "../types";
test("mock questions are stored with tenant boundaries and independent copies", () => {
  const store = new MockQuestionStore();
  const question: UnansweredQuestion = {
    id: "mock-q",
    clinic_id: "mock-a",
    language_code: "tr",
    visitor_name: "Demo Ziyaretçi",
    visitor_phone: "05000000000",
    question_text: "Demo soru metni",
    normalized_question: "demo soru metni",
    status: "pending",
    created_at: new Date().toISOString(),
  };
  const saved = store.save(question);
  saved.visitor_name = "Changed";
  assert.equal(
    store.get(question.id, "mock-a")?.visitor_name,
    "Demo Ziyaretçi",
  );
  assert.equal(store.get(question.id, "mock-b"), null);
  assert.equal(new MockQuestionStore().get(question.id, "mock-a"), null);
});

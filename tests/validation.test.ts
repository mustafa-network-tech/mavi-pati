import { test } from "node:test";
import assert from "node:assert/strict";
import { unansweredSchema } from "../lib/validation";
const valid = {
  question: "Kayıtlı olmayan soru nedir?",
  visitor_name: "Ayşe Yılmaz",
  visitor_phone: "+90 555 000 00 00",
  consent: true,
  website: "",
};
test("contact requires explicit consent and a valid phone", () => {
  assert.ok(unansweredSchema.safeParse(valid).success);
  assert.equal(
    unansweredSchema.safeParse({ ...valid, consent: false }).success,
    false,
  );
  assert.equal(
    unansweredSchema.safeParse({ ...valid, visitor_phone: "abc" }).success,
    false,
  );
  assert.equal(
    unansweredSchema.safeParse({ ...valid, website: "spam" }).success,
    false,
  );
});

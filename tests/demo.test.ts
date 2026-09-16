import { test } from "node:test";
import assert from "node:assert/strict";
import { isLocalDemo } from "../lib/demo/mode";
import seed from "../lib/demo/seed.json";
import { matchQuestion } from "../lib/matching";
test("preview only works in development without any public database configuration", () => {
  assert.equal(isLocalDemo({ NODE_ENV: "development" }), true);
  assert.equal(isLocalDemo({ NODE_ENV: "production" }), false);
  assert.equal(
    isLocalDemo({
      NODE_ENV: "development",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    }),
    false,
  );
});
test("demo contains 40 clinic scoped questions and examples match", () => {
  assert.equal(seed.knowledge.length, 40);
  for (const question of [
    "Kedi karma aşısı ne kadar?",
    "Kedi kısırlaştırma ücreti nedir?",
    "Bugün kaça kadar açıksınız?",
    "Mikroçip uygulaması yapıyor musunuz?",
    "Randevu almam gerekiyor mu?",
    "Acil hizmetiniz var mı?",
  ])
    assert.ok(matchQuestion(question, seed.knowledge), question);
  assert.ok(seed.knowledge.every((k) => k.clinic_id === seed.clinic.id));
  assert.equal(
    matchQuestion("Mars üzerinde ameliyat yapıyor musunuz?", seed.knowledge),
    null,
  );
});

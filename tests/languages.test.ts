import { test } from "node:test";
import assert from "node:assert/strict";
import { demoClinic, demoKnowledge } from "../lib/demo/data";
import russian from "../supabase/seed/ru.json";
import {
  getLocale,
  languageCodes,
  resolveLanguage,
  getClinicLanguages,
} from "../locales";
import { matchQuestion, normalizeQuestion } from "../lib/matching";
import { questionSchema, unansweredSchema } from "../lib/validation";
import { MockQuestionStore } from "../lib/demo/question-store";
import { WhatsAppNotificationProvider } from "../lib/notifications";
test("every Turkish and Russian canonical question finds its own answer", () => {
  assert.equal(demoKnowledge.length, 80);
  for (const record of demoKnowledge) {
    const result = matchQuestion(
      record.canonical_question,
      demoKnowledge,
      record.language_code,
    );
    assert.equal(result?.record.id, record.id, record.canonical_question);
  }
});
test("examples use their own language and cross-language questions are rejected", () => {
  for (const language of languageCodes)
    for (const question of getLocale(language).messages.examples) {
      assert.equal(
        matchQuestion(question, demoKnowledge, language)?.record.language_code,
        language,
      );
      const other = language === "tr" ? "ru" : "tr";
      assert.equal(matchQuestion(question, demoKnowledge, other), null);
    }
  const russianRecord = demoKnowledge.find((k) => k.language_code === "ru")!;
  const copiedQuestion = {
    ...russianRecord,
    canonical_question: "Kedi karma aşısı ne kadar?",
  };
  assert.equal(
    matchQuestion(copiedQuestion.canonical_question, [copiedQuestion], "tr"),
    null,
  );
});
test("Russian phrasing handles alternatives, species and vaccines safely", () => {
  const cat = matchQuestion(
    "Сколько стоит комплексная прививка кошке?",
    demoKnowledge,
    "ru",
  );
  assert.equal(
    cat?.record.canonical_question,
    "Сколько стоит комплексная вакцина для кошки?",
  );
  const dog = matchQuestion(
    "Сколько стоит комплексная прививка собаке?",
    demoKnowledge,
    "ru",
  );
  assert.equal(
    dog?.record.canonical_question,
    "Сколько стоит комплексная вакцина для собаки?",
  );
  const catOnly = demoKnowledge.filter(
    (k) =>
      k.language_code === "ru" &&
      k.canonical_question === "Сколько стоит комплексная вакцина для кошки?",
  );
  assert.equal(
    matchQuestion(
      "Сколько стоит комплексная вакцина для собаки?",
      catOnly,
      "ru",
    ),
    null,
  );
  assert.equal(
    matchQuestion(
      "Сколько стоит вакцина от бешенства для кошки?",
      catOnly,
      "ru",
    ),
    null,
  );
  assert.equal(
    matchQuestion("Вы делаете операции на Марсе?", demoKnowledge, "ru"),
    null,
  );
  assert.equal(normalizeQuestion("  СКОЛЬКО, стоит?  ", "ru"), "сколько стоит");
  assert.equal(
    matchQuestion("Нужно ли записываться на прием?", demoKnowledge, "ru")
      ?.record.canonical_question,
    "Нужно ли записываться на приём?",
  );
});
test("Russian counterparts retain all prices and demo disclaimers", () => {
  const prices = (answer: string) =>
    [...answer.matchAll(/(\d[\d .]*?)\s*TL/g)].map((m) =>
      m[1].replace(/\D/g, ""),
    );
  for (const [, sourceQuestion, question, answer] of russian) {
    assert.equal(typeof sourceQuestion, "string");
    const source = demoKnowledge.find(
      (k) =>
        k.language_code === "tr" && k.canonical_question === sourceQuestion,
    );
    assert.ok(source);
    assert.deepEqual(
      prices(String(answer)),
      prices(source.answer_text),
      String(question),
    );
    if (prices(source.answer_text).length)
      assert.match(String(answer), /демо|демонстрации/);
  }
});
test("language validation defaults to Turkish and accepts Russian contact records", () => {
  assert.equal(
    questionSchema.parse({ question: "Geçerli soru" }).language_code,
    "tr",
  );
  assert.equal(
    questionSchema.safeParse({
      question: "Valid question",
      language_code: "zz",
    }).success,
    false,
  );
  assert.equal(resolveLanguage("__proto__"), "tr");
  const input = unansweredSchema.parse({
    question: "Неизвестный вопрос?",
    language_code: "ru",
    visitor_name: "Демо Посетитель",
    visitor_phone: "+7 999 000 00 00",
    consent: true,
  });
  assert.equal(input.language_code, "ru");
  const store = new MockQuestionStore();
  const saved = store.save({
    id: "ru-q",
    clinic_id: demoClinic.id,
    visitor_name: input.visitor_name,
    visitor_phone: input.visitor_phone,
    question_text: input.question,
    normalized_question: normalizeQuestion(input.question, input.language_code),
    language_code: input.language_code,
    status: "pending",
    created_at: new Date().toISOString(),
  });
  assert.equal(store.get(saved.id, demoClinic.id)?.language_code, "ru");
  const link = new WhatsAppNotificationProvider().prepare({
    clinic: demoClinic,
    question: saved,
  });
  assert.ok(link);
  assert.ok(
    new URL(link.url).searchParams.get("text")?.includes(input.question),
  );
});
test("clinic language settings use the central language registry", () => {
  assert.deepEqual(getClinicLanguages(demoClinic).supported, ["tr", "ru"]);
  assert.deepEqual(
    getClinicLanguages({ supported_languages: ["ru"], default_language: "ru" }),
    { supported: ["ru"], defaultLanguage: "ru" },
  );
  assert.deepEqual(getClinicLanguages({ supported_languages: ["tr", "zz"] }), {
    supported: ["tr"],
    defaultLanguage: "tr",
  });
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const demo = JSON.parse(
  readFileSync(new URL("../lib/demo/seed.json", import.meta.url), "utf8"),
);
const base = process.argv[2] ?? "http://localhost:3001";
const post = async (path, body) => {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      Origin: base,
      "Content-Type": "application/json",
      "X-Assistant-Language": body.language_code ?? "tr",
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
};
const page = await fetch(`${base}/mavi-pati?lang=ru`);
const html = await page.text();
assert.equal(page.status, 200);
assert.ok(html.includes("Здравствуйте"));
assert.ok(html.includes("Демо-режим"));
const tr = await post("/api/mavi-pati/question", {
  question: "Kedi karma aşısı ne kadar?",
  language_code: "tr",
});
assert.equal(tr.status, 200);
assert.equal(tr.data.answered, true);
assert.equal(tr.data.language_code, "tr");
assert.ok(tr.data.answer.includes("1.200 TL"));
const ru = await post("/api/mavi-pati/question", {
  question: "Сколько стоит комплексная вакцина для кошки?",
  language_code: "ru",
});
assert.equal(ru.status, 200);
assert.equal(ru.data.answered, true);
assert.equal(ru.data.language_code, "ru");
assert.ok(ru.data.answer.includes("1 200 TL"));
const unknown = "Вы делаете операции на Марсе?";
const unanswered = await post("/api/mavi-pati/question", {
  question: unknown,
  language_code: "ru",
});
assert.equal(unanswered.data.answered, false);
assert.ok(unanswered.data.answer.includes("не нашёл точного ответа"));
const mixed = await post("/api/mavi-pati/question", {
  question: "Сколько стоит комплексная вакцина для кошки?",
  language_code: "tr",
});
assert.equal(mixed.data.answered, false);
const contact = {
  question: unknown,
  language_code: "ru",
  visitor_name: "Демо Посетитель",
  visitor_phone: "+7 999 000 00 00",
  consent: true,
  website: "",
};
const denied = await post("/api/mavi-pati/unanswered", {
  ...contact,
  consent: false,
});
assert.equal(denied.status, 400);
assert.ok(denied.data.error.includes("согласие"));
const saved = await post("/api/mavi-pati/unanswered", contact);
assert.equal(saved.status, 201);
assert.equal(saved.data.mock, true);
assert.equal(saved.data.language_code, "ru");
assert.equal(
  new URL(saved.data.whatsappUrl).pathname,
  `/${demo.clinic.whatsapp}`,
);
assert.ok(
  new URL(saved.data.whatsappUrl).searchParams.get("text").includes(unknown),
);
const missing = await post("/api/missing-clinic/question", {
  question: unknown,
  language_code: "ru",
});
assert.equal(missing.status, 404);
assert.equal(missing.data.error, "Клиника не найдена");
console.log(
  "Local HTTP smoke passed: Russian UI, TR/RU answers, unknown/cross-language rejection, localized validation, mock contact and WhatsApp URL. No message was sent.",
);

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
const sql = readFileSync(
  new URL("../supabase/seed.sql", import.meta.url),
  "utf8",
);
const clinicFields = sql.match(
  /values\('([^']*)','([^']*)','([^']*)','([^']*)',null,'([^']*)'\)/,
);
if (!clinicFields) throw new Error("Demo clinic seed not found");
const [, slug, name, description, whatsapp, address] = clinicFields;
const clinic = {
  id: "00000000-0000-4000-8000-000000000001",
  slug,
  name,
  description,
  whatsapp,
  address,
  phone: null,
};
const knowledge = [
  ...sql.matchAll(/^\('([^']*)','([^']*)','([^']*)'\)[,]?$/gm),
].map(([, category, question, answer]) => ({
  id: randomUUID(),
  clinic_id: clinic.id,
  category,
  canonical_question: question,
  answer_text: answer,
  keywords: question.toLocaleLowerCase("tr-TR").split(" "),
  alternative_questions: [],
  priority: 0,
}));
if (knowledge.length !== 40)
  throw new Error(`Expected 40 seed questions, got ${knowledge.length}`);
const override = knowledge.find(
  (k) => k.canonical_question === "Kedi karma aşısı ne kadar?",
);
override.alternative_questions = [
  "Kedi karma aşı fiyatı nedir?",
  "Kedi karma aşısı kaç TL?",
  "Kedimin karma aşısını yaptırmak istiyorum.",
];
override.keywords = ["kedi", "karma", "aşısı", "fiyat"];
mkdirSync(new URL("../lib/demo/", import.meta.url), { recursive: true });
writeFileSync(
  new URL("../lib/demo/seed.json", import.meta.url),
  JSON.stringify({ clinic, knowledge }, null, 2) + "\n",
);

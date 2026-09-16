import type { Knowledge } from "@/types";
export const UNANSWERED_MESSAGE =
  "Bu sorunuz için kayıtlı bilgilerimizde kesin bir cevap bulamadım.\nSorunuz kliniğimize iletilecek.\nEn kısa sürede sizinle iletişime geçilecektir.";
export function normalizeQuestion(text: string) {
  return text
    .toLocaleLowerCase("tr-TR")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
const stop = new Set([
  "ne",
  "nedir",
  "kadar",
  "mi",
  "mı",
  "mu",
  "mü",
  "bir",
  "için",
  "var",
  "musunuz",
]);
const tokens = (text: string) =>
  normalizeQuestion(text)
    .split(" ")
    .filter((t) => !stop.has(t));
export function matchQuestion(question: string, records: Knowledge[]) {
  const normalized = normalizeQuestion(question);
  const query = new Set(tokens(question));
  const ranked = records
    .map((record) => {
      const phrases = [
        record.canonical_question,
        ...record.alternative_questions,
      ];
      let score = Math.max(
        ...phrases.map((phrase) => {
          if (normalizeQuestion(phrase) === normalized) return 1;
          const words = new Set(tokens(phrase));
          const overlap = [...query].filter((t) => words.has(t)).length;
          return (2 * overlap) / (query.size + words.size || 1);
        }),
      );
      const keywords = record.keywords.map(normalizeQuestion);
      const coverage =
        keywords.filter((k) => query.has(k)).length / (keywords.length || 1);
      score = score === 1 ? 1 : score * 0.8 + coverage * 0.2;
      for (const [a, b] of [
        ["kedi", "köpek"],
        ["karma", "kuduz"],
        ["karma", "lösemi"],
      ]) {
        if (
          (query.has(a) && keywords.includes(b) && !keywords.includes(a)) ||
          (query.has(b) && keywords.includes(a) && !keywords.includes(b))
        )
          score = 0;
      }
      return { record, score };
    })
    .sort((a, b) => b.score - a.score || b.record.priority - a.record.priority);
  const best = ranked[0];
  return best &&
    best.score >= 0.82 &&
    (!ranked[1] || best.score - ranked[1].score >= 0.08)
    ? best
    : null;
}

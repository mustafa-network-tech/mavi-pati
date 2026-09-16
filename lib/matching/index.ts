import type { Knowledge } from "@/types";
import { getLocale, DEFAULT_LANGUAGE, type LanguageCode } from "@/locales";
export const UNANSWERED_MESSAGE =
  getLocale(DEFAULT_LANGUAGE).messages.unanswered;
export function normalizeQuestion(
  text: string,
  language: LanguageCode = DEFAULT_LANGUAGE,
) {
  let normalized = text
    .normalize("NFC")
    .toLocaleLowerCase(getLocale(language).speechLocale)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const [source, target] of Object.entries(
    getLocale(language).characterAliases,
  ))
    normalized = normalized.replaceAll(source, target);
  return normalized;
}
const tokens = (text: string, language: LanguageCode) =>
  normalizeQuestion(text, language)
    .split(" ")
    .map((t) => getLocale(language).tokenAliases[t] ?? t)
    .filter(
      (t) => !(getLocale(language).stopWords as readonly string[]).includes(t),
    );
export function matchQuestion(
  question: string,
  records: Knowledge[],
  language: LanguageCode = DEFAULT_LANGUAGE,
) {
  const normalized = normalizeQuestion(question, language);
  const query = new Set(tokens(question, language));
  const ranked = records
    .filter((record) => record.language_code === language)
    .map((record) => {
      const phrases = [
        record.canonical_question,
        ...record.alternative_questions,
      ];
      let score = Math.max(
        ...phrases.map((phrase) => {
          if (normalizeQuestion(phrase, language) === normalized) return 1;
          const words = new Set(tokens(phrase, language));
          const overlap = [...query].filter((t) => words.has(t)).length;
          return (2 * overlap) / (query.size + words.size || 1);
        }),
      );
      const keywords = record.keywords.flatMap((keyword) =>
        tokens(keyword, language),
      );
      const coverage =
        keywords.filter((k) => query.has(k)).length / (keywords.length || 1);
      score = score === 1 ? 1 : score * 0.8 + coverage * 0.2;
      for (const group of getLocale(language).exclusiveGroups) {
        const specificQuery = group.filter((term) => query.has(term));
        const specificRecord = group.filter((term) => keywords.includes(term));
        if (
          specificQuery.length &&
          specificRecord.length &&
          !specificQuery.some((term) => specificRecord.includes(term))
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

import tr from "./tr";
import ru from "./ru";
export const locales = {
  tr: {
    label: "Türkçe",
    shortLabel: "TR",
    speechLocale: "tr-TR",
    direction: "ltr",
    messages: tr,
    characterAliases: {} as Record<string, string>,
    stopWords: [
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
    ],
    tokenAliases: {} as Record<string, string>,
    exclusiveGroups: [
      ["kedi", "köpek"],
      ["karma", "kuduz"],
      ["karma", "lösemi"],
    ],
  },
  ru: {
    label: "Русский",
    shortLabel: "RU",
    speechLocale: "ru-RU",
    direction: "ltr",
    messages: ru,
    characterAliases: { ё: "е" } as Record<string, string>,
    stopWords: [
      "сколько",
      "стоит",
      "для",
      "вы",
      "ли",
      "у",
      "вас",
      "в",
      "во",
      "на",
      "и",
    ],
    tokenAliases: {
      кошки: "кошка",
      кошку: "кошка",
      кошек: "кошка",
      кошке: "кошка",
      кот: "кошка",
      кота: "кошка",
      собаки: "собака",
      собаку: "собака",
      собак: "собака",
      собаке: "собака",
      вакцина: "вакцина",
      вакцину: "вакцина",
      вакцины: "вакцина",
      прививка: "вакцина",
      прививку: "вакцина",
      прививки: "вакцина",
      комплексной: "комплексная",
      бешенства: "бешенство",
      лейкоза: "лейкоз",
    } as Record<string, string>,
    exclusiveGroups: [
      ["кошка", "собака"],
      ["комплексная", "бешенство", "лейкоз", "бронхин"],
    ],
  },
} as const;
export type LanguageCode = keyof typeof locales;
export const DEFAULT_LANGUAGE: LanguageCode = "tr";
export const languageCodes = Object.keys(locales) as LanguageCode[];
export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === "string" && Object.hasOwn(locales, value);
}
export function resolveLanguage(value: unknown): LanguageCode {
  return isLanguageCode(value) ? value : DEFAULT_LANGUAGE;
}
export function getLocale(language: LanguageCode = DEFAULT_LANGUAGE) {
  return locales[language];
}
export function getClinicLanguages(clinic: {
  supported_languages?: readonly string[];
  default_language?: string;
}) {
  const available =
    clinic.supported_languages?.filter(isLanguageCode) ?? languageCodes;
  const supported = available.length ? available : [DEFAULT_LANGUAGE];
  const preferred = resolveLanguage(clinic.default_language);
  return {
    supported,
    defaultLanguage: supported.includes(preferred) ? preferred : supported[0],
  };
}

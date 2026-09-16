import seed from "./seed.json";
import { isLanguageCode } from "@/locales";
import type { Knowledge, Clinic } from "@/types";
export const demoClinic: Clinic = seed.clinic;
export const demoKnowledge: Knowledge[] = seed.knowledge.map((record) => {
  if (!isLanguageCode(record.language_code))
    throw new Error("Unsupported language in mock seed");
  return { ...record, language_code: record.language_code };
});

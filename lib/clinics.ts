import "server-only";
import { database } from "@/lib/supabase/server";
import type { Clinic, Knowledge } from "@/types";
import { isLocalDemo } from "@/lib/demo/mode";
import { demoClinic, demoKnowledge } from "@/lib/demo/data";
import { DEFAULT_LANGUAGE, type LanguageCode } from "@/locales";
export async function getClinic(slug: string): Promise<Clinic | null> {
  if (isLocalDemo()) return slug === demoClinic.slug ? demoClinic : null;
  const { data, error } = await database()
    .from("clinics")
    .select(
      "id,slug,name,description,whatsapp,phone,address,supported_languages,default_language,name_translations",
    )
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  return data;
}
export async function getKnowledge(
  clinic: Clinic,
  language: LanguageCode = DEFAULT_LANGUAGE,
): Promise<Knowledge[]> {
  if (isLocalDemo())
    return clinic.id === demoClinic.id
      ? demoKnowledge.filter((k) => k.language_code === language)
      : [];
  const { data, error } = await database()
    .from("assistant_knowledge")
    .select(
      "id,clinic_id,language_code,category,canonical_question,answer_text,keywords,alternative_questions,priority",
    )
    .eq("clinic_id", clinic.id)
    .eq("language_code", language)
    .eq("is_active", true);
  if (error) throw error;
  return data ?? [];
}

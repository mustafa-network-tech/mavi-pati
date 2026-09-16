import "server-only";
import { database } from "@/lib/supabase/server";
import type { Clinic, Knowledge } from "@/types";
import { isLocalDemo } from "@/lib/demo/mode";
import seed from "@/lib/demo/seed.json";
export async function getClinic(slug: string): Promise<Clinic | null> {
  if (isLocalDemo()) return slug === seed.clinic.slug ? seed.clinic : null;
  const { data, error } = await database()
    .from("clinics")
    .select("id,slug,name,description,whatsapp,phone,address")
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  return data;
}
export async function getKnowledge(clinic: Clinic): Promise<Knowledge[]> {
  if (isLocalDemo()) return clinic.id === seed.clinic.id ? seed.knowledge : [];
  const { data, error } = await database()
    .from("assistant_knowledge")
    .select(
      "id,clinic_id,category,canonical_question,answer_text,keywords,alternative_questions,priority",
    )
    .eq("clinic_id", clinic.id)
    .eq("is_active", true);
  if (error) throw error;
  return data ?? [];
}

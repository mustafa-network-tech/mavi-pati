import "server-only";
import { database } from "@/lib/supabase/server";
import { normalizeQuestion } from "@/lib/matching";
import { unansweredSchema } from "@/lib/validation";
import type { Clinic, UnansweredQuestion } from "@/types";
import { randomUUID } from "node:crypto";
import { isLocalDemo } from "@/lib/demo/mode";
import { mockQuestionStore } from "@/lib/demo/server-store";
/** Persistence has no dependency on notifications. */
export async function createUnansweredQuestion(
  clinic: Clinic,
  input: unknown,
): Promise<UnansweredQuestion> {
  const values = unansweredSchema.parse(input);
  if (isLocalDemo())
    return mockQuestionStore().save({
      id: randomUUID(),
      clinic_id: clinic.id,
      language_code: values.language_code,
      visitor_name: values.visitor_name,
      visitor_phone: values.visitor_phone,
      question_text: values.question,
      normalized_question: normalizeQuestion(
        values.question,
        values.language_code,
      ),
      status: "pending",
      created_at: new Date().toISOString(),
    });
  const { data, error } = await database(true)
    .from("unanswered_questions")
    .insert({
      clinic_id: clinic.id,
      language_code: values.language_code,
      visitor_name: values.visitor_name,
      visitor_phone: values.visitor_phone,
      question_text: values.question,
      normalized_question: normalizeQuestion(
        values.question,
        values.language_code,
      ),
      status: "pending",
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

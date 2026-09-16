import { getClinic, getKnowledge } from "@/lib/clinics";
import { questionSchema } from "@/lib/validation";
import { matchQuestion } from "@/lib/matching";
import { database } from "@/lib/supabase/server";
import { guard } from "@/lib/request-guard";
import { isLocalDemo } from "@/lib/demo/mode";
import { resolveLanguage, getLocale, getClinicLanguages } from "@/locales";
export async function POST(
  request: Request,
  {
    params,
  }: {
    params: Promise<{
      clinicSlug: string;
    }>;
  },
) {
  let language = resolveLanguage(request.headers.get("x-assistant-language"));
  let messages = getLocale(language).messages;
  try {
    const { clinicSlug } = await params;
    if (!(await guard(request, clinicSlug)))
      return Response.json(
        { error: messages.errors.rateLimit },
        { status: 429 },
      );
    const parsed = questionSchema.safeParse(await request.json());
    if (!parsed.success)
      return Response.json(
        { error: messages.errors.invalidQuestion },
        { status: 400 },
      );
    const clinic = await getClinic(clinicSlug);
    language = parsed.data.language_code;
    messages = getLocale(language).messages;
    if (!clinic)
      return Response.json(
        { error: messages.errors.clinicNotFound },
        { status: 404 },
      );
    if (!getClinicLanguages(clinic).supported.includes(language))
      return Response.json(
        { error: messages.errors.unsupportedLanguage },
        { status: 400 },
      );
    const match = matchQuestion(
      parsed.data.question,
      await getKnowledge(clinic, language),
      language,
    );
    const answer = match?.record.answer_text ?? messages.unanswered;
    if (isLocalDemo())
      return Response.json({
        answer,
        answered: !!match,
        language_code: language,
        preview: true,
      });
    const { error } = await database(true)
      .from("assistant_interactions")
      .insert({
        clinic_id: clinic.id,
        language_code: language,
        question_text: parsed.data.question,
        matched_knowledge_id: match?.record.id ?? null,
        answer_text: match ? answer : null,
        match_score: match?.score ?? 0,
        was_answered: !!match,
      });
    if (error) throw error;
    return Response.json({
      answer,
      answered: !!match,
      language_code: language,
    });
  } catch {
    return Response.json(
      { error: messages.errors.unavailable },
      { status: 503 },
    );
  }
}

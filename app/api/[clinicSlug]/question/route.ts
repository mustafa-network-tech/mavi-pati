import { getClinic, getKnowledge } from "@/lib/clinics";
import { questionSchema } from "@/lib/validation";
import { matchQuestion, UNANSWERED_MESSAGE } from "@/lib/matching";
import { database } from "@/lib/supabase/server";
import { guard } from "@/lib/request-guard";
import { isLocalDemo } from "@/lib/demo/mode";
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
  try {
    const { clinicSlug } = await params;
    if (!(await guard(request, clinicSlug)))
      return Response.json(
        { error: "Çok fazla istek gönderdiniz. Biraz sonra tekrar deneyin." },
        { status: 429 },
      );
    const parsed = questionSchema.safeParse(await request.json());
    if (!parsed.success)
      return Response.json(
        { error: "Lütfen geçerli bir soru yazın." },
        { status: 400 },
      );
    const clinic = await getClinic(clinicSlug);
    if (!clinic)
      return Response.json({ error: "Klinik bulunamadı." }, { status: 404 });
    const match = matchQuestion(
      parsed.data.question,
      await getKnowledge(clinic),
    );
    const answer = match?.record.answer_text ?? UNANSWERED_MESSAGE;
    if (isLocalDemo())
      return Response.json({ answer, answered: !!match, preview: true });
    const { error } = await database(true)
      .from("assistant_interactions")
      .insert({
        clinic_id: clinic.id,
        question_text: parsed.data.question,
        matched_knowledge_id: match?.record.id ?? null,
        answer_text: match ? answer : null,
        match_score: match?.score ?? 0,
        was_answered: !!match,
      });
    if (error) throw error;
    return Response.json({ answer, answered: !!match });
  } catch {
    return Response.json(
      { error: "Bilgilere şu anda ulaşılamıyor. Lütfen tekrar deneyin." },
      { status: 503 },
    );
  }
}

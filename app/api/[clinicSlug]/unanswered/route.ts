import { getClinic, getKnowledge } from "@/lib/clinics";
import { createUnansweredQuestion } from "@/lib/unanswered";
import { WhatsAppNotificationProvider } from "@/lib/notifications";
import { unansweredSchema } from "@/lib/validation";
import { matchQuestion } from "@/lib/matching";
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
    if (!(await guard(request, `${clinicSlug}:contact`)))
      return Response.json(
        { error: messages.errors.rateLimit },
        { status: 429 },
      );
    const parsed = unansweredSchema.safeParse(await request.json());
    if (!parsed.success)
      return Response.json(
        {
          error: messages.errors.invalidContact,
        },
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
    if (
      matchQuestion(
        parsed.data.question,
        await getKnowledge(clinic, language),
        language,
      )
    )
      return Response.json(
        {
          error: messages.errors.knownQuestion,
        },
        { status: 409 },
      );
    const question = await createUnansweredQuestion(clinic, parsed.data);
    const notification = new WhatsAppNotificationProvider().prepare({
      clinic,
      question,
    });
    return Response.json(
      {
        success: true,
        whatsappUrl: notification?.url ?? null,
        mock: isLocalDemo(),
        language_code: language,
      },
      { status: 201 },
    );
  } catch {
    return Response.json(
      { error: messages.errors.saveFailed },
      { status: 503 },
    );
  }
}

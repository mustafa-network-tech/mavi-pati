import { getClinic, getKnowledge } from "@/lib/clinics";
import { createUnansweredQuestion } from "@/lib/unanswered";
import { WhatsAppNotificationProvider } from "@/lib/notifications";
import { unansweredSchema } from "@/lib/validation";
import { matchQuestion } from "@/lib/matching";
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
    if (!(await guard(request, `${clinicSlug}:contact`)))
      return Response.json(
        { error: "Lütfen biraz sonra tekrar deneyin." },
        { status: 429 },
      );
    const parsed = unansweredSchema.safeParse(await request.json());
    if (!parsed.success)
      return Response.json(
        {
          error:
            "Adınızı, geçerli telefon numaranızı ve onayınızı kontrol edin.",
        },
        { status: 400 },
      );
    const clinic = await getClinic(clinicSlug);
    if (!clinic)
      return Response.json({ error: "Klinik bulunamadı." }, { status: 404 });
    if (matchQuestion(parsed.data.question, await getKnowledge(clinic)))
      return Response.json(
        {
          error: "Bu soru için kayıtlı bir cevap mevcut. Soruyu tekrar sorun.",
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
      },
      { status: 201 },
    );
  } catch {
    return Response.json(
      { error: "Sorunuz kaydedilemedi. Lütfen tekrar deneyin." },
      { status: 503 },
    );
  }
}

import { z } from "zod";
import { getBusinessAccess } from "@/lib/auth/dal";
import { AdvisorError, runClinicAdvisor, type AdvisorRequest } from "@/lib/clinic-ai/advisor";
import { advisorIntents, type ConcreteIntent } from "@/lib/clinic-ai/intents";
import { isSameOrigin } from "@/lib/clinic-ai/shared";

// One endpoint for written and in-app voice conversations: both go through the same
// session, tenant, role, quota, policy and safety checks in runClinicAdvisor().
export const maxDuration = 60;

const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const intentKeys = Object.keys(advisorIntents) as [ConcreteIntent, ...ConcreteIntent[]];
const optionalId = z.preprocess((value) => (value === "" ? null : value), z.string().uuid().nullish());

const textRequestSchema = z.object({
  text: z.string().trim().min(2, "Sorunuzu yazın.").max(6000),
  intent: z.enum(intentKeys).nullish(),
  patientId: optionalId,
  conversationId: optionalId,
});
const audioFieldsSchema = z.object({ patientId: optionalId, conversationId: optionalId });

const failure = (status: number, error: string) => Response.json({ error }, { status });

export async function POST(request: Request, { params }: { params: Promise<{ businessSlug: string }> }) {
  if (!isSameOrigin(request)) return failure(403, "Geçersiz istek kaynağı.");
  const { businessSlug } = await params;
  const access = await getBusinessAccess(businessSlug);
  if (!access) return failure(401, "Oturumunuz sona ermiş veya bu kliniğe erişiminiz yok.");

  let advisorRequest: AdvisorRequest;
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.startsWith("multipart/form-data")) {
    const form = await request.formData().catch(() => null);
    const audio = form?.get("audio");
    if (!(audio instanceof Blob) || !audio.size) return failure(400, "Ses kaydı alınamadı.");
    if (audio.size > MAX_AUDIO_BYTES) return failure(413, "Ses kaydı çok uzun. Lütfen daha kısa konuşun.");
    if (!audio.type.startsWith("audio/")) return failure(415, "Desteklenmeyen ses biçimi.");
    const fields = audioFieldsSchema.safeParse({
      patientId: form?.get("patientId") ?? null,
      conversationId: form?.get("conversationId") ?? null,
    });
    if (!fields.success) return failure(400, "İstek bilgileri geçersiz.");
    const extension = audio.type.includes("mp4") ? "mp4" : audio.type.includes("ogg") ? "ogg" : audio.type.includes("wav") ? "wav" : "webm";
    advisorRequest = {
      access,
      channel: "VOICE",
      input: { kind: "audio", audio, fileName: `soru.${extension}` },
      patientId: fields.data.patientId,
      conversationId: fields.data.conversationId,
    };
  } else {
    const parsed = textRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return failure(400, parsed.error.issues[0]?.message ?? "İstek bilgileri geçersiz.");
    advisorRequest = {
      access,
      channel: "TEXT",
      input: { kind: "text", text: parsed.data.text },
      intent: parsed.data.intent,
      patientId: parsed.data.patientId,
      conversationId: parsed.data.conversationId,
    };
  }

  try {
    return Response.json(await runClinicAdvisor(advisorRequest));
  } catch (error) {
    if (error instanceof AdvisorError) return failure(error.status, error.message);
    console.error("clinic advisor failed", error instanceof Error ? error.message : "unknown");
    return failure(500, "MK Pati AI isteği işlenemedi.");
  }
}

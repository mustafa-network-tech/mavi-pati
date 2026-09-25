import { z } from "zod";
import { AdvisorError, isSameOrigin } from "@/lib/clinic-ai/shared";
import { runOwnerAssistant } from "@/lib/owner-ai/assistant";
import { getOwnerAccess } from "@/lib/owner-portal/access";

// Pet owners: written and in-app voice through one endpoint and one pipeline.
export const maxDuration = 60;

const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const optionalId = z.preprocess((value) => (value === "" ? null : value), z.string().uuid().nullish());
const textSchema = z.object({ text: z.string().trim().min(2, "Sorunuzu yazın.").max(2000), conversationId: optionalId });

const failure = (status: number, error: string) => Response.json({ error }, { status });

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return failure(403, "Geçersiz istek kaynağı.");
  const access = await getOwnerAccess();
  if (!access) return failure(401, "Oturumunuz sona ermiş veya portal erişiminiz yok.");

  const contentType = request.headers.get("content-type") ?? "";
  try {
    if (contentType.startsWith("multipart/form-data")) {
      const form = await request.formData().catch(() => null);
      const audio = form?.get("audio");
      if (!(audio instanceof Blob) || !audio.size) return failure(400, "Ses kaydı alınamadı.");
      if (audio.size > MAX_AUDIO_BYTES) return failure(413, "Ses kaydı çok uzun. Lütfen daha kısa konuşun.");
      if (!audio.type.startsWith("audio/")) return failure(415, "Desteklenmeyen ses biçimi.");
      const conversationId = optionalId.safeParse(form?.get("conversationId") ?? null);
      const extension = audio.type.includes("mp4") ? "mp4" : audio.type.includes("ogg") ? "ogg" : audio.type.includes("wav") ? "wav" : "webm";
      return Response.json(
        await runOwnerAssistant({
          access,
          channel: "VOICE",
          input: { kind: "audio", audio, fileName: `soru.${extension}` },
          conversationId: conversationId.success ? conversationId.data : null,
        }),
      );
    }
    const parsed = textSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return failure(400, parsed.error.issues[0]?.message ?? "İstek bilgileri geçersiz.");
    return Response.json(
      await runOwnerAssistant({
        access,
        channel: "TEXT",
        input: { kind: "text", text: parsed.data.text },
        conversationId: parsed.data.conversationId,
      }),
    );
  } catch (error) {
    if (error instanceof AdvisorError) return failure(error.status, error.message);
    console.error("owner assistant failed", error instanceof Error ? error.message : "unknown");
    return failure(500, "MK Pati AI isteği işlenemedi.");
  }
}

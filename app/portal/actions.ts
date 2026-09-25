"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth/dal";
import { firstIssue, formValues, optionalDate, optionalText } from "@/lib/clinic/forms";
import { getOwnerAccess } from "@/lib/owner-portal/access";

export type OwnerActionState = { error?: string; success?: string };

const requestSchema = z
  .object({
    patientId: z.string().uuid("Hayvanınızı seçin."),
    requestType: z.enum(["APPOINTMENT", "MEDICATION"]),
    details: z.string().trim().min(3, "Talebinizi kısaca açıklayın.").max(2000),
    preferredDate: optionalDate,
    preferredTime: optionalText(100),
    medicationName: optionalText(200),
    channel: z.enum(["FORM", "AI_TEXT", "AI_VOICE"]).default("FORM"),
  })
  .refine((data) => data.requestType !== "MEDICATION" || (data.medicationName && data.medicationName.length >= 2), {
    message: "İlaç veya ürünün adını veteriner hekiminizin verdiği şekilde yazın.",
  });

// Goes through submit_owner_request(): ownership, pending cap and module checks are in the database.
export async function submitOwnerRequestAction(
  _previous: OwnerActionState,
  formData: FormData,
): Promise<OwnerActionState> {
  const access = await getOwnerAccess();
  if (!access) return { error: "Portal erişiminiz bulunamadı." };
  const parsed = requestSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error, "Talep bilgileri geçersiz.") };
  const { error } = await access.supabase.rpc("submit_owner_request", {
    target_business_id: access.businessId,
    target_patient_id: parsed.data.patientId,
    requested_type: parsed.data.requestType,
    request_details: parsed.data.details,
    requested_date: parsed.data.preferredDate ?? null,
    requested_time: parsed.data.preferredTime ?? null,
    requested_medication: parsed.data.medicationName ?? null,
    request_channel: parsed.data.channel,
  });
  if (error) {
    if (error.message?.includes("Too many pending requests"))
      return { error: "Klinik onayı bekleyen 5 talebiniz var. Yenisini göndermeden önce yanıt bekleyin veya birini iptal edin." };
    if (error.message?.includes("Preferred date")) return { error: "Tercih ettiğiniz tarih geçmiş bir gün olamaz." };
    if (error.message?.includes("Appointments disabled")) return { error: "Bu klinikte çevrim içi randevu talebi kapalı." };
    return { error: "Talep gönderilemedi. Lütfen tekrar deneyin." };
  }
  revalidatePath("/portal");
  return { success: "Talebiniz kliniğe iletildi. Klinik yanıtladığında bu sayfada göreceksiniz." };
}

export async function cancelOwnerRequestAction(requestId: string) {
  const access = await getOwnerAccess();
  if (!access) redirect("/login");
  await access.supabase.rpc("cancel_owner_request", { target_request_id: requestId });
  revalidatePath("/portal");
  redirect("/portal");
}

export async function acceptInvitationAction(token: string) {
  const session = await requireSession();
  const { error } = await session.supabase.rpc("accept_owner_invitation", { invite_token: token });
  if (error) {
    const message = error.message?.includes("cannot be owner portal")
      ? "Bu hesap bir klinik veya platform hesabı; hayvan sahibi portalı için ayrı bir e-posta ile kaydolun."
      : error.code === "23505"
        ? "Bu davet başka bir hesaba bağlanmış veya hesabınız başka bir kliniğin portalına bağlı."
        : "Davet geçersiz veya süresi dolmuş. Kliniğinizden yeni davet isteyin.";
    redirect(`/invite/${encodeURIComponent(token)}?error=${encodeURIComponent(message)}`);
  }
  redirect("/portal");
}

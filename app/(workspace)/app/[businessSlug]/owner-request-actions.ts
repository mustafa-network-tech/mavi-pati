"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireBusinessAccess } from "@/lib/auth/dal";
import { firstIssue, formValues, localDateTime, optionalText, optionalUuid, toInstant } from "@/lib/clinic/forms";
import { siteUrl } from "@/lib/site-url";

export type InvitationState = { error?: string; link?: string };

// The raw token is only shown once, to the clinic user who created it.
export async function createOwnerInvitationAction(
  businessSlug: string,
  ownerId: string,
  _previous: InvitationState,
): Promise<InvitationState> {
  const { supabase } = await requireBusinessAccess(businessSlug);
  const { data, error } = await supabase.rpc("create_owner_invitation", { target_owner_id: ownerId });
  if (error || typeof data !== "string")
    return {
      error: error?.message?.includes("Owner portal disabled")
        ? "Hayvan sahibi portalı bu klinik için açık değil."
        : "Davet oluşturulamadı.",
    };
  return { link: `${siteUrl()}/invite/${data}` };
}

export async function revokeOwnerPortalAction(businessSlug: string, ownerId: string) {
  const { supabase } = await requireBusinessAccess(businessSlug);
  await supabase.rpc("revoke_owner_portal_access", { target_owner_id: ownerId });
  revalidatePath(`/app/${businessSlug}/owners/${ownerId}`);
  redirect(`/app/${businessSlug}/owners/${ownerId}`);
}

function back(businessSlug: string, message?: string): never {
  redirect(`/app/${businessSlug}/requests${message ? `?error=${encodeURIComponent(message)}` : ""}`);
}

const approvalSchema = z.object({
  startsAt: localDateTime,
  durationMinutes: z.coerce.number().int().min(5).max(720),
  veterinarianMemberId: optionalUuid,
  response: optionalText(1000),
});

export async function approveAppointmentRequestAction(businessSlug: string, requestId: string, formData: FormData) {
  const { business, supabase } = await requireBusinessAccess(businessSlug);
  const parsed = approvalSchema.safeParse(formValues(formData));
  if (!parsed.success) back(businessSlug, firstIssue(parsed.error, "Randevu bilgileri geçersiz."));
  const startsAt = toInstant(parsed.data.startsAt, business.timezone);
  const { error } = await supabase.rpc("approve_appointment_request", {
    target_request_id: requestId,
    appointment_starts_at: startsAt,
    appointment_ends_at: new Date(Date.parse(startsAt) + parsed.data.durationMinutes * 60_000).toISOString(),
    target_veterinarian_member_id: parsed.data.veterinarianMemberId ?? null,
    response: parsed.data.response ?? null,
  });
  if (error)
    back(
      businessSlug,
      error.message?.includes("not available")
        ? "Veteriner hekimin bu saatte başka bir randevusu var."
        : error.message?.includes("already handled")
          ? "Bu talep zaten yanıtlanmış."
          : "Randevu oluşturulamadı.",
    );
  revalidatePath(`/app/${businessSlug}`, "layout");
  back(businessSlug);
}

const responseSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  response: optionalText(1000),
});

export async function respondOwnerRequestAction(businessSlug: string, requestId: string, formData: FormData) {
  const { supabase } = await requireBusinessAccess(businessSlug);
  const parsed = responseSchema.safeParse(formValues(formData));
  if (!parsed.success) back(businessSlug, "Geçersiz işlem.");
  const { error } = await supabase.rpc("respond_owner_request", {
    target_request_id: requestId,
    decision: parsed.data.decision,
    response: parsed.data.response ?? null,
  });
  if (error)
    back(
      businessSlug,
      error.message?.includes("Clinician required")
        ? "İlaç taleplerini yalnızca veteriner hekim veya klinik yöneticisi yanıtlayabilir."
        : error.message?.includes("already handled")
          ? "Bu talep zaten yanıtlanmış."
          : "Talep güncellenemedi.",
    );
  revalidatePath(`/app/${businessSlug}`, "layout");
  back(businessSlug);
}

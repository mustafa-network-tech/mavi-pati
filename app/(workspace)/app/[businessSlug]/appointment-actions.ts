"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireBusinessAccess } from "@/lib/auth/dal";
import { appointmentTransitions } from "@/lib/clinic/labels";
import { firstIssue, formValues, localDateTime, optionalText, optionalUuid, requiredText, toInstant } from "@/lib/clinic/forms";

function routeError(path: string, message: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(message)}`);
}

const appointmentSchema = z.object({
  patientId: z.string().uuid("Hasta seçin."),
  veterinarianMemberId: optionalUuid,
  startsAt: localDateTime,
  durationMinutes: z.coerce.number().int().min(5).max(720),
  reason: requiredText(2, 500, "Randevu açıklaması gereklidir."),
  notes: optionalText(2000),
});

export async function createAppointmentAction(businessSlug: string, formData: FormData) {
  const { business, supabase } = await requireBusinessAccess(businessSlug);
  const path = `/app/${businessSlug}/appointments/new`;
  const parsed = appointmentSchema.safeParse(formValues(formData));
  if (!parsed.success) routeError(path, firstIssue(parsed.error, "Randevu bilgileri geçersiz."));
  const startsAt = toInstant(parsed.data.startsAt, business.timezone);
  const endsAt = new Date(Date.parse(startsAt) + parsed.data.durationMinutes * 60_000).toISOString();
  const { error } = await supabase.from("appointments").insert({
    business_id: business.id,
    patient_id: parsed.data.patientId,
    veterinarian_member_id: parsed.data.veterinarianMemberId ?? null,
    starts_at: startsAt,
    ends_at: endsAt,
    reason: parsed.data.reason,
    notes: parsed.data.notes ?? null,
  });
  if (error)
    routeError(
      path,
      error.message?.includes("not available")
        ? "Veteriner hekimin bu saatte başka bir randevusu var."
        : error.message?.includes("active clinician")
          ? "Seçilen kişi aktif bir veteriner hekim değil."
          : "Randevu oluşturulamadı. Randevu modülünün açık olduğunu kontrol edin.",
    );
  revalidatePath(`/app/${businessSlug}/appointments`);
  revalidatePath(`/app/${businessSlug}/dashboard`);
  redirect(`/app/${businessSlug}/appointments?date=${parsed.data.startsAt.slice(0, 10)}`);
}

export async function updateAppointmentStatusAction(
  businessSlug: string,
  appointmentId: string,
  returnTo: string,
  formData: FormData,
) {
  const { business, supabase } = await requireBusinessAccess(businessSlug);
  const path = returnTo.startsWith(`/app/${businessSlug}/`) ? returnTo : `/app/${businessSlug}/appointments`;
  const next = z.enum(["CONFIRMED", "CHECKED_IN", "COMPLETED", "CANCELED", "NO_SHOW"]).safeParse(formData.get("status"));
  if (!next.success) routeError(path, "Geçersiz randevu durumu.");
  const { data: current } = await supabase
    .from("appointments")
    .select("status")
    .eq("business_id", business.id)
    .eq("id", appointmentId)
    .maybeSingle();
  if (!current || !(appointmentTransitions[current.status] ?? []).includes(next.data))
    routeError(path, "Bu durum değişikliği yapılamaz.");
  const { error } = await supabase
    .from("appointments")
    .update({ status: next.data })
    .eq("business_id", business.id)
    .eq("id", appointmentId)
    .eq("status", current.status);
  if (error) routeError(path, "Randevu güncellenemedi.");
  revalidatePath(`/app/${businessSlug}/appointments`);
  revalidatePath(`/app/${businessSlug}/dashboard`);
  redirect(path);
}

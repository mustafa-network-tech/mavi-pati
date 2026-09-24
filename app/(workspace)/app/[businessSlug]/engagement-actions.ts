"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireBusinessAccess } from "@/lib/auth/dal";
import { getWhatsAppProvider } from "@/lib/providers/whatsapp";
import { zonedLocalToDate } from "@/lib/time";

function routeError(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

const localDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  .transform((value, context) => {
    const date = new Date(`${value}:00+03:00`);
    if (Number.isNaN(date.getTime())) {
      context.addIssue({ code: "custom", message: "Tarih geçersiz." });
      return z.NEVER;
    }
    return date;
  });

export async function prepareWhatsAppAction(
  businessSlug: string,
  leadId: string,
  formData: FormData,
) {
  const access = await requireBusinessAccess(businessSlug);
  const path = `/app/${businessSlug}/leads/${leadId}`;
  const parsed = z.string().trim().min(1).max(10000).safeParse(formData.get("message"));
  if (!parsed.success) routeError(path, "Mesaj metni geçersiz.");
  const { data: lead } = await access.supabase
    .from("leads")
    .select("phone_normalized,whatsapp_allowed")
    .eq("business_id", access.business.id)
    .eq("id", leadId)
    .maybeSingle();
  if (!lead?.whatsapp_allowed || !lead.phone_normalized)
    routeError(path, "Bu lead için WhatsApp iletişim izni veya telefon numarası yok.");

  const provider = getWhatsAppProvider();
  let result;
  try {
    result = await provider.prepareOrSend({ recipient: lead.phone_normalized, content: parsed.data });
  } catch {
    routeError(path, "WhatsApp bağlantısı hazırlanamadı.");
  }
  const { error } = await access.supabase.rpc("create_manual_whatsapp_draft", {
    target_lead_id: leadId,
    message_content: parsed.data,
  });
  if (error || !result.launchUrl) routeError(path, "WhatsApp taslağı kaydedilemedi.");
  revalidatePath(`/app/${businessSlug}/conversations`);
  redirect(result.launchUrl);
}

export async function scheduleCallbackAction(
  businessSlug: string,
  leadId: string,
  formData: FormData,
) {
  const access = await requireBusinessAccess(businessSlug);
  const path = `/app/${businessSlug}/leads/${leadId}`;
  const parsed = localDateTime.safeParse(formData.get("callbackAt"));
  if (!parsed.success || parsed.data <= new Date()) routeError(path, "Gelecekte bir arama zamanı seçin.");
  const { error } = await access.supabase.rpc("schedule_callback", {
    target_lead_id: leadId,
    callback_at: parsed.data.toISOString(),
  });
  if (error) routeError(path, "Arama isteği oluşturulamadı. İzin ve özellik haklarını kontrol edin.");
  revalidatePath(`/app/${businessSlug}/calls`);
  redirect(`/app/${businessSlug}/calls?created=1`);
}

const appointmentSchema = z.object({
  leadId: z.string().uuid(),
  listingId: z.union([z.string().uuid(), z.literal("")]).transform((value) => value || null),
  advisorMemberId: z.string().uuid(),
  title: z.string().trim().min(3).max(240),
  startsAt: localDateTime,
  endsAt: localDateTime,
  location: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(5000).optional(),
});

export async function createAppointmentAction(businessSlug: string, formData: FormData) {
  const access = await requireBusinessAccess(businessSlug);
  const path = `/app/${businessSlug}/appointments/new`;
  const parsed = appointmentSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success || parsed.data.endsAt <= parsed.data.startsAt)
    routeError(path, "Randevu bilgileri veya tarih aralığı geçersiz.");
  const { error } = await access.supabase.rpc("create_appointment", {
    target_lead_id: parsed.data.leadId,
    target_listing_id: parsed.data.listingId,
    target_advisor_member_id: parsed.data.advisorMemberId,
    appointment_title: parsed.data.title,
    appointment_starts_at: parsed.data.startsAt.toISOString(),
    appointment_ends_at: parsed.data.endsAt.toISOString(),
    appointment_location: parsed.data.location || null,
    appointment_notes: parsed.data.notes || null,
  });
  if (error) routeError(path, "Randevu oluşturulamadı. Erişim ve modül yetkisini kontrol edin.");
  revalidatePath(`/app/${businessSlug}/appointments`);
  redirect(`/app/${businessSlug}/appointments?created=1`);
}

export async function cancelAppointmentAction(
  businessSlug: string,
  appointmentId: string,
  formData: FormData,
) {
  const access = await requireBusinessAccess(businessSlug);
  const path = `/app/${businessSlug}/appointments`;
  const reason = z.string().trim().max(1000).catch("").parse(formData.get("reason"));
  const { error } = await access.supabase.rpc("cancel_appointment", {
    target_appointment_id: appointmentId,
    cancel_reason: reason || null,
  });
  if (error) routeError(path, "Randevu iptal edilemedi.");
  revalidatePath(path);
}

const slotSchema = z.object({
  memberId: z.string().uuid(),
  startsAt: z.string(),
  durationMinutes: z.coerce.number().int().refine((value) => [30, 45, 60, 90, 120].includes(value)),
});

export async function createAppointmentSlotAction(businessSlug: string, formData: FormData) {
  const access = await requireBusinessAccess(businessSlug);
  const path = `/app/${businessSlug}/appointments`;
  const parsed = slotSchema.safeParse(Object.fromEntries(formData.entries()));
  const startsAt = parsed.success ? zonedLocalToDate(parsed.data.startsAt, access.business.timezone) : null;
  if (!parsed.success || !startsAt || startsAt <= new Date())
    routeError(path, "Gelecekte geçerli bir slot başlangıcı ve süre seçin.");
  const endsAt = new Date(startsAt.getTime() + parsed.data.durationMinutes * 60 * 1000);
  const { error } = await access.supabase.rpc("create_appointment_slot", {
    target_member_id: parsed.data.memberId,
    slot_starts_at: startsAt.toISOString(),
    slot_ends_at: endsAt.toISOString(),
  });
  if (error)
    routeError(
      path,
      error.message.includes("overlaps")
        ? "Bu saat, kişinin başka bir slotu veya randevusuyla çakışıyor."
        : "Slot oluşturulamadı. Yetki ve randevu modülünü kontrol edin.",
    );
  revalidatePath(path);
}

export async function cancelAppointmentSlotAction(businessSlug: string, slotId: string) {
  const access = await requireBusinessAccess(businessSlug);
  const path = `/app/${businessSlug}/appointments`;
  const { error } = await access.supabase.rpc("cancel_appointment_slot", { target_slot_id: slotId });
  if (error) routeError(path, "Slot iptal edilemedi.");
  revalidatePath(path);
}

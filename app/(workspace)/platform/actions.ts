"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/auth/dal";
import { database } from "@/lib/supabase/server";

export type PlatformActionState = {
  error?: string;
  success?: string;
};

const expiration = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .transform((value) => new Date(`${value}T23:59:59.999Z`).toISOString());
const seats = z.coerce.number().int().min(0).max(10_000);

const approvalSchema = z.object({
  businessId: z.string().uuid(),
  status: z.enum(["TRIAL", "ACTIVE"]),
  expiresAt: expiration,
  maxVeterinarians: seats,
  maxStaff: seats,
});

export async function approveBusinessAction(
  _previous: PlatformActionState,
  formData: FormData,
): Promise<PlatformActionState> {
  const session = await requirePlatformAdmin();
  const parsed = approvalSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success)
    return { error: parsed.error.issues[0]?.message ?? "Onay bilgileri geçersiz." };

  const { error } = await database(true).rpc("approve_business", {
    target_business_id: parsed.data.businessId,
    actor_platform_user_id: session.userId,
    approved_status: parsed.data.status,
    expires_at: parsed.data.expiresAt,
    veterinarian_limit: parsed.data.maxVeterinarians,
    staff_limit: parsed.data.maxStaff,
  });
  if (error) return { error: "Klinik onaylanamadı. Bilgileri ve yetkiyi kontrol edin." };

  revalidatePath("/platform");
  revalidatePath("/platform/businesses");
  revalidatePath("/platform/applications");
  return { success: "Klinik onaylandı ve erişim hakları etkinleştirildi." };
}

const configurationSchema = z.object({
  businessId: z.string().uuid(),
  status: z.enum(["TRIAL", "ACTIVE", "SUSPENDED", "EXPIRED", "REJECTED"]),
  expiresAt: expiration,
  maxVeterinarians: seats,
  maxStaff: seats,
  monthlyAiRequestLimit: z.coerce.number().int().min(0).max(10_000_000),
  reason: z.string().trim().max(1000).optional(),
});

export async function configureBusinessAction(
  _previous: PlatformActionState,
  formData: FormData,
): Promise<PlatformActionState> {
  const session = await requirePlatformAdmin();
  const parsed = configurationSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Yapılandırma geçersiz." };
  const enabled = (name: string) => formData.get(name) === "on";
  const { error } = await database(true).rpc("configure_business_access", {
    target_business_id: parsed.data.businessId,
    actor_platform_user_id: session.userId,
    next_business_status: parsed.data.status,
    next_expires_at: parsed.data.expiresAt,
    next_max_veterinarians: parsed.data.maxVeterinarians,
    next_max_staff: parsed.data.maxStaff,
    enable_clinic: enabled("clinicEnabled"),
    enable_appointments: enabled("appointmentsEnabled"),
    enable_ai_assistant: enabled("aiAssistantEnabled"),
    enable_ai_voice: enabled("aiVoiceEnabled"),
    enable_reports: enabled("reportsEnabled"),
    enable_owner_portal: enabled("ownerPortalEnabled"),
    next_ai_request_limit: parsed.data.monthlyAiRequestLimit,
    status_reason: parsed.data.reason || null,
  });
  if (error)
    return {
      error: error.message?.includes("Seat limit")
        ? "Kullanıcı limiti mevcut hekim/personel sayısının altında olamaz."
        : "Klinik yapılandırılamadı. Limitleri ve tarihleri kontrol edin.",
    };
  revalidatePath("/platform");
  revalidatePath("/platform/businesses");
  revalidatePath("/platform/applications");
  revalidatePath("/platform/audit");
  return { success: "Klinik erişimi, modüller ve AI kotası güncellendi." };
}

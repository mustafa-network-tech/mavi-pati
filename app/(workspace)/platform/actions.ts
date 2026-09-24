"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/auth/dal";
import { database } from "@/lib/supabase/server";

export type PlatformActionState = {
  error?: string;
  success?: string;
};

const approvalSchema = z.object({
  businessId: z.string().uuid(),
  status: z.enum(["TRIAL", "ACTIVE"]),
  expiresAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .transform((value) => new Date(`${value}T23:59:59.999Z`).toISOString()),
  maxAdvisors: z.coerce.number().int().min(0).max(10_000),
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
    advisor_limit: parsed.data.maxAdvisors,
  });
  if (error) return { error: "Ofis onaylanamadı. Bilgileri ve yetkiyi kontrol edin." };

  revalidatePath("/platform");
  revalidatePath("/platform/businesses");
  revalidatePath("/platform/applications");
  return { success: "Ofis onaylandı ve erişim hakları etkinleştirildi." };
}

const configurationSchema = z.object({
  businessId: z.string().uuid(),
  status: z.enum(["TRIAL", "ACTIVE", "SUSPENDED", "EXPIRED", "REJECTED"]),
  expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).transform((value) => new Date(`${value}T23:59:59.999Z`).toISOString()),
  maxAdvisors: z.coerce.number().int().min(0).max(10_000),
  monthlyAiCallMinutes: z.coerce.number().int().min(0),
  monthlyAiAnalysisLimit: z.coerce.number().int().min(0),
  monthlyLeadLimit: z.coerce.number().int().min(0),
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
    next_max_advisors: parsed.data.maxAdvisors,
    enable_crm: enabled("crmEnabled"),
    enable_appointments: enabled("appointmentsEnabled"),
    enable_whatsapp: enabled("whatsappEnabled"),
    enable_ai_analysis: enabled("aiAnalysisEnabled"),
    enable_ai_voice: enabled("aiVoiceEnabled"),
    enable_imports: enabled("importsEnabled"),
    enable_reports: enabled("reportsEnabled"),
    next_ai_call_minutes: parsed.data.monthlyAiCallMinutes,
    next_ai_analysis_limit: parsed.data.monthlyAiAnalysisLimit,
    next_lead_limit: parsed.data.monthlyLeadLimit,
    status_reason: parsed.data.reason || null,
  });
  if (error) return { error: "Ofis yapılandırılamadı. Limitleri ve tarihleri kontrol edin." };
  revalidatePath("/platform");
  revalidatePath("/platform/businesses");
  revalidatePath("/platform/applications");
  revalidatePath("/platform/audit");
  return { success: "Ofis erişimi, özellikleri ve kotaları güncellendi." };
}

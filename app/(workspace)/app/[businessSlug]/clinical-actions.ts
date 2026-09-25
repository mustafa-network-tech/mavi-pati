"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireBusinessAccess } from "@/lib/auth/dal";
import {
  firstIssue,
  formValues,
  localDateTime,
  optionalDate,
  optionalText,
  optionalUuid,
  requiredText,
  toInstant,
} from "@/lib/clinic/forms";

// Examinations and treatments are clinical records: RLS only accepts them from
// clinic admins and veterinarians; the checks here only shape the error message.
function routeError(path: string, message: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(message)}`);
}

function writeError(error: { code?: string; message?: string } | null, fallback: string) {
  if (error?.message?.includes("active clinician")) return "Seçilen kişi bu klinikte aktif bir veteriner hekim değil.";
  if (error?.message?.includes("row-level security")) return "Bu kaydı oluşturma yetkiniz yok.";
  return fallback;
}

const examinationSchema = z.object({
  veterinarianMemberId: z.string().uuid("Veteriner hekim seçin."),
  examinedAt: localDateTime,
  complaint: requiredText(2, 1000, "Başvuru nedeni gereklidir."),
  anamnesis: optionalText(10000),
  findings: optionalText(10000),
  assessment: optionalText(10000),
  procedures: optionalText(5000),
  followUpAt: optionalDate,
  extraNotes: optionalText(5000),
});

export async function createExaminationAction(businessSlug: string, patientId: string, formData: FormData) {
  const { business, supabase } = await requireBusinessAccess(businessSlug);
  const path = `/app/${businessSlug}/patients/${patientId}/examinations/new`;
  const parsed = examinationSchema.safeParse(formValues(formData));
  if (!parsed.success) routeError(path, firstIssue(parsed.error, "Muayene bilgileri geçersiz."));
  const { error } = await supabase.from("examinations").insert({
    business_id: business.id,
    patient_id: patientId,
    veterinarian_member_id: parsed.data.veterinarianMemberId,
    examined_at: toInstant(parsed.data.examinedAt, business.timezone),
    complaint: parsed.data.complaint,
    anamnesis: parsed.data.anamnesis ?? null,
    findings: parsed.data.findings ?? null,
    assessment: parsed.data.assessment ?? null,
    procedures: parsed.data.procedures ?? null,
    follow_up_at: parsed.data.followUpAt ?? null,
    extra_notes: parsed.data.extraNotes ?? null,
  });
  if (error) routeError(path, writeError(error, "Muayene kaydedilemedi."));
  revalidatePath(`/app/${businessSlug}/patients/${patientId}`);
  redirect(`/app/${businessSlug}/patients/${patientId}?tab=examinations`);
}

const treatmentSchema = z.object({
  procedureName: requiredText(2, 200, "İşlem adı gereklidir."),
  performedAt: localDateTime,
  veterinarianMemberId: z.string().uuid("Veteriner hekim seçin."),
  examinationId: optionalUuid,
  description: optionalText(5000),
  clinicalNote: optionalText(5000),
});

export async function createTreatmentAction(businessSlug: string, patientId: string, formData: FormData) {
  const { business, supabase } = await requireBusinessAccess(businessSlug);
  const path = `/app/${businessSlug}/patients/${patientId}?tab=treatments`;
  const parsed = treatmentSchema.safeParse(formValues(formData));
  if (!parsed.success) routeError(path, firstIssue(parsed.error, "İşlem bilgileri geçersiz."));
  const { error } = await supabase.from("treatments").insert({
    business_id: business.id,
    patient_id: patientId,
    examination_id: parsed.data.examinationId ?? null,
    procedure_name: parsed.data.procedureName,
    performed_at: toInstant(parsed.data.performedAt, business.timezone),
    veterinarian_member_id: parsed.data.veterinarianMemberId,
    description: parsed.data.description ?? null,
    clinical_note: parsed.data.clinicalNote ?? null,
  });
  if (error) routeError(path, writeError(error, "İşlem kaydedilemedi."));
  revalidatePath(`/app/${businessSlug}/patients/${patientId}`);
  redirect(path);
}

const vaccinationSchema = z
  .object({
    vaccineName: requiredText(2, 160, "Aşı adı gereklidir."),
    status: z.enum(["ADMINISTERED", "SCHEDULED"]),
    administeredAt: optionalDate,
    nextDueAt: optionalDate,
    veterinarianMemberId: optionalUuid,
    notes: optionalText(2000),
  })
  .refine((data) => data.status !== "ADMINISTERED" || data.administeredAt, {
    message: "Uygulanan aşı için uygulama tarihi gereklidir.",
  })
  .refine((data) => data.status !== "SCHEDULED" || data.nextDueAt, {
    message: "Planlanan aşı için tarih gereklidir.",
  })
  .refine((data) => !data.administeredAt || !data.nextDueAt || data.nextDueAt >= data.administeredAt, {
    message: "Sonraki tarih uygulama tarihinden önce olamaz.",
  });

export async function createVaccinationAction(businessSlug: string, patientId: string, formData: FormData) {
  const { business, supabase } = await requireBusinessAccess(businessSlug);
  const path = `/app/${businessSlug}/patients/${patientId}?tab=vaccinations`;
  const parsed = vaccinationSchema.safeParse(formValues(formData));
  if (!parsed.success) routeError(path, firstIssue(parsed.error, "Aşı bilgileri geçersiz."));
  const { error } = await supabase.from("vaccinations").insert({
    business_id: business.id,
    patient_id: patientId,
    vaccine_name: parsed.data.vaccineName,
    status: parsed.data.status,
    administered_at: parsed.data.status === "ADMINISTERED" ? parsed.data.administeredAt : null,
    next_due_at: parsed.data.nextDueAt ?? null,
    veterinarian_member_id: parsed.data.veterinarianMemberId ?? null,
    notes: parsed.data.notes ?? null,
  });
  if (error) routeError(path, writeError(error, "Aşı kaydedilemedi."));
  revalidatePath(`/app/${businessSlug}/patients/${patientId}`);
  redirect(path);
}

export async function updateVaccinationStatusAction(
  businessSlug: string,
  patientId: string,
  vaccinationId: string,
  formData: FormData,
) {
  const { business, supabase } = await requireBusinessAccess(businessSlug);
  const path = `/app/${businessSlug}/patients/${patientId}?tab=vaccinations`;
  const status = z.enum(["ADMINISTERED", "CANCELED"]).safeParse(formData.get("status"));
  if (!status.success) routeError(path, "Geçersiz işlem.");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: business.timezone }).format(new Date());
  const { error, count } = await supabase
    .from("vaccinations")
    .update(
      status.data === "ADMINISTERED"
        ? { status: "ADMINISTERED", administered_at: today, next_due_at: null }
        : { status: "CANCELED" },
      { count: "exact" },
    )
    .eq("business_id", business.id)
    .eq("id", vaccinationId)
    .eq("status", "SCHEDULED");
  if (error || !count) routeError(path, "Aşı durumu güncellenemedi.");
  revalidatePath(`/app/${businessSlug}/patients/${patientId}`);
  revalidatePath(`/app/${businessSlug}/vaccinations`);
  redirect(path);
}

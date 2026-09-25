"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireBusinessAccess, type BusinessAccess } from "@/lib/auth/dal";
import {
  estimatedBirthDate,
  firstIssue,
  formValues,
  optionalDate,
  optionalEmail,
  optionalPositiveNumber,
  optionalText,
  optionalUuid,
  requiredText,
} from "@/lib/clinic/forms";

// All writes go through the signed-in user's RLS-bound client; the database decides.
function routeError(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

const ownerSchema = z.object({
  fullName: requiredText(2, 160, "Ad soyad en az 2 karakter olmalıdır."),
  phone: optionalText(40),
  email: optionalEmail,
  address: optionalText(500),
  notes: optionalText(5000),
});

const ownerRow = (data: z.infer<typeof ownerSchema>) => ({
  full_name: data.fullName,
  phone: data.phone ?? null,
  email: data.email ?? null,
  address: data.address ?? null,
  notes: data.notes ?? null,
});

export async function createOwnerAction(businessSlug: string, formData: FormData) {
  const { business, supabase } = await requireBusinessAccess(businessSlug);
  const path = `/app/${businessSlug}/owners/new`;
  const parsed = ownerSchema.safeParse(formValues(formData));
  if (!parsed.success) routeError(path, firstIssue(parsed.error, "Hayvan sahibi bilgileri geçersiz."));
  const { data, error } = await supabase
    .from("owners")
    .insert({ business_id: business.id, ...ownerRow(parsed.data) })
    .select("id")
    .single();
  if (error || !data) routeError(path, "Kayıt oluşturulamadı. Klinik erişiminizi kontrol edin.");
  revalidatePath(`/app/${businessSlug}/owners`);
  redirect(`/app/${businessSlug}/owners/${data.id}`);
}

export async function updateOwnerAction(businessSlug: string, ownerId: string, formData: FormData) {
  const { business, supabase } = await requireBusinessAccess(businessSlug);
  const path = `/app/${businessSlug}/owners/${ownerId}`;
  const parsed = ownerSchema.safeParse(formValues(formData));
  if (!parsed.success) routeError(path, firstIssue(parsed.error, "Hayvan sahibi bilgileri geçersiz."));
  const { error, count } = await supabase
    .from("owners")
    .update(ownerRow(parsed.data), { count: "exact" })
    .eq("business_id", business.id)
    .eq("id", ownerId);
  if (error || !count) routeError(path, "Kayıt güncellenemedi.");
  revalidatePath(path);
  redirect(`${path}?saved=1`);
}

const patientSchema = z
  .object({
    ownerId: optionalUuid,
    newOwnerName: optionalText(160),
    newOwnerPhone: optionalText(40),
    name: requiredText(1, 80, "Hasta adı gereklidir."),
    species: z.enum(["DOG", "CAT", "BIRD", "RABBIT", "RODENT", "REPTILE", "HORSE", "CATTLE", "OTHER"], {
      message: "Tür seçin.",
    }),
    breed: optionalText(100),
    sex: z.enum(["MALE", "FEMALE", "UNKNOWN"]),
    birthDate: optionalDate,
    approximateAge: optionalPositiveNumber(60),
    color: optionalText(80),
    weightKg: optionalPositiveNumber(1999),
    microchipNumber: z.preprocess(
      (value) => (typeof value === "string" ? value.replace(/\s+/g, "") || undefined : value),
      z.string().regex(/^[0-9A-Za-z]{6,23}$/, "Mikroçip numarası 6-23 harf/rakam olmalıdır.").optional(),
    ),
    neuterStatus: z.enum(["INTACT", "NEUTERED", "UNKNOWN"]),
    notes: optionalText(5000),
  })
  .refine((data) => !data.birthDate || data.birthDate <= new Date().toISOString().slice(0, 10), {
    message: "Doğum tarihi ileri bir tarih olamaz.",
  });

function patientRow(data: z.infer<typeof patientSchema>) {
  const birthDate = data.birthDate ?? (data.approximateAge ? estimatedBirthDate(data.approximateAge) : null);
  return {
    name: data.name,
    species: data.species,
    breed: data.breed ?? null,
    sex: data.sex,
    birth_date: birthDate,
    birth_date_estimated: !data.birthDate && !!data.approximateAge,
    color: data.color ?? null,
    weight_kg: data.weightKg ?? null,
    microchip_number: data.microchipNumber ?? null,
    neuter_status: data.neuterStatus,
    notes: data.notes ?? null,
  };
}

const photoTypes: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

// Private bucket, path "<business_id>/<patient_id>/<file>"; storage RLS checks the clinic.
async function storePhoto(access: BusinessAccess, patientId: string, photo: FormDataEntryValue | null) {
  if (!(photo instanceof File) || !photo.size) return null;
  const extension = photoTypes[photo.type];
  if (!extension || photo.size > MAX_PHOTO_BYTES) return "Fotoğraf JPG, PNG veya WEBP ve en fazla 5 MB olmalıdır.";
  const path = `${access.business.id}/${patientId}/${randomUUID()}.${extension}`;
  const { error } = await access.supabase.storage
    .from("patient-photos")
    .upload(path, photo, { contentType: photo.type, upsert: false });
  if (error) return "Fotoğraf yüklenemedi.";
  const { error: updateError } = await access.supabase
    .from("patients")
    .update({ photo_path: path })
    .eq("business_id", access.business.id)
    .eq("id", patientId);
  return updateError ? "Fotoğraf kaydedilemedi." : null;
}

function patientWriteError(error: { code?: string; message?: string }) {
  if (error.code === "23505") return "Bu mikroçip numarası klinikte başka bir hastada kayıtlı.";
  if (error.message?.includes("Birth date")) return "Doğum tarihi ileri bir tarih olamaz.";
  return "Hasta kaydedilemedi. Klinik erişiminizi kontrol edin.";
}

export async function createPatientAction(businessSlug: string, formData: FormData) {
  const access = await requireBusinessAccess(businessSlug);
  const { business, supabase } = access;
  const path = `/app/${businessSlug}/patients/new`;
  const parsed = patientSchema.safeParse(formValues(formData));
  if (!parsed.success) routeError(path, firstIssue(parsed.error, "Hasta bilgileri geçersiz."));

  let ownerId = parsed.data.ownerId;
  if (!ownerId) {
    if (!parsed.data.newOwnerName || parsed.data.newOwnerName.length < 2)
      routeError(path, "Kayıtlı bir hayvan sahibi seçin veya yeni sahibin adını girin.");
    const { data: owner, error } = await supabase
      .from("owners")
      .insert({ business_id: business.id, full_name: parsed.data.newOwnerName, phone: parsed.data.newOwnerPhone ?? null })
      .select("id")
      .single();
    if (error || !owner) routeError(path, "Hayvan sahibi kaydedilemedi.");
    ownerId = owner.id;
  }

  const { data, error } = await supabase
    .from("patients")
    .insert({ business_id: business.id, owner_id: ownerId, ...patientRow(parsed.data) })
    .select("id")
    .single();
  if (error || !data) routeError(path, patientWriteError(error ?? {}));
  const photoError = await storePhoto(access, data.id, formData.get("photo"));
  revalidatePath(`/app/${businessSlug}/patients`);
  redirect(`/app/${businessSlug}/patients/${data.id}${photoError ? `?error=${encodeURIComponent(photoError)}` : ""}`);
}

export async function updatePatientAction(businessSlug: string, patientId: string, formData: FormData) {
  const access = await requireBusinessAccess(businessSlug);
  const path = `/app/${businessSlug}/patients/${patientId}/edit`;
  const parsed = patientSchema.safeParse(formValues(formData));
  if (!parsed.success) routeError(path, firstIssue(parsed.error, "Hasta bilgileri geçersiz."));
  const status = z.enum(["ACTIVE", "DECEASED", "ARCHIVED"]).safeParse(formData.get("status"));
  // An estimated birth date is not echoed back into the form; keep it unless a new value is given.
  const { birth_date, birth_date_estimated, ...row } = patientRow(parsed.data);
  const birth = parsed.data.birthDate || parsed.data.approximateAge ? { birth_date, birth_date_estimated } : {};
  const { error, count } = await access.supabase
    .from("patients")
    .update(
      {
        ...row,
        ...birth,
        ...(parsed.data.ownerId ? { owner_id: parsed.data.ownerId } : {}),
        ...(status.success ? { status: status.data } : {}),
      },
      { count: "exact" },
    )
    .eq("business_id", access.business.id)
    .eq("id", patientId);
  if (error || !count) routeError(path, patientWriteError(error ?? {}));
  const photoError = await storePhoto(access, patientId, formData.get("photo"));
  revalidatePath(`/app/${businessSlug}/patients/${patientId}`);
  redirect(`/app/${businessSlug}/patients/${patientId}${photoError ? `?error=${encodeURIComponent(photoError)}` : "?saved=1"}`);
}

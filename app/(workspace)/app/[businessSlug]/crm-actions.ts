"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireBusinessAccess } from "@/lib/auth/dal";

const optionalText = (maximum: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().max(maximum).optional(),
  );

const optionalNumber = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.coerce.number().nonnegative().optional(),
);

const leadSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    phone: optionalText(40),
    email: z.preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
      z.string().trim().email().max(254).optional(),
    ),
    city: optionalText(100),
    district: optionalText(100),
    priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]),
    preferredContactMethod: z
      .enum(["WHATSAPP", "PHONE", "EMAIL", ""])
      .transform((value) => value || undefined),
    whatsappAllowed: z.string().optional(),
    callAllowed: z.string().optional(),
    assignedMemberId: z
      .union([z.string().uuid(), z.literal("")])
      .transform((value) => value || null),
  })
  .refine((data) => data.phone || data.email, {
    message: "Telefon veya e-posta bilgilerinden en az biri gereklidir.",
  });

const listingSchema = z.object({
  title: z.string().trim().min(3).max(240),
  propertyType: z.string().trim().min(2).max(80),
  transactionType: z.enum(["SALE", "RENT"]),
  price: optionalNumber,
  currency: z.enum(["TRY", "USD", "EUR"]),
  city: optionalText(100),
  district: optionalText(100),
  neighborhood: optionalText(100),
  grossArea: optionalNumber,
  netArea: optionalNumber,
  roomCount: optionalText(30),
  description: optionalText(5000),
  assignedMemberId: z
    .union([z.string().uuid(), z.literal("")])
    .transform((value) => value || null),
  ownerName: optionalText(160),
  ownerPhone: optionalText(40),
  sourceUrl: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().url("İlan linki geçerli bir adres olmalıdır.").max(2000).regex(/^https?:\/\//).optional(),
  ),
}).refine((data) => !data.ownerName === !data.ownerPhone, {
  message: "İlan sahibi için ad ve telefonu birlikte girin.",
});

function routeError(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

export async function createLeadAction(businessSlug: string, formData: FormData) {
  const access = await requireBusinessAccess(businessSlug);
  const path = `/app/${businessSlug}/leads/new`;
  const parsed = leadSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success)
    routeError(path, parsed.error.issues[0]?.message ?? "Lead bilgileri geçersiz.");

  const assignedMemberId =
    access.membership.role === "ADVISOR"
      ? access.membership.id
      : parsed.data.assignedMemberId;
  const { data, error } = await access.supabase
    .from("leads")
    .insert({
      business_id: access.business.id,
      assigned_member_id: assignedMemberId,
      name: parsed.data.name,
      phone: parsed.data.phone,
      email: parsed.data.email,
      city: parsed.data.city,
      district: parsed.data.district,
      priority: parsed.data.priority,
      preferred_contact_method: parsed.data.preferredContactMethod,
      whatsapp_allowed: parsed.data.whatsappAllowed === "on",
      call_allowed: parsed.data.callAllowed === "on",
      source: "MANUAL",
    })
    .select("id")
    .single();
  if (error || !data) routeError(path, "Lead kaydedilemedi. Ofis yetkilerini kontrol edin.");

  revalidatePath(`/app/${businessSlug}`);
  redirect(`/app/${businessSlug}/leads/${data.id}`);
}

export async function createListingAction(businessSlug: string, formData: FormData) {
  const access = await requireBusinessAccess(businessSlug);
  const path = `/app/${businessSlug}/listings/new`;
  const parsed = listingSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success)
    routeError(path, parsed.error.issues[0]?.message ?? "İlan bilgileri geçersiz.");

  const assignedMemberId =
    access.membership.role === "ADVISOR"
      ? access.membership.id
      : parsed.data.assignedMemberId;
  let ownerLeadId: string | null = null;
  if (parsed.data.ownerName && parsed.data.ownerPhone) {
    const { data: owner, error: ownerError } = await access.supabase
      .from("leads")
      .insert({
        business_id: access.business.id,
        assigned_member_id: assignedMemberId,
        name: parsed.data.ownerName,
        phone: parsed.data.ownerPhone,
        city: parsed.data.city,
        district: parsed.data.district,
        source: "MANUAL",
        source_url: parsed.data.sourceUrl,
        contact_role: "OWNER",
        preferred_contact_method: "WHATSAPP",
      })
      .select("id")
      .single();
    if (ownerError || !owner) routeError(path, "İlan sahibi kaydedilemedi.");
    ownerLeadId = owner.id;
  }
  const { data, error } = await access.supabase
    .from("listings")
    .insert({
      business_id: access.business.id,
      assigned_member_id: assignedMemberId,
      title: parsed.data.title,
      property_type: parsed.data.propertyType,
      transaction_type: parsed.data.transactionType,
      price: parsed.data.price,
      currency: parsed.data.currency,
      city: parsed.data.city,
      district: parsed.data.district,
      neighborhood: parsed.data.neighborhood,
      gross_area: parsed.data.grossArea,
      net_area: parsed.data.netArea,
      room_count: parsed.data.roomCount,
      description: parsed.data.description,
      source: "MANUAL",
      source_url: parsed.data.sourceUrl,
      owner_lead_id: ownerLeadId,
    })
    .select("id")
    .single();
  if (error || !data) routeError(path, "İlan kaydedilemedi. Ofis yetkilerini kontrol edin.");

  revalidatePath(`/app/${businessSlug}`);
  redirect(`/app/${businessSlug}/listings/${data.id}`);
}

export async function updateLeadStatusAction(
  businessSlug: string,
  leadId: string,
  formData: FormData,
) {
  const access = await requireBusinessAccess(businessSlug);
  const parsed = z.enum([
    "NEW",
    "REVIEWING",
    "APPROVED",
    "CONTACTED",
    "QUALIFIED",
    "APPOINTMENT_SCHEDULED",
    "WON",
    "LOST",
    "ARCHIVED",
  ]).safeParse(formData.get("status"));
  const path = `/app/${businessSlug}/leads/${leadId}`;
  if (!parsed.success) routeError(path, "Durum seçimi geçersiz.");

  const { error } = await access.supabase.rpc("update_lead_status", {
    target_lead_id: leadId,
    next_status: parsed.data,
  });
  if (error) routeError(path, "Bu durum geçişine izin verilmiyor.");
  revalidatePath(path);
  revalidatePath(`/app/${businessSlug}/leads`);
}

export async function assignLeadAction(
  businessSlug: string,
  leadId: string,
  formData: FormData,
) {
  const access = await requireBusinessAccess(businessSlug);
  const parsed = z.union([z.string().uuid(), z.literal("")]).safeParse(formData.get("memberId"));
  const path = `/app/${businessSlug}/leads/${leadId}`;
  if (!parsed.success) routeError(path, "Danışman seçimi geçersiz.");
  const { error } = await access.supabase.rpc("assign_lead", {
    target_lead_id: leadId,
    target_member_id: parsed.data || null,
  });
  if (error) routeError(path, "Lead danışmana atanamadı.");
  revalidatePath(path);
  revalidatePath(`/app/${businessSlug}/leads`);
}

export async function addLeadNoteAction(
  businessSlug: string,
  leadId: string,
  formData: FormData,
) {
  const access = await requireBusinessAccess(businessSlug);
  const parsed = z.string().trim().min(1).max(5000).safeParse(formData.get("content"));
  const path = `/app/${businessSlug}/leads/${leadId}`;
  if (!parsed.success) routeError(path, "Not 1–5000 karakter arasında olmalıdır.");
  const { error } = await access.supabase.from("notes").insert({
    business_id: access.business.id,
    lead_id: leadId,
    content: parsed.data,
  });
  if (error) routeError(path, "Not kaydedilemedi.");
  revalidatePath(path);
}

export async function linkLeadListingAction(
  businessSlug: string,
  leadId: string,
  formData: FormData,
) {
  const access = await requireBusinessAccess(businessSlug);
  const parsed = z.string().uuid().safeParse(formData.get("listingId"));
  const path = `/app/${businessSlug}/leads/${leadId}`;
  if (!parsed.success) routeError(path, "İlan seçimi geçersiz.");
  const { error } = await access.supabase.from("lead_listings").insert({
    business_id: access.business.id,
    lead_id: leadId,
    listing_id: parsed.data,
  });
  if (error) routeError(path, "İlan eşleştirilemedi veya daha önce eşleştirilmiş.");
  revalidatePath(path);
}

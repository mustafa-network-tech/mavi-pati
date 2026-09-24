import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { SLUG_PATTERN } from "@/lib/slug";
import { database } from "@/lib/supabase/server";

const optionalText = (maximum: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().max(maximum).optional(),
  );

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Ofis adresi en az 3 karakter olmalıdır.")
  .max(80)
  .regex(SLUG_PATTERN, "Ofis adresi yalnızca küçük harf, rakam ve tire içerebilir.");

export const registrationSchema = z.discriminatedUnion("accountType", [
  z.object({
    accountType: z.literal("OFFICE_ADMIN"),
    displayName: z.string().trim().min(2, "Ofis adı en az 2 karakter olmalıdır.").max(160),
    slug: slugSchema,
    phone: optionalText(30),
    officeEmail: z.preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
      z.string().trim().email("Geçerli bir ofis e-postası girin.").optional(),
    ),
  }),
  z.object({
    accountType: z.literal("ADVISOR"),
    officeSlug: slugSchema,
  }),
]);

export type Registration = z.infer<typeof registrationSchema>;

export function parseRegistration(input: Record<string, unknown>) {
  const parsed = registrationSchema.safeParse(input);
  if (parsed.success) return { registration: parsed.data };
  return { error: parsed.error.issues[0]?.message ?? "Bilgileri kontrol edin." };
}

// Early feedback before the account exists; the database functions re-check everything.
export async function checkRegistrationTarget(registration: Registration) {
  const slug =
    registration.accountType === "OFFICE_ADMIN" ? registration.slug : registration.officeSlug;
  const { data: business } = await database(true)
    .from("businesses")
    .select("status,access_starts_at,access_expires_at")
    .eq("slug", slug)
    .maybeSingle();

  if (registration.accountType === "OFFICE_ADMIN")
    return business ? "Bu ofis adresi kullanılıyor. Başka bir adres seçin." : null;

  const now = Date.now();
  const operational =
    business &&
    ["TRIAL", "ACTIVE"].includes(business.status) &&
    (!business.access_starts_at || Date.parse(business.access_starts_at) <= now) &&
    (!business.access_expires_at || Date.parse(business.access_expires_at) > now);
  return operational ? null : "Bu adreste aktif bir emlak ofisi bulunamadı.";
}

function registrationError(registration: Registration, error: { code?: string; message?: string }) {
  if (error.message?.includes("Advisor limit reached"))
    return "Ofisin danışman kotası dolu. Ofis yöneticinizle görüşün.";
  if (error.code === "P0002") return "Bu adreste aktif bir emlak ofisi bulunamadı.";
  if (error.code === "23505")
    return registration.accountType === "OFFICE_ADMIN"
      ? "Bu ofis adresi kullanılıyor veya zaten bir ofise bağlısınız."
      : "Zaten bir ofise bağlısınız veya bu ofise daha önce başvurdunuz.";
  return "Başvuru kaydedilemedi. Lütfen tekrar deneyin.";
}

export async function submitRegistration(supabase: SupabaseClient, registration: Registration) {
  const { error } =
    registration.accountType === "OFFICE_ADMIN"
      ? await supabase.rpc("submit_business_application", {
          requested_display_name: registration.displayName,
          requested_slug: registration.slug,
          requested_phone: registration.phone ?? null,
          requested_email: registration.officeEmail ?? null,
        })
      : await supabase.rpc("request_advisor_membership", {
          requested_slug: registration.officeSlug,
        });
  if (error) return registrationError(registration, error);

  await supabase.auth.updateUser({ data: { registration: null } });
  return null;
}

// Completes the office application or advisor request chosen on the register form,
// once the user has a session (right after sign-up, email confirmation or login).
export async function finalizePendingRegistration(supabase: SupabaseClient) {
  const { data } = await supabase.auth.getUser();
  const pending = data.user?.user_metadata?.registration;
  if (!pending) return null;

  const { data: memberships } = await supabase
    .from("business_members")
    .select("id")
    .eq("user_id", data.user!.id)
    .neq("status", "REVOKED")
    .limit(1);
  const parsed = registrationSchema.safeParse(pending);
  if (memberships?.length || !parsed.success) {
    await supabase.auth.updateUser({ data: { registration: null } });
    return null;
  }
  return submitRegistration(supabase, parsed.data);
}

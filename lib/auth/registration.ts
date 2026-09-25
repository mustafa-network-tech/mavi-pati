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
  .min(3, "Klinik adresi en az 3 karakter olmalıdır.")
  .max(80)
  .regex(SLUG_PATTERN, "Klinik adresi yalnızca küçük harf, rakam ve tire içerebilir.");

// Registrations started before the MK Pati transition are stored in user metadata
// with the real-estate names; they map onto the clinic roles.
function upgradeLegacyRegistration(value: unknown) {
  if (!value || typeof value !== "object") return value;
  const input = value as Record<string, unknown>;
  if (input.accountType === "OFFICE_ADMIN")
    return { ...input, accountType: "CLINIC_ADMIN", clinicEmail: input.clinicEmail ?? input.officeEmail };
  if (input.accountType === "ADVISOR")
    return { accountType: "CLINIC_MEMBER", memberRole: "VETERINARIAN", clinicSlug: input.officeSlug };
  return value;
}

export const registrationSchema = z.preprocess(
  upgradeLegacyRegistration,
  z.discriminatedUnion("accountType", [
    z.object({
      accountType: z.literal("CLINIC_ADMIN"),
      displayName: z.string().trim().min(2, "Klinik adı en az 2 karakter olmalıdır.").max(160),
      slug: slugSchema,
      phone: optionalText(30),
      clinicEmail: z.preprocess(
        (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
        z.string().trim().email("Geçerli bir klinik e-postası girin.").optional(),
      ),
    }),
    z.object({
      accountType: z.literal("PET_OWNER"),
      inviteToken: z.string().regex(/^[0-9a-f]{64}$/, "Davet bağlantısı geçersiz."),
    }),
    z.object({
      accountType: z.literal("CLINIC_MEMBER"),
      memberRole: z.enum(["VETERINARIAN", "CLINIC_STAFF"], { message: "Kliniğe katılım rolünü seçin." }),
      clinicSlug: slugSchema,
    }),
  ]),
);

export type Registration = z.infer<typeof registrationSchema>;

export function parseRegistration(input: Record<string, unknown>) {
  const parsed = registrationSchema.safeParse(input);
  if (parsed.success) return { registration: parsed.data };
  return { error: parsed.error.issues[0]?.message ?? "Bilgileri kontrol edin." };
}

// Early feedback before the account exists; the database functions re-check everything.
export async function checkRegistrationTarget(registration: Registration) {
  if (registration.accountType === "PET_OWNER") {
    const { data } = await database(true).rpc("owner_invitation_clinic", { invite_token: registration.inviteToken });
    return data ? null : "Davet geçersiz veya süresi dolmuş. Kliniğinizden yeni davet isteyin.";
  }
  const slug = registration.accountType === "CLINIC_ADMIN" ? registration.slug : registration.clinicSlug;
  const { data: business } = await database(true)
    .from("businesses")
    .select("status,access_starts_at,access_expires_at")
    .eq("slug", slug)
    .maybeSingle();

  if (registration.accountType === "CLINIC_ADMIN")
    return business ? "Bu klinik adresi kullanılıyor. Başka bir adres seçin." : null;

  const now = Date.now();
  const operational =
    business &&
    ["TRIAL", "ACTIVE"].includes(business.status) &&
    (!business.access_starts_at || Date.parse(business.access_starts_at) <= now) &&
    (!business.access_expires_at || Date.parse(business.access_expires_at) > now);
  return operational ? null : "Bu adreste aktif bir veteriner kliniği bulunamadı.";
}

function registrationError(registration: Registration, error: { code?: string; message?: string }) {
  if (registration.accountType === "PET_OWNER")
    return error.code === "23505"
      ? "Bu davet başka bir hesaba bağlanmış."
      : "Davet kabul edilemedi. Kliniğinizden yeni davet isteyin.";
  if (error.message?.includes("Seat limit reached"))
    return "Kliniğin bu rol için kullanıcı kotası dolu. Klinik yöneticinizle görüşün.";
  if (error.code === "P0002") return "Bu adreste aktif bir veteriner kliniği bulunamadı.";
  if (error.code === "23505")
    return registration.accountType === "CLINIC_ADMIN"
      ? "Bu klinik adresi kullanılıyor veya zaten bir kliniğe bağlısınız."
      : "Zaten bir kliniğe bağlısınız veya bu kliniğe daha önce başvurdunuz.";
  return "Başvuru kaydedilemedi. Lütfen tekrar deneyin.";
}

export async function submitRegistration(supabase: SupabaseClient, registration: Registration) {
  const { error } =
    registration.accountType === "PET_OWNER"
      ? await supabase.rpc("accept_owner_invitation", { invite_token: registration.inviteToken })
      : registration.accountType === "CLINIC_ADMIN"
      ? await supabase.rpc("submit_business_application", {
          requested_display_name: registration.displayName,
          requested_slug: registration.slug,
          requested_phone: registration.phone ?? null,
          requested_email: registration.clinicEmail ?? null,
        })
      : await supabase.rpc("request_clinic_membership", {
          requested_slug: registration.clinicSlug,
          requested_role: registration.memberRole,
        });
  if (error) return registrationError(registration, error);

  await supabase.auth.updateUser({ data: { registration: null } });
  return null;
}

// Where to show a registration error: owners go back to their invitation.
export function registrationErrorPath(registration: Registration, message: string) {
  const base = registration.accountType === "PET_OWNER" ? `/invite/${registration.inviteToken}` : "/apply";
  return `${base}?error=${encodeURIComponent(message)}`;
}

// Completes the clinic application, join request or owner invitation chosen at sign-up,
// once the user has a session (right after sign-up, email confirmation or login).
// Returns the path to redirect to when it fails, otherwise null.
export async function finalizePendingRegistration(supabase: SupabaseClient) {
  const { data } = await supabase.auth.getUser();
  const pending = data.user?.user_metadata?.registration;
  if (!pending) return null;

  const [{ data: memberships }, { data: portalAccounts }] = await Promise.all([
    supabase.from("business_members").select("id").eq("user_id", data.user!.id).neq("status", "REVOKED").limit(1),
    supabase.from("owner_portal_accounts").select("id").eq("user_id", data.user!.id).eq("status", "ACTIVE").limit(1),
  ]);
  const parsed = registrationSchema.safeParse(pending);
  if (memberships?.length || portalAccounts?.length || !parsed.success) {
    await supabase.auth.updateUser({ data: { registration: null } });
    return null;
  }
  const error = await submitRegistration(supabase, parsed.data);
  return error ? registrationErrorPath(parsed.data, error) : null;
}

import "server-only";

import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAuthServerClient } from "@/lib/supabase/auth-server";

export const verifySession = cache(async () => {
  const supabase = await createAuthServerClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || !userId) return null;
  return { userId, claims: data.claims, supabase };
});

export async function requireSession() {
  const session = await verifySession();
  if (!session) redirect("/login");
  return session;
}

export async function requirePlatformAdmin() {
  const session = await requireSession();
  const { data } = await session.supabase
    .from("platform_users")
    .select("user_id,status")
    .eq("user_id", session.userId)
    .eq("status", "ACTIVE")
    .maybeSingle();
  if (!data) redirect("/app");
  return session;
}

export type ClinicMembership = { id: string; role: string; status: string };
export type ClinicBusiness = {
  id: string;
  slug: string;
  display_name: string;
  status: string;
  timezone: string;
  access_starts_at: string | null;
  access_expires_at: string | null;
};
export type BusinessAccess = {
  userId: string;
  supabase: SupabaseClient;
  business: ClinicBusiness;
  membership: ClinicMembership;
};

// Reads with the signed-in user's RLS-bound client; null when the user has no membership.
// Route handlers use this directly; pages use requireBusinessAccess.
export const getBusinessAccess = cache(async (slug: string): Promise<BusinessAccess | null> => {
  const session = await verifySession();
  if (!session) return null;
  const { data: business } = await session.supabase
    .from("businesses")
    .select("id,slug,display_name,status,timezone,access_starts_at,access_expires_at")
    .eq("slug", slug)
    .maybeSingle();
  if (!business) return null;

  const { data: membership } = await session.supabase
    .from("business_members")
    .select("id,role,status")
    .eq("business_id", business.id)
    .eq("user_id", session.userId)
    .maybeSingle();
  if (!membership || membership.status === "REVOKED") return null;
  return { userId: session.userId, supabase: session.supabase, business, membership };
});

export async function requireBusinessAccess(slug: string) {
  await requireSession();
  const access = await getBusinessAccess(slug);
  if (!access) notFound();
  return access;
}

export type ClinicEntitlements = {
  max_veterinarians: number;
  max_staff: number;
  clinic_enabled: boolean;
  appointments_enabled: boolean;
  ai_assistant_enabled: boolean;
  ai_voice_enabled: boolean;
  reports_enabled: boolean;
  owner_portal_enabled: boolean;
  monthly_ai_request_limit: number;
  valid_until: string | null;
};

export const getEntitlements = cache(async (supabase: SupabaseClient, businessId: string) => {
  const { data } = await supabase
    .from("business_entitlements")
    .select(
      "max_veterinarians,max_staff,clinic_enabled,appointments_enabled,ai_assistant_enabled,ai_voice_enabled,reports_enabled,owner_portal_enabled,monthly_ai_request_limit,valid_until",
    )
    .eq("business_id", businessId)
    .maybeSingle();
  return data as ClinicEntitlements | null;
});

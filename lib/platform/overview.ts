import "server-only";

import { database } from "@/lib/supabase/server";

export type ClinicOverview = {
  business_id: string;
  display_name: string;
  slug: string;
  status: string;
  access_expires_at: string | null;
  clinic_admins: number;
  veterinarians: number;
  staff: number;
  pending_members: number;
  max_veterinarians: number;
  max_staff: number;
  owners: number;
  patients: number;
  appointments_this_month: number;
  ai_assistant_enabled: boolean;
  ai_voice_enabled: boolean;
  ai_request_limit: number;
  ai_requests_this_month: number;
  ai_voice_requests_this_month: number;
  ai_tokens_this_month: number;
  owner_portal_enabled: boolean;
  portal_accounts: number;
  pending_owner_requests: number;
  ai_owner_requests_this_month: number;
};

// Aggregates only (no patient content). The RPC re-checks the platform admin itself.
export async function loadClinicOverview(platformUserId: string) {
  const { data, error } = await database(true).rpc("platform_clinic_overview", {
    actor_platform_user_id: platformUserId,
  });
  if (error) throw error;
  return ((data ?? []) as ClinicOverview[]).map((row) => ({
    ...row,
    ai_requests_this_month: Number(row.ai_requests_this_month),
    ai_voice_requests_this_month: Number(row.ai_voice_requests_this_month),
    ai_tokens_this_month: Number(row.ai_tokens_this_month),
    ai_owner_requests_this_month: Number(row.ai_owner_requests_this_month),
  }));
}

export const businessStatusLabels: Record<string, string> = {
  PENDING: "Onay bekliyor",
  TRIAL: "Deneme",
  ACTIVE: "Aktif",
  SUSPENDED: "Askıda",
  EXPIRED: "Süresi dolmuş",
  REJECTED: "Reddedildi",
};

export function expiringWithin(clinics: ClinicOverview[], days: number, now = Date.now()) {
  const limit = now + days * 86_400_000;
  return clinics.filter(
    (clinic) =>
      ["TRIAL", "ACTIVE"].includes(clinic.status) &&
      clinic.access_expires_at &&
      Date.parse(clinic.access_expires_at) < limit,
  );
}

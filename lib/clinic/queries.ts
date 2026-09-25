import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type TeamMember = { id: string; userId: string; role: string; status: string; name: string };

// Members visible to the caller under RLS (active colleagues; admins also see requests).
export async function loadTeam(supabase: SupabaseClient, businessId: string): Promise<TeamMember[]> {
  const { data: members } = await supabase
    .from("business_members")
    .select("id,user_id,role,status,created_at")
    .eq("business_id", businessId)
    .order("created_at");
  const userIds = (members ?? []).map((member) => member.user_id as string);
  const { data: profiles } = userIds.length
    ? await supabase.from("profiles").select("user_id,full_name").in("user_id", userIds)
    : { data: [] };
  const names = new Map((profiles ?? []).map((profile) => [profile.user_id as string, profile.full_name as string]));
  return (members ?? []).map((member) => ({
    id: member.id,
    userId: member.user_id,
    role: member.role,
    status: member.status,
    name: names.get(member.user_id) ?? "Kullanıcı",
  }));
}

export function practitioners(team: TeamMember[]) {
  return team.filter(
    (member) => member.status === "ACTIVE" && (member.role === "VETERINARIAN" || member.role === "CLINIC_ADMIN"),
  );
}

export function memberNameMap(team: TeamMember[]) {
  return new Map(team.map((member) => [member.id, member.name]));
}

export function isOperational(business: { status: string; access_starts_at: string | null; access_expires_at: string | null }) {
  const now = Date.now();
  return (
    ["TRIAL", "ACTIVE"].includes(business.status) &&
    (!business.access_starts_at || Date.parse(business.access_starts_at) <= now) &&
    (!business.access_expires_at || Date.parse(business.access_expires_at) > now)
  );
}

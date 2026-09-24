import "server-only";

import { cache } from "react";
import { notFound, redirect } from "next/navigation";
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

export async function requireBusinessAccess(slug: string) {
  const session = await requireSession();
  const { data: business } = await session.supabase
    .from("businesses")
    .select("id,slug,display_name,status,timezone,access_starts_at,access_expires_at")
    .eq("slug", slug)
    .maybeSingle();
  if (!business) notFound();

  const { data: membership } = await session.supabase
    .from("business_members")
    .select("id,role,status")
    .eq("business_id", business.id)
    .eq("user_id", session.userId)
    .maybeSingle();
  if (!membership || membership.status === "REVOKED") notFound();
  return { ...session, business, membership };
}

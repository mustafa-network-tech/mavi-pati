import "server-only";

import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { verifySession } from "@/lib/auth/dal";
import { loadOwnerOverview, type OwnerAccess } from "@/lib/owner-portal/overview";

export type { OwnerAccess, OwnerOverview } from "@/lib/owner-portal/overview";

// A pet owner has at most one active portal account (enforced by a unique index).
export const getOwnerAccess = cache(async (): Promise<OwnerAccess | null> => {
  const session = await verifySession();
  if (!session) return null;
  const { data } = await session.supabase
    .from("owner_portal_accounts")
    .select("business_id,owner_id")
    .eq("user_id", session.userId)
    .eq("status", "ACTIVE")
    .maybeSingle();
  if (!data) return null;
  return { userId: session.userId, supabase: session.supabase, businessId: data.business_id, ownerId: data.owner_id };
});

export async function requireOwnerPortal() {
  const session = await verifySession();
  if (!session) redirect("/login");
  const access = await getOwnerAccess();
  if (!access) notFound();
  const overview = await loadOwnerOverview(access);
  return { access, overview };
}

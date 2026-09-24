import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/dal";

export const dynamic = "force-dynamic";

export default async function WorkspaceEntryPage() {
  const session = await requireSession();
  const { data: platformUser } = await session.supabase
    .from("platform_users")
    .select("user_id")
    .eq("user_id", session.userId)
    .eq("status", "ACTIVE")
    .maybeSingle();
  if (platformUser) redirect("/platform");

  const { data: memberships } = await session.supabase
    .from("business_members")
    .select("business_id,status,created_at")
    .neq("status", "REVOKED")
    .order("created_at", { ascending: true })
    .limit(1);
  const membership = memberships?.[0];
  if (!membership) redirect("/apply");

  const { data: business } = await session.supabase
    .from("businesses")
    .select("slug")
    .eq("id", membership.business_id)
    .maybeSingle();
  if (!business) redirect("/apply");
  redirect(`/app/${business.slug}/dashboard`);
}

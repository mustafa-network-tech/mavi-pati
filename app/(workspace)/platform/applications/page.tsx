import { BusinessApprovalForm } from "@/components/platform/BusinessApprovalForm";
import { requirePlatformAdmin } from "@/lib/auth/dal";
import { database } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function loadApplicants(businessIds: string[]) {
  const applicants = new Map<string, string>();
  if (!businessIds.length) return applicants;
  const admin = database(true);
  const { data: members } = await admin
    .from("business_members")
    .select("business_id,user_id")
    .in("business_id", businessIds)
    .eq("role", "OFFICE_ADMIN");
  const userIds = (members ?? []).map((member) => member.user_id);
  const { data: profiles } = userIds.length
    ? await admin.from("profiles").select("user_id,full_name").in("user_id", userIds)
    : { data: [] };
  const names = new Map(profiles?.map((profile) => [profile.user_id, profile.full_name]));
  await Promise.all(
    (members ?? []).map(async (member) => {
      const { data } = await admin.auth.admin.getUserById(member.user_id);
      const name = names.get(member.user_id) ?? "Kullanıcı";
      applicants.set(member.business_id, data.user?.email ? `${name} (${data.user.email})` : name);
    }),
  );
  return applicants;
}

export default async function ApplicationsPage() {
  await requirePlatformAdmin();
  const { data: businesses, error } = await database(true)
    .from("businesses")
    .select("id,display_name,slug,email,phone,created_at")
    .eq("status", "PENDING")
    .order("created_at", { ascending: true });
  if (error) throw error;
  const applicants = await loadApplicants((businesses ?? []).map((business) => business.id));
  return (
    <div className="workspace-page">
      <header className="workspace-header"><div><p className="saas-kicker">Platform</p><h1>Başvurular</h1></div></header>
      <div className="application-list">
        {(businesses ?? []).map((business) => (
          <article className="application-card" key={business.id}>
            <div><small>OFİS BAŞVURUSU</small><h2>{business.display_name}</h2><p>/{business.slug} · {business.email || business.phone || "İletişim bilgisi yok"}</p><p>Başvuran: {applicants.get(business.id) ?? "Bilinmiyor"}</p></div>
            <BusinessApprovalForm businessId={business.id} />
          </article>
        ))}
        {!businesses?.length && <section className="notice-card"><strong>Bekleyen başvuru yok.</strong></section>}
      </div>
    </div>
  );
}

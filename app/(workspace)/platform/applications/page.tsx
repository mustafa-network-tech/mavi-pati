import { BusinessApprovalForm } from "@/components/platform/BusinessApprovalForm";
import { requirePlatformAdmin } from "@/lib/auth/dal";
import { database } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ApplicationsPage() {
  await requirePlatformAdmin();
  const { data: businesses, error } = await database(true)
    .from("businesses")
    .select("id,display_name,slug,email,phone,created_at")
    .eq("status", "PENDING")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (
    <div className="workspace-page">
      <header className="workspace-header"><div><p className="saas-kicker">Platform</p><h1>Başvurular</h1></div></header>
      <div className="application-list">
        {(businesses ?? []).map((business) => (
          <article className="application-card" key={business.id}>
            <div><small>OFİS BAŞVURUSU</small><h2>{business.display_name}</h2><p>/{business.slug} · {business.email || business.phone || "İletişim bilgisi yok"}</p></div>
            <BusinessApprovalForm businessId={business.id} />
          </article>
        ))}
        {!businesses?.length && <section className="notice-card"><strong>Bekleyen başvuru yok.</strong></section>}
      </div>
    </div>
  );
}

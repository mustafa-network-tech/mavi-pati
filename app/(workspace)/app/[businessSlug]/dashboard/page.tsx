import { requireBusinessAccess } from "@/lib/auth/dal";

export const dynamic = "force-dynamic";

const statusLabels: Record<string, string> = {
  PENDING: "Onay bekliyor",
  TRIAL: "Deneme kullanımı",
  ACTIVE: "Aktif",
  SUSPENDED: "Askıya alınmış",
  EXPIRED: "Süresi dolmuş",
  REJECTED: "Reddedilmiş",
};

export default async function BusinessDashboard({
  params,
}: {
  params: Promise<{ businessSlug: string }>;
}) {
  const { business, membership, supabase } = await requireBusinessAccess(
    (await params).businessSlug,
  );
  const { data: entitlement } = await supabase
    .from("business_entitlements")
    .select(
      "max_advisors,crm_enabled,appointments_enabled,whatsapp_enabled,ai_analysis_enabled,ai_voice_enabled,imports_enabled,reports_enabled",
    )
    .eq("business_id", business.id)
    .maybeSingle();
  const [leadCount, listingCount, appointmentCount] = await Promise.all([
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("business_id", business.id).neq("status", "ARCHIVED"),
    supabase.from("listings").select("id", { count: "exact", head: true }).eq("business_id", business.id).neq("status", "ARCHIVED"),
    supabase.from("appointments").select("id", { count: "exact", head: true }).eq("business_id", business.id),
  ]);

  const pending = business.status === "PENDING";
  return (
    <div className="workspace-page">
      <header className="workspace-header">
        <div>
          <p className="saas-kicker">Ofis çalışma alanı</p>
          <h1>{business.display_name}</h1>
        </div>
        <span className={`status-pill status-${business.status.toLowerCase()}`}>
          {statusLabels[business.status] ?? business.status}
        </span>
      </header>

      {pending ? (
        <section className="notice-card">
          <strong>Başvurunuz Platform Admin incelemesinde.</strong>
          <p>
            Ofis aktif edilene, kullanım süresi ve haklar tanımlanana kadar CRM
            işlemleri kapalıdır.
          </p>
        </section>
      ) : (
        <section className="metric-grid">
          <article>
            <small>Aktif lead</small>
            <strong>{leadCount.count ?? 0}</strong>
          </article>
          <article>
            <small>İlan</small>
            <strong>{listingCount.count ?? 0}</strong>
          </article>
          <article>
            <small>Randevu</small>
            <strong>{appointmentCount.count ?? 0}</strong>
          </article>
          <article>
            <small>Rol / danışman limiti</small>
            <strong>{membership.role === "OFFICE_ADMIN" ? "Yönetici" : "Danışman"} · {entitlement?.max_advisors ?? 0}</strong>
          </article>
        </section>
      )}

      <section className="module-placeholder">
        <p className="saas-kicker">CRM çekirdeği</p>
        <h2>Lead ve ilan akışına başlayın</h2>
        <p>
          Potansiyel müşterileri inceleyin, danışmana atayın, onaylayın ve
          portföydeki ilanlarla eşleştirin. İletişim ve randevu modülleri
          yetkilendirme durumunuza göre devreye alınır.
        </p>
      </section>
    </div>
  );
}

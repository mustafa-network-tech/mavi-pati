import { database } from "@/lib/supabase/server";
import { requirePlatformAdmin } from "@/lib/auth/dal";

export const dynamic = "force-dynamic";

export default async function PlatformDashboard() {
  await requirePlatformAdmin();
  const { data: businesses, error } = await database(true)
    .from("businesses")
    .select("status");
  if (error) throw error;
  const totals = new Map<string, number>();
  for (const business of businesses ?? [])
    totals.set(business.status, (totals.get(business.status) ?? 0) + 1);

  return (
    <div className="workspace-page">
      <header className="workspace-header">
        <div>
          <p className="saas-kicker">Platform kontrol merkezi</p>
          <h1>Dashboard</h1>
        </div>
      </header>
      <section className="metric-grid">
        <article>
          <small>Toplam ofis</small>
          <strong>{businesses?.length ?? 0}</strong>
        </article>
        <article>
          <small>Aktif</small>
          <strong>{totals.get("ACTIVE") ?? 0}</strong>
        </article>
        <article>
          <small>Trial</small>
          <strong>{totals.get("TRIAL") ?? 0}</strong>
        </article>
        <article>
          <small>Bekleyen</small>
          <strong>{totals.get("PENDING") ?? 0}</strong>
        </article>
      </section>
      <section className="module-placeholder">
        <p className="saas-kicker">Platform ayrımı</p>
        <h2>Platform Admin tenant rolü değildir</h2>
        <p>
          Ofis onayı, süre, limit ve entitlement işlemleri ayrı ve audit edilen
          server operasyonları olarak eklenecek.
        </p>
      </section>
    </div>
  );
}

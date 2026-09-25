import Link from "next/link";
import { signOutAction } from "@/app/(auth)/actions";
import { getEntitlements, requireBusinessAccess } from "@/lib/auth/dal";
import { roleLabel } from "@/lib/clinic/roles";

export const dynamic = "force-dynamic";

export default async function BusinessLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ businessSlug: string }>;
}) {
  const { businessSlug } = await params;
  const { business, membership, supabase } = await requireBusinessAccess(businessSlug);
  if (membership.role !== "CLINIC_ADMIN" && membership.status !== "ACTIVE")
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <p className="saas-kicker">{business.display_name}</p>
          <h1>
            {membership.status === "PENDING"
              ? "Onay bekleniyor"
              : "Hesabınız pasif"}
          </h1>
          <p>
            {membership.status === "PENDING"
              ? "Katılım isteğiniz klinik yöneticisine iletildi. Onaylandığında çalışma alanınız açılacak."
              : "Hesabınız klinik yöneticisi tarafından pasife alındı."}
          </p>
          <form action={signOutAction} className="saas-form">
            <button className="saas-secondary">Çıkış yap</button>
          </form>
        </section>
      </main>
    );
  const entitlement = await getEntitlements(supabase, business.id);
  const { count: pendingRequests } = entitlement?.owner_portal_enabled
    ? await supabase
        .from("owner_requests")
        .select("id", { count: "exact", head: true })
        .eq("business_id", business.id)
        .eq("status", "PENDING")
    : { count: 0 };
  const base = `/app/${business.slug}`;
  return (
    <main className="workspace-shell">
      <aside className="workspace-sidebar">
        <Link href={`${base}/dashboard`} className="saas-logo inverse">
          <span>MK</span> Pati
        </Link>
        <p className="workspace-product">Veteriner Klinik Yönetim Sistemi</p>
        <div className="workspace-business">
          <strong>{business.display_name}</strong>
          <small>{roleLabel(membership.role)}</small>
        </div>
        <nav>
          <Link href={`${base}/dashboard`}>Dashboard</Link>
          {entitlement?.appointments_enabled && <Link href={`${base}/appointments`}>Randevular</Link>}
          <Link href={`${base}/patients`}>Hastalar</Link>
          <Link href={`${base}/owners`}>Hayvan Sahipleri</Link>
          <Link href={`${base}/vaccinations`}>Aşı Takibi</Link>
          {entitlement?.owner_portal_enabled && (
            <Link href={`${base}/requests`} className="nav-with-badge">
              Sahip Talepleri
              {!!pendingRequests && <span className="nav-badge" aria-label={`${pendingRequests} bekleyen talep`}>{pendingRequests}</span>}
            </Link>
          )}
          {entitlement?.ai_assistant_enabled && <Link href={`${base}/assistant`}>MK Pati AI</Link>}
          <Link href={`${base}/settings`}>Ayarlar</Link>
        </nav>
        <form action={signOutAction}>
          <button className="workspace-signout">Çıkış yap</button>
        </form>
      </aside>
      <section className="workspace-content">{children}</section>
    </main>
  );
}

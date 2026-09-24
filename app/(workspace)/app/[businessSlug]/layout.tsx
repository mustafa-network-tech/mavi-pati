import Link from "next/link";
import { signOutAction } from "@/app/(auth)/actions";
import { requireBusinessAccess } from "@/lib/auth/dal";

export const dynamic = "force-dynamic";

export default async function BusinessLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ businessSlug: string }>;
}) {
  const { businessSlug } = await params;
  const { business, membership } = await requireBusinessAccess(businessSlug);
  if (membership.role === "ADVISOR" && membership.status !== "ACTIVE")
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
              ? "Danışman katılım isteğiniz ofis yöneticisine iletildi. Onaylandığında çalışma alanınız açılacak."
              : "Danışman hesabınız ofis yöneticisi tarafından pasife alındı."}
          </p>
          <form action={signOutAction} className="saas-form">
            <button className="saas-secondary">Çıkış yap</button>
          </form>
        </section>
      </main>
    );
  return (
    <main className="workspace-shell">
      <aside className="workspace-sidebar">
        <Link
          href={`/app/${business.slug}/dashboard`}
          className="saas-logo inverse"
        >
          <span>MK</span> Emlak
        </Link>
        <div className="workspace-business">
          <strong>{business.display_name}</strong>
          <small>
            {membership.role === "OFFICE_ADMIN"
              ? "Ofis Yöneticisi"
              : "Danışman"}
          </small>
        </div>
        <nav>
          <Link href={`/app/${business.slug}/dashboard`}>Dashboard</Link>
          <Link href={`/app/${business.slug}/leads`}>Potansiyel Müşteriler</Link>
          <Link href={`/app/${business.slug}/listings`}>İlanlar</Link>
          <Link href={`/app/${business.slug}/calls`}>AI Aramalar</Link>
          <Link href={`/app/${business.slug}/whatsapp`}>WhatsApp</Link>
          <Link href={`/app/${business.slug}/appointments`}>Randevular</Link>
          <Link href={`/app/${business.slug}/conversations`}>Görüşme Geçmişi</Link>
          <Link href={`/app/${business.slug}/settings`}>Ayarlar</Link>
          {membership.role === "OFFICE_ADMIN" && (
            <span className="workspace-planned">
              Danışmanlar<small>Yakında</small>
            </span>
          )}
        </nav>
        <form action={signOutAction}>
          <button className="workspace-signout">Çıkış yap</button>
        </form>
      </aside>
      <section className="workspace-content">{children}</section>
    </main>
  );
}

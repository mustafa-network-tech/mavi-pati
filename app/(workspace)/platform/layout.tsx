import Link from "next/link";
import { signOutAction } from "@/app/(auth)/actions";
import { requirePlatformAdmin } from "@/lib/auth/dal";

export const dynamic = "force-dynamic";

export default async function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePlatformAdmin();
  return (
    <main className="workspace-shell platform-shell">
      <aside className="workspace-sidebar">
        <Link href="/platform" className="saas-logo inverse">
          <span>MK</span> Platform
        </Link>
        <div className="workspace-business">
          <strong>Platform Yönetimi</strong>
          <small>PLATFORM_ADMIN</small>
        </div>
        <nav>
          <Link href="/platform">Dashboard</Link>
          <Link href="/platform/businesses">Emlak Ofisleri</Link>
          <Link href="/platform/applications">Başvurular</Link>
          <Link href="/platform/audit">Audit Log</Link>
        </nav>
        <form action={signOutAction}>
          <button className="workspace-signout">Çıkış yap</button>
        </form>
      </aside>
      <section className="workspace-content">{children}</section>
    </main>
  );
}

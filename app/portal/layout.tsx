import Link from "next/link";
import { signOutAction } from "@/app/(auth)/actions";
import { requireOwnerPortal } from "@/lib/owner-portal/access";

export const dynamic = "force-dynamic";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const { overview } = await requireOwnerPortal();
  return (
    <main className="portal-shell">
      <header className="portal-header">
        <Link href="/portal" className="saas-logo"><span>MK</span> Pati</Link>
        <div className="portal-identity">
          <strong>{overview?.clinic.display_name ?? "Klinik"}</strong>
          <small>{overview?.owner.full_name}</small>
        </div>
        <form action={signOutAction}><button className="secondary-button">Çıkış yap</button></form>
      </header>
      <section className="portal-content">{children}</section>
    </main>
  );
}

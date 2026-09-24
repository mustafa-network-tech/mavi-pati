import Link from "next/link";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="auth-shell">
      <Link href="/" className="saas-logo">
        <span>MK</span> Emlak Asistanı
      </Link>
      {children}
    </main>
  );
}

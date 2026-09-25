import Link from "next/link";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="auth-shell">
      <Link href="/" className="saas-logo">
        <span>MK</span> Pati
      </Link>
      {children}
    </main>
  );
}

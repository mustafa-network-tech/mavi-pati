import Link from "next/link";

export default function NotFound() {
  return (
    <main className="auth-shell">
      <Link href="/" className="saas-logo">
        <span>MK</span> Pati
      </Link>
      <section className="auth-card">
        <p className="saas-kicker">404</p>
        <h1>Sayfa bulunamadı</h1>
        <p>Aradığınız sayfa mevcut değil veya taşınmış olabilir.</p>
        <Link href="/" className="saas-primary">
          Ana sayfaya dön
        </Link>
      </section>
    </main>
  );
}

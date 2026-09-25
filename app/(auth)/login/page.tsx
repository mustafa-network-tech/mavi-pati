import { AuthForm } from "@/components/auth/AuthForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[]; next?: string | string[] }>;
}) {
  const { error, next } = await searchParams;
  return (
    <section className="auth-card">
      <p className="saas-kicker">Güvenli çalışma alanı</p>
      <h1>Tekrar hoş geldiniz</h1>
      <p>Klinik çalışma alanınıza veya hayvan sahibi portalınıza giriş yapın.</p>
      <AuthForm
        mode="login"
        error={typeof error === "string" ? error : undefined}
        next={typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : undefined}
      />
    </section>
  );
}

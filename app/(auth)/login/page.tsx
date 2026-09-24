import { AuthForm } from "@/components/auth/AuthForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const { error } = await searchParams;
  return (
    <section className="auth-card">
      <p className="saas-kicker">Güvenli çalışma alanı</p>
      <h1>Tekrar hoş geldiniz</h1>
      <p>Ofisinizin lead, ilan ve randevu süreçlerine devam edin.</p>
      <AuthForm mode="login" error={typeof error === "string" ? error : undefined} />
    </section>
  );
}

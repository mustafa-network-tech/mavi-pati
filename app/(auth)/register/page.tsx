import { AuthForm } from "@/components/auth/AuthForm";

export default function RegisterPage() {
  return (
    <section className="auth-card">
      <p className="saas-kicker">Kayıt</p>
      <h1>MK Pati’ye katılın</h1>
      <p>
        Kliniğinizi açın veya çalıştığınız kliniğe veteriner hekim ya da
        personel olarak katılın.
      </p>
      <AuthForm mode="register" />
    </section>
  );
}

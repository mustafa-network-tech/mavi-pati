import { AuthForm } from "@/components/auth/AuthForm";

export default function RegisterPage() {
  return (
    <section className="auth-card">
      <p className="saas-kicker">Kayıt</p>
      <h1>MK Emlak’a katılın</h1>
      <p>
        Yeni emlak ofisinizi açın veya çalıştığınız ofise danışman olarak
        katılın.
      </p>
      <AuthForm mode="register" />
    </section>
  );
}

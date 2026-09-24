import { AuthForm } from "@/components/auth/AuthForm";

export default function RegisterPage() {
  return (
    <section className="auth-card">
      <p className="saas-kicker">Ofis başvurusu</p>
      <h1>MK Emlak’a katılın</h1>
      <p>
        Önce hesabınızı oluşturun, ardından emlak ofisi başvurunuzu tamamlayın.
      </p>
      <AuthForm mode="register" />
    </section>
  );
}

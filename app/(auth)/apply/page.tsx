import { BusinessApplicationForm } from "@/components/auth/BusinessApplicationForm";
import { requireSession } from "@/lib/auth/dal";

export const dynamic = "force-dynamic";

export default async function ApplyPage() {
  await requireSession();
  return (
    <section className="auth-card">
      <p className="saas-kicker">Emlak ofisi başvurusu</p>
      <h1>Ofisinizi tanımlayın</h1>
      <p>
        Başvurunuz Platform Admin onayından sonra TRIAL veya ACTIVE olarak
        açılır.
      </p>
      <BusinessApplicationForm />
    </section>
  );
}

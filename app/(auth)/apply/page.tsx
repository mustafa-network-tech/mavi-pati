import { BusinessApplicationForm } from "@/components/auth/BusinessApplicationForm";
import { requireSession } from "@/lib/auth/dal";

export const dynamic = "force-dynamic";

export default async function ApplyPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  await requireSession();
  const { error } = await searchParams;
  return (
    <section className="auth-card">
      <p className="saas-kicker">Klinik başvurusu</p>
      <h1>Kliniğinizi seçin</h1>
      <p>
        Yeni klinik başvuruları Platform Admin, hekim ve personel katılım
        istekleri klinik yöneticisi tarafından onaylanır.
      </p>
      <BusinessApplicationForm error={typeof error === "string" ? error : undefined} />
    </section>
  );
}

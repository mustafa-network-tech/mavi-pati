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
      <p className="saas-kicker">Ofis başvurusu</p>
      <h1>Ofisinizi seçin</h1>
      <p>
        Yeni ofis başvuruları Platform Admin, danışman katılım istekleri ofis
        yöneticisi tarafından onaylanır.
      </p>
      <BusinessApplicationForm error={typeof error === "string" ? error : undefined} />
    </section>
  );
}

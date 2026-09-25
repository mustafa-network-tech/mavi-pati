import Link from "next/link";
import { OwnerFields } from "@/components/clinic/OwnerFields";
import { requireBusinessAccess } from "@/lib/auth/dal";
import { createOwnerAction } from "../../clinic-actions";

export const dynamic = "force-dynamic";

export default async function NewOwnerPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessSlug: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { businessSlug } = await params;
  const query = await searchParams;
  await requireBusinessAccess(businessSlug);
  return (
    <div className="workspace-page narrow-page">
      <header className="workspace-header">
        <div><p className="saas-kicker">Hayvan sahipleri</p><h1>Yeni hayvan sahibi</h1></div>
        <Link className="text-link" href={`/app/${businessSlug}/owners`}>Listeye dön</Link>
      </header>
      <form action={createOwnerAction.bind(null, businessSlug)} className="record-form">
        {query.error && <p className="form-message error">{query.error}</p>}
        <OwnerFields />
        <p className="form-hint">İletişim bilgileri yalnızca kliniğinizin kullanıcıları tarafından görülebilir ve MK Pati AI’a gönderilmez.</p>
        <button className="saas-primary">Kaydet</button>
      </form>
    </div>
  );
}

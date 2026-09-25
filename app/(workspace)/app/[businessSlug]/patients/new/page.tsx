import Link from "next/link";
import { PatientFields } from "@/components/clinic/PatientFields";
import { requireBusinessAccess } from "@/lib/auth/dal";
import { createPatientAction } from "../../clinic-actions";

export const dynamic = "force-dynamic";

export default async function NewPatientPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessSlug: string }>;
  searchParams: Promise<{ error?: string; owner?: string }>;
}) {
  const { businessSlug } = await params;
  const query = await searchParams;
  const { business, supabase } = await requireBusinessAccess(businessSlug);
  const { data: owners } = await supabase
    .from("owners")
    .select("id,full_name,phone")
    .eq("business_id", business.id)
    .is("archived_at", null)
    .order("full_name")
    .limit(1000);
  return (
    <div className="workspace-page narrow-page">
      <header className="workspace-header">
        <div><p className="saas-kicker">Hastalar</p><h1>Yeni hasta</h1></div>
        <Link className="text-link" href={`/app/${businessSlug}/patients`}>Listeye dön</Link>
      </header>
      <form action={createPatientAction.bind(null, businessSlug)} className="record-form">
        {query.error && <p className="form-message error">{query.error}</p>}
        <PatientFields owners={owners ?? []} selectedOwnerId={query.owner} allowNewOwner />
        <button className="saas-primary">Hastayı kaydet</button>
      </form>
    </div>
  );
}

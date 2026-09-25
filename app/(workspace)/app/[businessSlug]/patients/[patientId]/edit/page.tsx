import Link from "next/link";
import { notFound } from "next/navigation";
import { PatientFields } from "@/components/clinic/PatientFields";
import { requireBusinessAccess } from "@/lib/auth/dal";
import { updatePatientAction } from "../../../clinic-actions";

export const dynamic = "force-dynamic";

export default async function EditPatientPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessSlug: string; patientId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { businessSlug, patientId } = await params;
  const query = await searchParams;
  const { business, supabase } = await requireBusinessAccess(businessSlug);
  const [{ data: patient }, { data: owners }] = await Promise.all([
    supabase
      .from("patients")
      .select("id,owner_id,name,species,breed,sex,birth_date,birth_date_estimated,color,weight_kg,microchip_number,neuter_status,notes,status")
      .eq("business_id", business.id)
      .eq("id", patientId)
      .maybeSingle(),
    supabase.from("owners").select("id,full_name,phone").eq("business_id", business.id).is("archived_at", null).order("full_name").limit(1000),
  ]);
  if (!patient) notFound();
  return (
    <div className="workspace-page narrow-page">
      <header className="workspace-header">
        <div><p className="saas-kicker">Hasta</p><h1>{patient.name} · düzenle</h1></div>
        <Link className="text-link" href={`/app/${businessSlug}/patients/${patient.id}`}>Hastaya dön</Link>
      </header>
      <form action={updatePatientAction.bind(null, businessSlug, patient.id)} className="record-form">
        {query.error && <p className="form-message error">{query.error}</p>}
        <PatientFields patient={patient} owners={owners ?? []} allowNewOwner={false} />
        <button className="saas-primary">Değişiklikleri kaydet</button>
      </form>
    </div>
  );
}

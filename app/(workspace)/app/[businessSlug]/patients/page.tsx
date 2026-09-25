import Link from "next/link";
import { requireBusinessAccess } from "@/lib/auth/dal";
import { ageLabel, label, patientStatusLabels, speciesLabels } from "@/lib/clinic/labels";

export const dynamic = "force-dynamic";

const searchTerm = (value: string | undefined) => value?.replace(/[,()*%\\]/g, " ").trim().slice(0, 80) ?? "";

export default async function PatientsPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessSlug: string }>;
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const { businessSlug } = await params;
  const query = await searchParams;
  const q = searchTerm(query.q);
  const status = ["ACTIVE", "DECEASED", "ARCHIVED"].includes(query.status ?? "") ? query.status! : "ACTIVE";
  const { business, supabase } = await requireBusinessAccess(businessSlug);
  let patientsQuery = supabase
    .from("patients")
    .select("id,name,species,breed,sex,birth_date,birth_date_estimated,microchip_number,status,owner_id")
    .eq("business_id", business.id)
    .eq("status", status)
    .order("name")
    .limit(300);
  if (q) patientsQuery = patientsQuery.or(`name.ilike.*${q}*,microchip_number.ilike.*${q.replace(/\s/g, "")}*,breed.ilike.*${q}*`);
  const { data: patients } = await patientsQuery;
  const ownerIds = [...new Set((patients ?? []).map((patient) => patient.owner_id))];
  const { data: owners } = ownerIds.length
    ? await supabase.from("owners").select("id,full_name,phone").eq("business_id", business.id).in("id", ownerIds)
    : { data: [] };
  const ownerMap = new Map((owners ?? []).map((owner) => [owner.id, owner]));

  return (
    <div className="workspace-page">
      <header className="workspace-header">
        <div>
          <p className="saas-kicker">Kayıtlar</p>
          <h1>Hastalar</h1>
          <p className="page-subtitle">Kliniğinize kayıtlı patiler.</p>
        </div>
        <Link className="saas-primary" href={`/app/${businessSlug}/patients/new`}>Yeni hasta</Link>
      </header>
      <form className="inline-form search-form" role="search">
        <input name="q" defaultValue={q} placeholder="Ad, ırk veya mikroçip ile ara" aria-label="Hasta ara" />
        <select name="status" defaultValue={status} aria-label="Kayıt durumu">
          {Object.entries(patientStatusLabels).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
        </select>
        <button className="secondary-button">Filtrele</button>
      </form>
      <div className="data-table-wrap top-gap">
        <table className="data-table">
          <thead><tr><th>Hasta</th><th>Tür / ırk</th><th>Yaş</th><th>Sahibi</th><th>Mikroçip</th></tr></thead>
          <tbody>
            {patients?.map((patient) => {
              const owner = ownerMap.get(patient.owner_id);
              return (
                <tr key={patient.id}>
                  <td><Link className="table-link" href={`/app/${businessSlug}/patients/${patient.id}`}><strong>{patient.name}</strong></Link></td>
                  <td>{label(speciesLabels, patient.species)}<small>{patient.breed}</small></td>
                  <td>{ageLabel(patient.birth_date, patient.birth_date_estimated)}</td>
                  <td>{owner ? <Link className="table-link" href={`/app/${businessSlug}/owners/${owner.id}`}>{owner.full_name}</Link> : "—"}<small>{owner?.phone}</small></td>
                  <td>{patient.microchip_number ?? "—"}</td>
                </tr>
              );
            })}
            {!patients?.length && <tr><td colSpan={5} className="empty-cell">{q ? "Aramaya uygun hasta yok." : "Bu durumda hasta kaydı yok."}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

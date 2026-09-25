import Link from "next/link";
import { requireBusinessAccess } from "@/lib/auth/dal";
import { formatDate, label, speciesLabels } from "@/lib/clinic/labels";
import { addDays, localDateString } from "@/lib/time";

export const dynamic = "force-dynamic";

const windows: Record<string, number> = { "7": 7, "30": 30, "90": 90 };

export default async function VaccinationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessSlug: string }>;
  searchParams: Promise<{ days?: string }>;
}) {
  const { businessSlug } = await params;
  const days = windows[(await searchParams).days ?? ""] ?? 30;
  const { business, supabase } = await requireBusinessAccess(businessSlug);
  const today = localDateString(business.timezone);
  const { data: vaccinations } = await supabase
    .from("vaccinations")
    .select("id,patient_id,vaccine_name,status,next_due_at,administered_at")
    .eq("business_id", business.id)
    .in("status", ["SCHEDULED", "ADMINISTERED"])
    .gte("next_due_at", addDays(today, -90))
    .lte("next_due_at", addDays(today, days))
    .order("next_due_at")
    .limit(500);
  const patientIds = [...new Set((vaccinations ?? []).map((item) => item.patient_id))];
  const { data: patients } = patientIds.length
    ? await supabase.from("patients").select("id,name,species,owner_id,status").eq("business_id", business.id).in("id", patientIds)
    : { data: [] };
  const ownerIds = [...new Set((patients ?? []).map((patient) => patient.owner_id))];
  const { data: owners } = ownerIds.length
    ? await supabase.from("owners").select("id,full_name,phone").eq("business_id", business.id).in("id", ownerIds)
    : { data: [] };
  const patientMap = new Map((patients ?? []).map((patient) => [patient.id as string, patient]));
  const ownerMap = new Map((owners ?? []).map((owner) => [owner.id as string, owner]));
  const rows = (vaccinations ?? []).filter((item) => patientMap.get(item.patient_id)?.status === "ACTIVE");
  const overdue = rows.filter((item) => item.next_due_at < today);
  const upcoming = rows.filter((item) => item.next_due_at >= today);

  const table = (items: typeof rows, empty: string) => (
    <div className="data-table-wrap embedded-table">
      <table className="data-table">
        <thead><tr><th>Tarih</th><th>Hasta</th><th>Aşı</th><th>Sahibi</th></tr></thead>
        <tbody>
          {items.map((item) => {
            const patient = patientMap.get(item.patient_id);
            const owner = patient ? ownerMap.get(patient.owner_id) : undefined;
            return (
              <tr key={item.id}>
                <td><strong>{formatDate(item.next_due_at)}</strong><small>{item.status === "SCHEDULED" ? "Planlandı" : `Son uygulama ${formatDate(item.administered_at)}`}</small></td>
                <td>{patient ? <Link className="table-link" href={`/app/${businessSlug}/patients/${patient.id}?tab=vaccinations`}><strong>{patient.name}</strong></Link> : "—"}<small>{label(speciesLabels, patient?.species)}</small></td>
                <td>{item.vaccine_name}</td>
                <td>{owner?.full_name ?? "—"}<small>{owner?.phone}</small></td>
              </tr>
            );
          })}
          {!items.length && <tr><td colSpan={4} className="empty-cell">{empty}</td></tr>}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="workspace-page">
      <header className="workspace-header">
        <div><p className="saas-kicker">Takip</p><h1>Aşı takibi</h1><p className="page-subtitle">Gecikmiş (son 90 gün) ve önümüzdeki {days} gün içindeki aşılar.</p></div>
        <nav className="tab-bar compact" aria-label="Zaman aralığı">
          {Object.keys(windows).map((key) => (
            <Link key={key} href={`/app/${businessSlug}/vaccinations?days=${key}`} aria-current={String(days) === key ? "page" : undefined}>{key} gün</Link>
          ))}
        </nav>
      </header>
      <section className="panel-card">
        <div className="panel-heading"><div><p className="saas-kicker">Öncelikli</p><h2>Gecikmiş aşılar ({overdue.length})</h2></div></div>
        {table(overdue, "Gecikmiş aşı yok.")}
      </section>
      <section className="panel-card top-gap">
        <div className="panel-heading"><div><p className="saas-kicker">Planlı</p><h2>Yaklaşan aşılar ({upcoming.length})</h2></div></div>
        {table(upcoming, "Bu aralıkta yaklaşan aşı yok.")}
      </section>
    </div>
  );
}

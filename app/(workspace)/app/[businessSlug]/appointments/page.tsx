import Link from "next/link";
import { notFound } from "next/navigation";
import { getEntitlements, requireBusinessAccess } from "@/lib/auth/dal";
import { appointmentStatusLabels, appointmentTransitions, formatDate, formatTime, label, speciesLabels } from "@/lib/clinic/labels";
import { loadTeam, memberNameMap, practitioners } from "@/lib/clinic/queries";
import { addDays, localDateString, zonedDayRange } from "@/lib/time";
import { updateAppointmentStatusAction } from "../appointment-actions";

export const dynamic = "force-dynamic";

const actionLabels: Record<string, string> = {
  CONFIRMED: "Onayla",
  CHECKED_IN: "Geldi",
  COMPLETED: "Tamamla",
  CANCELED: "İptal",
  NO_SHOW: "Gelmedi",
};

export default async function AppointmentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessSlug: string }>;
  searchParams: Promise<{ date?: string; vet?: string; error?: string }>;
}) {
  const { businessSlug } = await params;
  const query = await searchParams;
  const { business, supabase } = await requireBusinessAccess(businessSlug);
  const entitlement = await getEntitlements(supabase, business.id);
  if (!entitlement?.appointments_enabled) notFound();
  const zone = business.timezone;
  const today = localDateString(zone);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(query.date ?? "") ? query.date! : today;
  const range = zonedDayRange(date, zone);
  const team = await loadTeam(supabase, business.id);
  const vets = practitioners(team);
  const vetFilter = vets.some((vet) => vet.id === query.vet) ? query.vet : undefined;

  let appointmentsQuery = supabase
    .from("appointments")
    .select("id,patient_id,owner_id,veterinarian_member_id,starts_at,ends_at,status,reason,notes")
    .eq("business_id", business.id)
    .gte("starts_at", range.start)
    .lt("starts_at", range.end)
    .order("starts_at");
  if (vetFilter) appointmentsQuery = appointmentsQuery.eq("veterinarian_member_id", vetFilter);
  const { data: appointments } = await appointmentsQuery;
  const patientIds = [...new Set((appointments ?? []).map((item) => item.patient_id))];
  const ownerIds = [...new Set((appointments ?? []).map((item) => item.owner_id))];
  const [{ data: patients }, { data: owners }] = await Promise.all([
    patientIds.length ? supabase.from("patients").select("id,name,species").eq("business_id", business.id).in("id", patientIds) : Promise.resolve({ data: [] }),
    ownerIds.length ? supabase.from("owners").select("id,full_name,phone").eq("business_id", business.id).in("id", ownerIds) : Promise.resolve({ data: [] }),
  ]);
  const patientMap = new Map((patients ?? []).map((patient) => [patient.id as string, patient]));
  const ownerMap = new Map((owners ?? []).map((owner) => [owner.id as string, owner]));
  const names = memberNameMap(team);
  const self = `/app/${businessSlug}/appointments?date=${date}${vetFilter ? `&vet=${vetFilter}` : ""}`;
  const dayLink = (value: string) => `/app/${businessSlug}/appointments?date=${value}${vetFilter ? `&vet=${vetFilter}` : ""}`;

  return (
    <div className="workspace-page">
      <header className="workspace-header">
        <div><p className="saas-kicker">Takvim</p><h1>Randevular</h1><p className="page-subtitle">{formatDate(date)} · saatler {zone} saat dilimindedir.</p></div>
        <Link className="saas-primary" href={`/app/${businessSlug}/appointments/new`}>Yeni randevu</Link>
      </header>
      {query.error && <p className="form-message error">{query.error}</p>}
      <div className="calendar-toolbar">
        <Link className="secondary-button" href={dayLink(addDays(date, -1))}>← Önceki gün</Link>
        <Link className="secondary-button" href={dayLink(today)}>Bugün</Link>
        <Link className="secondary-button" href={dayLink(addDays(date, 1))}>Sonraki gün →</Link>
        <form className="inline-form">
          <input type="date" name="date" defaultValue={date} aria-label="Tarih" />
          <select name="vet" defaultValue={vetFilter ?? ""} aria-label="Veteriner hekim">
            <option value="">Tüm hekimler</option>
            {vets.map((vet) => <option key={vet.id} value={vet.id}>{vet.name}</option>)}
          </select>
          <button className="secondary-button">Göster</button>
        </form>
      </div>
      <div className="data-table-wrap top-gap">
        <table className="data-table">
          <thead><tr><th>Saat</th><th>Hasta</th><th>Sahibi</th><th>Veteriner hekim</th><th>Açıklama</th><th>Durum</th><th /></tr></thead>
          <tbody>
            {appointments?.map((appointment) => {
              const patient = patientMap.get(appointment.patient_id);
              const owner = ownerMap.get(appointment.owner_id);
              const update = updateAppointmentStatusAction.bind(null, businessSlug, appointment.id, self);
              return (
                <tr key={appointment.id}>
                  <td><strong>{formatTime(appointment.starts_at, zone)}</strong><small>{formatTime(appointment.ends_at, zone)}</small></td>
                  <td>{patient ? <Link className="table-link" href={`/app/${businessSlug}/patients/${patient.id}`}><strong>{patient.name}</strong></Link> : "—"}<small>{label(speciesLabels, patient?.species)}</small></td>
                  <td>{owner?.full_name ?? "—"}<small>{owner?.phone}</small></td>
                  <td>{appointment.veterinarian_member_id ? names.get(appointment.veterinarian_member_id) ?? "Veteriner hekim" : "Atanmadı"}</td>
                  <td>{appointment.reason}{appointment.notes && <small>{appointment.notes}</small>}</td>
                  <td><span className={`record-status status-${appointment.status.toLowerCase()}`}>{label(appointmentStatusLabels, appointment.status)}</span></td>
                  <td>
                    <form action={update} className="inline-actions">
                      {(appointmentTransitions[appointment.status] ?? []).map((status) => (
                        <button key={status} className="table-action" name="status" value={status}>{actionLabels[status]}</button>
                      ))}
                    </form>
                  </td>
                </tr>
              );
            })}
            {!appointments?.length && <tr><td colSpan={7} className="empty-cell">Bu gün için randevu yok.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

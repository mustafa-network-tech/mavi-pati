import Link from "next/link";
import { requireBusinessAccess } from "@/lib/auth/dal";
import { cancelAppointmentAction } from "../engagement-actions";

export const dynamic = "force-dynamic";

export default async function AppointmentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessSlug: string }>;
  searchParams: Promise<{ created?: string; error?: string }>;
}) {
  const { businessSlug } = await params;
  const query = await searchParams;
  const { business, supabase } = await requireBusinessAccess(businessSlug);
  const { data: appointments } = await supabase.from("appointments").select("id,lead_id,listing_id,title,starts_at,ends_at,location,status").eq("business_id", business.id).order("starts_at", { ascending: true }).limit(300);
  const leadIds = [...new Set(appointments?.map((item) => item.lead_id) ?? [])];
  const { data: leads } = leadIds.length ? await supabase.from("leads").select("id,name,phone").in("id", leadIds) : { data: [] };
  const leadMap = new Map(leads?.map((lead) => [lead.id, lead]));
  return (
    <div className="workspace-page">
      <header className="workspace-header"><div><p className="saas-kicker">Takvim</p><h1>Randevular</h1><p className="page-subtitle">Lead, ilan ve sorumlu danışmanla ilişkili randevular.</p></div><Link className="saas-primary" href={`/app/${businessSlug}/appointments/new`}>Yeni randevu</Link></header>
      {query.created && <p className="form-message success">Randevu oluşturuldu.</p>}{query.error && <p className="form-message error">{query.error}</p>}
      <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Randevu</th><th>Lead</th><th>Tarih</th><th>Konum</th><th>Durum</th><th /></tr></thead><tbody>{appointments?.map((appointment) => { const lead = leadMap.get(appointment.lead_id); const cancelAction = cancelAppointmentAction.bind(null, businessSlug, appointment.id); return <tr key={appointment.id}><td><strong>{appointment.title}</strong></td><td><Link className="table-link" href={`/app/${businessSlug}/leads/${appointment.lead_id}`}>{lead?.name ?? "Lead"}</Link><small>{lead?.phone}</small></td><td>{new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(appointment.starts_at))}<small>{new Intl.DateTimeFormat("tr-TR", { timeStyle: "short" }).format(new Date(appointment.ends_at))}</small></td><td>{appointment.location ?? "—"}</td><td><span className={`record-status status-${appointment.status.toLowerCase()}`}>{appointment.status}</span></td><td>{appointment.status !== "CANCELED" && appointment.status !== "COMPLETED" ? <form action={cancelAction}><input type="hidden" name="reason" value="Kullanıcı tarafından iptal edildi" /><button className="table-action">İptal</button></form> : null}</td></tr>; })}{!appointments?.length && <tr><td colSpan={6} className="empty-cell">Henüz randevu yok.</td></tr>}</tbody></table></div>
    </div>
  );
}

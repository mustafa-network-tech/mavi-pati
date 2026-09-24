import Link from "next/link";
import { requireBusinessAccess } from "@/lib/auth/dal";
import {
  cancelAppointmentAction,
  cancelAppointmentSlotAction,
  createAppointmentSlotAction,
} from "../engagement-actions";

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
  const { business, membership, supabase } = await requireBusinessAccess(businessSlug);
  const isOfficeAdmin = membership.role === "OFFICE_ADMIN" && membership.status === "ACTIVE";
  const [{ data: slots }, { data: members }] = await Promise.all([
    supabase.from("appointment_slots").select("id,member_id,starts_at,ends_at,status").eq("business_id", business.id).neq("status", "CANCELED").gte("ends_at", new Date().toISOString()).order("starts_at").limit(200),
    supabase.from("business_members").select("id,user_id,role").eq("business_id", business.id).eq("status", "ACTIVE").in("role", ["OFFICE_ADMIN", "ADVISOR"]),
  ]);
  const memberUserIds = members?.map((member) => member.user_id) ?? [];
  const { data: memberProfiles } = memberUserIds.length ? await supabase.from("profiles").select("user_id,full_name").in("user_id", memberUserIds) : { data: [] };
  const memberNames = new Map(members?.map((member) => [member.id, `${memberProfiles?.find((profile) => profile.user_id === member.user_id)?.full_name ?? "Kullanıcı"} (${member.role === "OFFICE_ADMIN" ? "Ofis yöneticisi" : "Danışman"})`]));
  const slotFormat = new Intl.DateTimeFormat("tr-TR", { timeZone: business.timezone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const createSlot = createAppointmentSlotAction.bind(null, businessSlug);
  const { data: appointments } = await supabase.from("appointments").select("id,lead_id,listing_id,title,starts_at,ends_at,location,status").eq("business_id", business.id).order("starts_at", { ascending: true }).limit(300);
  const leadIds = [...new Set(appointments?.map((item) => item.lead_id) ?? [])];
  const { data: leads } = leadIds.length ? await supabase.from("leads").select("id,name,phone").in("id", leadIds) : { data: [] };
  const leadMap = new Map(leads?.map((lead) => [lead.id, lead]));
  return (
    <div className="workspace-page">
      <header className="workspace-header"><div><p className="saas-kicker">Takvim</p><h1>Randevular</h1><p className="page-subtitle">Lead, ilan ve sorumlu danışmanla ilişkili randevular.</p></div><Link className="saas-primary" href={`/app/${businessSlug}/appointments/new`}>Yeni randevu</Link></header>
      {query.created && <p className="form-message success">Randevu oluşturuldu.</p>}{query.error && <p className="form-message error">{query.error}</p>}
      <section className="panel-card">
        <div className="panel-heading"><div><p className="saas-kicker">Müsaitlik</p><h2>Randevu slotları</h2></div></div>
        <p className="form-hint">AI yalnızca buradaki müsait slotları önerebilir ve rezerve edebilir. Saatler {business.timezone} saat dilimindedir.</p>
        {isOfficeAdmin && (
          <form action={createSlot} className="inline-form slot-form top-gap">
            <select name="memberId" required defaultValue={membership.id}>{members?.map((member) => <option key={member.id} value={member.id}>{memberNames.get(member.id)}</option>)}</select>
            <input name="startsAt" type="datetime-local" required aria-label="Başlangıç" />
            <select name="durationMinutes" defaultValue="60" aria-label="Süre"><option value="30">30 dk</option><option value="45">45 dk</option><option value="60">60 dk</option><option value="90">90 dk</option><option value="120">120 dk</option></select>
            <button className="saas-primary">Slot ekle</button>
          </form>
        )}
        <div className="data-table-wrap embedded-table top-gap"><table className="data-table"><thead><tr><th>Zaman</th><th>Kişi</th><th>Durum</th><th /></tr></thead><tbody>{slots?.map((slot) => { const cancelSlot = cancelAppointmentSlotAction.bind(null, businessSlug, slot.id); return <tr key={slot.id}><td>{slotFormat.format(new Date(slot.starts_at))}<small>{Math.round((Date.parse(slot.ends_at) - Date.parse(slot.starts_at)) / 60000)} dk</small></td><td>{memberNames.get(slot.member_id) ?? "—"}</td><td><span className={`record-status status-${slot.status.toLowerCase()}`}>{slot.status === "AVAILABLE" ? "Müsait" : "Dolu"}</span></td><td>{isOfficeAdmin && slot.status === "AVAILABLE" ? <form action={cancelSlot}><button className="table-action">Kaldır</button></form> : null}</td></tr>; })}{!slots?.length && <tr><td colSpan={4} className="empty-cell">Tanımlı slot yok. AI randevu öneremez.</td></tr>}</tbody></table></div>
      </section>
      <div className="data-table-wrap top-gap"><table className="data-table"><thead><tr><th>Randevu</th><th>Lead</th><th>Tarih</th><th>Konum</th><th>Durum</th><th /></tr></thead><tbody>{appointments?.map((appointment) => { const lead = leadMap.get(appointment.lead_id); const cancelAction = cancelAppointmentAction.bind(null, businessSlug, appointment.id); return <tr key={appointment.id}><td><strong>{appointment.title}</strong></td><td><Link className="table-link" href={`/app/${businessSlug}/leads/${appointment.lead_id}`}>{lead?.name ?? "Lead"}</Link><small>{lead?.phone}</small></td><td>{new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(appointment.starts_at))}<small>{new Intl.DateTimeFormat("tr-TR", { timeStyle: "short" }).format(new Date(appointment.ends_at))}</small></td><td>{appointment.location ?? "—"}</td><td><span className={`record-status status-${appointment.status.toLowerCase()}`}>{appointment.status}</span></td><td>{appointment.status !== "CANCELED" && appointment.status !== "COMPLETED" ? <form action={cancelAction}><input type="hidden" name="reason" value="Kullanıcı tarafından iptal edildi" /><button className="table-action">İptal</button></form> : null}</td></tr>; })}{!appointments?.length && <tr><td colSpan={6} className="empty-cell">Henüz randevu yok.</td></tr>}</tbody></table></div>
    </div>
  );
}

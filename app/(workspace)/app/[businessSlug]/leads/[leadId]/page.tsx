import Link from "next/link";
import { notFound } from "next/navigation";
import { requireBusinessAccess } from "@/lib/auth/dal";
import {
  addLeadNoteAction,
  assignLeadAction,
  linkLeadListingAction,
  updateLeadStatusAction,
} from "../../crm-actions";
import { prepareWhatsAppAction, scheduleCallbackAction } from "../../engagement-actions";

export const dynamic = "force-dynamic";

const statusLabels: Record<string, string> = {
  NEW: "Yeni",
  REVIEWING: "İncelemeye al",
  APPROVED: "Danışman onayı",
  CONTACTED: "İletişime geçildi",
  QUALIFIED: "Nitelikli",
  APPOINTMENT_SCHEDULED: "Randevu planlandı",
  WON: "Kazanıldı",
  LOST: "Kaybedildi",
  ARCHIVED: "Arşivle",
};

const nextStatuses: Record<string, string[]> = {
  NEW: ["REVIEWING", "ARCHIVED"],
  REVIEWING: ["APPROVED", "LOST", "ARCHIVED"],
  APPROVED: ["CONTACTED", "LOST", "ARCHIVED"],
  CONTACTED: ["QUALIFIED", "LOST", "ARCHIVED"],
  QUALIFIED: ["APPOINTMENT_SCHEDULED", "WON", "LOST", "ARCHIVED"],
  APPOINTMENT_SCHEDULED: ["QUALIFIED", "WON", "LOST", "ARCHIVED"],
  WON: ["ARCHIVED"],
  LOST: ["ARCHIVED"],
};

const activityLabels: Record<string, string> = {
  LEAD_CREATED: "Lead oluşturuldu",
  LEAD_ASSIGNED: "Danışman ataması değiştirildi",
  LEAD_STATUS_CHANGED: "Lead durumu değiştirildi",
};

export default async function LeadDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessSlug: string; leadId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { businessSlug, leadId } = await params;
  const query = await searchParams;
  const { business, membership, supabase } = await requireBusinessAccess(businessSlug);
  const { data: lead } = await supabase
    .from("leads")
    .select("*")
    .eq("business_id", business.id)
    .eq("id", leadId)
    .maybeSingle();
  if (!lead) notFound();

  const [{ data: advisors }, { data: notes }, { data: activities }, { data: links }, { data: listings }] =
    await Promise.all([
      supabase.from("business_members").select("id,user_id").eq("business_id", business.id).eq("role", "ADVISOR").eq("status", "ACTIVE"),
      supabase.from("notes").select("id,content,author_user_id,created_at").eq("business_id", business.id).eq("lead_id", leadId).order("created_at", { ascending: false }),
      supabase.from("activity_logs").select("id,action,metadata,created_at").eq("business_id", business.id).eq("lead_id", leadId).order("created_at", { ascending: false }).limit(50),
      supabase.from("lead_listings").select("listing_id,interest_level,status").eq("business_id", business.id).eq("lead_id", leadId),
      supabase.from("listings").select("id,title,price,currency,status").eq("business_id", business.id).neq("status", "ARCHIVED").order("created_at", { ascending: false }).limit(200),
    ]);
  const userIds = [...new Set([...(advisors?.map((item) => item.user_id) ?? []), ...(notes?.map((item) => item.author_user_id) ?? [])])];
  const { data: profiles } = userIds.length
    ? await supabase.from("profiles").select("user_id,full_name").in("user_id", userIds)
    : { data: [] };
  const names = new Map(profiles?.map((profile) => [profile.user_id, profile.full_name]));
  const linkedIds = new Set(links?.map((link) => link.listing_id));
  const assignedAdvisor = advisors?.find((advisor) => advisor.id === lead.assigned_member_id);
  const statusAction = updateLeadStatusAction.bind(null, businessSlug, leadId);
  const assignAction = assignLeadAction.bind(null, businessSlug, leadId);
  const noteAction = addLeadNoteAction.bind(null, businessSlug, leadId);
  const linkAction = linkLeadListingAction.bind(null, businessSlug, leadId);
  const whatsappAction = prepareWhatsAppAction.bind(null, businessSlug, leadId);
  const callbackAction = scheduleCallbackAction.bind(null, businessSlug, leadId);

  return (
    <div className="workspace-page">
      <header className="workspace-header">
        <div>
          <p className="saas-kicker">Lead detayı</p>
          <h1>{lead.name}</h1>
          <p className="page-subtitle">{lead.phone ?? lead.email}</p>
        </div>
        <Link className="text-link" href={`/app/${businessSlug}/leads`}>Listeye dön</Link>
      </header>
      {query.error && <p className="form-message error">{query.error}</p>}

      <section className="detail-grid">
        <article className="panel-card detail-main">
          <div className="panel-heading"><div><p className="saas-kicker">Süreç</p><h2>{statusLabels[lead.status] ?? lead.status}</h2></div><span className={`record-status status-${lead.status.toLowerCase()}`}>{lead.priority}</span></div>
          <div className="action-row">
            {(nextStatuses[lead.status] ?? []).map((status) => (
              <form action={statusAction} key={status}>
                <input type="hidden" name="status" value={status} />
                <button className={status === "LOST" || status === "ARCHIVED" ? "secondary-button" : "saas-primary"}>{statusLabels[status]}</button>
              </form>
            ))}
          </div>
          <dl className="detail-list">
            <div><dt>Konum</dt><dd>{[lead.city, lead.district].filter(Boolean).join(" / ") || "—"}</dd></div>
            <div><dt>Kaynak</dt><dd>{lead.source}</dd></div>
            <div><dt>Tercih edilen kanal</dt><dd>{lead.preferred_contact_method ?? "—"}</dd></div>
            <div><dt>Danışman</dt><dd>{assignedAdvisor ? names.get(assignedAdvisor.user_id) ?? "Danışman" : "Atanmamış"}</dd></div>
          </dl>
          <div className="contact-actions">
            {lead.whatsapp_allowed && lead.phone_normalized ? (
              <form action={whatsappAction} className="channel-form">
                <input type="hidden" name="message" value={`Merhaba ${lead.name}, MK Emlak danışmanlık ekibinden ulaşıyorum.`} />
                <button className="saas-primary whatsapp-button">WhatsApp’tan yaz</button>
              </form>
            ) : <span className="disabled-action">WhatsApp izni/telefonu yok</span>}
            {lead.call_allowed ? (
              <form action={callbackAction} className="channel-form callback-form">
                <input aria-label="Arama zamanı" name="callbackAt" type="datetime-local" required />
                <button className="secondary-button">AI araması planla</button>
              </form>
            ) : <span className="disabled-action">Telefon arama izni yok</span>}
          </div>
        </article>

        <aside className="panel-card">
          <p className="saas-kicker">Sorumlu danışman</p>
          {membership.role === "OFFICE_ADMIN" ? (
            <form action={assignAction} className="inline-form">
              <select name="memberId" defaultValue={lead.assigned_member_id ?? ""}>
                <option value="">Atanmamış</option>
                {advisors?.map((advisor) => <option value={advisor.id} key={advisor.id}>{names.get(advisor.user_id) ?? "Danışman"}</option>)}
              </select>
              <button className="secondary-button">Ata</button>
            </form>
          ) : <strong>{assignedAdvisor ? names.get(assignedAdvisor.user_id) ?? "Danışman" : "Atanmamış"}</strong>}
        </aside>
      </section>

      <section className="split-panels">
        <article className="panel-card">
          <div className="panel-heading"><div><p className="saas-kicker">Eşleşmeler</p><h2>İlgili ilanlar</h2></div></div>
          {listings?.filter((listing) => linkedIds.has(listing.id)).map((listing) => (
            <Link className="list-row" href={`/app/${businessSlug}/listings/${listing.id}`} key={listing.id}><span><strong>{listing.title}</strong><small>{listing.status}</small></span><b>{listing.price ? `${Number(listing.price).toLocaleString("tr-TR")} ${listing.currency}` : "Fiyat yok"}</b></Link>
          ))}
          {!links?.length && <p className="empty-note">Henüz ilan eşleştirilmedi.</p>}
          {!!listings?.some((listing) => !linkedIds.has(listing.id)) && (
            <form action={linkAction} className="inline-form top-gap">
              <select name="listingId" required defaultValue=""><option value="" disabled>İlan seçin</option>{listings.filter((listing) => !linkedIds.has(listing.id)).map((listing) => <option value={listing.id} key={listing.id}>{listing.title}</option>)}</select>
              <button className="secondary-button">Eşleştir</button>
            </form>
          )}
        </article>

        <article className="panel-card">
          <div className="panel-heading"><div><p className="saas-kicker">Danışman notları</p><h2>Notlar</h2></div></div>
          <form action={noteAction} className="note-form"><textarea name="content" required maxLength={5000} placeholder="Görüşme veya ihtiyaç notu ekleyin…" /><button className="secondary-button">Not ekle</button></form>
          <div className="stack-list">{notes?.map((note) => <div key={note.id}><p>{note.content}</p><small>{names.get(note.author_user_id) ?? "Kullanıcı"} · {new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(note.created_at))}</small></div>)}{!notes?.length && <p className="empty-note">Henüz not yok.</p>}</div>
        </article>
      </section>

      <section className="panel-card top-gap">
        <div className="panel-heading"><div><p className="saas-kicker">Denetim izi</p><h2>Aktivite</h2></div></div>
        <div className="timeline-list">{activities?.map((activity) => <article key={activity.id}><span /><div><strong>{activityLabels[activity.action] ?? activity.action}</strong><p>{JSON.stringify(activity.metadata)}</p><small>{new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(activity.created_at))}</small></div></article>)}</div>
      </section>
    </div>
  );
}

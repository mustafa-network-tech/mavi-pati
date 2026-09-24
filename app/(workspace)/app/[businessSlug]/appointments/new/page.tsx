import Link from "next/link";
import { requireBusinessAccess } from "@/lib/auth/dal";
import { createAppointmentAction } from "../../engagement-actions";

export const dynamic = "force-dynamic";

export default async function NewAppointmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessSlug: string }>;
  searchParams: Promise<{ error?: string; lead?: string }>;
}) {
  const { businessSlug } = await params;
  const query = await searchParams;
  const { business, membership, supabase } = await requireBusinessAccess(businessSlug);
  const [{ data: leads }, { data: listings }, { data: advisors }] = await Promise.all([
    supabase.from("leads").select("id,name").eq("business_id", business.id).in("status", ["APPROVED", "CONTACTED", "QUALIFIED", "APPOINTMENT_SCHEDULED"]).order("name"),
    supabase.from("listings").select("id,title").eq("business_id", business.id).in("status", ["DRAFT", "ACTIVE"]).order("title"),
    supabase.from("business_members").select("id,user_id").eq("business_id", business.id).eq("role", "ADVISOR").eq("status", "ACTIVE"),
  ]);
  const userIds = advisors?.map((advisor) => advisor.user_id) ?? [];
  const { data: profiles } = userIds.length ? await supabase.from("profiles").select("user_id,full_name").in("user_id", userIds) : { data: [] };
  const names = new Map(profiles?.map((profile) => [profile.user_id, profile.full_name]));
  const availableAdvisors = membership.role === "ADVISOR" ? advisors?.filter((advisor) => advisor.id === membership.id) : advisors;
  const action = createAppointmentAction.bind(null, businessSlug);
  return <div className="workspace-page narrow-page"><header className="workspace-header"><div><p className="saas-kicker">Takvim</p><h1>Yeni randevu</h1></div><Link className="text-link" href={`/app/${businessSlug}/appointments`}>Takvime dön</Link></header><form action={action} className="record-form">{query.error && <p className="form-message error">{query.error}</p>}<div className="form-grid two-columns"><label>Lead<select name="leadId" required defaultValue={query.lead ?? ""}><option value="" disabled>Lead seçin</option>{leads?.map((lead) => <option value={lead.id} key={lead.id}>{lead.name}</option>)}</select></label><label>İlan<select name="listingId" defaultValue=""><option value="">İlan seçilmedi</option>{listings?.map((listing) => <option value={listing.id} key={listing.id}>{listing.title}</option>)}</select></label><label>Sorumlu danışman<select name="advisorMemberId" required defaultValue={membership.role === "ADVISOR" ? membership.id : ""}><option value="" disabled>Danışman seçin</option>{availableAdvisors?.map((advisor) => <option value={advisor.id} key={advisor.id}>{names.get(advisor.user_id) ?? "Danışman"}</option>)}</select></label><label>Başlık<input name="title" required minLength={3} defaultValue="Portföy görüşmesi" /></label><label>Başlangıç<input name="startsAt" type="datetime-local" required /></label><label>Bitiş<input name="endsAt" type="datetime-local" required /></label><label className="full-field">Konum<input name="location" placeholder="Ofis veya buluşma adresi" /></label><label className="full-field">Notlar<textarea name="notes" maxLength={5000} rows={4} /></label></div><button className="saas-primary">Randevu oluştur</button></form></div>;
}

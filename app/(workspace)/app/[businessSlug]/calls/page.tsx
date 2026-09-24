import Link from "next/link";
import { requireBusinessAccess } from "@/lib/auth/dal";
import { getVoiceProvider } from "@/lib/providers/voice";

export const dynamic = "force-dynamic";

export default async function CallsPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessSlug: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const { businessSlug } = await params;
  const query = await searchParams;
  const { business, supabase } = await requireBusinessAccess(businessSlug);
  const provider = getVoiceProvider();
  const { data: calls } = await supabase
    .from("calls")
    .select("id,lead_id,provider,purpose,status,scheduled_for,duration_seconds,created_at")
    .eq("business_id", business.id)
    .order("created_at", { ascending: false })
    .limit(200);
  const leadIds = [...new Set(calls?.map((call) => call.lead_id) ?? [])];
  const { data: leads } = leadIds.length ? await supabase.from("leads").select("id,name,phone").in("id", leadIds) : { data: [] };
  const leadMap = new Map(leads?.map((lead) => [lead.id, lead]));

  return (
    <div className="workspace-page">
      <header className="workspace-header"><div><p className="saas-kicker">Provider bağımsız</p><h1>AI Aramalar</h1><p className="page-subtitle">Telefon çağrısı istekleri ve provider durumları.</p></div></header>
      {query.created && <p className="form-message success">Arama isteği planlandı.</p>}
      {!provider.configured && <section className="notice-card"><strong>Gerçek telefon sağlayıcısı henüz bağlı değil.</strong><p>Kayıtlar güvenli şekilde REQUESTED durumunda tutulur. SIP/Twilio/Telnyx adaptörü eklendiğinde aynı çağrı modeli kullanılacaktır.</p></section>}
      <div className="data-table-wrap top-gap"><table className="data-table"><thead><tr><th>Lead</th><th>Amaç</th><th>Zaman</th><th>Provider</th><th>Durum</th></tr></thead><tbody>{calls?.map((call) => { const lead = leadMap.get(call.lead_id); return <tr key={call.id}><td><Link className="table-link" href={`/app/${businessSlug}/leads/${call.lead_id}`}><strong>{lead?.name ?? "Lead"}</strong></Link><small>{lead?.phone}</small></td><td>{call.purpose}</td><td>{call.scheduled_for ? new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(call.scheduled_for)) : "Hemen"}</td><td>{call.provider}</td><td><span className={`record-status status-${call.status.toLowerCase()}`}>{call.status}</span></td></tr>; })}{!calls?.length && <tr><td colSpan={5} className="empty-cell">Henüz arama isteği yok. Lead detayından planlayabilirsiniz.</td></tr>}</tbody></table></div>
    </div>
  );
}

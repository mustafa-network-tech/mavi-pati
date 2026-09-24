import Link from "next/link";
import { requireBusinessAccess } from "@/lib/auth/dal";

export const dynamic = "force-dynamic";

export default async function ConversationsPage({ params }: { params: Promise<{ businessSlug: string }> }) {
  const { businessSlug } = await params;
  const { business, supabase } = await requireBusinessAccess(businessSlug);
  const { data: conversations } = await supabase.from("conversations").select("id,lead_id,channel,provider,status,outcome,summary,started_at,ended_at").eq("business_id", business.id).order("started_at", { ascending: false }).limit(200);
  const leadIds = [...new Set(conversations?.map((item) => item.lead_id) ?? [])];
  const { data: leads } = leadIds.length ? await supabase.from("leads").select("id,name").in("id", leadIds) : { data: [] };
  const leadMap = new Map(leads?.map((lead) => [lead.id, lead.name]));
  return <div className="workspace-page"><header className="workspace-header"><div><p className="saas-kicker">CRM zaman çizgisi</p><h1>Görüşme Geçmişi</h1><p className="page-subtitle">Kanalların ortak görüşme kaydı ve özetleri.</p></div></header><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Lead</th><th>Kanal</th><th>Özet / sonuç</th><th>Durum</th><th>Başlangıç</th></tr></thead><tbody>{conversations?.map((conversation) => <tr key={conversation.id}><td><Link className="table-link" href={`/app/${businessSlug}/leads/${conversation.lead_id}`}><strong>{leadMap.get(conversation.lead_id) ?? "Lead"}</strong></Link></td><td>{conversation.channel}<small>{conversation.provider}</small></td><td>{conversation.summary ?? conversation.outcome ?? "Özet bekleniyor"}</td><td>{conversation.status}</td><td>{new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(conversation.started_at))}</td></tr>)}{!conversations?.length && <tr><td colSpan={5} className="empty-cell">Henüz görüşme kaydı yok.</td></tr>}</tbody></table></div></div>;
}

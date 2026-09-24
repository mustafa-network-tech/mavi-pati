import Link from "next/link";
import { requireBusinessAccess } from "@/lib/auth/dal";

export const dynamic = "force-dynamic";

export default async function WhatsAppPage({ params }: { params: Promise<{ businessSlug: string }> }) {
  const { businessSlug } = await params;
  const { business, supabase } = await requireBusinessAccess(businessSlug);
  const { data: conversations } = await supabase.from("conversations").select("id,lead_id,provider,status,started_at").eq("business_id", business.id).eq("channel", "WHATSAPP").order("started_at", { ascending: false }).limit(200);
  const conversationIds = conversations?.map((item) => item.id) ?? [];
  const leadIds = [...new Set(conversations?.map((item) => item.lead_id) ?? [])];
  const [{ data: messages }, { data: leads }] = await Promise.all([
    conversationIds.length ? supabase.from("messages").select("conversation_id,content,status,created_at").in("conversation_id", conversationIds).order("created_at", { ascending: false }) : Promise.resolve({ data: [] }),
    leadIds.length ? supabase.from("leads").select("id,name,phone").in("id", leadIds) : Promise.resolve({ data: [] }),
  ]);
  const messageMap = new Map(messages?.map((message) => [message.conversation_id, message]));
  const leadMap = new Map(leads?.map((lead) => [lead.id, lead]));
  return <div className="workspace-page"><header className="workspace-header"><div><p className="saas-kicker">İletişim</p><h1>WhatsApp</h1><p className="page-subtitle">Manuel deep-link taslakları; resmi API gönderimi yapılmış gibi gösterilmez.</p></div><Link className="secondary-button" href={`/app/${businessSlug}/leads`}>Lead seç</Link></header><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Lead</th><th>Mesaj</th><th>Provider</th><th>Durum</th><th>Tarih</th></tr></thead><tbody>{conversations?.map((conversation) => { const lead = leadMap.get(conversation.lead_id); const message = messageMap.get(conversation.id); return <tr key={conversation.id}><td><Link className="table-link" href={`/app/${businessSlug}/leads/${conversation.lead_id}`}><strong>{lead?.name ?? "Lead"}</strong></Link><small>{lead?.phone}</small></td><td>{message?.content ?? "—"}</td><td>{conversation.provider}</td><td>{message?.status ?? conversation.status}</td><td>{new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(conversation.started_at))}</td></tr>; })}{!conversations?.length && <tr><td colSpan={5} className="empty-cell">Henüz WhatsApp taslağı yok.</td></tr>}</tbody></table></div></div>;
}

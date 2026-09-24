import Link from "next/link";
import { notFound } from "next/navigation";
import { getAiProvider } from "@/lib/ai/provider";
import { listingAnalysisSchema, type ListingAnalysis } from "@/lib/ai/schemas";
import { requireBusinessAccess } from "@/lib/auth/dal";
import { getWhatsAppConfigStatus } from "@/lib/providers/whatsapp-cloud";
import {
  AnalyzeListingButton,
  DraftMessageButton,
  SendMessageForm,
} from "@/components/outreach/OutreachActions";

export const dynamic = "force-dynamic";

const analysisLabels: Partial<Record<keyof ListingAnalysis, string>> = {
  listing_purpose: "Amaç",
  property_type: "Tür",
  city: "İl",
  district: "İlçe",
  neighborhood: "Mahalle",
  room_count: "Oda",
  gross_m2: "Brüt m²",
  net_m2: "Net m²",
  building_age: "Bina yaşı",
  floor: "Kat",
  total_floors: "Toplam kat",
  heating: "Isınma",
  balcony: "Balkon",
  elevator: "Asansör",
  parking: "Otopark",
  furnished: "Eşyalı",
  site: "Site içi",
  garden: "Bahçe",
  terrace: "Teras",
  view: "Manzara",
  facade: "Cephe",
};

const conversationLabels: Record<string, string> = {
  OPEN: "ACTIVE · AI yanıtlıyor",
  TRANSFERRED: "ACTIVE · danışmanda",
  COMPLETED: "CLOSED",
  CANCELED: "CLOSED",
  FAILED: "CLOSED · hata",
};

const senderLabels: Record<string, string> = {
  LEAD: "İlan sahibi",
  AI: "AI",
  ADVISOR: "Danışman",
  SYSTEM: "Sistem",
};

function formatValue(value: unknown) {
  if (value === true) return "Var";
  if (value === false) return "Yok";
  return String(value);
}

export default async function ListingDetailPage({ params }: { params: Promise<{ businessSlug: string; listingId: string }> }) {
  const { businessSlug, listingId } = await params;
  const { business, membership, supabase } = await requireBusinessAccess(businessSlug);
  const { data: listing } = await supabase.from("listings").select("*").eq("business_id", business.id).eq("id", listingId).maybeSingle();
  if (!listing) notFound();

  const [{ data: links }, { data: owner }, { data: analysisRow }, { data: conversation }] = await Promise.all([
    supabase.from("lead_listings").select("lead_id,interest_level,status").eq("business_id", business.id).eq("listing_id", listingId),
    listing.owner_lead_id
      ? supabase.from("leads").select("id,name,phone,status,do_not_contact").eq("id", listing.owner_lead_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("listing_ai_analysis").select("status,analysis_json,summary,model,error_code,updated_at").eq("listing_id", listingId).maybeSingle(),
    supabase
      .from("conversations")
      .select("id,status,outcome,summary,provider,last_inbound_at")
      .eq("business_id", business.id)
      .eq("listing_id", listingId)
      .eq("channel", "WHATSAPP")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const leadIds = links?.map((link) => link.lead_id) ?? [];
  const [{ data: leads }, { data: messages }] = await Promise.all([
    leadIds.length ? supabase.from("leads").select("id,name,phone,status").in("id", leadIds) : Promise.resolve({ data: [] }),
    conversation
      ? supabase.from("messages").select("id,sender_type,direction,content,status,error_code,created_at").eq("conversation_id", conversation.id).order("created_at")
      : Promise.resolve({ data: [] }),
  ]);

  const analysis = analysisRow?.status === "COMPLETED" ? listingAnalysisSchema.safeParse(analysisRow.analysis_json) : null;
  const draft = messages?.find((message) => message.status === "DRAFT" && message.sender_type === "AI");
  const thread = messages?.filter((message) => message.status !== "DRAFT") ?? [];
  const canOperate = membership.role === "OFFICE_ADMIN" || listing.assigned_member_id === membership.id;
  const aiConfigured = (await getAiProvider()).configured;
  const whatsapp = getWhatsAppConfigStatus();
  const dateTime = new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short", timeZone: business.timezone });

  return (
    <div className="workspace-page">
      <header className="workspace-header"><div><p className="saas-kicker">İlan detayı</p><h1>{listing.title}</h1><p className="page-subtitle">{listing.transaction_type === "SALE" ? "Satılık" : "Kiralık"} · {listing.property_type}</p></div><Link className="text-link" href={`/app/${businessSlug}/listings`}>Listeye dön</Link></header>
      <section className="detail-grid">
        <article className="panel-card detail-main">
          <div className="panel-heading"><div><p className="saas-kicker">Portföy bilgisi</p><h2>{listing.price ? `${Number(listing.price).toLocaleString("tr-TR")} ${listing.currency}` : "Fiyat belirtilmedi"}</h2></div><span className={`record-status status-${listing.status.toLowerCase()}`}>{listing.status}</span></div>
          <dl className="detail-list"><div><dt>Konum</dt><dd>{[listing.city, listing.district, listing.neighborhood].filter(Boolean).join(" / ") || "—"}</dd></div><div><dt>Alan</dt><dd>{listing.gross_area ? `${listing.gross_area} m² brüt` : "—"}{listing.net_area ? ` · ${listing.net_area} m² net` : ""}</dd></div><div><dt>Oda</dt><dd>{listing.room_count ?? "—"}</dd></div><div><dt>Kaynak</dt><dd>{listing.source_url ? <a className="text-link" href={listing.source_url} target="_blank" rel="noreferrer">İlan linki</a> : listing.source}</dd></div></dl>
          {listing.description && <p className="listing-description">{listing.description}</p>}
        </article>
        <aside className="panel-card">
          <p className="saas-kicker">İlan sahibi</p>
          {owner ? (
            <>
              <strong>{owner.name}</strong>
              <p className="form-hint">{owner.phone ?? "Telefon yok"}</p>
              {owner.do_not_contact && <p className="form-message error-message">İletişim istemiyor (do_not_contact)</p>}
              <Link className="text-link" href={`/app/${businessSlug}/leads/${owner.id}`}>Kayda git</Link>
            </>
          ) : <p className="empty-note">İlan sahibi girilmemiş.</p>}
        </aside>
      </section>

      <section className="panel-card top-gap">
        <div className="panel-heading">
          <div><p className="saas-kicker">AI ilan analizi</p><h2>{analysisRow?.status ?? "PENDING"}</h2></div>
          <span className="outreach-status">AI: {aiConfigured ? "CONFIGURED" : "NOT_CONFIGURED"}</span>
        </div>
        {analysisRow?.status === "FAILED" && <p className="form-message error-message">Son analiz başarısız: {analysisRow.error_code}</p>}
        {analysis?.success && (
          <>
            <p>{analysis.data.summary}</p>
            <dl className="analysis-grid">
              {Object.entries(analysisLabels).map(([key, label]) => {
                const value = analysis.data[key as keyof ListingAnalysis];
                return value === null ? null : <div key={key}><dt>{label}</dt><dd>{formatValue(value)}</dd></div>;
              })}
            </dl>
            {!!analysis.data.highlights.length && <p className="form-hint">Öne çıkanlar: {analysis.data.highlights.join(" · ")}</p>}
            <p className="form-hint">Model: {analysisRow?.model} · Bilinmeyen alanlar gösterilmez.</p>
          </>
        )}
        {canOperate && (
          <AnalyzeListingButton businessSlug={businessSlug} listingId={listingId} label={analysis?.success ? "Yeniden analiz et" : "AI ile analiz et"} />
        )}
      </section>

      <section className="panel-card top-gap">
        <div className="panel-heading">
          <div><p className="saas-kicker">WhatsApp görüşmesi</p><h2>{conversation ? conversationLabels[conversation.status] ?? conversation.status : "Henüz görüşme yok"}</h2></div>
          <span className="outreach-status">WhatsApp API: {whatsapp.configured ? "CONFIGURED" : "NOT_CONFIGURED"}{whatsapp.configured && whatsapp.testMode ? " · TEST MODE" : ""}</span>
        </div>
        {conversation?.summary && <p className="form-hint">Özet: {conversation.summary}</p>}
        {conversation?.outcome === "REJECTED" && <p className="form-message error-message">İlan sahibi iletişimi reddetti; AI bir daha mesaj göndermez.</p>}
        {!!thread.length && (
          <div className="chat-thread">
            {thread.map((message) => (
              <div key={message.id} className={`chat-bubble ${message.direction === "INBOUND" ? "inbound" : "outbound"}`}>
                <small>{senderLabels[message.sender_type] ?? message.sender_type} · {dateTime.format(new Date(message.created_at))} · {message.status}{message.error_code ? ` (${message.error_code})` : ""}</small>
                <p>{message.content}</p>
              </div>
            ))}
          </div>
        )}
        {canOperate && owner && !owner.do_not_contact && (
          <div className="outreach-steps">
            {analysis?.success ? (
              <DraftMessageButton businessSlug={businessSlug} listingId={listingId} label={draft ? "Yeni taslak oluştur" : "AI ile ilk mesajı oluştur"} />
            ) : <p className="form-hint">İlk mesaj için önce ilanı analiz edin.</p>}
            {draft && (
              <SendMessageForm key={draft.id + draft.content} businessSlug={businessSlug} listingId={listingId} draft={draft.content} apiAvailable={whatsapp.configured} />
            )}
          </div>
        )}
      </section>

      <section className="panel-card top-gap"><div className="panel-heading"><div><p className="saas-kicker">İlgilenenler</p><h2>Lead eşleşmeleri</h2></div></div>{leads?.map((lead) => <Link className="list-row" href={`/app/${businessSlug}/leads/${lead.id}`} key={lead.id}><span><strong>{lead.name}</strong><small>{lead.phone ?? lead.status}</small></span><b>{lead.status}</b></Link>)}{!leads?.length && <p className="empty-note">Bu ilanla eşleştirilmiş lead yok.</p>}</section>
    </div>
  );
}

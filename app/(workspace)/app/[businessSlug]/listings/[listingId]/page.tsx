import Link from "next/link";
import { notFound } from "next/navigation";
import { requireBusinessAccess } from "@/lib/auth/dal";

export const dynamic = "force-dynamic";

export default async function ListingDetailPage({ params }: { params: Promise<{ businessSlug: string; listingId: string }> }) {
  const { businessSlug, listingId } = await params;
  const { business, supabase } = await requireBusinessAccess(businessSlug);
  const { data: listing } = await supabase.from("listings").select("*").eq("business_id", business.id).eq("id", listingId).maybeSingle();
  if (!listing) notFound();
  const { data: links } = await supabase.from("lead_listings").select("lead_id,interest_level,status").eq("business_id", business.id).eq("listing_id", listingId);
  const leadIds = links?.map((link) => link.lead_id) ?? [];
  const { data: leads } = leadIds.length ? await supabase.from("leads").select("id,name,phone,status").in("id", leadIds) : { data: [] };

  return (
    <div className="workspace-page">
      <header className="workspace-header"><div><p className="saas-kicker">İlan detayı</p><h1>{listing.title}</h1><p className="page-subtitle">{listing.transaction_type === "SALE" ? "Satılık" : "Kiralık"} · {listing.property_type}</p></div><Link className="text-link" href={`/app/${businessSlug}/listings`}>Listeye dön</Link></header>
      <section className="detail-grid">
        <article className="panel-card detail-main">
          <div className="panel-heading"><div><p className="saas-kicker">Portföy bilgisi</p><h2>{listing.price ? `${Number(listing.price).toLocaleString("tr-TR")} ${listing.currency}` : "Fiyat belirtilmedi"}</h2></div><span className={`record-status status-${listing.status.toLowerCase()}`}>{listing.status}</span></div>
          <dl className="detail-list"><div><dt>Konum</dt><dd>{[listing.city, listing.district, listing.neighborhood].filter(Boolean).join(" / ") || "—"}</dd></div><div><dt>Alan</dt><dd>{listing.gross_area ? `${listing.gross_area} m² brüt` : "—"}{listing.net_area ? ` · ${listing.net_area} m² net` : ""}</dd></div><div><dt>Oda</dt><dd>{listing.room_count ?? "—"}</dd></div><div><dt>Kaynak</dt><dd>{listing.source}</dd></div></dl>
          {listing.description && <p className="listing-description">{listing.description}</p>}
        </article>
        <aside className="panel-card"><p className="saas-kicker">Eşleşme</p><strong>{leads?.length ?? 0} potansiyel müşteri</strong></aside>
      </section>
      <section className="panel-card top-gap"><div className="panel-heading"><div><p className="saas-kicker">İlgilenenler</p><h2>Lead eşleşmeleri</h2></div></div>{leads?.map((lead) => <Link className="list-row" href={`/app/${businessSlug}/leads/${lead.id}`} key={lead.id}><span><strong>{lead.name}</strong><small>{lead.phone ?? lead.status}</small></span><b>{lead.status}</b></Link>)}{!leads?.length && <p className="empty-note">Bu ilanla eşleştirilmiş lead yok.</p>}</section>
    </div>
  );
}

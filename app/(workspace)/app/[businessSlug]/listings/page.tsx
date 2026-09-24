import Link from "next/link";
import { requireBusinessAccess } from "@/lib/auth/dal";

export const dynamic = "force-dynamic";

const statusLabels: Record<string, string> = {
  DRAFT: "Taslak",
  ACTIVE: "Aktif",
  INACTIVE: "Pasif",
  SOLD: "Satıldı",
  RENTED: "Kiralandı",
  ARCHIVED: "Arşivlendi",
};

export default async function ListingsPage({ params }: { params: Promise<{ businessSlug: string }> }) {
  const { businessSlug } = await params;
  const { business, supabase } = await requireBusinessAccess(businessSlug);
  const { data: listings } = await supabase
    .from("listings")
    .select("id,title,property_type,transaction_type,price,currency,city,district,status,created_at")
    .eq("business_id", business.id)
    .neq("status", "ARCHIVED")
    .order("created_at", { ascending: false })
    .limit(200);

  return (
    <div className="workspace-page">
      <header className="workspace-header">
        <div><p className="saas-kicker">Portföy</p><h1>İlanlar</h1><p className="page-subtitle">Manuel veya yetkili import ile eklenen ofis portföyü.</p></div>
        <Link className="saas-primary" href={`/app/${businessSlug}/listings/new`}>Yeni ilan</Link>
      </header>
      <div className="data-table-wrap">
        <table className="data-table">
          <thead><tr><th>İlan</th><th>İşlem</th><th>Konum</th><th>Fiyat</th><th>Durum</th></tr></thead>
          <tbody>
            {listings?.map((listing) => (
              <tr key={listing.id}>
                <td><Link className="table-link" href={`/app/${businessSlug}/listings/${listing.id}`}><strong>{listing.title}</strong></Link><small>{listing.property_type}</small></td>
                <td>{listing.transaction_type === "SALE" ? "Satılık" : "Kiralık"}</td>
                <td>{[listing.city, listing.district].filter(Boolean).join(" / ") || "—"}</td>
                <td>{listing.price ? `${Number(listing.price).toLocaleString("tr-TR")} ${listing.currency}` : "—"}</td>
                <td><span className={`record-status status-${listing.status.toLowerCase()}`}>{statusLabels[listing.status] ?? listing.status}</span></td>
              </tr>
            ))}
            {!listings?.length && <tr><td colSpan={5} className="empty-cell">Henüz ilan eklenmedi.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

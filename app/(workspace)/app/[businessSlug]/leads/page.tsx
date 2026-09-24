import Link from "next/link";
import { requireBusinessAccess } from "@/lib/auth/dal";

export const dynamic = "force-dynamic";

const statusLabels: Record<string, string> = {
  NEW: "Yeni",
  REVIEWING: "İnceleniyor",
  APPROVED: "Onaylandı",
  CONTACTED: "İletişime geçildi",
  QUALIFIED: "Nitelikli",
  APPOINTMENT_SCHEDULED: "Randevu planlandı",
  WON: "Kazanıldı",
  LOST: "Kaybedildi",
  ARCHIVED: "Arşivlendi",
};

export default async function LeadsPage({
  params,
}: {
  params: Promise<{ businessSlug: string }>;
}) {
  const { businessSlug } = await params;
  const { business, supabase } = await requireBusinessAccess(businessSlug);
  const { data: leads } = await supabase
    .from("leads")
    .select("id,name,phone,email,city,district,status,priority,created_at")
    .eq("business_id", business.id)
    .neq("status", "ARCHIVED")
    .order("created_at", { ascending: false })
    .limit(200);

  return (
    <div className="workspace-page">
      <header className="workspace-header">
        <div>
          <p className="saas-kicker">CRM</p>
          <h1>Potansiyel müşteriler</h1>
          <p className="page-subtitle">Size atanmış veya yönetebildiğiniz lead kayıtları.</p>
        </div>
        <Link className="saas-primary" href={`/app/${businessSlug}/leads/new`}>
          Yeni lead
        </Link>
      </header>

      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Müşteri</th>
              <th>Konum</th>
              <th>Öncelik</th>
              <th>Durum</th>
              <th>Eklenme</th>
            </tr>
          </thead>
          <tbody>
            {leads?.map((lead) => (
              <tr key={lead.id}>
                <td>
                  <Link className="table-link" href={`/app/${businessSlug}/leads/${lead.id}`}>
                    <strong>{lead.name}</strong>
                  </Link>
                  <small>{lead.phone ?? lead.email}</small>
                </td>
                <td>{[lead.city, lead.district].filter(Boolean).join(" / ") || "—"}</td>
                <td>{lead.priority}</td>
                <td>
                  <span className={`record-status status-${lead.status.toLowerCase()}`}>
                    {statusLabels[lead.status] ?? lead.status}
                  </span>
                </td>
                <td>{new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(lead.created_at))}</td>
              </tr>
            ))}
            {!leads?.length && (
              <tr>
                <td colSpan={5} className="empty-cell">Henüz lead eklenmedi.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

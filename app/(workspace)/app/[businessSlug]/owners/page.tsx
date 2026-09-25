import Link from "next/link";
import { requireBusinessAccess } from "@/lib/auth/dal";
import { formatDate } from "@/lib/clinic/labels";

export const dynamic = "force-dynamic";

// PostgREST "or" filter values: strip characters that would change the filter syntax.
const searchTerm = (value: string | undefined) => value?.replace(/[,()*%\\]/g, " ").trim().slice(0, 80) ?? "";

export default async function OwnersPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessSlug: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { businessSlug } = await params;
  const q = searchTerm((await searchParams).q);
  const { business, supabase } = await requireBusinessAccess(businessSlug);
  let query = supabase
    .from("owners")
    .select("id,full_name,phone,email,created_at")
    .eq("business_id", business.id)
    .is("archived_at", null)
    .order("full_name")
    .limit(200);
  if (q) {
    const digits = q.replace(/\D/g, "");
    query = query.or(
      [`full_name.ilike.*${q}*`, `email.ilike.*${q}*`, ...(digits.length >= 3 ? [`phone_normalized.like.*${digits}*`] : [])].join(","),
    );
  }
  const { data: owners } = await query;
  const ownerIds = (owners ?? []).map((owner) => owner.id);
  const { data: patients } = ownerIds.length
    ? await supabase.from("patients").select("owner_id,name").eq("business_id", business.id).in("owner_id", ownerIds).neq("status", "ARCHIVED")
    : { data: [] };
  const petsByOwner = new Map<string, string[]>();
  for (const patient of patients ?? []) petsByOwner.set(patient.owner_id, [...(petsByOwner.get(patient.owner_id) ?? []), patient.name]);

  return (
    <div className="workspace-page">
      <header className="workspace-header">
        <div>
          <p className="saas-kicker">Kayıtlar</p>
          <h1>Hayvan sahipleri</h1>
          <p className="page-subtitle">Kliniğinize kayıtlı hayvan sahipleri ve hastaları.</p>
        </div>
        <Link className="saas-primary" href={`/app/${businessSlug}/owners/new`}>Yeni hayvan sahibi</Link>
      </header>
      <form className="inline-form search-form" role="search">
        <input name="q" defaultValue={q} placeholder="Ad, telefon veya e-posta ile ara" aria-label="Hayvan sahibi ara" />
        <button className="secondary-button">Ara</button>
      </form>
      <div className="data-table-wrap top-gap">
        <table className="data-table">
          <thead><tr><th>Ad soyad</th><th>İletişim</th><th>Hastalar</th><th>Kayıt</th></tr></thead>
          <tbody>
            {owners?.map((owner) => (
              <tr key={owner.id}>
                <td><Link className="table-link" href={`/app/${businessSlug}/owners/${owner.id}`}><strong>{owner.full_name}</strong></Link></td>
                <td>{owner.phone ?? "—"}<small>{owner.email}</small></td>
                <td>{petsByOwner.get(owner.id)?.join(", ") ?? "—"}</td>
                <td>{formatDate(owner.created_at, business.timezone)}</td>
              </tr>
            ))}
            {!owners?.length && <tr><td colSpan={4} className="empty-cell">{q ? "Aramaya uygun kayıt yok." : "Henüz hayvan sahibi kaydı yok."}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

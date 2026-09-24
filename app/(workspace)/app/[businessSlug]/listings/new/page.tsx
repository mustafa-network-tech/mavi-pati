import Link from "next/link";
import { requireBusinessAccess } from "@/lib/auth/dal";
import { createListingAction } from "../../crm-actions";

export const dynamic = "force-dynamic";

export default async function NewListingPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessSlug: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { businessSlug } = await params;
  const query = await searchParams;
  const { business, membership, supabase } = await requireBusinessAccess(businessSlug);
  const { data: advisors } = membership.role === "OFFICE_ADMIN"
    ? await supabase.from("business_members").select("id,user_id").eq("business_id", business.id).eq("role", "ADVISOR").eq("status", "ACTIVE")
    : { data: [] };
  const userIds = advisors?.map((advisor) => advisor.user_id) ?? [];
  const { data: profiles } = userIds.length ? await supabase.from("profiles").select("user_id,full_name").in("user_id", userIds) : { data: [] };
  const names = new Map(profiles?.map((profile) => [profile.user_id, profile.full_name]));
  const action = createListingAction.bind(null, businessSlug);

  return (
    <div className="workspace-page narrow-page">
      <header className="workspace-header"><div><p className="saas-kicker">Portföy</p><h1>Yeni ilan</h1></div><Link className="text-link" href={`/app/${businessSlug}/listings`}>Listeye dön</Link></header>
      <form action={action} className="record-form">
        {query.error && <p className="form-message error">{query.error}</p>}
        <div className="form-grid two-columns">
          <label className="full-field">İlan başlığı<input name="title" required minLength={3} maxLength={240} /></label>
          <label>Emlak türü<input name="propertyType" required placeholder="Daire, Villa, Arsa…" /></label>
          <label>İşlem türü<select name="transactionType"><option value="SALE">Satılık</option><option value="RENT">Kiralık</option></select></label>
          <label>Fiyat<input name="price" type="number" min="0" step="0.01" /></label>
          <label>Para birimi<select name="currency" defaultValue="TRY"><option>TRY</option><option>USD</option><option>EUR</option></select></label>
          <label>Şehir<input name="city" /></label><label>İlçe<input name="district" /></label>
          <label>Mahalle<input name="neighborhood" /></label><label>Oda sayısı<input name="roomCount" placeholder="3+1" /></label>
          <label>Brüt m²<input name="grossArea" type="number" min="0" step="0.01" /></label><label>Net m²<input name="netArea" type="number" min="0" step="0.01" /></label>
          {membership.role === "OFFICE_ADMIN" && <label>Danışman<select name="assignedMemberId" defaultValue=""><option value="">Atanmamış</option>{advisors?.map((advisor) => <option value={advisor.id} key={advisor.id}>{names.get(advisor.user_id) ?? "Danışman"}</option>)}</select></label>}
          <label className="full-field">Açıklama<textarea name="description" maxLength={5000} rows={6} /></label>
          <label>İlan sahibi adı<input name="ownerName" maxLength={160} placeholder="Ad Soyad" /></label>
          <label>İlan sahibi telefonu<input name="ownerPhone" type="tel" maxLength={40} placeholder="05XX XXX XX XX" /></label>
          <label className="full-field">İlan linki<input name="sourceUrl" type="url" maxLength={2000} placeholder="https://www.sahibinden.com/ilan/..." /></label>
        </div>
        <p className="form-hint">İlan yalnızca sizin girdiğiniz bilgilerle oluşturulur; üçüncü taraf ilan sitelerinden otomatik veri çekilmez. İlan sahibi, AI ile WhatsApp görüşmesi için kaydedilir.</p>
        <button className="saas-primary" type="submit">İlan oluştur</button>
      </form>
    </div>
  );
}

import Link from "next/link";
import { requireBusinessAccess } from "@/lib/auth/dal";
import { createLeadAction } from "../../crm-actions";

export const dynamic = "force-dynamic";

export default async function NewLeadPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessSlug: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { businessSlug } = await params;
  const { business, membership, supabase } = await requireBusinessAccess(businessSlug);
  const query = await searchParams;
  const { data: advisors } = membership.role === "OFFICE_ADMIN"
    ? await supabase
        .from("business_members")
        .select("id,user_id")
        .eq("business_id", business.id)
        .eq("role", "ADVISOR")
        .eq("status", "ACTIVE")
    : { data: [] };
  const userIds = advisors?.map((advisor) => advisor.user_id) ?? [];
  const { data: profiles } = userIds.length
    ? await supabase.from("profiles").select("user_id,full_name").in("user_id", userIds)
    : { data: [] };
  const names = new Map(profiles?.map((profile) => [profile.user_id, profile.full_name]));
  const action = createLeadAction.bind(null, businessSlug);

  return (
    <div className="workspace-page narrow-page">
      <header className="workspace-header">
        <div>
          <p className="saas-kicker">Potansiyel müşteriler</p>
          <h1>Yeni lead</h1>
        </div>
        <Link className="text-link" href={`/app/${businessSlug}/leads`}>Listeye dön</Link>
      </header>
      <form action={action} className="record-form">
        {query.error && <p className="form-message error">{query.error}</p>}
        <div className="form-grid two-columns">
          <label>Ad soyad<input name="name" required minLength={2} maxLength={160} /></label>
          <label>Telefon<input name="phone" inputMode="tel" placeholder="+90 5xx xxx xx xx" /></label>
          <label>E-posta<input name="email" type="email" /></label>
          <label>Şehir<input name="city" /></label>
          <label>İlçe<input name="district" /></label>
          <label>Öncelik<select name="priority" defaultValue="NORMAL"><option value="LOW">Düşük</option><option value="NORMAL">Normal</option><option value="HIGH">Yüksek</option><option value="URGENT">Acil</option></select></label>
          <label>Tercih edilen kanal<select name="preferredContactMethod" defaultValue=""><option value="">Belirtilmedi</option><option value="WHATSAPP">WhatsApp</option><option value="PHONE">Telefon</option><option value="EMAIL">E-posta</option></select></label>
          {membership.role === "OFFICE_ADMIN" && (
            <label>Danışman<select name="assignedMemberId" defaultValue=""><option value="">Atanmamış</option>{advisors?.map((advisor) => <option value={advisor.id} key={advisor.id}>{names.get(advisor.user_id) ?? "Danışman"}</option>)}</select></label>
          )}
        </div>
        <fieldset className="consent-box">
          <legend>İletişim izinleri</legend>
          <label><input type="checkbox" name="whatsappAllowed" /> WhatsApp iletişimi için izin mevcut</label>
          <label><input type="checkbox" name="callAllowed" /> Telefon araması için izin mevcut</label>
        </fieldset>
        <p className="form-hint">İzinsiz scraping veya telefon toplama yapılmaz. Bu kayıt danışmanın sağladığı veri olarak “MANUAL” kaynağıyla tutulur.</p>
        <button className="saas-primary" type="submit">Lead oluştur</button>
      </form>
    </div>
  );
}

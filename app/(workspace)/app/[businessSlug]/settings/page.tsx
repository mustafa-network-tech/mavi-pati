import { requireBusinessAccess } from "@/lib/auth/dal";

export const dynamic = "force-dynamic";

const featureLabels: Record<string, string> = {
  crm_enabled: "CRM",
  appointments_enabled: "Randevular",
  whatsapp_enabled: "WhatsApp",
  ai_analysis_enabled: "AI analiz",
  ai_voice_enabled: "AI telefon",
  imports_enabled: "CSV / Excel import",
  reports_enabled: "Raporlar",
};

export default async function SettingsPage({ params }: { params: Promise<{ businessSlug: string }> }) {
  const { businessSlug } = await params;
  const { business, membership, supabase } = await requireBusinessAccess(businessSlug);
  const [{ data: entitlement }, { data: members }] = await Promise.all([
    supabase.from("business_entitlements").select("*").eq("business_id", business.id).maybeSingle(),
    supabase.from("business_members").select("id,user_id,role,status,created_at").eq("business_id", business.id).order("created_at"),
  ]);
  const userIds = members?.map((member) => member.user_id) ?? [];
  const { data: profiles } = userIds.length ? await supabase.from("profiles").select("user_id,full_name,phone,locale").in("user_id", userIds) : { data: [] };
  const profileMap = new Map(profiles?.map((profile) => [profile.user_id, profile]));
  const features = Object.entries(featureLabels);
  return (
    <div className="workspace-page">
      <header className="workspace-header"><div><p className="saas-kicker">Ofis yapılandırması</p><h1>Ayarlar</h1><p className="page-subtitle">{business.display_name} erişim hakları ve ekip görünümü.</p></div></header>
      <section className="split-panels">
        <article className="panel-card"><div className="panel-heading"><div><p className="saas-kicker">Plan özellikleri</p><h2>Modüller</h2></div></div><div className="feature-list">{features.map(([key, label]) => <div key={key}><span>{label}</span><strong className={entitlement?.[key] ? "feature-on" : "feature-off"}>{entitlement?.[key] ? "Açık" : "Kapalı"}</strong></div>)}</div><p className="form-hint top-gap">Özellik ve kota değişiklikleri yalnızca Platform Admin tarafından yapılır.</p></article>
        <article className="panel-card"><div className="panel-heading"><div><p className="saas-kicker">Kotalar</p><h2>Kullanım sınırları</h2></div></div><dl className="detail-list"><div><dt>Danışman</dt><dd>{entitlement?.max_advisors ?? 0}</dd></div><div><dt>Aylık AI dakika</dt><dd>{entitlement?.monthly_ai_call_minutes ?? 0}</dd></div><div><dt>AI analiz</dt><dd>{entitlement?.monthly_ai_analysis_limit ?? 0}</dd></div><div><dt>Lead</dt><dd>{entitlement?.monthly_lead_limit ?? 0}</dd></div></dl></article>
      </section>
      <section className="panel-card top-gap"><div className="panel-heading"><div><p className="saas-kicker">Ekip</p><h2>Ofis kullanıcıları</h2></div>{membership.role === "OFFICE_ADMIN" && <span className="disabled-action">Davet akışı sonraki adım</span>}</div><div className="data-table-wrap embedded-table"><table className="data-table"><thead><tr><th>Kullanıcı</th><th>Rol</th><th>Dil</th><th>Durum</th></tr></thead><tbody>{members?.map((member) => { const profile = profileMap.get(member.user_id); return <tr key={member.id}><td><strong>{profile?.full_name ?? "Kullanıcı"}</strong><small>{profile?.phone}</small></td><td>{member.role}</td><td>{profile?.locale ?? "tr"}</td><td>{member.status}</td></tr>; })}</tbody></table></div></section>
    </div>
  );
}

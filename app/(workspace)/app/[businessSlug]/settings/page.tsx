import { AdvisorRequestActions } from "@/components/team/AdvisorRequestActions";
import { requireBusinessAccess } from "@/lib/auth/dal";
import { getAiProvider } from "@/lib/ai/provider";
import { getWhatsAppBusinessProvider, getWhatsAppConfigStatus } from "@/lib/providers/whatsapp-cloud";

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
  const isOfficeAdmin = membership.role === "OFFICE_ADMIN" && membership.status === "ACTIVE";
  const advisorRequests = isOfficeAdmin ? (members ?? []).filter((member) => member.role === "ADVISOR" && member.status === "PENDING") : [];
  const integrations = isOfficeAdmin ? await (async () => {
    const ai = await getAiProvider();
    const whatsapp = getWhatsAppBusinessProvider();
    const [aiStatus, whatsappStatus] = await Promise.all([ai.checkConnection(), whatsapp ? whatsapp.checkConnection() : Promise.resolve("NOT_CONFIGURED")]);
    return { aiStatus, aiModel: ai.model, whatsappStatus, whatsappConfig: getWhatsAppConfigStatus() };
  })() : null;
  const teamMembers = (members ?? []).filter((member) => member.status !== "REVOKED" && !advisorRequests.includes(member));
  return (
    <div className="workspace-page">
      <header className="workspace-header"><div><p className="saas-kicker">Ofis yapılandırması</p><h1>Ayarlar</h1><p className="page-subtitle">{business.display_name} erişim hakları ve ekip görünümü.</p></div></header>
      <section className="split-panels">
        <article className="panel-card"><div className="panel-heading"><div><p className="saas-kicker">Plan özellikleri</p><h2>Modüller</h2></div></div><div className="feature-list">{features.map(([key, label]) => <div key={key}><span>{label}</span><strong className={entitlement?.[key] ? "feature-on" : "feature-off"}>{entitlement?.[key] ? "Açık" : "Kapalı"}</strong></div>)}</div><p className="form-hint top-gap">Özellik ve kota değişiklikleri yalnızca Platform Admin tarafından yapılır.</p></article>
        <article className="panel-card"><div className="panel-heading"><div><p className="saas-kicker">Kotalar</p><h2>Kullanım sınırları</h2></div></div><dl className="detail-list"><div><dt>Danışman</dt><dd>{entitlement?.max_advisors ?? 0}</dd></div><div><dt>Aylık AI dakika</dt><dd>{entitlement?.monthly_ai_call_minutes ?? 0}</dd></div><div><dt>AI analiz</dt><dd>{entitlement?.monthly_ai_analysis_limit ?? 0}</dd></div><div><dt>Lead</dt><dd>{entitlement?.monthly_lead_limit ?? 0}</dd></div></dl></article>
      </section>
      {isOfficeAdmin && (
        <section className="panel-card top-gap">
          <div className="panel-heading"><div><p className="saas-kicker">Danışman istekleri</p><h2>Onay bekleyenler</h2></div></div>
          {advisorRequests.length ? (
            <div className="data-table-wrap embedded-table"><table className="data-table"><thead><tr><th>Danışman</th><th>İstek tarihi</th><th>İşlem</th></tr></thead><tbody>{advisorRequests.map((member) => { const profile = profileMap.get(member.user_id); return <tr key={member.id}><td><strong>{profile?.full_name ?? "Kullanıcı"}</strong><small>{profile?.phone}</small></td><td>{new Date(member.created_at).toLocaleDateString("tr-TR")}</td><td><AdvisorRequestActions businessSlug={business.slug} memberId={member.id} /></td></tr>; })}</tbody></table></div>
          ) : (
            <p className="form-hint">Bekleyen danışman isteği yok. Danışmanlar kayıt olurken ofis adresi olarak <strong>{business.slug}</strong> girmelidir.</p>
          )}
        </section>
      )}
      {integrations && (
        <section className="panel-card top-gap">
          <div className="panel-heading"><div><p className="saas-kicker">Geliştirme / test</p><h2>Entegrasyon durumu</h2></div></div>
          <dl className="detail-list">
            <div><dt>AI (OpenAI)</dt><dd><strong className={integrations.aiStatus === "CONNECTED" ? "feature-on" : "feature-off"}>{integrations.aiStatus}</strong>{integrations.aiModel ? ` · ${integrations.aiModel}` : ""}</dd></div>
            <div><dt>WhatsApp Business API</dt><dd><strong className={integrations.whatsappStatus === "CONNECTED" ? "feature-on" : "feature-off"}>{integrations.whatsappStatus}</strong>{integrations.whatsappConfig.configured ? ` · ${integrations.whatsappConfig.testMode ? "TEST MODE" : "CANLI"}` : ` · eksik: ${integrations.whatsappConfig.missing.join(", ")}`}</dd></div>
            <div><dt>Test alıcısı</dt><dd>{integrations.whatsappConfig.testRecipientSet ? "Tanımlı" : "Tanımlı değil"}</dd></div>
            <div><dt>İlk temas şablonu</dt><dd>{integrations.whatsappConfig.templateConfigured ? "Tanımlı" : "Tanımlı değil"}</dd></div>
            <div><dt>Webhook</dt><dd>/api/webhooks/whatsapp</dd></div>
          </dl>
          <p className="form-hint top-gap">İlan analizi ve görüşme durumları ilgili ilan sayfasında görünür. Anahtarlar hiçbir ekranda gösterilmez.</p>
        </section>
      )}
      <section className="panel-card top-gap"><div className="panel-heading"><div><p className="saas-kicker">Ekip</p><h2>Ofis kullanıcıları</h2></div></div><div className="data-table-wrap embedded-table"><table className="data-table"><thead><tr><th>Kullanıcı</th><th>Rol</th><th>Dil</th><th>Durum</th></tr></thead><tbody>{teamMembers.map((member) => { const profile = profileMap.get(member.user_id); return <tr key={member.id}><td><strong>{profile?.full_name ?? "Kullanıcı"}</strong><small>{profile?.phone}</small></td><td>{member.role}</td><td>{profile?.locale ?? "tr"}</td><td>{member.status}</td></tr>; })}</tbody></table></div></section>
    </div>
  );
}

import { MemberActions } from "@/components/team/MemberActions";
import { getAiProvider } from "@/lib/ai/provider";
import { getEntitlements, requireBusinessAccess } from "@/lib/auth/dal";
import { formatDate } from "@/lib/clinic/labels";
import { loadTeam } from "@/lib/clinic/queries";
import { isClinicAdmin, memberStatusLabels, roleLabel } from "@/lib/clinic/roles";

export const dynamic = "force-dynamic";

const featureLabels = [
  ["clinic_enabled", "Klinik modülleri"],
  ["appointments_enabled", "Randevular"],
  ["ai_assistant_enabled", "MK Pati AI (yazılı)"],
  ["ai_voice_enabled", "MK Pati AI sesli konuşma"],
  ["owner_portal_enabled", "Hayvan sahibi portalı"],
  ["reports_enabled", "Raporlar"],
] as const;

export default async function SettingsPage({ params }: { params: Promise<{ businessSlug: string }> }) {
  const { businessSlug } = await params;
  const { business, membership, supabase } = await requireBusinessAccess(businessSlug);
  const admin = isClinicAdmin(membership);
  const [entitlement, team, usage] = await Promise.all([
    getEntitlements(supabase, business.id),
    loadTeam(supabase, business.id),
    admin
      ? supabase
          .from("business_usage")
          .select("metric,used_quantity,period_start")
          .eq("business_id", business.id)
          .order("period_start", { ascending: false })
          .limit(6)
      : Promise.resolve({ data: [] as { metric: string; used_quantity: number; period_start: string }[] }),
  ]);
  const aiStatus = admin
    ? await getAiProvider().then(async (provider) => ({ status: await provider.checkConnection(), model: provider.model }))
    : null;
  const latestPeriod = usage.data?.[0]?.period_start;
  const used = (metric: string) =>
    Number(usage.data?.find((row) => row.metric === metric && row.period_start === latestPeriod)?.used_quantity ?? 0);
  const requests = admin ? team.filter((member) => member.status === "PENDING" && member.role !== "CLINIC_ADMIN") : [];
  const members = team.filter((member) => member.status !== "REVOKED" && !requests.includes(member));
  const seats = (role: string) => team.filter((member) => member.role === role && ["ACTIVE", "PENDING"].includes(member.status)).length;

  return (
    <div className="workspace-page">
      <header className="workspace-header"><div><p className="saas-kicker">Klinik yapılandırması</p><h1>Ayarlar</h1><p className="page-subtitle">{business.display_name} erişim hakları ve ekip.</p></div></header>
      <section className="split-panels">
        <article className="panel-card">
          <div className="panel-heading"><div><p className="saas-kicker">Plan</p><h2>Modüller</h2></div></div>
          <div className="feature-list">
            {featureLabels.map(([key, text]) => (
              <div key={key}><span>{text}</span><strong className={entitlement?.[key] ? "feature-on" : "feature-off"}>{entitlement?.[key] ? "Açık" : "Kapalı"}</strong></div>
            ))}
          </div>
          <p className="form-hint top-gap">Modül, kullanıcı limiti ve AI kotası değişiklikleri yalnızca Platform Admin (MK Digital Systems) tarafından yapılır.</p>
        </article>
        <article className="panel-card">
          <div className="panel-heading"><div><p className="saas-kicker">Kotalar</p><h2>Kullanım sınırları</h2></div></div>
          <dl className="detail-list">
            <div><dt>Veteriner hekim</dt><dd>{admin ? `${seats("VETERINARIAN")} / ` : ""}{entitlement?.max_veterinarians ?? 0}</dd></div>
            <div><dt>Klinik personeli</dt><dd>{admin ? `${seats("CLINIC_STAFF")} / ` : ""}{entitlement?.max_staff ?? 0}</dd></div>
            <div><dt>Aylık AI isteği</dt><dd>{admin ? `${used("AI_REQUEST")} / ` : ""}{entitlement?.monthly_ai_request_limit ?? 0}</dd></div>
            {admin && <div><dt>Bu ay sesli istek</dt><dd>{used("AI_VOICE_REQUEST")}</dd></div>}
            <div><dt>Erişim bitişi</dt><dd>{formatDate(business.access_expires_at, business.timezone)}</dd></div>
          </dl>
        </article>
      </section>

      {admin && (
        <section className="panel-card top-gap">
          <div className="panel-heading"><div><p className="saas-kicker">Katılım istekleri</p><h2>Onay bekleyenler</h2></div></div>
          {requests.length ? (
            <div className="data-table-wrap embedded-table"><table className="data-table"><thead><tr><th>Kullanıcı</th><th>Rol</th><th>İşlem</th></tr></thead><tbody>
              {requests.map((member) => (
                <tr key={member.id}><td><strong>{member.name}</strong></td><td>{roleLabel(member.role)}</td><td><MemberActions businessSlug={business.slug} memberId={member.id} status="PENDING" /></td></tr>
              ))}
            </tbody></table></div>
          ) : (
            <p className="form-hint">Bekleyen istek yok. Veteriner hekim ve personel kayıt olurken klinik adresi olarak <strong>{business.slug}</strong> girmelidir.</p>
          )}
        </section>
      )}

      {aiStatus && (
        <section className="panel-card top-gap">
          <div className="panel-heading"><div><p className="saas-kicker">Entegrasyon</p><h2>MK Pati AI bağlantısı</h2></div></div>
          <dl className="detail-list">
            <div><dt>OpenAI</dt><dd><strong className={aiStatus.status === "CONNECTED" ? "feature-on" : "feature-off"}>{aiStatus.status}</strong>{aiStatus.model ? ` · ${aiStatus.model}` : ""}</dd></div>
            <div><dt>Sesli konuşma</dt><dd>Uygulama içi mikrofon · konuşma sunucuda yazıya çevrilir, yanıt tarayıcıda sesli okunur</dd></div>
          </dl>
          <p className="form-hint top-gap">API anahtarı yalnızca sunucuda tutulur. MK Pati AI’a hayvan sahibi iletişim bilgileri gönderilmez.</p>
        </section>
      )}

      <section className="panel-card top-gap">
        <div className="panel-heading"><div><p className="saas-kicker">Ekip</p><h2>Klinik kullanıcıları</h2></div></div>
        <div className="data-table-wrap embedded-table"><table className="data-table"><thead><tr><th>Kullanıcı</th><th>Rol</th><th>Durum</th>{admin && <th>İşlem</th>}</tr></thead><tbody>
          {members.map((member) => (
            <tr key={member.id}>
              <td><strong>{member.name}</strong></td>
              <td>{roleLabel(member.role)}</td>
              <td>{memberStatusLabels[member.status] ?? member.status}</td>
              {admin && (
                <td>{member.role !== "CLINIC_ADMIN" && (member.status === "ACTIVE" || member.status === "SUSPENDED") ? <MemberActions businessSlug={business.slug} memberId={member.id} status={member.status} /> : null}</td>
              )}
            </tr>
          ))}
        </tbody></table></div>
      </section>
    </div>
  );
}

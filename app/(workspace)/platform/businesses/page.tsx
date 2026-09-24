import { BusinessSettingsForm } from "@/components/platform/BusinessSettingsForm";
import { requirePlatformAdmin } from "@/lib/auth/dal";
import { database } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function BusinessesPage() {
  await requirePlatformAdmin();
  const admin = database(true);
  const [{ data: businesses, error }, { data: entitlements }] = await Promise.all([
    admin
      .from("businesses")
      .select("id,display_name,slug,status,access_starts_at,access_expires_at,created_at")
      .order("created_at", { ascending: false }),
    admin.from("business_entitlements").select("business_id,max_advisors,crm_enabled,appointments_enabled,whatsapp_enabled,ai_analysis_enabled,ai_voice_enabled,imports_enabled,reports_enabled,monthly_ai_call_minutes,monthly_ai_analysis_limit,monthly_lead_limit"),
  ]);
  if (error) throw error;
  const rights = new Map((entitlements ?? []).map((item) => [item.business_id, item]));

  return (
    <div className="workspace-page">
      <header className="workspace-header"><div><p className="saas-kicker">Platform</p><h1>Emlak Ofisleri</h1></div></header>
      <div className="data-table-wrap">
        <table className="data-table">
          <thead><tr><th>Ofis</th><th>Durum</th><th>Danışman limiti</th><th>AI Voice</th><th>WhatsApp</th><th>Bitiş</th><th>Yönet</th></tr></thead>
          <tbody>
            {(businesses ?? []).map((business) => {
              const entitlement = rights.get(business.id);
              return (
                <tr key={business.id}>
                  <td><strong>{business.display_name}</strong><small>/{business.slug}</small></td>
                  <td><span className={`status-pill status-${business.status.toLowerCase()}`}>{business.status}</span></td>
                  <td>{entitlement?.max_advisors ?? 0}</td>
                  <td>{entitlement?.ai_voice_enabled ? "Açık" : "Kapalı"}</td>
                  <td>{entitlement?.whatsapp_enabled ? "Açık" : "Kapalı"}</td>
                  <td>{business.access_expires_at ? new Intl.DateTimeFormat("tr-TR").format(new Date(business.access_expires_at)) : "—"}</td>
                  <td><details className="platform-settings"><summary>Ayarlar</summary><BusinessSettingsForm businessId={business.id} status={business.status} expiresAt={business.access_expires_at} entitlement={entitlement} /></details></td>
                </tr>
              );
            })}
            {!businesses?.length && <tr><td colSpan={7}>Henüz ofis kaydı yok.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

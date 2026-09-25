import { BusinessSettingsForm, type PlatformEntitlement } from "@/components/platform/BusinessSettingsForm";
import { requirePlatformAdmin } from "@/lib/auth/dal";
import { businessStatusLabels, loadClinicOverview } from "@/lib/platform/overview";
import { database } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function BusinessesPage() {
  const session = await requirePlatformAdmin();
  const [clinics, { data: entitlements, error }] = await Promise.all([
    loadClinicOverview(session.userId),
    database(true)
      .from("business_entitlements")
      .select("business_id,max_veterinarians,max_staff,clinic_enabled,appointments_enabled,ai_assistant_enabled,ai_voice_enabled,reports_enabled,owner_portal_enabled,monthly_ai_request_limit"),
  ]);
  if (error) throw error;
  const rights = new Map((entitlements ?? []).map((item) => [item.business_id as string, item as PlatformEntitlement]));

  return (
    <div className="workspace-page">
      <header className="workspace-header"><div><p className="saas-kicker">Platform</p><h1>Veteriner Klinikleri</h1><p className="page-subtitle">Erişim süresi, kullanıcı limitleri, modüller ve AI kotası.</p></div></header>
      <div className="data-table-wrap">
        <table className="data-table">
          <thead><tr><th>Klinik</th><th>Durum</th><th>Hekim</th><th>Personel</th><th>MK Pati AI</th><th>Sahip portalı</th><th>Bitiş</th><th>Yönet</th></tr></thead>
          <tbody>
            {clinics.map((clinic) => (
              <tr key={clinic.business_id}>
                <td><strong>{clinic.display_name}</strong><small>/{clinic.slug}</small></td>
                <td><span className={`status-pill status-${clinic.status.toLowerCase()}`}>{businessStatusLabels[clinic.status] ?? clinic.status}</span></td>
                <td>{clinic.veterinarians} / {clinic.max_veterinarians}</td>
                <td>{clinic.staff} / {clinic.max_staff}</td>
                <td>{clinic.ai_assistant_enabled ? `${clinic.ai_requests_this_month} / ${clinic.ai_request_limit}` : "Kapalı"}<small>{clinic.ai_voice_enabled ? "Sesli açık" : "Sesli kapalı"}</small></td>
                <td>{clinic.owner_portal_enabled ? `${clinic.portal_accounts} hesap` : "Kapalı"}<small>{clinic.owner_portal_enabled && clinic.pending_owner_requests ? `${clinic.pending_owner_requests} bekleyen talep` : ""}</small></td>
                <td>{clinic.access_expires_at ? new Intl.DateTimeFormat("tr-TR").format(new Date(clinic.access_expires_at)) : "—"}</td>
                <td><details className="platform-settings"><summary>Ayarlar</summary><BusinessSettingsForm businessId={clinic.business_id} status={clinic.status} expiresAt={clinic.access_expires_at} entitlement={rights.get(clinic.business_id)} /></details></td>
              </tr>
            ))}
            {!clinics.length && <tr><td colSpan={8}>Henüz klinik kaydı yok.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

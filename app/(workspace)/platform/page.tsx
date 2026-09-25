import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth/dal";
import { getAiProvider } from "@/lib/ai/provider";
import { businessStatusLabels, expiringWithin, loadClinicOverview } from "@/lib/platform/overview";

export const dynamic = "force-dynamic";

const number = new Intl.NumberFormat("tr-TR");

export default async function PlatformDashboard() {
  const session = await requirePlatformAdmin();
  const [clinics, ai] = await Promise.all([loadClinicOverview(session.userId), getAiProvider()]);
  const aiStatus = await ai.checkConnection();
  const byStatus = new Map<string, number>();
  for (const clinic of clinics) byStatus.set(clinic.status, (byStatus.get(clinic.status) ?? 0) + 1);
  const sum = (pick: (clinic: (typeof clinics)[number]) => number) =>
    clinics.reduce((total, clinic) => total + pick(clinic), 0);
  const totalUsers = sum((clinic) => clinic.clinic_admins + clinic.veterinarians + clinic.staff);
  const expiring = expiringWithin(clinics, 14);

  return (
    <div className="workspace-page">
      <header className="workspace-header">
        <div>
          <p className="saas-kicker">Platform kontrol merkezi</p>
          <h1>Dashboard</h1>
          <p className="page-subtitle">Tüm klinikler, kullanıcılar, abonelikler ve AI kullanımı.</p>
        </div>
      </header>
      <section className="metric-grid">
        <article><small>Toplam klinik</small><strong>{clinics.length}</strong></article>
        <article><small>Aktif / deneme</small><strong>{(byStatus.get("ACTIVE") ?? 0) + (byStatus.get("TRIAL") ?? 0)}</strong></article>
        <article><small>Onay bekleyen</small><strong>{byStatus.get("PENDING") ?? 0}</strong></article>
        <article><small>Toplam kullanıcı</small><strong>{totalUsers}</strong></article>
        <article><small>Sahip portalı hesabı</small><strong>{number.format(sum((clinic) => clinic.portal_accounts))}</strong></article>
        <article><small>Kayıtlı hasta</small><strong>{number.format(sum((clinic) => clinic.patients))}</strong></article>
        <article><small>Bu ay AI isteği</small><strong>{number.format(sum((clinic) => clinic.ai_requests_this_month))}</strong></article>
      </section>

      <section className="split-panels top-gap">
        <article className="panel-card">
          <div className="panel-heading"><div><p className="saas-kicker">OpenAI</p><h2>AI bağlantısı</h2></div></div>
          <dl className="detail-list">
            <div><dt>Durum</dt><dd><strong className={aiStatus === "CONNECTED" ? "feature-on" : "feature-off"}>{aiStatus}</strong></dd></div>
            <div><dt>Model</dt><dd>{ai.model ?? "—"}</dd></div>
            <div><dt>Sesli istek (bu ay)</dt><dd>{number.format(sum((clinic) => clinic.ai_voice_requests_this_month))}</dd></div>
            <div><dt>Sahip portalı AI isteği (bu ay)</dt><dd>{number.format(sum((clinic) => clinic.ai_owner_requests_this_month))}</dd></div>
            <div><dt>Token (bu ay)</dt><dd>{number.format(sum((clinic) => clinic.ai_tokens_this_month))}</dd></div>
            <div><dt>AI açık klinik</dt><dd>{clinics.filter((clinic) => clinic.ai_assistant_enabled).length} / {clinics.length}</dd></div>
          </dl>
          <p className="form-hint top-gap">API anahtarı yalnızca sunucuda tutulur ve hiçbir ekranda gösterilmez.</p>
        </article>
        <article className="panel-card">
          <div className="panel-heading"><div><p className="saas-kicker">Abonelik</p><h2>Erişim durumları</h2></div></div>
          <div className="feature-list">
            {Object.entries(businessStatusLabels).map(([status, text]) => (
              <div key={status}><span>{text}</span><strong>{byStatus.get(status) ?? 0}</strong></div>
            ))}
          </div>
          {!!expiring.length && (
            <p className="form-message error-message top-gap">
              14 gün içinde erişimi bitecek: {expiring.map((clinic) => clinic.display_name).join(", ")}
            </p>
          )}
        </article>
      </section>

      <section className="panel-card top-gap">
        <div className="panel-heading">
          <div><p className="saas-kicker">Klinik bazında</p><h2>Kullanım</h2></div>
          <Link className="text-link" href="/platform/businesses">Klinikleri yönet</Link>
        </div>
        <div className="data-table-wrap embedded-table">
          <table className="data-table">
            <thead><tr><th>Klinik</th><th>Durum</th><th>Kullanıcı</th><th>Hasta</th><th>Bu ay randevu</th><th>AI (bu ay / kota)</th></tr></thead>
            <tbody>
              {clinics.map((clinic) => (
                <tr key={clinic.business_id}>
                  <td><strong>{clinic.display_name}</strong><small>/{clinic.slug}</small></td>
                  <td><span className={`status-pill status-${clinic.status.toLowerCase()}`}>{businessStatusLabels[clinic.status] ?? clinic.status}</span></td>
                  <td>{clinic.clinic_admins + clinic.veterinarians + clinic.staff}<small>{clinic.veterinarians} hekim · {clinic.staff} personel{clinic.pending_members ? ` · ${clinic.pending_members} bekleyen` : ""}</small></td>
                  <td>{number.format(clinic.patients)}<small>{number.format(clinic.owners)} sahip</small></td>
                  <td>{number.format(clinic.appointments_this_month)}</td>
                  <td>{clinic.ai_assistant_enabled ? `${number.format(clinic.ai_requests_this_month)} / ${number.format(clinic.ai_request_limit)}` : "Kapalı"}<small>{clinic.ai_voice_enabled ? "Sesli açık" : "Sesli kapalı"}</small></td>
                </tr>
              ))}
              {!clinics.length && <tr><td colSpan={6} className="empty-cell">Henüz klinik yok.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

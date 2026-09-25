import Link from "next/link";
import { notFound } from "next/navigation";
import { getEntitlements, requireBusinessAccess } from "@/lib/auth/dal";
import { formatDate, formatDateTime, label, speciesLabels } from "@/lib/clinic/labels";
import { loadTeam, practitioners } from "@/lib/clinic/queries";
import { isClinicalRole } from "@/lib/clinic/roles";
import { approveAppointmentRequestAction, respondOwnerRequestAction } from "../owner-request-actions";

export const dynamic = "force-dynamic";

const statusLabels: Record<string, string> = {
  PENDING: "Bekliyor",
  APPROVED: "Onaylandı",
  REJECTED: "Reddedildi",
  CANCELED: "Sahip iptal etti",
};
const channelLabels: Record<string, string> = { FORM: "Form", AI_TEXT: "MK Pati AI · yazılı", AI_VOICE: "MK Pati AI · sesli" };

export default async function OwnerRequestsPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessSlug: string }>;
  searchParams: Promise<{ status?: string; error?: string }>;
}) {
  const { businessSlug } = await params;
  const query = await searchParams;
  const { business, membership, supabase } = await requireBusinessAccess(businessSlug);
  const entitlement = await getEntitlements(supabase, business.id);
  if (!entitlement?.owner_portal_enabled) notFound();
  const status = query.status === "ALL" ? "ALL" : "PENDING";
  let requestsQuery = supabase
    .from("owner_requests")
    .select("id,owner_id,patient_id,request_type,status,details,preferred_date,preferred_time,medication_name,channel,clinic_response,created_at,reviewed_at,appointment_id")
    .eq("business_id", business.id)
    .order("created_at", { ascending: status === "PENDING" })
    .limit(200);
  if (status === "PENDING") requestsQuery = requestsQuery.eq("status", "PENDING");
  const [{ data: requests }, team] = await Promise.all([requestsQuery, loadTeam(supabase, business.id)]);
  const patientIds = [...new Set((requests ?? []).map((item) => item.patient_id))];
  const ownerIds = [...new Set((requests ?? []).map((item) => item.owner_id))];
  const [{ data: patients }, { data: owners }] = await Promise.all([
    patientIds.length ? supabase.from("patients").select("id,name,species").eq("business_id", business.id).in("id", patientIds) : Promise.resolve({ data: [] }),
    ownerIds.length ? supabase.from("owners").select("id,full_name,phone").eq("business_id", business.id).in("id", ownerIds) : Promise.resolve({ data: [] }),
  ]);
  const patientMap = new Map((patients ?? []).map((item) => [item.id as string, item]));
  const ownerMap = new Map((owners ?? []).map((item) => [item.id as string, item]));
  const vets = practitioners(team);
  const clinical = isClinicalRole(membership.role);
  const zone = business.timezone;
  const defaultStart = (date: string | null) => (date ? `${date}T10:00` : "");

  return (
    <div className="workspace-page">
      <header className="workspace-header">
        <div>
          <p className="saas-kicker">Hayvan sahibi portalı</p>
          <h1>Sahip talepleri</h1>
          <p className="page-subtitle">Portal ve MK Pati AI üzerinden gelen randevu ve ilaç talepleri. İlaç taleplerini yalnızca veteriner hekim veya klinik yöneticisi yanıtlar.</p>
        </div>
        <nav className="tab-bar compact" aria-label="Filtre">
          <Link href={`/app/${businessSlug}/requests`} aria-current={status === "PENDING" ? "page" : undefined}>Bekleyenler</Link>
          <Link href={`/app/${businessSlug}/requests?status=ALL`} aria-current={status === "ALL" ? "page" : undefined}>Tümü</Link>
        </nav>
      </header>
      {query.error && <p className="form-message error">{query.error}</p>}
      <div className="record-list">
        {(requests ?? []).map((request) => {
          const patient = patientMap.get(request.patient_id);
          const owner = ownerMap.get(request.owner_id);
          const pending = request.status === "PENDING";
          return (
            <article key={request.id} className={`panel-card request-card${request.request_type === "MEDICATION" ? " medication" : ""}`}>
              <div className="panel-heading">
                <div>
                  <p className="saas-kicker">{request.request_type === "APPOINTMENT" ? "Randevu talebi" : "İlaç talebi"} · {channelLabels[request.channel] ?? request.channel}</p>
                  <h2>
                    {patient ? <Link className="table-link" href={`/app/${businessSlug}/patients/${patient.id}`}>{patient.name}</Link> : "Hasta"}
                    <small> · {label(speciesLabels, patient?.species)}</small>
                  </h2>
                </div>
                <span className={`record-status status-${request.status === "PENDING" ? "scheduled" : request.status === "APPROVED" ? "completed" : "canceled"}`}>{statusLabels[request.status] ?? request.status}</span>
              </div>
              <dl className="detail-list">
                <div><dt>Sahip</dt><dd>{owner ? <Link className="table-link" href={`/app/${businessSlug}/owners/${owner.id}`}>{owner.full_name}</Link> : "—"}<small>{owner?.phone}</small></dd></div>
                <div><dt>Gönderildi</dt><dd>{formatDateTime(request.created_at, zone)}</dd></div>
                {request.request_type === "MEDICATION" ? (
                  <div><dt>İlaç / ürün (sahibin ifadesi)</dt><dd>{request.medication_name}</dd></div>
                ) : (
                  <div><dt>Tercih</dt><dd>{[request.preferred_date && formatDate(request.preferred_date), request.preferred_time].filter(Boolean).join(" · ") || "Belirtilmedi"}</dd></div>
                )}
                <div><dt>Açıklama</dt><dd className="record-note">{request.details}</dd></div>
                {request.clinic_response && <div><dt>Klinik yanıtı</dt><dd>{request.clinic_response}</dd></div>}
              </dl>
              {pending && request.request_type === "APPOINTMENT" && (
                <div className="split-panels">
                  <form action={approveAppointmentRequestAction.bind(null, businessSlug, request.id)} className="record-form embedded-form">
                    <div className="form-grid two-columns">
                      <label>Randevu zamanı<input name="startsAt" type="datetime-local" required defaultValue={defaultStart(request.preferred_date)} /></label>
                      <label>Süre<select name="durationMinutes" defaultValue="30">{[15, 20, 30, 45, 60, 90].map((minutes) => <option key={minutes} value={minutes}>{minutes} dk</option>)}</select></label>
                      <label>Veteriner hekim<select name="veterinarianMemberId" defaultValue=""><option value="">Atanmadı</option>{vets.map((vet) => <option key={vet.id} value={vet.id}>{vet.name}</option>)}</select></label>
                      <label>Sahibe not<input name="response" maxLength={1000} placeholder="Örn. Aşı kartını getiriniz" /></label>
                    </div>
                    <button className="saas-primary">Randevuyu oluştur ve onayla</button>
                  </form>
                  <form action={respondOwnerRequestAction.bind(null, businessSlug, request.id)} className="record-form embedded-form">
                    <input type="hidden" name="decision" value="REJECTED" />
                    <label className="form-grid">Red gerekçesi<input name="response" maxLength={1000} placeholder="Örn. Lütfen kliniği arayın" /></label>
                    <button className="secondary-button">Reddet</button>
                  </form>
                </div>
              )}
              {pending && request.request_type === "MEDICATION" && (
                clinical ? (
                  <form action={respondOwnerRequestAction.bind(null, businessSlug, request.id)} className="record-form embedded-form">
                    <label className="form-grid">Sahibe yanıt<input name="response" maxLength={1000} placeholder="Örn. Yarın 14:00'ten sonra teslim alabilirsiniz / Muayene gerekli" /></label>
                    <div className="inline-actions">
                      <button className="saas-primary" name="decision" value="APPROVED">Hekim olarak onayla</button>
                      <button className="secondary-button" name="decision" value="REJECTED">Reddet</button>
                    </div>
                    <p className="form-hint">Onaydan önce hastanın kayıtlarını kontrol edin. Bu talep bir reçete değildir; ilaç ve doz kararı veteriner hekime aittir.</p>
                  </form>
                ) : (
                  <p className="form-hint">Bu ilaç talebini bir veteriner hekim veya klinik yöneticisi yanıtlamalıdır.</p>
                )
              )}
            </article>
          );
        })}
        {!requests?.length && <section className="notice-card"><strong>{status === "PENDING" ? "Bekleyen talep yok." : "Henüz talep yok."}</strong></section>}
      </div>
    </div>
  );
}

import Link from "next/link";
import { getEntitlements, requireBusinessAccess } from "@/lib/auth/dal";
import {
  activityLabels,
  appointmentStatusLabels,
  formatDate,
  formatDateTime,
  formatTime,
  label,
  openAppointmentStatuses,
  speciesLabels,
} from "@/lib/clinic/labels";
import { loadTeam, memberNameMap } from "@/lib/clinic/queries";
import { isClinicalRole, roleLabel } from "@/lib/clinic/roles";
import { addDays, localDateString, zonedDayRange } from "@/lib/time";

export const dynamic = "force-dynamic";

const statusLabels: Record<string, string> = {
  PENDING: "Onay bekliyor",
  TRIAL: "Deneme kullanımı",
  ACTIVE: "Aktif",
  SUSPENDED: "Askıya alınmış",
  EXPIRED: "Süresi dolmuş",
  REJECTED: "Reddedilmiş",
};

export default async function ClinicDashboard({ params }: { params: Promise<{ businessSlug: string }> }) {
  const { businessSlug } = await params;
  const { business, membership, supabase } = await requireBusinessAccess(businessSlug);
  const base = `/app/${businessSlug}`;
  const header = (
    <header className="workspace-header">
      <div>
        <p className="saas-kicker">Klinik çalışma alanı · {roleLabel(membership.role)}</p>
        <h1>{business.display_name}</h1>
      </div>
      <span className={`status-pill status-${business.status.toLowerCase()}`}>{statusLabels[business.status] ?? business.status}</span>
    </header>
  );
  if (business.status === "PENDING")
    return (
      <div className="workspace-page">
        {header}
        <section className="notice-card">
          <strong>Başvurunuz Platform Admin incelemesinde.</strong>
          <p>Klinik aktif edilene, kullanım süresi ve haklar tanımlanana kadar klinik modülleri kapalıdır.</p>
        </section>
      </div>
    );

  const clinical = isClinicalRole(membership.role);
  const zone = business.timezone;
  const today = localDateString(zone);
  const day = zonedDayRange(today, zone);
  const weekEnd = zonedDayRange(addDays(today, 6), zone).end;
  const headCount = (table: string) =>
    supabase.from(table).select("id", { count: "exact", head: true }).eq("business_id", business.id);

  const [entitlement, team, todays, week, patients, owners, vaccinations, followUps, activity, pendingRequests] = await Promise.all([
    getEntitlements(supabase, business.id),
    loadTeam(supabase, business.id),
    supabase
      .from("appointments")
      .select("id,patient_id,veterinarian_member_id,starts_at,status,reason")
      .eq("business_id", business.id)
      .gte("starts_at", day.start)
      .lt("starts_at", day.end)
      .order("starts_at"),
    supabase
      .from("appointments")
      .select("veterinarian_member_id,status")
      .eq("business_id", business.id)
      .gte("starts_at", day.start)
      .lt("starts_at", weekEnd)
      .in("status", openAppointmentStatuses.concat("COMPLETED"))
      .limit(2000),
    headCount("patients").eq("status", "ACTIVE"),
    headCount("owners").is("archived_at", null),
    supabase
      .from("vaccinations")
      .select("id,patient_id,vaccine_name,next_due_at")
      .eq("business_id", business.id)
      .in("status", ["SCHEDULED", "ADMINISTERED"])
      .gte("next_due_at", addDays(today, -30))
      .lte("next_due_at", addDays(today, 14))
      .order("next_due_at")
      .limit(12),
    clinical
      ? supabase
          .from("examinations")
          .select("id,patient_id,follow_up_at,complaint")
          .eq("business_id", business.id)
          .gte("follow_up_at", today)
          .lte("follow_up_at", addDays(today, 14))
          .order("follow_up_at")
          .limit(12)
      : Promise.resolve({ data: [] as { id: string; patient_id: string; follow_up_at: string; complaint: string }[] }),
    supabase
      .from("activity_logs")
      .select("id,action,patient_id,created_at")
      .eq("business_id", business.id)
      .order("created_at", { ascending: false })
      .limit(10),
    headCount("owner_requests").eq("status", "PENDING"),
  ]);

  const patientIds = [
    ...new Set([
      ...(todays.data ?? []).map((item) => item.patient_id),
      ...(vaccinations.data ?? []).map((item) => item.patient_id),
      ...(followUps.data ?? []).map((item) => item.patient_id),
      ...(activity.data ?? []).map((item) => item.patient_id).filter(Boolean),
    ]),
  ] as string[];
  const { data: patientRows } = patientIds.length
    ? await supabase.from("patients").select("id,name,species").eq("business_id", business.id).in("id", patientIds)
    : { data: [] };
  const patientMap = new Map((patientRows ?? []).map((patient) => [patient.id as string, patient]));
  const names = memberNameMap(team);
  const perVet = new Map<string, { today: number; week: number }>();
  for (const item of week.data ?? []) {
    const key = item.veterinarian_member_id ?? "";
    const entry = perVet.get(key) ?? { today: 0, week: 0 };
    entry.week += 1;
    perVet.set(key, entry);
  }
  for (const item of todays.data ?? []) {
    if (!openAppointmentStatuses.concat("COMPLETED").includes(item.status)) continue;
    const entry = perVet.get(item.veterinarian_member_id ?? "") ?? { today: 0, week: 0 };
    entry.today += 1;
    perVet.set(item.veterinarian_member_id ?? "", entry);
  }
  const openToday = (todays.data ?? []).filter((item) => openAppointmentStatuses.includes(item.status)).length;
  const patientLink = (id: string | null) => {
    const patient = id ? patientMap.get(id) : null;
    return patient ? (
      <Link className="table-link" href={`${base}/patients/${patient.id}`}>
        <strong>{patient.name}</strong>
      </Link>
    ) : (
      "—"
    );
  };

  return (
    <div className="workspace-page">
      {header}
      {entitlement?.owner_portal_enabled && !!pendingRequests.count && (
        <section className="notice-card request-notice">
          <strong>{pendingRequests.count} hayvan sahibi talebi yanıt bekliyor.</strong>
          <p><Link className="text-link" href={`${base}/requests`}>Talepleri görüntüle</Link></p>
        </section>
      )}
      <section className="metric-grid">
        <article><small>Bugünkü randevu</small><strong>{todays.data?.length ?? 0}</strong><span>{openToday} açık</span></article>
        <article><small>Kayıtlı hasta</small><strong>{patients.count ?? 0}</strong></article>
        <article><small>Hayvan sahibi</small><strong>{owners.count ?? 0}</strong></article>
        <article><small>14 gün içinde aşı</small><strong>{(vaccinations.data ?? []).filter((item) => item.next_due_at >= today).length}</strong><span>{(vaccinations.data ?? []).filter((item) => item.next_due_at < today).length} gecikmiş</span></article>
      </section>

      <section className="split-panels top-gap">
        <article className="panel-card">
          <div className="panel-heading"><div><p className="saas-kicker">{formatDate(today)}</p><h2>Bugünkü randevular</h2></div>{entitlement?.appointments_enabled && <Link className="text-link" href={`${base}/appointments`}>Takvim</Link>}</div>
          <div className="stack-list">
            {(todays.data ?? []).map((appointment) => (
              <div key={appointment.id} className="list-row static">
                <span>
                  <strong>{formatTime(appointment.starts_at, zone)} · {patientLink(appointment.patient_id)}</strong>
                  <small>{appointment.reason} · {appointment.veterinarian_member_id ? names.get(appointment.veterinarian_member_id) ?? "Veteriner hekim" : "Hekim atanmadı"}</small>
                </span>
                <b className={`record-status status-${appointment.status.toLowerCase()}`}>{label(appointmentStatusLabels, appointment.status)}</b>
              </div>
            ))}
            {!todays.data?.length && <p className="empty-note">Bugün için randevu yok.</p>}
          </div>
        </article>
        <article className="panel-card">
          <div className="panel-heading"><div><p className="saas-kicker">Bugün / 7 gün</p><h2>Veteriner hekim bazında randevular</h2></div></div>
          <div className="feature-list">
            {[...perVet.entries()].map(([memberId, totals]) => (
              <div key={memberId || "none"}><span>{memberId ? names.get(memberId) ?? "Veteriner hekim" : "Atanmamış"}</span><strong>{totals.today} / {totals.week}</strong></div>
            ))}
            {!perVet.size && <p className="empty-note">Önümüzdeki 7 gün için randevu yok.</p>}
          </div>
        </article>
      </section>

      <section className="split-panels top-gap">
        <article className="panel-card">
          <div className="panel-heading"><div><p className="saas-kicker">Gecikmiş ve 14 gün</p><h2>Yaklaşan aşılar</h2></div><Link className="text-link" href={`${base}/vaccinations`}>Tümü</Link></div>
          <div className="stack-list">
            {(vaccinations.data ?? []).map((vaccination) => (
              <div key={vaccination.id} className="list-row static">
                <span><strong>{patientLink(vaccination.patient_id)}</strong><small>{vaccination.vaccine_name} · {label(speciesLabels, patientMap.get(vaccination.patient_id)?.species)}</small></span>
                <b className={vaccination.next_due_at < today ? "feature-off" : ""}>{formatDate(vaccination.next_due_at)}</b>
              </div>
            ))}
            {!vaccinations.data?.length && <p className="empty-note">Yaklaşan aşı yok.</p>}
          </div>
        </article>
        {clinical ? (
          <article className="panel-card">
            <div className="panel-heading"><div><p className="saas-kicker">14 gün</p><h2>Yaklaşan kontroller</h2></div></div>
            <div className="stack-list">
              {(followUps.data ?? []).map((exam) => (
                <div key={exam.id} className="list-row static">
                  <span><strong>{patientLink(exam.patient_id)}</strong><small>{exam.complaint}</small></span>
                  <b>{formatDate(exam.follow_up_at)}</b>
                </div>
              ))}
              {!followUps.data?.length && <p className="empty-note">Planlanmış kontrol yok.</p>}
            </div>
          </article>
        ) : (
          <article className="panel-card">
            <div className="panel-heading"><div><p className="saas-kicker">Rol</p><h2>Klinik personeli</h2></div></div>
            <p className="form-hint">Muayene ve tedavi kayıtları yalnızca veteriner hekimler ve klinik yöneticisi tarafından görüntülenir.</p>
          </article>
        )}
      </section>

      <section className="panel-card top-gap">
        <div className="panel-heading"><div><p className="saas-kicker">Denetim izi</p><h2>Son işlemler</h2></div></div>
        <div className="timeline-list">
          {(activity.data ?? []).map((item) => (
            <article key={item.id}><span /><div><strong>{label(activityLabels, item.action)}</strong><p>{item.patient_id ? patientMap.get(item.patient_id)?.name ?? "Hasta" : "Klinik kaydı"}</p><small>{formatDateTime(item.created_at, zone)}</small></div></article>
          ))}
          {!activity.data?.length && <p className="empty-note">Henüz işlem yok.</p>}
        </div>
      </section>
    </div>
  );
}

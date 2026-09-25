import Link from "next/link";
import { notFound } from "next/navigation";
import { ClinicAdvisor } from "@/components/ai/ClinicAdvisor";
import { getEntitlements, requireBusinessAccess } from "@/lib/auth/dal";
import { advisorIntents, allowedIntents } from "@/lib/clinic-ai/intents";
import {
  activityLabels,
  ageLabel,
  appointmentStatusLabels,
  formatDate,
  formatDateTime,
  label,
  neuterLabels,
  patientStatusLabels,
  sexLabels,
  speciesLabels,
  vaccinationStatusLabels,
} from "@/lib/clinic/labels";
import { loadTeam, memberNameMap, practitioners } from "@/lib/clinic/queries";
import { isClinicalRole } from "@/lib/clinic/roles";
import { localDateString } from "@/lib/time";
import { createTreatmentAction, createVaccinationAction, updateVaccinationStatusAction } from "../../clinical-actions";

export const dynamic = "force-dynamic";

const patientIntents = ["PATIENT_HISTORY", "RECENT_EXAMINATIONS", "VACCINATION_SUMMARY", "OWNER_INFO_DRAFT", "NOTE_CLEANUP"];

export default async function PatientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessSlug: string; patientId: string }>;
  searchParams: Promise<{ tab?: string; error?: string; saved?: string }>;
}) {
  const { businessSlug, patientId } = await params;
  const query = await searchParams;
  const { business, membership, supabase } = await requireBusinessAccess(businessSlug);
  const clinical = isClinicalRole(membership.role);
  const tabs = [
    ["overview", "Genel bakış"],
    ...(clinical ? [["examinations", "Muayeneler"], ["treatments", "Tedavi / İşlemler"]] : []),
    ["vaccinations", "Aşılar"],
    ["appointments", "Randevular"],
  ] as [string, string][];
  const tab = tabs.some(([key]) => key === query.tab) ? query.tab! : "overview";
  const base = `/app/${businessSlug}`;
  const zone = business.timezone;

  const { data: patient } = await supabase
    .from("patients")
    .select("*")
    .eq("business_id", business.id)
    .eq("id", patientId)
    .maybeSingle();
  if (!patient) notFound();

  const [entitlement, team, owner, examinations, treatments, vaccinations, appointments, activity, photo] = await Promise.all([
    getEntitlements(supabase, business.id),
    loadTeam(supabase, business.id),
    supabase.from("owners").select("id,full_name,phone,email,address").eq("business_id", business.id).eq("id", patient.owner_id).maybeSingle(),
    clinical
      ? supabase.from("examinations").select("*").eq("business_id", business.id).eq("patient_id", patientId).order("examined_at", { ascending: false }).limit(100)
      : Promise.resolve({ data: [] as Record<string, string | null>[] }),
    clinical
      ? supabase.from("treatments").select("*").eq("business_id", business.id).eq("patient_id", patientId).order("performed_at", { ascending: false }).limit(100)
      : Promise.resolve({ data: [] as Record<string, string | null>[] }),
    supabase.from("vaccinations").select("*").eq("business_id", business.id).eq("patient_id", patientId).order("created_at", { ascending: false }).limit(100),
    supabase.from("appointments").select("id,starts_at,status,reason,veterinarian_member_id").eq("business_id", business.id).eq("patient_id", patientId).order("starts_at", { ascending: false }).limit(50),
    supabase.from("activity_logs").select("id,action,created_at").eq("business_id", business.id).eq("patient_id", patientId).order("created_at", { ascending: false }).limit(12),
    patient.photo_path
      ? supabase.storage.from("patient-photos").createSignedUrl(patient.photo_path, 3600)
      : Promise.resolve({ data: null }),
  ]);
  const names = memberNameMap(team);
  const vets = practitioners(team);
  const today = localDateString(zone);
  const nowLocal = new Intl.DateTimeFormat("sv-SE", { timeZone: zone, dateStyle: "short", timeStyle: "short" }).format(new Date()).replace(" ", "T");
  const defaultVet = vets.some((vet) => vet.id === membership.id) ? membership.id : "";
  const lastExam = examinations.data?.[0];
  const dueVaccines = (vaccinations.data ?? []).filter((item) => item.status !== "CANCELED" && item.next_due_at);
  const nextDue = dueVaccines
    .map((item) => item.next_due_at as string)
    .filter((date) => date >= today)
    .sort()[0];
  const aiActions = allowedIntents(membership.role)
    .filter((intent) => patientIntents.includes(intent))
    .map((intent) => ({ intent, label: advisorIntents[intent].label }));
  const vetOptions = vets.map((vet) => <option key={vet.id} value={vet.id}>{vet.name}</option>);

  return (
    <div className="workspace-page">
      <header className="workspace-header patient-header">
        <div className="patient-identity">
          {photo.data?.signedUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from private storage
            <img className="patient-photo" src={photo.data.signedUrl} alt={`${patient.name} fotoğrafı`} />
          ) : (
            <span className="patient-photo placeholder" aria-hidden="true">{patient.name.slice(0, 1).toLocaleUpperCase("tr-TR")}</span>
          )}
          <div>
            <p className="saas-kicker">Hasta · {label(patientStatusLabels, patient.status)}</p>
            <h1>{patient.name}</h1>
            <p className="page-subtitle">
              {label(speciesLabels, patient.species)}{patient.breed ? ` · ${patient.breed}` : ""} · {label(sexLabels, patient.sex)} · {ageLabel(patient.birth_date, patient.birth_date_estimated)}
            </p>
          </div>
        </div>
        <div className="action-row">
          {clinical && <Link className="saas-primary" href={`${base}/patients/${patient.id}/examinations/new`}>Muayene ekle</Link>}
          {entitlement?.appointments_enabled && <Link className="secondary-button" href={`${base}/appointments/new?patient=${patient.id}`}>Randevu ver</Link>}
          <Link className="secondary-button" href={`${base}/patients/${patient.id}/edit`}>Düzenle</Link>
        </div>
      </header>
      {query.error && <p className="form-message error">{query.error}</p>}
      {query.saved && <p className="form-message success">Hasta bilgileri güncellendi.</p>}

      <section className="detail-grid">
        <article className="panel-card detail-main">
          <div className="panel-heading"><div><p className="saas-kicker">Kimlik</p><h2>Hasta bilgileri</h2></div></div>
          <dl className="detail-list">
            <div><dt>Sahibi</dt><dd>{owner.data ? <Link className="table-link" href={`${base}/owners/${owner.data.id}`}>{owner.data.full_name}</Link> : "—"}<small>{[owner.data?.phone, owner.data?.email].filter(Boolean).join(" · ")}</small></dd></div>
            <div><dt>Doğum tarihi</dt><dd>{patient.birth_date ? `${formatDate(patient.birth_date)}${patient.birth_date_estimated ? " (yaklaşık)" : ""}` : "—"}</dd></div>
            <div><dt>Renk</dt><dd>{patient.color ?? "—"}</dd></div>
            <div><dt>Kilo</dt><dd>{patient.weight_kg ? `${patient.weight_kg} kg` : "—"}</dd></div>
            <div><dt>Mikroçip</dt><dd>{patient.microchip_number ?? "—"}</dd></div>
            <div><dt>Kısırlaştırma</dt><dd>{label(neuterLabels, patient.neuter_status)}</dd></div>
          </dl>
          {patient.notes && <p className="record-note top-gap">{patient.notes}</p>}
        </article>
        <aside className="panel-card">
          <p className="saas-kicker">Takip</p>
          <dl className="detail-list compact">
            {clinical && <div><dt>Son muayene</dt><dd>{lastExam ? formatDateTime(lastExam.examined_at, zone) : "—"}</dd></div>}
            {clinical && <div><dt>Kontrol tarihi</dt><dd>{lastExam?.follow_up_at ? formatDate(lastExam.follow_up_at) : "—"}</dd></div>}
            <div><dt>Sıradaki aşı</dt><dd>{nextDue ? formatDate(nextDue) : "—"}</dd></div>
            <div><dt>Gecikmiş aşı</dt><dd>{dueVaccines.filter((item) => item.next_due_at < today && item.status === "SCHEDULED").length}</dd></div>
          </dl>
        </aside>
      </section>

      {entitlement?.ai_assistant_enabled && !!aiActions.length && (
        <ClinicAdvisor
          businessSlug={businessSlug}
          patient={{ id: patient.id, name: patient.name }}
          actions={aiActions}
          voiceEnabled={entitlement.ai_voice_enabled}
          placeholder="Kontrollü işlemlerden birini seçin veya bu hasta hakkında yazarak ya da sesli sorun. MK Pati AI yalnızca bu kliniğin kayıtlarını kullanır."
        />
      )}

      <nav className="tab-bar top-gap" aria-label="Hasta kayıtları">
        {tabs.map(([key, text]) => (
          <Link key={key} href={`${base}/patients/${patient.id}?tab=${key}`} aria-current={tab === key ? "page" : undefined}>{text}</Link>
        ))}
      </nav>

      {tab === "overview" && (
        <section className="panel-card">
          <div className="panel-heading"><div><p className="saas-kicker">Denetim izi</p><h2>Son işlemler</h2></div></div>
          <div className="timeline-list">
            {(activity.data ?? []).map((item) => (
              <article key={item.id}><span /><div><strong>{label(activityLabels, item.action)}</strong><small>{formatDateTime(item.created_at, zone)}</small></div></article>
            ))}
            {!activity.data?.length && <p className="empty-note">Henüz işlem yok.</p>}
          </div>
        </section>
      )}

      {tab === "examinations" && clinical && (
        <section className="panel-card">
          <div className="panel-heading"><div><p className="saas-kicker">Klinik kayıt</p><h2>Muayeneler</h2></div><Link className="text-link" href={`${base}/patients/${patient.id}/examinations/new`}>Muayene ekle</Link></div>
          <div className="record-list">
            {(examinations.data ?? []).map((exam) => (
              <details key={exam.id as string} className="record-item">
                <summary>
                  <strong>{formatDateTime(exam.examined_at, zone)} · {exam.complaint}</strong>
                  <small>{names.get(exam.veterinarian_member_id as string) ?? "Veteriner hekim"}{exam.follow_up_at ? ` · Kontrol ${formatDate(exam.follow_up_at)}` : ""}</small>
                </summary>
                <dl className="detail-list">
                  {([["Anamnez", exam.anamnesis], ["Muayene bulguları", exam.findings], ["Veteriner değerlendirmesi", exam.assessment], ["Yapılan işlemler", exam.procedures], ["Ek notlar", exam.extra_notes]] as const).map(([title, value]) => (
                    <div key={title}><dt>{title}</dt><dd className="record-note">{value ?? "—"}</dd></div>
                  ))}
                </dl>
              </details>
            ))}
            {!examinations.data?.length && <p className="empty-note">Henüz muayene kaydı yok.</p>}
          </div>
        </section>
      )}

      {tab === "treatments" && clinical && (
        <section className="split-panels">
          <article className="panel-card">
            <div className="panel-heading"><div><p className="saas-kicker">Klinik kayıt</p><h2>Tedavi / işlem geçmişi</h2></div></div>
            <div className="record-list">
              {(treatments.data ?? []).map((treatment) => (
                <details key={treatment.id as string} className="record-item">
                  <summary><strong>{formatDateTime(treatment.performed_at, zone)} · {treatment.procedure_name}</strong><small>{names.get(treatment.veterinarian_member_id as string) ?? "Veteriner hekim"}</small></summary>
                  <dl className="detail-list">
                    <div><dt>Açıklama</dt><dd className="record-note">{treatment.description ?? "—"}</dd></div>
                    <div><dt>Klinik notu</dt><dd className="record-note">{treatment.clinical_note ?? "—"}</dd></div>
                  </dl>
                </details>
              ))}
              {!treatments.data?.length && <p className="empty-note">Henüz işlem kaydı yok.</p>}
            </div>
          </article>
          <article className="panel-card">
            <div className="panel-heading"><div><p className="saas-kicker">Yeni kayıt</p><h2>İşlem ekle</h2></div></div>
            <form action={createTreatmentAction.bind(null, businessSlug, patient.id)} className="record-form embedded-form">
              <div className="form-grid">
                <label>İşlem<input name="procedureName" required minLength={2} maxLength={200} /></label>
                <label>Tarih / saat<input name="performedAt" type="datetime-local" required defaultValue={nowLocal} /></label>
                <label>Veteriner hekim<select name="veterinarianMemberId" required defaultValue={defaultVet}><option value="" disabled>Seçin</option>{vetOptions}</select></label>
                <label>İlgili muayene<select name="examinationId" defaultValue=""><option value="">Bağımsız işlem</option>{(examinations.data ?? []).slice(0, 20).map((exam) => <option key={exam.id as string} value={exam.id as string}>{formatDate(exam.examined_at, zone)} · {exam.complaint}</option>)}</select></label>
                <label>Açıklama<textarea name="description" rows={3} maxLength={5000} /></label>
                <label>Klinik notu<textarea name="clinicalNote" rows={3} maxLength={5000} /></label>
              </div>
              <button className="saas-primary">İşlemi kaydet</button>
            </form>
          </article>
        </section>
      )}

      {tab === "vaccinations" && (
        <section className="split-panels">
          <article className="panel-card">
            <div className="panel-heading"><div><p className="saas-kicker">Aşı takibi</p><h2>Aşılar</h2></div></div>
            <div className="stack-list">
              {(vaccinations.data ?? []).map((vaccination) => {
                const overdue = vaccination.status === "SCHEDULED" && vaccination.next_due_at < today;
                const update = updateVaccinationStatusAction.bind(null, businessSlug, patient.id, vaccination.id);
                return (
                  <div key={vaccination.id} className="list-row static">
                    <span>
                      <strong>{vaccination.vaccine_name}</strong>
                      <small>
                        {label(vaccinationStatusLabels, vaccination.status)}
                        {vaccination.administered_at ? ` · Uygulama ${formatDate(vaccination.administered_at)}` : ""}
                        {vaccination.next_due_at ? ` · ${vaccination.status === "SCHEDULED" ? "Planlanan" : "Sonraki"} ${formatDate(vaccination.next_due_at)}` : ""}
                        {vaccination.veterinarian_member_id ? ` · ${names.get(vaccination.veterinarian_member_id) ?? "Veteriner hekim"}` : ""}
                      </small>
                    </span>
                    {vaccination.status === "SCHEDULED" ? (
                      <form action={update} className="inline-actions">
                        {overdue && <b className="feature-off">Gecikmiş</b>}
                        <button className="table-action" name="status" value="ADMINISTERED">Uygulandı</button>
                        <button className="table-action" name="status" value="CANCELED">İptal</button>
                      </form>
                    ) : null}
                  </div>
                );
              })}
              {!vaccinations.data?.length && <p className="empty-note">Henüz aşı kaydı yok.</p>}
            </div>
          </article>
          <article className="panel-card">
            <div className="panel-heading"><div><p className="saas-kicker">Yeni kayıt</p><h2>Aşı ekle</h2></div></div>
            <form action={createVaccinationAction.bind(null, businessSlug, patient.id)} className="record-form embedded-form">
              <div className="form-grid">
                <label>Aşı<input name="vaccineName" required minLength={2} maxLength={160} placeholder="Örn. Karma, Kuduz, İç-dış parazit" /></label>
                <label>Durum<select name="status" defaultValue="ADMINISTERED"><option value="ADMINISTERED">Uygulandı</option><option value="SCHEDULED">Planlandı</option></select></label>
                <label>Uygulama tarihi<input name="administeredAt" type="date" defaultValue={today} /></label>
                <label>Sonraki / planlanan tarih<input name="nextDueAt" type="date" /></label>
                <label>Veteriner hekim<select name="veterinarianMemberId" defaultValue={defaultVet}><option value="">Belirtilmedi</option>{vetOptions}</select></label>
                <label>Not<input name="notes" maxLength={2000} /></label>
              </div>
              <p className="form-hint">Planlanan aşılarda yalnızca “Sonraki / planlanan tarih” kullanılır.</p>
              <button className="saas-primary">Aşıyı kaydet</button>
            </form>
          </article>
        </section>
      )}

      {tab === "appointments" && (
        <section className="panel-card">
          <div className="panel-heading"><div><p className="saas-kicker">Takvim</p><h2>Randevular</h2></div>{entitlement?.appointments_enabled && <Link className="text-link" href={`${base}/appointments/new?patient=${patient.id}`}>Randevu ver</Link>}</div>
          <div className="stack-list">
            {(appointments.data ?? []).map((appointment) => (
              <div key={appointment.id} className="list-row static">
                <span><strong>{formatDateTime(appointment.starts_at, zone)}</strong><small>{appointment.reason} · {appointment.veterinarian_member_id ? names.get(appointment.veterinarian_member_id) ?? "Veteriner hekim" : "Hekim atanmadı"}</small></span>
                <b className={`record-status status-${appointment.status.toLowerCase()}`}>{label(appointmentStatusLabels, appointment.status)}</b>
              </div>
            ))}
            {!appointments.data?.length && <p className="empty-note">Randevu kaydı yok.</p>}
          </div>
        </section>
      )}
    </div>
  );
}

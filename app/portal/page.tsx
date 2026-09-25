import { OwnerAssistant } from "@/components/portal/OwnerAssistant";
import { OwnerRequestForm } from "@/components/portal/OwnerRequestForm";
import { ageLabel, appointmentStatusLabels, formatDate, formatDateTime, label, speciesLabels } from "@/lib/clinic/labels";
import { requireOwnerPortal } from "@/lib/owner-portal/access";
import { localDateString } from "@/lib/time";
import { cancelOwnerRequestAction } from "./actions";

export const dynamic = "force-dynamic";

const requestStatus: Record<string, string> = {
  PENDING: "Klinik onayı bekliyor",
  APPROVED: "Onaylandı",
  REJECTED: "Reddedildi",
  CANCELED: "İptal edildi",
};

export default async function OwnerPortalPage() {
  const { overview } = await requireOwnerPortal();
  if (!overview)
    return (
      <section className="notice-card">
        <strong>Portal şu anda kullanılamıyor.</strong>
        <p>Kliniğinizin portal erişimi kapalı olabilir. Lütfen kliniğinizle iletişime geçin.</p>
      </section>
    );
  const { clinic, pets } = overview;
  const zone = clinic.timezone;
  const today = localDateString(zone);
  const petName = new Map(pets.map((pet) => [pet.id, pet.name]));
  const upcoming = overview.appointments
    .filter((item) => Date.parse(item.ends_at) >= Date.parse(`${today}T00:00:00Z`) && ["SCHEDULED", "CONFIRMED", "CHECKED_IN"].includes(item.status))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));

  return (
    <div className="workspace-page">
      <header className="workspace-header">
        <div>
          <p className="saas-kicker">Hayvan sahibi portalı</p>
          <h1>Merhaba, {overview.owner.full_name.split(" ")[0]}</h1>
          <p className="page-subtitle">{clinic.display_name}{clinic.phone ? ` · ${clinic.phone}` : ""}</p>
        </div>
      </header>

      {clinic.ai_enabled && <OwnerAssistant voiceEnabled={clinic.ai_voice_enabled} clinicPhone={clinic.phone} />}

      <section className="pet-grid top-gap">
        {pets.map((pet) => {
          const vaccines = overview.vaccinations.filter((item) => item.patient_id === pet.id && item.next_due_at);
          const nextDue = vaccines.map((item) => item.next_due_at as string).sort()[0];
          return (
            <article key={pet.id} className="panel-card">
              <p className="saas-kicker">{label(speciesLabels, pet.species)}</p>
              <h2>{pet.name}</h2>
              <dl className="detail-list compact">
                <div><dt>Irk / yaş</dt><dd>{pet.breed ?? "—"} · {ageLabel(pet.birth_date, pet.birth_date_estimated)}</dd></div>
                <div><dt>Sıradaki aşı</dt><dd className={nextDue && nextDue < today ? "feature-off" : undefined}>{nextDue ? `${formatDate(nextDue)}${nextDue < today ? " (gecikmiş)" : ""}` : "—"}</dd></div>
              </dl>
            </article>
          );
        })}
        {!pets.length && <p className="empty-note">Portalınızda kayıtlı hayvan bulunmuyor.</p>}
      </section>

      <section className="split-panels">
        <article className="panel-card">
          <div className="panel-heading"><div><p className="saas-kicker">Takvim</p><h2>Yaklaşan randevular</h2></div></div>
          <div className="stack-list">
            {upcoming.map((item) => (
              <div key={item.id} className="list-row static">
                <span><strong>{formatDateTime(item.starts_at, zone)} · {petName.get(item.patient_id) ?? "Hayvanınız"}</strong><small>{item.reason}</small></span>
                <b className={`record-status status-${item.status.toLowerCase()}`}>{label(appointmentStatusLabels, item.status)}</b>
              </div>
            ))}
            {!upcoming.length && <p className="empty-note">Yaklaşan randevunuz yok.</p>}
          </div>
        </article>
        <article className="panel-card">
          <div className="panel-heading"><div><p className="saas-kicker">Talep</p><h2>Randevu veya ilaç talebi</h2></div></div>
          {pets.length ? (
            <OwnerRequestForm pets={pets.map((pet) => ({ id: pet.id, name: pet.name }))} appointmentsEnabled={clinic.appointments_enabled} today={today} />
          ) : (
            <p className="empty-note">Talep oluşturmak için kayıtlı bir hayvanınız olmalı.</p>
          )}
        </article>
      </section>

      <section className="panel-card top-gap">
        <div className="panel-heading"><div><p className="saas-kicker">Durum</p><h2>Taleplerim</h2></div></div>
        <div className="stack-list">
          {overview.requests.map((item) => (
            <div key={item.id} className="list-row static">
              <span>
                <strong>{item.request_type === "APPOINTMENT" ? "Randevu" : `İlaç: ${item.medication_name}`} · {petName.get(item.patient_id) ?? "Hayvanınız"}</strong>
                <small>
                  {formatDateTime(item.created_at, zone)}
                  {item.preferred_date ? ` · Tercih: ${formatDate(item.preferred_date)}` : ""}
                  {item.preferred_time ? ` ${item.preferred_time}` : ""}
                </small>
                {item.clinic_response && <small>Klinik: {item.clinic_response}</small>}
              </span>
              <span className="inline-actions">
                <b className={`record-status status-${item.status.toLowerCase()}`}>{requestStatus[item.status] ?? item.status}</b>
                {item.status === "PENDING" && (
                  <form action={cancelOwnerRequestAction.bind(null, item.id)}><button className="table-action">İptal et</button></form>
                )}
              </span>
            </div>
          ))}
          {!overview.requests.length && <p className="empty-note">Henüz talebiniz yok.</p>}
        </div>
      </section>
    </div>
  );
}

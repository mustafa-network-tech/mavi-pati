import Link from "next/link";
import { notFound } from "next/navigation";
import { getEntitlements, requireBusinessAccess } from "@/lib/auth/dal";
import { label, speciesLabels } from "@/lib/clinic/labels";
import { loadTeam, practitioners } from "@/lib/clinic/queries";
import { createAppointmentAction } from "../../appointment-actions";

export const dynamic = "force-dynamic";

export default async function NewAppointmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessSlug: string }>;
  searchParams: Promise<{ error?: string; patient?: string }>;
}) {
  const { businessSlug } = await params;
  const query = await searchParams;
  const { business, membership, supabase } = await requireBusinessAccess(businessSlug);
  const entitlement = await getEntitlements(supabase, business.id);
  if (!entitlement?.appointments_enabled) notFound();
  const [{ data: patients }, team] = await Promise.all([
    supabase.from("patients").select("id,name,species,owner_id").eq("business_id", business.id).eq("status", "ACTIVE").order("name").limit(2000),
    loadTeam(supabase, business.id),
  ]);
  const ownerIds = [...new Set((patients ?? []).map((patient) => patient.owner_id))];
  const { data: owners } = ownerIds.length
    ? await supabase.from("owners").select("id,full_name").eq("business_id", business.id).in("id", ownerIds)
    : { data: [] };
  const ownerNames = new Map((owners ?? []).map((owner) => [owner.id as string, owner.full_name as string]));
  const vets = practitioners(team);

  return (
    <div className="workspace-page narrow-page">
      <header className="workspace-header">
        <div><p className="saas-kicker">Takvim</p><h1>Yeni randevu</h1></div>
        <Link className="text-link" href={`/app/${businessSlug}/appointments`}>Takvime dön</Link>
      </header>
      <form action={createAppointmentAction.bind(null, businessSlug)} className="record-form">
        {query.error && <p className="form-message error">{query.error}</p>}
        <div className="form-grid two-columns">
          <label className="full-field">Hasta
            <select name="patientId" required defaultValue={query.patient ?? ""}>
              <option value="" disabled>Hasta seçin</option>
              {patients?.map((patient) => (
                <option key={patient.id} value={patient.id}>{patient.name} · {label(speciesLabels, patient.species)} · {ownerNames.get(patient.owner_id) ?? "Sahip"}</option>
              ))}
            </select>
          </label>
          <label>Veteriner hekim
            <select name="veterinarianMemberId" defaultValue={vets.some((vet) => vet.id === membership.id) ? membership.id : ""}>
              <option value="">Atanmadı</option>
              {vets.map((vet) => <option key={vet.id} value={vet.id}>{vet.name}</option>)}
            </select>
          </label>
          <label>Başlangıç<input name="startsAt" type="datetime-local" required /></label>
          <label>Süre
            <select name="durationMinutes" defaultValue="30">
              {[15, 20, 30, 45, 60, 90, 120].map((minutes) => <option key={minutes} value={minutes}>{minutes} dk</option>)}
            </select>
          </label>
          <label>Açıklama<input name="reason" required minLength={2} maxLength={500} placeholder="Örn. Aşı, kontrol, muayene" /></label>
          <label className="full-field">Not<textarea name="notes" rows={3} maxLength={2000} /></label>
        </div>
        <p className="form-hint">Hayvan sahibi hastanın kaydından otomatik atanır. Aynı hekime çakışan randevu verilemez. Hasta listede yoksa önce <Link className="text-link" href={`/app/${businessSlug}/patients/new`}>hasta kaydı</Link> oluşturun.</p>
        <button className="saas-primary">Randevu oluştur</button>
      </form>
    </div>
  );
}

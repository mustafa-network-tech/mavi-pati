import Link from "next/link";
import { notFound } from "next/navigation";
import { requireBusinessAccess } from "@/lib/auth/dal";
import { label, speciesLabels } from "@/lib/clinic/labels";
import { loadTeam, practitioners } from "@/lib/clinic/queries";
import { isClinicalRole } from "@/lib/clinic/roles";
import { createExaminationAction } from "../../../../clinical-actions";

export const dynamic = "force-dynamic";

export default async function NewExaminationPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessSlug: string; patientId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { businessSlug, patientId } = await params;
  const query = await searchParams;
  const { business, membership, supabase } = await requireBusinessAccess(businessSlug);
  if (!isClinicalRole(membership.role)) notFound();
  const [{ data: patient }, team] = await Promise.all([
    supabase.from("patients").select("id,name,species").eq("business_id", business.id).eq("id", patientId).maybeSingle(),
    loadTeam(supabase, business.id),
  ]);
  if (!patient) notFound();
  const vets = practitioners(team);
  const nowLocal = new Intl.DateTimeFormat("sv-SE", { timeZone: business.timezone, dateStyle: "short", timeStyle: "short" })
    .format(new Date())
    .replace(" ", "T");

  return (
    <div className="workspace-page narrow-page">
      <header className="workspace-header">
        <div><p className="saas-kicker">{patient.name} · {label(speciesLabels, patient.species)}</p><h1>Yeni muayene</h1></div>
        <Link className="text-link" href={`/app/${businessSlug}/patients/${patient.id}?tab=examinations`}>Hastaya dön</Link>
      </header>
      <form action={createExaminationAction.bind(null, businessSlug, patient.id)} className="record-form">
        {query.error && <p className="form-message error">{query.error}</p>}
        <div className="form-grid two-columns">
          <label>Tarih / saat<input name="examinedAt" type="datetime-local" required defaultValue={nowLocal} /></label>
          <label>Veteriner hekim<select name="veterinarianMemberId" required defaultValue={vets.some((vet) => vet.id === membership.id) ? membership.id : ""}><option value="" disabled>Seçin</option>{vets.map((vet) => <option key={vet.id} value={vet.id}>{vet.name}</option>)}</select></label>
          <label className="full-field">Başvuru nedeni<input name="complaint" required minLength={2} maxLength={1000} /></label>
          <label className="full-field">Anamnez / not<textarea name="anamnesis" rows={4} maxLength={10000} /></label>
          <label className="full-field">Muayene bulguları<textarea name="findings" rows={4} maxLength={10000} /></label>
          <label className="full-field">Veteriner değerlendirmesi<textarea name="assessment" rows={4} maxLength={10000} /></label>
          <label className="full-field">Yapılan işlemler<textarea name="procedures" rows={3} maxLength={5000} /></label>
          <label>Kontrol tarihi<input name="followUpAt" type="date" /></label>
          <label>Ek notlar<input name="extraNotes" maxLength={5000} /></label>
        </div>
        <p className="form-hint">Muayene kayıtları yalnızca veteriner hekimler ve klinik yöneticisi tarafından görüntülenir. Kaydı yalnızca yazan hekim veya klinik yöneticisi düzenleyebilir.</p>
        <button className="saas-primary">Muayeneyi kaydet</button>
      </form>
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { OwnerFields } from "@/components/clinic/OwnerFields";
import { OwnerInvitation } from "@/components/clinic/OwnerInvitation";
import { getEntitlements, requireBusinessAccess } from "@/lib/auth/dal";
import { ageLabel, formatDate, label, patientStatusLabels, speciesLabels } from "@/lib/clinic/labels";
import { updateOwnerAction } from "../../clinic-actions";
import { revokeOwnerPortalAction } from "../../owner-request-actions";

export const dynamic = "force-dynamic";

export default async function OwnerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessSlug: string; ownerId: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { businessSlug, ownerId } = await params;
  const query = await searchParams;
  const { business, supabase } = await requireBusinessAccess(businessSlug);
  const [{ data: owner }, { data: patients }, entitlement, { data: portalAccount }] = await Promise.all([
    supabase.from("owners").select("id,full_name,phone,email,address,notes,created_at").eq("business_id", business.id).eq("id", ownerId).maybeSingle(),
    supabase.from("patients").select("id,name,species,breed,birth_date,birth_date_estimated,status").eq("business_id", business.id).eq("owner_id", ownerId).order("name"),
    getEntitlements(supabase, business.id),
    supabase.from("owner_portal_accounts").select("id,created_at").eq("business_id", business.id).eq("owner_id", ownerId).eq("status", "ACTIVE").maybeSingle(),
  ]);
  if (!owner) notFound();

  return (
    <div className="workspace-page">
      <header className="workspace-header">
        <div>
          <p className="saas-kicker">Hayvan sahibi</p>
          <h1>{owner.full_name}</h1>
          <p className="page-subtitle">{[owner.phone, owner.email].filter(Boolean).join(" · ") || "İletişim bilgisi yok"} · Kayıt {formatDate(owner.created_at, business.timezone)}</p>
        </div>
        <Link className="saas-primary" href={`/app/${businessSlug}/patients/new?owner=${owner.id}`}>Hasta ekle</Link>
      </header>
      {query.error && <p className="form-message error">{query.error}</p>}
      {query.saved && <p className="form-message success">Kayıt güncellendi.</p>}
      <section className="split-panels">
        <article className="panel-card">
          <div className="panel-heading"><div><p className="saas-kicker">Hastalar</p><h2>Patiler</h2></div></div>
          <div className="stack-list">
            {patients?.map((patient) => (
              <Link key={patient.id} className="list-row" href={`/app/${businessSlug}/patients/${patient.id}`}>
                <span><strong>{patient.name}</strong><small>{label(speciesLabels, patient.species)}{patient.breed ? ` · ${patient.breed}` : ""} · {ageLabel(patient.birth_date, patient.birth_date_estimated)}</small></span>
                <b>{label(patientStatusLabels, patient.status)}</b>
              </Link>
            ))}
            {!patients?.length && <p className="empty-note">Bu kişiye kayıtlı hasta yok.</p>}
          </div>
        </article>
        <article className="panel-card">
          <div className="panel-heading"><div><p className="saas-kicker">Bilgiler</p><h2>Düzenle</h2></div></div>
          <form action={updateOwnerAction.bind(null, businessSlug, owner.id)} className="record-form embedded-form">
            <OwnerFields owner={owner} />
            <button className="secondary-button">Değişiklikleri kaydet</button>
          </form>
        </article>
      </section>
      {entitlement?.owner_portal_enabled && (
        <section className="panel-card top-gap">
          <div className="panel-heading">
            <div><p className="saas-kicker">Hayvan sahibi portalı</p><h2>{portalAccount ? "Portal hesabı bağlı" : "Portal hesabı yok"}</h2></div>
            {portalAccount && (
              <form action={revokeOwnerPortalAction.bind(null, businessSlug, owner.id)}>
                <button className="secondary-button">Portal erişimini kaldır</button>
              </form>
            )}
          </div>
          <p className="form-hint">
            {portalAccount
              ? `Hesap ${formatDate(portalAccount.created_at, business.timezone)} tarihinde bağlandı. Sahip; hayvanlarının aşı ve randevu bilgilerini görür, MK Pati AI ile yazarak veya sesli konuşur ve randevu/ilaç talebi gönderir. Muayene ve tedavi notlarını göremez.`
              : "Davet bağlantısıyla hayvan sahibi kendi hesabını oluşturur ve bu kayda bağlanır."}
          </p>
          {!portalAccount && <div className="top-gap"><OwnerInvitation businessSlug={businessSlug} ownerId={owner.id} /></div>}
        </section>
      )}
    </div>
  );
}

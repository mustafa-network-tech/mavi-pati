import { notFound } from "next/navigation";
import { ClinicAdvisor } from "@/components/ai/ClinicAdvisor";
import { getEntitlements, requireBusinessAccess } from "@/lib/auth/dal";
import { CLINIC_ADVISOR_POLICY } from "@/lib/ai/policy";
import { advisorIntents, allowedIntents } from "@/lib/clinic-ai/intents";

export const dynamic = "force-dynamic";

const clinicIntents = ["TODAY_APPOINTMENTS", "UPCOMING_VACCINATIONS", "UPCOMING_FOLLOW_UPS", "OPERATIONS_SUMMARY", "NOTE_CLEANUP"];

export default async function AssistantPage({ params }: { params: Promise<{ businessSlug: string }> }) {
  const { businessSlug } = await params;
  const { business, membership, supabase } = await requireBusinessAccess(businessSlug);
  const entitlement = await getEntitlements(supabase, business.id);
  if (!entitlement?.ai_assistant_enabled) notFound();
  const actions = allowedIntents(membership.role)
    .filter((intent) => clinicIntents.includes(intent))
    .map((intent) => ({ intent, label: advisorIntents[intent].label }));

  return (
    <div className="workspace-page">
      <header className="workspace-header">
        <div>
          <p className="saas-kicker">Yazılı ve sesli</p>
          <h1>MK Pati AI · Klinik Danışmanı</h1>
          <p className="page-subtitle">
            Kliniğinizin kayıtlarını bulur, özetler ve açıklar. Örn. “Boncuk’un geçmişini özetle”, “Bugün hangi hastaların randevusu var?”, “Yaklaşan aşıları göster”.
          </p>
        </div>
      </header>
      <ClinicAdvisor
        businessSlug={businessSlug}
        actions={actions}
        voiceEnabled={entitlement.ai_voice_enabled}
        placeholder="Kontrollü işlemlerden birini seçin, yazın veya mikrofonla sorun. Belirli bir hasta için adını söyleyin ya da hasta sayfasındaki MK Pati AI alanını kullanın."
      />
      <section className="panel-card top-gap">
        <div className="panel-heading"><div><p className="saas-kicker">Sınırlar</p><h2>MK Pati AI ne yapmaz?</h2></div></div>
        <ul className="plain-list">
          {CLINIC_ADVISOR_POLICY.forbidden.map((rule) => <li key={rule}>{rule}</li>)}
          <li>Yalnızca bu kliniğin, rolünüzün erişebildiği kayıtlarını kullanır; başka kliniklerin verisine erişemez.</li>
          <li>Sesli konuşma yalnızca uygulama içindedir; telefon araması yapmaz veya cevaplamaz.</li>
        </ul>
      </section>
    </div>
  );
}

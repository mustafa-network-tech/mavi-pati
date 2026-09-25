"use client";

import { useActionState } from "react";
import { configureBusinessAction, type PlatformActionState } from "@/app/(workspace)/platform/actions";

export type PlatformEntitlement = {
  max_veterinarians: number;
  max_staff: number;
  clinic_enabled: boolean;
  appointments_enabled: boolean;
  ai_assistant_enabled: boolean;
  ai_voice_enabled: boolean;
  reports_enabled: boolean;
  owner_portal_enabled: boolean;
  monthly_ai_request_limit: number;
};

export function BusinessSettingsForm({
  businessId,
  status,
  expiresAt,
  entitlement,
}: {
  businessId: string;
  status: string;
  expiresAt: string | null;
  entitlement?: PlatformEntitlement;
}) {
  const [state, action, pending] = useActionState<PlatformActionState, FormData>(configureBusinessAction, {});
  const date = expiresAt ? new Date(expiresAt).toISOString().slice(0, 10) : "";
  const features: Array<[keyof PlatformEntitlement, string, string]> = [
    ["clinic_enabled", "Klinik modülleri", "clinicEnabled"],
    ["appointments_enabled", "Randevular", "appointmentsEnabled"],
    ["ai_assistant_enabled", "MK Pati AI", "aiAssistantEnabled"],
    ["ai_voice_enabled", "AI sesli konuşma", "aiVoiceEnabled"],
    ["owner_portal_enabled", "Hayvan sahibi portalı", "ownerPortalEnabled"],
    ["reports_enabled", "Raporlar", "reportsEnabled"],
  ];
  return (
    <form action={action} className="platform-settings-form">
      <input type="hidden" name="businessId" value={businessId} />
      <div className="form-grid two-columns">
        <label>Durum<select name="status" defaultValue={status === "PENDING" ? "TRIAL" : status}><option value="TRIAL">Trial</option><option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option><option value="EXPIRED">Expired</option><option value="REJECTED">Rejected</option></select></label>
        <label>Bitiş tarihi<input type="date" name="expiresAt" defaultValue={date} required /></label>
        <label>Veteriner hekim limiti<input type="number" name="maxVeterinarians" min="0" defaultValue={entitlement?.max_veterinarians ?? 0} required /></label>
        <label>Personel limiti<input type="number" name="maxStaff" min="0" defaultValue={entitlement?.max_staff ?? 0} required /></label>
        <label>Aylık AI istek kotası<input type="number" name="monthlyAiRequestLimit" min="0" defaultValue={entitlement?.monthly_ai_request_limit ?? 0} required /></label>
        <label>Durum nedeni<input name="reason" maxLength={1000} /></label>
      </div>
      <fieldset className="feature-checks"><legend>Modüller</legend>{features.map(([key, label, name]) => <label key={key}><input type="checkbox" name={name} defaultChecked={Boolean(entitlement?.[key])} /> {label}</label>)}</fieldset>
      <p className="form-hint">Sesli konuşma yalnızca MK Pati AI açıkken çalışır. Klinik ekibi ve hayvan sahiplerinin yazılı/sesli istekleri aynı aylık kotayı kullanır; her sahip için ayrıca günlük 40 istek sınırı vardır.</p>
      {state.error && <p className="form-message error">{state.error}</p>}{state.success && <p className="form-message success">{state.success}</p>}
      <button className="saas-primary" disabled={pending}>{pending ? "Kaydediliyor…" : "Ayarları kaydet"}</button>
    </form>
  );
}

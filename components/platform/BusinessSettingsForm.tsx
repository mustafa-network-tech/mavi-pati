"use client";

import { useActionState } from "react";
import { configureBusinessAction, type PlatformActionState } from "@/app/(workspace)/platform/actions";

type Entitlement = {
  max_advisors: number;
  crm_enabled: boolean;
  appointments_enabled: boolean;
  whatsapp_enabled: boolean;
  ai_analysis_enabled: boolean;
  ai_voice_enabled: boolean;
  imports_enabled: boolean;
  reports_enabled: boolean;
  monthly_ai_call_minutes: number;
  monthly_ai_analysis_limit: number;
  monthly_lead_limit: number;
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
  entitlement?: Entitlement;
}) {
  const [state, action, pending] = useActionState<PlatformActionState, FormData>(configureBusinessAction, {});
  const date = expiresAt ? new Date(expiresAt).toISOString().slice(0, 10) : "";
  const features: Array<[keyof Entitlement, string, string]> = [
    ["crm_enabled", "CRM", "crmEnabled"],
    ["appointments_enabled", "Randevu", "appointmentsEnabled"],
    ["whatsapp_enabled", "WhatsApp", "whatsappEnabled"],
    ["ai_analysis_enabled", "AI analiz", "aiAnalysisEnabled"],
    ["ai_voice_enabled", "AI Voice", "aiVoiceEnabled"],
    ["imports_enabled", "Import", "importsEnabled"],
    ["reports_enabled", "Rapor", "reportsEnabled"],
  ];
  return (
    <form action={action} className="platform-settings-form">
      <input type="hidden" name="businessId" value={businessId} />
      <div className="form-grid two-columns">
        <label>Durum<select name="status" defaultValue={status === "PENDING" ? "TRIAL" : status}><option value="TRIAL">Trial</option><option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option><option value="EXPIRED">Expired</option><option value="REJECTED">Rejected</option></select></label>
        <label>Bitiş tarihi<input type="date" name="expiresAt" defaultValue={date} required /></label>
        <label>Danışman limiti<input type="number" name="maxAdvisors" min="0" defaultValue={entitlement?.max_advisors ?? 0} required /></label>
        <label>Aylık AI dakika<input type="number" name="monthlyAiCallMinutes" min="0" defaultValue={entitlement?.monthly_ai_call_minutes ?? 0} required /></label>
        <label>AI analiz limiti<input type="number" name="monthlyAiAnalysisLimit" min="0" defaultValue={entitlement?.monthly_ai_analysis_limit ?? 0} required /></label>
        <label>Aylık lead limiti<input type="number" name="monthlyLeadLimit" min="0" defaultValue={entitlement?.monthly_lead_limit ?? 0} required /></label>
        <label className="full-field">Durum nedeni<input name="reason" maxLength={1000} /></label>
      </div>
      <fieldset className="feature-checks"><legend>Özellikler</legend>{features.map(([key, label, name]) => <label key={key}><input type="checkbox" name={name} defaultChecked={Boolean(entitlement?.[key])} /> {label}</label>)}</fieldset>
      {state.error && <p className="form-message error">{state.error}</p>}{state.success && <p className="form-message success">{state.success}</p>}
      <button className="saas-primary" disabled={pending}>{pending ? "Kaydediliyor…" : "Ayarları kaydet"}</button>
    </form>
  );
}

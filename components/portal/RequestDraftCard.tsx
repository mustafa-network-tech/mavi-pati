"use client";

import { useActionState } from "react";
import { submitOwnerRequestAction, type OwnerActionState } from "@/app/portal/actions";

export type RequestDraft = {
  type: "APPOINTMENT" | "MEDICATION";
  patientId: string;
  petName: string;
  preferredDate: string | null;
  preferredTime: string | null;
  medicationName: string | null;
  details: string;
  channel: "AI_TEXT" | "AI_VOICE";
};

// The assistant only prepares this; nothing reaches the clinic until the owner confirms.
export function RequestDraftCard({ draft, onDone }: { draft: RequestDraft; onDone: () => void }) {
  const [state, action, pending] = useActionState<OwnerActionState, FormData>(submitOwnerRequestAction, {});
  if (state.success)
    return (
      <div className="draft-card sent" role="status">
        <strong>Talep gönderildi</strong>
        <p>{state.success}</p>
      </div>
    );
  return (
    <form action={action} className="draft-card">
      <strong>{draft.type === "APPOINTMENT" ? "Randevu talebi" : "İlaç talebi"} · {draft.petName}</strong>
      <dl>
        {draft.type === "MEDICATION" && <div><dt>İlaç / ürün</dt><dd>{draft.medicationName}</dd></div>}
        {draft.preferredDate && <div><dt>Tercih edilen gün</dt><dd>{new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${draft.preferredDate}T12:00:00Z`))}</dd></div>}
        {draft.preferredTime && <div><dt>Tercih edilen saat</dt><dd>{draft.preferredTime}</dd></div>}
        <div><dt>Açıklamanız</dt><dd>{draft.details}</dd></div>
      </dl>
      <input type="hidden" name="patientId" value={draft.patientId} />
      <input type="hidden" name="requestType" value={draft.type} />
      <input type="hidden" name="details" value={draft.details} />
      <input type="hidden" name="preferredDate" value={draft.preferredDate ?? ""} />
      <input type="hidden" name="preferredTime" value={draft.preferredTime ?? ""} />
      <input type="hidden" name="medicationName" value={draft.medicationName ?? ""} />
      <input type="hidden" name="channel" value={draft.channel} />
      {state.error && <p className="form-message error-message">{state.error}</p>}
      <div className="inline-actions">
        <button className="saas-primary" disabled={pending}>{pending ? "Gönderiliyor…" : "Talebi gönder"}</button>
        <button type="button" className="secondary-button" onClick={onDone} disabled={pending}>Vazgeç</button>
      </div>
    </form>
  );
}

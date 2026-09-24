"use client";

import { useActionState } from "react";
import {
  analyzeListingAction,
  draftInitialMessageAction,
  sendInitialMessageAction,
  type OutreachActionState,
} from "@/app/(workspace)/app/[businessSlug]/outreach-actions";

const initialState: OutreachActionState = {};

function Feedback({ state }: { state: OutreachActionState }) {
  return (
    <>
      {state.error && <p className="form-message error-message">{state.error}</p>}
      {state.success && <p className="form-message success-message">{state.success}</p>}
      {state.launchUrl && (
        <a className="saas-primary whatsapp-button" href={state.launchUrl} target="_blank" rel="noreferrer">
          WhatsApp’ta aç
        </a>
      )}
    </>
  );
}

export function AnalyzeListingButton({
  businessSlug,
  listingId,
  label,
}: {
  businessSlug: string;
  listingId: string;
  label: string;
}) {
  const [state, action, pending] = useActionState(
    analyzeListingAction.bind(null, businessSlug, listingId),
    initialState,
  );
  return (
    <form action={action} className="outreach-action">
      <button className="secondary-button" disabled={pending}>
        {pending ? "Analiz ediliyor..." : label}
      </button>
      <Feedback state={state} />
    </form>
  );
}

export function DraftMessageButton({
  businessSlug,
  listingId,
  label,
}: {
  businessSlug: string;
  listingId: string;
  label: string;
}) {
  const [state, action, pending] = useActionState(
    draftInitialMessageAction.bind(null, businessSlug, listingId),
    initialState,
  );
  return (
    <form action={action} className="outreach-action">
      <button className="secondary-button" disabled={pending}>
        {pending ? "Mesaj yazılıyor..." : label}
      </button>
      <Feedback state={state} />
    </form>
  );
}

export function SendMessageForm({
  businessSlug,
  listingId,
  draft,
  apiAvailable,
}: {
  businessSlug: string;
  listingId: string;
  draft: string;
  apiAvailable: boolean;
}) {
  const [state, action, pending] = useActionState(
    sendInitialMessageAction.bind(null, businessSlug, listingId),
    initialState,
  );
  return (
    <form action={action} className="outreach-send">
      <label>
        İlk mesaj taslağı
        <textarea name="message" defaultValue={draft} rows={5} maxLength={1000} required />
      </label>
      <div className="action-row">
        <button className="saas-primary" name="mode" value="API" disabled={pending || !apiAvailable}>
          {pending ? "Gönderiliyor..." : "WhatsApp API ile gönder"}
        </button>
        <button className="secondary-button" name="mode" value="MANUAL" disabled={pending}>
          Manuel (wa.me) bağlantı
        </button>
      </div>
      {!apiAvailable && (
        <p className="form-hint">WhatsApp Business API yapılandırılmadığı için yalnızca manuel bağlantı kullanılabilir.</p>
      )}
      <Feedback state={state} />
    </form>
  );
}

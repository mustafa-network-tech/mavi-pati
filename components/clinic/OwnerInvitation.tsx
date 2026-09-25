"use client";

import { useActionState, useState } from "react";
import {
  createOwnerInvitationAction,
  type InvitationState,
} from "@/app/(workspace)/app/[businessSlug]/owner-request-actions";

export function OwnerInvitation({ businessSlug, ownerId }: { businessSlug: string; ownerId: string }) {
  const [state, action, pending] = useActionState<InvitationState>(
    createOwnerInvitationAction.bind(null, businessSlug, ownerId),
    {},
  );
  const [copied, setCopied] = useState(false);
  return (
    <div className="stack-list">
      <form action={action}>
        <button className="secondary-button" disabled={pending}>
          {pending ? "Oluşturuluyor…" : "Portal daveti oluştur"}
        </button>
      </form>
      {state.error && <p className="form-message error-message">{state.error}</p>}
      {state.link && (
        <div className="invite-link">
          <input readOnly value={state.link} aria-label="Davet bağlantısı" onFocus={(event) => event.currentTarget.select()} />
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              void navigator.clipboard?.writeText(state.link!).then(() => setCopied(true));
            }}
          >
            {copied ? "Kopyalandı" : "Kopyala"}
          </button>
          <p className="form-hint">Bağlantı 7 gün geçerlidir ve tek kullanımlıktır. Yalnızca bu hayvan sahibiyle paylaşın; bu ekrandan ayrıldıktan sonra tekrar gösterilmez.</p>
        </div>
      )}
    </div>
  );
}

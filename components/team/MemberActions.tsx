"use client";

import { useActionState } from "react";
import {
  reviewMemberAction,
  type TeamActionState,
} from "@/app/(workspace)/app/[businessSlug]/team-actions";

const initialState: TeamActionState = {};

const buttons = {
  PENDING: [
    ["approve", "Onayla", "saas-primary"],
    ["reject", "Reddet", "saas-secondary"],
  ],
  ACTIVE: [["suspend", "Pasife al", "saas-secondary"]],
  SUSPENDED: [
    ["activate", "Aktif et", "saas-primary"],
    ["remove", "Klinikten çıkar", "saas-secondary"],
  ],
} as const;

export function MemberActions({
  businessSlug,
  memberId,
  status,
}: {
  businessSlug: string;
  memberId: string;
  status: keyof typeof buttons;
}) {
  const [state, action, pending] = useActionState(
    reviewMemberAction.bind(null, businessSlug),
    initialState,
  );
  return (
    <form action={action} className="request-actions">
      <input type="hidden" name="memberId" value={memberId} />
      {buttons[status].map(([decision, text, className]) => (
        <button key={decision} className={className} name="decision" value={decision} disabled={pending}>
          {text}
        </button>
      ))}
      {state.error && <p className="form-message error-message">{state.error}</p>}
    </form>
  );
}

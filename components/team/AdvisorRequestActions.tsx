"use client";

import { useActionState } from "react";
import {
  reviewAdvisorRequestAction,
  type TeamActionState,
} from "@/app/(workspace)/app/[businessSlug]/team-actions";

const initialState: TeamActionState = {};

export function AdvisorRequestActions({
  businessSlug,
  memberId,
}: {
  businessSlug: string;
  memberId: string;
}) {
  const [state, action, pending] = useActionState(
    reviewAdvisorRequestAction.bind(null, businessSlug),
    initialState,
  );
  return (
    <form action={action} className="request-actions">
      <input type="hidden" name="memberId" value={memberId} />
      <button className="saas-primary" name="decision" value="approve" disabled={pending}>
        Onayla
      </button>
      <button className="saas-secondary" name="decision" value="reject" disabled={pending}>
        Reddet
      </button>
      {state.error && <p className="form-message error-message">{state.error}</p>}
    </form>
  );
}

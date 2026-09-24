"use client";

import { useActionState } from "react";
import {
  approveBusinessAction,
  type PlatformActionState,
} from "@/app/(workspace)/platform/actions";

const initialState: PlatformActionState = {};

function defaultExpiration() {
  const value = new Date();
  value.setDate(value.getDate() + 30);
  return value.toISOString().slice(0, 10);
}

export function BusinessApprovalForm({ businessId }: { businessId: string }) {
  const [state, action, pending] = useActionState(
    approveBusinessAction,
    initialState,
  );
  return (
    <form action={action} className="approval-form">
      <input type="hidden" name="businessId" value={businessId} />
      <label>
        Başlangıç durumu
        <select name="status" defaultValue="TRIAL">
          <option value="TRIAL">TRIAL</option>
          <option value="ACTIVE">ACTIVE</option>
        </select>
      </label>
      <label>
        Erişim bitişi
        <input
          name="expiresAt"
          type="date"
          defaultValue={defaultExpiration()}
          required
        />
      </label>
      <label>
        Danışman limiti
        <input name="maxAdvisors" type="number" min={0} max={10000} defaultValue={3} required />
      </label>
      {state.error && <p className="form-message error-message">{state.error}</p>}
      {state.success && <p className="form-message success-message">{state.success}</p>}
      <button className="saas-primary" disabled={pending}>
        {pending ? "Onaylanıyor..." : "Ofisi onayla"}
      </button>
    </form>
  );
}

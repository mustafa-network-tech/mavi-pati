"use client";

import { useActionState } from "react";
import { applyAction } from "@/app/(auth)/actions";
import { RegistrationFields } from "@/components/auth/RegistrationFields";

export function BusinessApplicationForm({ error }: { error?: string }) {
  const [state, action, pending] = useActionState(applyAction, { error });
  return (
    <form action={action} className="saas-form">
      <RegistrationFields />
      {state.error && (
        <p className="form-message error-message">{state.error}</p>
      )}
      <button className="saas-primary" disabled={pending}>
        {pending ? "Başvuru kaydediliyor..." : "Başvuruyu gönder"}
      </button>
    </form>
  );
}

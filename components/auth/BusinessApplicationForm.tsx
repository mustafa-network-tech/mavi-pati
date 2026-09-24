"use client";

import { useActionState } from "react";
import { applyAction, type AuthActionState } from "@/app/(auth)/actions";

const initialState: AuthActionState = {};

export function BusinessApplicationForm() {
  const [state, action, pending] = useActionState(applyAction, initialState);
  return (
    <form action={action} className="saas-form">
      <label>
        Ofis adı
        <input name="displayName" minLength={2} maxLength={160} required />
      </label>
      <label>
        Ofis adresi
        <span className="input-prefix">
          mkemlak.app/
          <input
            name="slug"
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            minLength={3}
            maxLength={80}
            placeholder="ornek-emlak"
            required
          />
        </span>
      </label>
      <label>
        Telefon
        <input name="phone" type="tel" autoComplete="tel" maxLength={30} />
      </label>
      <label>
        Ofis e-postası
        <input name="email" type="email" autoComplete="email" />
      </label>
      {state.error && (
        <p className="form-message error-message">{state.error}</p>
      )}
      <button className="saas-primary" disabled={pending}>
        {pending ? "Başvuru kaydediliyor..." : "Başvuruyu gönder"}
      </button>
    </form>
  );
}

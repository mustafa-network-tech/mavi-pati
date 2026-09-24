"use client";

import { useActionState } from "react";
import Link from "next/link";
import {
  loginAction,
  registerAction,
  type AuthActionState,
} from "@/app/(auth)/actions";
import { RegistrationFields } from "@/components/auth/RegistrationFields";

export function AuthForm({
  mode,
  error,
}: {
  mode: "login" | "register";
  error?: string;
}) {
  const initialState: AuthActionState = { error };
  const [state, action, pending] = useActionState(
    mode === "login" ? loginAction : registerAction,
    initialState,
  );

  if (mode === "register" && state.success)
    return (
      <div className="saas-form">
        <p className="form-message success-message">{state.success}</p>
        <p className="form-switch">
          E-postanızı doğruladıktan sonra{" "}
          <Link href="/login">giriş yapın</Link>.
        </p>
      </div>
    );

  return (
    <form action={action} className="saas-form">
      {mode === "register" && <RegistrationFields />}
      {mode === "register" && (
        <label>
          Ad soyad
          <input
            name="fullName"
            autoComplete="name"
            minLength={2}
            maxLength={150}
            required
          />
        </label>
      )}
      <label>
        E-posta
        <input name="email" type="email" autoComplete="email" required />
      </label>
      <label>
        Parola
        <input
          name="password"
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          minLength={8}
          maxLength={72}
          required
        />
      </label>
      {state.error && (
        <p className="form-message error-message">{state.error}</p>
      )}
      {state.success && (
        <p className="form-message success-message">{state.success}</p>
      )}
      <button className="saas-primary" disabled={pending}>
        {pending
          ? "İşleniyor..."
          : mode === "login"
            ? "Giriş yap"
            : "Hesap oluştur"}
      </button>
      <p className="form-switch">
        {mode === "login" ? "Hesabınız yok mu?" : "Zaten hesabınız var mı?"}{" "}
        <Link href={mode === "login" ? "/register" : "/login"}>
          {mode === "login" ? "Kayıt olun" : "Giriş yapın"}
        </Link>
      </p>
    </form>
  );
}

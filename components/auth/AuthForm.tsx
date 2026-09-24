"use client";

import { useActionState } from "react";
import Link from "next/link";
import {
  loginAction,
  registerAction,
  type AuthActionState,
} from "@/app/(auth)/actions";

const initialState: AuthActionState = {};

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const [state, action, pending] = useActionState(
    mode === "login" ? loginAction : registerAction,
    initialState,
  );

  return (
    <form action={action} className="saas-form">
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

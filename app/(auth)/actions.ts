"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import {
  checkRegistrationTarget,
  finalizePendingRegistration,
  parseRegistration,
  submitRegistration,
} from "@/lib/auth/registration";
import { createAuthServerClient } from "@/lib/supabase/auth-server";

export type AuthActionState = {
  error?: string;
  success?: string;
};

const credentialsSchema = z.object({
  email: z.string().trim().email("Geçerli bir e-posta adresi girin."),
  password: z
    .string()
    .min(8, "Parola en az 8 karakter olmalıdır.")
    .max(72, "Parola en fazla 72 karakter olabilir."),
});

const registerSchema = credentialsSchema.extend({
  fullName: z.string().trim().min(2).max(150),
});

function values(formData: FormData) {
  return Object.fromEntries(formData.entries());
}

function siteUrl() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercelHost) return `https://${vercelHost}`;
  if (process.env.NODE_ENV === "development") return "http://localhost:3000";
  throw new Error("NEXT_PUBLIC_SITE_URL production ortamında zorunludur.");
}

function applyErrorPath(error: string) {
  return `/apply?error=${encodeURIComponent(error)}`;
}

export async function loginAction(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = credentialsSchema.safeParse(values(formData));
  if (!parsed.success)
    return {
      error: parsed.error.issues[0]?.message ?? "Bilgileri kontrol edin.",
    };

  const supabase = await createAuthServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: "E-posta veya parola hatalı." };
  const registrationError = await finalizePendingRegistration(supabase);
  redirect(registrationError ? applyErrorPath(registrationError) : "/app");
}

export async function registerAction(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const input = values(formData);
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success)
    return {
      error: parsed.error.issues[0]?.message ?? "Bilgileri kontrol edin.",
    };
  const { registration, error: registrationInputError } =
    parseRegistration(input);
  if (!registration) return { error: registrationInputError };
  const targetError = await checkRegistrationTarget(registration);
  if (targetError) return { error: targetError };

  const supabase = await createAuthServerClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName, registration },
      emailRedirectTo: `${siteUrl()}/auth/callback?next=/app`,
    },
  });
  if (error) return { error: "Hesap oluşturulamadı. Bilgileri kontrol edin." };
  if (data.session) {
    const submitError = await submitRegistration(supabase, registration);
    redirect(submitError ? applyErrorPath(submitError) : "/app");
  }
  return {
    success:
      registration.accountType === "OFFICE_ADMIN"
        ? "Hesap oluşturuldu. E-posta adresinizi doğrulayın; ofis başvurunuz ardından Platform Admin onayına gönderilir."
        : "Hesap oluşturuldu. E-posta adresinizi doğrulayın; katılım isteğiniz ardından ofis yöneticisinin onayına gönderilir.",
  };
}

export async function applyAction(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const { registration, error: inputError } = parseRegistration(
    values(formData),
  );
  if (!registration) return { error: inputError };

  const supabase = await createAuthServerClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) redirect("/login");

  const error = await submitRegistration(supabase, registration);
  if (error) return { error };
  redirect("/app");
}

export async function signOutAction() {
  const supabase = await createAuthServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}

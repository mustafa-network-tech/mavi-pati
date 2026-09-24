"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
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

const applicationSchema = z.object({
  displayName: z.string().trim().min(2).max(160),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(80)
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Ofis adresi yalnızca küçük harf, rakam ve tire içerebilir.",
    ),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().email().optional().or(z.literal("")),
});

function values(formData: FormData) {
  return Object.fromEntries(formData.entries());
}

function siteUrl() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  if (process.env.NODE_ENV === "development") return "http://localhost:3000";
  throw new Error("NEXT_PUBLIC_SITE_URL production ortamında zorunludur.");
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
  redirect("/app");
}

export async function registerAction(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = registerSchema.safeParse(values(formData));
  if (!parsed.success)
    return {
      error: parsed.error.issues[0]?.message ?? "Bilgileri kontrol edin.",
    };

  const supabase = await createAuthServerClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: `${siteUrl()}/auth/callback?next=/apply`,
    },
  });
  if (error) return { error: "Hesap oluşturulamadı. Bilgileri kontrol edin." };
  if (data.session) redirect("/apply");
  return {
    success:
      "Hesap oluşturuldu. Devam etmek için e-posta adresinizi doğrulayın.",
  };
}

export async function applyAction(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = applicationSchema.safeParse(values(formData));
  if (!parsed.success)
    return {
      error: parsed.error.issues[0]?.message ?? "Bilgileri kontrol edin.",
    };

  const supabase = await createAuthServerClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) redirect("/login");

  const { error } = await supabase.rpc("submit_business_application", {
    requested_display_name: parsed.data.displayName,
    requested_slug: parsed.data.slug,
    requested_phone: parsed.data.phone || null,
    requested_email: parsed.data.email || null,
  });
  if (error) {
    if (error.code === "23505")
      return {
        error: "Bu ofis adresi kullanılıyor veya mevcut bir başvurunuz var.",
      };
    return { error: "Başvuru kaydedilemedi. Lütfen tekrar deneyin." };
  }
  redirect("/app");
}

export async function signOutAction() {
  const supabase = await createAuthServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}

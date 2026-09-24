import { NextResponse } from "next/server";
import { finalizePendingRegistration } from "@/lib/auth/registration";
import { createAuthServerClient } from "@/lib/supabase/auth-server";

function safeNext(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/app";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (code) {
    const supabase = await createAuthServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const registrationError = await finalizePendingRegistration(supabase);
      if (registrationError) {
        const apply = new URL("/apply", url);
        apply.searchParams.set("error", registrationError);
        return NextResponse.redirect(apply);
      }
      return NextResponse.redirect(
        new URL(safeNext(url.searchParams.get("next")), url),
      );
    }
  }
  const login = new URL("/login", url);
  login.searchParams.set(
    "error",
    "Doğrulama bağlantısı geçersiz veya süresi dolmuş.",
  );
  return NextResponse.redirect(login);
}

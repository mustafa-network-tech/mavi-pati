import Link from "next/link";
import { acceptInvitationAction } from "@/app/portal/actions";
import { AuthForm } from "@/components/auth/AuthForm";
import { verifySession } from "@/lib/auth/dal";
import { createAuthServerClient } from "@/lib/supabase/auth-server";

export const dynamic = "force-dynamic";

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const query = await searchParams;
  const valid = /^[0-9a-f]{64}$/.test(token);
  const session = await verifySession();
  const supabase = session?.supabase ?? (await createAuthServerClient());
  const { data: clinicName } = valid
    ? await supabase.rpc("owner_invitation_clinic", { invite_token: token })
    : { data: null };

  return (
    <main className="auth-shell">
      <Link href="/" className="saas-logo"><span>MK</span> Pati</Link>
      <section className="auth-card">
        <p className="saas-kicker">Hayvan sahibi portalı</p>
        {!clinicName ? (
          <>
            <h1>Davet geçersiz</h1>
            <p>{query.error ?? "Bu davet bağlantısı kullanılmış veya süresi dolmuş. Kliniğinizden yeni bir davet isteyin."}</p>
          </>
        ) : session ? (
          <>
            <h1>{clinicName}</h1>
            <p>Bu daveti kabul ederek hesabınızı kliniğin hayvan sahibi portalına bağlayabilirsiniz.</p>
            {query.error && <p className="form-message error-message">{query.error}</p>}
            <form action={acceptInvitationAction.bind(null, token)} className="saas-form">
              <button className="saas-primary">Daveti kabul et</button>
            </form>
          </>
        ) : (
          <>
            <h1>{clinicName}</h1>
            <p>
              Hayvanlarınızın aşı ve randevu bilgilerini görmek, MK Pati AI ile yazarak veya sesli konuşmak ve randevu/ilaç
              talebi göndermek için hesabınızı oluşturun.
            </p>
            <AuthForm mode="register" hiddenFields={{ accountType: "PET_OWNER", inviteToken: token }} />
            <p className="form-switch">
              Zaten hesabınız var mı? <Link href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}>Giriş yapın</Link>, ardından daveti kabul edin.
            </p>
          </>
        )}
      </section>
    </main>
  );
}

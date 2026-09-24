import { requirePlatformAdmin } from "@/lib/auth/dal";
import { database } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function PlatformAuditPage() {
  await requirePlatformAdmin();
  const { data: logs, error } = await database(true)
    .from("platform_audit_logs")
    .select("id,action,target_type,target_id,business_id,created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (
    <div className="workspace-page">
      <header className="workspace-header"><div><p className="saas-kicker">Platform güvenliği</p><h1>Audit Log</h1></div></header>
      <div className="timeline-list">
        {(logs ?? []).map((log) => (
          <article key={log.id}><span /><div><strong>{log.action}</strong><p>{log.target_type} · {log.target_id ?? log.business_id ?? "platform"}</p><small>{new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(log.created_at))}</small></div></article>
        ))}
        {!logs?.length && <section className="notice-card"><strong>Henüz platform audit kaydı yok.</strong></section>}
      </div>
    </div>
  );
}

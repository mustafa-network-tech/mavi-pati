import "server-only";

// Absolute origin for links sent outside the app (auth e-mails, owner invitations).
export function siteUrl() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercelHost) return `https://${vercelHost}`;
  if (process.env.NODE_ENV === "development") return "http://localhost:3000";
  throw new Error("NEXT_PUBLIC_SITE_URL production ortamında zorunludur.");
}

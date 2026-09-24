import { after } from "next/server";
import { processWhatsAppWebhook } from "@/lib/outreach/pipeline";
import { getWhatsAppBusinessProvider } from "@/lib/providers/whatsapp-cloud";

export const maxDuration = 60;

// Meta webhook verification handshake.
export async function GET(request: Request) {
  const provider = getWhatsAppBusinessProvider();
  if (!provider) return new Response("WhatsApp is not configured", { status: 503 });
  const challenge = provider.verifyWebhook(new URL(request.url).searchParams);
  return challenge
    ? new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } })
    : new Response("Forbidden", { status: 403 });
}

export async function POST(request: Request) {
  const provider = getWhatsAppBusinessProvider();
  if (!provider) return new Response("WhatsApp is not configured", { status: 503 });

  const rawBody = await request.text();
  if (rawBody.length > 1_000_000) return new Response("Payload too large", { status: 413 });
  if (!provider.verifySignature(rawBody, request.headers.get("x-hub-signature-256")))
    return new Response("Invalid signature", { status: 401 });

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // Acknowledge immediately; Meta retries slow responses. Processing is idempotent.
  after(() => processWhatsAppWebhook(provider, payload));
  return new Response("OK", { status: 200 });
}

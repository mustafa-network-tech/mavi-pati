import "server-only";

import {
  isRecipientAllowed,
  parseWebhookPayload,
  verifyWebhookChallenge,
  verifyWebhookSignature,
} from "@/lib/providers/whatsapp-webhook";

/**
 * Official WhatsApp Business Platform (Meta Cloud API) provider.
 * No unofficial automation (WhatsApp Web, QR bots, browser scripting) is used anywhere.
 */

const REQUIRED_ENV = [
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_VERIFY_TOKEN",
  "WHATSAPP_APP_SECRET",
] as const;

export type WhatsAppCloudConfig = {
  accessToken: string;
  phoneNumberId: string;
  businessAccountId: string | null;
  verifyToken: string;
  appSecret: string;
  apiVersion: string;
  testMode: boolean;
  testRecipient: string | null;
  outreachTemplate: { name: string; language: string } | null;
};

const env = (name: string) => process.env[name]?.trim() || null;

export function getWhatsAppConfigStatus() {
  const missing = REQUIRED_ENV.filter((name) => !env(name));
  const testMode = env("WHATSAPP_TEST_MODE") !== "false";
  return {
    configured: missing.length === 0,
    missing,
    testMode,
    testRecipientSet: !!env("WHATSAPP_TEST_RECIPIENT"),
    templateConfigured: !!env("WHATSAPP_OUTREACH_TEMPLATE_NAME"),
  };
}

export function getWhatsAppCloudConfig(): WhatsAppCloudConfig | null {
  if (!getWhatsAppConfigStatus().configured) return null;
  const templateName = env("WHATSAPP_OUTREACH_TEMPLATE_NAME");
  return {
    accessToken: env("WHATSAPP_ACCESS_TOKEN")!,
    phoneNumberId: env("WHATSAPP_PHONE_NUMBER_ID")!,
    businessAccountId: env("WHATSAPP_BUSINESS_ACCOUNT_ID"),
    verifyToken: env("WHATSAPP_VERIFY_TOKEN")!,
    appSecret: env("WHATSAPP_APP_SECRET")!,
    apiVersion: env("WHATSAPP_GRAPH_API_VERSION") ?? "v23.0",
    testMode: env("WHATSAPP_TEST_MODE") !== "false",
    testRecipient: env("WHATSAPP_TEST_RECIPIENT"),
    outreachTemplate: templateName
      ? { name: templateName, language: env("WHATSAPP_OUTREACH_TEMPLATE_LANGUAGE") ?? "tr" }
      : null,
  };
}

export class WhatsAppSendError extends Error {
  constructor(readonly code: string) {
    super(`WhatsApp send failed: ${code}`);
  }
}

// Meta error 131047: more than 24 hours since the customer's last message.
export const OUTSIDE_SERVICE_WINDOW = "131047";

export interface WhatsAppBusinessProvider {
  readonly key: string;
  sendMessage(to: string, text: string): Promise<{ providerMessageId: string }>;
  sendTemplate(to: string, name: string, language: string): Promise<{ providerMessageId: string }>;
  verifyWebhook(params: URLSearchParams): string | null;
  verifySignature(rawBody: string, signature: string | null): boolean;
  parseWebhook(payload: unknown): ReturnType<typeof parseWebhookPayload>;
  markRead(providerMessageId: string): Promise<void>;
  checkConnection(): Promise<"CONNECTED" | "ERROR">;
}

export class MetaCloudWhatsAppProvider implements WhatsAppBusinessProvider {
  readonly key = "META_CLOUD";

  constructor(readonly config: WhatsAppCloudConfig) {}

  private get messagesUrl() {
    return `https://graph.facebook.com/${this.config.apiVersion}/${this.config.phoneNumberId}/messages`;
  }

  private async post(body: Record<string, unknown>) {
    let response: Response;
    try {
      response = await fetch(this.messagesUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
      });
    } catch {
      throw new WhatsAppSendError("NETWORK");
    }
    const json = (await response.json().catch(() => null)) as {
      messages?: { id: string }[];
      error?: { code?: number };
    } | null;
    if (!response.ok) throw new WhatsAppSendError(String(json?.error?.code ?? `HTTP_${response.status}`));
    return json;
  }

  private assertRecipient(to: string) {
    if (!isRecipientAllowed(to, this.config)) throw new WhatsAppSendError("TEST_MODE_RECIPIENT_BLOCKED");
  }

  async sendMessage(to: string, text: string) {
    this.assertRecipient(to);
    const json = await this.post({ to, type: "text", text: { body: text, preview_url: false } });
    const providerMessageId = json?.messages?.[0]?.id;
    if (!providerMessageId) throw new WhatsAppSendError("NO_MESSAGE_ID");
    return { providerMessageId };
  }

  async sendTemplate(to: string, name: string, language: string) {
    this.assertRecipient(to);
    const json = await this.post({ to, type: "template", template: { name, language: { code: language } } });
    const providerMessageId = json?.messages?.[0]?.id;
    if (!providerMessageId) throw new WhatsAppSendError("NO_MESSAGE_ID");
    return { providerMessageId };
  }

  verifyWebhook(params: URLSearchParams) {
    return verifyWebhookChallenge(params, this.config.verifyToken);
  }

  verifySignature(rawBody: string, signature: string | null) {
    return verifyWebhookSignature(rawBody, signature, this.config.appSecret);
  }

  parseWebhook(payload: unknown) {
    return parseWebhookPayload(payload, this.config.phoneNumberId);
  }

  async markRead(providerMessageId: string) {
    await this.post({ status: "read", message_id: providerMessageId }).catch(() => undefined);
  }

  async checkConnection() {
    try {
      const response = await fetch(
        `https://graph.facebook.com/${this.config.apiVersion}/${this.config.phoneNumberId}?fields=id`,
        {
          headers: { Authorization: `Bearer ${this.config.accessToken}` },
          signal: AbortSignal.timeout(5000),
          cache: "no-store",
        },
      );
      return response.ok ? ("CONNECTED" as const) : ("ERROR" as const);
    } catch {
      return "ERROR" as const;
    }
  }
}

export function getWhatsAppBusinessProvider(): MetaCloudWhatsAppProvider | null {
  const config = getWhatsAppCloudConfig();
  return config ? new MetaCloudWhatsAppProvider(config) : null;
}

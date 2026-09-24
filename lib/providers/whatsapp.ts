export type WhatsAppDraft = {
  recipient: string;
  content: string;
};

export type WhatsAppSendResult = {
  provider: string;
  status: "DRAFT" | "QUEUED" | "SENT";
  externalId?: string;
  launchUrl?: string;
};

export interface WhatsAppProvider {
  readonly key: string;
  readonly mode: "MANUAL" | "API";
  prepareOrSend(draft: WhatsAppDraft): Promise<WhatsAppSendResult>;
}

export class ManualWhatsAppProvider implements WhatsAppProvider {
  readonly key = "MANUAL_DEEP_LINK";
  readonly mode = "MANUAL" as const;

  async prepareOrSend(draft: WhatsAppDraft): Promise<WhatsAppSendResult> {
    const number = draft.recipient.replace(/[^0-9]/g, "");
    if (!/^[1-9]\d{7,14}$/.test(number))
      throw new Error("Geçerli bir uluslararası telefon numarası gerekli.");
    const content = draft.content.trim();
    if (!content) throw new Error("Mesaj boş olamaz.");
    return {
      provider: this.key,
      status: "DRAFT",
      launchUrl: `https://wa.me/${number}?text=${encodeURIComponent(content)}`,
    };
  }
}

export function getWhatsAppProvider(): WhatsAppProvider {
  // Official Business API implementations will be selected here by configuration.
  return new ManualWhatsAppProvider();
}

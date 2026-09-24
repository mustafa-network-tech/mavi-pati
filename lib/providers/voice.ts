export type OutboundCallRequest = {
  callId: string;
  recipient: string;
  locale: "tr-TR" | "ru-RU";
  webhookUrl: string;
};

export type OutboundCallResult = {
  provider: string;
  providerCallId: string;
  status: "QUEUED" | "RINGING";
};

export interface VoiceProvider {
  readonly key: string;
  readonly configured: boolean;
  startOutboundCall(request: OutboundCallRequest): Promise<OutboundCallResult>;
}

class UnconfiguredVoiceProvider implements VoiceProvider {
  readonly key = "UNCONFIGURED";
  readonly configured = false;

  async startOutboundCall(_request: OutboundCallRequest): Promise<OutboundCallResult> {
    throw new Error("Gerçek telefon sağlayıcısı henüz yapılandırılmadı.");
  }
}

export function getVoiceProvider(): VoiceProvider {
  // Twilio, Telnyx or a SIP adapter can be selected here without changing CRM code.
  return new UnconfiguredVoiceProvider();
}

import "server-only";

import type { AdvisorChannel } from "@/lib/ai/policy";
import type {
  AdvisorAnswer,
  AdvisorClassification,
  AdvisorIntent,
  OwnerClassification,
} from "@/lib/ai/schemas";

export type AiCompletion<T> = { data: T; totalTokens: number };

export type AdvisorClassificationInput = {
  text: string;
  allowedIntents: { key: AdvisorIntent; description: string }[];
  currentPatientName: string | null;
};

export type OwnerClassificationInput = {
  text: string;
  petNames: string[];
  today: string;
  appointmentsEnabled: boolean;
};

export type AdvisorAnswerInput = {
  // CLINIC: staff advisor policy; OWNER: pet-owner assistant policy.
  audience?: "CLINIC" | "OWNER";
  channel: AdvisorChannel;
  task: string;
  request: string;
  context: unknown;
  now: string;
  clinicName: string;
};

export type AiProviderStatus = "CONNECTED" | "NOT_CONFIGURED" | "ERROR";

export interface AiProvider {
  readonly key: string;
  readonly model: string | null;
  readonly configured: boolean;
  checkConnection(): Promise<AiProviderStatus>;
  classifyAdvisorRequest(input: AdvisorClassificationInput): Promise<AiCompletion<AdvisorClassification>>;
  classifyOwnerRequest(input: OwnerClassificationInput): Promise<AiCompletion<OwnerClassification>>;
  answerAdvisor(input: AdvisorAnswerInput): Promise<AiCompletion<AdvisorAnswer>>;
  transcribe(audio: Blob, fileName: string): Promise<string>;
}

export class AiNotConfiguredError extends Error {
  constructor() {
    super("AI sağlayıcısı yapılandırılmadı.");
  }
}

class NotConfiguredAiProvider implements AiProvider {
  readonly key = "NOT_CONFIGURED";
  readonly model = null;
  readonly configured = false;
  async checkConnection(): Promise<AiProviderStatus> {
    return "NOT_CONFIGURED";
  }
  async classifyAdvisorRequest(): Promise<AiCompletion<AdvisorClassification>> {
    throw new AiNotConfiguredError();
  }
  async classifyOwnerRequest(): Promise<AiCompletion<OwnerClassification>> {
    throw new AiNotConfiguredError();
  }
  async answerAdvisor(): Promise<AiCompletion<AdvisorAnswer>> {
    throw new AiNotConfiguredError();
  }
  async transcribe(): Promise<string> {
    throw new AiNotConfiguredError();
  }
}

export async function getAiProvider(): Promise<AiProvider> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_MODEL?.trim();
  if (!apiKey || !model) return new NotConfiguredAiProvider();
  const { OpenAiProvider } = await import("@/lib/ai/openai");
  return new OpenAiProvider(
    apiKey,
    model,
    process.env.OPENAI_TRANSCRIPTION_MODEL?.trim() || "gpt-4o-mini-transcribe",
  );
}

import "server-only";

import type { ConversationReply, ListingAnalysis } from "@/lib/ai/schemas";

export type ListingAnalysisInput = {
  title: string;
  description: string | null;
  propertyType: string;
  transactionType: "SALE" | "RENT";
  price: number | null;
  currency: string;
  city: string | null;
  district: string | null;
  neighborhood: string | null;
  roomCount: string | null;
  grossArea: number | null;
  netArea: number | null;
};

export type InitialMessageInput = {
  officeName: string;
  ownerName: string | null;
  analysis: ListingAnalysis;
};

export type ConversationTurn = { role: "LEAD" | "OFFICE"; content: string };

export type AppointmentSlotOption = { id: string; label: string };

export type ConversationReplyInput = {
  officeName: string;
  ownerName: string | null;
  analysis: ListingAnalysis | null;
  listingTitle: string;
  history: ConversationTurn[];
  slots: AppointmentSlotOption[];
  now: string;
};

export type AiProviderStatus = "CONNECTED" | "NOT_CONFIGURED" | "ERROR";

export interface AiProvider {
  readonly key: string;
  readonly model: string | null;
  readonly configured: boolean;
  checkConnection(): Promise<AiProviderStatus>;
  analyzeListing(input: ListingAnalysisInput): Promise<ListingAnalysis>;
  generateInitialMessage(input: InitialMessageInput): Promise<string>;
  generateConversationReply(input: ConversationReplyInput): Promise<ConversationReply>;
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
  async analyzeListing(): Promise<ListingAnalysis> {
    throw new AiNotConfiguredError();
  }
  async generateInitialMessage(): Promise<string> {
    throw new AiNotConfiguredError();
  }
  async generateConversationReply(): Promise<ConversationReply> {
    throw new AiNotConfiguredError();
  }
}

export async function getAiProvider(): Promise<AiProvider> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_MODEL?.trim();
  if (!apiKey || !model) return new NotConfiguredAiProvider();
  const { OpenAiProvider } = await import("@/lib/ai/openai");
  return new OpenAiProvider(apiKey, model);
}

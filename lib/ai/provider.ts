import "server-only";

import type { AiTools } from "@/lib/ai/tools";

export type AiAgentContext = {
  locale: "tr-TR" | "ru-RU";
  systemPrompt: string;
  tools: AiTools;
};

export interface AiAgentProvider {
  readonly key: string;
  readonly model: string;
  readonly configured: boolean;
  run(context: AiAgentContext, input: string): Promise<{ text: string }>;
}

class UnconfiguredAiAgentProvider implements AiAgentProvider {
  readonly key = process.env.AI_PROVIDER ?? "UNCONFIGURED";
  readonly model = process.env.AI_MODEL ?? "UNCONFIGURED";
  readonly configured = false;

  async run(_context: AiAgentContext, _input: string): Promise<{ text: string }> {
    throw new Error("AI sağlayıcısı henüz yapılandırılmadı.");
  }
}

export function getAiAgentProvider(): AiAgentProvider {
  // Concrete model adapters are selected here after credentials are supplied.
  return new UnconfiguredAiAgentProvider();
}

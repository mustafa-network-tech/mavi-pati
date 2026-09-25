import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdvisorChannel } from "@/lib/ai/policy";
import { AiNotConfiguredError } from "@/lib/ai/provider";

// Shared by the clinic advisor and the owner assistant: one quota, one audit trail,
// one error mapping. Both run with the signed-in user's RLS-bound client.
export class AdvisorError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function consumeAiQuota(supabase: SupabaseClient, businessId: string, voice: boolean) {
  const { data, error } = await supabase.rpc("consume_ai_quota", {
    target_business_id: businessId,
    is_voice: voice,
  });
  if (!error) return Number(data);
  if (error.message?.includes("Owner daily AI limit reached"))
    throw new AdvisorError(429, "Bugünkü MK Pati AI kullanım sınırınıza ulaştınız. Yarın tekrar deneyebilir veya kliniği arayabilirsiniz.");
  if (error.message?.includes("AI quota exceeded"))
    throw new AdvisorError(429, "Kliniğin aylık MK Pati AI kotası doldu. Kota artışı için Platform Admin ile görüşün.");
  if (error.message?.includes("AI voice access denied"))
    throw new AdvisorError(403, "Sesli konuşma bu klinik için etkin değil.");
  throw new AdvisorError(403, "MK Pati AI bu klinik veya hesabınız için etkin değil.");
}

export async function recordAiExchange(input: {
  supabase: SupabaseClient;
  businessId: string;
  userId: string;
  conversationId: string | null | undefined;
  patientId: string | null;
  channel: AdvisorChannel;
  intent: string;
  userText: string;
  answer: string;
  model: string | null;
  totalTokens: number;
  safetyFlag: string | null;
}) {
  const { supabase, businessId, userId } = input;
  let conversationId = input.conversationId ?? null;
  if (conversationId) {
    const { data } = await supabase
      .from("ai_conversations")
      .select("id")
      .eq("business_id", businessId)
      .eq("user_id", userId)
      .eq("id", conversationId)
      .maybeSingle();
    conversationId = data?.id ?? null;
  }
  if (!conversationId) {
    const { data } = await supabase
      .from("ai_conversations")
      .insert({ business_id: businessId, patient_id: input.patientId })
      .select("id")
      .single();
    conversationId = data?.id ?? null;
  }
  if (!conversationId) return null;
  const base = { business_id: businessId, conversation_id: conversationId, channel: input.channel, intent: input.intent };
  await supabase.from("ai_messages").insert([
    { ...base, role: "USER", content: input.userText.slice(0, 8000) },
    {
      ...base,
      role: "ASSISTANT",
      content: input.answer.slice(0, 8000),
      model: input.model,
      total_tokens: input.totalTokens,
      safety_flag: input.safetyFlag,
    },
  ]);
  if (input.totalTokens > 0)
    await supabase.rpc("record_ai_tokens", { target_business_id: businessId, token_count: input.totalTokens });
  return conversationId;
}

export function providerFailure(error: unknown) {
  if (error instanceof AdvisorError) return error;
  if (error instanceof AiNotConfiguredError) return new AdvisorError(503, "MK Pati AI henüz yapılandırılmadı.");
  return new AdvisorError(502, "MK Pati AI şu anda yanıt veremiyor. Lütfen biraz sonra tekrar deneyin.");
}

// Cookie-authenticated endpoints reject cross-site form posts.
export function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

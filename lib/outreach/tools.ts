import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { listingAnalysisSchema } from "@/lib/ai/schemas";
import { toOfferedSlots } from "@/lib/outreach/slots";

/**
 * The only operations the AI conversation pipeline can trigger.
 * The model never gets database access, SQL or keys; the pipeline resolves the
 * context from the webhook and every tool re-checks business, conversation and state.
 */
export type ToolContext = {
  db: SupabaseClient;
  businessId: string;
  conversationId: string;
  leadId: string;
  listingId: string | null;
};

const id = z.string().uuid();

async function loadConversation(context: ToolContext) {
  const { data } = await context.db
    .from("conversations")
    .select("id,business_id,lead_id,listing_id,status")
    .eq("id", id.parse(context.conversationId))
    .eq("business_id", context.businessId)
    .eq("lead_id", context.leadId)
    .maybeSingle();
  if (!data) throw new Error("Conversation does not belong to this business");
  return data;
}

export async function getListingContext(context: ToolContext) {
  if (!context.listingId) return null;
  const [{ data: listing }, { data: analysis }] = await Promise.all([
    context.db
      .from("listings")
      .select("id,title,property_type,transaction_type,city,district,neighborhood,room_count")
      .eq("id", context.listingId)
      .eq("business_id", context.businessId)
      .maybeSingle(),
    context.db
      .from("listing_ai_analysis")
      .select("status,analysis_json")
      .eq("listing_id", context.listingId)
      .eq("business_id", context.businessId)
      .maybeSingle(),
  ]);
  if (!listing) return null;
  const parsed =
    analysis?.status === "COMPLETED" ? listingAnalysisSchema.safeParse(analysis.analysis_json) : null;
  return { listing, analysis: parsed?.success ? parsed.data : null };
}

export async function getAvailableAppointmentSlots(context: ToolContext, timeZone: string, limit = 6) {
  const earliest = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const latest = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await context.db
    .from("appointment_slots")
    .select("id,starts_at")
    .eq("business_id", context.businessId)
    .eq("status", "AVAILABLE")
    .gte("starts_at", earliest)
    .lte("starts_at", latest)
    .order("starts_at")
    .limit(limit);
  return toOfferedSlots(data ?? [], timeZone);
}

export async function createAppointment(context: ToolContext, slotId: string, title: string) {
  const conversation = await loadConversation(context);
  if (conversation.status !== "OPEN") throw new Error("Conversation is not active");
  const { data, error } = await context.db.rpc("book_appointment_slot", {
    target_slot_id: id.parse(slotId),
    target_conversation_id: conversation.id,
    appointment_title: title,
  });
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const, appointment: data as { id: string; starts_at: string } };
}

export async function saveConversationSummary(context: ToolContext, summary: string) {
  await loadConversation(context);
  await context.db
    .from("conversations")
    .update({ summary: z.string().trim().min(1).max(600).parse(summary) })
    .eq("id", context.conversationId)
    .eq("business_id", context.businessId);
}

export async function markLeadRejected(context: ToolContext, reason: string) {
  await loadConversation(context);
  const { error } = await context.db.rpc("mark_lead_do_not_contact", {
    target_conversation_id: context.conversationId,
    refusal_reason: reason.slice(0, 300),
  });
  if (error) throw new Error("Lead could not be marked do-not-contact");
}

export async function requestHumanHandoff(context: ToolContext, reason: string) {
  await loadConversation(context);
  const { error } = await context.db.rpc("handoff_conversation", {
    target_conversation_id: context.conversationId,
    handoff_reason: reason.slice(0, 300),
  });
  if (error) throw new Error("Conversation could not be handed off");
}

export async function closeConversation(context: ToolContext, outcome: string) {
  await loadConversation(context);
  await context.db
    .from("conversations")
    .update({ status: "COMPLETED", outcome: outcome.slice(0, 100), ended_at: new Date().toISOString() })
    .eq("id", context.conversationId)
    .eq("business_id", context.businessId)
    .eq("status", "OPEN");
}

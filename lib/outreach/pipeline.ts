import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getAiProvider } from "@/lib/ai/provider";
import type { ConversationTurn } from "@/lib/ai/provider";
import { appointmentConfirmation, decideReply, slotListMessage } from "@/lib/outreach/decide";
import {
  closeConversation,
  createAppointment,
  getAvailableAppointmentSlots,
  getListingContext,
  markLeadRejected,
  requestHumanHandoff,
  saveConversationSummary,
  type ToolContext,
} from "@/lib/outreach/tools";
import type { InboundWhatsAppMessage, WhatsAppStatusUpdate } from "@/lib/providers/whatsapp-webhook";
import type { WhatsAppBusinessProvider } from "@/lib/providers/whatsapp-cloud";
import { database } from "@/lib/supabase/server";

const PROVIDER = "META_CLOUD";
const HISTORY_LIMIT = 20;
const MAX_AI_REPLIES_PER_10_MIN = 8;
const MAX_AI_REPLIES_PER_BUSINESS_HOUR = 300;

type Conversation = {
  id: string;
  business_id: string;
  lead_id: string;
  listing_id: string | null;
  status: string;
};

async function recordEvent(db: SupabaseClient, type: "MESSAGE" | "STATUS", providerEventId: string) {
  const { data } = await db
    .from("webhook_events")
    .upsert(
      { provider: PROVIDER, event_type: type, provider_event_id: providerEventId },
      { onConflict: "provider,provider_event_id", ignoreDuplicates: true },
    )
    .select("id");
  return data?.[0]?.id as string | undefined;
}

async function finishEvent(
  db: SupabaseClient,
  eventId: string,
  status: "PROCESSED" | "IGNORED" | "FAILED",
  detail: string,
  links: { businessId?: string; conversationId?: string } = {},
) {
  await db
    .from("webhook_events")
    .update({
      status,
      detail: detail.slice(0, 500),
      business_id: links.businessId ?? null,
      conversation_id: links.conversationId ?? null,
      processed_at: new Date().toISOString(),
    })
    .eq("id", eventId);
}

async function resolveConversation(db: SupabaseClient, from: string): Promise<Conversation | null> {
  const { data: leads } = await db
    .from("leads")
    .select("id,business_id,created_by_user_id,created_at")
    .eq("phone_normalized", from)
    .order("created_at", { ascending: false })
    .limit(20);
  if (!leads?.length) return null;

  const { data: conversations } = await db
    .from("conversations")
    .select("id,business_id,lead_id,listing_id,status")
    .in("lead_id", leads.map((lead) => lead.id))
    .eq("channel", "WHATSAPP")
    .eq("provider", PROVIDER)
    .order("started_at", { ascending: false })
    .limit(1);
  if (conversations?.[0]) return conversations[0];

  // The owner wrote first: only open a conversation when the match is unambiguous.
  if (leads.length !== 1) return null;
  const lead = leads[0];
  const { data: listing } = await db
    .from("listings")
    .select("id")
    .eq("owner_lead_id", lead.id)
    .eq("business_id", lead.business_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: created } = await db
    .from("conversations")
    .insert({
      business_id: lead.business_id,
      lead_id: lead.id,
      listing_id: listing?.id ?? null,
      channel: "WHATSAPP",
      provider: PROVIDER,
      created_by_user_id: lead.created_by_user_id,
    })
    .select("id,business_id,lead_id,listing_id,status")
    .single();
  return created;
}

async function featureFlags(db: SupabaseClient, businessId: string) {
  const [{ data: business }, { data: entitlement }] = await Promise.all([
    db
      .from("businesses")
      .select("display_name,timezone,status,access_starts_at,access_expires_at")
      .eq("id", businessId)
      .single(),
    db
      .from("business_entitlements")
      .select("whatsapp_enabled,ai_analysis_enabled,valid_from,valid_until")
      .eq("business_id", businessId)
      .maybeSingle(),
  ]);
  const now = Date.now();
  const within = (from: string | null, until: string | null) =>
    (!from || Date.parse(from) <= now) && (!until || Date.parse(until) > now);
  const operational =
    !!business &&
    ["TRIAL", "ACTIVE"].includes(business.status) &&
    within(business.access_starts_at, business.access_expires_at);
  const entitled = !!entitlement && within(entitlement.valid_from, entitlement.valid_until);
  return {
    business,
    whatsapp: operational && entitled && !!entitlement?.whatsapp_enabled,
    ai: operational && entitled && !!entitlement?.ai_analysis_enabled,
  };
}

export async function sendAndRecord(
  db: SupabaseClient,
  provider: WhatsAppBusinessProvider,
  conversation: { id: string; business_id: string },
  to: string,
  content: string,
  senderType: "AI" | "SYSTEM" | "ADVISOR",
) {
  const { data: message } = await db
    .from("messages")
    .insert({
      business_id: conversation.business_id,
      conversation_id: conversation.id,
      sender_type: senderType,
      direction: "OUTBOUND",
      content,
      status: "QUEUED",
    })
    .select("id")
    .single();
  try {
    const { providerMessageId } = await provider.sendMessage(to, content);
    await db
      .from("messages")
      .update({ status: "SENT", provider_message_id: providerMessageId, sent_at: new Date().toISOString() })
      .eq("id", message!.id);
    return true;
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : "UNKNOWN";
    await db.from("messages").update({ status: "FAILED", error_code: code }).eq("id", message!.id);
    return false;
  }
}

async function logActivity(
  db: SupabaseClient,
  conversation: Conversation,
  action: string,
  metadata: Record<string, unknown>,
) {
  await db.from("activity_logs").insert({
    business_id: conversation.business_id,
    lead_id: conversation.lead_id,
    actor_type: "AI",
    action,
    metadata: { conversation_id: conversation.id, ...metadata },
  });
}

async function withinRateLimits(db: SupabaseClient, conversation: Conversation) {
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const [perConversation, perBusiness] = await Promise.all([
    db
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conversation.id)
      .eq("sender_type", "AI")
      .gte("created_at", tenMinutesAgo),
    db
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("business_id", conversation.business_id)
      .eq("sender_type", "AI")
      .gte("created_at", hourAgo),
  ]);
  return (
    (perConversation.count ?? 0) < MAX_AI_REPLIES_PER_10_MIN &&
    (perBusiness.count ?? 0) < MAX_AI_REPLIES_PER_BUSINESS_HOUR
  );
}

async function respondWithAi(
  db: SupabaseClient,
  provider: WhatsAppBusinessProvider,
  conversation: Conversation,
  inbound: InboundWhatsAppMessage,
  officeName: string,
  timeZone: string,
) {
  const { data: lead } = await db
    .from("leads")
    .select("id,name,phone_normalized,do_not_contact")
    .eq("id", conversation.lead_id)
    .eq("business_id", conversation.business_id)
    .single();
  if (!lead || lead.do_not_contact || !lead.phone_normalized) return "SKIPPED_DO_NOT_CONTACT";
  if (conversation.status !== "OPEN") return `SKIPPED_${conversation.status}`;

  const { data: messages } = await db
    .from("messages")
    .select("id,direction,content,status,provider_message_id,created_at")
    .eq("conversation_id", conversation.id)
    .in("status", ["SENT", "DELIVERED", "READ"])
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);
  const history = (messages ?? []).reverse();
  if (!history.some((message) => message.direction === "OUTBOUND")) return "SKIPPED_NOT_INITIATED";
  if (!(await withinRateLimits(db, conversation))) return "SKIPPED_RATE_LIMIT";

  const context: ToolContext = {
    db,
    businessId: conversation.business_id,
    conversationId: conversation.id,
    leadId: conversation.lead_id,
    listingId: conversation.listing_id,
  };
  const [listingContext, slots] = await Promise.all([
    getListingContext(context),
    getAvailableAppointmentSlots(context, timeZone),
  ]);

  const ai = await getAiProvider();
  const turns: ConversationTurn[] = history.map((message) => ({
    role: message.direction === "INBOUND" ? "LEAD" : "OFFICE",
    content: message.content,
  }));
  const reply = await ai.generateConversationReply({
    officeName,
    ownerName: lead.name,
    analysis: listingContext?.analysis ?? null,
    listingTitle: listingContext?.listing.title ?? "İlan",
    history: turns,
    slots: slots.map(({ id, label }) => ({ id, label })),
    now: new Intl.DateTimeFormat("tr-TR", { timeZone, dateStyle: "full", timeStyle: "short" }).format(new Date()),
  });

  // A newer inbound message will be answered by its own run with the full context.
  const { data: latestInbound } = await db
    .from("messages")
    .select("provider_message_id")
    .eq("conversation_id", conversation.id)
    .eq("direction", "INBOUND")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestInbound?.provider_message_id !== inbound.providerMessageId) return "SKIPPED_SUPERSEDED";

  const decision = decideReply(reply, slots);
  const send = (text: string) =>
    sendAndRecord(db, provider, conversation, lead.phone_normalized!, text, "AI");

  switch (decision.type) {
    case "REJECT":
      await send(decision.message);
      await markLeadRejected(context, inbound.text);
      break;
    case "BOOK": {
      const title = `Portföy görüşmesi – ${listingContext?.listing.title ?? lead.name}`.slice(0, 240);
      const result = await createAppointment(context, decision.slotId, title);
      if (result.ok) {
        const slot = slots.find((candidate) => candidate.id === decision.slotId)!;
        await send(appointmentConfirmation(slot.label, officeName));
      } else {
        const remaining = await getAvailableAppointmentSlots(context, timeZone);
        await send(`Seçtiğiniz saat az önce doldu. ${slotListMessage(remaining)}`);
      }
      break;
    }
    case "HANDOFF":
      await send(decision.message);
      await requestHumanHandoff(context, decision.reason);
      break;
    case "CLOSE":
      await send(decision.message);
      await closeConversation(context, "AI_CLOSED");
      break;
    case "REPLY":
      await send(decision.message);
      break;
  }
  await saveConversationSummary(context, reply.conversation_summary);
  await logActivity(db, conversation, "AI_WHATSAPP_REPLY", {
    intent: reply.intent,
    recommended_action: reply.recommended_action,
    decision: decision.type,
    blocked: decision.type === "REPLY" ? decision.blocked ?? null : null,
  });
  return `REPLIED_${decision.type}`;
}

async function handleInbound(
  db: SupabaseClient,
  provider: WhatsAppBusinessProvider,
  inbound: InboundWhatsAppMessage,
) {
  const eventId = await recordEvent(db, "MESSAGE", inbound.providerMessageId);
  if (!eventId) return; // duplicate delivery

  try {
    const conversation = await resolveConversation(db, inbound.from);
    if (!conversation) return finishEvent(db, eventId, "IGNORED", "UNMATCHED_SENDER");
    const links = { businessId: conversation.business_id, conversationId: conversation.id };

    const { error } = await db.from("messages").insert({
      business_id: conversation.business_id,
      conversation_id: conversation.id,
      sender_type: "LEAD",
      direction: "INBOUND",
      content: inbound.text,
      status: "DELIVERED",
      provider_message_id: inbound.providerMessageId,
      delivered_at: inbound.sentAt.toISOString(),
    });
    if (error) return finishEvent(db, eventId, "IGNORED", "DUPLICATE_MESSAGE", links);
    await db
      .from("conversations")
      .update({ last_inbound_at: inbound.sentAt.toISOString() })
      .eq("id", conversation.id);
    // The owner wrote to us on WhatsApp; unless they refused contact, replying there is expected.
    await db
      .from("leads")
      .update({ whatsapp_allowed: true, last_contact_at: inbound.sentAt.toISOString() })
      .eq("id", conversation.lead_id)
      .eq("do_not_contact", false);
    await provider.markRead(inbound.providerMessageId);

    const flags = await featureFlags(db, conversation.business_id);
    if (!flags.whatsapp || !flags.ai || !flags.business)
      return finishEvent(db, eventId, "PROCESSED", "STORED_AI_DISABLED", links);

    const outcome = await respondWithAi(
      db,
      provider,
      conversation,
      inbound,
      flags.business.display_name,
      flags.business.timezone,
    );
    await finishEvent(db, eventId, "PROCESSED", outcome, links);
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : "PIPELINE_ERROR";
    await finishEvent(db, eventId, "FAILED", code);
  }
}

const statusRank: Record<string, number> = { QUEUED: 0, SENT: 1, DELIVERED: 2, READ: 3, FAILED: 4 };

async function handleStatus(db: SupabaseClient, update: WhatsAppStatusUpdate) {
  const eventId = await recordEvent(db, "STATUS", `${update.providerMessageId}:${update.status}`);
  if (!eventId) return;
  const next = update.status.toUpperCase();
  const { data: message } = await db
    .from("messages")
    .select("id,business_id,conversation_id,status")
    .eq("provider_message_id", update.providerMessageId)
    .maybeSingle();
  if (!message) return finishEvent(db, eventId, "IGNORED", "UNKNOWN_MESSAGE");
  if ((statusRank[next] ?? 0) > (statusRank[message.status] ?? 0))
    await db
      .from("messages")
      .update({
        status: next,
        error_code: update.errorCode,
        ...(next === "DELIVERED" ? { delivered_at: new Date().toISOString() } : {}),
      })
      .eq("id", message.id);
  await finishEvent(db, eventId, "PROCESSED", next, {
    businessId: message.business_id,
    conversationId: message.conversation_id,
  });
}

export async function processWhatsAppWebhook(provider: WhatsAppBusinessProvider, payload: unknown) {
  const db = database(true);
  const { messages, statuses } = provider.parseWebhook(payload);
  for (const update of statuses) await handleStatus(db, update);
  for (const inbound of messages) await handleInbound(db, provider, inbound);
}

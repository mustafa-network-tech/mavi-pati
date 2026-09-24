import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

type AiToolContext = {
  businessId: string;
  supabase: SupabaseClient;
};

const id = z.string().uuid();
const status = z.enum([
  "NEW",
  "REVIEWING",
  "APPROVED",
  "CONTACTED",
  "QUALIFIED",
  "APPOINTMENT_SCHEDULED",
  "WON",
  "LOST",
  "ARCHIVED",
]);

function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error || !result.data) throw new Error(result.error?.message ?? "Kayıt bulunamadı.");
  return result.data;
}

/**
 * The only database surface exposed to an AI runtime.
 * It deliberately provides domain operations instead of arbitrary SQL/query access.
 */
export function createAiTools(context: AiToolContext) {
  return {
    async getLead(input: { leadId: string }) {
      const leadId = id.parse(input.leadId);
      return unwrap(
        await context.supabase
          .from("leads")
          .select("id,name,phone,email,city,district,status,priority,preferred_contact_method,whatsapp_allowed,call_allowed,next_follow_up_at")
          .eq("business_id", context.businessId)
          .eq("id", leadId)
          .maybeSingle(),
      );
    },

    async getListing(input: { listingId: string }) {
      const listingId = id.parse(input.listingId);
      return unwrap(
        await context.supabase
          .from("listings")
          .select("id,title,description,property_type,transaction_type,price,currency,city,district,neighborhood,gross_area,net_area,room_count,status")
          .eq("business_id", context.businessId)
          .eq("id", listingId)
          .maybeSingle(),
      );
    },

    async updateLeadStatus(input: { leadId: string; status: string }) {
      const result = await context.supabase.rpc("update_lead_status", {
        target_lead_id: id.parse(input.leadId),
        next_status: status.parse(input.status),
      });
      return unwrap(result);
    },

    async createAppointment(input: {
      leadId: string;
      listingId?: string | null;
      advisorMemberId: string;
      title: string;
      startsAt: string;
      endsAt: string;
      location?: string | null;
      notes?: string | null;
    }) {
      const parsed = z.object({
        leadId: id,
        listingId: id.nullish(),
        advisorMemberId: id,
        title: z.string().trim().min(3).max(240),
        startsAt: z.string().datetime({ offset: true }),
        endsAt: z.string().datetime({ offset: true }),
        location: z.string().trim().max(500).nullish(),
        notes: z.string().trim().max(5000).nullish(),
      }).parse(input);
      return unwrap(await context.supabase.rpc("create_appointment", {
        target_lead_id: parsed.leadId,
        target_listing_id: parsed.listingId ?? null,
        target_advisor_member_id: parsed.advisorMemberId,
        appointment_title: parsed.title,
        appointment_starts_at: parsed.startsAt,
        appointment_ends_at: parsed.endsAt,
        appointment_location: parsed.location ?? null,
        appointment_notes: parsed.notes ?? null,
      }));
    },

    async rescheduleAppointment(input: { appointmentId: string; startsAt: string; endsAt: string }) {
      const parsed = z.object({ appointmentId: id, startsAt: z.string().datetime({ offset: true }), endsAt: z.string().datetime({ offset: true }) }).parse(input);
      return unwrap(await context.supabase.rpc("reschedule_appointment", {
        target_appointment_id: parsed.appointmentId,
        new_starts_at: parsed.startsAt,
        new_ends_at: parsed.endsAt,
      }));
    },

    async cancelAppointment(input: { appointmentId: string; reason?: string | null }) {
      const parsed = z.object({ appointmentId: id, reason: z.string().trim().max(1000).nullish() }).parse(input);
      return unwrap(await context.supabase.rpc("cancel_appointment", {
        target_appointment_id: parsed.appointmentId,
        cancel_reason: parsed.reason ?? null,
      }));
    },

    async saveConversationSummary(input: { conversationId: string; summary: string; outcome?: string | null }) {
      const parsed = z.object({ conversationId: id, summary: z.string().trim().min(1).max(10000), outcome: z.string().trim().max(500).nullish() }).parse(input);
      return unwrap(await context.supabase.rpc("save_conversation_summary", {
        target_conversation_id: parsed.conversationId,
        summary_text: parsed.summary,
        outcome_text: parsed.outcome ?? null,
      }));
    },

    async scheduleCallback(input: { leadId: string; callbackAt: string }) {
      const parsed = z.object({ leadId: id, callbackAt: z.string().datetime({ offset: true }) }).parse(input);
      return unwrap(await context.supabase.rpc("schedule_callback", {
        target_lead_id: parsed.leadId,
        callback_at: parsed.callbackAt,
      }));
    },

    async transferToHuman(input: { conversationId: string; advisorMemberId: string }) {
      const parsed = z.object({ conversationId: id, advisorMemberId: id }).parse(input);
      return unwrap(await context.supabase.rpc("transfer_to_human", {
        target_conversation_id: parsed.conversationId,
        target_member_id: parsed.advisorMemberId,
      }));
    },
  };
}

export type AiTools = ReturnType<typeof createAiTools>;

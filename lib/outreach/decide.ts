import type { ConversationReply } from "@/lib/ai/schemas";
import { findPolicyViolation, findUnofferedTimes } from "@/lib/ai/safety";

export type OfferedSlot = { id: string; label: string; time: string };

export type ReplyDecision =
  | { type: "REJECT"; message: string }
  | { type: "BOOK"; slotId: string }
  | { type: "HANDOFF"; message: string; reason: string }
  | { type: "CLOSE"; message: string }
  | { type: "REPLY"; message: string; blocked?: string };

export const REJECTION_ACK =
  "Anlıyorum, bilgilendirdiğiniz için teşekkür ederim. Sizi bir daha rahatsız etmeyeceğiz. İyi günler dilerim.";

export const COMMERCIAL_REDIRECT =
  "Fiyatlandırma ve ticari koşullar konusunda karar verme yetkim bulunmuyor. Dilerseniz bu konuları gayrimenkul danışmanımızla konuşabilmeniz için kısa bir görüşme ayarlayabilirim.";

export function slotListMessage(slots: OfferedSlot[]) {
  if (!slots.length)
    return "Şu an sistemde tanımlı uygun bir görüşme saati yok; danışmanımız en kısa sürede sizinle iletişime geçecek.";
  return `Danışmanımızla şu saatlerde görüşme ayarlayabilirim: ${slots
    .slice(0, 3)
    .map((slot) => slot.label)
    .join(", ")}. Hangisi size uygun olur?`;
}

export function appointmentConfirmation(slotLabel: string, officeName: string) {
  return `Harika, ${slotLabel} için ${officeName} danışmanımızla görüşmenizi oluşturdum. Görüşmeden önce size hatırlatma yapacağız. Teşekkür ederim!`;
}

/**
 * Turns the model's structured suggestion into an action the backend is willing to take.
 * recommended_action is only a suggestion; slots, refusals and commercial limits are enforced here.
 */
export function decideReply(reply: ConversationReply, slots: OfferedSlot[]): ReplyDecision {
  if (reply.do_not_contact || reply.intent === "REJECTION") {
    const safe = !findPolicyViolation(reply.reply) && reply.reply.length <= 300;
    return { type: "REJECT", message: safe ? reply.reply : REJECTION_ACK };
  }

  if (reply.recommended_action === "CREATE_APPOINTMENT") {
    const slot = slots.find((candidate) => candidate.id === reply.selected_slot_id);
    if (slot) return { type: "BOOK", slotId: slot.id };
    return slots.length
      ? { type: "REPLY", message: slotListMessage(slots), blocked: "UNKNOWN_SLOT" }
      : { type: "HANDOFF", message: slotListMessage(slots), reason: "NO_SLOTS" };
  }

  const violation = findPolicyViolation(reply.reply);
  if (violation) return { type: "REPLY", message: COMMERCIAL_REDIRECT, blocked: violation };

  if (findUnofferedTimes(reply.reply, slots.map((slot) => slot.time)).length)
    return slots.length
      ? { type: "REPLY", message: slotListMessage(slots), blocked: "UNOFFERED_TIME" }
      : { type: "HANDOFF", message: slotListMessage(slots), reason: "NO_SLOTS" };

  if (reply.recommended_action === "HANDOFF" || reply.intent === "HUMAN_REQUEST")
    return { type: "HANDOFF", message: reply.reply, reason: reply.intent };
  if (reply.recommended_action === "SHOW_APPOINTMENTS" && !slots.length)
    return { type: "HANDOFF", message: slotListMessage(slots), reason: "NO_SLOTS" };
  if (reply.recommended_action === "CLOSE_CONVERSATION") return { type: "CLOSE", message: reply.reply };
  return { type: "REPLY", message: reply.reply };
}

import type { Clinic, UnansweredQuestion } from "@/types";
export type NotificationContext = {
  clinic: Clinic;
  question: UnansweredQuestion;
};
export interface NotificationProvider {
  prepare(context: NotificationContext): {
    url: string;
  } | null;
}
export interface AutomaticNotificationProvider {
  send(context: NotificationContext): Promise<void>;
}
export function unansweredWhatsAppMessage(q: UnansweredQuestion) {
  return `🔔 Cevapsız Müşteri Sorusu\n\nMüşteri: ${q.visitor_name}\nTelefon: ${q.visitor_phone}\n\nSoru:\n${q.question_text}\n\nSesli asistan bu soru için kayıtlı bilgilerde yeterli bir cevap bulamadı.\n\nLütfen müşteriyle en kısa sürede iletişime geçiniz.`;
}
/** V1 only prepares a user-initiated conversation; it never sends a message. */
export class WhatsAppNotificationProvider implements NotificationProvider {
  prepare({ clinic, question }: NotificationContext) {
    if (clinic.id !== question.clinic_id)
      throw new Error("Notification clinic mismatch");
    const number = clinic.whatsapp?.replace(/[\s()+-]/g, "");
    if (!number || !/^[1-9]\d{7,14}$/.test(number)) return null;
    return {
      url: `https://wa.me/${number}?text=${encodeURIComponent(unansweredWhatsAppMessage(question))}`,
    };
  }
}

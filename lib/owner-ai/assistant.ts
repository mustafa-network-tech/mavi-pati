import "server-only";

import { OWNER_DISCLAIMER, REQUEST_DISCLAIMER, type AdvisorChannel } from "@/lib/ai/policy";
import { getAiProvider, type AiProvider } from "@/lib/ai/provider";
import { findClinicalSafetyViolation, SAFETY_FALLBACK_ANSWER } from "@/lib/ai/safety";
import type { OwnerIntent } from "@/lib/ai/schemas";
import { ageLabel, appointmentStatusLabels, formatDate, label, speciesLabels, vaccinationStatusLabels } from "@/lib/clinic/labels";
import { AdvisorError, consumeAiQuota, providerFailure, recordAiExchange } from "@/lib/clinic-ai/shared";
import { loadOwnerOverview, type OwnerAccess, type OwnerOverview, type OwnerPet } from "@/lib/owner-portal/overview";
import { addDays, localDateString } from "@/lib/time";

export type OwnerAssistantInput =
  | { kind: "text"; text: string }
  | { kind: "audio"; audio: Blob; fileName: string };

// Prepared by the assistant, confirmed by the owner, reviewed by the clinic.
export type OwnerRequestDraft = {
  type: "APPOINTMENT" | "MEDICATION";
  patientId: string;
  petName: string;
  preferredDate: string | null;
  preferredTime: string | null;
  medicationName: string | null;
  details: string;
  channel: "AI_TEXT" | "AI_VOICE";
};

export type OwnerAssistantResult = {
  conversationId: string | null;
  transcript: string;
  intent: OwnerIntent;
  answer: string;
  disclaimer: string | null;
  draft: OwnerRequestDraft | null;
  emergency: boolean;
  petChoices: { id: string; name: string }[];
};

const MAX_REQUEST_LENGTH = 2000;

// Checked before any model call: an emergency must never wait for classification.
const emergencyPattern =
  /zehir|nefes\s*(?:alam|darl|almıyor|almakta\s+zorlan)|bayıl|bilinc|kasıl|nöbet|havale|kanıyor|kanama|kan\s+kus|araba\s+çarp|çarpt|yüksekten\s+düş|doğum(?:\s+yap)?amıyor|zor\s+doğum|yuttu|felç|morardı/iu;

const lower = (value: string) => value.toLocaleLowerCase("tr-TR");

export function isEmergencyText(text: string) {
  return emergencyPattern.test(text);
}

export function emergencyAnswer(clinic: OwnerOverview["clinic"]) {
  const phone = clinic.phone ? ` ${clinic.display_name} telefonu: ${clinic.phone}.` : "";
  return `Anlattığınız durum acil olabilir. Lütfen beklemeden kliniği arayın veya en yakın acil veteriner kliniğine gidin.${phone} MK Pati AI acil durumda değerlendirme yapamaz.`;
}

export function findPet(pets: OwnerPet[], name: string | null) {
  if (name) {
    const wanted = lower(name.trim());
    const exact = pets.filter((pet) => lower(pet.name) === wanted);
    if (exact.length === 1) return exact[0];
    const partial = pets.filter((pet) => lower(pet.name).startsWith(wanted) || wanted.startsWith(lower(pet.name)));
    if (partial.length === 1) return partial[0];
    return null;
  }
  return pets.length === 1 ? pets[0] : null;
}

// The medication name must come from the owner's own words, never from the model.
export function groundedMedicationName(name: string | null, ownerText: string) {
  if (!name) return null;
  const said = lower(ownerText);
  const words = lower(name).split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 3);
  return words.length && words.every((word) => said.includes(word)) ? name.trim() : null;
}

export function validPreferredDate(value: string | null, today: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) return null;
  return value >= today && value <= addDays(today, 180) ? value : null;
}

function petContext(overview: OwnerOverview, pets: OwnerPet[], today: string) {
  return {
    bugun: today,
    hayvanlar: pets.map((pet) => ({
      ad: pet.name,
      tur: label(speciesLabels, pet.species),
      irk: pet.breed,
      yas: ageLabel(pet.birth_date, pet.birth_date_estimated),
      asilar: overview.vaccinations
        .filter((item) => item.patient_id === pet.id)
        .map((item) => ({
          asi: item.vaccine_name,
          durum: label(vaccinationStatusLabels, item.status),
          uygulama: item.administered_at,
          sonraki: item.next_due_at,
        })),
      randevular: overview.appointments
        .filter((item) => item.patient_id === pet.id)
        .map((item) => ({
          tarih: new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: overview.clinic.timezone }).format(new Date(item.starts_at)),
          durum: label(appointmentStatusLabels, item.status),
          aciklama: item.reason,
        })),
    })),
  };
}

export async function runOwnerAssistant(
  request: { access: OwnerAccess; channel: AdvisorChannel; input: OwnerAssistantInput; conversationId?: string | null },
  providerOverride?: AiProvider,
): Promise<OwnerAssistantResult> {
  const { access } = request;
  const provider = providerOverride ?? (await getAiProvider());
  if (!provider.configured) throw new AdvisorError(503, "MK Pati AI henüz yapılandırılmadı.");
  const overview = await loadOwnerOverview(access);
  if (!overview) throw new AdvisorError(403, "Portal erişiminiz bulunamadı.");
  if (!overview.clinic.ai_enabled) throw new AdvisorError(403, "MK Pati AI bu klinik için etkin değil.");

  await consumeAiQuota(access.supabase, access.businessId, request.channel === "VOICE");

  let transcript: string;
  let totalTokens = 0;
  try {
    transcript =
      request.input.kind === "audio"
        ? await provider.transcribe(request.input.audio, request.input.fileName)
        : request.input.text;
  } catch (error) {
    throw providerFailure(error);
  }
  transcript = transcript.trim().slice(0, MAX_REQUEST_LENGTH);
  if (!transcript) throw new AdvisorError(422, "Ses anlaşılamadı. Lütfen tekrar deneyin veya yazarak sorun.");

  const today = localDateString(overview.clinic.timezone);
  const finish = async (
    intent: OwnerIntent,
    answer: string,
    extra: Partial<Pick<OwnerAssistantResult, "disclaimer" | "draft" | "emergency" | "petChoices">> = {},
    patientId: string | null = null,
    safetyFlag: string | null = null,
  ): Promise<OwnerAssistantResult> => {
    const conversationId = await recordAiExchange({
      supabase: access.supabase,
      businessId: access.businessId,
      userId: access.userId,
      conversationId: request.conversationId,
      patientId,
      channel: request.channel,
      intent: `OWNER_${intent}`,
      userText: transcript,
      answer,
      model: provider.model,
      totalTokens,
      safetyFlag,
    }).catch(() => null);
    return {
      conversationId,
      transcript,
      intent,
      answer,
      disclaimer: extra.disclaimer ?? null,
      draft: extra.draft ?? null,
      emergency: extra.emergency ?? false,
      petChoices: extra.petChoices ?? [],
    };
  };

  if (isEmergencyText(transcript)) return finish("EMERGENCY", emergencyAnswer(overview.clinic), { emergency: true });

  let classification;
  try {
    const completion = await provider.classifyOwnerRequest({
      text: transcript,
      petNames: overview.pets.map((pet) => pet.name),
      today,
      appointmentsEnabled: overview.clinic.appointments_enabled,
    });
    totalTokens += completion.totalTokens;
    classification = completion.data;
  } catch (error) {
    throw providerFailure(error);
  }
  const { intent } = classification;

  if (intent === "EMERGENCY") return finish(intent, emergencyAnswer(overview.clinic), { emergency: true });
  if (intent === "OUT_OF_SCOPE")
    return finish(
      intent,
      "Teşhis, belirti yorumu, ilaç veya tedavi önerisi veremem; bunlar veteriner hekiminizin değerlendirmesini gerektirir. İsterseniz sizin için bir randevu talebi hazırlayabilirim veya kliniği arayabilirsiniz.",
      { disclaimer: OWNER_DISCLAIMER },
    );
  if (intent === "CLINIC_INFO") {
    const { clinic } = overview;
    const details = [clinic.phone && `Telefon: ${clinic.phone}`, clinic.email && `E-posta: ${clinic.email}`, clinic.address && `Adres: ${clinic.address}`].filter(Boolean);
    return finish(intent, details.length ? `${clinic.display_name} iletişim bilgileri: ${details.join(" · ")}.` : `${clinic.display_name} için kayıtlı iletişim bilgisi bulunmuyor.`);
  }
  if (intent === "REQUEST_STATUS") {
    const recent = overview.requests.slice(0, 5);
    if (!recent.length) return finish(intent, "Henüz gönderilmiş bir talebiniz yok.");
    const statusText: Record<string, string> = { PENDING: "klinik onayı bekliyor", APPROVED: "onaylandı", REJECTED: "reddedildi", CANCELED: "iptal edildi" };
    const lines = recent.map((item) => {
      const pet = overview.pets.find((candidate) => candidate.id === item.patient_id)?.name ?? "Hayvanınız";
      const kind = item.request_type === "APPOINTMENT" ? "randevu" : `ilaç (${item.medication_name})`;
      return `${pet} için ${kind} talebi ${statusText[item.status] ?? item.status}${item.clinic_response ? `. Klinik notu: ${item.clinic_response}` : ""}.`;
    });
    return finish(intent, lines.join("\n"));
  }

  if (!overview.pets.length) return finish(intent, "Portalınızda kayıtlı hayvan bulunmuyor. Lütfen kliniğinizle iletişime geçin.");
  const pet = findPet(overview.pets, classification.pet_name);
  const choices = overview.pets.map((item) => ({ id: item.id, name: item.name }));

  if (intent === "APPOINTMENT_REQUEST" || intent === "MEDICATION_REQUEST") {
    if (intent === "APPOINTMENT_REQUEST" && !overview.clinic.appointments_enabled)
      return finish(intent, `Bu klinikte çevrim içi randevu talebi kapalı. Lütfen kliniği arayın${overview.clinic.phone ? `: ${overview.clinic.phone}` : ""}.`);
    if (!pet)
      return finish(intent, `Hangi hayvanınız için? ${choices.map((item) => item.name).join(", ")} arasından belirtin.`, { petChoices: choices });
    const channel = request.channel === "VOICE" ? "AI_VOICE" : "AI_TEXT";
    if (intent === "MEDICATION_REQUEST") {
      const medicationName = groundedMedicationName(classification.medication_name, transcript);
      if (!medicationName)
        return finish(
          intent,
          `${pet.name} için hangi ilacın veya ürünün tekrarını istiyorsunuz? Veteriner hekiminizin verdiği adıyla söyleyin; MK Pati AI ilaç önermez.`,
          { disclaimer: REQUEST_DISCLAIMER },
          pet.id,
        );
      const draft: OwnerRequestDraft = { type: "MEDICATION", patientId: pet.id, petName: pet.name, preferredDate: null, preferredTime: null, medicationName, details: transcript, channel };
      return finish(
        intent,
        `${pet.name} için "${medicationName}" ilaç talebini hazırladım. Göndermek için "Talebi gönder"e dokunun; veteriner hekim onayladığında burada göreceksiniz.`,
        { draft, disclaimer: REQUEST_DISCLAIMER },
        pet.id,
      );
    }
    const preferredDate = validPreferredDate(classification.preferred_date, today);
    const when = [preferredDate && formatDate(preferredDate), classification.preferred_time].filter(Boolean).join(" ");
    const draft: OwnerRequestDraft = {
      type: "APPOINTMENT",
      patientId: pet.id,
      petName: pet.name,
      preferredDate,
      preferredTime: classification.preferred_time,
      medicationName: null,
      details: transcript,
      channel,
    };
    return finish(
      intent,
      `${pet.name} için ${when ? `${when} tercihli ` : ""}randevu talebini hazırladım. Göndermek için "Talebi gönder"e dokunun; klinik uygun saati onaylayınca burada göreceksiniz.`,
      { draft, disclaimer: REQUEST_DISCLAIMER },
      pet.id,
    );
  }

  // PET_SUMMARY: grounded answer about the owner's own pet(s) only.
  const pets = pet ? [pet] : classification.pet_name ? [] : overview.pets;
  if (!pets.length)
    return finish(intent, `Kayıtlarınızda "${classification.pet_name}" adlı bir hayvan bulunamadı.`, { petChoices: choices });
  const context = petContext(overview, pets, today);
  let answer: string;
  try {
    const completion = await provider.answerAdvisor({
      audience: "OWNER",
      channel: request.channel,
      task: "Hayvan sahibinin sorusunu yalnızca BAĞLAM'daki aşı ve randevu kayıtlarına dayanarak kısa ve anlaşılır biçimde yanıtla. Gecikmiş veya yaklaşan aşı varsa belirt ve gerekiyorsa randevu talebi oluşturabileceğini söyle.",
      request: transcript,
      context,
      now: new Intl.DateTimeFormat("tr-TR", { dateStyle: "full", timeStyle: "short", timeZone: overview.clinic.timezone }).format(new Date()),
      clinicName: overview.clinic.display_name,
    });
    totalTokens += completion.totalTokens;
    answer = completion.data.answer;
  } catch (error) {
    throw providerFailure(error);
  }
  const violation = findClinicalSafetyViolation(answer, JSON.stringify(context));
  return finish(intent, violation ? SAFETY_FALLBACK_ANSWER : answer, { disclaimer: OWNER_DISCLAIMER }, pet?.id ?? null, violation);
}

import "server-only";

import type { BusinessAccess } from "@/lib/auth/dal";
import { CLINICAL_DISCLAIMER, DRAFT_DISCLAIMER, type AdvisorChannel } from "@/lib/ai/policy";
import { getAiProvider, type AiProvider } from "@/lib/ai/provider";
import { findClinicalSafetyViolation, SAFETY_FALLBACK_ANSWER } from "@/lib/ai/safety";
import type { AdvisorIntent } from "@/lib/ai/schemas";
import {
  findPatientsByName,
  loadPatientSummary,
  operationsContext,
  patientContext,
  todayAppointmentsContext,
  upcomingFollowUpsContext,
  upcomingVaccinationsContext,
  type AdvisorDataContext,
  type PatientCandidate,
} from "@/lib/clinic-ai/context";
import {
  advisorIntents,
  allowedIntents,
  isIntentAllowed,
  notAllowedAnswer,
  OUT_OF_SCOPE_ANSWER,
  type ConcreteIntent,
} from "@/lib/clinic-ai/intents";
import { isClinicalRole } from "@/lib/clinic/roles";
import { AdvisorError, consumeAiQuota, providerFailure, recordAiExchange } from "@/lib/clinic-ai/shared";

export { AdvisorError };

export type AdvisorInput =
  | { kind: "text"; text: string }
  | { kind: "audio"; audio: Blob; fileName: string };

export type AdvisorRequest = {
  access: BusinessAccess;
  channel: AdvisorChannel;
  input: AdvisorInput;
  intent?: ConcreteIntent | null;
  patientId?: string | null;
  conversationId?: string | null;
};

export type AdvisorResult = {
  conversationId: string | null;
  transcript: string;
  intent: AdvisorIntent;
  answer: string;
  disclaimer: string | null;
  insufficientData: boolean;
  candidates: PatientCandidate[];
  safetyFlag: string | null;
  remainingQuota: number;
};

const MAX_REQUEST_LENGTH = 6000;

function disclaimerFor(intent: AdvisorIntent) {
  if (intent === "OUT_OF_SCOPE") return null;
  const kind = advisorIntents[intent].disclaimer;
  return kind === "CLINICAL" ? CLINICAL_DISCLAIMER : kind === "DRAFT" ? DRAFT_DISCLAIMER : null;
}

export async function runClinicAdvisor(
  request: AdvisorRequest,
  providerOverride?: AiProvider,
): Promise<AdvisorResult> {
  const { access } = request;
  if (access.membership.status !== "ACTIVE") throw new AdvisorError(403, "Hesabınız bu klinikte aktif değil.");
  const provider = providerOverride ?? (await getAiProvider());
  if (!provider.configured) throw new AdvisorError(503, "MK Pati AI henüz yapılandırılmadı.");

  const remainingQuota = await consumeAiQuota(access.supabase, access.business.id, request.channel === "VOICE");

  const context: AdvisorDataContext = {
    supabase: access.supabase,
    businessId: access.business.id,
    timeZone: access.business.timezone,
    role: access.membership.role,
  };

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

  const currentPatient = request.patientId ? await loadPatientSummary(context, request.patientId) : null;
  if (request.patientId && !currentPatient) throw new AdvisorError(404, "Hasta bulunamadı.");

  const finish = async (
    result: Omit<AdvisorResult, "conversationId" | "transcript" | "remainingQuota" | "disclaimer">,
    patientId: string | null,
  ): Promise<AdvisorResult> => {
    const complete = { ...result, disclaimer: result.candidates.length ? null : disclaimerFor(result.intent) };
    const conversationId = await recordAiExchange({
      supabase: access.supabase,
      businessId: access.business.id,
      userId: access.userId,
      conversationId: request.conversationId,
      patientId,
      channel: request.channel,
      intent: complete.intent,
      userText: transcript,
      answer: complete.answer,
      model: provider.model,
      totalTokens,
      safetyFlag: complete.safetyFlag,
    }).catch(() => null);
    return { ...complete, conversationId, transcript, remainingQuota };
  };
  const reply = (intent: AdvisorIntent, answer: string, patientId: string | null, candidates: PatientCandidate[] = []) =>
    finish({ intent, answer, insufficientData: false, candidates, safetyFlag: null }, patientId);

  // 1. Intent: explicit action buttons skip classification; free text is classified
  //    against the intents this role may use.
  const permitted = allowedIntents(context.role);
  let intent: AdvisorIntent;
  let patientName: string | null = null;
  let noteText: string | null = null;
  if (request.intent) {
    intent = request.intent;
    if (intent === "NOTE_CLEANUP") noteText = transcript;
  } else {
    try {
      const classification = await provider.classifyAdvisorRequest({
        text: transcript,
        allowedIntents: permitted.map((key) => ({ key, description: advisorIntents[key].description })),
        currentPatientName: currentPatient?.name ?? null,
      });
      totalTokens += classification.totalTokens;
      ({ intent, patient_name: patientName, note_text: noteText } = classification.data);
    } catch (error) {
      throw providerFailure(error);
    }
  }
  if (intent === "OUT_OF_SCOPE") return reply(intent, OUT_OF_SCOPE_ANSWER, currentPatient?.id ?? null);
  if (!isIntentAllowed(intent, context.role)) return reply(intent, notAllowedAnswer(intent), currentPatient?.id ?? null);
  const definition = advisorIntents[intent];

  // 2. Patient: the open patient page, or a name resolved inside this clinic only.
  let patientId = currentPatient?.id ?? null;
  const mentionsOtherPatient =
    patientName &&
    patientName.toLocaleLowerCase("tr-TR") !== (currentPatient?.name as string | undefined)?.toLocaleLowerCase("tr-TR");
  if (definition.needsPatient && patientName && (mentionsOtherPatient || !patientId)) {
    const candidates = await findPatientsByName(context, patientName);
    if (!candidates.length) return reply(intent, `Kayıtlarda "${patientName}" adlı bir hasta bulunamadı.`, null);
    if (candidates.length > 1)
      return reply(
        intent,
        `"${patientName}" adıyla birden fazla hasta bulundu. Doğru hastayı seçin veya hasta sayfasından tekrar sorun.`,
        null,
        candidates,
      );
    patientId = candidates[0].id;
  }
  if (definition.needsPatient && !patientId)
    return reply(intent, "Hangi hasta için? Hasta adını belirtin veya hasta sayfasından sorun.", null);

  // 3. Minimum context for the task, read with the user's own RLS-bound client.
  let data: unknown;
  if (intent === "NOTE_CLEANUP") {
    if (!noteText || noteText.length < 10) return reply(intent, "Düzenlenecek veteriner notunu yazın veya söyleyin.", patientId);
    data = { not: noteText };
  } else if (intent === "TODAY_APPOINTMENTS") data = await todayAppointmentsContext(context);
  else if (intent === "UPCOMING_VACCINATIONS") data = await upcomingVaccinationsContext(context);
  else if (intent === "UPCOMING_FOLLOW_UPS") data = await upcomingFollowUpsContext(context);
  else if (intent === "OPERATIONS_SUMMARY") data = await operationsContext(context);
  else {
    const limits = {
      PATIENT_HISTORY: { examinations: 10, treatments: 10 },
      RECENT_EXAMINATIONS: { examinations: 3, treatments: 0 },
      VACCINATION_SUMMARY: { examinations: isClinicalRole(context.role) ? 5 : 0, treatments: 0 },
      OWNER_INFO_DRAFT: { examinations: 1, treatments: 5, includeOwnerName: true },
    }[intent];
    const loaded = await patientContext(context, patientId!, limits);
    if (!loaded) return reply(intent, "Hasta bulunamadı.", null);
    data = loaded.data;
  }

  // 4. Grounded answer, then code-level safety enforcement.
  let answer: string;
  let insufficientData: boolean;
  try {
    const completion = await provider.answerAdvisor({
      channel: request.channel,
      task: definition.task,
      request: request.intent ? `${definition.label}.` : transcript,
      context: data,
      now: new Intl.DateTimeFormat("tr-TR", { dateStyle: "full", timeStyle: "short", timeZone: context.timeZone }).format(new Date()),
      clinicName: access.business.display_name,
    });
    totalTokens += completion.totalTokens;
    ({ answer, insufficient_data: insufficientData } = completion.data);
  } catch (error) {
    throw providerFailure(error);
  }
  const violation = findClinicalSafetyViolation(answer, JSON.stringify(data));
  return finish(
    {
      intent,
      answer: violation ? SAFETY_FALLBACK_ANSWER : answer,
      insufficientData,
      candidates: [],
      safetyFlag: violation,
    },
    patientId,
  );
}

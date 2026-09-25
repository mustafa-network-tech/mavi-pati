import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOwnerSystemPrompt, OWNER_ASSISTANT_POLICY } from "../lib/ai/policy";
import type { AdvisorAnswerInput, AiProvider, OwnerClassificationInput } from "../lib/ai/provider";
import { SAFETY_FALLBACK_ANSWER } from "../lib/ai/safety";
import type { OwnerClassification } from "../lib/ai/schemas";
import { AdvisorError } from "../lib/clinic-ai/shared";
import { groundedMedicationName, isEmergencyText, runOwnerAssistant, validPreferredDate } from "../lib/owner-ai/assistant";
import type { OwnerAccess, OwnerOverview } from "../lib/owner-portal/overview";
import { FakeSupabase } from "./helpers/fake-supabase";

const overview: OwnerOverview = {
  owner: { full_name: "Ayşe Yılmaz" },
  clinic: {
    display_name: "Pati Klinik",
    phone: "0212 555 00 00",
    email: null,
    address: null,
    timezone: "Europe/Istanbul",
    appointments_enabled: true,
    ai_enabled: true,
    ai_voice_enabled: true,
  },
  pets: [
    { id: "p1", name: "Boncuk", species: "CAT", breed: "Tekir", sex: "FEMALE", birth_date: "2022-01-01", birth_date_estimated: false, neuter_status: "NEUTERED", weight_kg: 4 },
    { id: "p2", name: "Karabaş", species: "DOG", breed: null, sex: "MALE", birth_date: null, birth_date_estimated: false, neuter_status: "UNKNOWN", weight_kg: null },
  ],
  vaccinations: [
    { patient_id: "p1", vaccine_name: "Karma", status: "ADMINISTERED", administered_at: "2026-01-10", next_due_at: "2027-01-10" },
    { patient_id: "p2", vaccine_name: "Kuduz", status: "SCHEDULED", administered_at: null, next_due_at: "2026-10-01" },
  ],
  appointments: [],
  requests: [],
};

class FakeOwnerProvider implements AiProvider {
  readonly key = "FAKE";
  readonly model = "fake-model";
  readonly configured = true;
  classifications: OwnerClassificationInput[] = [];
  answers: AdvisorAnswerInput[] = [];
  constructor(
    private readonly classification: Partial<OwnerClassification> & Pick<OwnerClassification, "intent">,
    private readonly answer = "Boncuk'un bir sonraki karma aşısı 10 Ocak 2027'de.",
  ) {}
  async checkConnection() {
    return "CONNECTED" as const;
  }
  async classifyAdvisorRequest(): Promise<never> {
    throw new Error("owners never use the clinic classifier");
  }
  async classifyOwnerRequest(input: OwnerClassificationInput) {
    this.classifications.push(input);
    return {
      data: { pet_name: null, preferred_date: null, preferred_time: null, medication_name: null, ...this.classification },
      totalTokens: 5,
    };
  }
  async answerAdvisor(input: AdvisorAnswerInput) {
    this.answers.push(input);
    return { data: { answer: this.answer, insufficient_data: false }, totalTokens: 20 };
  }
  async transcribe() {
    return "Boncuk için yarın öğleden sonra randevu istiyorum";
  }
}

function access(rpc?: ConstructorParameters<typeof FakeSupabase>[1]) {
  const supabase = new FakeSupabase(
    { ai_conversations: [], ai_messages: [] },
    rpc ?? ((name) => (name === "owner_portal_overview" ? { data: overview, error: null } : { data: 5, error: null })),
  );
  const ownerAccess: OwnerAccess = {
    userId: "owner-user",
    supabase: supabase as unknown as OwnerAccess["supabase"],
    businessId: "b1",
    ownerId: "o1",
  };
  return { supabase, ownerAccess };
}

const text = (value: string) => ({ kind: "text" as const, text: value });

test("owner policy forbids diagnosis, medication advice and final bookings", () => {
  const prompt = buildOwnerSystemPrompt("VOICE");
  for (const rule of OWNER_ASSISTANT_POLICY.forbidden) assert.ok(prompt.includes(rule));
  assert.match(prompt, /Uygulama içi sesli konuşma/);
  assert.ok(isEmergencyText("Köpeğim çikolata yedi, sanırım zehirlendi"));
  assert.ok(isEmergencyText("Kedim nefes alamıyor"));
  assert.ok(!isEmergencyText("Aşı randevusu almak istiyorum"));
  assert.equal(groundedMedicationName("Klorheksidin şampuan", "geçen ay verilen klorheksidin şampuan bitti"), "Klorheksidin şampuan");
  assert.equal(groundedMedicationName("Amoksisilin", "ilacı bitti yenisini istiyorum"), null, "the model cannot name a drug the owner did not say");
  assert.equal(validPreferredDate("2020-01-01", "2026-09-25"), null);
  assert.equal(validPreferredDate("2026-09-26", "2026-09-25"), "2026-09-26");
});

test("emergencies are answered immediately without classification", async () => {
  const provider = new FakeOwnerProvider({ intent: "PET_SUMMARY" });
  const { ownerAccess } = access();
  const result = await runOwnerAssistant({ access: ownerAccess, channel: "TEXT", input: text("Kedim zehirlendi galiba, kusuyor") }, provider);
  assert.equal(result.intent, "EMERGENCY");
  assert.equal(result.emergency, true);
  assert.match(result.answer, /0212 555 00 00/);
  assert.equal(provider.classifications.length, 0);
});

test("appointment and medication requests are drafted from the owner's own words only", async () => {
  const appointment = new FakeOwnerProvider({ intent: "APPOINTMENT_REQUEST", pet_name: "boncuk", preferred_date: "2099-01-01", preferred_time: "öğleden sonra" });
  const { ownerAccess, supabase } = access();
  const drafted = await runOwnerAssistant(
    { access: ownerAccess, channel: "TEXT", input: text("Boncuk için öğleden sonra randevu istiyorum, aşısı var") },
    appointment,
  );
  assert.equal(drafted.draft?.type, "APPOINTMENT");
  assert.equal(drafted.draft?.patientId, "p1");
  assert.equal(drafted.draft?.preferredDate, null, "a date beyond 180 days is dropped");
  assert.equal(drafted.draft?.details, "Boncuk için öğleden sonra randevu istiyorum, aşısı var");
  assert.ok(!supabase.rpcCalls.some((call) => call.name === "submit_owner_request"), "the assistant never submits by itself");

  const inventedDrug = new FakeOwnerProvider({ intent: "MEDICATION_REQUEST", pet_name: "Boncuk", medication_name: "Amoksisilin 250 mg" });
  const asked = await runOwnerAssistant({ access: access().ownerAccess, channel: "TEXT", input: text("Boncuk'un ilacı bitti") }, inventedDrug);
  assert.equal(asked.draft, null);
  assert.match(asked.answer, /hangi ilacın/);

  const refill = new FakeOwnerProvider({ intent: "MEDICATION_REQUEST", pet_name: "Boncuk", medication_name: "Klorheksidin şampuan" });
  const refillResult = await runOwnerAssistant(
    { access: access().ownerAccess, channel: "TEXT", input: text("Boncuk'a verilen klorheksidin şampuan bitti, yenisini istiyorum") },
    refill,
  );
  assert.equal(refillResult.draft?.type, "MEDICATION");
  assert.equal(refillResult.draft?.medicationName, "Klorheksidin şampuan");
  assert.match(refillResult.disclaimer ?? "", /veteriner hekim onayıyla/);

  const ambiguous = new FakeOwnerProvider({ intent: "APPOINTMENT_REQUEST" });
  const which = await runOwnerAssistant({ access: access().ownerAccess, channel: "TEXT", input: text("Randevu almak istiyorum") }, ambiguous);
  assert.equal(which.draft, null);
  assert.deepEqual(which.petChoices.map((pet) => pet.name), ["Boncuk", "Karabaş"]);
});

test("medical advice is refused; pet summaries use the owner policy and the safety guard", async () => {
  const advice = new FakeOwnerProvider({ intent: "OUT_OF_SCOPE" });
  const refused = await runOwnerAssistant({ access: access().ownerAccess, channel: "TEXT", input: text("Kedime hangi ilacı vereyim?") }, advice);
  assert.match(refused.answer, /ilaç veya tedavi önerisi veremem/);
  assert.equal(advice.answers.length, 0);

  const summary = new FakeOwnerProvider({ intent: "PET_SUMMARY", pet_name: "Boncuk" });
  const { ownerAccess, supabase } = access();
  const answered = await runOwnerAssistant({ access: ownerAccess, channel: "TEXT", input: text("Boncuk'un aşıları ne zaman?") }, summary);
  assert.equal(summary.answers[0].audience, "OWNER");
  const context = JSON.stringify(summary.answers[0].context);
  assert.match(context, /Karma/);
  assert.ok(!context.includes("Karabaş") && !context.includes("Kuduz"), "only the asked pet is sent");
  assert.ok(answered.disclaimer);
  assert.deepEqual(
    supabase.tables.ai_messages.map((message) => message.intent),
    ["OWNER_PET_SUMMARY", "OWNER_PET_SUMMARY"],
  );

  const unsafe = new FakeOwnerProvider({ intent: "PET_SUMMARY", pet_name: "Boncuk" }, "Günde 1 tablet verin.");
  const blocked = await runOwnerAssistant({ access: access().ownerAccess, channel: "TEXT", input: text("Boncuk nasıl?") }, unsafe);
  assert.equal(blocked.answer, SAFETY_FALLBACK_ANSWER);
});

test("owner voice uses the same pipeline and limits apply", async () => {
  const provider = new FakeOwnerProvider({ intent: "APPOINTMENT_REQUEST", pet_name: "Boncuk", preferred_time: "öğleden sonra" });
  const { ownerAccess, supabase } = access();
  const result = await runOwnerAssistant(
    { access: ownerAccess, channel: "VOICE", input: { kind: "audio", audio: new Blob(["a"], { type: "audio/webm" }), fileName: "soru.webm" } },
    provider,
  );
  assert.equal(result.draft?.channel, "AI_VOICE");
  assert.deepEqual(supabase.rpcCalls.find((call) => call.name === "consume_ai_quota")?.args, { target_business_id: "b1", is_voice: true });

  const limited = access((name) =>
    name === "owner_portal_overview" ? { data: overview, error: null } : { data: null, error: { message: "Owner daily AI limit reached" } },
  );
  await assert.rejects(
    () => runOwnerAssistant({ access: limited.ownerAccess, channel: "TEXT", input: text("Merhaba") }, provider),
    (error: unknown) => error instanceof AdvisorError && error.status === 429,
  );
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { OpenAiProvider } from "../lib/ai/openai";
import { buildAdvisorSystemPrompt, CLINIC_ADVISOR_POLICY, CLINICAL_DISCLAIMER } from "../lib/ai/policy";
import type { AdvisorAnswerInput, AdvisorClassificationInput, AiProvider } from "../lib/ai/provider";
import { findClinicalSafetyViolation, SAFETY_FALLBACK_ANSWER } from "../lib/ai/safety";
import { advisorAnswerSchema, advisorClassificationSchema, structuredOutputSchema, type AdvisorClassification } from "../lib/ai/schemas";
import { AdvisorError, runClinicAdvisor } from "../lib/clinic-ai/advisor";
import { allowedIntents, isIntentAllowed, OUT_OF_SCOPE_ANSWER } from "../lib/clinic-ai/intents";
import type { BusinessAccess } from "../lib/auth/dal";
import { FakeSupabase } from "./helpers/fake-supabase";

test("one clinic advisor policy drives written and voice conversations", () => {
  const text = buildAdvisorSystemPrompt("TEXT");
  const voice = buildAdvisorSystemPrompt("VOICE");
  for (const rule of [...CLINIC_ADVISOR_POLICY.forbidden, ...CLINIC_ADVISOR_POLICY.dataRules]) {
    assert.ok(text.includes(rule));
    assert.ok(voice.includes(rule));
  }
  assert.match(voice, /Uygulama içi sesli konuşma/);
  assert.match(voice, /Markdown, madde işareti/);
  assert.doesNotMatch(text + voice, /emlak|ilan|WhatsApp|telefon görüşmesi/i);
});

test("safety guard blocks invented doses, prescriptions and definitive diagnoses", () => {
  const records = JSON.stringify({ muayeneler: [{ yapilan_islemler: "Amoksisilin 20 mg/kg uygulandı" }] });
  assert.equal(findClinicalSafetyViolation("Meloksikam 0,1 mg/kg verin.", records), "UNGROUNDED_DOSE");
  assert.equal(findClinicalSafetyViolation("Günde 2 tablet verilmeli.", records), "UNGROUNDED_DOSE");
  assert.equal(findClinicalSafetyViolation("Kayda göre amoksisilin 20 mg/kg uygulanmış.", records), null);
  assert.equal(findClinicalSafetyViolation("Bu kesinlikle böbrek hastalığıdır.", records), "DEFINITIVE_DIAGNOSIS");
  assert.equal(findClinicalSafetyViolation("Kesin teşhis: gastrit.", records), "DEFINITIVE_DIAGNOSIS");
  assert.equal(findClinicalSafetyViolation("Antibiyotik reçete ediyorum.", records), "PRESCRIPTION");
  assert.equal(
    findClinicalSafetyViolation("Boncuk 4,2 kg. Kontrol 3 gün sonra, 12.10.2026 tarihinde. Ateş 39.4 ölçülmüş.", records),
    null,
    "weights, dates, temperatures and day counts are not doses",
  );
});

test("role matrix: staff never reach clinical intents, only admins get the operations summary", () => {
  assert.deepEqual(allowedIntents("CLINIC_STAFF"), ["VACCINATION_SUMMARY", "TODAY_APPOINTMENTS", "UPCOMING_VACCINATIONS"]);
  assert.ok(!isIntentAllowed("OPERATIONS_SUMMARY", "VETERINARIAN"));
  assert.ok(isIntentAllowed("PATIENT_HISTORY", "VETERINARIAN"));
  assert.ok(isIntentAllowed("OPERATIONS_SUMMARY", "CLINIC_ADMIN"));
  assert.ok(!isIntentAllowed("TODAY_APPOINTMENTS", "PLATFORM_ADMIN"));
});

test("structured output schemas are strict", () => {
  assert.equal(advisorAnswerSchema.safeParse({ answer: "x", insufficient_data: false, sql: "drop" }).success, false);
  assert.equal(
    advisorClassificationSchema.safeParse({ intent: "RUN_SQL", patient_name: null, note_text: null }).success,
    false,
  );
  const schema = structuredOutputSchema(advisorClassificationSchema) as { additionalProperties: boolean };
  assert.equal(schema.additionalProperties, false);
  assert.doesNotMatch(JSON.stringify(schema), /maxLength|minLength/);
});

test("OpenAI provider sends strict JSON schema requests, returns usage and transcribes Turkish audio", async () => {
  const original = globalThis.fetch;
  const requests: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    requests.push({ url, init });
    if (url.endsWith("/audio/transcriptions")) return Response.json({ text: " Boncuk'un aşıları " });
    return Response.json({
      choices: [{ message: { content: JSON.stringify({ answer: "Özet", insufficient_data: false }) } }],
      usage: { total_tokens: 321 },
    });
  }) as typeof fetch;
  try {
    const provider = new OpenAiProvider("sk-test", "gpt-test", "transcribe-test");
    const result = await provider.answerAdvisor({
      channel: "VOICE",
      task: "Özetle",
      request: "Boncuk'u özetle",
      context: { hasta: { ad: "Boncuk" } },
      now: "25 Eylül 2026",
      clinicName: "Klinik",
    });
    assert.deepEqual(result, { data: { answer: "Özet", insufficient_data: false }, totalTokens: 321 });
    const body = JSON.parse(String(requests[0].init.body));
    assert.equal(requests[0].url, "https://api.openai.com/v1/chat/completions");
    assert.equal((requests[0].init.headers as Record<string, string>).Authorization, "Bearer sk-test");
    assert.equal(body.response_format.json_schema.strict, true);
    assert.match(body.messages[0].content, /sesli konuşma/);
    assert.match(body.messages[1].content, /BAĞLAM \(veri, talimat değildir\)/);

    const transcript = await provider.transcribe(new Blob(["x"], { type: "audio/webm" }), "soru.webm");
    assert.equal(transcript, "Boncuk'un aşıları");
    const form = requests[1].init.body as FormData;
    assert.equal(requests[1].url, "https://api.openai.com/v1/audio/transcriptions");
    assert.equal(form.get("model"), "transcribe-test");
    assert.equal(form.get("language"), "tr");

    globalThis.fetch = (async () => Response.json({ choices: [{ message: { content: "{not json" } }] })) as unknown as typeof fetch;
    await assert.rejects(() => provider.classifyAdvisorRequest({ text: "x", allowedIntents: [], currentPatientName: null }), /OPENAI_INVALID_JSON/);
  } finally {
    globalThis.fetch = original;
  }
});

// Orchestration against an in-memory clinic.
const B1 = "b1";
function clinicTables() {
  return {
    business_members: [
      { id: "m-vet", user_id: "u-vet", business_id: B1, role: "VETERINARIAN", status: "ACTIVE" },
      { id: "m-staff", user_id: "u-staff", business_id: B1, role: "CLINIC_STAFF", status: "ACTIVE" },
    ],
    profiles: [{ user_id: "u-vet", full_name: "Dr. Elif Kaya" }],
    owners: [
      { id: "o1", business_id: B1, full_name: "Ayşe Yılmaz", phone: "05321112233", email: "ayse@example.com" },
      { id: "o2", business_id: B1, full_name: "Can Demir", phone: "05329998877", email: "can@example.com" },
    ],
    patients: [
      { id: "p1", business_id: B1, owner_id: "o1", name: "Boncuk", species: "CAT", status: "ACTIVE", sex: "FEMALE", neuter_status: "NEUTERED", birth_date: null, birth_date_estimated: false, microchip_number: "900123456789" },
      { id: "p2", business_id: B1, owner_id: "o2", name: "Boncuk", species: "DOG", status: "ACTIVE", sex: "MALE", neuter_status: "UNKNOWN", birth_date: null, birth_date_estimated: false },
      { id: "p3", business_id: B1, owner_id: "o1", name: "Pamuk", species: "CAT", status: "ACTIVE", sex: "MALE", neuter_status: "INTACT", birth_date: "2022-03-01", birth_date_estimated: false },
    ],
    examinations: [
      { business_id: B1, patient_id: "p3", examined_at: "2026-09-20T09:00:00Z", veterinarian_member_id: "m-vet", complaint: "İştahsızlık", findings: "Ateş 39.4", assessment: "Takip", procedures: "Amoksisilin 20 mg/kg uygulandı", follow_up_at: "2026-09-27" },
      { business_id: "b2", patient_id: "p3", examined_at: "2026-09-21T09:00:00Z", veterinarian_member_id: "x", complaint: "BAŞKA-KLİNİK-GİZLİ" },
    ],
    treatments: [],
    vaccinations: [{ business_id: B1, patient_id: "p3", vaccine_name: "Karma", status: "ADMINISTERED", administered_at: "2026-01-10", next_due_at: "2027-01-10" }],
    ai_conversations: [],
    ai_messages: [],
  };
}

class FakeProvider implements AiProvider {
  readonly key = "FAKE";
  readonly model = "fake-model";
  readonly configured = true;
  classifications: AdvisorClassificationInput[] = [];
  answers: AdvisorAnswerInput[] = [];
  transcriptions = 0;
  constructor(
    private readonly classification: AdvisorClassification,
    private readonly answer = "Kayıtlara göre özet.",
  ) {}
  async checkConnection() {
    return "CONNECTED" as const;
  }
  async classifyAdvisorRequest(input: AdvisorClassificationInput) {
    this.classifications.push(input);
    return { data: this.classification, totalTokens: 10 };
  }
  async classifyOwnerRequest(): Promise<never> {
    throw new Error("not used by the clinic advisor");
  }
  async answerAdvisor(input: AdvisorAnswerInput) {
    this.answers.push(input);
    return { data: { answer: this.answer, insufficient_data: false }, totalTokens: 90 };
  }
  async transcribe() {
    this.transcriptions += 1;
    return "Pamuk'un geçmişini özetle";
  }
}

function access(role: string, supabase: FakeSupabase): BusinessAccess {
  return {
    userId: role === "CLINIC_STAFF" ? "u-staff" : "u-vet",
    supabase: supabase as unknown as BusinessAccess["supabase"],
    business: { id: B1, slug: "klinik", display_name: "Klinik", status: "ACTIVE", timezone: "Europe/Istanbul", access_starts_at: null, access_expires_at: null },
    membership: { id: role === "CLINIC_STAFF" ? "m-staff" : "m-vet", role, status: "ACTIVE" },
  };
}

test("advisor answers from the clinic's own minimal records and records the exchange", async () => {
  const supabase = new FakeSupabase(clinicTables());
  const provider = new FakeProvider({ intent: "PATIENT_HISTORY", patient_name: "Pamuk", note_text: null });
  const result = await runClinicAdvisor(
    { access: access("VETERINARIAN", supabase), channel: "TEXT", input: { kind: "text", text: "Pamuk'un geçmişini özetle" } },
    provider,
  );
  assert.equal(result.intent, "PATIENT_HISTORY");
  assert.equal(result.answer, "Kayıtlara göre özet.");
  assert.equal(result.disclaimer, CLINICAL_DISCLAIMER);
  assert.equal(provider.classifications[0].allowedIntents.some((item) => item.key === "OPERATIONS_SUMMARY"), false);

  const context = JSON.stringify(provider.answers[0].context);
  assert.match(context, /İştahsızlık/);
  assert.match(context, /Dr\. Elif Kaya/);
  for (const secret of ["BAŞKA-KLİNİK-GİZLİ", "05321112233", "ayse@example.com", "Ayşe Yılmaz", "900123456789", "p3"])
    assert.ok(!context.includes(secret), `context leaked ${secret}`);
  for (const query of supabase.log.filter((entry) => entry.op === "select" && entry.table !== "profiles"))
    assert.ok(
      query.filters.some(([kind, column, value]) => kind === "eq" && column === "business_id" && value === B1),
      `${query.table} query without business filter`,
    );
  assert.deepEqual(supabase.rpcCalls[0], { name: "consume_ai_quota", args: { target_business_id: B1, is_voice: false } });
  assert.deepEqual(supabase.rpcCalls.at(-1), { name: "record_ai_tokens", args: { target_business_id: B1, token_count: 100 } });
  assert.deepEqual(
    supabase.tables.ai_messages.map((message) => [message.role, message.channel]),
    [["USER", "TEXT"], ["ASSISTANT", "TEXT"]],
  );
});

test("staff cannot pull clinical records through the advisor", async () => {
  const supabase = new FakeSupabase(clinicTables());
  const provider = new FakeProvider({ intent: "PATIENT_HISTORY", patient_name: "Pamuk", note_text: null });
  const result = await runClinicAdvisor(
    { access: access("CLINIC_STAFF", supabase), channel: "TEXT", input: { kind: "text", text: "Pamuk'un muayenelerini özetle" } },
    provider,
  );
  assert.match(result.answer, /rolünüz bu kayıtlara erişemez/);
  assert.equal(provider.answers.length, 0);
  assert.ok(!supabase.log.some((entry) => entry.table === "examinations" || entry.table === "treatments"));
});

test("ambiguous patient names ask for a choice instead of guessing", async () => {
  const supabase = new FakeSupabase(clinicTables());
  const provider = new FakeProvider({ intent: "VACCINATION_SUMMARY", patient_name: "boncuk", note_text: null });
  const result = await runClinicAdvisor(
    { access: access("VETERINARIAN", supabase), channel: "TEXT", input: { kind: "text", text: "Boncuk'un aşıları" } },
    provider,
  );
  assert.deepEqual(result.candidates.map((candidate) => candidate.id).sort(), ["p1", "p2"]);
  assert.equal(result.disclaimer, null);
  assert.equal(provider.answers.length, 0);
});

test("voice uses the same pipeline: server transcription, voice quota and voice channel", async () => {
  const supabase = new FakeSupabase(clinicTables());
  const provider = new FakeProvider({ intent: "PATIENT_HISTORY", patient_name: "Pamuk", note_text: null });
  const result = await runClinicAdvisor(
    {
      access: access("VETERINARIAN", supabase),
      channel: "VOICE",
      input: { kind: "audio", audio: new Blob(["audio"], { type: "audio/webm" }), fileName: "soru.webm" },
    },
    provider,
  );
  assert.equal(provider.transcriptions, 1);
  assert.equal(result.transcript, "Pamuk'un geçmişini özetle");
  assert.equal(provider.answers[0].channel, "VOICE");
  assert.deepEqual(supabase.rpcCalls[0].args, { target_business_id: B1, is_voice: true });
  assert.equal(supabase.tables.ai_messages[0].channel, "VOICE");
});

test("unsafe model output is replaced; quota, scope and explicit note actions are enforced in code", async () => {
  const unsafe = new FakeProvider({ intent: "RECENT_EXAMINATIONS", patient_name: null, note_text: null }, "Meloksikam 0,2 mg/kg verin.");
  const supabase = new FakeSupabase(clinicTables());
  const result = await runClinicAdvisor(
    { access: access("VETERINARIAN", supabase), channel: "TEXT", input: { kind: "text", text: "Son muayeneler" }, patientId: "p3" },
    unsafe,
  );
  assert.equal(result.answer, SAFETY_FALLBACK_ANSWER);
  assert.equal(result.safetyFlag, "UNGROUNDED_DOSE");
  assert.equal(supabase.tables.ai_messages[1].safety_flag, "UNGROUNDED_DOSE");

  const grounded = new FakeProvider({ intent: "RECENT_EXAMINATIONS", patient_name: null, note_text: null }, "Amoksisilin 20 mg/kg uygulanmış.");
  const groundedResult = await runClinicAdvisor(
    { access: access("VETERINARIAN", new FakeSupabase(clinicTables())), channel: "TEXT", input: { kind: "text", text: "Son muayeneler" }, patientId: "p3" },
    grounded,
  );
  assert.equal(groundedResult.safetyFlag, null, "a dose copied from the record may be restated");

  const outOfScope = new FakeProvider({ intent: "OUT_OF_SCOPE", patient_name: null, note_text: null });
  const refused = await runClinicAdvisor(
    { access: access("VETERINARIAN", new FakeSupabase(clinicTables())), channel: "TEXT", input: { kind: "text", text: "Hangi antibiyotiği vereyim?" } },
    outOfScope,
  );
  assert.equal(refused.answer, OUT_OF_SCOPE_ANSWER);
  assert.equal(outOfScope.answers.length, 0);

  const note = new FakeProvider({ intent: "OUT_OF_SCOPE", patient_name: null, note_text: null });
  await runClinicAdvisor(
    {
      access: access("VETERINARIAN", new FakeSupabase(clinicTables())),
      channel: "TEXT",
      input: { kind: "text", text: "istahsiz 2 gundur, ates var. kontrol 1 hafta sonra" },
      intent: "NOTE_CLEANUP",
    },
    note,
  );
  assert.equal(note.classifications.length, 0, "explicit actions skip classification");
  assert.deepEqual(note.answers[0].context, { not: "istahsiz 2 gundur, ates var. kontrol 1 hafta sonra" });

  const exhausted = new FakeSupabase(clinicTables(), () => ({ data: null, error: { message: "AI quota exceeded" } }));
  const idle = new FakeProvider({ intent: "TODAY_APPOINTMENTS", patient_name: null, note_text: null });
  await assert.rejects(
    () => runClinicAdvisor({ access: access("VETERINARIAN", exhausted), channel: "TEXT", input: { kind: "text", text: "Bugün?" } }, idle),
    (error: unknown) => error instanceof AdvisorError && error.status === 429,
  );
  assert.equal(idle.classifications.length, 0, "no model call without quota");
});

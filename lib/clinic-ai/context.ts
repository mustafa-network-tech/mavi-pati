import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ageLabel,
  appointmentStatusLabels,
  label,
  neuterLabels,
  sexLabels,
  speciesLabels,
  vaccinationStatusLabels,
} from "@/lib/clinic/labels";
import { isClinicalRole } from "@/lib/clinic/roles";
import { addDays, localDateString, zonedDayRange } from "@/lib/time";

// Every query runs with the signed-in user's RLS-bound client AND an explicit
// business filter. Only the minimum fields a task needs are sent to the model:
// no phone numbers, e-mails, addresses, microchip numbers or record ids.
export type AdvisorDataContext = {
  supabase: SupabaseClient;
  businessId: string;
  timeZone: string;
  role: string;
};

const clip = (value: string | null | undefined, maximum = 1200) =>
  !value ? null : value.length > maximum ? `${value.slice(0, maximum)}…` : value;

const localDateTime = (value: string, timeZone: string) =>
  new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(value));

async function practitionerNames(context: AdvisorDataContext) {
  const { data: members } = await context.supabase
    .from("business_members")
    .select("id,user_id")
    .eq("business_id", context.businessId);
  const userIds = (members ?? []).map((member) => member.user_id);
  const { data: profiles } = userIds.length
    ? await context.supabase.from("profiles").select("user_id,full_name").in("user_id", userIds)
    : { data: [] };
  const names = new Map((profiles ?? []).map((profile) => [profile.user_id, profile.full_name as string]));
  return new Map((members ?? []).map((member) => [member.id as string, names.get(member.user_id) ?? "Veteriner hekim"]));
}

export type PatientCandidate = { id: string; name: string; species: string; ownerName: string | null };

export async function findPatientsByName(context: AdvisorDataContext, name: string): Promise<PatientCandidate[]> {
  const escaped = name.trim().replace(/[\\%_]/g, (character) => `\\${character}`);
  const search = async (pattern: string) =>
    (
      await context.supabase
        .from("patients")
        .select("id,name,species,owner_id")
        .eq("business_id", context.businessId)
        .neq("status", "ARCHIVED")
        .ilike("name", pattern)
        .order("updated_at", { ascending: false })
        .limit(5)
    ).data ?? [];
  let patients = await search(escaped);
  if (!patients.length) patients = await search(`%${escaped}%`);
  const ownerIds = [...new Set(patients.map((patient) => patient.owner_id as string))];
  const { data: owners } = ownerIds.length
    ? await context.supabase.from("owners").select("id,full_name").eq("business_id", context.businessId).in("id", ownerIds)
    : { data: [] };
  const ownerNames = new Map((owners ?? []).map((owner) => [owner.id as string, owner.full_name as string]));
  return patients.map((patient) => ({
    id: patient.id,
    name: patient.name,
    species: label(speciesLabels, patient.species),
    ownerName: ownerNames.get(patient.owner_id) ?? null,
  }));
}

export async function loadPatientSummary(context: AdvisorDataContext, patientId: string) {
  const { data } = await context.supabase
    .from("patients")
    .select("id,name,species,breed,sex,birth_date,birth_date_estimated,color,weight_kg,neuter_status,status,notes,owner_id")
    .eq("business_id", context.businessId)
    .eq("id", patientId)
    .maybeSingle();
  return data;
}

export async function patientContext(
  context: AdvisorDataContext,
  patientId: string,
  options: { examinations: number; treatments: number; includeOwnerName?: boolean },
) {
  const patient = await loadPatientSummary(context, patientId);
  if (!patient) return null;
  const clinical = isClinicalRole(context.role);
  const [names, examinations, treatments, vaccinations, owner] = await Promise.all([
    practitionerNames(context),
    clinical && options.examinations
      ? context.supabase
          .from("examinations")
          .select("examined_at,veterinarian_member_id,complaint,anamnesis,findings,assessment,procedures,follow_up_at,extra_notes")
          .eq("business_id", context.businessId)
          .eq("patient_id", patientId)
          .order("examined_at", { ascending: false })
          .limit(options.examinations)
      : Promise.resolve({ data: null }),
    clinical && options.treatments
      ? context.supabase
          .from("treatments")
          .select("performed_at,procedure_name,veterinarian_member_id,description,clinical_note")
          .eq("business_id", context.businessId)
          .eq("patient_id", patientId)
          .order("performed_at", { ascending: false })
          .limit(options.treatments)
      : Promise.resolve({ data: null }),
    context.supabase
      .from("vaccinations")
      .select("vaccine_name,status,administered_at,next_due_at")
      .eq("business_id", context.businessId)
      .eq("patient_id", patientId)
      .order("administered_at", { ascending: false, nullsFirst: false })
      .limit(30),
    options.includeOwnerName
      ? context.supabase.from("owners").select("full_name").eq("business_id", context.businessId).eq("id", patient.owner_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return {
    patientName: patient.name as string,
    data: {
      hasta: {
        ad: patient.name,
        tur: label(speciesLabels, patient.species),
        irk: patient.breed,
        cinsiyet: label(sexLabels, patient.sex),
        yas: ageLabel(patient.birth_date, patient.birth_date_estimated),
        renk: patient.color,
        kilo_kg: patient.weight_kg,
        kisirlastirma: label(neuterLabels, patient.neuter_status),
        durum: patient.status,
        notlar: clip(patient.notes, 500),
      },
      ...(owner?.data ? { sahip_adi: owner.data.full_name } : {}),
      muayeneler: clinical
        ? (examinations.data ?? []).map((exam) => ({
            tarih: localDateTime(exam.examined_at, context.timeZone),
            veteriner: names.get(exam.veterinarian_member_id) ?? "Veteriner hekim",
            basvuru_nedeni: clip(exam.complaint, 500),
            anamnez: clip(exam.anamnesis),
            bulgular: clip(exam.findings),
            veteriner_degerlendirmesi: clip(exam.assessment),
            yapilan_islemler: clip(exam.procedures),
            kontrol_tarihi: exam.follow_up_at,
            ek_notlar: clip(exam.extra_notes, 600),
          }))
        : "Rolünüz muayene kayıtlarına erişemez.",
      tedavi_islemler: clinical
        ? (treatments.data ?? []).map((treatment) => ({
            tarih: localDateTime(treatment.performed_at, context.timeZone),
            islem: treatment.procedure_name,
            veteriner: names.get(treatment.veterinarian_member_id) ?? "Veteriner hekim",
            aciklama: clip(treatment.description, 600),
            klinik_not: clip(treatment.clinical_note, 600),
          }))
        : "Rolünüz tedavi kayıtlarına erişemez.",
      asilar: (vaccinations.data ?? []).map((vaccination) => ({
        asi: vaccination.vaccine_name,
        durum: label(vaccinationStatusLabels, vaccination.status),
        uygulama_tarihi: vaccination.administered_at,
        sonraki_tarih: vaccination.next_due_at,
      })),
    },
  };
}

export async function todayAppointmentsContext(context: AdvisorDataContext) {
  const today = localDateString(context.timeZone);
  const { start, end } = zonedDayRange(today, context.timeZone);
  const [names, { data: appointments }] = await Promise.all([
    practitionerNames(context),
    context.supabase
      .from("appointments")
      .select("starts_at,ends_at,status,reason,veterinarian_member_id,patient_id")
      .eq("business_id", context.businessId)
      .gte("starts_at", start)
      .lt("starts_at", end)
      .order("starts_at")
      .limit(150),
  ]);
  const patients = await patientLabels(context, (appointments ?? []).map((item) => item.patient_id));
  return {
    tarih: today,
    randevular: (appointments ?? []).map((appointment) => ({
      saat: new Intl.DateTimeFormat("tr-TR", { timeStyle: "short", timeZone: context.timeZone }).format(new Date(appointment.starts_at)),
      hasta: patients.get(appointment.patient_id) ?? "Hasta",
      veteriner: appointment.veterinarian_member_id ? names.get(appointment.veterinarian_member_id) ?? "Veteriner hekim" : "Atanmadı",
      durum: label(appointmentStatusLabels, appointment.status),
      aciklama: clip(appointment.reason, 200),
    })),
  };
}

async function patientLabels(context: AdvisorDataContext, ids: string[]) {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map<string, string>();
  const { data } = await context.supabase
    .from("patients")
    .select("id,name,species")
    .eq("business_id", context.businessId)
    .in("id", unique);
  return new Map((data ?? []).map((patient) => [patient.id as string, `${patient.name} (${label(speciesLabels, patient.species)})`]));
}

export async function upcomingVaccinationsContext(context: AdvisorDataContext) {
  const today = localDateString(context.timeZone);
  const { data } = await context.supabase
    .from("vaccinations")
    .select("vaccine_name,next_due_at,patient_id,status")
    .eq("business_id", context.businessId)
    .in("status", ["SCHEDULED", "ADMINISTERED"])
    .gte("next_due_at", addDays(today, -90))
    .lte("next_due_at", addDays(today, 30))
    .order("next_due_at")
    .limit(150);
  const patients = await patientLabels(context, (data ?? []).map((item) => item.patient_id));
  const rows = (data ?? []).map((vaccination) => ({
    hasta: patients.get(vaccination.patient_id) ?? "Hasta",
    asi: vaccination.vaccine_name,
    tarih: vaccination.next_due_at,
  }));
  return {
    bugun: today,
    gecikmis: rows.filter((row) => row.tarih < today),
    yaklasan_30_gun: rows.filter((row) => row.tarih >= today),
  };
}

export async function upcomingFollowUpsContext(context: AdvisorDataContext) {
  const today = localDateString(context.timeZone);
  const [names, { data }] = await Promise.all([
    practitionerNames(context),
    context.supabase
      .from("examinations")
      .select("follow_up_at,complaint,veterinarian_member_id,patient_id")
      .eq("business_id", context.businessId)
      .gte("follow_up_at", today)
      .lte("follow_up_at", addDays(today, 14))
      .order("follow_up_at")
      .limit(150),
  ]);
  const patients = await patientLabels(context, (data ?? []).map((item) => item.patient_id));
  return {
    bugun: today,
    kontroller: (data ?? []).map((exam) => ({
      tarih: exam.follow_up_at,
      hasta: patients.get(exam.patient_id) ?? "Hasta",
      basvuru_nedeni: clip(exam.complaint, 200),
      veteriner: names.get(exam.veterinarian_member_id) ?? "Veteriner hekim",
    })),
  };
}

// Aggregates only: the operations summary never needs individual clinical content.
export async function operationsContext(context: AdvisorDataContext) {
  const today = localDateString(context.timeZone);
  const day = zonedDayRange(today, context.timeZone);
  const weekEnd = zonedDayRange(addDays(today, 6), context.timeZone).end;
  const weekAgo = zonedDayRange(addDays(today, -7), context.timeZone).start;
  const headCount = (table: string) =>
    context.supabase.from(table).select("id", { count: "exact", head: true }).eq("business_id", context.businessId);
  const total = async (query: PromiseLike<{ count: number | null }>) => (await query).count ?? 0;
  const [names, { data: weekAppointments }, newPatients, examinations, treatments, dueSoon, overdue] = await Promise.all([
    practitionerNames(context),
    context.supabase
      .from("appointments")
      .select("starts_at,status,veterinarian_member_id")
      .eq("business_id", context.businessId)
      .gte("starts_at", day.start)
      .lt("starts_at", weekEnd)
      .limit(2000),
    total(headCount("patients").gte("created_at", weekAgo)),
    total(headCount("examinations").gte("examined_at", weekAgo)),
    total(headCount("treatments").gte("performed_at", weekAgo)),
    total(
      headCount("vaccinations").in("status", ["SCHEDULED", "ADMINISTERED"]).gte("next_due_at", today).lte("next_due_at", addDays(today, 7)),
    ),
    total(
      headCount("vaccinations").in("status", ["SCHEDULED", "ADMINISTERED"]).lt("next_due_at", today).gte("next_due_at", addDays(today, -90)),
    ),
  ]);
  const todays = (weekAppointments ?? []).filter((item) => item.starts_at < day.end);
  const byStatus = (items: typeof todays) =>
    Object.fromEntries(
      Object.entries(
        items.reduce<Record<string, number>>((totals, item) => {
          const key = label(appointmentStatusLabels, item.status);
          totals[key] = (totals[key] ?? 0) + 1;
          return totals;
        }, {}),
      ),
    );
  const byVet = (weekAppointments ?? []).reduce<Record<string, number>>((totals, item) => {
    const key = item.veterinarian_member_id ? names.get(item.veterinarian_member_id) ?? "Veteriner hekim" : "Atanmadı";
    totals[key] = (totals[key] ?? 0) + 1;
    return totals;
  }, {});
  return {
    bugun: today,
    bugunku_randevular: { toplam: todays.length, durumlar: byStatus(todays) },
    onumuzdeki_7_gun_randevular: { toplam: weekAppointments?.length ?? 0, veteriner_dagilimi: byVet },
    son_7_gun: { yeni_hasta: newPatients, muayene: examinations, tedavi_islem: treatments },
    asilar: { onumuzdeki_7_gun: dueSoon, gecikmis: overdue },
  };
}

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type OwnerPet = {
  id: string;
  name: string;
  species: string;
  breed: string | null;
  sex: string;
  birth_date: string | null;
  birth_date_estimated: boolean;
  neuter_status: string;
  weight_kg: number | null;
};
export type OwnerVaccination = {
  patient_id: string;
  vaccine_name: string;
  status: string;
  administered_at: string | null;
  next_due_at: string | null;
};
export type OwnerAppointment = { id: string; patient_id: string; starts_at: string; ends_at: string; status: string; reason: string };
export type OwnerRequest = {
  id: string;
  patient_id: string;
  request_type: "APPOINTMENT" | "MEDICATION";
  status: string;
  details: string;
  preferred_date: string | null;
  preferred_time: string | null;
  medication_name: string | null;
  clinic_response: string | null;
  created_at: string;
  appointment_id: string | null;
};
export type OwnerOverview = {
  owner: { full_name: string };
  clinic: {
    display_name: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    timezone: string;
    appointments_enabled: boolean;
    ai_enabled: boolean;
    ai_voice_enabled: boolean;
  };
  pets: OwnerPet[];
  vaccinations: OwnerVaccination[];
  appointments: OwnerAppointment[];
  requests: OwnerRequest[];
};

export type OwnerAccess = {
  userId: string;
  supabase: SupabaseClient;
  businessId: string;
  ownerId: string;
};

// Owner-safe data only, assembled by the database (no direct table access for owners).
export async function loadOwnerOverview(access: OwnerAccess) {
  const { data, error } = await access.supabase.rpc("owner_portal_overview", { target_business_id: access.businessId });
  if (error || !data) return null;
  return data as OwnerOverview;
}

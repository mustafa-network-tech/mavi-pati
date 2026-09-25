export const speciesLabels: Record<string, string> = {
  DOG: "Köpek",
  CAT: "Kedi",
  BIRD: "Kuş",
  RABBIT: "Tavşan",
  RODENT: "Kemirgen",
  REPTILE: "Sürüngen",
  HORSE: "At",
  CATTLE: "Büyükbaş",
  OTHER: "Diğer",
};

export const sexLabels: Record<string, string> = {
  MALE: "Erkek",
  FEMALE: "Dişi",
  UNKNOWN: "Belirtilmedi",
};

export const neuterLabels: Record<string, string> = {
  NEUTERED: "Kısırlaştırılmış",
  INTACT: "Kısırlaştırılmamış",
  UNKNOWN: "Bilinmiyor",
};

export const patientStatusLabels: Record<string, string> = {
  ACTIVE: "Aktif",
  DECEASED: "Vefat etti",
  ARCHIVED: "Arşivlendi",
};

export const appointmentStatusLabels: Record<string, string> = {
  SCHEDULED: "Planlandı",
  CONFIRMED: "Onaylandı",
  CHECKED_IN: "Klinikte",
  COMPLETED: "Tamamlandı",
  CANCELED: "İptal",
  NO_SHOW: "Gelmedi",
};

export const openAppointmentStatuses = ["SCHEDULED", "CONFIRMED", "CHECKED_IN"];

export const appointmentTransitions: Record<string, string[]> = {
  SCHEDULED: ["CONFIRMED", "CHECKED_IN", "CANCELED", "NO_SHOW"],
  CONFIRMED: ["CHECKED_IN", "CANCELED", "NO_SHOW"],
  CHECKED_IN: ["COMPLETED", "CANCELED"],
};

export const vaccinationStatusLabels: Record<string, string> = {
  SCHEDULED: "Planlandı",
  ADMINISTERED: "Uygulandı",
  CANCELED: "İptal",
};

export const activityLabels: Record<string, string> = {
  OWNER_CREATED: "Hayvan sahibi kaydedildi",
  OWNER_UPDATED: "Hayvan sahibi güncellendi",
  PATIENT_CREATED: "Hasta kaydedildi",
  PATIENT_UPDATED: "Hasta bilgileri güncellendi",
  PATIENT_DECEASED: "Hasta vefat olarak işaretlendi",
  PATIENT_ARCHIVED: "Hasta arşivlendi",
  PATIENT_ACTIVE: "Hasta yeniden aktif",
  EXAMINATION_CREATED: "Muayene kaydedildi",
  EXAMINATION_UPDATED: "Muayene güncellendi",
  TREATMENT_CREATED: "Tedavi / işlem kaydedildi",
  TREATMENT_UPDATED: "Tedavi / işlem güncellendi",
  VACCINATION_CREATED: "Aşı kaydedildi",
  VACCINATION_UPDATED: "Aşı güncellendi",
  VACCINATION_ADMINISTERED: "Aşı uygulandı",
  VACCINATION_CANCELED: "Aşı iptal edildi",
  VACCINATION_SCHEDULED: "Aşı planlandı",
  APPOINTMENT_CREATED: "Randevu oluşturuldu",
  APPOINTMENT_UPDATED: "Randevu güncellendi",
  APPOINTMENT_CONFIRMED: "Randevu onaylandı",
  APPOINTMENT_CHECKED_IN: "Hasta kliniğe geldi",
  APPOINTMENT_COMPLETED: "Randevu tamamlandı",
  APPOINTMENT_CANCELED: "Randevu iptal edildi",
  APPOINTMENT_NO_SHOW: "Randevuya gelinmedi",
  APPOINTMENT_SCHEDULED: "Randevu yeniden planlandı",
};

export function label(map: Record<string, string>, value: string | null | undefined) {
  if (!value) return "—";
  return map[value] ?? value;
}

export function ageLabel(birthDate: string | null, estimated: boolean, now = new Date()) {
  if (!birthDate) return "—";
  const born = new Date(`${birthDate}T00:00:00Z`);
  let months =
    (now.getUTCFullYear() - born.getUTCFullYear()) * 12 + (now.getUTCMonth() - born.getUTCMonth());
  if (now.getUTCDate() < born.getUTCDate()) months -= 1;
  if (months < 0) return "—";
  const text =
    months < 12 ? `${months} ay` : months % 12 ? `${Math.floor(months / 12)} yıl ${months % 12} ay` : `${months / 12} yıl`;
  return estimated ? `~${text}` : text;
}

export function formatDate(value: string | null | undefined, timeZone?: string) {
  if (!value) return "—";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeZone: timeZone ?? "UTC" }).format(date);
}

export function formatDateTime(value: string | null | undefined, timeZone: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone }).format(
    new Date(value),
  );
}

export function formatTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("tr-TR", { timeStyle: "short", timeZone }).format(new Date(value));
}

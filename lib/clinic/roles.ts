// Shared by server and client code; mirrors business_members.role in the database.
export const memberRoles = ["CLINIC_ADMIN", "VETERINARIAN", "CLINIC_STAFF"] as const;
export type MemberRole = (typeof memberRoles)[number];

export const roleLabels: Record<MemberRole, string> = {
  CLINIC_ADMIN: "Klinik Yöneticisi",
  VETERINARIAN: "Veteriner Hekim",
  CLINIC_STAFF: "Klinik Personeli",
};

export const memberStatusLabels: Record<string, string> = {
  PENDING: "Onay bekliyor",
  ACTIVE: "Aktif",
  SUSPENDED: "Pasif",
  REVOKED: "Kaldırıldı",
};

export function roleLabel(role: string) {
  return roleLabels[role as MemberRole] ?? role;
}

// Examinations and treatments: RLS hides them from CLINIC_STAFF; the UI follows the same rule.
export function isClinicalRole(role: string) {
  return role === "CLINIC_ADMIN" || role === "VETERINARIAN";
}

export function isClinicAdmin(membership: { role: string; status: string }) {
  return membership.role === "CLINIC_ADMIN" && membership.status === "ACTIVE";
}

export type BusinessStatus =
  "PENDING" | "TRIAL" | "ACTIVE" | "SUSPENDED" | "EXPIRED" | "REJECTED";

export type BusinessRole = "OFFICE_ADMIN" | "ADVISOR";

export type MembershipStatus = "PENDING" | "ACTIVE" | "SUSPENDED" | "REVOKED";

export type BusinessSummary = {
  id: string;
  slug: string;
  display_name: string;
  status: BusinessStatus;
  access_starts_at: string | null;
  access_expires_at: string | null;
};

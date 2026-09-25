"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireBusinessAccess } from "@/lib/auth/dal";
import { isClinicAdmin } from "@/lib/clinic/roles";

export type TeamActionState = {
  error?: string;
};

const reviewSchema = z.object({
  memberId: z.string().uuid(),
  decision: z.enum(["approve", "reject", "suspend", "activate", "remove"]),
});

export async function reviewMemberAction(
  businessSlug: string,
  _previous: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const parsed = reviewSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: "İstek bilgisi geçersiz." };

  const { supabase, membership } = await requireBusinessAccess(businessSlug);
  if (!isClinicAdmin(membership)) return { error: "Bu işlem için klinik yöneticisi olmalısınız." };

  const { memberId, decision } = parsed.data;
  const { error } =
    decision === "approve" || decision === "reject"
      ? await supabase.rpc("review_member_request", { target_member_id: memberId, approve: decision === "approve" })
      : await supabase.rpc("update_member_status", {
          target_member_id: memberId,
          next_status: decision === "suspend" ? "SUSPENDED" : decision === "activate" ? "ACTIVE" : "REVOKED",
        });
  if (error) {
    if (error.message?.includes("Seat limit reached"))
      return { error: "Bu rol için kullanıcı kotası dolu. Limit artışı için Platform Admin ile görüşün." };
    if (error.message?.includes("Business is not operational"))
      return { error: "Klinik aktif olmadığı için kullanıcı onaylanamaz." };
    return { error: "İstek işlenemedi. Sayfayı yenileyip tekrar deneyin." };
  }
  revalidatePath(`/app/${businessSlug}/settings`);
  return {};
}

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireBusinessAccess } from "@/lib/auth/dal";

export type TeamActionState = {
  error?: string;
};

const reviewSchema = z.object({
  memberId: z.string().uuid(),
  decision: z.enum(["approve", "reject"]),
});

export async function reviewAdvisorRequestAction(
  businessSlug: string,
  _previous: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const parsed = reviewSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: "İstek bilgisi geçersiz." };

  const { supabase, membership } = await requireBusinessAccess(businessSlug);
  if (membership.role !== "OFFICE_ADMIN" || membership.status !== "ACTIVE")
    return { error: "Bu işlem için ofis yöneticisi olmalısınız." };

  const { error } = await supabase.rpc("review_advisor_request", {
    target_member_id: parsed.data.memberId,
    approve: parsed.data.decision === "approve",
  });
  if (error) {
    if (error.message?.includes("Advisor limit reached"))
      return { error: "Danışman kotası dolu. Limit artışı için Platform Admin ile görüşün." };
    if (error.message?.includes("Business is not operational"))
      return { error: "Ofis aktif olmadığı için danışman onaylanamaz." };
    return { error: "İstek işlenemedi. Sayfayı yenileyip tekrar deneyin." };
  }
  revalidatePath(`/app/${businessSlug}/settings`);
  return {};
}

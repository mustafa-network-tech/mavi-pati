"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireBusinessAccess } from "@/lib/auth/dal";
import {
  analyzeListing,
  draftInitialMessage,
  OutreachError,
  sendInitialMessage,
} from "@/lib/outreach/service";

export type OutreachActionState = {
  error?: string;
  success?: string;
  launchUrl?: string;
};

const id = z.string().uuid();

async function run(
  businessSlug: string,
  listingId: string,
  task: (access: Awaited<ReturnType<typeof requireBusinessAccess>>, listingId: string) => Promise<OutreachActionState>,
): Promise<OutreachActionState> {
  const parsedId = id.safeParse(listingId);
  if (!parsedId.success) return { error: "İlan bilgisi geçersiz." };
  const access = await requireBusinessAccess(businessSlug);
  try {
    const result = await task(access, parsedId.data);
    revalidatePath(`/app/${businessSlug}/listings/${parsedId.data}`);
    return result;
  } catch (error) {
    if (error instanceof OutreachError) return { error: error.message };
    throw error;
  }
}

export async function analyzeListingAction(businessSlug: string, listingId: string): Promise<OutreachActionState> {
  return run(businessSlug, listingId, async (access, target) => {
    await analyzeListing(access, target);
    return { success: "İlan analizi tamamlandı." };
  });
}

export async function draftInitialMessageAction(
  businessSlug: string,
  listingId: string,
): Promise<OutreachActionState> {
  return run(businessSlug, listingId, async (access, target) => {
    await draftInitialMessage(access, target);
    return { success: "İlk mesaj taslağı oluşturuldu. Göndermeden önce kontrol edin." };
  });
}

export async function sendInitialMessageAction(
  businessSlug: string,
  listingId: string,
  _previous: OutreachActionState,
  formData: FormData,
): Promise<OutreachActionState> {
  const mode = formData.get("mode") === "MANUAL" ? "MANUAL" : "API";
  const message = z.string().max(1000).catch("").parse(formData.get("message"));
  return run(businessSlug, listingId, async (access, target) => {
    const result = await sendInitialMessage(access, target, message, mode);
    return { success: result.notice, launchUrl: result.launchUrl };
  });
}

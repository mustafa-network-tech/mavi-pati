import "server-only";

import { getAiProvider } from "@/lib/ai/provider";
import { listingAnalysisSchema } from "@/lib/ai/schemas";
import { findPolicyViolation } from "@/lib/ai/safety";
import type { requireBusinessAccess } from "@/lib/auth/dal";
import { ManualWhatsAppProvider } from "@/lib/providers/whatsapp";
import {
  getWhatsAppBusinessProvider,
  OUTSIDE_SERVICE_WINDOW,
  WhatsAppSendError,
} from "@/lib/providers/whatsapp-cloud";
import { database } from "@/lib/supabase/server";

type Access = Awaited<ReturnType<typeof requireBusinessAccess>>;

export class OutreachError extends Error {}

const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;
const ANALYSIS_COOLDOWN_MS = 60 * 1000;
const MAX_AI_ACTIONS_PER_BUSINESS_HOUR = 100;

function isOperational(business: Access["business"]) {
  const now = Date.now();
  return (
    ["TRIAL", "ACTIVE"].includes(business.status) &&
    (!business.access_starts_at || Date.parse(business.access_starts_at) <= now) &&
    (!business.access_expires_at || Date.parse(business.access_expires_at) > now)
  );
}

// Tenant and assignment checks run through the user's own RLS session;
// every later write uses the business_id read here, never one from the client.
async function authorizeListing(access: Access, listingId: string) {
  if (access.membership.status !== "ACTIVE" || !isOperational(access.business))
    throw new OutreachError("Ofis veya üyelik aktif değil.");
  const { data: listing } = await access.supabase
    .from("listings")
    .select(
      "id,business_id,assigned_member_id,owner_lead_id,title,description,property_type,transaction_type,price,currency,city,district,neighborhood,room_count,gross_area,net_area",
    )
    .eq("id", listingId)
    .eq("business_id", access.business.id)
    .maybeSingle();
  if (!listing) throw new OutreachError("İlan bulunamadı.");
  if (access.membership.role !== "OFFICE_ADMIN" && listing.assigned_member_id !== access.membership.id)
    throw new OutreachError("Bu ilan için yetkiniz yok.");
  return listing;
}

async function entitlements(access: Access) {
  const { data } = await access.supabase
    .from("business_entitlements")
    .select("whatsapp_enabled,ai_analysis_enabled")
    .eq("business_id", access.business.id)
    .maybeSingle();
  return { whatsapp: !!data?.whatsapp_enabled, ai: !!data?.ai_analysis_enabled };
}

async function requireAi(access: Access) {
  if (!(await entitlements(access)).ai)
    throw new OutreachError("AI modülü bu ofis için açık değil (Platform Admin).");
  const ai = await getAiProvider();
  if (!ai.configured) throw new OutreachError("AI sağlayıcısı yapılandırılmadı (OPENAI_API_KEY / OPENAI_MODEL).");
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await database(true)
    .from("activity_logs")
    .select("id", { count: "exact", head: true })
    .eq("business_id", access.business.id)
    .in("action", ["AI_LISTING_ANALYZED", "AI_INITIAL_MESSAGE_DRAFTED"])
    .gte("created_at", since);
  if ((count ?? 0) >= MAX_AI_ACTIONS_PER_BUSINESS_HOUR)
    throw new OutreachError("Saatlik AI işlem sınırına ulaşıldı. Biraz sonra tekrar deneyin.");
  return ai;
}

async function logListingActivity(
  access: Access,
  listingId: string,
  action: string,
  metadata: Record<string, unknown> = {},
) {
  await database(true).from("activity_logs").insert({
    business_id: access.business.id,
    listing_id: listingId,
    actor_type: "USER",
    actor_user_id: access.userId,
    action,
    metadata,
  });
}

export async function analyzeListing(access: Access, listingId: string) {
  const listing = await authorizeListing(access, listingId);
  const ai = await requireAi(access);
  const db = database(true);

  const { data: current } = await db
    .from("listing_ai_analysis")
    .select("status,updated_at")
    .eq("listing_id", listing.id)
    .maybeSingle();
  if (current?.status === "PENDING" && Date.now() - Date.parse(current.updated_at) < ANALYSIS_COOLDOWN_MS)
    throw new OutreachError("Analiz zaten sürüyor.");

  await db.from("listing_ai_analysis").upsert(
    { business_id: listing.business_id, listing_id: listing.id, status: "PENDING", error_code: null },
    { onConflict: "listing_id" },
  );
  try {
    const analysis = await ai.analyzeListing({
      title: listing.title,
      description: listing.description,
      propertyType: listing.property_type,
      transactionType: listing.transaction_type,
      price: listing.price === null ? null : Number(listing.price),
      currency: listing.currency,
      city: listing.city,
      district: listing.district,
      neighborhood: listing.neighborhood,
      roomCount: listing.room_count,
      grossArea: listing.gross_area === null ? null : Number(listing.gross_area),
      netArea: listing.net_area === null ? null : Number(listing.net_area),
    });
    await db
      .from("listing_ai_analysis")
      .update({ status: "COMPLETED", analysis_json: analysis, summary: analysis.summary, model: ai.model })
      .eq("listing_id", listing.id);
    await logListingActivity(access, listing.id, "AI_LISTING_ANALYZED", { model: ai.model });
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : "ANALYSIS_FAILED";
    await db.from("listing_ai_analysis").update({ status: "FAILED", error_code: code }).eq("listing_id", listing.id);
    throw new OutreachError(`AI analizi başarısız oldu (${code}).`);
  }
}

async function loadOwner(access: Access, ownerLeadId: string | null) {
  if (!ownerLeadId) throw new OutreachError("İlanda ilan sahibi bilgisi yok.");
  const { data: owner } = await access.supabase
    .from("leads")
    .select("id,name,phone_normalized,do_not_contact")
    .eq("id", ownerLeadId)
    .eq("business_id", access.business.id)
    .maybeSingle();
  if (!owner) throw new OutreachError("İlan sahibi kaydına erişilemiyor.");
  if (owner.do_not_contact) throw new OutreachError("İlan sahibi iletişim istemediğini belirtti (do_not_contact).");
  if (!owner.phone_normalized) throw new OutreachError("İlan sahibinin telefon numarası yok.");
  return owner;
}

async function openConversation(access: Access, listing: { id: string; business_id: string; assigned_member_id: string | null }, leadId: string) {
  const db = database(true);
  const { data: existing } = await db
    .from("conversations")
    .select("id,business_id,provider,status,last_inbound_at")
    .eq("business_id", listing.business_id)
    .eq("listing_id", listing.id)
    .eq("lead_id", leadId)
    .eq("channel", "WHATSAPP")
    .in("status", ["OPEN", "TRANSFERRED"])
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) return existing;
  const { data: created, error } = await db
    .from("conversations")
    .insert({
      business_id: listing.business_id,
      lead_id: leadId,
      listing_id: listing.id,
      assigned_member_id: listing.assigned_member_id,
      channel: "WHATSAPP",
      provider: getWhatsAppBusinessProvider() ? "META_CLOUD" : "MANUAL_DEEP_LINK",
      created_by_user_id: access.userId,
    })
    .select("id,business_id,provider,status,last_inbound_at")
    .single();
  if (error || !created) throw new OutreachError("Görüşme kaydı oluşturulamadı.");
  return created;
}

export async function draftInitialMessage(access: Access, listingId: string) {
  const listing = await authorizeListing(access, listingId);
  const owner = await loadOwner(access, listing.owner_lead_id);
  const ai = await requireAi(access);
  const db = database(true);

  const { data: stored } = await db
    .from("listing_ai_analysis")
    .select("status,analysis_json")
    .eq("listing_id", listing.id)
    .maybeSingle();
  const analysis = stored?.status === "COMPLETED" ? listingAnalysisSchema.safeParse(stored.analysis_json) : null;
  if (!analysis?.success) throw new OutreachError("Önce ilanı AI ile analiz edin.");

  let message: string;
  try {
    message = await ai.generateInitialMessage({
      officeName: access.business.display_name,
      ownerName: owner.name,
      analysis: analysis.data,
    });
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : "AI_FAILED";
    throw new OutreachError(`İlk mesaj oluşturulamadı (${code}).`);
  }
  if (findPolicyViolation(message))
    throw new OutreachError("AI mesajı fiyat/komisyon içerdiği için kullanılmadı. Tekrar deneyin.");

  const conversation = await openConversation(access, listing, owner.id);
  const { data: draft } = await db
    .from("messages")
    .select("id")
    .eq("conversation_id", conversation.id)
    .eq("status", "DRAFT")
    .eq("sender_type", "AI")
    .limit(1)
    .maybeSingle();
  if (draft) await db.from("messages").update({ content: message }).eq("id", draft.id);
  else
    await db.from("messages").insert({
      business_id: conversation.business_id,
      conversation_id: conversation.id,
      sender_type: "AI",
      direction: "OUTBOUND",
      content: message,
      status: "DRAFT",
    });
  await logListingActivity(access, listing.id, "AI_INITIAL_MESSAGE_DRAFTED", { model: ai.model });
}

export type SendResult = { notice: string; launchUrl?: string };

export async function sendInitialMessage(
  access: Access,
  listingId: string,
  editedMessage: string,
  mode: "API" | "MANUAL",
): Promise<SendResult> {
  const listing = await authorizeListing(access, listingId);
  const owner = await loadOwner(access, listing.owner_lead_id);
  if (!(await entitlements(access)).whatsapp)
    throw new OutreachError("WhatsApp modülü bu ofis için açık değil (Platform Admin).");
  const text = editedMessage.trim();
  if (text.length < 10 || text.length > 1000) throw new OutreachError("Mesaj 10–1000 karakter olmalıdır.");
  if (findPolicyViolation(text))
    throw new OutreachError("Mesaj fiyat, yüzde veya garanti ifadesi içeremez.");

  const db = database(true);
  const conversation = await openConversation(access, listing, owner.id);
  const { data: draft } = await db
    .from("messages")
    .select("id")
    .eq("conversation_id", conversation.id)
    .eq("status", "DRAFT")
    .eq("sender_type", "AI")
    .limit(1)
    .maybeSingle();
  if (!draft) throw new OutreachError("Gönderilecek taslak yok. Önce ilk mesajı oluşturun.");

  if (mode === "MANUAL") {
    await db.from("messages").update({ content: text }).eq("id", draft.id);
    const result = await new ManualWhatsAppProvider().prepareOrSend({
      recipient: owner.phone_normalized!,
      content: text,
    });
    return {
      notice: "WhatsApp bağlantısı hazır. Manuel gönderimde cevaplar AI'a ulaşmaz.",
      launchUrl: result.launchUrl,
    };
  }

  const provider = getWhatsAppBusinessProvider();
  if (!provider) throw new OutreachError("WhatsApp Business API yapılandırılmadı.");
  // Claim the draft first so a double click cannot send twice.
  const { data: claimed } = await db
    .from("messages")
    .update({ status: "QUEUED", content: text })
    .eq("id", draft.id)
    .eq("status", "DRAFT")
    .select("id");
  if (!claimed?.length) throw new OutreachError("Mesaj zaten gönderiliyor.");
  if (conversation.provider !== "META_CLOUD")
    await db.from("conversations").update({ provider: "META_CLOUD" }).eq("id", conversation.id);

  const windowOpen =
    !!conversation.last_inbound_at &&
    Date.now() - Date.parse(conversation.last_inbound_at) < SERVICE_WINDOW_MS;
  const releaseDraft = (code: string) =>
    db.from("messages").update({ status: "DRAFT", error_code: code }).eq("id", draft.id);

  if (windowOpen) {
    try {
      const { providerMessageId } = await provider.sendMessage(owner.phone_normalized!, text);
      await db
        .from("messages")
        .update({ status: "SENT", provider_message_id: providerMessageId, sent_at: new Date().toISOString(), error_code: null })
        .eq("id", draft.id);
      await logListingActivity(access, listing.id, "WHATSAPP_OUTREACH_SENT", { conversation_id: conversation.id });
      return { notice: "Mesaj WhatsApp Business API ile gönderildi. Cevaplar AI tarafından yanıtlanacak." };
    } catch (error) {
      const code = error instanceof WhatsAppSendError ? error.code : "UNKNOWN";
      if (code !== OUTSIDE_SERVICE_WINDOW) {
        await releaseDraft(code);
        if (code === "TEST_MODE_RECIPIENT_BLOCKED")
          throw new OutreachError("Test modu açık: yalnızca WHATSAPP_TEST_RECIPIENT numarasına gönderilebilir.");
        throw new OutreachError(`WhatsApp gönderimi başarısız (${code}).`);
      }
    }
  }

  // Outside the 24h customer service window only an approved template may open the chat.
  const template = provider.config.outreachTemplate;
  if (!template) {
    await releaseDraft(OUTSIDE_SERVICE_WINDOW);
    throw new OutreachError(
      "24 saatlik WhatsApp penceresi kapalı. İlk temas için onaylı şablon (WHATSAPP_OUTREACH_TEMPLATE_NAME) gerekir; test için önce kendi numaranızdan işletme numarasına bir mesaj gönderin.",
    );
  }
  try {
    const { providerMessageId } = await provider.sendTemplate(owner.phone_normalized!, template.name, template.language);
    await releaseDraft("TEMPLATE_SENT_INSTEAD");
    await db.from("messages").insert({
      business_id: conversation.business_id,
      conversation_id: conversation.id,
      sender_type: "SYSTEM",
      direction: "OUTBOUND",
      content: `[Onaylı şablon gönderildi: ${template.name}]`,
      status: "SENT",
      provider_message_id: providerMessageId,
      sent_at: new Date().toISOString(),
    });
    await logListingActivity(access, listing.id, "WHATSAPP_TEMPLATE_SENT", { conversation_id: conversation.id });
    return { notice: "Pencere kapalı olduğu için onaylı şablon gönderildi. İlan sahibi cevap verince AI devam edecek." };
  } catch (error) {
    const code = error instanceof WhatsAppSendError ? error.code : "UNKNOWN";
    await releaseDraft(code);
    throw new OutreachError(`Şablon gönderilemedi (${code}).`);
  }
}

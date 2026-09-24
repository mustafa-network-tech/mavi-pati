import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const sql = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const ids = {
  adminA: "11000000-0000-4000-8000-000000000001",
  advisorA: "11000000-0000-4000-8000-000000000002",
  adminB: "22000000-0000-4000-8000-000000000001",
};

test("outreach schema: slots, AI booking, refusals, handoff and webhook idempotency", async () => {
  const pg = new PGlite({ extensions: { pgcrypto } });
  try {
    await pg.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create table auth.users (id uuid primary key, raw_user_meta_data jsonb not null default '{}'::jsonb);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
    `);
    for (const migration of [
      "202609240001_platform_foundation",
      "202609240002_crm_core",
      "202609240003_engagement_core",
      "202609240004_platform_controls",
      "202609240006_self_service_registration",
      "202609240007_whatsapp_ai_outreach",
    ])
      await pg.exec(sql(`supabase/migrations/${migration}.sql`));

    for (const [name, id] of Object.entries(ids))
      await pg.query(
        "insert into auth.users(id,raw_user_meta_data) values($1::uuid,jsonb_build_object('full_name',$2::text))",
        [id, name],
      );
    const business = async (slug: string) =>
      (
        await pg.query<{ id: string }>(
          `insert into public.businesses(slug,display_name,status,access_starts_at,access_expires_at)
           values($1,$1,'ACTIVE',now()-interval '1 day',now()+interval '30 days') returning id`,
          [slug],
        )
      ).rows[0].id;
    const businessA = await business("office-a");
    const businessB = await business("office-b");
    await pg.query(
      `insert into public.business_entitlements(business_id,max_advisors,crm_enabled,appointments_enabled,whatsapp_enabled,ai_analysis_enabled)
       values($1,2,true,true,true,true),($2,1,true,true,true,true)`,
      [businessA, businessB],
    );
    const members = await pg.query<{ id: string; user_id: string }>(
      `insert into public.business_members(business_id,user_id,role,status)
       values($1,$2,'OFFICE_ADMIN','ACTIVE'),($1,$3,'ADVISOR','ACTIVE'),($4,$5,'OFFICE_ADMIN','ACTIVE')
       returning id,user_id`,
      [businessA, ids.adminA, ids.advisorA, businessB, ids.adminB],
    );
    const member = (userId: string) => members.rows.find((row) => row.user_id === userId)!.id;
    const as = async (userId: string) => {
      await pg.exec("set role authenticated");
      await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
    };
    const asService = () => pg.exec("reset role");

    await as(ids.adminA);
    const owner = (
      await pg.query<{ id: string; phone_normalized: string }>(
        `insert into public.leads(business_id,name,phone,contact_role)
         values($1,'Mustafa Test','0555 111 22 33','OWNER') returning id,phone_normalized`,
        [businessA],
      )
    ).rows[0];
    assert.equal(owner.phone_normalized, "905551112233", "TR local numbers match WhatsApp wa_id");
    const listingId = (
      await pg.query<{ id: string }>(
        `insert into public.listings(business_id,title,property_type,transaction_type,owner_lead_id)
         values($1,'Bolu Merkez 3+1','Daire','SALE',$2) returning id`,
        [businessA, owner.id],
      )
    ).rows[0].id;

    const slot = async (memberId: string, startHours: number) =>
      (
        await pg.query<{ id: string }>(
          `select id from public.create_appointment_slot($1, now()+make_interval(hours=>$2), now()+make_interval(hours=>$2+1))`,
          [memberId, startHours],
        )
      ).rows[0].id;
    const adminSlot = await slot(member(ids.adminA), 24);
    const secondSlot = await slot(member(ids.adminA), 48);
    await assert.rejects(() => slot(member(ids.adminA), 24), /Slot overlaps/);
    await assert.rejects(() => slot(member(ids.adminB), 24), /Office admin required/);

    await as(ids.advisorA);
    await assert.rejects(() => slot(member(ids.advisorA), 72), /Office admin required/);
    assert.equal((await pg.query("select id from public.appointment_slots")).rows.length, 0,
      "advisors only see their own slots");

    await as(ids.adminB);
    assert.equal((await pg.query("select id from public.appointment_slots")).rows.length, 0);
    await assert.rejects(
      () => pg.query("insert into public.webhook_events(provider,event_type,provider_event_id) values('X','MESSAGE','1')"),
      /permission denied/,
    );
    await assert.rejects(
      () => pg.query("insert into public.listing_ai_analysis(business_id,listing_id,status) values($1,$2,'COMPLETED')", [businessA, listingId]),
      /permission denied/,
    );
    await assert.rejects(
      () => pg.query("select public.book_appointment_slot($1,$1,'x')", [adminSlot]),
      /permission denied/,
    );

    await asService();
    await pg.query(
      "insert into public.listing_ai_analysis(business_id,listing_id,status,summary) values($1,$2,'COMPLETED','Özet')",
      [businessA, listingId],
    );
    const conversationId = (
      await pg.query<{ id: string }>(
        `insert into public.conversations(business_id,lead_id,listing_id,channel,provider,created_by_user_id)
         values($1,$2,$3,'WHATSAPP','META_CLOUD',$4) returning id`,
        [businessA, owner.id, listingId, ids.adminA],
      )
    ).rows[0].id;

    const appointment = (
      await pg.query<{ id: string; advisor_member_id: string; listing_id: string }>(
        "select * from public.book_appointment_slot($1,$2,'Portföy görüşmesi')",
        [adminSlot, conversationId],
      )
    ).rows[0];
    assert.equal(appointment.advisor_member_id, member(ids.adminA), "office admin owns the slot");
    assert.equal(appointment.listing_id, listingId);
    const again = (
      await pg.query<{ id: string }>("select * from public.book_appointment_slot($1,$2,'Tekrar')", [
        secondSlot,
        conversationId,
      ])
    ).rows[0];
    assert.equal(again.id, appointment.id, "booking is idempotent per conversation");
    assert.deepEqual(
      (await pg.query("select status from public.appointment_slots order by starts_at")).rows,
      [{ status: "BOOKED" }, { status: "AVAILABLE" }],
    );
    assert.equal(
      (await pg.query<{ status: string }>("select status from public.leads where id=$1", [owner.id])).rows[0].status,
      "APPOINTMENT_SCHEDULED",
    );

    const secondConversation = (
      await pg.query<{ id: string }>(
        `insert into public.conversations(business_id,lead_id,listing_id,channel,provider,created_by_user_id)
         values($1,$2,$3,'WHATSAPP','META_CLOUD',$4) returning id`,
        [businessA, owner.id, listingId, ids.adminA],
      )
    ).rows[0].id;
    await assert.rejects(
      () => pg.query("select public.book_appointment_slot($1,$2,'Çift')", [adminSlot, secondConversation]),
      /Slot not available/,
    );

    await pg.query("select public.handoff_conversation($1,'Fiyat sorusu')", [secondConversation]);
    assert.deepEqual(
      (await pg.query("select status, assigned_member_id from public.conversations where id=$1", [secondConversation])).rows,
      [{ status: "TRANSFERRED", assigned_member_id: member(ids.adminA) }],
      "without an assigned advisor the office admin takes over",
    );

    await pg.query("select public.mark_lead_do_not_contact($1,'Bir daha yazmayın')", [conversationId]);
    assert.deepEqual(
      (await pg.query("select status, do_not_contact, whatsapp_allowed from public.leads where id=$1", [owner.id])).rows,
      [{ status: "REJECTED", do_not_contact: true, whatsapp_allowed: false }],
    );
    const thirdConversation = (
      await pg.query<{ id: string }>(
        `insert into public.conversations(business_id,lead_id,channel,provider,created_by_user_id)
         values($1,$2,'WHATSAPP','META_CLOUD',$3) returning id`,
        [businessA, owner.id, ids.adminA],
      )
    ).rows[0].id;
    await assert.rejects(
      () => pg.query("select public.book_appointment_slot($1,$2,'Red sonrası')", [secondSlot, thirdConversation]),
      /Lead does not want contact/,
    );

    await pg.query(
      "insert into public.messages(business_id,conversation_id,sender_type,direction,content,status,provider_message_id) values($1,$2,'LEAD','INBOUND','Merhaba','DELIVERED','wamid.1')",
      [businessA, conversationId],
    );
    await assert.rejects(
      () =>
        pg.query(
          "insert into public.messages(business_id,conversation_id,sender_type,direction,content,status,provider_message_id) values($1,$2,'LEAD','INBOUND','Merhaba','DELIVERED','wamid.1')",
          [businessA, conversationId],
        ),
      /duplicate key/,
    );
    const inserted = await pg.query(
      "insert into public.webhook_events(provider,event_type,provider_event_id) values('META_CLOUD','MESSAGE','wamid.1'),('META_CLOUD','MESSAGE','wamid.1') on conflict do nothing returning id",
    );
    assert.equal(inserted.rows.length, 1, "a redelivered webhook event is recorded once");

    await as(ids.adminA);
    await assert.rejects(
      () => pg.query("select public.create_manual_whatsapp_draft($1,'Tekrar merhaba')", [owner.id]),
      /WhatsApp is unavailable/,
    );
    await assert.rejects(
      () => pg.query("update public.leads set do_not_contact=false where id=$1", [owner.id]),
      /permission denied/,
    );
    await pg.query("select public.update_lead_status($1,'ARCHIVED')", [owner.id]);
    assert.equal((await pg.query("select id from public.listing_ai_analysis")).rows.length, 1);
    await as(ids.adminB);
    assert.equal((await pg.query("select id from public.listing_ai_analysis")).rows.length, 0);
    assert.equal((await pg.query("select id from public.conversations")).rows.length, 0);
  } finally {
    await pg.close();
  }
});

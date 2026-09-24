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
  advisorA2: "11000000-0000-4000-8000-000000000003",
  adminB: "22000000-0000-4000-8000-000000000001",
};

test("CRM RLS isolates tenants, advisor assignments and controlled lead transitions", async () => {
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
    await pg.exec(sql("supabase/migrations/202609160001_v1.sql"));
    await pg.exec(sql("supabase/migrations/202609160002_languages.sql"));
    await pg.exec(
      sql("supabase/migrations/202609240001_platform_foundation.sql"),
    );
    await pg.exec(sql("supabase/migrations/202609240002_crm_core.sql"));
    await pg.exec(sql("supabase/migrations/202609240003_engagement_core.sql"));

    for (const [name, id] of Object.entries(ids))
      await pg.query(
        "insert into auth.users(id,raw_user_meta_data) values($1::uuid,jsonb_build_object('full_name',$2::text))",
        [id, name],
      );

    const businessA = (
      await pg.query<{ id: string }>(`
        insert into public.businesses(slug,display_name,status,access_starts_at,access_expires_at)
        values('crm-a','CRM A','ACTIVE',now()-interval '1 day',now()+interval '30 days') returning id
      `)
    ).rows[0].id;
    const businessB = (
      await pg.query<{ id: string }>(`
        insert into public.businesses(slug,display_name,status,access_starts_at,access_expires_at)
        values('crm-b','CRM B','ACTIVE',now()-interval '1 day',now()+interval '30 days') returning id
      `)
    ).rows[0].id;
    await pg.query(
      `insert into public.business_entitlements(
         business_id,max_advisors,crm_enabled,appointments_enabled,whatsapp_enabled,ai_voice_enabled
       ) values($1,2,true,true,true,true),($2,1,true,true,true,true)`,
      [businessA, businessB],
    );
    const memberRows = await pg.query<{ id: string; user_id: string }>(
      `insert into public.business_members(business_id,user_id,role,status)
       values($1,$2,'OFFICE_ADMIN','ACTIVE'),($1,$3,'ADVISOR','ACTIVE'),
             ($1,$4,'ADVISOR','ACTIVE'),($5,$6,'OFFICE_ADMIN','ACTIVE')
       returning id,user_id`,
      [businessA, ids.adminA, ids.advisorA, ids.advisorA2, businessB, ids.adminB],
    );
    const member = (userId: string) =>
      memberRows.rows.find((row) => row.user_id === userId)!.id;

    await pg.exec("set role authenticated");
    await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [
      ids.adminA,
    ]);
    const leadA = (
      await pg.query<{ id: string }>(
        `insert into public.leads(business_id,assigned_member_id,name,phone,whatsapp_allowed,call_allowed)
         values($1,$2,'Lead A','+90 (555) 000 00 01',true,true) returning id`,
        [businessA, member(ids.advisorA)],
      )
    ).rows[0].id;
    const listingA = (
      await pg.query<{ id: string }>(
        `insert into public.listings(business_id,assigned_member_id,title,property_type,transaction_type,price)
         values($1,$2,'Merkez Daire','APARTMENT','SALE',5000000) returning id`,
        [businessA, member(ids.advisorA)],
      )
    ).rows[0].id;
    await pg.query(
      `insert into public.lead_listings(business_id,lead_id,listing_id)
       values($1,$2,$3)`,
      [businessA, leadA, listingA],
    );
    assert.equal(
      (
        await pg.query<{ phone_normalized: string }>(
          "select phone_normalized from public.leads where id=$1",
          [leadA],
        )
      ).rows[0].phone_normalized,
      "905550000001",
    );
    await assert.rejects(
      () => pg.query("update public.leads set status='WON' where id=$1", [leadA]),
      /permission denied/,
    );
    await pg.query("select public.update_lead_status($1,'REVIEWING')", [leadA]);
    await assert.rejects(
      () => pg.query("select public.update_lead_status($1,'WON')", [leadA]),
      /Invalid lead status transition/,
    );

    await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [
      ids.advisorA,
    ]);
    assert.equal((await pg.query("select id from public.leads")).rows.length, 1);
    assert.equal((await pg.query("select id from public.listings")).rows.length, 1);
    assert.ok((await pg.query("select id from public.activity_logs")).rows.length >= 3);

    await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [
      ids.advisorA2,
    ]);
    assert.equal((await pg.query("select id from public.leads")).rows.length, 0);
    assert.equal((await pg.query("select id from public.listings")).rows.length, 0);

    await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [
      ids.adminA,
    ]);
    await pg.query("select public.assign_lead($1,$2)", [
      leadA,
      member(ids.advisorA2),
    ]);
    const appointment = (
      await pg.query<{ id: string }>(
        `select id from public.create_appointment(
          $1,$2,$3,'Portföy sunumu',now()+interval '2 day',now()+interval '2 day 1 hour','Ofis',null
        )`,
        [leadA, listingA, member(ids.advisorA2)],
      )
    ).rows[0];
    assert.ok(appointment.id);
    await pg.query(
      "select public.create_manual_whatsapp_draft($1,'Merhaba, randevumuzu teyit etmek isteriz.')",
      [leadA],
    );
    await pg.query("select public.schedule_callback($1,now()+interval '1 day')", [leadA]);
    await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [
      ids.advisorA2,
    ]);
    assert.equal((await pg.query("select id from public.leads")).rows.length, 1);
    assert.equal((await pg.query("select id from public.appointments")).rows.length, 1);
    assert.equal((await pg.query("select id from public.conversations")).rows.length, 2);
    assert.equal((await pg.query("select id from public.messages")).rows.length, 1);
    assert.equal((await pg.query("select id from public.calls")).rows.length, 1);
    await pg.query(
      "insert into public.notes(business_id,lead_id,content) values($1,$2,'İlk danışman notu')",
      [businessA, leadA],
    );

    await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [
      ids.adminB,
    ]);
    assert.equal((await pg.query("select id from public.leads")).rows.length, 0);
    assert.equal((await pg.query("select id from public.notes")).rows.length, 0);
    assert.equal((await pg.query("select id from public.appointments")).rows.length, 0);
    assert.equal((await pg.query("select id from public.conversations")).rows.length, 0);

    await pg.exec("reset role");
    const listingB = (
      await pg.query<{ id: string }>(
        `insert into public.listings(
          business_id,title,property_type,transaction_type,created_by_user_id
        ) values($1,'Other Listing','LAND','SALE',$2) returning id`,
        [businessB, ids.adminB],
      )
    ).rows[0].id;
    await assert.rejects(
      () =>
        pg.query(
          `insert into public.lead_listings(
             business_id,lead_id,listing_id,created_by_user_id
           ) values($1,$2,$3,$4)`,
          [businessA, leadA, listingB, ids.adminA],
        ),
      /foreign key constraint/,
    );

    await pg.exec("set role anon");
    await assert.rejects(
      () => pg.query("select id from public.leads"),
      /permission denied/,
    );
    await pg.exec("reset role");
  } finally {
    await pg.close();
  }
});

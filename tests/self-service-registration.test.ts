import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const sql = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const users = {
  officeAdmin: "10000000-0000-4000-8000-000000000001",
  advisor: "10000000-0000-4000-8000-000000000002",
  secondAdvisor: "10000000-0000-4000-8000-000000000003",
  otherOfficeAdmin: "20000000-0000-4000-8000-000000000001",
};

test("office applications and advisor join requests follow their approval chains", async () => {
  const pg = new PGlite({ extensions: { pgcrypto } });
  try {
    await pg.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create table auth.users (
        id uuid primary key,
        raw_user_meta_data jsonb not null default '{}'::jsonb
      );
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
    `);
    await pg.exec(sql("supabase/migrations/202609240001_platform_foundation.sql"));
    await pg.exec(sql("supabase/migrations/202609240006_self_service_registration.sql"));
    for (const [name, id] of Object.entries(users))
      await pg.query(
        "insert into auth.users(id,raw_user_meta_data) values($1::uuid,jsonb_build_object('full_name',$2::text))",
        [id, name],
      );

    const as = async (userId: string) => {
      await pg.exec("set role authenticated");
      await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
    };
    const asSuperuser = () => pg.exec("reset role");

    await as(users.officeAdmin);
    const businessId = (
      await pg.query<{ id: string }>(
        "select public.submit_business_application('Şişli Emlak','sisli-emlak') as id",
      )
    ).rows[0].id;

    await as(users.advisor);
    await assert.rejects(
      () => pg.query("select public.request_advisor_membership('sisli-emlak')"),
      /Office not found/,
      "pending offices do not accept advisors",
    );

    await asSuperuser();
    await pg.query(
      `update public.businesses set status='ACTIVE', access_starts_at=now()-interval '1 day',
         access_expires_at=now()+interval '30 days' where id=$1`,
      [businessId],
    );
    await pg.query(
      "update public.business_members set status='ACTIVE' where business_id=$1 and role='OFFICE_ADMIN'",
      [businessId],
    );
    await pg.query("update public.business_entitlements set max_advisors=1 where business_id=$1", [
      businessId,
    ]);

    await as(users.advisor);
    const advisorMemberId = (
      await pg.query<{ id: string }>(
        "select public.request_advisor_membership(' SISLI-EMLAK ') as id",
      )
    ).rows[0].id;
    await assert.rejects(
      () => pg.query("select public.request_advisor_membership('sisli-emlak')"),
      /Membership already exists/,
    );
    await assert.rejects(
      () => pg.query("select public.submit_business_application('Başka Ofis','baska-ofis')"),
      /Membership already exists/,
    );
    await assert.rejects(
      () => pg.query("select public.review_advisor_request($1,true)", [advisorMemberId]),
      /Office admin required/,
    );

    await as(users.secondAdvisor);
    await assert.rejects(
      () => pg.query("select public.request_advisor_membership('sisli-emlak')"),
      /Advisor limit reached/,
      "a pending request holds a seat",
    );

    await as(users.otherOfficeAdmin);
    await assert.rejects(
      () => pg.query("select public.review_advisor_request($1,true)", [advisorMemberId]),
      /Office admin required/,
    );

    await as(users.officeAdmin);
    await pg.query("select public.review_advisor_request($1,true)", [advisorMemberId]);
    await asSuperuser();
    assert.deepEqual(
      (
        await pg.query("select status, invited_by from public.business_members where id=$1", [
          advisorMemberId,
        ])
      ).rows,
      [{ status: "ACTIVE", invited_by: users.officeAdmin }],
    );

    await pg.query("update public.business_entitlements set max_advisors=2 where business_id=$1", [
      businessId,
    ]);
    await as(users.secondAdvisor);
    const rejectedMemberId = (
      await pg.query<{ id: string }>("select public.request_advisor_membership('sisli-emlak') as id")
    ).rows[0].id;
    await as(users.officeAdmin);
    await pg.query("select public.review_advisor_request($1,false)", [rejectedMemberId]);
    await assert.rejects(
      () => pg.query("select public.review_advisor_request($1,true)", [rejectedMemberId]),
      /Advisor request not found/,
    );
    await as(users.secondAdvisor);
    await assert.rejects(
      () => pg.query("select public.request_advisor_membership('sisli-emlak')"),
      /Membership already exists/,
      "a rejected advisor cannot resubmit",
    );
    await assert.rejects(
      () => pg.query("select public.request_advisor_membership('olmayan-ofis')"),
      /Office not found/,
    );
  } finally {
    await pg.close();
  }
});

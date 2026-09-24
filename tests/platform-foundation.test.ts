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
  applicant: "30000000-0000-4000-8000-000000000001",
  platformAdmin: "90000000-0000-4000-8000-000000000001",
};

test("platform foundation keeps tenant data isolated and enforces advisor limits", async () => {
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
    await pg.exec(sql("supabase/migrations/202609160001_v1.sql"));
    await pg.exec(sql("supabase/migrations/202609160002_languages.sql"));
    await pg.exec(
      sql("supabase/migrations/202609240001_platform_foundation.sql"),
    );
    await pg.exec(
      sql("supabase/migrations/202609240004_platform_controls.sql"),
    );

    for (const [name, id] of Object.entries(users))
      await pg.query(
        "insert into auth.users(id,raw_user_meta_data) values($1::uuid,jsonb_build_object('full_name',$2::text))",
        [id, name],
      );

    assert.equal(
      (await pg.query("select user_id from public.profiles")).rows.length,
      Object.keys(users).length,
    );

    await pg.query("insert into public.platform_users(user_id) values($1)", [
      users.platformAdmin,
    ]);
    const businessA = (
      await pg.query<{ id: string }>(`
        insert into public.businesses(slug,display_name,status,access_starts_at,access_expires_at)
        values('office-a','Office A','ACTIVE',now()-interval '1 day',now()+interval '30 days')
        returning id
      `)
    ).rows[0].id;
    const businessB = (
      await pg.query<{ id: string }>(`
        insert into public.businesses(slug,display_name,status,access_starts_at,access_expires_at)
        values('office-b','Office B','ACTIVE',now()-interval '1 day',now()+interval '30 days')
        returning id
      `)
    ).rows[0].id;
    await pg.query(
      "insert into public.business_entitlements(business_id,max_advisors,crm_enabled) values($1,1,true),($2,3,true)",
      [businessA, businessB],
    );
    await pg.query(
      `insert into public.business_members(business_id,user_id,role,status)
       values($1,$2,'OFFICE_ADMIN','ACTIVE'),($1,$3,'ADVISOR','ACTIVE'),($4,$5,'OFFICE_ADMIN','ACTIVE')`,
      [
        businessA,
        users.officeAdmin,
        users.advisor,
        businessB,
        users.otherOfficeAdmin,
      ],
    );
    await assert.rejects(
      () =>
        pg.query(
          "insert into public.business_members(business_id,user_id,role,status) values($1,$2,'OFFICE_ADMIN','ACTIVE')",
          [businessA, users.platformAdmin],
      ),
      /Platform users cannot be tenant members/,
    );
    await assert.rejects(
      () =>
        pg.query("insert into public.platform_users(user_id) values($1)", [
          users.officeAdmin,
        ]),
      /Platform users cannot be tenant members/,
    );
    await assert.rejects(
      () =>
        pg.query(
          "insert into public.business_members(business_id,user_id,role,status) values($1,$2,'ADVISOR','PENDING')",
          [businessA, users.secondAdvisor],
        ),
      /Advisor limit reached/,
    );

    await pg.exec("set role authenticated");
    await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [
      users.advisor,
    ]);
    assert.deepEqual(
      (await pg.query<{ slug: string }>("select slug from public.businesses"))
        .rows,
      [{ slug: "office-a" }],
    );
    assert.equal(
      (await pg.query("select id from public.business_members")).rows.length,
      1,
    );
    await assert.rejects(
      () => pg.query("update public.businesses set status='SUSPENDED'"),
      /permission denied/,
    );
    await assert.rejects(
      () =>
        pg.query(
          "update public.business_entitlements set max_advisors=10 where business_id=$1",
          [businessA],
        ),
      /permission denied/,
    );

    await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [
      users.officeAdmin,
    ]);
    assert.equal(
      (await pg.query("select id from public.business_members")).rows.length,
      2,
    );
    await pg.query(
      "update public.businesses set display_name='Office A Updated' where id=$1",
      [businessA],
    );

    await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [
      users.applicant,
    ]);
    const application = await pg.query<{ submit_business_application: string }>(
      "select public.submit_business_application('Applicant Office','applicant-office',null,null)",
    );
    assert.ok(application.rows[0].submit_business_application);
    assert.deepEqual(
      (
        await pg.query<{ slug: string }>(
          "select slug from public.businesses order by slug",
        )
      ).rows,
      [{ slug: "applicant-office" }],
    );

    await pg.exec("reset role");
    await pg.exec("set role service_role");
    await pg.query(
      `select public.configure_business_access(
        $1,$2,'ACTIVE',now()+interval '60 days',2,
        true,true,true,true,true,true,true,120,500,2000,null
      )`,
      [businessA, users.platformAdmin],
    );
    await pg.exec("reset role");
    assert.equal(
      (
        await pg.query<{ whatsapp_enabled: boolean }>(
          "select whatsapp_enabled from public.business_entitlements where business_id=$1",
          [businessA],
        )
      ).rows[0].whatsapp_enabled,
      true,
    );
    assert.equal(
      (
        await pg.query<{ count: number }>(
          "select count(*) from public.platform_audit_logs where action='BUSINESS_ACCESS_CONFIGURED'",
        )
      ).rows[0].count,
      1,
    );
  } finally {
    await pg.close();
  }
});

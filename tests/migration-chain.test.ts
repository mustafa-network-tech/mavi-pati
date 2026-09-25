import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyMigrations,
  createDatabase,
  createUsers,
  migrationFiles,
} from "./helpers/database";

const users = {
  officeAdmin: "10000000-0000-4000-8000-000000000001",
  advisor: "10000000-0000-4000-8000-000000000002",
  pendingAdvisor: "10000000-0000-4000-8000-000000000003",
};

test("real-estate data migrates to clinic roles and entitlements; real-estate objects are gone", async () => {
  const pg = await createDatabase();
  try {
    const legacy = migrationFiles.filter((file) => file < "202609250008");
    const transition = migrationFiles.filter((file) => file >= "202609250008");
    assert.equal(legacy.length, 7);
    await applyMigrations(pg, legacy);
    await createUsers(pg, users);

    const businessId = (
      await pg.query<{ id: string }>(`
        insert into public.businesses(slug,display_name,status,access_starts_at,access_expires_at)
        values('eski-ofis','Eski Ofis','ACTIVE',now()-interval '1 day',now()+interval '30 days') returning id
      `)
    ).rows[0].id;
    await pg.query(
      `insert into public.business_entitlements(business_id,max_advisors,crm_enabled,appointments_enabled,
         whatsapp_enabled,ai_analysis_enabled,ai_voice_enabled,monthly_ai_analysis_limit)
       values($1,3,true,true,true,true,true,250)`,
      [businessId],
    );
    await pg.query(
      `insert into public.business_members(business_id,user_id,role,status)
       values($1,$2,'OFFICE_ADMIN','ACTIVE'),($1,$3,'ADVISOR','ACTIVE'),($1,$4,'ADVISOR','PENDING')`,
      [businessId, users.officeAdmin, users.advisor, users.pendingAdvisor],
    );
    await pg.query(
      "insert into public.leads(business_id,name,phone,created_by_user_id) values($1,'Mal Sahibi','05321234567',$2)",
      [businessId, users.officeAdmin],
    );
    await pg.query(
      `insert into public.business_usage(business_id,metric,period_start,period_end,used_quantity)
       values($1,'WHATSAPP_MESSAGE',date_trunc('month',now()),date_trunc('month',now())+interval '1 month',4)`,
      [businessId],
    );

    await applyMigrations(pg, transition);

    assert.deepEqual(
      (await pg.query("select user_id, role, status from public.business_members order by user_id")).rows,
      [
        { user_id: users.officeAdmin, role: "CLINIC_ADMIN", status: "ACTIVE" },
        { user_id: users.advisor, role: "VETERINARIAN", status: "ACTIVE" },
        { user_id: users.pendingAdvisor, role: "VETERINARIAN", status: "PENDING" },
      ],
    );
    assert.deepEqual(
      (
        await pg.query(
          `select max_veterinarians, max_staff, clinic_enabled, appointments_enabled,
                  ai_assistant_enabled, ai_voice_enabled, monthly_ai_request_limit
           from public.business_entitlements`,
        )
      ).rows,
      [
        {
          max_veterinarians: 3,
          max_staff: 0,
          clinic_enabled: true,
          appointments_enabled: true,
          ai_assistant_enabled: true,
          ai_voice_enabled: false,
          monthly_ai_request_limit: 250,
        },
      ],
    );
    assert.equal((await pg.query("select * from public.business_usage")).rows.length, 0);

    const remaining = await pg.query<{ name: string }>(`
      select table_name as name from information_schema.tables
      where table_schema = 'public' and table_name in (
        'leads','listings','lead_listings','notes','conversations','messages','calls',
        'listing_ai_analysis','appointment_slots','webhook_events')
      union all
      select proname from pg_proc join pg_namespace n on n.oid = pronamespace
      where n.nspname in ('public','private') and proname in (
        'create_manual_whatsapp_draft','schedule_callback','book_appointment_slot',
        'request_advisor_membership','review_advisor_request','enforce_advisor_limit','crm_is_enabled')
    `);
    assert.deepEqual(remaining.rows, []);

    const columns = await pg.query<{ column_name: string }>(`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'business_entitlements'
        and column_name in ('whatsapp_enabled','max_advisors','monthly_ai_call_minutes')
    `);
    assert.deepEqual(columns.rows, []);
  } finally {
    await pg.close();
  }
});

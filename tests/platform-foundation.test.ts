import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addMember,
  applyMigrations,
  createClinic,
  createDatabase,
  createUsers,
  sessions,
} from "./helpers/database";

const users = {
  platformAdmin: "00000000-0000-4000-8000-000000000001",
  clinicAdmin: "00000000-0000-4000-8000-000000000002",
  veterinarian: "00000000-0000-4000-8000-000000000003",
  otherClinicAdmin: "00000000-0000-4000-8000-000000000004",
  applicant: "00000000-0000-4000-8000-000000000005",
};

test("platform admin stays separate from tenants and controls clinic access, seats and AI", async () => {
  const pg = await createDatabase();
  const { as, asSuperuser, asServiceRole } = sessions(pg);
  try {
    await applyMigrations(pg);
    await createUsers(pg, users);
    assert.equal((await pg.query("select user_id from public.profiles")).rows.length, 5);

    await pg.query("insert into public.platform_users(user_id) values($1)", [users.platformAdmin]);
    const clinicA = await createClinic(pg, "klinik-a", { veterinarians: 1 });
    const clinicB = await createClinic(pg, "klinik-b");
    await addMember(pg, clinicA, users.clinicAdmin, "CLINIC_ADMIN");
    await addMember(pg, clinicA, users.veterinarian, "VETERINARIAN");
    await addMember(pg, clinicB, users.otherClinicAdmin, "CLINIC_ADMIN");

    await assert.rejects(
      () => addMember(pg, clinicA, users.platformAdmin, "CLINIC_ADMIN"),
      /Platform users cannot be tenant members/,
    );
    await assert.rejects(
      () => pg.query("insert into public.platform_users(user_id) values($1)", [users.clinicAdmin]),
      /Platform users cannot be tenant members/,
    );
    await assert.rejects(
      () => addMember(pg, clinicA, users.applicant, "VETERINARIAN", "PENDING"),
      /Seat limit reached/,
    );

    await as(users.veterinarian);
    assert.deepEqual((await pg.query("select slug from public.businesses")).rows, [{ slug: "klinik-a" }]);
    await assert.rejects(() => pg.query("update public.businesses set status='SUSPENDED'"), /permission denied/);
    await assert.rejects(
      () => pg.query("update public.business_entitlements set max_veterinarians=10 where business_id=$1", [clinicA]),
      /permission denied/,
    );
    await assert.rejects(
      () => pg.query("select * from public.platform_clinic_overview($1)", [users.veterinarian]),
      /permission denied/,
    );
    await assert.rejects(
      () => pg.query("select public.approve_business($1,$2,'ACTIVE',now()+interval '1 day',1,1)", [clinicA, users.veterinarian]),
      /permission denied/,
    );

    await as(users.clinicAdmin);
    await pg.query("update public.businesses set display_name='Klinik A Merkez' where id=$1", [clinicA]);
    await assert.rejects(
      () => pg.query("select public.update_member_status(id,'SUSPENDED') from public.business_members where user_id=$1", [users.clinicAdmin]),
      /Member not found/,
      "clinic admins cannot be suspended through the team RPC",
    );

    await as(users.applicant);
    const application = (
      await pg.query<{ id: string }>("select public.submit_business_application('Pati Klinik','pati-klinik',null,null) as id")
    ).rows[0].id;
    assert.deepEqual(
      (await pg.query("select role, status from public.business_members")).rows,
      [{ role: "CLINIC_ADMIN", status: "PENDING" }],
    );

    await asServiceRole();
    await assert.rejects(
      () => pg.query("select public.approve_business($1,$2,'ACTIVE',now()+interval '30 days',2,1)", [application, users.clinicAdmin]),
      /Platform admin required/,
    );
    await pg.query("select public.approve_business($1,$2,'TRIAL',now()+interval '30 days',2,1)", [
      application,
      users.platformAdmin,
    ]);
    await pg.query(
      `select public.configure_business_access($1,$2,'ACTIVE',now()+interval '60 days',2,3,true,true,true,true,false,true,500,null)`,
      [clinicA, users.platformAdmin],
    );
    await assert.rejects(
      () =>
        pg.query(
          `select public.configure_business_access($1,$2,'ACTIVE',now()+interval '60 days',0,3,true,true,true,true,false,false,500,null)`,
          [clinicA, users.platformAdmin],
        ),
      /Seat limit is below current member count/,
    );
    const overview = await pg.query<{
      slug: string;
      veterinarians: number;
      ai_voice_enabled: boolean;
      ai_request_limit: number;
    }>("select slug, veterinarians, ai_voice_enabled, ai_request_limit from public.platform_clinic_overview($1) order by slug", [
      users.platformAdmin,
    ]);
    assert.deepEqual(overview.rows.find((row) => row.slug === "klinik-a"), {
      slug: "klinik-a",
      veterinarians: 1,
      ai_voice_enabled: true,
      ai_request_limit: 500,
    });

    await asSuperuser();
    assert.deepEqual(
      (
        await pg.query(
          "select status, (select status from public.business_members where business_id=$1) as admin_status from public.businesses where id=$1",
          [application],
        )
      ).rows,
      [{ status: "TRIAL", admin_status: "ACTIVE" }],
    );
    assert.deepEqual(
      (
        await pg.query(
          "select action from public.platform_audit_logs order by created_at, action",
        )
      ).rows.map((row) => (row as { action: string }).action).sort(),
      ["BUSINESS_ACCESS_CONFIGURED", "BUSINESS_APPROVED"],
    );
  } finally {
    await pg.close();
  }
});

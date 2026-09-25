import { test } from "node:test";
import assert from "node:assert/strict";
import { applyMigrations, createDatabase, createUsers, sessions } from "./helpers/database";

const users = {
  clinicAdmin: "30000000-0000-4000-8000-000000000001",
  veterinarian: "30000000-0000-4000-8000-000000000002",
  staff: "30000000-0000-4000-8000-000000000003",
  otherClinicAdmin: "30000000-0000-4000-8000-000000000004",
  secondStaff: "30000000-0000-4000-8000-000000000005",
};

test("clinic applications and veterinarian/staff join requests follow their approval chains", async () => {
  const pg = await createDatabase();
  const { as, asSuperuser } = sessions(pg);
  try {
    await applyMigrations(pg);
    await createUsers(pg, users);

    await as(users.clinicAdmin);
    const clinicId = (
      await pg.query<{ id: string }>("select public.submit_business_application('Şişli Veteriner','sisli-vet') as id")
    ).rows[0].id;

    await as(users.veterinarian);
    await assert.rejects(
      () => pg.query("select public.request_clinic_membership('sisli-vet','VETERINARIAN')"),
      /Clinic not found/,
      "pending clinics do not accept members",
    );

    await asSuperuser();
    await pg.query(
      `update public.businesses set status='ACTIVE', access_starts_at=now()-interval '1 day',
         access_expires_at=now()+interval '30 days' where id=$1`,
      [clinicId],
    );
    await pg.query("update public.business_members set status='ACTIVE' where business_id=$1", [clinicId]);
    await pg.query(
      "update public.business_entitlements set max_veterinarians=1, max_staff=1 where business_id=$1",
      [clinicId],
    );

    await as(users.veterinarian);
    await assert.rejects(
      () => pg.query("select public.request_clinic_membership('sisli-vet','CLINIC_ADMIN')"),
      /Invalid role/,
      "nobody can request the admin role",
    );
    const vetMemberId = (
      await pg.query<{ id: string }>("select public.request_clinic_membership(' SISLI-VET ','VETERINARIAN') as id")
    ).rows[0].id;
    await assert.rejects(
      () => pg.query("select public.request_clinic_membership('sisli-vet','CLINIC_STAFF')"),
      /Membership already exists/,
    );
    await assert.rejects(
      () => pg.query("select public.submit_business_application('Başka Klinik','baska-klinik')"),
      /Membership already exists/,
    );
    await assert.rejects(
      () => pg.query("select public.review_member_request($1,true)", [vetMemberId]),
      /Clinic admin required/,
    );

    await as(users.staff);
    const staffMemberId = (
      await pg.query<{ id: string }>("select public.request_clinic_membership('sisli-vet','CLINIC_STAFF') as id")
    ).rows[0].id;
    await as(users.secondStaff);
    await assert.rejects(
      () => pg.query("select public.request_clinic_membership('sisli-vet','CLINIC_STAFF')"),
      /Seat limit reached/,
      "a pending request holds a seat of its role",
    );

    await as(users.otherClinicAdmin);
    await assert.rejects(
      () => pg.query("select public.review_member_request($1,true)", [vetMemberId]),
      /Clinic admin required/,
    );

    await as(users.clinicAdmin);
    await pg.query("select public.review_member_request($1,true)", [vetMemberId]);
    await pg.query("select public.review_member_request($1,false)", [staffMemberId]);
    await assert.rejects(
      () => pg.query("select public.review_member_request($1,true)", [staffMemberId]),
      /Member request not found/,
    );
    await pg.query("select public.update_member_status($1,'SUSPENDED')", [vetMemberId]);
    await pg.query("select public.update_member_status($1,'ACTIVE')", [vetMemberId]);

    await asSuperuser();
    assert.deepEqual(
      (await pg.query("select role, status, invited_by from public.business_members where id=$1", [vetMemberId])).rows,
      [{ role: "VETERINARIAN", status: "ACTIVE", invited_by: users.clinicAdmin }],
    );

    await as(users.staff);
    await assert.rejects(
      () => pg.query("select public.request_clinic_membership('sisli-vet','CLINIC_STAFF')"),
      /Membership already exists/,
      "a rejected member cannot resubmit",
    );
    await assert.rejects(
      () => pg.query("select public.request_clinic_membership('olmayan-klinik','CLINIC_STAFF')"),
      /Clinic not found/,
    );
  } finally {
    await pg.close();
  }
});

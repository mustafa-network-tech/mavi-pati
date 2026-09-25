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
  adminA: "d0000000-0000-4000-8000-000000000001",
  vetA: "d0000000-0000-4000-8000-000000000002",
  staffA: "d0000000-0000-4000-8000-000000000003",
  ownerUser: "d0000000-0000-4000-8000-000000000004",
  otherOwnerUser: "d0000000-0000-4000-8000-000000000005",
  adminB: "d0000000-0000-4000-8000-000000000006",
};

test("owner portal: invitation, owner-safe overview, requests and clinic review", async () => {
  const pg = await createDatabase();
  const { as, asSuperuser } = sessions(pg);
  const one = async <T>(sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows[0];
  try {
    await applyMigrations(pg);
    await createUsers(pg, users);
    const clinicA = await createClinic(pg, "klinik-a", { ownerPortal: true, aiLimit: 100 });
    const clinicB = await createClinic(pg, "klinik-b", { ownerPortal: true });
    await addMember(pg, clinicA, users.adminA, "CLINIC_ADMIN");
    const vetA = await addMember(pg, clinicA, users.vetA, "VETERINARIAN");
    await addMember(pg, clinicA, users.staffA, "CLINIC_STAFF");
    await addMember(pg, clinicB, users.adminB, "CLINIC_ADMIN");

    await as(users.staffA);
    const ownerId = (await one<{ id: string }>(
      "insert into public.owners(business_id,full_name,phone,notes) values($1,'Ayşe Yılmaz','05321112233','İÇ-NOT: ödeme gecikmeli') returning id",
      [clinicA],
    )).id;
    const otherOwnerId = (await one<{ id: string }>("insert into public.owners(business_id,full_name) values($1,'Can Demir') returning id", [clinicA])).id;
    const pet = (await one<{ id: string }>(
      "insert into public.patients(business_id,owner_id,name,species,notes) values($1,$2,'Boncuk','CAT','İÇ-NOT: agresif') returning id",
      [clinicA, ownerId],
    )).id;
    const otherPet = (await one<{ id: string }>(
      "insert into public.patients(business_id,owner_id,name,species) values($1,$2,'Karabaş','DOG') returning id",
      [clinicA, otherOwnerId],
    )).id;
    await as(users.vetA);
    await pg.query(
      "insert into public.examinations(business_id,patient_id,veterinarian_member_id,complaint,assessment) values($1,$2,$3,'Kaşıntı','KLİNİK-DEĞERLENDİRME')",
      [clinicA, pet, vetA],
    );
    await pg.query(
      "insert into public.vaccinations(business_id,patient_id,vaccine_name,status,next_due_at,notes) values($1,$2,'Kuduz','SCHEDULED',current_date+20,'İÇ-NOT')",
      [clinicA, pet],
    );

    // Invitation: created by clinic staff, redeemed once by the owner.
    await as(users.staffA);
    const token = (await one<{ token: string }>("select public.create_owner_invitation($1) as token", [ownerId])).token;
    assert.match(token, /^[0-9a-f]{64}$/);
    await as(users.adminB);
    await assert.rejects(() => pg.query("select public.create_owner_invitation($1)", [ownerId]), /Owner access denied/);
    await asSuperuser();
    assert.equal((await pg.query("select 1 from public.owner_invitations where token_hash=$1", [token])).rows.length, 0, "raw token is never stored");

    await as(users.vetA);
    await assert.rejects(() => pg.query("select public.accept_owner_invitation($1)", [token]), /Clinic or platform users cannot be owner portal accounts/);
    await as(users.ownerUser);
    assert.equal((await one<{ name: string }>("select public.owner_invitation_clinic($1) as name", [token])).name, "klinik-a");
    assert.equal((await one<{ slug: string }>("select public.accept_owner_invitation($1) as slug", [token])).slug, "klinik-a");
    await as(users.otherOwnerUser);
    await assert.rejects(() => pg.query("select public.accept_owner_invitation($1)", [token]), /Invitation not found/, "single use");

    // The owner sees only owner-safe data of their own pets, never clinic tables directly.
    await as(users.ownerUser);
    for (const table of ["owners", "patients", "examinations", "treatments", "vaccinations", "appointments", "activity_logs", "ai_messages"])
      assert.equal((await pg.query(`select 1 from public.${table}`)).rows.length, 0, `${table} readable by owner`);
    const overview = (await one<{ data: Record<string, unknown[]> & { owner: { full_name: string } } }>(
      "select public.owner_portal_overview($1) as data",
      [clinicA],
    )).data;
    assert.equal(overview.owner.full_name, "Ayşe Yılmaz");
    assert.deepEqual((overview.pets as { name: string }[]).map((item) => item.name), ["Boncuk"]);
    assert.equal(overview.vaccinations.length, 1);
    const serialized = JSON.stringify(overview);
    for (const secret of ["İÇ-NOT", "KLİNİK-DEĞERLENDİRME", "Karabaş", "05321112233", "Kaşıntı"])
      assert.ok(!serialized.includes(secret), `overview leaked ${secret}`);
    await assert.rejects(() => pg.query("select public.owner_portal_overview($1)", [clinicB]), /Owner portal access denied/);

    // Requests: only for own pets, only through the RPC, capped while pending.
    const appointmentRequest = (await one<{ id: string }>(
      "select public.submit_owner_request($1,$2,'APPOINTMENT','Kaşıntı için kontrol',current_date+2,'öğleden sonra','x','AI_VOICE') as id",
      [clinicA, pet],
    )).id;
    const medicationRequest = (await one<{ id: string }>(
      "select public.submit_owner_request($1,$2,'MEDICATION','Geçen ay verilen şampuan bitti',null,null,'Klorheksidin şampuan','AI_TEXT') as id",
      [clinicA, pet],
    )).id;
    await assert.rejects(
      () => pg.query("select public.submit_owner_request($1,$2,'APPOINTMENT','Başkasının hayvanı')", [clinicA, otherPet]),
      /Pet not found/,
    );
    await assert.rejects(
      () => pg.query("insert into public.owner_requests(business_id,owner_id,patient_id,request_type,details) values($1,$2,$3,'APPOINTMENT','direct')", [clinicA, ownerId, pet]),
      /permission denied/,
    );
    await assert.rejects(
      () => pg.query("select public.respond_owner_request($1,'APPROVED','kendim onayladım')", [medicationRequest]),
      /Request access denied/,
    );
    assert.equal((await pg.query("select 1 from public.owner_requests")).rows.length, 2);
    for (let index = 0; index < 3; index += 1)
      await pg.query("select public.submit_owner_request($1,$2,'APPOINTMENT','Ek talep')", [clinicA, pet]);
    await assert.rejects(
      () => pg.query("select public.submit_owner_request($1,$2,'APPOINTMENT','Altıncı talep')", [clinicA, pet]),
      /Too many pending requests/,
    );

    // Owner AI: clinic quota plus a per-owner daily cap.
    assert.equal((await one<{ left: number }>("select public.consume_ai_quota($1) as left", [clinicA])).left, 99);
    await pg.query("insert into public.ai_conversations(business_id) values($1)", [clinicA]);

    // Clinic review: other clinics see nothing; staff cannot decide on medication.
    await as(users.adminB);
    assert.equal((await pg.query("select 1 from public.owner_requests")).rows.length, 0);
    await as(users.staffA);
    assert.equal((await pg.query("select 1 from public.owner_requests")).rows.length, 5);
    await assert.rejects(
      () => pg.query("select public.respond_owner_request($1,'APPROVED','Hazır')", [medicationRequest]),
      /Clinician required/,
    );
    const appointmentId = (await one<{ id: string }>(
      "select public.approve_appointment_request($1,now()+interval '2 days',now()+interval '2 days 30 minutes',$2,'Görüşmek üzere') as id",
      [appointmentRequest, vetA],
    )).id;
    await as(users.vetA);
    await pg.query("select public.respond_owner_request($1,'APPROVED','Yarın 14:00 sonrası teslim alabilirsiniz')", [medicationRequest]);
    await assert.rejects(
      () => pg.query("select public.respond_owner_request($1,'REJECTED',null)", [medicationRequest]),
      /Request already handled/,
    );

    await as(users.ownerUser);
    const after = (await one<{ data: { requests: { status: string; clinic_response: string | null }[]; appointments: { id: string; status: string }[] } }>(
      "select public.owner_portal_overview($1) as data",
      [clinicA],
    )).data;
    assert.deepEqual(after.appointments.map((item) => [item.id, item.status]), [[appointmentId, "CONFIRMED"]]);
    assert.ok(after.requests.some((item) => item.status === "APPROVED" && item.clinic_response === "Yarın 14:00 sonrası teslim alabilirsiniz"));

    // Revoked access ends everything at once.
    await as(users.adminA);
    await pg.query("select public.revoke_owner_portal_access($1)", [ownerId]);
    await as(users.ownerUser);
    await assert.rejects(() => pg.query("select public.owner_portal_overview($1)", [clinicA]), /Owner portal access denied/);
    await assert.rejects(() => pg.query("select public.consume_ai_quota($1)", [clinicA]), /AI access denied/);

    await asSuperuser();
    assert.deepEqual(
      (await pg.query("select metric, used_quantity from public.business_usage where business_id=$1 order by metric", [clinicA])).rows,
      [
        { metric: "AI_OWNER_REQUEST", used_quantity: 1 },
        { metric: "AI_REQUEST", used_quantity: 1 },
      ],
    );
    await addMember(pg, clinicB, users.ownerUser, "CLINIC_STAFF", "PENDING");
  } finally {
    await pg.close();
  }
});

test("owner daily AI cap protects the clinic quota", async () => {
  const pg = await createDatabase();
  const { as } = sessions(pg);
  try {
    await applyMigrations(pg);
    await createUsers(pg, { admin: users.adminA, owner: users.ownerUser });
    const clinic = await createClinic(pg, "klinik-c", { ownerPortal: true, aiLimit: 1000 });
    await addMember(pg, clinic, users.adminA, "CLINIC_ADMIN");
    await as(users.adminA);
    const ownerId = (await pg.query<{ id: string }>("insert into public.owners(business_id,full_name) values($1,'Sahip') returning id", [clinic])).rows[0].id;
    const token = (await pg.query<{ token: string }>("select public.create_owner_invitation($1) as token", [ownerId])).rows[0].token;
    await as(users.ownerUser);
    await pg.query("select public.accept_owner_invitation($1)", [token]);
    for (let index = 0; index < 40; index += 1) await pg.query("select public.consume_ai_quota($1)", [clinic]);
    await assert.rejects(() => pg.query("select public.consume_ai_quota($1)", [clinic]), /Owner daily AI limit reached/);
    await pg.exec("reset role");
    await assert.rejects(
      () => addMember(pg, clinic, users.ownerUser, "CLINIC_STAFF", "PENDING"),
      /Owner portal accounts cannot be clinic or platform users/,
    );
  } finally {
    await pg.close();
  }
});

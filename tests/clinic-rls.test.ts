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
  adminA: "a0000000-0000-4000-8000-000000000001",
  vetA: "a0000000-0000-4000-8000-000000000002",
  vetA2: "a0000000-0000-4000-8000-000000000003",
  staffA: "a0000000-0000-4000-8000-000000000004",
  staffA2: "a0000000-0000-4000-8000-000000000005",
  adminB: "b0000000-0000-4000-8000-000000000001",
  vetB: "b0000000-0000-4000-8000-000000000002",
};

const clinicalTables = [
  "owners",
  "patients",
  "examinations",
  "treatments",
  "vaccinations",
  "appointments",
  "activity_logs",
];

test("clinic data is isolated per tenant and clinical records are limited to clinicians", async () => {
  const pg = await createDatabase();
  const { as, asSuperuser } = sessions(pg);
  const count = async (table: string) =>
    (await pg.query<{ count: number }>(`select count(*)::int as count from public.${table}`)).rows[0].count;
  try {
    await applyMigrations(pg);
    await createUsers(pg, users);
    const clinicA = await createClinic(pg, "klinik-a", { staff: 1 });
    const clinicB = await createClinic(pg, "klinik-b");
    await addMember(pg, clinicA, users.adminA, "CLINIC_ADMIN");
    const vetA = await addMember(pg, clinicA, users.vetA, "VETERINARIAN");
    await addMember(pg, clinicA, users.vetA2, "VETERINARIAN");
    await addMember(pg, clinicA, users.staffA, "CLINIC_STAFF");
    await addMember(pg, clinicB, users.adminB, "CLINIC_ADMIN");
    const vetB = await addMember(pg, clinicB, users.vetB, "VETERINARIAN");
    await assert.rejects(
      () => addMember(pg, clinicA, users.staffA2, "CLINIC_STAFF", "PENDING"),
      /Seat limit reached/,
    );

    // Clinic A records, written by its own users.
    await as(users.staffA);
    const ownerA = (
      await pg.query<{ id: string; phone_normalized: string }>(
        "insert into public.owners(business_id,full_name,phone) values($1,' Ayşe Yılmaz ','0532 111 22 33') returning id, phone_normalized",
        [clinicA],
      )
    ).rows[0];
    assert.equal(ownerA.phone_normalized, "905321112233");
    const patientA = (
      await pg.query<{ id: string }>(
        "insert into public.patients(business_id,owner_id,name,species,microchip_number) values($1,$2,'Boncuk','CAT','9001 2345 6789') returning id",
        [clinicA, ownerA.id],
      )
    ).rows[0].id;

    await as(users.vetA);
    const examA = (
      await pg.query<{ id: string }>(
        `insert into public.examinations(business_id,patient_id,veterinarian_member_id,complaint,findings,assessment)
         values($1,$2,$3,'İştahsızlık','Ateş 39.4','Takip önerildi') returning id`,
        [clinicA, patientA, vetA],
      )
    ).rows[0].id;
    await pg.query(
      `insert into public.treatments(business_id,patient_id,examination_id,procedure_name,veterinarian_member_id)
       values($1,$2,$3,'Serum uygulaması',$4)`,
      [clinicA, patientA, examA, vetA],
    );
    await pg.query(
      `insert into public.vaccinations(business_id,patient_id,vaccine_name,administered_at,next_due_at,veterinarian_member_id)
       values($1,$2,'Karma aşı',current_date,current_date+30,$3)`,
      [clinicA, patientA, vetA],
    );
    const appointmentA = (
      await pg.query<{ id: string; owner_id: string }>(
        `insert into public.appointments(business_id,patient_id,veterinarian_member_id,starts_at,ends_at,reason)
         values($1,$2,$3,now()+interval '1 day',now()+interval '1 day 30 minutes','Kontrol') returning id, owner_id`,
        [clinicA, patientA, vetA],
      )
    ).rows[0];
    assert.equal(appointmentA.owner_id, ownerA.id, "appointment owner comes from the patient");
    await assert.rejects(
      () =>
        pg.query(
          `insert into public.appointments(business_id,patient_id,veterinarian_member_id,starts_at,ends_at,reason)
           values($1,$2,$3,now()+interval '1 day 15 minutes',now()+interval '1 day 45 minutes','Çakışan')`,
          [clinicA, patientA, vetA],
        ),
      /Veterinarian is not available/,
    );

    // Staff: operational data yes, clinical records no.
    await as(users.staffA);
    assert.equal(await count("patients"), 1);
    assert.equal(await count("vaccinations"), 1);
    assert.equal(await count("appointments"), 1);
    assert.equal(await count("examinations"), 0);
    assert.equal(await count("treatments"), 0);
    assert.equal(
      (
        await pg.query(
          "select 1 from public.activity_logs where entity_type in ('EXAMINATION','TREATMENT')",
        )
      ).rows.length,
      0,
    );
    await assert.rejects(
      () =>
        pg.query(
          "insert into public.examinations(business_id,patient_id,veterinarian_member_id,complaint) values($1,$2,$3,'Deneme')",
          [clinicA, patientA, vetA],
        ),
      /row-level security/,
    );
    await pg.query(
      "insert into public.vaccinations(business_id,patient_id,vaccine_name,status,next_due_at) values($1,$2,'Kuduz','SCHEDULED',current_date+10)",
      [clinicA, patientA],
    );
    const staffMemberId = (
      await pg.query<{ id: string }>("select id from public.business_members where user_id=$1", [users.staffA])
    ).rows[0].id;
    await assert.rejects(
      () =>
        pg.query(
          "insert into public.vaccinations(business_id,patient_id,vaccine_name,status,next_due_at,veterinarian_member_id) values($1,$2,'Kuduz','SCHEDULED',current_date+10,$3)",
          [clinicA, patientA, staffMemberId],
        ),
      /active clinician/,
      "staff cannot be recorded as the veterinarian",
    );

    // Clinic B cannot see or touch anything of clinic A.
    for (const user of [users.adminB, users.vetB]) {
      await as(user);
      for (const table of clinicalTables) assert.equal(await count(table), 0, `${table} leaked to ${user}`);
      assert.equal(
        (await pg.query("select 1 from public.business_members where business_id=$1", [clinicA])).rows.length,
        0,
      );
      assert.equal((await pg.query("select 1 from public.profiles where user_id=$1", [users.vetA])).rows.length, 0);
    }
    await as(users.adminB);
    await assert.rejects(
      () =>
        pg.query("insert into public.patients(business_id,owner_id,name,species) values($1,$2,'Sızma','DOG')", [
          clinicA,
          ownerA.id,
        ]),
      /row-level security/,
    );
    await assert.rejects(
      () =>
        pg.query("insert into public.patients(business_id,owner_id,name,species) values($1,$2,'Sızma','DOG')", [
          clinicB,
          ownerA.id,
        ]),
      /foreign key/,
    );
    assert.equal(
      (await pg.query("update public.patients set name='Hacked' where id=$1", [patientA])).affectedRows,
      0,
    );
    const ownerB = (
      await pg.query<{ id: string }>("insert into public.owners(business_id,full_name) values($1,'Mehmet Kaya') returning id", [clinicB])
    ).rows[0].id;
    const patientB = (
      await pg.query<{ id: string }>(
        "insert into public.patients(business_id,owner_id,name,species) values($1,$2,'Karabaş','DOG') returning id",
        [clinicB, ownerB],
      )
    ).rows[0].id;
    await assert.rejects(
      () =>
        pg.query(
          "insert into public.examinations(business_id,patient_id,veterinarian_member_id,complaint) values($1,$2,$3,'Kontrol')",
          [clinicB, patientB, vetA],
        ),
      /active clinician/,
      "a veterinarian of another clinic cannot be referenced",
    );
    await assert.rejects(
      () =>
        pg.query(
          "insert into public.treatments(business_id,patient_id,examination_id,procedure_name,veterinarian_member_id) values($1,$2,$3,'Pansuman',$4)",
          [clinicB, patientB, examA, vetB],
        ),
      /foreign key|another patient/,
    );
    await assert.rejects(() => pg.query("delete from public.patients"), /permission denied/);
    await assert.rejects(
      () => pg.query("update public.patients set business_id=$1", [clinicA]),
      /permission denied/,
    );

    // Clinical record edits: author or clinic admin only.
    await as(users.vetA2);
    assert.equal(await count("examinations"), 1, "veterinarians read every clinic patient");
    assert.equal(
      (await pg.query("update public.examinations set findings='Değiştirildi' where id=$1", [examA])).affectedRows,
      0,
    );
    assert.equal(
      (await pg.query("select 1 from public.business_members where business_id=$1", [clinicA])).rows.length,
      4,
      "colleagues are visible",
    );
    await as(users.adminA);
    assert.equal(
      (await pg.query("update public.examinations set extra_notes='Yönetici notu' where id=$1", [examA])).affectedRows,
      1,
    );
    await pg.query("update public.appointments set status='CANCELED' where id=$1", [appointmentA.id]);
    assert.ok(
      (await pg.query<{ canceled_at: string | null }>("select canceled_at from public.appointments where id=$1", [appointmentA.id]))
        .rows[0].canceled_at,
    );

    // Disabled module and expired access block writes; expired access keeps read-only history.
    await asSuperuser();
    await pg.query("update public.business_entitlements set clinic_enabled=false where business_id=$1", [clinicA]);
    await as(users.vetA);
    await assert.rejects(
      () => pg.query("insert into public.owners(business_id,full_name) values($1,'Yeni Sahip')", [clinicA]),
      /row-level security/,
    );
    await asSuperuser();
    await pg.query("update public.business_entitlements set clinic_enabled=true where business_id=$1", [clinicA]);
    await pg.query(
      "update public.businesses set status='EXPIRED', access_expires_at=now()-interval '1 minute' where id=$1",
      [clinicA],
    );
    await as(users.vetA);
    assert.equal(await count("patients"), 1);
    await assert.rejects(
      () => pg.query("insert into public.owners(business_id,full_name) values($1,'Yeni Sahip')", [clinicA]),
      /row-level security/,
    );

    await asSuperuser();
    await pg.query("update public.business_members set status='SUSPENDED' where user_id=$1", [users.staffA]);
    await as(users.staffA);
    assert.equal(await count("patients"), 0, "suspended members lose access");
  } finally {
    await pg.close();
  }
});

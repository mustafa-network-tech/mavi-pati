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
  vetA: "c0000000-0000-4000-8000-000000000001",
  vetA2: "c0000000-0000-4000-8000-000000000002",
  adminA: "c0000000-0000-4000-8000-000000000003",
  vetB: "c0000000-0000-4000-8000-000000000004",
};

test("AI quota is atomic per clinic and AI conversations stay with their user and clinic", async () => {
  const pg = await createDatabase();
  const { as, asSuperuser } = sessions(pg);
  try {
    await applyMigrations(pg);
    await createUsers(pg, users);
    const clinicA = await createClinic(pg, "klinik-a", { aiLimit: 2, voice: false });
    const clinicB = await createClinic(pg, "klinik-b", { aiLimit: 5, voice: true });
    await addMember(pg, clinicA, users.vetA, "VETERINARIAN");
    await addMember(pg, clinicA, users.vetA2, "VETERINARIAN");
    await addMember(pg, clinicA, users.adminA, "CLINIC_ADMIN");
    await addMember(pg, clinicB, users.vetB, "VETERINARIAN");

    await as(users.vetA);
    assert.equal((await pg.query<{ left: number }>("select public.consume_ai_quota($1) as left", [clinicA])).rows[0].left, 1);
    await assert.rejects(
      () => pg.query("select public.consume_ai_quota($1,true)", [clinicA]),
      /AI voice access denied/,
      "voice needs its own entitlement",
    );
    assert.equal((await pg.query<{ left: number }>("select public.consume_ai_quota($1) as left", [clinicA])).rows[0].left, 0);
    await assert.rejects(() => pg.query("select public.consume_ai_quota($1)", [clinicA]), /AI quota exceeded/);
    await assert.rejects(
      () => pg.query("select public.consume_ai_quota($1)", [clinicB]),
      /AI access denied/,
      "members cannot spend another clinic's quota",
    );
    await pg.query("select public.record_ai_tokens($1,1200)", [clinicA]);

    const conversationA = (
      await pg.query<{ id: string }>("insert into public.ai_conversations(business_id) values($1) returning id", [clinicA])
    ).rows[0].id;
    await pg.query(
      "insert into public.ai_messages(business_id,conversation_id,role,channel,content) values($1,$2,'USER','VOICE','Boncuk''un geçmişini özetle')",
      [clinicA, conversationA],
    );

    await as(users.vetB);
    assert.equal((await pg.query<{ left: number }>("select public.consume_ai_quota($1,true) as left", [clinicB])).rows[0].left, 4);
    assert.equal((await pg.query("select 1 from public.ai_conversations")).rows.length, 0);
    assert.equal((await pg.query("select 1 from public.ai_messages")).rows.length, 0);
    await assert.rejects(
      () =>
        pg.query("insert into public.ai_messages(business_id,conversation_id,role,content) values($1,$2,'USER','x')", [
          clinicA,
          conversationA,
        ]),
      /row-level security/,
    );
    await assert.rejects(
      () =>
        pg.query("insert into public.ai_messages(business_id,conversation_id,role,content) values($1,$2,'USER','x')", [
          clinicB,
          conversationA,
        ]),
      /row-level security|foreign key/,
    );

    await as(users.vetA2);
    assert.equal((await pg.query("select 1 from public.ai_messages")).rows.length, 0, "colleagues do not read each other's AI chats");
    await as(users.adminA);
    assert.equal((await pg.query("select 1 from public.ai_messages")).rows.length, 1, "the clinic admin can review");
    await assert.rejects(
      () =>
        pg.query("insert into public.ai_messages(business_id,conversation_id,role,content) values($1,$2,'USER','x')", [
          clinicA,
          conversationA,
        ]),
      /row-level security/,
      "only the owner writes into a conversation",
    );

    await asSuperuser();
    assert.deepEqual(
      (
        await pg.query("select metric, used_quantity from public.business_usage where business_id=$1 order by metric", [clinicA])
      ).rows,
      [
        { metric: "AI_REQUEST", used_quantity: 2 },
        { metric: "AI_TOKENS", used_quantity: 1200 },
      ],
    );
    await pg.query("update public.business_entitlements set ai_assistant_enabled=false where business_id=$1", [clinicB]);
    await as(users.vetB);
    await assert.rejects(() => pg.query("select public.consume_ai_quota($1)", [clinicB]), /AI access denied/);
  } finally {
    await pg.close();
  }
});

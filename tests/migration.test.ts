import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
const sql = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
test("language migration preserves existing Turkish data, seeds Russian idempotently and retains RLS", async () => {
  const pg = new PGlite({ extensions: { pgcrypto } });
  try {
    await pg.exec(
      "create role anon; create role authenticated; create role service_role bypassrls;",
    );
    await pg.exec(sql("supabase/migrations/202609160001_v1.sql"));
    // Reproduce the old V1 seed against the unchanged V1 schema.
    const oldSeed = sql("supabase/seed.sql")
      .replace(
        "clinic_id,language_code,category,title",
        "clinic_id,category,title",
      )
      .replace("select c.id,'tr',v.category", "select c.id,v.category")
      .replace(
        "on conflict(clinic_id,language_code,canonical_question)",
        "on conflict(clinic_id,canonical_question)",
      );
    await pg.exec(oldSeed);
    await pg.exec(`insert into public.unanswered_questions(clinic_id,visitor_name,visitor_phone,question_text,normalized_question) select id,'Demo Ziyaretçi','05000000000','Eski demo soru','eski demo soru' from public.clinics where slug='mavi-pati';
    insert into public.assistant_interactions(clinic_id,question_text,matched_knowledge_id,answer_text,match_score,was_answered) select clinic_id,canonical_question,id,answer_text,1,true from public.assistant_knowledge order by canonical_question limit 1;`);
    const existing = (
      await pg.query(
        "select id,clinic_id,canonical_question,answer_text,keywords,alternative_questions,created_at from public.assistant_knowledge order by id",
      )
    ).rows;
    assert.equal(existing.length, 40);
    await pg.exec(sql("supabase/migrations/202609160002_languages.sql"));
    assert.deepEqual(
      (
        await pg.query(
          "select id,clinic_id,canonical_question,answer_text,keywords,alternative_questions,created_at from public.assistant_knowledge where language_code='tr' order by id",
        )
      ).rows,
      existing,
    );
    assert.equal(
      (
        await pg.query<{ language_code: string }>(
          "select language_code from public.unanswered_questions",
        )
      ).rows[0].language_code,
      "tr",
    );
    assert.equal(
      (
        await pg.query<{ language_code: string }>(
          "select language_code from public.assistant_interactions",
        )
      ).rows[0].language_code,
      "tr",
    );
    await pg.exec(sql("supabase/seed-ru.sql"));
    await pg.exec(sql("supabase/seed-ru.sql"));
    const counts = (
      await pg.query<{ language_code: string; count: number }>(
        "select language_code,count(*)::integer as count from public.assistant_knowledge group by language_code order by language_code",
      )
    ).rows;
    assert.deepEqual(counts, [
      { language_code: "ru", count: 40 },
      { language_code: "tr", count: 40 },
    ]);
    assert.deepEqual(
      (
        await pg.query(
          "select id,clinic_id,canonical_question,answer_text,keywords,alternative_questions,created_at from public.assistant_knowledge where language_code='tr' order by id",
        )
      ).rows,
      existing,
    );
    await pg.exec(
      "insert into public.clinics(slug,name,is_active) values('inactive-test','Inactive',false); insert into public.assistant_knowledge(clinic_id,language_code,category,title,canonical_question,answer_text) select id,'ru','Test','Private','Скрытый вопрос','Private answer' from public.clinics where slug='inactive-test';",
    );
    await pg.exec("set role anon");
    assert.equal(
      (
        await pg.query(
          "select id,language_code,answer_text from public.assistant_knowledge where language_code='ru'",
        )
      ).rows.length,
      40,
    );
    assert.equal(
      (
        await pg.query(
          "select id,slug,supported_languages,default_language,name_translations from public.clinics where slug='inactive-test'",
        )
      ).rows.length,
      0,
    );
    await assert.rejects(
      () => pg.query("select visitor_name from public.unanswered_questions"),
      /permission denied/,
    );
    await assert.rejects(
      () =>
        pg.query("update public.assistant_knowledge set answer_text='Changed'"),
      /permission denied/,
    );
    await assert.rejects(
      () => pg.query("delete from public.clinics"),
      /permission denied/,
    );
    await pg.exec("reset role");
  } finally {
    await pg.close();
  }
});

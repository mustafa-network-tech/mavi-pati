import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const migrationsDirectory = new URL("../../supabase/migrations/", import.meta.url);

export const migrationFiles = readdirSync(migrationsDirectory)
  .filter((file) => file.endsWith(".sql"))
  .sort();

export const migrationSql = (file: string) =>
  readFileSync(new URL(file, migrationsDirectory), "utf8");

// Minimal Supabase surface: roles, auth.users and auth.uid() read from the JWT claim.
export async function createDatabase() {
  const pg = new PGlite({ extensions: { pgcrypto } });
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
  return pg;
}

export async function applyMigrations(pg: PGlite, files = migrationFiles) {
  for (const file of files) await pg.exec(migrationSql(file));
}

export async function createUsers(pg: PGlite, users: Record<string, string>) {
  for (const [name, id] of Object.entries(users))
    await pg.query(
      "insert into auth.users(id,raw_user_meta_data) values($1::uuid,jsonb_build_object('full_name',$2::text))",
      [id, name],
    );
}

export function sessions(pg: PGlite) {
  return {
    async as(userId: string) {
      await pg.exec("reset role");
      await pg.exec("set role authenticated");
      await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
    },
    async asSuperuser() {
      await pg.exec("reset role");
      await pg.query("select set_config('request.jwt.claim.sub','',false)");
    },
    async asServiceRole() {
      await pg.exec("reset role");
      await pg.exec("set role service_role");
    },
  };
}

// An operational clinic with every module enabled and the given seat limits.
export async function createClinic(
  pg: PGlite,
  slug: string,
  options: { veterinarians?: number; staff?: number; aiLimit?: number; voice?: boolean; ownerPortal?: boolean } = {},
) {
  const id = (
    await pg.query<{ id: string }>(
      `insert into public.businesses(slug,display_name,status,access_starts_at,access_expires_at)
       values($1,$1,'ACTIVE',now()-interval '1 day',now()+interval '30 days') returning id`,
      [slug],
    )
  ).rows[0].id;
  await pg.query(
    `insert into public.business_entitlements(
       business_id,max_veterinarians,max_staff,clinic_enabled,appointments_enabled,
       ai_assistant_enabled,ai_voice_enabled,monthly_ai_request_limit,owner_portal_enabled)
     values($1,$2,$3,true,true,true,$4,$5,$6)`,
    [id, options.veterinarians ?? 5, options.staff ?? 5, options.voice ?? false, options.aiLimit ?? 10, options.ownerPortal ?? false],
  );
  return id;
}

export async function addMember(
  pg: PGlite,
  businessId: string,
  userId: string,
  role: "CLINIC_ADMIN" | "VETERINARIAN" | "CLINIC_STAFF",
  status = "ACTIVE",
) {
  return (
    await pg.query<{ id: string }>(
      "insert into public.business_members(business_id,user_id,role,status) values($1,$2,$3,$4) returning id",
      [businessId, userId, role, status],
    )
  ).rows[0].id;
}

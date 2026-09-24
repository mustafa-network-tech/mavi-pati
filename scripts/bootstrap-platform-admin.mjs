import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadLocalEnvironment() {
  const contents = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const name = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    while (value.startsWith(`${name}=`)) value = value.slice(name.length + 1);
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
      value = value.slice(1, -1);
    if (!process.env[name]) process.env[name] = value;
  }
}

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

loadLocalEnvironment();
const userId = argument("user-id");
const expectedEmail = argument("email")?.trim().toLowerCase();
const apply = process.argv.includes("--apply");
if (!userId || !expectedEmail) throw new Error("--user-id and --email are required");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("Supabase server configuration is missing");
const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: authData, error: authError } = await supabase.auth.admin.getUserById(userId);
if (authError || !authData.user) throw new Error(`Auth user could not be verified: ${authError?.message ?? "not found"}`);
if (authData.user.email?.toLowerCase() !== expectedEmail)
  throw new Error("The supplied email does not match the Auth user UUID");

const { data: memberships, error: membershipError } = await supabase
  .from("business_members")
  .select("id,status")
  .eq("user_id", userId)
  .limit(1);
if (membershipError) throw new Error(`Platform schema is unavailable: ${membershipError.message}`);
if (memberships?.length) throw new Error("This user is already a tenant member; platform and tenant roles must remain separate");

if (!apply) {
  console.log("Verified: Auth identity matches, platform schema exists, and no tenant membership conflicts.");
  process.exit(0);
}

const { error: upsertError } = await supabase.from("platform_users").upsert(
  { user_id: userId, role: "PLATFORM_ADMIN", status: "ACTIVE" },
  { onConflict: "user_id" },
);
if (upsertError) throw new Error(`Platform admin could not be assigned: ${upsertError.message}`);
const { data: platformUser, error: verifyError } = await supabase
  .from("platform_users")
  .select("role,status")
  .eq("user_id", userId)
  .maybeSingle();
if (verifyError || platformUser?.role !== "PLATFORM_ADMIN" || platformUser.status !== "ACTIVE")
  throw new Error("Platform admin assignment could not be verified");
console.log("Platform admin assigned and activated.");

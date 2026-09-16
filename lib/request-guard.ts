import "server-only";
import { createHash } from "node:crypto";
import { database } from "@/lib/supabase/server";
import { isLocalDemo } from "@/lib/demo/mode";
const previewBuckets = new Map<string, { start: number; hits: number }>();
export async function guard(request: Request, scope: string) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return false;
  if (Number(request.headers.get("content-length") ?? 0) > 8192) return false;
  if (isLocalDemo()) {
    const now = Date.now();
    for (const [key, value] of previewBuckets)
      if (now - value.start > 60000) previewBuckets.delete(key);
    const host = new URL(request.url).hostname;
    if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) return false;
    const key = request.headers.get("x-forwarded-for") ?? "local";
    const bucket = previewBuckets.get(key) ?? { start: now, hits: 0 };
    bucket.hits++;
    previewBuckets.set(key, bucket);
    return bucket.hits <= 30;
  }
  const salt = process.env.RATE_LIMIT_SALT;
  if (!salt) throw new Error("Rate limit configuration missing");
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const key = createHash("sha256")
    .update(`${salt}:${scope}:${ip}`)
    .digest("hex");
  const { data, error } = await database(true).rpc("consume_request_quota", {
    bucket_key: key,
  });
  if (error) throw error;
  return data === true;
}

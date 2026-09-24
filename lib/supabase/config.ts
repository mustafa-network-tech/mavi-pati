export type PublicSupabaseConfig = {
  url: string;
  key: string;
};

export function getPublicSupabaseConfig(): PublicSupabaseConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!url || !key || !/^https:\/\/[^\s]+$/i.test(url)) return null;
  return { url, key };
}

export function requirePublicSupabaseConfig(): PublicSupabaseConfig {
  const config = getPublicSupabaseConfig();
  if (!config)
    throw new Error(
      "Supabase Auth yapılandırması eksik veya geçersiz. Public URL ve publishable/anon key değerlerini kontrol edin.",
    );
  return config;
}
